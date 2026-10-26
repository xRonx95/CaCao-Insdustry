# Resize the existing brand asset for Android launcher resources; no generated artwork.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path -Parent $PSScriptRoot
$resourceRoot = Join-Path $projectRoot 'android/app/src/main/res'
$source = [System.Drawing.Image]::FromFile((Join-Path $projectRoot 'images/cacao-logo.png'))
function Save-Icon([string]$destination, [int]$size, [double]$fraction) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.Clear([System.Drawing.Color]::FromArgb(255, 255, 254, 249))
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $side = [int]($size * $fraction)
        $offset = [int](($size - $side) / 2)
        $graphics.DrawImage($source, $offset, $offset, $side, $side)
        $bitmap.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}
try {
    foreach ($entry in @(@('mdpi',48,108), @('hdpi',72,162), @('xhdpi',96,216), @('xxhdpi',144,324), @('xxxhdpi',192,432))) {
        $folder = Join-Path $resourceRoot "mipmap-$($entry[0])"
        Save-Icon (Join-Path $folder 'ic_launcher.png') $entry[1] 0.86
        Save-Icon (Join-Path $folder 'ic_launcher_round.png') $entry[1] 0.70
        # Keep the complete logo inside adaptive-icon masks across launchers.
        Save-Icon (Join-Path $folder 'ic_launcher_foreground.png') $entry[2] 0.60
    }
} finally {
    $source.Dispose()
}
Write-Output 'Android launcher icons updated from images/cacao.png.'
