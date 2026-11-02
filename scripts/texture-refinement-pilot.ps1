$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$existing = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'scripts/texture-project-city\.mjs' }
if ($existing) { throw 'A projection process is already running.' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
foreach ($area in @('tocho','tokyo-tower')) {
    $baseline = Get-Content -LiteralPath "public/assets/texture-poc/experimental/selection/wall-coverage-all/$area.json" -Raw | ConvertFrom-Json
    # Bounded exploratory sample: 50 previously unprojected buildings with the
    # fewest candidate attempts, plus one positive control. Not a random sample.
    $missing = $baseline.buildings | Where-Object { $_.triangles -eq 0 -and $_.diagnostic.attempts -gt 0 } | Sort-Object { $_.diagnostic.attempts },buildingId | Select-Object -First 50
    $control = $baseline.buildings | Where-Object { $_.triangles -gt 0 } | Sort-Object { $_.diagnostic.attempts },buildingId | Select-Object -First 1
    $buildings = (@($missing.buildingId) + @($control.buildingId)) -join ','
    $outLog = Join-Path (Get-Location) "data/texture-city/refinement-$area-$stamp.out.log"
    $errLog = Join-Path (Get-Location) "data/texture-city/refinement-$area-$stamp.err.log"
    $projection = Start-Process -FilePath 'C:\nvm4w\nodejs\node.exe' -ArgumentList @('--max-old-space-size=8192','scripts/texture-project-city.mjs',$area,'--selection=wall-coverage','--refine=2',"--buildings=$buildings") -WindowStyle Hidden -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
    $projection.ProcessorAffinity = [IntPtr]65536
    Write-Output "Refinement pilot: $area PID=$($projection.Id) stdout=$outLog"
    while (-not $projection.WaitForExit(30000)) { Get-Content -LiteralPath $outLog -Tail 1; $projection.Refresh() }
    $projection.WaitForExit()
    if ($projection.ExitCode -ne 0) { Get-Content -LiteralPath $errLog -Tail 10; throw "Pilot failed: $area" }
    Get-Content -LiteralPath $outLog -Tail 1
}
Write-Output 'Refinement pilot completed separately; default models unchanged.'
