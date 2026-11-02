$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$failedAreas = @()
$nodeHeapMb = 8192
foreach ($area in @('tocho','tokyo-tower')) {
    try {
        & ./.tools/texture-cuda/Scripts/python.exe scripts/texture-msls-snap-inputs.py $area
        if ($LASTEXITCODE -ne 0) { throw 'SNAP input preparation failed' }
        $baselineOutLog = "data/texture-city/msls/texture-msls-snap-surfaces-baseline-$area-$stamp.out.log"
        $baselineErrLog = "data/texture-city/msls/texture-msls-snap-surfaces-baseline-$area-$stamp.err.log"
        # Whole-city candidate projection builds a full PLATEAU BVH and may inspect
        # hundreds of source photos. Tokyo Tower exceeds Node's default old-space
        # limit on this dataset, so give this bounded heavy stage explicit headroom.
        & C:/nvm4w/nodejs/node.exe "--max-old-space-size=$nodeHeapMb" scripts/texture-msls-snap-surfaces.mjs $area --ignore-local-registration > $baselineOutLog 2> $baselineErrLog
        $baselineExitCode = $LASTEXITCODE
        Get-Content -LiteralPath $baselineOutLog -Tail 12
        if ($null -eq $baselineExitCode -or $baselineExitCode -ne 0) {
            Get-Content -LiteralPath $baselineErrLog -Tail 40
            throw "Baseline SNAP surface projection failed: exit $baselineExitCode"
        }
        & ./.tools/texture-cuda/Scripts/python.exe scripts/texture-msls-snap-local-refine.py $area
        if ($LASTEXITCODE -ne 0) { throw 'Local PLATEAU camera refinement failed' }
        foreach ($script in @('texture-msls-snap-surfaces','texture-msls-snap-model','texture-msls-snap-audit')) {
            if ($script -eq 'texture-msls-snap-model') {
                & ./.tools/texture-cuda/Scripts/python.exe scripts/texture-msls-snap-rectify.py $area
                if ($LASTEXITCODE -ne 0) { throw 'Official SNAP rectification failed' }
            }
            $outLog = "data/texture-city/msls/$script-$area-$stamp.out.log"
            $errLog = "data/texture-city/msls/$script-$area-$stamp.err.log"
            # Invoke the native process directly so $LASTEXITCODE is authoritative.
            # Start-Process intermittently returned a null ExitCode after a
            # successful redirected run on Windows PowerShell, which made the
            # rebuild report false failures after producing valid output.
            & C:/nvm4w/nodejs/node.exe "scripts/$script.mjs" $area > $outLog 2> $errLog
            $exitCode = $LASTEXITCODE
            Get-Content -LiteralPath $outLog -Tail 12
            if ($null -eq $exitCode -or $exitCode -ne 0) { Get-Content -LiteralPath $errLog -Tail 12; throw "$script failed: exit $exitCode" }
        }
    } catch {
        $failedAreas += $area
        Write-Warning "${area}: $_"
    }
}
if ($failedAreas.Count) { throw "Incomplete areas: $($failedAreas -join ', ')" }
Write-Output 'MSLS/SNAP candidate outputs generated and audited. Camera correspondence remains unverified; build and visual verification are separate.'
