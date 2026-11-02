$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$failedAreas = @()
foreach ($area in @('tocho','tokyo-tower')) {
    try {
        & ./.tools/texture-cuda/Scripts/python.exe scripts/texture-kartaview-snap-inputs.py $area
        if ($LASTEXITCODE -ne 0) { throw 'SNAP input preparation failed' }
        foreach ($script in @('texture-kartaview-snap-surfaces','texture-kartaview-snap-model','texture-kartaview-snap-audit')) {
            if ($script -eq 'texture-kartaview-snap-model') {
                & ./.tools/texture-cuda/Scripts/python.exe scripts/texture-kartaview-snap-rectify.py $area
                if ($LASTEXITCODE -ne 0) { throw 'Official SNAP rectification failed' }
            }
            $outLog = "data/texture-city/kartaview/$script-$area-$stamp.out.log"
            $errLog = "data/texture-city/kartaview/$script-$area-$stamp.err.log"
            $process = Start-Process -FilePath 'C:/nvm4w/nodejs/node.exe' -ArgumentList @("scripts/$script.mjs",$area) -WindowStyle Hidden -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
            $process.ProcessorAffinity = [IntPtr]65536
            $process.WaitForExit()
            Get-Content -LiteralPath $outLog -Tail 12
            if ($process.ExitCode -ne 0) { Get-Content -LiteralPath $errLog -Tail 12; throw "$script failed: exit $($process.ExitCode)" }
        }
    } catch {
        $failedAreas += $area
        Write-Warning "${area}: $_"
    }
}
if ($failedAreas.Count) { throw "Incomplete areas: $($failedAreas -join ', ')" }
Write-Output 'KartaView/SNAP candidate outputs generated and audited. Camera correspondence remains unverified; build and visual verification are separate.'
