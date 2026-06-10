<#
  Ensure a USABLE Certum SimplySign signing session on a Windows box with a real
  interactive desktop (SimplySign Desktop is a tray GUI with no CLI login).

  Probe-first design:
    1. PROBE — try a short, time-boxed test-sign with the target cert. If it
       succeeds, a session is already live (they last ~2h) — reuse it, no login.
       This avoids a needless login every build (each failed login risks tripping
       Certum's lockout/rate-limit).
    2. LOGIN — only if the probe fails: kill any tray instance, relaunch and
       REVEAL the (initially hidden) login window, foreground-VERIFY it (never
       SendKeys to the wrong window — that would leak the OTP), generate a FRESH
       OTP immediately before typing (a code minted seconds earlier can expire
       during the ~15s launch), submit ID {TAB} token {ENTER}.
    3. VERIFY — gate success on an ACTUAL time-boxed test-sign, NOT on the cert
       merely being in the store: after a session ends the cert object + its key
       association linger (HasPrivateKey still True) but signing HANGS on the dead
       virtual card. Presence != usable.

  The cert lives in CurrentUser\My, so signtool needs NO /sm (that would search
  LocalMachine and miss it). Test-signs omit /tr (no TSA) — we only prove the key
  is usable, not produce a keepable signature.

  Env: CERTUM_OTP_URI, CERTUM_USERID, WIN_SIGN_SHA1, [CERTUM_EXE_PATH], [SIGNTOOL_PATH]
  Graceful skip if creds absent (exit 0 -> unsigned build).
#>
param(
  [string]$OtpUri  = $env:CERTUM_OTP_URI,
  [string]$UserId  = $env:CERTUM_USERID,
  [string]$ExePath = $env:CERTUM_EXE_PATH,
  [string]$Thumb   = $env:WIN_SIGN_SHA1
)
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($OtpUri) -or [string]::IsNullOrWhiteSpace($UserId)) {
  Write-Host '[simplysign] CERTUM_OTP_URI / CERTUM_USERID not set - skipping login (unsigned build).'
  exit 0
}
if ([string]::IsNullOrWhiteSpace($Thumb)) {
  Write-Host '[simplysign] WIN_SIGN_SHA1 not set - cannot verify a signing session.'
  exit 1
}

# ---- algorithm-aware TOTP (Base32 secret + HMAC-SHA1/256/512) ----
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Security.Cryptography;
public static class TotpGen {
  static byte[] Base32(string s){
    s = s.TrimEnd('=').ToUpperInvariant();
    const string A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    int bits = 0, val = 0; var outp = new List<byte>();
    foreach(char c in s){
      int idx = A.IndexOf(c); if(idx < 0) continue;
      val = (val << 5) | idx; bits += 5;
      if(bits >= 8){ outp.Add((byte)((val >> (bits - 8)) & 0xFF)); bits -= 8; }
    }
    return outp.ToArray();
  }
  public static string Code(string secret, int digits, int period, string algo){
    byte[] key = Base32(secret);
    long ctr = (long)(DateTime.UtcNow - new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc)).TotalSeconds / period;
    byte[] msg = BitConverter.GetBytes(ctr);
    if(BitConverter.IsLittleEndian) Array.Reverse(msg);
    HMAC h;
    switch(algo){
      case "SHA256": h = new HMACSHA256(key); break;
      case "SHA512": h = new HMACSHA512(key); break;
      default:       h = new HMACSHA1(key);   break;
    }
    byte[] hash = h.ComputeHash(msg);
    int o = hash[hash.Length - 1] & 0x0f;
    int bin = ((hash[o] & 0x7f) << 24) | ((hash[o+1] & 0xff) << 16) | ((hash[o+2] & 0xff) << 8) | (hash[o+3] & 0xff);
    int code = bin % (int)Math.Pow(10, digits);
    return code.ToString().PadLeft(digits, '0');
  }
  // whole seconds remaining in the current TOTP window
  public static int Remaining(int period){
    long s = (long)(DateTime.UtcNow - new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc)).TotalSeconds;
    return (int)(period - (s % period));
  }
}
"@

# ---- Win32 window helpers (enumerate + foreground) ----
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class Win32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  // Reliable foreground steal: Windows blocks SetForegroundWindow from a background
  // process unless we (a) "press" ALT to clear the foreground lock, and (b) attach
  // our input queue to the current foreground thread for the duration of the call.
  public static bool ForceForeground(IntPtr hwnd){
    uint fgPid; uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out fgPid);
    uint cur = GetCurrentThreadId();
    keybd_event(0x12, 0, 0, UIntPtr.Zero);          // ALT down
    keybd_event(0x12, 0, 2, UIntPtr.Zero);          // ALT up (KEYEVENTF_KEYUP)
    bool attached = (fgThread != cur) && AttachThreadInput(cur, fgThread, true);
    ShowWindow(hwnd, 9);                             // SW_RESTORE
    BringWindowToTop(hwnd);
    SetForegroundWindow(hwnd);
    if (attached) AttachThreadInput(cur, fgThread, false);
    return GetForegroundWindow() == hwnd;
  }
  public static List<string> List(){
    var outp = new List<string>();
    EnumWindows((h,l)=>{
      if(!IsWindowVisible(h)) return true;
      var t = new StringBuilder(256); GetWindowText(h,t,256);
      var c = new StringBuilder(256); GetClassName(h,c,256);
      uint pid; GetWindowThreadProcessId(h, out pid);
      if(t.Length>0) outp.Add(h.ToInt64()+"|"+pid+"|"+c+"|"+t);
      return true;
    }, IntPtr.Zero);
    return outp;
  }
  public static IntPtr FindByTitle(string[] keys){
    IntPtr found = IntPtr.Zero;
    EnumWindows((h,l)=>{
      if(!IsWindowVisible(h)) return true;
      var t = new StringBuilder(256); GetWindowText(h,t,256);
      string title = t.ToString();
      foreach(var k in keys){ if(title.IndexOf(k, StringComparison.OrdinalIgnoreCase)>=0){ found=h; return false; } }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
function Save-Screenshot([string]$pathPng){
  try {
    $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $bmp.Save($pathPng, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Host "[simplysign] screenshot -> $pathPng"
  } catch { Write-Host "[simplysign] screenshot failed: $_" }
}
function Dump-Windows([string]$tag){
  Write-Host "[simplysign] --- visible top-level windows ($tag) ---"
  foreach($w in [Win32]::List()){ Write-Host "  $w" }
  Write-Host '[simplysign] --- end windows ---'
}

# ---- signtool resolution (honors SIGNTOOL_PATH; else SDK; else NuGet BuildTools) ----
function Resolve-Signtool {
  if ($env:SIGNTOOL_PATH -and (Test-Path $env:SIGNTOOL_PATH)) { return $env:SIGNTOOL_PATH }
  foreach($root in @('C:\Program Files (x86)\Windows Kits\10\bin','C:\Program Files\Windows Kits\10\bin')){
    if(-not (Test-Path $root)){ continue }
    $c = Get-ChildItem $root -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue | Where-Object FullName -like '*x64*' | Select-Object -Last 1 -ExpandProperty FullName
    if($c){ return $c }
  }
  Get-ChildItem 'C:\Users\*\tools\winsdk-buildtools' -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue | Where-Object FullName -like '*x64*' | Select-Object -Last 1 -ExpandProperty FullName
}

# ---- time-boxed test-sign: 'ok' (signed), 'fail' (signtool errored fast,
#      e.g. no usable cert), or 'hang' (timed out -> killed; dead session). ----
function Test-Signable([string]$signtool, [string]$thumb, [int]$timeoutMs){
  $probe = Join-Path $env:TEMP ("simplysign-probe-{0}-{1}.exe" -f $PID, (Get-Random))
  Copy-Item (Join-Path $env:WINDIR 'System32\where.exe') $probe -Force
  $stArgs = @('sign','/sha1',$thumb,'/fd','sha256','/q',$probe)
  $p = Start-Process -FilePath $signtool -ArgumentList $stArgs -PassThru -WindowStyle Hidden
  if(-not $p.WaitForExit($timeoutMs)){
    try { $p.Kill() } catch {}
    Get-Process signtool -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Remove-Item $probe -ErrorAction SilentlyContinue
    return 'hang'
  }
  $code = $p.ExitCode
  Remove-Item $probe -ErrorAction SilentlyContinue
  if($code -eq 0){ return 'ok' } else { return 'fail' }
}

$signtool = Resolve-Signtool
if(-not $signtool){
  Write-Host '[simplysign] FAILED - signtool.exe not found (set SIGNTOOL_PATH or install the Windows SDK / BuildTools).'
  exit 1
}
Write-Host "[simplysign] signtool: $signtool"

# ---- PROBE: reuse an already-live session if one exists (no login) ----
# 20s is ample: a live session signs in ~2-3s (no /tr); a dead one hangs.
$probeResult = Test-Signable $signtool $Thumb 20000
if($probeResult -eq 'ok'){
  Write-Host "[simplysign] SUCCESS - existing session is live and usable (test-sign passed); skipping login."
  exit 0
}
Write-Host "[simplysign] no usable session (probe=$probeResult); driving a fresh login."

# ---- parse OTP params (the code itself is generated later, right before typing) ----
$uri = [Uri]$OtpUri
$q = @{}
foreach($pair in $uri.Query.TrimStart('?').Split('&')){
  if([string]::IsNullOrEmpty($pair)){ continue }
  $i = $pair.IndexOf('='); if($i -ge 0){ $q[$pair.Substring(0,$i)] = [Uri]::UnescapeDataString($pair.Substring($i+1)) }
}
$secret = $q['secret']
$digits = if($q.ContainsKey('digits')){ [int]$q['digits'] } else { 6 }
$period = if($q.ContainsKey('period')){ [int]$q['period'] } else { 30 }
$algo   = if($q.ContainsKey('algorithm')){ $q['algorithm'].ToUpperInvariant() } else { 'SHA1' }

# ---- locate exe ----
if([string]::IsNullOrWhiteSpace($ExePath) -or -not (Test-Path $ExePath)){
  $found = Get-ChildItem -Path 'C:\Program Files','C:\Program Files (x86)' -Recurse -Filter 'SimplySignDesktop.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if($found){ $ExePath = $found.FullName }
}
if([string]::IsNullOrWhiteSpace($ExePath) -or -not (Test-Path $ExePath)){ throw '[simplysign] SimplySignDesktop.exe not found' }
Write-Host "[simplysign] exe: $ExePath"

# ---- kill any auto-started (tray) instance so we get a fresh login window ----
Get-Process -Name 'SimplySignDesktop' -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "[simplysign] stopping existing pid $($_.Id)"; Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3

# ---- launch + REVEAL the login window ----
# SimplySign Desktop (v7.x) launches straight to the system tray with its main
# window HIDDEN, so EnumWindows (IsWindowVisible filter) never sees it. Launching
# a SECOND time signals the running singleton to surface its window. We then drive
# it by its real MainWindowHandle (FindByTitle alone misses a hidden window).
Start-Process -FilePath $ExePath | Out-Null
Start-Sleep -Seconds 10
Start-Process -FilePath $ExePath | Out-Null   # 2nd launch -> reveal main window
Start-Sleep -Seconds 6
Dump-Windows 'after-launch'
Save-Screenshot (Join-Path (Get-Location) 'simplysign-prelogin.png')

# ---- resolve the login window handle (prefer the process MainWindowHandle) ----
$proc = Get-Process -Name 'SimplySignDesktop' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
$hwnd = if ($proc) { $proc.MainWindowHandle } else { [Win32]::FindByTitle(@('SimplySign','Logowanie','Login','Certum','Sign in')) }
if ($hwnd -eq [IntPtr]::Zero) {
  Write-Host '[simplysign] FAILED - no SimplySign login window found to focus.'
  Dump-Windows 'no-window'
  Save-Screenshot (Join-Path (Get-Location) 'simplysign-debug.png')
  exit 1
}
Write-Host "[simplysign] login window hwnd=$($hwnd.ToInt64())"

# ---- foreground + VERIFY before typing (never SendKeys to the wrong window) ----
$fg = $false
for ($i = 0; $i -lt 10; $i++) {
  if ([Win32]::ForceForeground($hwnd)) { $fg = $true; break }
  Start-Sleep -Milliseconds 600
}
if (-not $fg) {
  Write-Host '[simplysign] FAILED - could not bring login window to foreground; NOT sending keys (avoids leaking the OTP into another window).'
  Save-Screenshot (Join-Path (Get-Location) 'simplysign-debug.png')
  exit 1
}

# ---- generate a FRESH OTP right before typing (avoid expiry during launch) ----
# If the current window is nearly over, wait for the next one so the typed code
# has comfortable validity (>= 18s) by the time SimplySign validates it.
$rem = [TotpGen]::Remaining($period)
if ($rem -lt 18) { Write-Host "[simplysign] OTP window has only ${rem}s left; waiting for the next one..."; Start-Sleep ($rem + 1) }
$otp = [TotpGen]::Code($secret, $digits, $period, $algo)
Write-Host "[simplysign] login window foregrounded; sending fresh $digits-digit $algo OTP (ID {TAB} token {ENTER})."

$wshell = New-Object -ComObject WScript.Shell
$wshell.SendKeys('^a');     Start-Sleep -Milliseconds 200   # clear ID field if pre-filled
$wshell.SendKeys('{DEL}');  Start-Sleep -Milliseconds 200
$wshell.SendKeys($UserId);  Start-Sleep -Milliseconds 700
$wshell.SendKeys('{TAB}');  Start-Sleep -Milliseconds 400
$wshell.SendKeys($otp);     Start-Sleep -Milliseconds 400
$wshell.SendKeys('{ENTER}')
Write-Host '[simplysign] credentials sent; waiting for cert to appear in store...'
Start-Sleep -Seconds 6

# ---- precondition: wait for the cert to appear (necessary, not sufficient) ----
$present = $false
for($i = 0; $i -lt 20; $i++){
  $hit = Get-ChildItem Cert:\CurrentUser\My,Cert:\LocalMachine\My -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $Thumb }
  if($hit){ $present = $true; break }
  Start-Sleep -Seconds 3
}
if(-not $present){
  Write-Host "[simplysign] FAILED - cert $Thumb not in store after login (check simplysign-debug.png for an 'Invalid user name or token' / lockout dialog)."
  Dump-Windows 'after-login-attempt'
  Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue | Format-List Subject,Thumbprint | Out-String | Write-Host
  Save-Screenshot (Join-Path (Get-Location) 'simplysign-debug.png')
  exit 1
}

# ---- VERIFY: real time-boxed test-sign (presence/HasPrivateKey lie) ----
$verify = Test-Signable $signtool $Thumb 60000
if($verify -eq 'ok'){
  Write-Host "[simplysign] SUCCESS - logged in and test-sign with cert $Thumb passed; session is live and usable."
  exit 0
} elseif($verify -eq 'hang'){
  Write-Host '[simplysign] FAILED - cert present but test-sign HUNG (>60s): session not usable (grant-access prompt or dead session).'
  Save-Screenshot (Join-Path (Get-Location) 'simplysign-debug.png')
  exit 1
} else {
  Write-Host '[simplysign] FAILED - test-sign errored after login: session not usable.'
  Save-Screenshot (Join-Path (Get-Location) 'simplysign-debug.png')
  exit 1
}
