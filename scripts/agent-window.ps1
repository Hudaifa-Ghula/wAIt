[CmdletBinding()]
param([ValidateSet('capture','focus')][string]$Mode,[ValidateSet('codex','antigravity')][string]$Provider,[long]$WindowHandle=0,[int]$ProcessId=0,[string]$Started='')
$ErrorActionPreference='Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WaitWindow {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hwnd,int command);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
}
"@
$waitName=if($Provider -eq 'codex'){'Codex'}else{'Antigravity'}
if($Mode -eq 'capture') {
  $waitHandle=[WaitWindow]::GetForegroundWindow()
  [uint32]$waitPid=0
  [void][WaitWindow]::GetWindowThreadProcessId($waitHandle,[ref]$waitPid)
  $waitProcess=Get-Process -Id $waitPid -ErrorAction SilentlyContinue
  if(-not $waitProcess -or $waitProcess.ProcessName -ine $waitName) {
    $waitCandidates=@(Get-Process -Name $waitName -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowHandle -ne 0})
    if($waitCandidates.Count -ne 1){throw 'Could not identify the originating agent window.'}
    $waitProcess=$waitCandidates[0];$waitHandle=$waitProcess.MainWindowHandle
  }
  @{windowHandle=$waitHandle.ToInt64();processId=$waitProcess.Id;started=$waitProcess.StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress
} else {
  $waitProcess=Get-Process -Id $ProcessId -ErrorAction Stop
  if($waitProcess.ProcessName -ine $waitName -or $waitProcess.StartTime.ToUniversalTime().ToString('o') -ne $Started -or -not [WaitWindow]::IsWindow([IntPtr]$WindowHandle)){throw 'The originating agent window is no longer available.'}
  [uint32]$waitActualPid=0
  [void][WaitWindow]::GetWindowThreadProcessId([IntPtr]$WindowHandle,[ref]$waitActualPid)
  if($waitActualPid -ne $ProcessId){throw 'The window now belongs to a different process.'}
  [void][WaitWindow]::ShowWindowAsync([IntPtr]$WindowHandle,9)
  if(-not [WaitWindow]::SetForegroundWindow([IntPtr]$WindowHandle)){throw 'Windows declined foreground activation. Select the agent window manually.'}
}
