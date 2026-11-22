param([string]$Installer, [string]$Destination)
$ErrorActionPreference = 'Stop'
# NSIS /D must be last and UNQUOTED, even when its value contains spaces.
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $Installer
$psi.Arguments = "/S /D=$Destination"
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$p = [System.Diagnostics.Process]::Start($psi)
$p.WaitForExit()
if ($p.ExitCode -ne 0) { throw "Installer exited $($p.ExitCode)" }
# Assisted NSIS can spawn a worker: parent exit alone is not completion evidence.
$until = (Get-Date).AddSeconds(120)
while ((Get-Date) -lt $until) {
  if ((Test-Path (Join-Path $Destination 'LoopForge.exe')) -and (Test-Path (Join-Path $Destination 'resources\app.asar'))) { exit 0 }
  Start-Sleep -Milliseconds 500
}
$names = if (Test-Path $Destination) { (Get-ChildItem $Destination -Name) -join ', ' } else { 'destination absent' }
throw "Installed executable did not appear: $names"
