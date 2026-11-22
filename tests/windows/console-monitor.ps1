param([string]$StopFile, [string]$OutputFile, [string]$PhaseFile)
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
  [StructLayout(LayoutKind.Sequential)] struct BasicInfo {
    public IntPtr reserved1, peb, reserved20, reserved21, uniquePid, parentPid;
  }
  public class Owner { public uint pid, parentPid; public string image; }
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, uint flags, StringBuilder path, ref uint size);
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int kind, ref BasicInfo info, int size, out int returned);
  public static Owner[] Owners(uint pid) {
    var list = new List<Owner>();
    for (int i=0; i<7 && pid!=0; i++) {
      var item = new Owner { pid=pid, image="exited-or-unavailable" };
      var h=OpenProcess(0x1000,false,pid);
      if(h!=IntPtr.Zero) try {
        var p=new StringBuilder(2048); uint n=2048;
        if(QueryFullProcessImageName(h,0,p,ref n)) item.image=System.IO.Path.GetFileName(p.ToString());
        var info=new BasicInfo(); int returned;
        if(NtQueryInformationProcess(h,0,ref info,Marshal.SizeOf(typeof(BasicInfo)),out returned)==0) item.parentPid=(uint)info.parentPid.ToInt64();
      } finally { CloseHandle(h); }
      list.Add(item); if(item.parentPid==pid) break; pid=item.parentPid;
    }
    return list.ToArray();
  }
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
$events = New-Object System.Collections.Generic.List[object]
Set-Content -Path ($OutputFile + '.ready') -Value 'ready'
while (!(Test-Path $StopFile)) {
  foreach ($entry in [VisibleConsoles]::Read()) {
    if ($baseline -notcontains $entry -and $seen.Add($entry)) {
      $phase=if($PhaseFile -and (Test-Path $PhaseFile)){ Get-Content $PhaseFile -Raw }else{'before first product launch'}
      # Read only process image basenames/ancestry, never console titles or command
      # lines: those can contain secrets. Capture at first sight before it exits.
      $events.Add([PSCustomObject]@{entry=$entry;firstSeenShanghai=[DateTimeOffset]::Now.ToOffset([TimeSpan]::FromHours(8)).ToString('o');phase=$phase.Trim();owners=@([VisibleConsoles]::Owners([uint32]($entry.Split(':')[0])))})
    }
  }
  Start-Sleep -Milliseconds 20
}
ConvertTo-Json -InputObject @($seen | ForEach-Object { $_ }) | Set-Content -Path $OutputFile -Encoding UTF8

ConvertTo-Json -InputObject @($events | ForEach-Object { $_ }) -Depth 8 | Set-Content -Path ($OutputFile+'.events.json') -Encoding UTF8
