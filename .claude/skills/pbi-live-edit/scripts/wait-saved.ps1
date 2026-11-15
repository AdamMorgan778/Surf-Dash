<#
.SYNOPSIS
  Waits until Power BI Desktop has no unsaved changes, then prints SAVED. Exits 1 with TIMED OUT if it never happens.

.PARAMETER TimeoutSeconds
  How long to wait. Default 900 (15 minutes).

.PARAMETER ProcessId
  The PBIDesktop.exe process to watch, when more than one is open. Default: every instance must be saved.

.EXAMPLE
  wait-saved.ps1
  wait-saved.ps1 -ProcessId 43432 -TimeoutSeconds 300
#>
param([int]$TimeoutSeconds = 900, [int]$ProcessId = 0)

$pbi = Join-Path $PSScriptRoot 'pbi.ps1'
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
    $raw = & $pbi status 2>$null | Out-String
    try {
        $status = $raw | ConvertFrom-Json
        $instances = @($status.instances)
        if ($ProcessId) { $instances = @($instances | Where-Object { $_.pid -eq $ProcessId }) }
        if ($instances.Count -gt 0 -and -not ($instances | Where-Object { $_.hasUnsavedChanges })) {
            Write-Output 'SAVED'
            exit 0
        }
    } catch { }   # the bridge can be busy for a moment while Desktop saves; try again
    Start-Sleep -Seconds 5
}
Write-Output 'TIMED OUT: Power BI Desktop still has unsaved changes'
exit 1
