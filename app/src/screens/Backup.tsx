import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { useKeepAwake } from 'expo-keep-awake';
import { ReactNode, useEffect, useState } from 'react';
import { BackHandler, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';

import VaultCore, { BackupEvent, BackupStatus } from '../../modules/vault-core';
import { autoBackup, backupErrorText, confirmOwner, pickFolder } from '../backup';
import { t, tn } from '../i18n';
import { C } from '../theme';
import { Body, Bullet, Busy, Button, s, Title } from '../ui';

/**
 * Encrypted backup + recovery key (owner decision 2026-11-12): photos survive deleting the
 * app or losing the phone. The backup goes to a folder the user picks (iCloud Drive, Files,
 * an Android folder); nothing goes to a server. Only the recovery key opens it.
 */

function Page({ children, footer, onBack }: { children: ReactNode; footer?: ReactNode; onBack?: () => void }) {
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: 56,
          paddingHorizontal: 24,
          paddingBottom: 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {onBack && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            onPress={onBack}
            style={{
              alignSelf: 'flex-start',
              padding: 8,
              marginLeft: -8,
              marginBottom: 12,
            }}
          >
            <Ionicons name="chevron-back" size={26} color={C.ivory} />
          </Pressable>
        )}
        {children}
      </ScrollView>
      {footer && (
        <View
          style={{
            paddingHorizontal: 24,
            paddingTop: 12,
            paddingBottom: 30,
            gap: 10,
          }}
        >
          {footer}
        </View>
      )}
    </View>
  );
}

function useBack(handler: () => void) {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handler();
      return true;
    });
    return () => sub.remove();
  });
}

/** The key as large monospaced groups, easy to copy by hand. */
function KeyCard({ text }: { text: string }) {
  const groups = text.split('-');
  return (
    <View
      accessible
      accessibilityLabel={text}
      style={[
        s.card,
        {
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: 10,
          paddingVertical: 20,
        },
      ]}
    >
      {groups.map((g, i) => (
        <Text
          key={i}
          selectable
          style={{
            fontFamily: 'Courier',
            fontWeight: '700',
            fontSize: 20,
            letterSpacing: 2,
            color: C.ivory,
            width: 74,
            textAlign: 'center',
          }}
        >
          {g}
        </Text>
      ))}
    </View>
  );
}

function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => onChange(!checked)} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: C.brass,
          backgroundColor: checked ? C.brass : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked && <Ionicons name="checkmark" size={16} color={C.bg} />}
      </View>
      <Text style={[s.small, { flex: 1, color: C.ivory }]}>{label}</Text>
    </Pressable>
  );
}

const lastGroup = (key: string) => key.split('-').pop() ?? '';
const clean = (v: string) => v.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

/**
 * Backup settings and first-time setup. With no key or no folder yet it walks through the
 * setup (key → check → folder); afterwards it shows the backup's state.
 */
/** Copy and Share for the recovery key text (screenshots are blocked in the app). */
function KeyActions({ text, suspendAutoLock }: { text: string; suspendAutoLock: (on: boolean) => void }) {
  const [copied, setCopied] = useState(false);
  const action = (icon: 'copy-outline' | 'share-outline', label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [{ flexDirection: 'row', gap: 8, alignItems: 'center', padding: 12 }, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name={icon} size={18} color={C.brass} />
      <Text style={[s.small, { color: C.brass }]}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
        {action('copy-outline', t('backup.copy'), () => {
          Clipboard.setStringAsync(text)
            .then(() => setCopied(true))
            .catch(() => {});
        })}
        {action('share-outline', t('backup.share'), () => {
          // The share sheet must not lock the vault and throw the user out of setup.
          suspendAutoLock(true);
          Share.share({ message: text })
            .catch(() => {})
            .finally(() => suspendAutoLock(false));
        })}
      </View>
      {copied && <Text style={[s.small, { color: C.muted, textAlign: 'center' }]}>{t('backup.copied')}</Text>}
    </View>
  );
}

export function Backup({ onClose, suspendAutoLock, intro }: { onClose: () => void; suspendAutoLock: (on: boolean) => void; intro?: boolean }) {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [step, setStep] = useState<'loading' | 'key' | 'confirm' | 'folder' | 'manage' | 'restore'>('loading');
  const [key, setKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  // Right after making the vault the user has just entered their PIN; later the key is only
  // shown after Face ID or the phone passcode (owner request 2026-11-13).
  const [ownerOk, setOwnerOk] = useState(!!intro);
  const [authFailed, setAuthFailed] = useState(false);

  const askOwner = async () => {
    setAuthFailed(false);
    const ok = await confirmOwner(suspendAutoLock);
    setAuthFailed(!ok);
    if (ok) setOwnerOk(true);
    return ok;
  };

  const refresh = async () => {
    const st = await VaultCore.backupStatus().catch(() => null);
    setStatus(st);
    return st;
  };

  useEffect(() => {
    VaultCore.backupStatus()
      .catch(() => null)
      .then((st) => {
        setStatus(st);
        if (!st) return setStep('manage');
        // Until the user has checked their copy of the key, setup starts at the key again.
        setStep(st.restorePending ? 'restore' : !st.hasRecoveryKey || !st.keyConfirmed ? 'key' : !st.folderName ? 'folder' : 'manage');
      });
    // A backup finishing while this screen is open updates it.
    const sub = VaultCore.onBackup((e: BackupEvent) => {
      if (e.phase === 'backup-done' || e.phase === 'backup-error') refresh();
    });
    return () => sub.remove();
  }, []);

  // The key is created (or read) when the key step is shown.
  useEffect(() => {
    if (step !== 'key' || key || !ownerOk) return;
    VaultCore.createRecoveryKey()
      .then(setKey)
      .catch(() => setError(t('backup.errUnavailable')));
  }, [step, key, ownerOk]);

  useBack(() => {
    if (busy) return;
    if (step === 'confirm') setStep('key');
    else if (step === 'restore') setStep('manage');
    else onClose();
  });

  const chooseFolder = async () => {
    setError(null);
    const uri = await pickFolder(suspendAutoLock);
    if (!uri) return;
    setBusy(true);
    const r = await VaultCore.setBackupFolder(uri).catch(() => ({
      ok: false as const,
      error: 'FAILED' as const,
    }));
    setBusy(false);
    if (!r.ok) return setError(backupErrorText(r.error));
    autoBackup();
    await refresh();
    setStep('manage');
  };

  if (step === 'loading') return <Busy label={t('common.opening')} />;

  if (step === 'restore') {
    const cancelRestore = async () => {
      // Leaving the restore drops the "Restore didn't finish" reminder; it can be started again here.
      if (status?.restorePending) await VaultCore.dismissRestore().catch(() => {});
      const st = await refresh();
      setStep(!st || st.folderName ? 'manage' : !st.keyConfirmed ? 'key' : 'folder');
    };
    return <RestoreFlow mode="existing" suspendAutoLock={suspendAutoLock} onCancel={cancelRestore} onDone={onClose} />;
  }

  if (step === 'key') {
    return (
      <Page
        onBack={onClose}
        footer={
          <>
            {error && <Text style={[s.small, { color: C.danger, textAlign: 'center' }]}>{error}</Text>}
            <Button label={t('backup.next')} disabled={!key || !saved} onPress={() => setStep('confirm')} />
            {intro && <Button label={t('backup.later')} kind="ghost" onPress={onClose} />}
          </>
        }
      >
        <Text style={s.label}>{t('backup.step', { n: 1 })}</Text>
        <View style={{ height: 8 }} />
        <Title>{t('backup.keyTitle')}</Title>
        <Body style={{ color: C.muted, marginBottom: 18 }}>{t('backup.keyBody')}</Body>
        {!ownerOk ? (
          <View style={{ alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Button label={t('backup.showKey')} onPress={askOwner} />
            {authFailed && <Text style={[s.small, { color: C.danger }]}>{t('backup.authFailed')}</Text>}
          </View>
        ) : key ? (
          <KeyCard text={key} />
        ) : (
          <Busy label={t('common.opening')} />
        )}
        {key && <KeyActions text={key} suspendAutoLock={suspendAutoLock} />}
        <View style={[s.card, { gap: 6, marginTop: 8, marginBottom: 18 }]}>
          <Bullet>{t('backup.keyTip1')}</Bullet>
          <Bullet>{t('backup.keyTip2')}</Bullet>
          <Bullet>{t('backup.keyTip3')}</Bullet>
        </View>
        <Checkbox checked={saved} onChange={setSaved} label={t('backup.keySaved')} />
      </Page>
    );
  }

  if (step === 'confirm' && key) {
    const ok = clean(typed) === clean(lastGroup(key));
    return (
      <Page onBack={() => setStep('key')} footer={
          <Button
            label={t('backup.next')}
            disabled={!ok}
            onPress={async () => {
              const done = await VaultCore.confirmRecoveryKey().then(
                () => true,
                () => false,
              );
              if (!done) {
                setError(t('backup.errFailed'));
                return setStep('key');
              }
              await refresh();
              setStep(status?.folderName ? 'manage' : 'folder');
            }}
          />
        }>
        <Text style={s.label}>{t('backup.step', { n: 2 })}</Text>
        <View style={{ height: 8 }} />
        <Title>{t('backup.confirmTitle')}</Title>
        <Body style={{ color: C.muted, marginBottom: 18 }}>{t('backup.confirmBody')}</Body>
        <TextInput
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          maxLength={6}
          placeholder="XXXX"
          placeholderTextColor={C.outline}
          style={inputStyle}
        />
        {typed.length >= 4 && !ok && <Text style={[s.small, { color: C.danger, marginTop: 10 }]}>{t('backup.confirmWrong')}</Text>}
      </Page>
    );
  }

  if (step === 'folder') {
    return (
      <Page
        onBack={onClose}
        footer={
          <>
            {error && <Text style={[s.small, { color: C.danger, textAlign: 'center' }]}>{error}</Text>}
            <Button label={t('backup.chooseFolder')} onPress={chooseFolder} />
            {intro && <Button label={t('backup.later')} kind="ghost" onPress={onClose} />}
          </>
        }
      >
        <Text style={s.label}>{t('backup.step', { n: 3 })}</Text>
        <View style={{ height: 8 }} />
        <Title>{t('backup.folderTitle')}</Title>
        <Body style={{ color: C.muted, marginBottom: 18 }}>{t('backup.folderBody')}</Body>
        <View style={[s.card, { gap: 6 }]}>
          <Bullet>{t('backup.folderTip1')}</Bullet>
          <Bullet>{t('backup.folderTip2')}</Bullet>
          <Bullet>{t('backup.folderTip3')}</Bullet>
        </View>
        {/* The system folder picker can't be changed, so explain its steps before it opens. */}
        <Text style={[s.label, { marginTop: 22, marginBottom: 8 }]}>{t('backup.howTitle')}</Text>
        <View style={[s.card, { gap: 10 }]}>
          {[t('backup.how1'), Platform.OS === 'ios' ? t('backup.how2Ios') : t('backup.how2Android'), t('backup.how3')].map((line, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
              <Text style={[s.small, { color: C.brass, width: 16 }]}>{i + 1}</Text>
              <Text style={[s.small, { flex: 1 }]}>{line}</Text>
            </View>
          ))}
        </View>
        {busy && <Busy label={t('backup.checking')} />}
      </Page>
    );
  }

  // Manage: the backup's state and actions.
  const last = status?.lastBackupAt ? new Date(status.lastBackupAt).toLocaleString() : t('backup.never');
  return (
    <Page onBack={onClose}>
      <Text style={s.label}>{t('backup.title')}</Text>
      <View style={{ height: 8 }} />
      <Title>{status?.lastError ? t('backup.problemTitle') : t('backup.onTitle')}</Title>
      <Body style={{ color: C.muted, marginBottom: 18 }}>{t('backup.onBody')}</Body>
      <View style={[s.card, { gap: 10 }]}>
        <Line label={t('backup.folder')} value={status?.folderName ?? '—'} />
        <Line label={t('backup.last')} value={status?.running ? t('backup.running') : last} />
        {status?.lastError && <Text style={[s.small, { color: C.danger }]}>{backupErrorText(status.lastError)}</Text>}
      </View>
      <View style={{ gap: 10, marginTop: 18 }}>
        <Button
          label={t('backup.now')}
          disabled={!status?.folderName || status.running}
          onPress={async () => {
            await VaultCore.backupNow().catch(() => false);
            refresh();
          }}
        />
        <Button label={t('backup.changeFolder')} kind="ghost" onPress={chooseFolder} />
        <Button
          label={showKey ? t('backup.hideKey') : t('backup.showKey')}
          kind="ghost"
          onPress={async () => {
            if (showKey) return setShowKey(false);
            if (!(await askOwner())) return;
            setKey(await VaultCore.recoveryKey().catch(() => null));
            setShowKey(true);
          }}
        />
        {authFailed && <Text style={[s.small, { color: C.danger, textAlign: 'center' }]}>{t('backup.authFailed')}</Text>}
        {showKey && key && <KeyCard text={key} />}
        {showKey && key && <KeyActions text={key} suspendAutoLock={suspendAutoLock} />}
        <Button label={t('backup.restoreTitle')} kind="ghost" onPress={() => setStep('restore')} />
      </View>
      {error && <Text style={[s.small, { color: C.danger, marginTop: 12 }]}>{error}</Text>}
      {busy && <Busy label={t('backup.checking')} />}
    </Page>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text style={s.small}>{label}</Text>
      <Text style={[s.small, { color: C.ivory, flexShrink: 1, textAlign: 'right' }]}>{value}</Text>
    </View>
  );
}

const inputStyle = {
  height: 56,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: C.outline,
  backgroundColor: '#13171F',
  color: C.ivory,
  fontFamily: 'Courier',
  fontWeight: '700' as const,
  fontSize: 18,
  letterSpacing: 2,
  paddingHorizontal: 16,
};

/**
 * Restore: pick the backup folder, type the recovery key, check it. For a new install
 * ([mode] "new") the checked folder and key go back to the app, which creates the PIN first
 * and then shows [Restoring]. For an existing vault the restore starts right away.
 */
export function RestoreFlow({
  mode,
  onCancel,
  onReady,
  onDone,
  suspendAutoLock,
}: {
  mode: 'new' | 'existing';
  onCancel: () => void;
  onReady?: (uri: string, key: string) => void;
  onDone?: () => void;
  suspendAutoLock: (on: boolean) => void;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  useBack(() => !busy && !restoring && onCancel());

  if (restoring && uri) return <Restoring uri={uri} recoveryKey={key} onDone={onDone ?? onCancel} />;

  const choose = async () => {
    setError(null);
    const picked = await pickFolder(suspendAutoLock);
    if (picked) setUri(picked);
  };

  const check = async () => {
    if (!uri) return;
    setError(null);
    setBusy(true);
    const r = await VaultCore.checkBackup(uri, key).catch(() => ({
      ok: false as const,
      error: 'FAILED' as const,
    }));
    setBusy(false);
    if (!r.ok) return setError(backupErrorText(r.error));
    if (mode === 'new') onReady?.(uri, key);
    else setRestoring(true);
  };

  return (
    <Page onBack={onCancel} footer={<Button label={mode === 'new' ? t('backup.next') : t('backup.restoreStart')} disabled={!uri || clean(key).length < 52} onPress={check} />}>
      <Text style={s.label}>{t('backup.restoreLabel')}</Text>
      <View style={{ height: 8 }} />
      <Title>{t('backup.restoreTitle')}</Title>
      <Body style={{ color: C.muted, marginBottom: 18 }}>{t('backup.restoreBody')}</Body>
      <Text style={[s.small, { marginBottom: 8 }]}>{t('backup.restoreStep1')}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={choose}
        style={({ pressed }) => [s.card, { flexDirection: 'row', alignItems: 'center', gap: 12 }, pressed && { opacity: 0.8 }]}
      >
        <Ionicons name={uri ? 'folder' : 'folder-outline'} size={24} color={C.brass} />
        <Text style={[s.body, { flex: 1 }]} numberOfLines={2}>
          {uri ? decodeURIComponent(uri.replace(/\/$/, '').split(/[/:]/).pop() ?? '') : t('backup.chooseFolder')}
        </Text>
        <Ionicons name="chevron-forward" size={20} color={C.faint} />
      </Pressable>
      <Text style={[s.small, { marginTop: 20, marginBottom: 8 }]}>{t('backup.restoreStep2')}</Text>
      <TextInput
        value={key}
        onChangeText={(v) => {
          setError(null);
          setKey(v);
        }}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        multiline
        placeholder="XXXX-XXXX-XXXX-…"
        placeholderTextColor={C.outline}
        style={[inputStyle, { height: 110, paddingTop: 14, textAlignVertical: 'top' }]}
      />
      {error && <Text style={[s.small, { color: C.danger, marginTop: 12 }]}>{error}</Text>}
      {busy && <Busy label={t('backup.checking')} />}
    </Page>
  );
}

/** Runs the restore into the (unlocked) vault and shows progress, then the result. */
export function Restoring({ uri, recoveryKey, onDone }: { uri: string; recoveryKey: string; onDone: () => void }) {
  useKeepAwake();
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [result, setResult] = useState<BackupEvent | null>(null);
  const [attempt, setAttempt] = useState(0);
  useBack(() => result && onDone());

  useEffect(() => {
    const sub = VaultCore.onBackup((e) => {
      if (e.phase === 'restore-progress') setProgress({ done: e.done, total: e.total });
      if (e.phase === 'restore-done' || e.phase === 'restore-error') setResult(e);
    });
    VaultCore.restoreBackup(uri, recoveryKey)
      .then((started) => {
        if (!started) setResult({ phase: 'restore-error', error: 'FAILED' });
      })
      .catch(() => setResult({ phase: 'restore-error', error: 'FAILED' }));
    return () => sub.remove();
  }, [attempt, uri, recoveryKey]);

  if (!result) {
    return (
      <Page>
        <Text style={s.label}>{t('backup.restoreLabel')}</Text>
        <View style={{ height: 8 }} />
        <Title>{t('backup.restoring')}</Title>
        <Body style={{ color: C.muted }}>
          {progress
            ? t('backup.restoringCount', {
                done: progress.done,
                total: progress.total,
              })
            : t('backup.checking')}
        </Body>
        <Body style={{ color: C.muted, marginTop: 12 }}>{t('backup.restoringKeepOpen')}</Body>
        <View
          style={{
            height: 6,
            borderRadius: 3,
            backgroundColor: C.line,
            marginTop: 24,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              height: 6,
              width: `${progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%`,
              backgroundColor: C.brass,
            }}
          />
        </View>
      </Page>
    );
  }

  if (result.phase === 'restore-done') {
    return (
      <Page footer={<Button label={t('backup.openVault')} onPress={onDone} />}>
        <Ionicons name="checkmark-circle" size={48} color={C.ok} />
        <View style={{ height: 12 }} />
        <Title>{t('backup.restoredTitle')}</Title>
        <Body style={{ color: C.muted }}>{tn('backup.restoredCount', result.restored)}</Body>
        {result.alreadyHere > 0 && <Body style={{ color: C.muted, marginTop: 8 }}>{tn('backup.alreadyHere', result.alreadyHere)}</Body>}
        {result.damaged > 0 && <Body style={{ color: C.danger, marginTop: 8 }}>{tn('backup.damaged', result.damaged)}</Body>}
      </Page>
    );
  }

  return (
    <Page
      footer={
        <>
          <Button
            label={t('backup.retry')}
            onPress={() => {
              setResult(null);
              setProgress(null);
              setAttempt((a) => a + 1);
            }}
          />
          <Button label={t('common.close')} kind="ghost" onPress={onDone} />
        </>
      }
    >
      <Title>{t('backup.restoreFailed')}</Title>
      <Body style={{ color: C.muted }}>{result.phase === 'restore-error' ? backupErrorText(result.error) : ''}</Body>
      <Body style={{ color: C.muted, marginTop: 12 }}>{t('backup.restoreRetryNote')}</Body>
    </Page>
  );
}
