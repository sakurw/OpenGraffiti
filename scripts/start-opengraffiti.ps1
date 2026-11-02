param([switch]$NoOpen, [switch]$NoBrowser, [switch]$FadeSample, [ValidateSet('flat','constrained')][string]$Terrain = 'flat')

# Accept the batch file's conventional --no-open argument as well.
$skipBrowser = $NoOpen -or $NoBrowser -or ($args -contains '--no-open')
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$baseUrl = 'http://127.0.0.1:3100'
$pageUrl = if ($FadeSample) { "$baseUrl/demo-fade" } else { "$baseUrl/areas/tocho/city" }

$pageUrl += "?terrain=$Terrain"

function Test-OpenGraffiti {
    try {
        $clock = Invoke-RestMethod -Uri "$baseUrl/api/v1/clock" -TimeoutSec 3
        return ($null -ne $clock.scenarioId -and $null -ne $clock.now)
    } catch { return $false }
}

try {
    Set-Location -LiteralPath $projectRoot
    if (!(Test-OpenGraffiti)) {
        $listener = Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue
        if ($listener) { throw 'Port 3100 is occupied by another service. OpenGraffiti was not started.' }

        $nodePath = Join-Path $projectRoot '.tools\node-v24.20.0-win-x64\node.exe'
        if (!(Test-Path -LiteralPath $nodePath)) {
            $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
            if (!$nodeCommand) { throw 'Node.js was not found. Run npm run setup:runtime first.' }
            $nodePath = $nodeCommand.Source
        }
        if (!(Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\fastify'))) {
            throw 'Dependencies were not found. Run npm ci first.'
        }
        if (!(Test-Path -LiteralPath (Join-Path $projectRoot 'dist\index.html'))) {
            Write-Host 'Building OpenGraffiti for the first launch...'
            & $nodePath 'scripts/runtime.mjs' build
            if ($LASTEXITCODE -ne 0) { throw 'The build failed. The server was not started.' }
        }

        $logFolder = Join-Path $projectRoot 'data\launcher'
        New-Item -ItemType Directory -Path $logFolder -Force | Out-Null
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
        $outputLog = Join-Path $logFolder "$stamp.stdout.log"
        $errorLog = Join-Path $logFolder "$stamp.stderr.log"
        $env:PORT = '3100'
        $env:MOCK_FIXTURE = '0'
        $env:MOCK_TEST_MODE = '0'
        $server = Start-Process -FilePath $nodePath -ArgumentList 'server/index.mjs' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $outputLog -RedirectStandardError $errorLog -PassThru
        Write-Host 'Starting OpenGraffiti...'
        $deadline = (Get-Date).AddSeconds(60)
        $ready = $false
        do {
            if (Test-OpenGraffiti) { $ready = $true; break }
            $server.Refresh()
            if ($server.HasExited) {
                if (Test-Path -LiteralPath $errorLog) { Get-Content -LiteralPath $errorLog -Tail 15 | Out-Host }
                throw "The server exited. Log: $errorLog"
            }
            Start-Sleep -Milliseconds 400
        } while ((Get-Date) -lt $deadline)
        if (!$ready) { throw "Startup has not completed within 60 seconds. Check $errorLog before launching again." }
        Write-Host "Server PID: $($server.Id)"
        Write-Host "Logs: $logFolder"
    } else {
        Write-Host 'OpenGraffiti is already running. Reusing the server.'
    }

    Write-Host "Ready: $pageUrl"
    if ($FadeSample) { Write-Host "Control: $baseUrl/demo-control"; Write-Host 'On the city screen: Space plays/pauses; Left rewinds and pauses. Duration: 15 seconds.' }
    if (!$skipBrowser) { Start-Process $pageUrl }
    exit 0
} catch {
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
