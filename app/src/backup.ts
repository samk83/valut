import { Directory } from 'expo-file-system';
import * as LocalAuthentication from 'expo-local-authentication';

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

/**
 * Asks for Face ID / Touch ID / fingerprint or the phone's passcode before the recovery key is
 * shown (owner request 2026-11-13). A phone without a screen lock has nothing to ask, and the
 * vault PIN already protects the screen, so it returns true.
 */
export async function confirmOwner(suspendAutoLock: (on: boolean) => void): Promise<boolean> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.NONE) return true;
  } catch {
    // Unknown: ask anyway.
  }
  // The system prompt makes the app inactive; it must not lock the vault meanwhile.
  suspendAutoLock(true);
  try {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: t('backup.authPrompt'), cancelLabel: t('common.cancel') });
    return r.success;
  } catch {
    return false;
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
