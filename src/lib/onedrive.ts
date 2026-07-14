// ---------------------------------------------------------------------------
// OneDrive sync client. All OAuth2/Graph work happens in Rust
// (src-tauri/src/onedrive.rs); this module just persists tokens and routes
// pulled files through the caller-supplied write function (serializeDisk +
// the desktop bridge's saveFile — see useOneDrive.ts) so a sync can never
// race a manual edit's disk write.
// ---------------------------------------------------------------------------
import { invoke } from '@tauri-apps/api/core';

export interface OneDriveTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix ms
  account?: string | null;
}

interface PulledFile { path: string; name: string; content: string }

export interface SyncResult {
  pulled: PulledFile[];
  pushed: string[];
  conflicts: string[];
  new_tokens: OneDriveTokens | null;
}

const LS_KEY = 'valx-onedrive-tokens';

export const getTokens = (): OneDriveTokens | null => {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '') as OneDriveTokens; } catch { return null; }
};
export const setTokens = (t: OneDriveTokens): void => localStorage.setItem(LS_KEY, JSON.stringify(t));
export const clearTokens = (): void => localStorage.removeItem(LS_KEY);
export const isConnected = (): boolean => getTokens() !== null;
export const getAccount = (): string | null => getTokens()?.account || null;

export const connectOneDrive = (): Promise<OneDriveTokens> =>
  invoke<OneDriveTokens>('start_oauth').then((t) => { setTokens(t); return t; });

export const disconnectOneDrive = (): void => clearTokens();

export function syncOneDrive(root: string): Promise<SyncResult> {
  const tokens = getTokens();
  if (!tokens) return Promise.reject(new Error('Not connected to OneDrive'));
  return invoke<SyncResult>('sync_onedrive', {
    args: {
      root,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expires_at,
    },
  }).then((result) => {
    // Token refresh doesn't re-fetch the profile — carry the known account forward.
    if (result.new_tokens) setTokens({ ...result.new_tokens, account: tokens.account });
    return result;
  });
}
