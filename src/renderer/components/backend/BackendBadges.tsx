/**
 * Three little pills — LLM / Comfy / VLM — each showing whether the
 * lane is hitting Kshana Cloud or running locally. Used in the
 * landing-screen sidebar AND the in-project StatusBar so the user
 * doesn't have to leave the project view to see what mode they're
 * running against.
 *
 * "Cloud" requires both: persisted backend = 'cloud' AND a signed-in
 * account. A stale 'cloud' setting with no account is effectively
 * local at runtime — show it as local so the badge matches what code
 * actually does.
 */
import { useEffect, useState } from 'react';
import { useAppSettings } from '../../contexts/AppSettingsContext';
import type { AccountInfo, BackendLane } from '../../../shared/settingsTypes';
import styles from './BackendBadges.module.scss';

interface BackendBadgesProps {
  /** Optional class to compose with the row container. */
  className?: string;
}

function Lane({ name, cloud, testid }: { name: string; cloud: boolean; testid: string }) {
  return (
    <span className={`${styles.badge} ${cloud ? styles.cloud : styles.local}`} data-testid={testid}>
      <span className={styles.dot} />
      <span className={styles.lane}>{name}</span>
      <span className={styles.state}>{cloud ? 'Cloud' : 'Local'}</span>
    </span>
  );
}

function isCloud(lane: BackendLane | undefined, account: AccountInfo | null): boolean {
  return lane === 'cloud' && !!account;
}

export default function BackendBadges({ className }: BackendBadgesProps) {
  const { settings } = useAppSettings();
  const [account, setAccount] = useState<AccountInfo | null>(null);

  useEffect(() => {
    const bridge = window.electron?.account;
    if (!bridge) {
      setAccount(null);
      return undefined;
    }
    bridge
      .get()
      .then(setAccount)
      .catch(() => setAccount(null));
    const unsubscribe = bridge.onChange(setAccount);
    return () => {
      unsubscribe();
    };
  }, []);

  const llmCloud = isCloud(settings?.llmBackend, account);
  const comfyCloud = isCloud(settings?.comfyBackend, account);
  const vlmCloud = isCloud(settings?.vlmBackend, account);

  const title = [
    `LLM: ${llmCloud ? 'Dhee Cloud' : 'Local'}`,
    `ComfyUI: ${comfyCloud ? 'Dhee Cloud' : 'Local'}`,
    `VLM: ${vlmCloud ? 'Dhee Cloud' : 'Local'}`,
  ].join(' · ');

  const rowClass = className ? `${styles.row} ${className}` : styles.row;

  return (
    <div className={rowClass} title={title}>
      <Lane name="LLM" cloud={llmCloud} testid="badge-llm" />
      <Lane name="Comfy" cloud={comfyCloud} testid="badge-comfy" />
      <Lane name="VLM" cloud={vlmCloud} testid="badge-vlm" />
    </div>
  );
}
