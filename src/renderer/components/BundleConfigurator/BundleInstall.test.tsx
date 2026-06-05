import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BundleInstall from './BundleInstall';

function installElectron(installResult: { ok: true; bundleId: string; dir: string } | { ok: false; error: string }) {
  const install = jest.fn(async () => installResult);
  (window as unknown as { electron: unknown }).electron = {
    bundleConfig: { install },
    project: { selectDirectory: jest.fn(async () => '/picked/bundle') },
  };
  return install;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('BundleInstall', () => {
  it('installs a folder source and hands the new bundle id back', async () => {
    const install = installElectron({ ok: true, bundleId: 'cyberpunk_anime_pack', dir: '/u/cyberpunk_anime_pack' });
    const onInstalled = jest.fn();
    render(<BundleInstall onInstalled={onInstalled} />);

    fireEvent.change(screen.getByPlaceholderText('/path/to/bundle'), { target: { value: '/dl/pack' } });
    fireEvent.click(screen.getByText('Install bundle'));

    await waitFor(() => expect(install).toHaveBeenCalledWith({ kind: 'folder', path: '/dl/pack' }));
    await waitFor(() => expect(onInstalled).toHaveBeenCalledWith('cyberpunk_anime_pack'));
  });

  it('switches to git and installs from a URL', async () => {
    const install = installElectron({ ok: true, bundleId: 'b', dir: '/u/b' });
    render(<BundleInstall onInstalled={jest.fn()} />);

    fireEvent.click(screen.getByText('🌐 Git URL'));
    fireEvent.change(screen.getByPlaceholderText('https://github.com/author/bundle'), {
      target: { value: 'https://github.com/x/y' },
    });
    fireEvent.click(screen.getByText('Install bundle'));

    await waitFor(() => expect(install).toHaveBeenCalledWith({ kind: 'git', url: 'https://github.com/x/y' }));
  });

  it('surfaces an install error and does not call onInstalled', async () => {
    installElectron({ ok: false, error: 'invalid bundle: missing nodes' });
    const onInstalled = jest.fn();
    render(<BundleInstall onInstalled={onInstalled} />);

    fireEvent.change(screen.getByPlaceholderText('/path/to/bundle'), { target: { value: '/bad' } });
    fireEvent.click(screen.getByText('Install bundle'));

    expect(await screen.findByText(/invalid bundle: missing nodes/)).toBeTruthy();
    expect(onInstalled).not.toHaveBeenCalled();
  });
});
