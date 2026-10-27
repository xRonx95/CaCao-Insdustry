$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$deckPath=Join-Path (Split-Path -Parent $PSScriptRoot) 'docs/pitch/CaAPs-Research-Learning-Pitch.pptx'
$archive=[IO.Compression.ZipFile]::OpenRead($deckPath)
try{
 $names=@{};foreach($entry in $archive.Entries){$names[$entry.FullName]=$true}
 $xmlCount=0
 foreach($entry in $archive.Entries){
  if($entry.FullName.EndsWith('.xml') -or $entry.FullName.EndsWith('.rels')){
   $reader=[IO.StreamReader]::new($entry.Open());try{[xml]$doc=$reader.ReadToEnd()}finally{$reader.Dispose()};$xmlCount++
   if($entry.FullName.EndsWith('.rels')){
    $base=if($entry.FullName -eq '_rels/.rels'){'http://package/'}else{'http://package/'+$entry.FullName.Substring(0,$entry.FullName.IndexOf('_rels/'))}
    foreach($rel in $doc.DocumentElement.ChildNodes){if($rel.TargetMode -eq 'External'){continue};$target=[Uri]::new([Uri]$base,[string]$rel.Target).AbsolutePath.TrimStart('/');if(-not $names.ContainsKey($target)){throw ('Missing relationship target '+$target)}}
   }
  }
 }
 $slideCount=@($archive.Entries|Where-Object{$_.FullName -match '^ppt/slides/slide\d+\.xml$'}).Count
 $notesCount=@($archive.Entries|Where-Object{$_.FullName -match '^ppt/notesSlides/notesSlide\d+\.xml$'}).Count
 if($slideCount -ne 11 -or $notesCount -ne 11){throw 'Expected 11 slides and speaker-note parts'}
 Write-Output ('Validated PPTX archive: '+$slideCount+' slides, '+$notesCount+' note parts, '+$xmlCount+' well-formed XML/relationship parts, all internal targets present.')
}finally{$archive.Dispose()}
