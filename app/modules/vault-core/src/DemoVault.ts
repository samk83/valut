// Preview-only stand-in for the native vault, used where the native module is absent
// (iPhone, Expo Go). NOTHING IS ENCRYPTED: items are kept in memory as plain file URIs and
// the PIN only lives until the app is closed. It exists so the screens can be tried out.
import type { ItemKind, PinCheck, PinResult, VaultItem, VaultStatus } from './VaultCoreModule';

const MAX_ATTEMPTS = 3;
const COMMON = new Set(['1234', '1111', '0000', '1212', '7777', '1004', '2000', '4444', '2222', '6969', '9999', '4321', '2580']);

let pinHash: string | null = null;
let failures = 0;
let unlocked = false;
let items: (VaultItem & { uri: string })[] = [];
// Bumped by lock(); a create/unlock that was waiting when the vault locked must not succeed.
let lockGeneration = 0;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function checkPin(pin: string): PinCheck {
  const digits = /^[0-9]*$/.test(pin);
  let rejection: PinCheck['rejection'] = null;
  if (pin.length < 4) rejection = 'TOO_SHORT';
  else if (pin.length > 32) rejection = 'TOO_LONG';
  else if (!digits) rejection = 'NOT_DIGITS';
  else if ([...pin].every((c) => c === pin[0])) rejection = 'REPEATED';
  else if ([1, -1].some((d) => [...pin].every((c, i) => i === 0 || +c - +pin[i - 1] === d))) rejection = 'SEQUENTIAL';
  else if (COMMON.has(pin)) rejection = 'COMMON';
  const n = pin.length;
  const strength = n >= 10 ? 'FORTRESS' : n >= 8 ? 'STRONG' : n >= 6 ? 'FAIR' : 'WEAK';
  return { rejection, strength };
}

function requireUnlocked() {
  if (!unlocked) throw new Error('Vault is locked');
}

export const DemoVault = {
  isDemo: true as const,
  async status(): Promise<VaultStatus> {
    return { exists: pinHash !== null, unlocked, remainingAttempts: MAX_ATTEMPTS - failures, hardware: 'Preview (no encryption)', strongBoxAvailable: false };
  },
  checkPin,
  async create(pin: string): Promise<PinResult> {
    const gen = lockGeneration;
    await wait(600);
    if (gen !== lockGeneration) return { ok: false, error: 'INTERRUPTED' };
    if (pinHash !== null) return { ok: false, error: 'EXISTS' };
    const c = checkPin(pin);
    if (c.rejection) return { ok: false, error: 'WEAK_PIN', reason: c.rejection };
    pinHash = pin;
    failures = 0;
    unlocked = true;
    items = [];
    return { ok: true };
  },
  async unlock(pin: string): Promise<PinResult> {
    const gen = lockGeneration;
    await wait(900);
    if (gen !== lockGeneration) return { ok: false, error: 'INTERRUPTED' };
    if (pinHash === null) return { ok: false, error: 'DESTROYED' };
    if (pin.length < 4) return { ok: false, error: 'INCOMPLETE' };
    if (pin === pinHash) {
      failures = 0;
      unlocked = true;
      return { ok: true };
    }
    failures++;
    if (failures >= MAX_ATTEMPTS) {
      await DemoVault.destroy();
      return { ok: false, error: 'DESTROYED' };
    }
    return { ok: false, error: 'WRONG_PIN', remaining: MAX_ATTEMPTS - failures };
  },
  lock() {
    lockGeneration++;
    unlocked = false;
  },
  async list(): Promise<VaultItem[]> {
    requireUnlocked();
    return items.map(({ uri: _uri, ...i }) => i);
  },
  async importUri(uri: string, kind: ItemKind, mimeType: string, _deleteSourceFile: boolean) {
    requireUnlocked();
    await wait(300);
    const id = Math.random().toString(16).slice(2) + Date.now().toString(16);
    items.unshift({ id, kind, mimeType, createdAt: Date.now(), size: 0, uri });
    return { id, safeToDeleteOriginal: true };
  },
  async recoverPending() {
    return { saved: 0, waiting: 0 };
  },
  async importCapture(uri: string, kind: ItemKind) {
    await DemoVault.importUri(uri, kind, kind === 'VIDEO' ? 'video/mp4' : 'image/jpeg', false);
    return { saved: true, waiting: 0 };
  },
  /** Nothing is re-read in the preview: an item that was imported counts as a match. */
  async matchesOriginal(id: string, _assetId: string, _kind: ItemKind) {
    requireUnlocked();
    return items.some((i) => i.id === id);
  },
  uriOf(id: string) {
    requireUnlocked();
    const item = items.find((i) => i.id === id);
    if (!item) throw new Error('Not found');
    return item.uri;
  },
  async delete(id: string) {
    requireUnlocked();
    items = items.filter((i) => i.id !== id);
  },
  async destroy() {
    unlocked = false;
    pinHash = null;
    failures = 0;
    items = [];
  },
};
