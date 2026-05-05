import Store from 'electron-store';
import type { AccountInfo } from '../shared/settingsTypes';

interface AccountStore {
  account: AccountInfo | null;
}

const accountStore = new Store<AccountStore>({
  name: 'kshana-account',
  defaults: {
    account: null,
  },
});

export function getAccount(): AccountInfo | null {
  return accountStore.get('account', null) ?? null;
}

export function setAccount(info: AccountInfo): void {
  accountStore.set('account', info);
}

export function clearAccount(): void {
  accountStore.set('account', null);
}

export async function refreshBalance(
  kshanaWebsiteUrl: string,
): Promise<number | null> {
  const account = getAccount();
  if (!account) return null;

  try {
    // eslint-disable-next-line compat/compat
    const res = await fetch(`${kshanaWebsiteUrl}/api/credits/balance`, {
      headers: { Authorization: `Bearer ${account.token}` },
    });
    if (res.status === 401) {
      clearAccount();
      return null;
    }
    if (!res.ok) return null;

    const { balance, planId, planLabel, subscriptionStatus } =
      (await res.json()) as {
        balance: number;
        planId?: string;
        planLabel?: string;
        subscriptionStatus?: string;
      };

    setAccount({
      ...account,
      credits: balance,
      planId,
      planLabel,
      subscriptionStatus,
    });
    return balance;
  } catch {
    return null;
  }
}
