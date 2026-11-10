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
import { Key, t, tn } from '../i18n';
import { Body, Busy, Button, PinDots, Rich, s, Segmented, Title } from '../ui';
import { TermsSheet } from './Terms';

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
              accessibilityLabel={k === 'del' ? t('common.delete') : k === 'ok' ? t('common.confirm') : k}
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
    { value: 'pin' as const, label: t('common.pin'), icon: <Ionicons name="keypad-outline" size={16} color={value === 'pin' ? C.brass : C.faint} /> },
    { value: 'pattern' as const, label: t('common.pattern'), icon: <Ionicons name="git-network-outline" size={16} color={value === 'pattern' ? C.brass : C.faint} /> },
  ];
}

export function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={[s.screen, { flexGrow: 1, paddingTop: 72, paddingHorizontal: 28 }]}>
      <Logo size={72} tile />
      <Text style={[s.label, { marginTop: 32 }]}>{t('welcome.step')}</Text>
      <Text style={{ fontFamily: F.title, fontSize: 40, lineHeight: 44, color: C.ivory, marginTop: 10 }}>{t('welcome.title')}</Text>
      <View style={{ gap: 16, marginTop: 28 }}>
        <Point title={t('welcome.encryptedTitle')} sub={t('welcome.encryptedSub')} />
        <Point title={t('welcome.nothingTitle')} sub={t('welcome.nothingSub')} />
        <Point title={t('welcome.noRecoveryTitle')} sub={t('welcome.noRecoverySub')} color={C.danger} />
      </View>
      <View style={{ flex: 1, minHeight: 32 }} />
      <Button label={t('welcome.create')} onPress={onNext} />
      <Small style={{ marginTop: 14 }}>{t('welcome.requires')}</Small>
    </ScrollView>
  );
}

const REJECTION_KEY: Record<string, Key> = {
  TOO_SHORT: 'pin.tooShort',
  TOO_LONG: 'pin.tooLong',
  REPEATED: 'pin.repeated',
  SEQUENTIAL: 'pin.sequential',
  COMMON: 'pin.common',
  NOT_DIGITS: 'pin.notDigits',
};
const rejection = (code: string | null | undefined) => (code && REJECTION_KEY[code] ? t(REJECTION_KEY[code]) : code ? t('pin.common') : null);

const STRENGTH: Record<string, { word: Key; bars: number; color: string; note: Key }> = {
  WEAK: { word: 'strength.weak', bars: 1, color: C.danger, note: 'strength.weakNote' },
  FAIR: { word: 'strength.fair', bars: 2, color: C.brass, note: 'strength.fairNote' },
  STRONG: { word: 'strength.strong', bars: 3, color: C.ok, note: 'strength.strongNote' },
  FORTRESS: { word: 'strength.fortress', bars: 4, color: C.ok, note: 'strength.fortressNote' },
};

function StrengthCard({ check }: { check: ReturnType<typeof VaultCore.checkPin> | null }) {
  const level = check ? STRENGTH[check.strength] : null;
  const rejected = rejection(check?.rejection);
  const filled = rejected ? 0 : (level?.bars ?? 0);
  return (
    <View style={[s.card, { gap: 10 }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Caption>{t('strength.title')}</Caption>
        <Text style={{ fontFamily: F.title, fontSize: 18, color: rejected ? C.danger : (level?.color ?? C.faint) }}>{rejected ? t('strength.notAllowed') : level ? t(level.word) : '—'}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < filled ? (level?.color ?? C.brass) : C.line }} />
        ))}
      </View>
      <Text style={[s.small, { fontSize: 12, color: rejected ? C.danger : C.muted }]}>{rejected ?? (level ? t(level.note) : t('strength.atLeast4'))}</Text>
    </View>
  );
}

export function CreatePin({ onDone, onLocked }: { onDone: () => void; onLocked: () => void }) {
  const [method, setMethod] = useState<LockMethod>('pin');
  const [first, setFirst] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [agree, setAgree] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
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
      if (check?.rejection) return setError(rejection(check.rejection));
      setFirst(value);
      setPin('');
      return;
    }
    if (value !== first) {
      setFirst(null);
      setPin('');
      return setError(t(method === 'pin' ? 'create.pinMismatch' : 'create.patternMismatch'));
    }
    if (!agree) return setError(t('create.mustAgree'));
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
    else if (r.error === 'WEAK_PIN') setError(method === 'pin' ? rejection(r.reason) : t('create.patternTooSimple'));
    else if (r.error === 'EXISTS' || r.error === 'INTERRUPTED') onLocked();
    else setError(t('create.failed', { error: r.error }));
  };

  const drawn = (dots: number[]) => {
    if (dots.length < MIN_PATTERN_DOTS) {
      const n = dots.length;
      return setError(tn('create.tooFewDots', n, { min: MIN_PATTERN_DOTS }));
    }
    submit(patternToSecret(dots));
  };

  const sub =
    method === 'pin'
      ? first === null
        ? t('create.subPin')
        : t('create.subPinConfirm')
      : first === null
        ? t('create.subPattern', { n: MIN_PATTERN_DOTS })
        : t('create.subPatternConfirm');

  // Pattern status line: live count while drawing, then any error.
  const patternStatus = drawing > 0 ? tn('create.dotsConnected', drawing) : null;
  const status = method === 'pattern' ? (patternStatus ?? error) : error;

  return (
    <View style={[s.screen, { paddingTop: 48, paddingHorizontal: 24, paddingBottom: 20 }]}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 16, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 8 }}>
          <Text style={s.label}>{t('create.step', { n: first === null ? 2 : 3 })}</Text>
          <Text style={{ fontFamily: F.title, fontSize: 34, lineHeight: 38, color: C.ivory }}>{t('create.title')}</Text>
          <Text style={[s.small, { fontSize: 14, lineHeight: 21 }]}>{sub}</Text>
        </View>
        {first === null && (
          <View style={{ gap: 8 }}>
            <Caption>{t('create.lockMethod')}</Caption>
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
          <Text style={{ fontFamily: F.title, fontSize: 18, color: '#F0B98A' }}>{t('create.warnTitle')}</Text>
          <Text style={[s.small, { fontSize: 12, color: '#D4C4B5' }]}>{t('create.warnBody')}</Text>
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
          <Rich
            text={t('create.agree')}
            style={[s.small, { flex: 1, color: C.ivory }]}
            strongStyle={{ color: C.brass, textDecorationLine: 'underline' }}
            strongRole="link"
            onStrongPress={() => setShowTerms(true)}
          />
        </Pressable>
        <TermsSheet visible={showTerms} onClose={() => setShowTerms(false)} />
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
      {busy && <Busy label={t('create.sealing')} />}
    </View>
  );
}

function Attempts({ left }: { left: number }) {
  return (
    <Rich text={t('unlock.attempts', { left })} style={[s.small, { textAlign: 'center' }]} strongStyle={{ color: C.brass, fontFamily: F.bold }} />
  );
}

const Dash = ({ children }: { children: ReactNode }) => (
  <View style={{ flexDirection: 'row', gap: 12 }}>
    <Text style={[s.small, { color: C.brass }]}>—</Text>
    <Text style={[s.small, { flex: 1, color: '#D9D4CA' }]}>{children}</Text>
  </View>
);

function FinalWarning({ method, onContinue }: { method: LockMethod; onContinue: () => void }) {
  const [paused, setPaused] = useState(false);
  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={[s.screen, { flexGrow: 1, alignItems: 'center', paddingTop: 96, paddingHorizontal: 32 }]}>
      <View style={{ width: 120, height: 120, borderRadius: 60, borderWidth: 4, borderColor: C.outline, borderTopColor: C.danger, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: F.title, fontSize: 40, lineHeight: 48, color: C.ivory, includeFontPadding: false }}>1</Text>
      </View>
      <Text style={[s.label, { color: C.danger, marginTop: 26 }]}>{t('unlock.finalAttempt')}</Text>
      <Text style={{ fontFamily: F.title, fontSize: 32, lineHeight: 37, color: C.ivory, marginTop: 10, textAlign: 'center' }}>{t('final.oneTry')}</Text>
      <Body style={{ color: C.muted, textAlign: 'center', marginTop: 14 }}>
        {t(method === 'pin' ? 'final.bodyPin' : 'final.bodyPattern')}
      </Body>
      <View style={[s.card, { width: '100%', gap: 12, marginTop: 28 }]}>
        <Dash>{t('final.slowly')}</Dash>
        <Dash>{t('final.incomplete')}</Dash>
        <Dash>{t('final.noOne')}</Dash>
      </View>
      <View style={{ flex: 1, minHeight: 24 }} />
      <View style={{ width: '100%', gap: 12 }}>
        {paused && <Small>{t('final.paused')}</Small>}
        <Button label={t('final.continue')} kind="light" onPress={onContinue} />
        <Button label={t('final.notNow')} kind="ghost" onPress={() => setPaused(true)} style={{ height: 48 }} />
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
        setMsg(t(method === 'pin' ? 'unlock.wrongPin' : 'unlock.wrongPattern'));
        break;
      case 'DESTROYED':
        onDestroyed();
        break;
      case 'INCOMPLETE':
        setMsg(method === 'pin' ? t('unlock.incompletePin') : t('unlock.incompletePattern', { n: MIN_PATTERN_DOTS }));
        break;
      case 'KEYS_UNAVAILABLE':
        setMsg(t('unlock.keysUnavailable'));
        break;
      case 'OUT_OF_MEMORY':
        setMsg(t('unlock.outOfMemory'));
        break;
      default:
        // The count may have changed (or the vault been destroyed) without a clear answer.
        VaultCore.status()
          .then((st) => (st.exists ? setLeft(st.remainingAttempts) : onDestroyed()))
          .catch(() => {});
        setMsg(t('unlock.error'));
    }
  };

  if (left === 1 && !ackFinal) return <FinalWarning method={method} onContinue={() => setAckFinal(true)} />;

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
      <Text style={[s.label, { color: left === 1 ? C.danger : C.faint, marginTop: 20 }]}>{left === 1 ? t('unlock.finalAttempt') : t('unlock.locked')}</Text>
      <View style={{ marginTop: 8 }}>
        <Title>{method === 'pin' ? t('unlock.welcomeBack') : t('unlock.drawPattern')}</Title>
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
            if (dots.length < MIN_PATTERN_DOTS) return setMsg(t('unlock.incompletePattern', { n: MIN_PATTERN_DOTS }));
            setMsg(null);
            submit(patternToSecret(dots));
          }}
        />
      )}
      <Small style={{ marginTop: 22 }}>
        {method === 'pin'
          ? t('unlock.footerPin')
          : t(hideTrail ? 'unlock.footerPatternHidden' : 'unlock.footerPatternVisible')}
      </Small>
      {busy && <Busy label={t('unlock.checking')} />}
    </View>
  );
}

export function Destroyed({ cause, onNew }: { cause: 'attempts' | 'reset'; onNew: () => void }) {
  const reason = cause === 'attempts' ? t('destroyed.attempts') : t('destroyed.reset');
  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={[s.screen, { flexGrow: 1, alignItems: 'center', paddingTop: 112, paddingHorizontal: 32 }]}>
      <View style={{ width: 120, height: 120, borderRadius: 60, borderWidth: 4, borderStyle: 'dashed', borderColor: '#3A3F4A', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="close-circle-outline" size={56} color="#6B7078" />
      </View>
      <Text style={[s.label, { color: C.faint, marginTop: 32 }]}>{t('destroyed.label')}</Text>
      <Text style={{ fontFamily: F.title, fontSize: 32, lineHeight: 37, color: C.ivory, marginTop: 10, textAlign: 'center' }}>{t('destroyed.title')}</Text>
      <Body style={{ color: C.muted, textAlign: 'center', marginTop: 14 }}>
        {reason} {t('destroyed.body')}
      </Body>
      <View style={[s.card, { width: '100%', marginTop: 28, backgroundColor: '#13171F' }]}>
        <Text style={[s.small, { color: '#D9D4CA' }]}>{t('destroyed.startOver')}</Text>
      </View>
      <View style={{ flex: 1, minHeight: 24 }} />
      <Button label={t('destroyed.new')} onPress={onNew} style={{ alignSelf: 'stretch' }} />
    </ScrollView>
  );
}
