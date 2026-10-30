import { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';

import VaultCore from '../modules/vault-core';
import { C, F } from './theme';

export function Title({ children }: { children: ReactNode }) {
  return <Text style={s.title}>{children}</Text>;
}

/** A bullet with a hanging indent: wrapped lines line up with the text, not the dot. */
export function Bullet({ children }: { children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      <Text style={[s.body, { width: 18 }]}>•</Text>
      <Text style={[s.body, { flex: 1 }]}>{children}</Text>
    </View>
  );
}

/** Two or more side-by-side choices, one selected. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={s.segment}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[s.segmentItem, on && { backgroundColor: C.brass }]}
          >
            {o.icon}
            <Text style={[s.btnText, { fontSize: 14 }, on && { color: C.bg }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Body({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[s.body, style]}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.btn,
        kind === 'primary' && s.btnPrimary,
        kind === 'ghost' && s.btnGhost,
        kind === 'danger' && s.btnDanger,
        (pressed || disabled) && { opacity: disabled ? 0.4 : 0.75 },
        style,
      ]}
    >
      <Text style={[s.btnText, kind === 'primary' && { color: C.bg }]}>{label}</Text>
    </Pressable>
  );
}

export function Busy({ label }: { label: string }) {
  return (
    <View style={s.busy}>
      <ActivityIndicator color={C.brass} size="large" />
      <Body style={{ marginTop: 16, textAlign: 'center' }}>{label}</Body>
    </View>
  );
}

/** Dots show only how many digits were typed, never the PIN length (docs/POC.md §1). */
export function PinDots({ count }: { count: number }) {
  return (
    <View style={s.dots}>
      {count === 0 ? (
        <Text style={[s.body, { color: C.muted }]}>Enter PIN</Text>
      ) : (
        Array.from({ length: count }).map((_, i) => <View key={i} style={s.dot} />)
      )}
    </View>
  );
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];

export function PinPad({
  value,
  onChange,
  onSubmit,
  disabled,
  max = 32,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  max?: number;
}) {
  return (
    <View style={s.pad}>
      {KEYS.map((k) => (
        <Pressable
          key={k}
          disabled={disabled || (k === 'ok' && value.length < 4)}
          accessibilityLabel={k === 'del' ? 'Delete' : k === 'ok' ? 'Confirm' : k}
          onPress={() => {
            if (k === 'del') onChange(value.slice(0, -1));
            else if (k === 'ok') onSubmit();
            else if (value.length < max) onChange(value + k);
          }}
          style={({ pressed }) => [
            s.key,
            k === 'ok' && { borderColor: C.brass, backgroundColor: value.length >= 4 ? C.brass : 'transparent' },
            k === 'del' && { borderColor: 'transparent' },
            pressed && { backgroundColor: C.surface2 },
            (disabled || (k === 'ok' && value.length < 4)) && { opacity: 0.35 },
          ]}
        >
          <Text style={[s.keyText, k === 'ok' && { color: value.length >= 4 ? C.bg : C.brass, fontFamily: F.bold, fontSize: 16, lineHeight: 20 }]}>
            {k === 'del' ? '⌫' : k === 'ok' ? 'OK' : k}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 24, paddingTop: 56, paddingBottom: 24 },
  title: { fontFamily: F.title, fontSize: 30, color: C.ivory, marginBottom: 12 },
  body: { fontFamily: F.body, fontSize: 15, lineHeight: 22, color: C.ivory },
  small: { fontFamily: F.body, fontSize: 13, lineHeight: 19, color: C.muted },
  label: { fontFamily: F.bold, fontSize: 12, letterSpacing: 1.5, color: C.brass, textTransform: 'uppercase' },
  card: { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 16 },
  btn: { height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  btnPrimary: { backgroundColor: C.brass },
  btnGhost: { borderWidth: 1, borderColor: C.brassDim },
  btnDanger: { borderWidth: 1, borderColor: C.danger, backgroundColor: '#2A1512' },
  btnText: { fontFamily: F.bold, fontSize: 16, color: C.ivory },
  busy: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(11,13,18,0.92)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  dots: { height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 10 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: C.brass },
  pad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14, marginTop: 8 },
  key: { width: '30%', aspectRatio: 1.45, borderRadius: 40, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  // Inter has even line metrics, so digits sit in the middle of the key on iOS too.
  keyText: { fontFamily: F.medium, fontSize: 28, lineHeight: 34, color: C.ivory, textAlign: 'center', includeFontPadding: false },
  segment: { flexDirection: 'row', backgroundColor: C.surface, borderRadius: 24, borderWidth: 1, borderColor: C.line, padding: 4, gap: 4 },
  segmentItem: { flex: 1, height: 40, borderRadius: 20, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  testBanner: { backgroundColor: '#2A1512', borderColor: C.danger, borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 16 },
});

export function TestBanner() {
  // The preview is meant to look like the finished app, so it shows no banner.
  if (VaultCore.isDemo) return null;
  return (
    <View style={s.testBanner}>
      <Text style={[s.small, { color: '#F3B7AA' }]}>
        {VaultCore.isDemo
          ? 'PREVIEW — nothing is encrypted here. Screens only; everything is forgotten when the app closes.'
          : 'TEST BUILD — do not store real photos. 3 wrong PINs permanently erase everything.'}
      </Text>
    </View>
  );
}
