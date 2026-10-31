import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import VaultCore from '../../modules/vault-core';
import { C } from '../theme';
import { clearLockMethod, MIN_PATTERN_DOTS, LockMethod, PatternPad, patternToSecret, readLockMethod, saveLockMethod } from '../pattern';
import { Body, Bullet, Busy, Button, PinDots, PinPad, s, Segmented, TestBanner, Title } from '../ui';

export function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={[s.screen, { flexGrow: 1 }]}>
      <TestBanner />
      <Text style={s.label}>PrivateVault</Text>
      <Title>Your photos, sealed on this phone.</Title>
      <View style={{ gap: 12, marginTop: 8, flex: 1 }}>
        <Bullet>Everything is encrypted with your PIN or pattern and this phone's security chip.</Bullet>
        <Bullet>No cloud, no account, no sharing. The app has no internet permission.</Bullet>
        <Bullet>There is no recovery. Forget the PIN or pattern and the vault is gone.</Bullet>
        <Bullet>3 wrong tries in a row destroy the vault for good.</Bullet>
      </View>
      <Button label="Set up lock" onPress={onNext} />
    </ScrollView>
  );
}

const REJECTION: Record<string, string> = {
  TOO_SHORT: 'Use at least 4 digits.',
  TOO_LONG: 'Use at most 32 digits.',
  REPEATED: 'All digits are the same.',
  SEQUENTIAL: 'Digits run in sequence.',
  COMMON: 'This PIN is too common.',
  NOT_DIGITS: 'Digits only.',
};

const STRENGTH: Record<string, string> = {
  WEAK: 'Weak — 10+ digits recommended',
  FAIR: 'Fair — 10+ digits recommended',
  STRONG: 'Strong',
  FORTRESS: 'Fortress',
};

export function CreatePin({ onDone, onLocked }: { onDone: () => void; onLocked: () => void }) {
  const [method, setMethod] = useState<LockMethod>('pin');
  const [first, setFirst] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const check = method === 'pin' && pin.length > 0 ? VaultCore.checkPin(pin) : null;
  const what = method === 'pin' ? 'PIN' : 'pattern';

  const choose = (m: LockMethod) => {
    setMethod(m);
    setFirst(null);
    setPin('');
    setError(null);
  };

  const submit = async (value: string) => {
    setError(null);
    if (first === null) {
      if (check?.rejection) return setError(REJECTION[check.rejection]);
      setFirst(value);
      setPin('');
      return;
    }
    if (value !== first) {
      setFirst(null);
      setPin('');
      return setError(`${method === 'pin' ? 'PINs' : 'Patterns'} didn't match. Start again.`);
    }
    if (!agree) return setError('Please confirm you understand there is no recovery.');
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    // Record the lock kind before the vault exists, so a crash right after create
    // cannot leave a pattern vault behind a PIN pad.
    const previous = readLockMethod();
    saveLockMethod(method);
    let r: Awaited<ReturnType<typeof VaultCore.create>>;
    try {
      r = await VaultCore.create(value);
    } catch {
      r = { ok: false, error: 'INTERRUPTED' };
    } finally {
      inFlight.current = false;
      setBusy(false);
      setPin('');
      setFirst(null);
    }
    // On a clear failure put back what was there, so an existing vault keeps its lock kind.
    if (!r.ok && r.error !== 'INTERRUPTED') previous ? saveLockMethod(previous) : clearLockMethod();
    if (r.ok) onDone();
    else if (r.error === 'WEAK_PIN') setError(method === 'pin' ? REJECTION[r.reason] : 'This pattern is too simple. Try another.');
    else if (r.error === 'EXISTS' || r.error === 'INTERRUPTED') onLocked();
    else setError(`Could not create vault (${r.error}).`);
  };

  const drawn = (dots: number[]) => {
    if (dots.length < MIN_PATTERN_DOTS) return setError(`Connect at least ${MIN_PATTERN_DOTS} dots.`);
    submit(patternToSecret(dots));
  };

  const hint =
    error ??
    (method === 'pin'
      ? first === null && check
        ? check.rejection
          ? REJECTION[check.rejection]
          : STRENGTH[check.strength]
        : ' '
      : first === null
        ? `Connect at least ${MIN_PATTERN_DOTS} dots.`
        : 'Draw the same pattern again.');

  return (
    <View style={s.screen}>
      {first === null && (
        <View style={{ marginBottom: 20 }}>
          <Segmented
            value={method}
            onChange={choose}
            options={[
              { value: 'pin', label: 'PIN' },
              { value: 'pattern', label: 'Pattern' },
            ]}
          />
        </View>
      )}
      <Text style={s.label}>Step {first === null ? '1' : '2'} of 2</Text>
      <Title>{first === null ? `Create your ${what}` : method === 'pin' ? 'Enter it again' : 'Draw it again'}</Title>
      {method === 'pin' && <PinDots count={pin.length} />}
      <Text style={[s.small, { textAlign: 'center', minHeight: 20, color: error ? C.danger : C.muted }]}>{hint}</Text>
      {first !== null && (
        <Pressable onPress={() => setAgree(!agree)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 8 }}>
          <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: C.brass, backgroundColor: agree ? C.brass : 'transparent' }} />
          <Text style={[s.small, { flex: 1, color: C.ivory }]}>I understand: no recovery, and 3 wrong tries erase the vault.</Text>
        </Pressable>
      )}
      <View style={{ flex: 1 }} />
      {method === 'pin' ? (
        <PinPad value={pin} onChange={setPin} onSubmit={() => submit(pin)} disabled={busy} />
      ) : (
        <PatternPad onDone={drawn} disabled={busy} />
      )}
      {busy && <Busy label="Sealing the vault…" />}
    </View>
  );
}

export function Unlock({ remaining, onUnlocked, onDestroyed }: { remaining: number; onUnlocked: () => void; onDestroyed: () => void }) {
  const [pin, setPin] = useState('');
  const [left, setLeft] = useState(remaining);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A second tap before the busy state renders must not spend another attempt.
  const inFlight = useRef(false);
  const final = left === 1;
  // If the saved lock kind is lost, let the user pick the input instead of guessing:
  // a pattern typed on a PIN pad would spend attempts and could erase the vault.
  const [saved] = useState(readLockMethod);
  const [method, setMethod] = useState<LockMethod>(saved ?? 'pin');
  const what = method === 'pin' ? 'PIN' : 'pattern';

  const submit = async (secret: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    let r: Awaited<ReturnType<typeof VaultCore.unlock>>;
    try {
      r = await VaultCore.unlock(secret);
    } catch {
      r = { ok: false, error: 'INTERRUPTED' };
    } finally {
      inFlight.current = false;
      setBusy(false);
      setPin('');
    }
    if (r.ok) return onUnlocked();
    switch (r.error) {
      case 'WRONG_PIN':
        setLeft(r.remaining);
        setMsg(`Wrong ${what}.`);
        break;
      case 'DESTROYED':
        onDestroyed();
        break;
      case 'INCOMPLETE':
        setMsg('Enter at least 4 digits. Not counted.');
        break;
      case 'KEYS_UNAVAILABLE':
        setMsg('Security chip key not available. Nothing was erased.');
        break;
      case 'OUT_OF_MEMORY':
        setMsg('Not enough memory. Close other apps and retry. Not counted.');
        break;
      default:
        // The count may have changed (or the vault been destroyed) without a clear answer.
        VaultCore.status()
          .then((st) => (st.exists ? setLeft(st.remainingAttempts) : onDestroyed()))
          .catch(() => {});
        setMsg('Something went wrong. Try again.');
    }
  };

  return (
    <View style={[s.screen, final && { backgroundColor: '#140B0A' }]}>
      <TestBanner />
      {saved === null && (
        <View style={{ marginBottom: 20 }}>
          <Segmented
            value={method}
            onChange={(m) => {
              setMethod(m);
              setPin('');
              setMsg(null);
            }}
            options={[
              { value: 'pin', label: 'PIN' },
              { value: 'pattern', label: 'Pattern' },
            ]}
          />
        </View>
      )}
      <Text style={[s.label, final && { color: C.danger }]}>{final ? 'Final attempt' : 'Locked'}</Text>
      <Title>{final ? 'Last chance.' : method === 'pin' ? 'Enter PIN' : 'Draw pattern'}</Title>
      <Body style={{ color: final ? '#F3B7AA' : C.muted }}>
        {final
          ? `One more wrong ${what} permanently destroys the vault and everything in it.`
          : `${left} attempt${left === 1 ? '' : 's'} remaining.`}
      </Body>
      <View style={{ height: 24 }} />
      {method === 'pin' && <PinDots count={pin.length} />}
      <Text style={[s.small, { textAlign: 'center', color: C.danger, minHeight: 20 }]}>{msg ?? ' '}</Text>
      <View style={{ flex: 1 }} />
      {method === 'pin' ? (
        <PinPad value={pin} onChange={(v) => { setMsg(null); setPin(v); }} onSubmit={() => submit(pin)} disabled={busy} />
      ) : (
        <PatternPad
          disabled={busy}
          onDone={(dots) => {
            // Too short is not a real try and is not counted (same as a short PIN).
            if (dots.length < MIN_PATTERN_DOTS) return setMsg(`Connect at least ${MIN_PATTERN_DOTS} dots. Not counted.`);
            setMsg(null);
            submit(patternToSecret(dots));
          }}
        />
      )}
      {busy && <Busy label="Checking with the security chip…" />}
    </View>
  );
}

export function Destroyed({ cause, onNew }: { cause: 'attempts' | 'reset'; onNew: () => void }) {
  return (
    <View style={[s.screen, { justifyContent: 'center' }]}>
      <Text style={[s.label, { color: C.danger }]}>Vault destroyed</Text>
      <Title>The keys are gone.</Title>
      <Body style={{ color: C.muted, marginBottom: 32 }}>
        The vault was erased after 3 wrong tries or a reset. Its contents cannot be recovered by anyone, including us.
      </Body>
      <Button label="Create a new vault" onPress={onNew} />
    </View>
  );
}
