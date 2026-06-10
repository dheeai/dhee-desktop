/**
 * BundleInstall — import a community bundle (folder or git URL) via
 * dhee-core installBundle, then hand the new bundle id back so the host
 * can select it and run the SAME Bundle Configurator first-run uses.
 */
import { useState } from 'react';
import type { BundleInstallSource } from '../../../shared/bundleConfigTypes';
import { Button, Input, SegmentedControl, Card } from '../ui';
import styles from './BundleInstall.module.scss';

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
    <Card className={styles.wrap}>
      <SegmentedControl
        aria-label="Bundle source"
        value={kind}
        onChange={(v) => setKind(v as 'folder' | 'git')}
        options={[
          { value: 'folder', label: '📁 Folder' },
          { value: 'git', label: '🌐 Git URL' },
        ]}
      />
      {kind === 'folder' ? (
        <div className={styles.row}>
          <Input mono style={{ flex: 1 }} value={folder} placeholder="/path/to/bundle" onChange={(e) => setFolder(e.target.value)} />
          <Button variant="secondary" size="sm" onClick={() => void pickFolder()}>
            Browse…
          </Button>
        </div>
      ) : (
        <Input
          mono
          value={gitUrl}
          placeholder="https://github.com/author/bundle"
          onChange={(e) => setGitUrl(e.target.value)}
        />
      )}
      <div className={styles.actions}>
        <Button variant="primary" onClick={() => void install()} disabled={busy}>
          {busy ? 'Installing…' : 'Install bundle'}
        </Button>
        {error && <span className={styles.error}>{error}</span>}
      </div>
    </Card>
  );
}
