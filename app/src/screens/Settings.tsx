import Ionicons from '@expo/vector-icons/Ionicons';
import { ReactNode, useEffect, useState } from 'react';
import { Alert, BackHandler, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import VaultCore, { VaultItem, VaultStatus } from '../../modules/vault-core';
import { readHideTrail, readLockMethod, saveHideTrail } from '../pattern';
import { FREE_LIMIT, restorePremium, usePremium } from '../premium';
import { C, F } from '../theme';
import { spacing, t, tn, UPPERCASE } from '../i18n';
import { Busy, Button, Rich, s, TestBanner } from '../ui';
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
  const footer = items ? `${tn('settings.items', items.length)}${total > 0 ? ` · ${sizeLabel(total)}` : ''}` : '';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={st.page}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Pressable accessibilityLabel={t('common.back')} onPress={onBack} style={({ pressed }) => [st.round, pressed && { opacity: 0.7 }]}>
          <Ionicons name="chevron-back" size={20} color={C.ivory} />
        </Pressable>
        <Text style={st.title}>{t('settings.title')}</Text>
      </View>
      <TestBanner />

      <View style={st.sealed}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text style={st.sealedTitle}>{t('settings.sealed')}</Text>
          {status && <Text style={{ fontFamily: F.body, fontSize: 12, color: hardware ? OK_GREEN : C.faint }}>{hardware ? t('settings.allPassed') : t('settings.softwareKey')}</Text>}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 }}>
          <Check label={t('settings.hardwareKey')} ok={hardware} />
          <Check label={t('settings.backupsExcluded')} ok />
          <Check label={t('settings.noNetwork')} ok />
          <Check label={t('settings.screenshotsBlocked')} ok />
        </View>
      </View>

      <Text style={st.section}>{t('settings.locking')}</Text>
      <View style={st.group}>
        <Row label={t('settings.lockWhenLeaves')} value={t('settings.always')} last={method !== 'pattern'} />
        {method === 'pattern' && (
          <Row label={t('settings.hideTrail')} last>
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

      <Text style={st.section}>{t('settings.key')}</Text>
      <View style={st.group}>
        <Row label={t('settings.unlockWith')} value={method === 'pin' ? t('common.pin') : method === 'pattern' ? t('common.pattern') : t('settings.unknown')} />
        <Row label={t('settings.attemptsLeft')} value={status ? t('settings.attemptsValue', { left: status.remainingAttempts, max: MAX_ATTEMPTS }) : '…'} last />
      </View>

      <Text style={st.section}>{t('plan.section')}</Text>
      <View style={st.group}>
        <LinkRow
          label={plan.premium ? t('plan.premium') : t('plan.free')}
          value={plan.premium ? t('plan.unlimited') : items ? t('plan.used', { used: Math.min(items.length, FREE_LIMIT), max: FREE_LIMIT }) : undefined}
          onPress={onPremium}
        />
        <LinkRow
          label={t('plan.restore')}
          value={restoring ? t('plan.checking') : undefined}
          last
          onPress={async () => {
            if (restoring) return;
            setRestoring(true);
            suspendAutoLock(true);
            const premium = await restorePremium().finally(() => suspendAutoLock(false));
            setRestoring(false);
            const account = Platform.OS === 'ios' ? t('plan.accountApple') : t('plan.accountGoogle');
            Alert.alert(premium ? t('plan.restored') : t('plan.nothing'), premium ? t('plan.restoredBody') : t('plan.nothingBody', { account }));
          }}
        />
      </View>

      <Text style={st.section}>{t('settings.newPhone')}</Text>
      <View style={st.group}>
        <LinkRow label={t('transfer.title')} value={t('transfer.free')} last onPress={onTransfer} />
      </View>

      {!!footer && <Text style={st.footer}>{footer}</Text>}

      <Pressable accessibilityRole="link" onPress={() => setShowTerms(true)} style={{ paddingVertical: 12 }}>
        <Text style={[s.small, { color: C.brass, textDecorationLine: 'underline' }]}>{t('common.termsOfUse')}</Text>
      </Pressable>
      <TermsSheet visible={showTerms} onClose={() => setShowTerms(false)} />

      <View style={{ flex: 1, minHeight: 16 }} />
      <Pressable accessibilityRole="button" onPress={() => setView('reset')} style={({ pressed }) => [st.destroyBtn, pressed && { opacity: 0.75 }]}>
        <Text style={{ fontFamily: F.bold, fontSize: 15, color: C.danger }}>{t('settings.destroyAll')}</Text>
      </Pressable>
    </ScrollView>
  );
}

let destroying = false;

/**
 * The user must type the confirmation word: the English DESTROY or the translated one.
 * Case, spaces and Unicode form do not matter (Hindi candrabindu and anusvara are treated alike).
 */
const squash = (v: string) => v.normalize('NFC').replace(/\s+/g, '').replace(/\u0901/g, '\u0902').toLocaleUpperCase();
export function matchesConfirmWord(input: string): boolean {
  const typed = squash(input);
  if (typed.length === 0) return false;
  const local = squash(t('reset.word'));
  return typed === 'DESTROY' || (local.length >= 2 && typed === local);
}

function VaultReset({ count, onCancel, onDestroyed }: { count: number | null; onCancel: () => void; onDestroyed: () => void }) {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = matchesConfirmWord(confirm);

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
      Alert.alert(t('reset.failed'), t('reset.failedBody'));
    } finally {
      destroying = false;
    }
  };


  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={[st.page, { paddingTop: 64, gap: 18 }]} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 8 }}>
          <Text style={[s.label, { color: C.danger }]}>{t('reset.label')}</Text>
          <Text style={[st.title, { fontSize: 34, lineHeight: 40 }]} lineBreakStrategyIOS="hangul-word">{t('reset.title')}</Text>
          <Text style={st.body}>
            {count === null || count <= 0 ? t('reset.bodyAll') : tn('reset.bodyCount', count)}
          </Text>
        </View>
        <View style={st.warn}>
          {[t('reset.cannotUndo'), t('reset.originals')].map((p) => (
            <View key={p} style={{ flexDirection: 'row', gap: 10 }}>
              <Text style={{ color: C.danger, fontSize: 13, lineHeight: 20 }}>—</Text>
              <Text style={{ flex: 1, fontFamily: F.body, fontSize: 13, lineHeight: 20, color: '#E8D2C4' }}>{p}</Text>
            </View>
          ))}
        </View>
        <View style={{ gap: 8 }}>
          <Rich text={t('reset.type', { word: t('reset.word') })} style={[s.small, { fontSize: 12 }]} strongStyle={{ color: C.ivory, fontFamily: F.bold, letterSpacing: spacing(1) }} />
          <TextInput
            value={confirm}
            onChangeText={setConfirm}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            placeholder={t('reset.word')}
            placeholderTextColor={C.outline}
            style={st.input}
          />
        </View>
        <View style={{ flex: 1, minHeight: 12 }} />
        <View style={{ gap: 12 }}>
          <Button label={t('reset.destroy')} kind="danger" disabled={!ready} onPress={destroy} />
          <Button label={t('common.cancel')} kind="ghost" onPress={onCancel} style={{ height: 48 }} />
        </View>
      </ScrollView>
      {busy && <Busy label={t('reset.destroying')} />}
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
  checkText: { fontFamily: F.body, fontSize: 12, color: '#D9D4CA', flexShrink: 1 },
  section: { marginTop: 4, marginBottom: -6, marginLeft: 4, fontFamily: F.body, fontSize: 11, letterSpacing: spacing(2), textTransform: UPPERCASE, color: C.faint },
  group: { borderRadius: 16, backgroundColor: '#13171F', borderWidth: 1, borderColor: C.line },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52, paddingHorizontal: 16, gap: 12 },
  rowLabel: { fontFamily: F.body, fontSize: 14, color: C.ivory, flexShrink: 1 },
  rowValue: { fontFamily: F.body, fontSize: 13, color: C.muted },
  footer: { paddingHorizontal: 4, fontFamily: F.body, fontSize: 12, color: C.faint },
  destroyBtn: { height: 52, borderRadius: 14, borderWidth: 1, borderColor: '#6A3A24', backgroundColor: '#1A110C', alignItems: 'center', justifyContent: 'center' },
  warn: { padding: 16, borderRadius: 16, backgroundColor: '#1A110C', borderWidth: 1, borderColor: '#6A3A24', gap: 10 },
  input: { height: 52, borderRadius: 12, borderWidth: 1, borderColor: C.outline, backgroundColor: '#13171F', color: C.ivory, fontFamily: F.bold, fontSize: 17, letterSpacing: spacing(3), paddingHorizontal: 16 },
});
