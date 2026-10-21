# Copy only public application files. No database, backup, test or secret files.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$bundleRoot = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Path $bundleRoot -Force | Out-Null
Get-ChildItem -LiteralPath $projectRoot -Filter '*.html' -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $bundleRoot -Force
}
foreach ($appFolder in @('assets', 'images', 'admin', 'farmer', 'field')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $appFolder) -Destination $bundleRoot -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'favicon.ico') -Destination $bundleRoot -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'service-worker.js') -Destination $bundleRoot -Force
Write-Output 'Public web bundle prepared in dist. Android compilation and device testing are separate steps.'
