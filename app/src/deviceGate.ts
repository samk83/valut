import { File, Paths } from 'expo-file-system';

// "Ask for the phone's own lock first" setting (two-step unlock, step 1). On unless turned off.
// Only an on/off flag is stored; the phone's passcode or face data never reach the app.
const gateFile = () => new File(Paths.document, 'device-gate');

export function readDeviceGate(): boolean {
  try {
    const f = gateFile();
    return !(f.exists && f.textSync().trim() === '0');
  } catch {
    return true;
  }
}

export function saveDeviceGate(on: boolean) {
  try {
    const f = gateFile();
    if (!f.exists) f.create();
    f.write(on ? '1' : '0');
  } catch {}
}

/** Errors that mean the phone has no usable screen lock: step 1 is skipped (with a notice). */
export const NO_DEVICE_LOCK = ['not_enrolled', 'passcode_not_set', 'not_available'] as const;
