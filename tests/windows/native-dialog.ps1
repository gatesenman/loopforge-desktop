param([int]$AppPid, [long]$MainWindowHandle, [string]$Evidence)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class OwnedPopup {
  [DllImport("user32.dll")] public static extern IntPtr GetLastActivePopup(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint kind);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
}
'@
$owner = [IntPtr]$MainWindowHandle
$buttonCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$until = (Get-Date).AddSeconds(40)
$diagnostic = @()
while ((Get-Date) -lt $until) {
  # Native dialogs may belong to Electron's dialog utility process, not main PID.
  # Follow the real owner HWND instead of scanning other applications or mocking.
  $popup = [OwnedPopup]::GetLastActivePopup($owner)
  if ($popup -eq $owner) { $popup = [OwnedPopup]::GetWindow($owner,6) }
  if ($popup -ne [IntPtr]::Zero -and $popup -ne $owner -and [OwnedPopup]::IsWindowVisible($popup)) {
    $window = [System.Windows.Automation.AutomationElement]::FromHandle($popup)
    $buttons = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
    $diagnostic=@{window=$window.Current.Name;processId=$window.Current.ProcessId;buttons=@($buttons | ForEach-Object {$_.Current.Name})}
    $rect=$window.Current.BoundingRectangle
    $bounds=New-Object Drawing.Rectangle([int]$rect.X,[int]$rect.Y,[int]$rect.Width,[int]$rect.Height)
    $bitmap=New-Object Drawing.Bitmap($bounds.Width,$bounds.Height)
    $graphics=[Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($bounds.Location,[Drawing.Point]::Empty,$bounds.Size)
    $bitmap.Save($Evidence)
    $graphics.Dispose();$bitmap.Dispose()
    foreach($button in $buttons) {
      if($button.Current.Name -like '*稍后再说*') {
        $invoke=$null
        if($button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$invoke)) {
          $invoke.Invoke()
          Write-Output 'Native Later command invoked through Windows UI Automation'
          exit 0
        }
      }
    }
    if($window.Current.Name -eq '安装编码 Agent CLI（可选）') {
      # TaskDialog command links are not always exposed as UIA Buttons. The real
      # titlebar Close is the supported cancel action; source cancelId=1 maps it
      # to Later. This is an actual native UI action, not dialog API replacement.
      $window.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Close()
      Write-Output 'Native dialog titlebar Close/Cancel (cancelId=1, Later) through Windows UI Automation'
      exit 0
    }
  }
  Start-Sleep -Milliseconds 250
}
$diagnostic | ConvertTo-Json -Depth 5 | Set-Content ($Evidence+'.controls.json') -Encoding utf8
throw 'Native optional CLI skip button did not appear in the owned popup'
