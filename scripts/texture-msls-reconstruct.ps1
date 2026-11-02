$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$mslsRows=Get-Content -LiteralPath data/texture-city/msls/photos.json -Raw | ConvertFrom-Json
$mslsIds=foreach($mslsRow in $mslsRows){[string]$mslsRow.sequenceId}
$mslsSequences=$mslsIds | Group-Object
foreach($mslsSequence in $mslsSequences){
    $mslsId=$mslsSequence.Name
    Write-Output "MSLS reconstruction: $mslsId ($($mslsSequence.Count) photographs)"
    & ./.tools/texture-cuda/Scripts/python.exe scripts/texture-kartaview-sfm.py $mslsId --provider msls *> "data/texture-city/msls/sfm-$mslsId.log"
    if($LASTEXITCODE -ne 0){throw "MSLS reconstruction failed: $mslsId"}
    $mslsWork=Get-ChildItem -LiteralPath data/texture-city/msls/sfm -Directory | Where-Object {$_.Name.StartsWith("$mslsId-")} | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if(!$mslsWork){throw 'Missing SfM work directory'}
    & ./.tools/texture-cuda/Scripts/python.exe scripts/texture-kartaview-sfm-align.py $mslsWork.Name --provider msls *> "data/texture-city/msls/align-$mslsId.log"
    if($LASTEXITCODE -ne 0){throw "MSLS alignment failed: $mslsId"}
    Write-Output "MSLS sequence completed: $mslsId"
}
