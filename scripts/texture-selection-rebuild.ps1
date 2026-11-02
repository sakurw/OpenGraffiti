$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$existing = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'scripts/texture-project-city\.mjs' }
if ($existing) { throw 'A projection process is already running.' }
$nodePath = 'C:\nvm4w\nodejs\node.exe'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
foreach ($area in @('tocho','tokyo-tower')) {
    $outLog = Join-Path (Get-Location) "data/texture-city/selection-all-$area-$stamp.out.log"
    $errLog = Join-Path (Get-Location) "data/texture-city/selection-all-$area-$stamp.err.log"
    $projection = Start-Process -FilePath $nodePath -ArgumentList @('--max-old-space-size=8192','scripts/texture-project-city.mjs',$area,'--selection=wall-coverage') -WindowStyle Hidden -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
    $projection.ProcessorAffinity = [IntPtr]65536
    Write-Output "Full selection rebuild: $area PID=$($projection.Id) stdout=$outLog"
    while (-not $projection.WaitForExit(30000)) { Get-Content -LiteralPath $outLog -Tail 1; $projection.Refresh() }
    $projection.WaitForExit()
    if ($projection.ExitCode -ne 0) { Get-Content -LiteralPath $errLog -Tail 10; throw "Projection failed: $area" }
    & $nodePath --max-old-space-size=8192 scripts/texture-selection-audit.mjs $area --all
    if ($LASTEXITCODE -ne 0) { throw "Coverage comparison failed: $area" }
    & $nodePath scripts/texture-spatial-result-audit.mjs $area wall-coverage-all
    if ($LASTEXITCODE -ne 0) { throw "Source/depth audit failed: $area" }
}
& $nodePath scripts/runtime.mjs build
if ($LASTEXITCODE -ne 0) { throw 'Selection output built but application build failed.' }
Write-Output 'Both whole-city selection variants generated and audited; visual review pending. Default models preserved.'
