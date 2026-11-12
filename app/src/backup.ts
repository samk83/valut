import { Directory } from 'expo-file-system';

import VaultCore, { BackupError } from '../modules/vault-core';
import { Key, t } from './i18n';

/**
 * Opens the system folder picker (iCloud Drive / Files on iPhone, any folder on Android).
 * Returns the folder's address, or null if the user cancelled.
 */
export async function pickFolder(suspendAutoLock: (on: boolean) => void): Promise<string | null> {
  suspendAutoLock(true);
  try {
    const dir = await Directory.pickDirectoryAsync();
    return dir?.uri ?? null;
  } catch {
    return null;
  } finally {
    suspendAutoLock(false);
  }
}

/** Backs up anything new in the background. Safe to call often; does nothing if not set up. */
export function autoBackup() {
  VaultCore.backupNow().catch(() => {});
}

const ERRORS: Record<BackupError, Key> = {
  NOT_A_BACKUP: 'backup.errNotABackup',
  WRONG_KEY: 'backup.errWrongKey',
  BAD_KEY: 'backup.errBadKey',
  NO_KEY: 'backup.errNoKey',
  LOCKED: 'backup.errLocked',
  NO_ACCESS: 'backup.errNoAccess',
  FULL: 'backup.errFull',
  FOREIGN: 'backup.errForeign',
  FAILED: 'backup.errFailed',
};

export const backupErrorText = (code: BackupError | null | undefined) => t(ERRORS[code ?? 'FAILED'] ?? ERRORS.FAILED);
