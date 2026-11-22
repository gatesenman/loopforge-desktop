param([int]$AppPid, [string]$Evidence)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$until = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $until) {
  $processCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $AppPid)
  $buttonCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
  # Prune unrelated windows before descending: never scan the runner host terminal.
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $processCondition)
  $buttons = @($windows | ForEach-Object { $_.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition) })
  foreach ($button in $buttons) {
    if ($button.Current.Name -eq '稍后再说') {
      # Capture only the real dialog, never the runner desktop/host console.
      $node = $button
      $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
      while ($node -and $node.Current.ControlType -ne [System.Windows.Automation.ControlType]::Window) { $node = $walker.GetParent($node) }
      if (!$node) { throw 'Native dialog window ancestor missing' }
      $rect = $node.Current.BoundingRectangle
      $bounds = New-Object System.Drawing.Rectangle([int]$rect.X,[int]$rect.Y,[int]$rect.Width,[int]$rect.Height)
      $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
      $bitmap.Save($Evidence)
      $graphics.Dispose(); $bitmap.Dispose()
      $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
      Write-Output 'Native optional CLI dialog skipped through Windows UI Automation'
      exit 0
    }
  }
  Start-Sleep -Milliseconds 250
}
throw 'Native optional CLI skip button did not appear'
