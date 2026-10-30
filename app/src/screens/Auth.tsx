import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import VaultCore from '../../modules/vault-core';
import { C } from '../theme';
import { Body, Busy, Button, PinDots, PinPad, s, TestBanner, Title } from '../ui';

export function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={[s.screen, { flexGrow: 1 }]}>
      <TestBanner />
      <Text style={s.label}>PrivateVault</Text>
      <Title>Your photos, sealed on this phone.</Title>
      <View style={{ gap: 12, marginTop: 8, flex: 1 }}>
        <Body>• Everything is encrypted with your PIN and this phone's security chip.</Body>
        <Body>• No cloud, no account, no sharing. The app has no internet permission.</Body>
        <Body>• There is no recovery. Forget the PIN and the vault is gone.</Body>
        <Body>• 3 wrong PINs in a row destroy the vault for good.</Body>
      </View>
      <Button label="Create PIN" onPress={onNext} />
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
  const [first, setFirst] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const check = pin.length > 0 ? VaultCore.checkPin(pin) : null;

  const submit = async () => {
    setError(null);
    if (first === null) {
      if (check?.rejection) return setError(REJECTION[check.rejection]);
      setFirst(pin);
      setPin('');
      return;
    }
    if (pin !== first) {
      setFirst(null);
      setPin('');
      return setError("PINs didn't match. Start again.");
    }
    if (!agree) return setError('Please confirm you understand there is no recovery.');
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    let r: Awaited<ReturnType<typeof VaultCore.create>>;
    try {
      r = await VaultCore.create(pin);
    } catch {
      r = { ok: false, error: 'INTERRUPTED' };
    } finally {
      inFlight.current = false;
      setBusy(false);
      setPin('');
      setFirst(null);
    }
    if (r.ok) onDone();
    else if (r.error === 'WEAK_PIN') setError(REJECTION[r.reason]);
    else if (r.error === 'EXISTS' || r.error === 'INTERRUPTED') onLocked();
    else setError(`Could not create vault (${r.error}).`);
  };

  return (
    <View style={s.screen}>
      <Text style={s.label}>Step {first === null ? '1' : '2'} of 2</Text>
      <Title>{first === null ? 'Create your PIN' : 'Enter it again'}</Title>
      <PinDots count={pin.length} />
      <Text style={[s.small, { textAlign: 'center', minHeight: 20, color: error ? C.danger : C.muted }]}>
        {error ?? (first === null && check ? (check.rejection ? REJECTION[check.rejection] : STRENGTH[check.strength]) : ' ')}
      </Text>
      {first !== null && (
        <Pressable onPress={() => setAgree(!agree)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 8 }}>
          <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: C.brass, backgroundColor: agree ? C.brass : 'transparent' }} />
          <Text style={[s.small, { flex: 1, color: C.ivory }]}>I understand: no recovery, and 3 wrong PINs erase the vault.</Text>
        </Pressable>
      )}
      <View style={{ flex: 1 }} />
      <PinPad value={pin} onChange={setPin} onSubmit={submit} disabled={busy} />
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

  const submit = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    let r: Awaited<ReturnType<typeof VaultCore.unlock>>;
    try {
      r = await VaultCore.unlock(pin);
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
        setMsg('Wrong PIN.');
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
      <Text style={[s.label, final && { color: C.danger }]}>{final ? 'Final attempt' : 'Locked'}</Text>
      <Title>{final ? 'Last chance.' : 'Enter PIN'}</Title>
      <Body style={{ color: final ? '#F3B7AA' : C.muted }}>
        {final
          ? 'One more wrong PIN permanently destroys the vault and everything in it.'
          : `${left} attempt${left === 1 ? '' : 's'} remaining.`}
      </Body>
      <View style={{ height: 24 }} />
      <PinDots count={pin.length} />
      <Text style={[s.small, { textAlign: 'center', color: C.danger, minHeight: 20 }]}>{msg ?? ' '}</Text>
      <View style={{ flex: 1 }} />
      <PinPad value={pin} onChange={(v) => { setMsg(null); setPin(v); }} onSubmit={submit} disabled={busy} />
      {busy && <Busy label="Checking with the security chip…" />}
    </View>
  );
}

export function Destroyed({ onNew }: { onNew: () => void }) {
  return (
    <View style={[s.screen, { justifyContent: 'center' }]}>
      <Text style={[s.label, { color: C.danger }]}>Vault destroyed</Text>
      <Title>The keys are gone.</Title>
      <Body style={{ color: C.muted, marginBottom: 32 }}>
        The vault was erased after 3 wrong PINs or a reset. Its contents cannot be recovered by anyone, including us.
      </Body>
      <Button label="Create a new vault" onPress={onNew} />
    </View>
  );
}
