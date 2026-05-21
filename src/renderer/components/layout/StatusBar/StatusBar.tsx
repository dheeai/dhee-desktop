import { useEffect, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import BackendBadges from '../../backend/BackendBadges';
import styles from './StatusBar.module.scss';

const FALLBACK_APP_VERSION = 'v?.?.?';

export default function StatusBar() {
  const [appVersion, setAppVersion] = useState<string>(FALLBACK_APP_VERSION);

  useEffect(() => {
    let isMounted = true;
    const getVersion = window.electron?.app?.getVersion;
    if (!getVersion) {
      return () => {
        isMounted = false;
      };
    }

    getVersion()
      .then((version) => {
        if (!isMounted) return;
        setAppVersion(version ? `v${version}` : FALLBACK_APP_VERSION);
      })
      .catch(() => {
        if (!isMounted) return;
        setAppVersion(FALLBACK_APP_VERSION);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <footer className={styles.container}>
      <div className={styles.left}>
        <BackendBadges />
      </div>
      <div className={styles.right}>
        <span className={styles.version}>{appVersion}</span>
        <button type="button" className={styles.iconButton} title="Help">
          <HelpCircle size={14} />
        </button>
      </div>
    </footer>
  );
}
