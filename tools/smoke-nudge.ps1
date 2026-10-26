param([int]$Seconds = 30)

# Keeps Windows' "last input" clock fresh so powerMonitor.getSystemIdleTime() stays near 0.
# The smoke test needs real input during the focus window, otherwise idle-pause freezes the
# timer before the break ever fires and the away-during-break path is never exercised.
Add-Type -Path (Join-Path $PSScriptRoot 'win32-probe.cs')
$deadline = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $deadline) {
  [Win32]::Nudge()
  Start-Sleep -Milliseconds 1500
}
