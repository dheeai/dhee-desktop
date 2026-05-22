import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
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
  const [authStatus, setAuthStatus] = useState<
    'idle' | 'waiting' | 'expired' | 'error'
  >('idle');
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
    await accountBridge
      .getAuthStatus()
      .then(setAuthStatus)
      .catch(() => setAuthStatus('idle'));
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
    const unsubscribeAccount = accountBridge.onChange((info) => {
      setAccount(info);
      setLoading(false);
    });
    const unsubscribeStatus = accountBridge.onAuthStatusChange(setAuthStatus);
    return () => {
      unsubscribeAccount();
      unsubscribeStatus();
    };
  }, [loadAccount]);

  const handleSignIn = async () => {
    setRefreshError('');
    setSigningIn(true);
    setAuthStatus('waiting');
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
        setAuthStatus('expired');
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
    const isWaiting = authStatus === 'waiting' || signingIn;
    let emptyTitle = 'Not signed in';
    let emptyText =
      'Sign-in opens your browser, then returns here automatically.';
    let emptyCardStatusClass = '';

    if (authStatus === 'expired') {
      emptyTitle = 'Desktop session expired';
      emptyText =
        'Sign in again to reconnect Dhee Cloud credits. Your local projects are still available.';
      emptyCardStatusClass = styles.statusCardWarning;
    } else if (isWaiting) {
      emptyTitle = 'Waiting for browser';
      emptyText =
        'Finish sign-in in your browser. If Chrome asks, choose Open Dhee Studio.';
      emptyCardStatusClass = styles.statusCard;
    }

    return (
      <>
        <div className={styles.sectionHeader}>
          <h3>Dhee Account</h3>
          <p>Sign in to use Dhee Cloud credits through the desktop proxy.</p>
        </div>
        <div className={`${styles.infoCard} ${emptyCardStatusClass}`}>
          <div className={styles.statusTopRow}>
            <div>
              <div className={styles.infoTitle}>{emptyTitle}</div>
              <p className={styles.infoText}>{emptyText}</p>
            </div>
            {isWaiting ? (
              <div
                className={`${styles.statusBadge} ${styles.statusBadgeWarning}`}
              >
                <span className={styles.statusDot} />
                Connecting
              </div>
            ) : null}
          </div>
          {refreshError ? <p className={styles.error}>{refreshError}</p> : null}
          <button
            type="button"
            className={styles.submitButton}
            onClick={handleSignIn}
            disabled={signingIn}
          >
            {isWaiting ? 'Open Browser Again' : 'Sign In'}
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

  return (
    <>
      <div className={styles.sectionHeader}>
        <h3>Dhee Account</h3>
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
        <div className={styles.creditsCardHeader}>
          <div className={styles.infoTitle}>Credit Balance</div>
          <button
            type="button"
            className={styles.cancelButton}
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw size={16} className={styles.refreshIcon} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <div className={styles.creditsValueRow}>
          <span className={styles.creditsNumber}>
            {account.credits.toLocaleString()}
          </span>
          <span className={styles.creditsUnit}>credits remaining</span>
        </div>

        {refreshError ? <p className={styles.error}>{refreshError}</p> : null}

        <div className={styles.creditsFooterRow}>
          <div className={styles.creditsFooterLabel}>Manage credits and billing</div>
          <button
            type="button"
            className={styles.creditsFooterAction}
            onClick={() => getAccountBridge()?.openBilling()}
          >
            Open
            <ExternalLink size={14} className={styles.creditsFooterIcon} />
          </button>
        </div>
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
