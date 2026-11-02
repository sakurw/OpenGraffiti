$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$existing = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'scripts/texture-project-city\.mjs' }
if ($existing) { throw 'A projection process is already running.' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$buildings = 'bldg_04af6636-576b-435c-bcad-a9fc951ad59e,bldg_9f293263-46b9-454d-ab46-c84982f22398,bldg_545b3745-9753-45c1-b43f-728a24df165b'
foreach ($selection in @('triangle-first','wall-coverage')) {
    $outLog = Join-Path (Get-Location) "data/texture-city/selection-$selection-$stamp.out.log"
    $errLog = Join-Path (Get-Location) "data/texture-city/selection-$selection-$stamp.err.log"
    $projection = Start-Process -FilePath 'C:\nvm4w\nodejs\node.exe' -ArgumentList @('--max-old-space-size=8192','scripts/texture-project-city.mjs','tocho',"--selection=$selection","--buildings=$buildings") -WindowStyle Hidden -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
    $projection.ProcessorAffinity = [IntPtr]65536
    Write-Output "Selection pilot: $selection PID=$($projection.Id) stdout=$outLog"
    while (-not $projection.WaitForExit(30000)) { Get-Content -LiteralPath $outLog -Tail 1; $projection.Refresh() }
    $projection.WaitForExit()
    if ($projection.ExitCode -ne 0) { Get-Content -LiteralPath $errLog -Tail 10; throw "Pilot failed: $selection" }
    Get-Content -LiteralPath $outLog -Tail 1
}
Write-Output 'Pilot models generated separately. No default city projection replaced.'
