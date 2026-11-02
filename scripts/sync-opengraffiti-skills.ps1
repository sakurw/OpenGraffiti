param([switch]$Check)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourceRoot = Join-Path $projectRoot '開発関連/skills'
$skillRoot = if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME 'skills' } else { Join-Path $env:USERPROFILE '.codex/skills' }
foreach ($skillName in @('plateau-illustrated-textures', 'plateau-roads-terrain')) {
    $source = Join-Path $sourceRoot $skillName
    $target = Join-Path $skillRoot $skillName
    foreach ($file in Get-ChildItem -LiteralPath $source -File -Recurse) {
        $relative = $file.FullName.Substring($source.Length).TrimStart('\','/')
        $destination = Join-Path $target $relative
        if ($Check) {
            if (!(Test-Path -LiteralPath $destination) -or (Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath $destination).Hash) { throw "Skill differs: $destination" }
        } else {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
            Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
        }
    }
    Write-Host "$skillName : $target"
}
