import { useCallback, useEffect, useState } from 'react';
import type { AccountInfo } from '../../../shared/settingsTypes';
import styles from './SettingsPanel.module.scss';

function getAccountBridge() {
  return (
    window.electron as typeof window.electron & {
      account?: typeof window.electron.account;
    }
  ).account;
}

export default function AccountTab() {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [billingUrl, setBillingUrl] = useState('');

  const loadAccount = useCallback(async () => {
    const accountBridge = getAccountBridge();
    if (!accountBridge) {
      setAccount(null);
      setLoading(false);
      return;
    }
    const info = await accountBridge.get();
    setAccount(info);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAccount();
    const accountBridge = getAccountBridge();
    if (!accountBridge) {
      return undefined;
    }
    accountBridge
      .getBillingUrl()
      .then(setBillingUrl)
      .catch(() => setBillingUrl(''));
    return accountBridge.onChange((info) => {
      setAccount(info);
      setLoading(false);
    });
  }, [loadAccount]);

  const handleSignIn = async () => {
    setRefreshError('');
    setSigningIn(true);
    try {
      await getAccountBridge()?.signIn();
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    setRefreshError('');
    await getAccountBridge()?.signOut();
    setAccount(null);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const result = await getAccountBridge()?.refreshBalance();
      await loadAccount();
      if (result?.status === 'expired') {
        setRefreshError(
          'Your desktop session expired. Sign in again to refresh credits.',
        );
        return;
      }
      if (result?.status === 'error') {
        setRefreshError(
          `Couldn’t refresh credits right now${result.httpStatus ? ` (HTTP ${result.httpStatus})` : ''}${result.errorMessage ? `: ${result.errorMessage}` : '.'}`,
        );
        return;
      }
      setRefreshError('');
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.sectionHeader}>
        <p>Loading account...</p>
      </div>
    );
  }

  if (!account) {
    return (
      <>
        <div className={styles.sectionHeader}>
          <h3>Kshana Account</h3>
          <p>Sign in to use Kshana Cloud credits through the desktop proxy.</p>
        </div>
        <div className={styles.infoCard}>
          <div className={styles.infoTitle}>Not signed in</div>
          <p className={styles.infoText}>
            Sign-in opens your browser, then returns here automatically.
          </p>
          {refreshError ? <p className={styles.error}>{refreshError}</p> : null}
          <button
            type="button"
            className={styles.submitButton}
            onClick={handleSignIn}
            disabled={signingIn}
          >
            {signingIn ? 'Opening Browser...' : 'Sign In'}
          </button>
        </div>
      </>
    );
  }

  const displayName = account.name || account.email;
  const initials = displayName
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const billingLabel = billingUrl
    ? billingUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
    : 'billing';

  return (
    <>
      <div className={styles.sectionHeader}>
        <h3>Kshana Account</h3>
        <p>Your signed-in user controls proxy credits for this desktop.</p>
      </div>

      <div className={styles.statusCard}>
        <div className={styles.statusTopRow}>
          <div className={styles.accountIdentity}>
            <div className={styles.accountAvatar}>{initials}</div>
            <div>
              {account.name ? (
                <div className={styles.accountName}>{account.name}</div>
              ) : null}
              <div className={styles.accountEmail}>{account.email}</div>
            </div>
          </div>
          <div className={`${styles.statusBadge} ${styles.statusBadgeSuccess}`}>
            <span className={styles.statusDot} />
            Signed in
          </div>
        </div>
      </div>

      <div className={styles.accountGrid}>
        <div className={styles.infoCard}>
          <div className={styles.infoTitle}>Plan</div>
          <p className={styles.infoText}>
            {account.planLabel || account.planId || 'Free'}
          </p>
        </div>
        <div className={styles.infoCard}>
          <div className={styles.infoTitle}>Subscription</div>
          <p className={styles.infoText}>
            {account.subscriptionStatus || 'active'}
          </p>
        </div>
      </div>

      <div className={styles.infoCard}>
        <div className={styles.accountBalanceRow}>
          <div>
            <div className={styles.infoTitle}>Credit Balance</div>
            <p className={styles.accountCredits}>
              {account.credits.toLocaleString()}
              <span> credits</span>
            </p>
          </div>
          <button
            type="button"
            className={styles.cancelButton}
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        <p className={styles.infoText}>
          Manage credits at{' '}
          <button
            type="button"
            className={styles.inlineButton}
            onClick={() => getAccountBridge()?.openBilling()}
          >
            {billingLabel}
          </button>
          .
        </p>
        {refreshError ? <p className={styles.error}>{refreshError}</p> : null}
      </div>

      <div className={styles.actionsInline}>
        <button
          type="button"
          className={styles.cancelButton}
          onClick={handleSignOut}
        >
          Sign Out
        </button>
      </div>
    </>
  );
}
