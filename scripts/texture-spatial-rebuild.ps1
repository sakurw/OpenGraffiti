param([int]$AcquisitionProcessId = 0)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if ($AcquisitionProcessId -gt 0) {
    $job = Get-CimInstance Win32_Process -Filter "ProcessId=$AcquisitionProcessId"
    if ($job -and $job.CommandLine -notmatch 'scripts/texture-spatial-acquire\.mjs') { throw 'Unexpected acquisition process' }
    if ($job) {
        $acquisition = Get-Process -Id $AcquisitionProcessId
        Write-Output 'Waiting for the existing spatial acquisition process.'
        while (-not $acquisition.WaitForExit(30000)) { $acquisition.Refresh() }
    }
}
$report = Get-Content -LiteralPath 'data/texture-city/spatial/acquisition-report.json' -Raw | ConvertFrom-Json
if ($report.requested -ne 5327 -or $report.failed -ne 0 -or
    ($report.cached + $report.downloaded + $report.notProvided) -ne $report.requested) {
    throw 'Full spatial acquisition has not completed successfully; no model changed.'
}
$existing = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'scripts/texture-project-city\.mjs' }
if ($existing) { throw 'Another projection process is running; no duplicate started.' }
$nodePath = 'C:\nvm4w\nodejs\node.exe'
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Expected validated Node runtime is unavailable.' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
foreach ($area in @('tocho', 'tokyo-tower')) {
    $baseline = "data/texture-city/depth-baseline-$area.json"
    if (-not (Test-Path -LiteralPath $baseline)) {
        Copy-Item -LiteralPath "public/assets/texture-poc/experimental/$area.json" -Destination $baseline
    }
    $outLog = Join-Path (Get-Location) "data/texture-city/projection-$area-depth-$stamp.out.log"
    $errLog = Join-Path (Get-Location) "data/texture-city/projection-$area-depth-$stamp.err.log"
    $projection = Start-Process -FilePath $nodePath -ArgumentList @('--max-old-space-size=8192', 'scripts/texture-project-city.mjs', $area) -WindowStyle Hidden -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
    # Process-scoped workaround used successfully before; no system setting changed.
    $projection.ProcessorAffinity = [IntPtr]65536
    Write-Output "Projection started: $area PID=$($projection.Id) stdout=$outLog"
    while (-not $projection.WaitForExit(30000)) {
        Get-Content -LiteralPath $outLog -Tail 1
        $projection.Refresh()
    }
    $projection.WaitForExit()
    if ($projection.ExitCode -ne 0) {
        Get-Content -LiteralPath $errLog -Tail 15
        throw "Projection failed: $area exit=$($projection.ExitCode)"
    }
    & $nodePath scripts/texture-spatial-result-audit.mjs $area
    if ($LASTEXITCODE -ne 0) { throw "Generated model audit failed: $area" }
}
& $nodePath scripts/runtime.mjs build
if ($LASTEXITCODE -ne 0) { throw 'Model generation completed but application build failed.' }
Write-Output 'Both depth-filtered models generated and audited. Visual quality still requires review.'
