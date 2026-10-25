# Copy only public application files. No database, backup, test or secret files.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$config = Get-Content -LiteralPath (Join-Path $projectRoot 'capacitor.config.json') -Raw | ConvertFrom-Json
$bundleRoot = Join-Path $projectRoot $config.webDir
New-Item -ItemType Directory -Path $bundleRoot -Force | Out-Null
Get-ChildItem -LiteralPath $projectRoot -Filter '*.html' -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $bundleRoot -Force
}
foreach ($appFolder in @('assets', 'images', 'admin', 'farmer', 'field')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $appFolder) -Destination $bundleRoot -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'favicon.ico') -Destination $bundleRoot -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'service-worker.js') -Destination $bundleRoot -Force
if (Test-Path -LiteralPath (Join-Path $projectRoot 'android/app/src/main/res')) {
    & (Join-Path $PSScriptRoot 'prepare-android-icons.ps1')
}
$manifestPath = Join-Path $projectRoot 'android/app/src/main/AndroidManifest.xml'
if (Test-Path -LiteralPath $manifestPath) {
    $manifestText = Get-Content -LiteralPath $manifestPath -Raw
    foreach ($locationPermission in @('ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION')) {
        if (-not $manifestText.Contains("android.permission.$locationPermission")) {
            $permissionTag = '    <uses-permission android:name="android.permission.' + $locationPermission + '" />'
            $manifestText = $manifestText.Replace('</manifest>', $permissionTag + "`n</manifest>")
        }
    }
    [System.IO.File]::WriteAllText($manifestPath, $manifestText)
}
Write-Output "Public web bundle prepared in $($config.webDir). Run npx cap sync android before compiling the APK."
