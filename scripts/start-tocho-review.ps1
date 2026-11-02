param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$reviewUrl = 'http://127.0.0.1:3100/tocho-landmark-comparison.html'
function Test-TochoServer {
    try { return (Invoke-RestMethod 'http://127.0.0.1:3100/healthz' -TimeoutSec 2).service -eq 'tocho-review' } catch { return $false }
}
if (-not (Test-TochoServer)) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort 3100 -ErrorAction SilentlyContinue
    if ($listener) { throw 'Port 3100 is occupied by a different server. Existing processes have been preserved.' }
    $nodePath = Join-Path $projectRoot '.tools\node-v24.20.0-win-x64\node.exe'
    Start-Process -FilePath $nodePath -ArgumentList 'scripts/serve-tocho-review.mjs' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot 'data\texture-city\tocho-review-stdout.log') -RedirectStandardError (Join-Path $projectRoot 'data\texture-city\tocho-review-stderr.log') | Out-Null
    for ($attempt=0; $attempt -lt 20; $attempt++) { if (Test-TochoServer) { break }; Start-Sleep -Milliseconds 300 }
}
if (-not (Test-TochoServer)) { throw 'The Tocho HTTP server did not start.' }
if (-not $NoOpen) { Start-Process $reviewUrl }
Write-Output $reviewUrl
