/**
 * BundleInstall — import a community bundle (folder or git URL) via
 * dhee-core installBundle, then hand the new bundle id back so the host
 * can select it and run the SAME Bundle Configurator first-run uses.
 * That convergence is the point: install and first-run share the
 * configure step.
 */
import { useState } from 'react';
import type { BundleInstallSource } from '../../../shared/bundleConfigTypes';

const wrap: React.CSSProperties = {
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 10,
  background: 'var(--color-bg-panel)',
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};
const seg: React.CSSProperties = { display: 'flex', gap: 8 };
const tabBtn = (sel: boolean): React.CSSProperties => ({
  font: 'inherit',
  fontSize: 12.5,
  cursor: 'pointer',
  padding: '7px 13px',
  borderRadius: 6,
  border: `1px solid ${sel ? 'var(--color-accent-primary)' : 'var(--color-border-strong)'}`,
  background: sel ? 'rgba(95,136,178,0.16)' : 'var(--color-bg-panel-inset)',
  color: sel ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
});
const input: React.CSSProperties = {
  flex: 1,
  font: 'inherit',
  fontSize: 13,
  fontFamily: 'var(--font-mono, monospace)',
  color: 'var(--color-text-primary)',
  background: 'var(--color-bg-panel-inset)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: 6,
  padding: '9px 11px',
};
const primary: React.CSSProperties = {
  font: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  color: '#0c0e11',
  background: 'var(--color-accent-primary)',
  border: 0,
  borderRadius: 6,
  padding: '9px 16px',
};

export default function BundleInstall({ onInstalled }: { onInstalled: (bundleId: string) => void }) {
  const [kind, setKind] = useState<'folder' | 'git'>('folder');
  const [folder, setFolder] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickFolder = async () => {
    try {
      const dir = await window.electron.project.selectDirectory();
      if (dir) setFolder(dir);
    } catch {
      /* cancelled */
    }
  };

  const install = async () => {
    const source: BundleInstallSource =
      kind === 'folder' ? { kind: 'folder', path: folder.trim() } : { kind: 'git', url: gitUrl.trim() };
    if ((kind === 'folder' && !folder.trim()) || (kind === 'git' && !gitUrl.trim())) return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.electron.bundleConfig.install(source);
      if (res.ok) {
        onInstalled(res.bundleId);
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={wrap}>
      <div style={seg}>
        <button type="button" style={tabBtn(kind === 'folder')} onClick={() => setKind('folder')}>
          📁 Folder
        </button>
        <button type="button" style={tabBtn(kind === 'git')} onClick={() => setKind('git')}>
          🌐 Git URL
        </button>
      </div>
      {kind === 'folder' ? (
        <div style={seg}>
          <input style={input} value={folder} placeholder="/path/to/bundle" onChange={(e) => setFolder(e.target.value)} />
          <button type="button" style={tabBtn(false)} onClick={() => void pickFolder()}>
            Browse…
          </button>
        </div>
      ) : (
        <input
          style={input}
          value={gitUrl}
          placeholder="https://github.com/author/bundle"
          onChange={(e) => setGitUrl(e.target.value)}
        />
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" style={{ ...primary, opacity: busy ? 0.5 : 1 }} onClick={() => void install()} disabled={busy}>
          {busy ? 'Installing…' : 'Install bundle'}
        </button>
        {error && <span style={{ color: 'var(--color-error)', fontSize: 12 }}>{error}</span>}
      </div>
    </div>
  );
}
