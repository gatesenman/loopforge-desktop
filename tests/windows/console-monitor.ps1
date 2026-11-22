param([string]$StopFile, [string]$OutputFile)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class VisibleConsoles {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr x);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static string[] Read() {
    var result = new List<string>();
    EnumWindows((h,p) => {
      if (IsWindowVisible(h)) {
        var s = new StringBuilder(256); GetClassName(h,s,256);
        if (s.ToString()=="ConsoleWindowClass" || s.ToString()=="CASCADIA_HOSTING_WINDOW_CLASS") {
          uint pid; GetWindowThreadProcessId(h,out pid); result.Add(pid+":"+s.ToString());
        }
      }
      return true;
    }, IntPtr.Zero);
    return result.ToArray();
  }
}
'@
$baseline = @([VisibleConsoles]::Read())
$seen = New-Object 'System.Collections.Generic.HashSet[string]'
Set-Content -Path ($OutputFile + '.ready') -Value 'ready'
while (!(Test-Path $StopFile)) {
  foreach ($entry in [VisibleConsoles]::Read()) { if ($baseline -notcontains $entry) { [void]$seen.Add($entry) } }
  Start-Sleep -Milliseconds 20
}
ConvertTo-Json -InputObject @($seen | ForEach-Object { $_ }) | Set-Content -Path $OutputFile -Encoding UTF8
