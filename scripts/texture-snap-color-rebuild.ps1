param(
    [string]$CaseId = "shinjuku-mitsui-no2-southeast"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    python scripts\texture-snap-rectify.py $CaseId
    if ($LASTEXITCODE -ne 0) { throw "texture-snap-rectify failed" }

    python scripts\texture-snap-source-manifest.py $CaseId
    if ($LASTEXITCODE -ne 0) { throw "texture-snap-source-manifest failed" }

    python scripts\texture-snap-semantics.py $CaseId
    if ($LASTEXITCODE -ne 0) { throw "texture-snap-semantics failed" }

    node scripts\texture-snap-model.mjs $CaseId
    if ($LASTEXITCODE -ne 0) { throw "texture-snap-model failed" }

    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm build failed" }

    node scripts\verify-universal-comparison.mjs
    if ($LASTEXITCODE -ne 0) { throw "universal comparison verification failed" }
} finally {
    Pop-Location
}
