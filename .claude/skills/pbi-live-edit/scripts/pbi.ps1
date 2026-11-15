<#
.SYNOPSIS
  Runs the Power BI Desktop bridge CLI (powerbi-desktop) without needing Node.js on the PATH.

.EXAMPLE
  pbi.ps1 status
  pbi.ps1 screenshot sales --output C:\temp\before.png --scale 1
  pbi.ps1 reload --pid 43432
#>
$ErrorActionPreference = 'Stop'

# node.exe: the PATH first, then the usual install folders
$node = (Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $node) {
    $node = @("$env:ProgramFiles\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe") |
        Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}
if (-not $node) {
    Write-Error "Node.js was not found. Install it from https://nodejs.org (the LTS installer), then run this again."
    exit 2
}

# the bridge CLI, installed globally with npm
$cli = Join-Path $env:APPDATA 'npm\node_modules\@microsoft\powerbi-desktop-bridge-cli\dist\cli.js'
if (-not (Test-Path $cli)) {
    $root = (& $node -e "process.stdout.write(require('child_process').execSync('npm root -g').toString().trim())" 2>$null)
    if ($root) { $cli = Join-Path $root '@microsoft\powerbi-desktop-bridge-cli\dist\cli.js' }
}
if (-not (Test-Path $cli)) {
    Write-Error "The Power BI Desktop bridge CLI was not found. Install it with: npm install -g @microsoft/powerbi-desktop-bridge-cli"
    exit 2
}

& $node $cli @args
exit $LASTEXITCODE
