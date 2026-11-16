$androidRoot = Resolve-Path 'novel-reader\app\src\main\java'
$iosSrc = Resolve-Path 'IOS\src'
$kipFiles = Get-ChildItem "$androidRoot" -Recurse -File -Include *.kt,*.java | Where-Object { $_.FullName -notmatch '\\.mimosa\\' }
$iosFiles = Get-ChildItem "$iosSrc" -Recurse -File
$iosNames = @{}
foreach ($f in $iosFiles) { $iosNames[$f.BaseName.ToLower()] = $true }
$skip = 'fi\\harism|net\\engawapg|com\\ramotion|me\\rishiraj|eu\\wewox|com\\swapnil|mangatranslate'
$missing = @()
$have = @()
foreach ($f in $kipFiles) {
  $rel = $f.FullName.Substring($androidRoot.Path.Length + 1)
  if ($rel -match $skip) { continue }
  $base = [IO.Path]::GetFileNameWithoutExtension($f.Name)
  if ($iosNames.ContainsKey($base.ToLower())) { $have += $rel } else { $missing += ($rel + ' | ' + $f.Length) }
}
Write-Host ("HAVE: " + $have.Count)
Write-Host ("MISSING: " + $missing.Count)
$missing | Out-File -Encoding utf8 'IOS\gap-missing.txt'
$have | Out-File -Encoding utf8 'IOS\gap-have.txt'

