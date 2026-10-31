import Ionicons from '@expo/vector-icons/Ionicons';
import { ReactNode, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import VaultCore from '../../modules/vault-core';
import { C, F } from '../theme';
import {
  clearLockMethod,
  LockMethod,
  MIN_PATTERN_DOTS,
  PatternPad,
  patternToSecret,
  readHideTrail,
  readLockMethod,
  saveLockMethod,
} from '../pattern';
import { Body, Busy, Button, PinDots, s, Segmented, Title } from '../ui';

/** Lock mark: a brass ring with a lock inside. */
function Logo({ size = 72, tile }: { size?: number; tile?: boolean }) {
  const ring = (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: Math.max(2, size / 24),
        borderColor: C.brass,
        backgroundColor: tile ? '#07080B' : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name="lock-closed" size={size * 0.4} color={C.brass} />
    </View>
  );
  if (!tile) return ring;
  return (
    <View style={{ width: size + 24, height: size + 24, borderRadius: (size + 24) / 4.5, backgroundColor: '#12151D', alignItems: 'center', justifyContent: 'center' }}>
      {ring}
    </View>
  );
}

const Small = ({ children, style }: { children: ReactNode; style?: object }) => (
  <Text style={[s.small, { fontSize: 11, lineHeight: 18, color: C.faint, textAlign: 'center' }, style]}>{children}</Text>
);

const Caption = ({ children }: { children: ReactNode }) => (
  <Text style={[s.small, { fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: C.faint }]}>{children}</Text>
);

/** A dot with a hanging indent: the title and the wrapped sub-line both line up after the dot. */
function Point({ title, sub, color = C.brass }: { title: string; sub: string; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 7, backgroundColor: color }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.body, { fontFamily: F.bold }]}>{title}</Text>
        <Text style={[s.small, { lineHeight: 20 }]}>{sub}</Text>
      </View>
    </View>
  );
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];

/** Round keypad (same behaviour as ui PinPad, with an OK key); digits are centred in each key. */
function KeyPad({
  value,
  onChange,
  onSubmit,
  disabled,
  size = 72,
  max = 32,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  size?: number;
  max?: number;
}) {
  const ready = value.length >= 4;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', rowGap: size > 64 ? 16 : 10, width: '100%', maxWidth: 320, alignSelf: 'center' }}>
      {KEYS.map((k) => {
        const off = disabled || (k === 'ok' && !ready);
        return (
          <View key={k} style={{ width: '33.33%', alignItems: 'center' }}>
            <Pressable
              disabled={off}
              accessibilityLabel={k === 'del' ? 'Delete' : k === 'ok' ? 'Confirm' : k}
              onPress={() => {
                if (k === 'del') onChange(value.slice(0, -1));
                else if (k === 'ok') onSubmit();
                else if (value.length < max) onChange(value + k);
              }}
              style={({ pressed }) => [
                {
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  borderWidth: 1,
                  borderColor: C.outline,
                  backgroundColor: C.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                },
                k === 'del' && { borderColor: 'transparent', backgroundColor: 'transparent' },
                k === 'ok' && { borderColor: C.brass, backgroundColor: ready ? C.brass : 'transparent' },
                pressed && { backgroundColor: C.surface2 },
                off && { opacity: 0.35 },
              ]}
            >
              {k === 'del' ? (
                <Ionicons name="backspace-outline" size={26} color={C.ivory} />
              ) : (
                <Text
                  style={[
                    { fontFamily: F.medium, fontSize: 28, lineHeight: 34, color: C.ivory, textAlign: 'center', textAlignVertical: 'center', includeFontPadding: false },
                    k === 'ok' && { fontFamily: F.bold, fontSize: 16, lineHeight: 20, color: ready ? C.bg : C.brass },
                  ]}
                >
                  {k === 'ok' ? 'OK' : k}
                </Text>
              )}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

function methodOptions(value: LockMethod) {
  return [
    { value: 'pin' as const, label: 'PIN', icon: <Ionicons name="keypad-outline" size={16} color={value === 'pin' ? C.brass : C.faint} /> },
    { value: 'pattern' as const, label: 'Pattern', icon: <Ionicons name="git-network-outline" size={16} color={value === 'pattern' ? C.brass : C.faint} /> },
  ];
}

export function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={[s.screen, { flexGrow: 1, paddingTop: 72, paddingHorizontal: 28 }]}>
      <Logo size={72} tile />
      <Text style={[s.label, { marginTop: 32 }]}>Step 1 of 3</Text>
      <Text style={{ fontFamily: F.title, fontSize: 40, lineHeight: 44, color: C.ivory, marginTop: 10 }}>{'Your files.\nYour device.\nYour eyes only.'}</Text>
      <View style={{ gap: 16, marginTop: 28 }}>
        <Point title="Encrypted on this phone" sub="AES-256, sealed with your PIN or pattern and the phone's security chip." />
        <Point title="Nothing ever leaves" sub="No account, no cloud, no sharing, no internet access." />
        <Point title="No recovery, ever" sub="Forget your PIN or pattern, lose your phone or delete the app, and the files are gone for good." color={C.danger} />
      </View>
      <View style={{ flex: 1, minHeight: 32 }} />
      <Button label="Create my vault" onPress={onNext} />
      <Small style={{ marginTop: 14 }}>Requires a device passcode and a hardware security chip.</Small>
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

const STRENGTH: Record<string, { word: string; bars: number; color: string; note: string }> = {
  WEAK: { word: 'Weak', bars: 1, color: C.danger, note: 'Easy to guess. 10+ digits recommended.' },
  FAIR: { word: 'Fair', bars: 2, color: C.brass, note: '10+ digits recommended.' },
  STRONG: { word: 'Strong', bars: 3, color: C.ok, note: 'Hard to guess.' },
  FORTRESS: { word: 'Fortress', bars: 4, color: C.ok, note: 'Very hard to guess.' },
};

function StrengthCard({ check }: { check: ReturnType<typeof VaultCore.checkPin> | null }) {
  const level = check ? STRENGTH[check.strength] : null;
  const rejected = check?.rejection ? REJECTION[check.rejection] : null;
  const filled = rejected ? 0 : (level?.bars ?? 0);
  return (
    <View style={[s.card, { gap: 10 }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Caption>Strength</Caption>
        <Text style={{ fontFamily: F.title, fontSize: 18, color: rejected ? C.danger : (level?.color ?? C.faint) }}>{rejected ? 'Not allowed' : (level?.word ?? '—')}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < filled ? (level?.color ?? C.brass) : C.line }} />
        ))}
      </View>
      <Text style={[s.small, { fontSize: 12, color: rejected ? C.danger : C.muted }]}>{rejected ?? level?.note ?? 'At least 4 digits.'}</Text>
    </View>
  );
}

export function CreatePin({ onDone, onLocked }: { onDone: () => void; onLocked: () => void }) {
  const [method, setMethod] = useState<LockMethod>('pin');
  const [first, setFirst] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drawing, setDrawing] = useState(0);
  const inFlight = useRef(false);
  const check = method === 'pin' && pin.length > 0 ? VaultCore.checkPin(pin) : null;

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
    if (dots.length < MIN_PATTERN_DOTS) {
      const n = dots.length;
      return setError(`Only ${n} dot${n === 1 ? '' : 's'}. Connect at least ${MIN_PATTERN_DOTS}.`);
    }
    submit(patternToSecret(dots));
  };

  const sub =
    method === 'pin'
      ? first === null
        ? 'Pick one way to lock your vault. At least 4 digits.'
        : 'Enter the same PIN again to confirm.'
      : first === null
        ? `Draw a pattern, connect at least ${MIN_PATTERN_DOTS} dots.`
        : 'Draw the same pattern again to confirm';

  // Pattern status line: live count while drawing, then any error.
  const patternStatus = drawing > 0 ? `${drawing} dot${drawing === 1 ? '' : 's'} connected · lift to continue` : null;
  const status = method === 'pattern' ? (patternStatus ?? error) : error;

  return (
    <View style={[s.screen, { paddingTop: 48, paddingHorizontal: 24, paddingBottom: 20 }]}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 16, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 8 }}>
          <Text style={s.label}>Step {first === null ? '2' : '3'} of 3</Text>
          <Text style={{ fontFamily: F.title, fontSize: 34, lineHeight: 38, color: C.ivory }}>Create your key</Text>
          <Text style={[s.small, { fontSize: 14, lineHeight: 21 }]}>{sub}</Text>
        </View>
        {first === null && (
          <View style={{ gap: 8 }}>
            <Caption>Lock method</Caption>
            <Segmented value={method} onChange={choose} options={methodOptions(method)} />
          </View>
        )}
        {method === 'pin' && (
          <View style={{ height: 56, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }}>
            <PinDots count={pin.length} />
          </View>
        )}
        {method === 'pin' && first === null && <StrengthCard check={check} />}
        {status ? (
          <Text style={[s.small, { textAlign: 'center', color: status === patternStatus ? C.muted : C.danger }]}>{status}</Text>
        ) : null}
        <View style={{ gap: 6, padding: 16, borderRadius: 16, backgroundColor: '#1A1410', borderWidth: 1, borderColor: '#4A3420' }}>
          <Text style={{ fontFamily: F.title, fontSize: 18, color: '#F0B98A' }}>Forget it, lose everything.</Text>
          <Text style={[s.small, { fontSize: 12, color: '#D4C4B5' }]}>
            Three wrong attempts destroys the vault. There is no password reset, no admin override and no cloud backup. Reinstalling the app will not bring your files back.
          </Text>
        </View>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agree }}
          onPress={() => setAgree(!agree)}
          style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}
        >
          <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: C.brass, backgroundColor: agree ? C.brass : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
            {agree && <Ionicons name="checkmark" size={16} color={C.bg} />}
          </View>
          <Text style={[s.small, { flex: 1, color: C.ivory }]}>I understand my files cannot be recovered.</Text>
        </Pressable>
      </ScrollView>
      <View style={{ paddingTop: 8 }}>
        {method === 'pin' ? (
          <KeyPad value={pin} onChange={(v) => { setError(null); setPin(v); }} onSubmit={() => submit(pin)} disabled={busy} size={60} />
        ) : (
          <PatternPad
            onDone={drawn}
            onProgress={(n) => {
              setDrawing(n);
              if (n > 0) setError(null);
            }}
            disabled={busy}
            maxSize={270}
          />
        )}
      </View>
      {busy && <Busy label="Sealing the vault…" />}
    </View>
  );
}

function Attempts({ left }: { left: number }) {
  return (
    <Text style={[s.small, { textAlign: 'center' }]}>
      <Text style={{ color: C.brass, fontFamily: F.bold }}>{left} of 3</Text> attempts remaining
    </Text>
  );
}

const Dash = ({ children }: { children: ReactNode }) => (
  <View style={{ flexDirection: 'row', gap: 12 }}>
    <Text style={[s.small, { color: C.brass }]}>—</Text>
    <Text style={[s.small, { flex: 1, color: '#D9D4CA' }]}>{children}</Text>
  </View>
);

function FinalWarning({ what, onContinue }: { what: string; onContinue: () => void }) {
  const [paused, setPaused] = useState(false);
  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={[s.screen, { flexGrow: 1, alignItems: 'center', paddingTop: 96, paddingHorizontal: 32 }]}>
      <View style={{ width: 120, height: 120, borderRadius: 60, borderWidth: 4, borderColor: C.outline, borderTopColor: C.danger, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: F.title, fontSize: 40, lineHeight: 48, color: C.ivory, includeFontPadding: false }}>1</Text>
      </View>
      <Text style={[s.label, { color: C.danger, marginTop: 26 }]}>Final attempt</Text>
      <Text style={{ fontFamily: F.title, fontSize: 32, lineHeight: 37, color: C.ivory, marginTop: 10, textAlign: 'center' }}>One try left</Text>
      <Body style={{ color: C.muted, textAlign: 'center', marginTop: 14 }}>
        If the next {what} is wrong, the vault key is destroyed. Every photo and video inside will be gone for good.
      </Body>
      <View style={[s.card, { width: '100%', gap: 12, marginTop: 28 }]}>
        <Dash>Take a moment. Enter it slowly.</Dash>
        <Dash>Incomplete entries don't count as attempts.</Dash>
        <Dash>No one, including us, can open this vault for you.</Dash>
      </View>
      <View style={{ flex: 1, minHeight: 24 }} />
      <View style={{ width: '100%', gap: 12 }}>
        {paused && <Small>Take your time. The vault stays locked until you continue.</Small>}
        <Button label="I understand, continue" kind="light" onPress={onContinue} />
        <Button label="Not now" kind="ghost" onPress={() => setPaused(true)} style={{ height: 48 }} />
      </View>
    </ScrollView>
  );
}

export function Unlock({ remaining, onUnlocked, onDestroyed }: { remaining: number; onUnlocked: () => void; onDestroyed: () => void }) {
  const [pin, setPin] = useState('');
  const [left, setLeft] = useState(remaining);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The final-attempt warning must be acknowledged before the last try is shown.
  const [ackFinal, setAckFinal] = useState(false);
  // A second tap before the busy state renders must not spend another attempt.
  const inFlight = useRef(false);
  // If the saved lock kind is lost, let the user pick the input instead of guessing:
  // a pattern typed on a PIN pad would spend attempts and could erase the vault.
  const [saved] = useState(readLockMethod);
  const [hideTrail] = useState(readHideTrail);
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
        setMsg(method === 'pin' ? 'Enter at least 4 digits. Not counted.' : 'Connect at least 4 dots. Not counted.');
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

  if (left === 1 && !ackFinal) return <FinalWarning what={what} onContinue={() => setAckFinal(true)} />;

  return (
    <View style={[s.screen, { alignItems: 'center', paddingTop: 56, paddingHorizontal: 32 }]}>
      {saved === null && (
        <View style={{ marginBottom: 16, alignSelf: 'stretch' }}>
          <Segmented
            value={method}
            onChange={(m) => {
              setMethod(m);
              setPin('');
              setMsg(null);
            }}
            options={methodOptions(method)}
          />
        </View>
      )}
      <Logo size={saved === null ? 56 : 72} />
      <Text style={[s.label, { color: left === 1 ? C.danger : C.faint, marginTop: 20 }]}>{left === 1 ? 'Final attempt' : 'Vault locked'}</Text>
      <View style={{ marginTop: 8 }}>
        <Title>{method === 'pin' ? 'Welcome back' : 'Draw your pattern'}</Title>
      </View>
      {method === 'pin' && <PinDots count={pin.length} />}
      <View style={{ marginTop: 8 }}>
        <Attempts left={left} />
      </View>
      <Text style={[s.small, { textAlign: 'center', color: C.danger, minHeight: 20, marginTop: 4 }]}>{msg ?? ' '}</Text>
      <View style={{ flex: 1 }} />
      {method === 'pin' ? (
        <KeyPad value={pin} onChange={(v) => { setMsg(null); setPin(v); }} onSubmit={() => submit(pin)} disabled={busy} />
      ) : (
        <PatternPad
          disabled={busy}
          hidePath={hideTrail}
          maxSize={300}
          onDone={(dots) => {
            // Too short is not a real try and is not counted (same as a short PIN).
            if (dots.length < MIN_PATTERN_DOTS) return setMsg(`Connect at least ${MIN_PATTERN_DOTS} dots. Not counted.`);
            setMsg(null);
            submit(patternToSecret(dots));
          }}
        />
      )}
      <Small style={{ marginTop: 22 }}>
        {method === 'pin'
          ? 'Three wrong attempts permanently destroys this vault.\nThere is no recovery.'
          : `Lock method: Pattern · trail ${hideTrail ? 'hidden' : 'visible'}\nChange it in Security Settings.`}
      </Small>
      {busy && <Busy label="Checking with the security chip…" />}
    </View>
  );
}

export function Destroyed({ cause, onNew }: { cause: 'attempts' | 'reset'; onNew: () => void }) {
  const reason = cause === 'attempts' ? 'Three wrong attempts were entered.' : 'You chose to destroy the vault.';
  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={[s.screen, { flexGrow: 1, alignItems: 'center', paddingTop: 112, paddingHorizontal: 32 }]}>
      <View style={{ width: 120, height: 120, borderRadius: 60, borderWidth: 4, borderStyle: 'dashed', borderColor: '#3A3F4A', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="close-circle-outline" size={56} color="#6B7078" />
      </View>
      <Text style={[s.label, { color: C.faint, marginTop: 32 }]}>Key destroyed</Text>
      <Text style={{ fontFamily: F.title, fontSize: 32, lineHeight: 37, color: C.ivory, marginTop: 10, textAlign: 'center' }}>This vault is sealed forever</Text>
      <Body style={{ color: C.muted, textAlign: 'center', marginTop: 14 }}>
        {reason} The encryption key was erased, so the previous files can no longer be opened by anyone.
      </Body>
      <View style={[s.card, { width: '100%', marginTop: 28, backgroundColor: '#13171F' }]}>
        <Text style={[s.small, { color: '#D9D4CA' }]}>You can start over with a new, empty vault. Nothing from the old vault will be carried across.</Text>
      </View>
      <View style={{ flex: 1, minHeight: 24 }} />
      <Button label="Create a new vault" onPress={onNew} style={{ alignSelf: 'stretch' }} />
    </ScrollView>
  );
}
