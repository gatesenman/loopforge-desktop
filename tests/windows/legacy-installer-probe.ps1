$ErrorActionPreference = 'Stop'
$base = Join-Path $env:RUNNER_TEMP 'lf-installer-probe'
New-Item $base -ItemType Directory | Out-Null
$out = Join-Path $env:GITHUB_WORKSPACE '.legacy-installer-evidence'
New-Item $out -ItemType Directory | Out-Null
$setup = Join-Path $base 'Setup.exe'
Invoke-WebRequest 'https://github.com/gatesenman/loopforge-desktop/releases/download/v0.4.0/LoopForge-Setup-0.4.0.exe' -OutFile $setup
if ((Get-FileHash $setup -Algorithm SHA256).Hash.ToLower() -ne 'cf6cc71b2141aa59d0aaaef5b888d9c717ebfae021aefa6bda6ead0f85aa54fd') { throw 'Hash mismatch' }
$started = Get-Date
$results = @()
foreach ($variant in @(@{name='simple';args="/S /D=$base\App"},@{name='spaces';args="/S /D=$base\App With Spaces"},@{name='interactive-start';args=''})) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $setup; $psi.Arguments = $variant.args; $psi.UseShellExecute = $false
  $p = [Diagnostics.Process]::Start($psi)
  if ($variant.name -eq 'interactive-start') {
    Start-Sleep -Seconds 5
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName UIAutomationClient
    $p.Refresh()
    $window=[System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
    $rect=$window.Current.BoundingRectangle
    $bounds=New-Object Drawing.Rectangle([int]$rect.X,[int]$rect.Y,[int]$rect.Width,[int]$rect.Height)
    $bitmap=New-Object Drawing.Bitmap($bounds.Width,$bounds.Height)
    $graphics=[Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($bounds.Location,[Drawing.Point]::Empty,$bounds.Size)
    $bitmap.Save((Join-Path $out 'legacy-interactive-start.png'))
    $graphics.Dispose();$bitmap.Dispose()
    $alive = !$p.HasExited
    if ($alive) { Stop-Process -Id $p.Id -Force }
    $results += @{variant=$variant.name;aliveBeforeStop=$alive}
  } else {
    $exited = $p.WaitForExit(120000)
    if (!$exited) { Stop-Process -Id $p.Id -Force }
    $results += @{variant=$variant.name;exited=$exited;exitCode=if($exited){$p.ExitCode}else{'timeout'}}
  }
}
$events = @(Get-WinEvent -FilterHashtable @{LogName='Application';Id=1000;StartTime=$started} -ErrorAction SilentlyContinue | Where-Object {$_.Message -like '*Setup.exe*'} | ForEach-Object {$_.Message})
@{os=[Environment]::OSVersion.VersionString;results=$results;events=$events} | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $out 'result.json') -Encoding utf8
