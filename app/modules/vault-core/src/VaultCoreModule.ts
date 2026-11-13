import { NativeModule, requireOptionalNativeModule } from 'expo';

import { DemoVault } from './DemoVault';

export type VaultStatus = {
  exists: boolean;
  unlocked: boolean;
  /** Wrong attempts left before a wait starts. Wrong attempts never erase anything. */
  remainingAttempts: number;
  /** Milliseconds until the next PIN attempt is allowed (0 = now). */
  lockedForMs: number;
  hardware: string;
  strongBoxAvailable: boolean;
};

export type PinResult =
  | { ok: true }
  | { ok: false; error: 'WRONG_PIN'; remaining: number; waitMs: number }
  | { ok: false; error: 'LOCKED_OUT'; waitMs: number }
  | { ok: false; error: 'WEAK_PIN'; reason: string }
  | {
      ok: false;
      error: 'DESTROYED' | 'INCOMPLETE' | 'KEYS_UNAVAILABLE' | 'INTERRUPTED' | 'OUT_OF_MEMORY' | 'EXISTS' | 'FAILED';
    };

export type ItemKind = 'PHOTO' | 'VIDEO';

export type VaultItem = {
  id: string;
  kind: ItemKind;
  mimeType: string;
  createdAt: number;
  size: number;
};

export type PinCheck = {
  rejection: 'TOO_SHORT' | 'TOO_LONG' | 'NOT_DIGITS' | 'REPEATED' | 'SEQUENTIAL' | 'COMMON' | null;
  strength: 'WEAK' | 'FAIR' | 'STRONG' | 'FORTRESS';
};

/** 1.1 new-phone transfer progress, from the native side. */
export type TransferEvent = {
  phase: 'waiting' | 'connected' | 'progress' | 'done' | 'error';
  itemsDone?: number;
  itemsTotal?: number;
  bytesDone?: number;
  bytesTotal?: number;
  skipped?: number;
  alreadyThere?: number;
  error?: 'BAD_CODE' | 'STORAGE_FULL' | 'LOCKED' | 'INTEGRITY' | 'CANCELLED' | 'OTHER' | 'WRONG_PEER' | 'CONNECTION';
};

/** Encrypted backup into a folder the user picked (owner decision 2026-11-12). */
export type BackupStatus = {
  hasRecoveryKey: boolean;
  /** True once the user typed back the end of the key (or restored with it). */
  keyConfirmed: boolean;
  /** A restore was started and has not finished (offer to continue). */
  restorePending: boolean;
  /** Name of the backup folder, or null if none was chosen yet. */
  folderName: string | null;
  /** When the last backup finished (ms since 1970), 0 = never. */
  lastBackupAt: number;
  /** Why the last backup failed, or null. */
  lastError: BackupError | null;
  running: boolean;
};

export type BackupError = 'NOT_A_BACKUP' | 'WRONG_KEY' | 'BAD_KEY' | 'NO_KEY' | 'LOCKED' | 'NO_ACCESS' | 'FULL' | 'FOREIGN' | 'FAILED';

export type BackupEvent =
  | { phase: 'backup-done'; written: number; removed: number; total: number }
  | { phase: 'backup-error'; error: BackupError }
  | { phase: 'restore-progress'; done: number; total: number }
  | { phase: 'restore-done'; restored: number; alreadyHere: number; damaged: number }
  | { phase: 'restore-error'; error: BackupError };

type Events = { onTransfer: (event: TransferEvent) => void; onBackup: (event: BackupEvent) => void };

declare class VaultCoreModule extends NativeModule<Events> {
  status(): Promise<VaultStatus>;
  checkPin(pin: string): PinCheck;
  create(pin: string): Promise<PinResult>;
  unlock(pin: string): Promise<PinResult>;
  lock(): void;
  list(): Promise<VaultItem[]>;
  thumbnail(id: string): Promise<string | null>;
  readPhoto(id: string): Promise<string>;
  importUri(
    uri: string,
    kind: ItemKind,
    mimeType: string,
    deleteSourceFile: boolean,
  ): Promise<{ id: string; safeToDeleteOriginal: boolean }>;
  recoverPending(): Promise<{ saved: number; waiting: number }>;
  importCapture(uri: string, kind: ItemKind): Promise<{ saved: boolean; waiting: number }>;
  openVideo(id: string): Promise<string>;
  closeVideo(): void;
  delete(id: string): Promise<void>;
  destroy(): Promise<void>;
  /** Photo search: the photo's sealed search note (JSON), reading the photo on the device first if needed. */
  analyze(id: string): Promise<string | null>;
  /** Saved search notes of many items (missing ones left out). Never reads a photo. */
  searchNotes(ids: string[]): Promise<Record<string, string>>;
  /** Copies text on this device only, cleared after 2 minutes. */
  copyText(text: string): void;
  /** New phone: starts listening and returns the text for the QR code. */
  transferReceive(): Promise<string>;
  /** Old phone: connects to a scanned code and sends every item. */
  transferSend(code: string): Promise<void>;
  transferCancel(): void;
  backupStatus(): Promise<BackupStatus>;
  /** The recovery key in its written form, or null if none was created yet. */
  recoveryKey(): Promise<string | null>;
  /** Creates the recovery key the first time (returns the existing one after that). */
  createRecoveryKey(): Promise<string>;
  /** Records that the user checked their copy of the recovery key. */
  confirmRecoveryKey(): Promise<void>;
  /** The user chose not to continue an unfinished restore. */
  dismissRestore(): Promise<void>;
  /** Remembers a folder picked with the system folder picker. */
  setBackupFolder(uri: string): Promise<{ ok: true; folderName: string } | { ok: false; error: BackupError }>;
  /** Starts a backup in the background (false if one is running or none is set up). */
  backupNow(): Promise<boolean>;
  checkBackup(uri: string, key: string): Promise<{ ok: true; count: number } | { ok: false; error: BackupError }>;
  /** Starts a restore; progress and the result arrive as onBackup events. */
  restoreBackup(uri: string, key: string): Promise<boolean>;
}

const native = requireOptionalNativeModule<VaultCoreModule>('VaultCore');

/**
 * The real, encrypted vault in Android and iPhone/iPad builds. In Expo Go (no native module)
 * a preview stand-in with no encryption is used; [isDemo] tells the UI to say so.
 */
const Vault = native
  ? {
      isDemo: false as const,
      status: () => native.status(),
      checkPin: (pin: string) => native.checkPin(pin),
      create: (pin: string) => native.create(pin),
      unlock: (pin: string) => native.unlock(pin),
      lock: () => native.lock(),
      list: () => native.list(),
      importUri: (uri: string, kind: ItemKind, mimeType: string, deleteSourceFile: boolean) =>
        native.importUri(uri, kind, mimeType, deleteSourceFile),
      recoverPending: () => native.recoverPending(),
      importCapture: (uri: string, kind: ItemKind) => native.importCapture(uri, kind),
      /** Displayable URI of the thumbnail, or null. */
      thumbnailUri: async (id: string) => {
        const b64 = await native.thumbnail(id);
        return b64 ? `data:image/jpeg;base64,${b64}` : null;
      },
      photoUri: async (item: VaultItem) => `data:${item.mimeType || 'image/jpeg'};base64,${await native.readPhoto(item.id)}`,
      openVideo: (id: string) => native.openVideo(id),
      closeVideo: () => native.closeVideo(),
      delete: (id: string) => native.delete(id),
      destroy: () => native.destroy(),
      /** Native photo reading exists in Android and iPhone/iPad builds only. */
      canRead: true as const,
      analyze: (id: string) => native.analyze(id),
      searchNotes: (ids: string[]) => native.searchNotes(ids),
      copyText: (text: string) => native.copyText(text),
      transferReceive: () => native.transferReceive(),
      transferSend: (code: string) => native.transferSend(code),
      transferCancel: () => native.transferCancel(),
      onTransfer: (fn: (e: TransferEvent) => void) => native.addListener('onTransfer', fn),
      backupStatus: () => native.backupStatus(),
      recoveryKey: () => native.recoveryKey(),
      createRecoveryKey: () => native.createRecoveryKey(),
      confirmRecoveryKey: () => native.confirmRecoveryKey(),
      dismissRestore: () => native.dismissRestore(),
      setBackupFolder: (uri: string) => native.setBackupFolder(uri),
      backupNow: () => native.backupNow(),
      checkBackup: (uri: string, key: string) => native.checkBackup(uri, key),
      restoreBackup: (uri: string, key: string) => native.restoreBackup(uri, key),
      onBackup: (fn: (e: BackupEvent) => void) => native.addListener('onBackup', fn),
    }
  : {
      ...DemoVault,
      thumbnailUri: async (id: string) => {
        const item = (await DemoVault.list()).find((i) => i.id === id);
        return item?.kind === 'PHOTO' ? DemoVault.uriOf(id) : null;
      },
      photoUri: async (item: VaultItem) => DemoVault.uriOf(item.id),
      openVideo: async (id: string) => DemoVault.uriOf(id),
      closeVideo: () => {},
      // Expo Go has no on-device text reading; the search screen says so.
      canRead: false as const,
      analyze: async (_id: string): Promise<string | null> => null,
      searchNotes: async (_ids: string[]): Promise<Record<string, string>> => ({}),
      copyText: (_text: string) => {},
      // The preview has nothing real to move, so the transfer screens explain that instead.
      transferReceive: async (): Promise<string> => {
        throw new Error('E_UNAVAILABLE');
      },
      transferSend: async (_code: string): Promise<void> => {
        throw new Error('E_UNAVAILABLE');
      },
      transferCancel: () => {},
      onTransfer: (_fn: (e: TransferEvent) => void) => ({ remove: () => {} }),
      // The preview keeps nothing on disk, so there is nothing to back up; the screens say so.
      backupStatus: async (): Promise<BackupStatus> => ({
        hasRecoveryKey: false,
        keyConfirmed: false,
        restorePending: false,
        folderName: null,
        lastBackupAt: 0,
        lastError: null,
        running: false,
      }),
      recoveryKey: async (): Promise<string | null> => null,
      createRecoveryKey: async (): Promise<string> => {
        throw new Error('E_UNAVAILABLE');
      },
      confirmRecoveryKey: async () => {},
      dismissRestore: async () => {},
      setBackupFolder: async (_uri: string): Promise<{ ok: false; error: BackupError }> => ({ ok: false, error: 'FAILED' }),
      backupNow: async () => false,
      checkBackup: async (_uri: string, _key: string): Promise<{ ok: false; error: BackupError }> => ({ ok: false, error: 'FAILED' }),
      restoreBackup: async (_uri: string, _key: string) => false,
      onBackup: (_fn: (e: BackupEvent) => void) => ({ remove: () => {} }),
    };

export default Vault;
