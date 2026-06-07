<#
  Authenticate SimplySign Desktop (Certum cloud code signing) non-interactively
  on a Windows CI runner.

  SimplySign Desktop has no CLI login — it's a GUI app that takes a user id +
  a TOTP one-time code, then exposes the cloud certificate to Windows as a
  virtual smart card (session lasts ~2h). So we:
    1. generate the current TOTP from CERTUM_OTP_URI (algorithm-aware: the
       Certum seed is SHA256, not the usual SHA1),
    2. launch SimplySign Desktop and drive its login window via SendKeys,
    3. wait for the code-signing cert (WIN_SIGN_SHA1) to appear in the store.

  Env:
    CERTUM_OTP_URI  otpauth:// URI (Base32 secret + algorithm/digits/period)
    CERTUM_USERID   SimplySign account email
    WIN_SIGN_SHA1   expected cert thumbprint (to confirm login succeeded)
    CERTUM_EXE_PATH optional explicit path to SimplySignDesktop.exe

  Graceful skip: if the credentials are absent, exit 0 (build stays unsigned).
  A debug screenshot is written to simplysign-debug.png on failure so the GUI
  state can be inspected from the uploaded CI artifact.
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

# ---- parse otpauth:// URI (IndexOf split avoids .Split overload ambiguity) ----
$uri = [Uri]$OtpUri
$q = @{}
foreach($pair in $uri.Query.TrimStart('?').Split('&')){
  if([string]::IsNullOrEmpty($pair)){ continue }
  $i = $pair.IndexOf('=')
  if($i -ge 0){ $q[$pair.Substring(0,$i)] = [Uri]::UnescapeDataString($pair.Substring($i+1)) }
}
$secret = $q['secret']
$digits = if($q.ContainsKey('digits')){ [int]$q['digits'] } else { 6 }
$period = if($q.ContainsKey('period')){ [int]$q['period'] } else { 30 }
$algo   = if($q.ContainsKey('algorithm')){ $q['algorithm'].ToUpperInvariant() } else { 'SHA1' }
$otp    = [TotpGen]::Code($secret, $digits, $period, $algo)
Write-Host "[simplysign] generated $digits-digit $algo OTP for $UserId"

# ---- locate SimplySign Desktop ----
if([string]::IsNullOrWhiteSpace($ExePath) -or -not (Test-Path $ExePath)){
  $found = Get-ChildItem -Path 'C:\Program Files','C:\Program Files (x86)' -Recurse -Filter 'SimplySignDesktop.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if($found){ $ExePath = $found.FullName }
}
if([string]::IsNullOrWhiteSpace($ExePath) -or -not (Test-Path $ExePath)){
  throw '[simplysign] SimplySignDesktop.exe not found - is SimplySign Desktop installed?'
}
Write-Host "[simplysign] exe: $ExePath"

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

# ---- launch + drive the GUI login ----
$proc = Start-Process -FilePath $ExePath -PassThru
Start-Sleep -Seconds 10
$wshell = New-Object -ComObject WScript.Shell
$activated = $false
for($i = 0; $i -lt 12; $i++){
  if($wshell.AppActivate($proc.Id)){ $activated = $true; break }
  Start-Sleep -Milliseconds 500
}
Write-Host "[simplysign] window activated: $activated"
Start-Sleep -Seconds 1

# Login window: user id field, then OTP field. TAB between, ENTER to submit.
$wshell.SendKeys($UserId);  Start-Sleep -Milliseconds 600
$wshell.SendKeys('{TAB}');  Start-Sleep -Milliseconds 400
$wshell.SendKeys($otp);     Start-Sleep -Milliseconds 400
$wshell.SendKeys('{ENTER}')
Write-Host '[simplysign] credentials sent; waiting for cert to appear in store...'
Start-Sleep -Seconds 6

# ---- confirm the cert landed in the store ----
$ok = $false
for($i = 0; $i -lt 20; $i++){
  $hit = Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $Thumb }
  if(-not $hit){ $hit = Get-ChildItem Cert:\LocalMachine\My -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $Thumb } }
  if($hit){ $ok = $true; break }
  Start-Sleep -Seconds 3
}

if($ok){
  Write-Host "[simplysign] SUCCESS - cert $Thumb present in store; signtool can sign."
  exit 0
} else {
  Write-Host "[simplysign] FAILED - cert $Thumb not in store after login."
  Write-Host '[simplysign] certs currently in CurrentUser\My:'
  Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue | Format-List Subject, Thumbprint | Out-String | Write-Host
  Save-Screenshot (Join-Path (Get-Location) 'simplysign-debug.png')
  exit 1
}
