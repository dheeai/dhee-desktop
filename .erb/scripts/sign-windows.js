/**
 * electron-builder custom Windows signing hook — Certum SimplySign cloud cert.
 *
 * The private key lives in Certum's cloud HSM and is exposed to Windows as a
 * virtual smart card by SimplySign Desktop (authenticated earlier in CI by
 * .erb/scripts/simplysign-login.ps1). There is NO .pfx/.p12 to point at — we
 * sign by selecting the cert from the Windows store by its SHA1 thumbprint.
 *
 * Graceful skip: when WIN_SIGN_SHA1 is unset (local dev, or CI without the
 * SimplySign secrets) we skip signing rather than fail the build — same
 * contract as the macOS path (missing creds => unsigned, no error).
 *
 * electron-builder invokes this once per file it wants signed (the app .exe
 * and the NSIS installer).
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function findSigntool() {
  if (process.env.SIGNTOOL_PATH && fs.existsSync(process.env.SIGNTOOL_PATH)) {
    return process.env.SIGNTOOL_PATH;
  }
  const roots = [
    'C:/Program Files (x86)/Windows Kits/10/bin',
    'C:/Program Files/Windows Kits/10/bin',
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const versioned = fs
      .readdirSync(root)
      .filter((d) => /^\d/.test(d))
      .sort()
      .reverse();
    for (const v of versioned) {
      const cand = path.join(root, v, 'x64', 'signtool.exe');
      if (fs.existsSync(cand)) return cand;
    }
    const flat = path.join(root, 'x64', 'signtool.exe');
    if (fs.existsSync(flat)) return flat;
  }
  throw new Error('[sign-windows] signtool.exe not found in any Windows SDK location');
}

exports.default = async function signWindows(configuration) {
  const file = configuration.path;
  const sha1 = (process.env.WIN_SIGN_SHA1 || '').trim();
  if (!sha1) {
    console.warn(
      `[sign-windows] WIN_SIGN_SHA1 unset — skipping signing of ${path.basename(file)} (unsigned build).`,
    );
    return;
  }
  const signtool = findSigntool();
  const tsa = process.env.WIN_SIGN_TSA || 'http://time.certum.pl';
  console.log(`[sign-windows] signing ${path.basename(file)} (cert ${sha1}) via ${signtool}`);
  // /sha1 selects the SimplySign virtual-smart-card cert from the store;
  // /tr + /td add an RFC-3161 SHA-256 timestamp (Certum's TSA) so signatures
  // stay valid after the cert expires.
  execFileSync(
    signtool,
    ['sign', '/sha1', sha1, '/fd', 'sha256', '/tr', tsa, '/td', 'sha256', '/v', file],
    { stdio: 'inherit' },
  );
};
