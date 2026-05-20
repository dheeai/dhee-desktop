import Store from 'electron-store';
import type { AccountInfo } from '../shared/settingsTypes';

interface AccountStore {
  account: AccountInfo | null;
}

const accountStore = new Store<AccountStore>({
  name: 'dhee-account',
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
  dheeWebsiteUrl: string,
): Promise<{
  status: 'ok' | 'expired' | 'error';
  balance: number | null;
  httpStatus?: number;
  errorMessage?: string;
}> {
  const account = getAccount();
  if (!account) return { status: 'error', balance: null };

  try {
    // eslint-disable-next-line compat/compat
    const res = await fetch(`${dheeWebsiteUrl}/api/credits/balance`, {
      headers: { Authorization: `Bearer ${account.token}` },
    });
    if (res.status === 401) {
      clearAccount();
      return { status: 'expired', balance: null, httpStatus: 401 };
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as null | {
        error?: unknown;
        message?: unknown;
      };
      const errorMessage =
        body && typeof body.message === 'string'
          ? body.message
          : body && typeof body.error === 'string'
            ? body.error
            : undefined;
      return {
        status: 'error',
        balance: null,
        httpStatus: res.status,
        ...(errorMessage ? { errorMessage } : {}),
      };
    }

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
    return { status: 'ok', balance, httpStatus: res.status };
  } catch {
    return { status: 'error', balance: null };
  }
}
