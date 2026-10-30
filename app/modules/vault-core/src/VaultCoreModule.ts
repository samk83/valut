import { NativeModule, requireNativeModule } from 'expo';

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

export default requireNativeModule<VaultCoreModule>('VaultCore');
