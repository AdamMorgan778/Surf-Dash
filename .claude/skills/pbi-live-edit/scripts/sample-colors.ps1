<#
.SYNOPSIS
  Prints the colour at points in an image as #RRGGBB, to check a colour change exactly rather than by eye.

.PARAMETER Image
  The PNG to read, for example a screenshot from pbi.ps1.

.PARAMETER Points
  One or more points as "x,y" separated by spaces, each a fraction of the width and height (0 to 1), so they work at
  any --scale. Pick points on the thing that changed, away from text and borders.

.EXAMPLE
  sample-colors.ps1 -Image "C:\temp\after\Shop & Lessons.png" -Points "0.30,0.03 0.48,0.29"
#>
param([Parameter(Mandatory)][string]$Image, [Parameter(Mandatory, ValueFromRemainingArguments)][string[]]$Points)

Add-Type -AssemblyName System.Drawing
$bmp = [System.Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $Image))
try {
    # accept "x,y x,y" or "x,y;x,y" in one string, which survives every shell
    foreach ($p in (($Points -join ' ') -split '[\s;]+' | Where-Object { $_ })) {
        $fx, $fy = $p.Split(',') | ForEach-Object { [double]$_ }
        $x = [Math]::Min([int]($fx * $bmp.Width), $bmp.Width - 1)
        $y = [Math]::Min([int]($fy * $bmp.Height), $bmp.Height - 1)
        $c = $bmp.GetPixel($x, $y)
        '{0,-12} ({1},{2})  #{3:X2}{4:X2}{5:X2}' -f $p, $x, $y, $c.R, $c.G, $c.B
    }
} finally { $bmp.Dispose() }
