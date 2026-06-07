<#
  Authenticate SimplySign Desktop (Certum cloud code signing) on a Windows CI
  runner. SimplySign Desktop is a TRAY app with no CLI login, so we generate
  the TOTP (SHA256 for the Certum seed) and drive its login window via Win32
  foregrounding + SendKeys, then wait for the cert to appear in the store.

  This revision (v2) fixes the "window activated: False" failure:
    - kills any auto-started tray instance first (winget auto-launches it),
    - relaunches fresh and ENUMERATES every top-level window (title/class/pid)
      so we can see what the login dialog is actually called,
    - force-foregrounds the SimplySign window via SetForegroundWindow,
    - screenshots BEFORE sending keys (uploaded as a CI artifact) for debugging.

  Env: CERTUM_OTP_URI, CERTUM_USERID, WIN_SIGN_SHA1, [CERTUM_EXE_PATH]
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

# ---- TOTP ----
$uri = [Uri]$OtpUri
$q = @{}
foreach($pair in $uri.Query.TrimStart('?').Split('&')){
  if([string]::IsNullOrEmpty($pair)){ continue }
  $i = $pair.IndexOf('='); if($i -ge 0){ $q[$pair.Substring(0,$i)] = [Uri]::UnescapeDataString($pair.Substring($i+1)) }
}
$digits = if($q.ContainsKey('digits')){ [int]$q['digits'] } else { 6 }
$period = if($q.ContainsKey('period')){ [int]$q['period'] } else { 30 }
$algo   = if($q.ContainsKey('algorithm')){ $q['algorithm'].ToUpperInvariant() } else { 'SHA1' }
$otp    = [TotpGen]::Code($q['secret'], $digits, $period, $algo)
Write-Host "[simplysign] generated $digits-digit $algo OTP for $UserId"

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

# ---- launch fresh + show what windows appear ----
Start-Process -FilePath $ExePath | Out-Null
Start-Sleep -Seconds 15
Dump-Windows 'after-launch'
Save-Screenshot (Join-Path (Get-Location) 'simplysign-prelogin.png')

# ---- find + foreground the login window, then type ----
$hwnd = [Win32]::FindByTitle(@('SimplySign','Logowanie','Login','Certum','Sign in'))
if($hwnd -ne [IntPtr]::Zero){
  Write-Host "[simplysign] found login window hwnd=$($hwnd.ToInt64())"
  [Win32]::ShowWindow($hwnd, 9) | Out-Null   # SW_RESTORE
  [Win32]::SetForegroundWindow($hwnd) | Out-Null
  Start-Sleep -Seconds 1
} else {
  Write-Host '[simplysign] WARNING: no login window found by title; sending keys to whatever is focused'
}

$wshell = New-Object -ComObject WScript.Shell
$wshell.SendKeys($UserId);  Start-Sleep -Milliseconds 700
$wshell.SendKeys('{TAB}');  Start-Sleep -Milliseconds 400
$wshell.SendKeys($otp);     Start-Sleep -Milliseconds 400
$wshell.SendKeys('{ENTER}')
Write-Host '[simplysign] credentials sent; waiting for cert to appear in store...'
Start-Sleep -Seconds 6

# ---- confirm cert landed ----
$ok = $false
for($i = 0; $i -lt 20; $i++){
  $hit = Get-ChildItem Cert:\CurrentUser\My,Cert:\LocalMachine\My -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $Thumb }
  if($hit){ $ok = $true; break }
  Start-Sleep -Seconds 3
}

if($ok){
  Write-Host "[simplysign] SUCCESS - cert $Thumb present in store."
  exit 0
} else {
  Write-Host "[simplysign] FAILED - cert $Thumb not in store after login."
  Dump-Windows 'after-login-attempt'
  Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue | Format-List Subject,Thumbprint | Out-String | Write-Host
  Save-Screenshot (Join-Path (Get-Location) 'simplysign-debug.png')
  exit 1
}
