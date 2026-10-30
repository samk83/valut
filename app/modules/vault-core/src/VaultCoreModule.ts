import { NativeModule, requireOptionalNativeModule } from 'expo';

import { DemoVault } from './DemoVault';

export type VaultStatus = {
  exists: boolean;
  unlocked: boolean;
  remainingAttempts: number;
  hardware: string;
  strongBoxAvailable: boolean;
};

export type PinResult =
  | { ok: true }
  | { ok: false; error: 'WRONG_PIN'; remaining: number }
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

declare class VaultCoreModule extends NativeModule<{}> {
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
  matchesOriginal(id: string, assetId: string, kind: ItemKind): Promise<boolean>;
  openVideo(id: string): Promise<string>;
  closeVideo(): void;
  delete(id: string): Promise<void>;
  destroy(): Promise<void>;
}

const native = requireOptionalNativeModule<VaultCoreModule>('VaultCore');

/**
 * The real, encrypted vault on Android builds. Elsewhere (iPhone, Expo Go) a preview
 * stand-in with no encryption is used; [isDemo] tells the UI to say so.
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
    };

export default Vault;
