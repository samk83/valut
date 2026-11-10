import Ionicons from '@expo/vector-icons/Ionicons';
import { ReactNode, useEffect, useState } from 'react';
import { Alert, BackHandler, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import VaultCore, { VaultItem, VaultStatus } from '../../modules/vault-core';
import { readHideTrail, readLockMethod, saveHideTrail } from '../pattern';
import { FREE_LIMIT, restorePremium, usePremium } from '../premium';
import { C, F } from '../theme';
import { Busy, Button, s, TestBanner } from '../ui';
import { TermsSheet } from './Terms';

const MAX_ATTEMPTS = 3;
const OK_GREEN = '#9FD3A8';
// Android: StrongBox or TEE (Keystore). iPhone/iPad: the Secure Enclave.
const HARDWARE_LEVELS = ['StrongBox', 'TEE', 'Secure hardware', 'SECURE_ENCLAVE'];

const sizeLabel = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

function Row({ label, value, last, children }: { label: string; value?: string; last?: boolean; children?: ReactNode }) {
  return (
    <View style={[st.row, !last && { borderBottomWidth: 1, borderColor: C.line }]}>
      <Text style={st.rowLabel}>{label}</Text>
      {children ?? <Text style={st.rowValue}>{value}</Text>}
    </View>
  );
}

function Check({ label, ok }: { label: string; ok: boolean }) {
  return (
    <View style={st.check}>
      <Text style={{ color: ok ? OK_GREEN : C.danger, fontSize: 12 }}>{ok ? '✓' : '!'}</Text>
      <Text style={st.checkText}>{label}</Text>
    </View>
  );
}

/** A tappable settings row with a chevron. */
function LinkRow({ label, value, last, onPress }: { label: string; value?: string; last?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [st.row, !last && { borderBottomWidth: 1, borderColor: C.line }, pressed && { opacity: 0.7 }]}>
      <Text style={st.rowLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {!!value && <Text style={st.rowValue}>{value}</Text>}
        <Ionicons name="chevron-forward" size={16} color={C.faint} />
      </View>
    </Pressable>
  );
}

export function Settings({
  onBack,
  onDestroyed,
  onPremium,
  onTransfer,
  suspendAutoLock,
}: {
  onBack: () => void;
  onDestroyed: () => void;
  onPremium: () => void;
  onTransfer: () => void;
  suspendAutoLock: (on: boolean) => void;
}) {
  const plan = usePremium();
  const [restoring, setRestoring] = useState(false);
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [items, setItems] = useState<VaultItem[] | null>(null);
  const [view, setView] = useState<'main' | 'reset'>('main');
  const method = readLockMethod();
  const [hideTrail, setHideTrail] = useState(() => readHideTrail());
  const [showTerms, setShowTerms] = useState(false);

  useEffect(() => {
    VaultCore.status().then(setStatus).catch(() => {});
    VaultCore.list().then(setItems).catch(() => {});
  }, []);

  // The hardware back button leaves the reset view first, not the whole settings screen.
  useEffect(() => {
    if (view !== 'reset') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!destroying) setView('main');
      return true;
    });
    return () => sub.remove();
  }, [view]);

  if (view === 'reset') return <VaultReset count={items?.length ?? null} onCancel={() => setView('main')} onDestroyed={onDestroyed} />;

  const hardware = !!status && HARDWARE_LEVELS.includes(status.hardware);
  const total = items ? items.reduce((n, i) => n + (i.size || 0), 0) : 0;
  const footer = items ? `${items.length} ${items.length === 1 ? 'item' : 'items'}${total > 0 ? ` · ${sizeLabel(total)}` : ''}` : '';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={st.page}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Pressable accessibilityLabel="Back" onPress={onBack} style={({ pressed }) => [st.round, pressed && { opacity: 0.7 }]}>
          <Ionicons name="chevron-back" size={20} color={C.ivory} />
        </Pressable>
        <Text style={st.title}>Security</Text>
      </View>
      <TestBanner />

      <View style={st.sealed}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text style={st.sealedTitle}>Vault sealed</Text>
          {status && <Text style={{ fontFamily: F.body, fontSize: 12, color: hardware ? OK_GREEN : C.faint }}>{hardware ? 'All checks passed' : 'Software key'}</Text>}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 }}>
          <Check label="Hardware key" ok={hardware} />
          <Check label="Backups excluded" ok />
          <Check label="No cloud, no servers" ok />
          <Check label="Screenshots blocked" ok />
        </View>
      </View>

      <Text style={st.section}>Locking</Text>
      <View style={st.group}>
        <Row label="Lock when app leaves screen" value="Always" last={method !== 'pattern'} />
        {method === 'pattern' && (
          <Row label="Hide pattern trail" last>
            <Switch
              value={hideTrail}
              onValueChange={(v) => {
                setHideTrail(v);
                saveHideTrail(v);
              }}
              trackColor={{ false: C.outline, true: C.brassDim }}
              thumbColor={hideTrail ? C.brass : C.muted}
            />
          </Row>
        )}
      </View>

      <Text style={st.section}>Key</Text>
      <View style={st.group}>
        <Row label="Unlock with" value={method === 'pin' ? 'PIN' : method === 'pattern' ? 'Pattern' : 'Unknown'} />
        <Row label="Attempts left" value={status ? `${status.remainingAttempts} of ${MAX_ATTEMPTS}` : '…'} last />
      </View>

      <Text style={st.section}>Plan</Text>
      <View style={st.group}>
        <LinkRow
          label={plan.premium ? 'Premium' : 'Free plan'}
          value={plan.premium ? 'Unlimited' : items ? `${Math.min(items.length, FREE_LIMIT)} of ${FREE_LIMIT} used` : undefined}
          onPress={onPremium}
        />
        <LinkRow
          label="Restore purchases"
          value={restoring ? 'Checking…' : undefined}
          last
          onPress={async () => {
            if (restoring) return;
            setRestoring(true);
            suspendAutoLock(true);
            const premium = await restorePremium().finally(() => suspendAutoLock(false));
            setRestoring(false);
            const account = Platform.OS === 'ios' ? 'Apple ID' : 'Google account';
            Alert.alert(premium ? 'Premium restored' : 'Nothing to restore', premium ? 'Unlimited storage is on.' : `No Premium purchase was found for this ${account}.`);
          }}
        />
      </View>

      <Text style={st.section}>New phone</Text>
      <View style={st.group}>
        <LinkRow label="Move to a new phone" value="Free" last onPress={onTransfer} />
      </View>

      {!!footer && <Text style={st.footer}>{footer}</Text>}

      <Pressable accessibilityRole="link" onPress={() => setShowTerms(true)} style={{ paddingVertical: 12 }}>
        <Text style={[s.small, { color: C.brass, textDecorationLine: 'underline' }]}>Terms of Use</Text>
      </Pressable>
      <TermsSheet visible={showTerms} onClose={() => setShowTerms(false)} />

      <View style={{ flex: 1, minHeight: 16 }} />
      <Pressable accessibilityRole="button" onPress={() => setView('reset')} style={({ pressed }) => [st.destroyBtn, pressed && { opacity: 0.75 }]}>
        <Text style={{ fontFamily: F.bold, fontSize: 15, color: C.danger }}>Destroy entire vault</Text>
      </Pressable>
    </ScrollView>
  );
}

let destroying = false;

function VaultReset({ count, onCancel, onDestroyed }: { count: number | null; onCancel: () => void; onDestroyed: () => void }) {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = confirm.trim().toUpperCase() === 'DESTROY';

  const destroy = async () => {
    // Ignore repeat taps and Back while the keys are being destroyed.
    if (destroying) return;
    destroying = true;
    setBusy(true);
    try {
      await VaultCore.destroy();
      onDestroyed();
    } catch {
      setBusy(false);
      Alert.alert('Reset failed', 'The vault could not be destroyed. Try again.');
    } finally {
      destroying = false;
    }
  };

  const all = count === null ? 'all items' : count === 1 ? 'the 1 item' : `all ${count} items`;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={[st.page, { paddingTop: 64, gap: 18 }]} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 8 }}>
          <Text style={[s.label, { color: C.danger }]}>Destroy vault</Text>
          <Text style={[st.title, { fontSize: 34, lineHeight: 40 }]}>Erase everything?</Text>
          <Text style={st.body}>
            {`The master key is destroyed first, so ${all} become${count === 1 ? 's' : ''} unreadable at once. Then the encrypted files are cleared and a new, empty vault is created.`}
          </Text>
        </View>
        <View style={st.warn}>
          {['This cannot be undone, by you or by us.', 'Originals you already removed from Photos will not come back.'].map((p) => (
            <View key={p} style={{ flexDirection: 'row', gap: 10 }}>
              <Text style={{ color: C.danger, fontSize: 13, lineHeight: 20 }}>—</Text>
              <Text style={{ flex: 1, fontFamily: F.body, fontSize: 13, lineHeight: 20, color: '#E8D2C4' }}>{p}</Text>
            </View>
          ))}
        </View>
        <View style={{ gap: 8 }}>
          <Text style={[s.small, { fontSize: 12 }]}>
            Type <Text style={{ color: C.ivory, fontFamily: F.bold, letterSpacing: 1 }}>DESTROY</Text> to continue
          </Text>
          <TextInput
            value={confirm}
            onChangeText={setConfirm}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            placeholder="DESTROY"
            placeholderTextColor={C.outline}
            style={st.input}
          />
        </View>
        <View style={{ flex: 1, minHeight: 12 }} />
        <View style={{ gap: 12 }}>
          <Button label="Destroy vault" kind="danger" disabled={!ready} onPress={destroy} />
          <Button label="Cancel" kind="ghost" onPress={onCancel} style={{ height: 48 }} />
        </View>
      </ScrollView>
      {busy && <Busy label="Destroying…" />}
    </View>
  );
}

const st = StyleSheet.create({
  page: { flexGrow: 1, paddingTop: 56, paddingHorizontal: 20, paddingBottom: 28, gap: 16 },
  round: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: '#2A2F3A', backgroundColor: '#12151C', alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: F.title, fontSize: 28, lineHeight: 34, color: C.ivory },
  body: { fontFamily: F.body, fontSize: 14, lineHeight: 23, color: C.muted },
  sealed: { padding: 16, borderRadius: 16, backgroundColor: '#1E1A12', borderWidth: 1, borderColor: '#4A3E28', gap: 10 },
  sealedTitle: { fontFamily: F.title, fontSize: 18, color: '#E6CFA0' },
  check: { width: '50%', flexDirection: 'row', alignItems: 'center', gap: 6 },
  checkText: { fontFamily: F.body, fontSize: 12, color: '#D9D4CA' },
  section: { marginTop: 4, marginBottom: -6, marginLeft: 4, fontFamily: F.body, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: C.faint },
  group: { borderRadius: 16, backgroundColor: '#13171F', borderWidth: 1, borderColor: C.line },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52, paddingHorizontal: 16, gap: 12 },
  rowLabel: { fontFamily: F.body, fontSize: 14, color: C.ivory, flexShrink: 1 },
  rowValue: { fontFamily: F.body, fontSize: 13, color: C.muted },
  footer: { paddingHorizontal: 4, fontFamily: F.body, fontSize: 12, color: C.faint },
  destroyBtn: { height: 52, borderRadius: 14, borderWidth: 1, borderColor: '#6A3A24', backgroundColor: '#1A110C', alignItems: 'center', justifyContent: 'center' },
  warn: { padding: 16, borderRadius: 16, backgroundColor: '#1A110C', borderWidth: 1, borderColor: '#6A3A24', gap: 10 },
  input: { height: 52, borderRadius: 12, borderWidth: 1, borderColor: C.outline, backgroundColor: '#13171F', color: C.ivory, fontFamily: F.bold, fontSize: 17, letterSpacing: 3, paddingHorizontal: 16 },
});
