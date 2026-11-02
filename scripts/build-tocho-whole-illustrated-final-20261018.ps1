$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$nodePath = Join-Path (Get-Location) '.tools/node-v24.20.0-win-x64/node.exe'
$steps = @(
  'scripts/build-tocho-whole-illustrated-20261018.mjs',
  'scripts/refine-tocho-whole-illustrated-overlays-20261018.mjs',
  'scripts/package-tocho-whole-illustrated-20261018.mjs',
  'scripts/verify-tocho-whole-illustrated-20261018.mjs'
)
foreach ($step in $steps) {
  & $nodePath --max-old-space-size=6144 $step
  if ($LASTEXITCODE -ne 0) { throw "Failed: $step" }
}
