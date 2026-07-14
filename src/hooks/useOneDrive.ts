import { useCallback, useState } from 'react';
import {
  connectOneDrive, disconnectOneDrive, getAccount, isConnected as tokensStored,
  syncOneDrive, SyncResult,
} from '../lib/onedrive';

// workspaceHandle: the active workspace (handle.path is the disk root).
// serializeDisk: useNotes' write mutex — pulled files ride it so a sync can
// never race a manual edit's save (see valx-disk-write-serialization).
// rescanWorkspace: re-reads the directory so pulled notes show up without a
// restart.
export function useOneDrive(
  workspaceHandle: any,
  serializeDisk: <T,>(fn: () => Promise<T>) => Promise<T>,
  rescanWorkspace: () => Promise<void>,
) {
  const [connected, setConnected] = useState(tokensStored);
  const [account, setAccount] = useState(getAccount);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setError(null);
    try {
      await connectOneDrive();
      setConnected(true);
      setAccount(getAccount());
    } catch (err: any) {
      setError(err?.message || String(err));
    }
  }, []);

  const disconnect = useCallback(() => {
    disconnectOneDrive();
    setConnected(false);
    setAccount(null);
    setLastResult(null);
  }, []);

  const sync = useCallback(async () => {
    const root = workspaceHandle?.path;
    if (!root || isSyncing) return;
    setIsSyncing(true);
    setError(null);
    try {
      const result = await syncOneDrive(root);
      for (const f of result.pulled) {
        await serializeDisk(() =>
          (window as any).electronAPI.saveFile(root, f.path ? f.path.split('/') : [], f.name, f.content)
        );
      }
      if (result.pulled.length > 0) await rescanWorkspace();
      setLastResult(result);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setIsSyncing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceHandle, isSyncing]);

  return { connected, account, isSyncing, lastResult, error, connect, disconnect, sync };
}
