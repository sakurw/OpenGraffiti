$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$existing = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'scripts/texture-project-city\.mjs' }
if ($existing) { throw 'A projection process is already running.' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
foreach ($area in @('tocho','tokyo-tower')) {
    $outLog = Join-Path (Get-Location) "data/texture-city/refinement-all-$area-$stamp.out.log"
    $errLog = Join-Path (Get-Location) "data/texture-city/refinement-all-$area-$stamp.err.log"
    $projection = Start-Process -FilePath 'C:\nvm4w\nodejs\node.exe' -ArgumentList @('--max-old-space-size=8192','scripts/texture-project-city.mjs',$area,'--selection=wall-coverage','--refine=2') -WindowStyle Hidden -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
    $projection.ProcessorAffinity = [IntPtr]65536
    Write-Output "Full refinement: $area PID=$($projection.Id) stdout=$outLog"
    while (-not $projection.WaitForExit(30000)) { Get-Content -LiteralPath $outLog -Tail 1; $projection.Refresh() }
    $projection.WaitForExit()
    if ($projection.ExitCode -ne 0) { Get-Content -LiteralPath $errLog -Tail 10; throw "Refinement failed: $area" }
    node scripts/texture-output-bias-stabilize.mjs $area --apply
    if ($LASTEXITCODE -ne 0) { throw "Rendered bias stabilization failed: $area" }
    node scripts/texture-output-bias-audit.mjs $area
    if ($LASTEXITCODE -ne 0) { throw "Rendered bias preservation audit failed: $area" }
    node --max-old-space-size=8192 scripts/texture-refinement-audit.mjs $area --all
    if ($LASTEXITCODE -ne 0) { throw "Coverage audit failed: $area" }
    node scripts/texture-spatial-result-audit.mjs $area wall-coverage-refine2-all
    if ($LASTEXITCODE -ne 0) { throw "Spatial audit failed: $area" }
}
Write-Output 'Full refinement generated and audited; default model selection unchanged.'
