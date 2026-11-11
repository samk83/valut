import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useKeepAwake } from 'expo-keep-awake';
import qrcode from 'qrcode-generator';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';

import VaultCore, { TransferEvent } from '../../modules/vault-core';
import { FREE_LIMIT, usePremium } from '../premium';
import { Key, t, tn } from '../i18n';
import { C, F } from '../theme';
import { Body, Bullet, Button, s, Title } from '../ui';

type Step =
  | { name: 'choose' }
  | { name: 'receive'; code: string | null }
  | { name: 'scan' }
  | { name: 'running'; role: 'send' | 'receive' }
  | { name: 'done'; role: 'send' | 'receive'; event: TransferEvent }
  | { name: 'error'; role: 'send' | 'receive'; message: string };

const ERRORS: Record<string, Key> = {
  E_NO_WIFI: 'transfer.err.noWifi',
  E_BAD_CODE: 'transfer.err.badCode',
  E_OTHER_NETWORK: 'transfer.err.otherNetwork',
  E_LOCKED: 'transfer.err.vaultLocked',
  E_UNAVAILABLE: 'transfer.err.unavailable',
  CONNECTION: 'transfer.err.connection',
  WRONG_PEER: 'transfer.err.wrongPeer',
  STORAGE_FULL: 'transfer.err.storageFull',
  LOCKED: 'transfer.err.locked',
  INTEGRITY: 'transfer.err.integrity',
  CANCELLED: 'transfer.err.cancelled',
  OTHER: 'transfer.err.other',
};

const message = (code: string | undefined) => t(ERRORS[code ?? 'OTHER'] ?? ERRORS.OTHER);

/** Moves the vault to a new phone: directly between the two phones, encrypted, no cloud. */
export function Transfer({ onClose, suspendAutoLock }: { onClose: () => void; suspendAutoLock: (on: boolean) => void }) {
  const [step, setStep] = useState<Step>({ name: 'choose' });
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  // iPhone asks for Local Network access the first time a connection starts; that system
  // dialog must not lock the vault (which would also stop the transfer). Auto-lock is
  // suspended from the start until the phones are connected or it ends.
  const suspended = useRef(false);
  const holdLock = (on: boolean) => {
    if (suspended.current === on) return;
    suspended.current = on;
    suspendAutoLock(on);
  };
  const holdRef = useRef(holdLock);
  useEffect(() => {
    holdRef.current = holdLock;
  });

  // Native events: progress, done, error.
  const [event, setEvent] = useState<TransferEvent | null>(null);
  useEffect(() => {
    const sub = VaultCore.onTransfer((e) => {
      const cur = stepRef.current;
      const role = cur.name === 'scan' || (cur.name === 'running' && cur.role === 'send') ? 'send' : 'receive';
      if (e.phase !== 'waiting') holdRef.current(false);
      if (e.phase === 'connected' || e.phase === 'progress') {
        setEvent(e);
        if (cur.name !== 'running') setStep({ name: 'running', role });
      } else if (e.phase === 'done') {
        setStep({ name: 'done', role, event: e });
      } else if (e.phase === 'error') {
        setStep({ name: 'error', role, message: message(e.error) });
      }
    });
    return () => {
      sub.remove();
      VaultCore.transferCancel();
      holdRef.current(false);
    };
  }, []);

  const back = () => {
    VaultCore.transferCancel();
    holdLock(false);
    if (step.name === 'choose' || step.name === 'done') onClose();
    else setStep({ name: 'choose' });
  };

  // Android back: step back, or stop a running transfer.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => sub.remove();
  });

  const startReceive = async () => {
    setEvent(null);
    setStep({ name: 'receive', code: null });
    holdLock(true);
    try {
      const code = await VaultCore.transferReceive();
      setStep((cur) => (cur.name === 'receive' ? { name: 'receive', code } : cur));
    } catch (e) {
      holdLock(false);
      setStep({ name: 'error', role: 'receive', message: message(codeOf(e)) });
    }
  };

  const scanned = async (data: string) => {
    if (stepRef.current.name !== 'scan') return;
    setEvent(null);
    setStep({ name: 'running', role: 'send' });
    holdLock(true);
    try {
      await VaultCore.transferSend(data);
    } catch (e) {
      holdLock(false);
      setStep({ name: 'error', role: 'send', message: message(codeOf(e)) });
    }
  };

  switch (step.name) {
    case 'choose':
      return <Choose onClose={onClose} onReceive={startReceive} onSend={() => setStep({ name: 'scan' })} />;
    case 'receive':
      return <Receive code={step.code} onCancel={back} />;
    case 'scan':
      return <Scan onScanned={scanned} onCancel={back} suspendAutoLock={suspendAutoLock} />;
    case 'running':
      return <Running role={step.role} event={event} onCancel={back} />;
    case 'done':
      return <Done role={step.role} event={step.event} onClose={onClose} />;
    case 'error':
      return (
        <Page footer={<Button label={t('transfer.startAgain')} onPress={() => setStep({ name: 'choose' })} />} onBack={onClose}>
          <Ionicons name="alert-circle-outline" size={40} color={C.danger} />
          <View style={{ height: 12 }} />
          <Title>{t('transfer.stopped')}</Title>
          <Body style={{ color: C.muted }}>{step.message}</Body>
        </Page>
      );
  }
}

/** Native errors carry E_NO_WIFI etc. in their code (Android) or name/message (iPhone). */
function codeOf(e: unknown): string {
  const err = e as { code?: string; message?: string } | null;
  const text = `${err?.code ?? ''} ${err?.message ?? ''}`;
  return Object.keys(ERRORS).find((k) => k.startsWith('E_') && text.includes(k)) ?? 'OTHER';
}

function Page({ children, footer, onBack }: { children: ReactNode; footer?: ReactNode; onBack?: () => void }) {
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: 56, paddingHorizontal: 24, paddingBottom: 24 }}>
        {onBack && (
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={{ alignSelf: 'flex-start', padding: 8, marginLeft: -8, marginBottom: 12 }}>
            <Ionicons name="chevron-back" size={26} color={C.ivory} />
          </Pressable>
        )}
        {children}
      </ScrollView>
      {footer && <View style={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 30, gap: 10 }}>{footer}</View>}
    </View>
  );
}

function Choice({ icon, title, text, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s.card, { flexDirection: 'row', gap: 14, alignItems: 'center' }, pressed && { opacity: 0.8 }]}>
      <Ionicons name={icon} size={28} color={C.brass} />
      <View style={{ flex: 1 }}>
        <Text style={[s.body, { fontFamily: F.bold }]}>{title}</Text>
        <Text style={s.small}>{text}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={C.faint} />
    </Pressable>
  );
}

function Choose({ onClose, onReceive, onSend }: { onClose: () => void; onReceive: () => void; onSend: () => void }) {
  return (
    <Page onBack={onClose}>
      <Text style={s.label}>{t('transfer.title')}</Text>
      <View style={{ height: 8 }} />
      <Title>{t('transfer.chooseTitle')}</Title>
      <Body style={{ color: C.muted, marginBottom: 20 }}>
        {t('transfer.chooseBody')}
      </Body>
      <View style={{ gap: 12 }}>
        <Choice icon="phone-portrait-outline" title={t('transfer.isNew')} text={t('transfer.isNewSub')} onPress={onReceive} />
        <Choice icon="scan-outline" title={t('transfer.isOld')} text={t('transfer.isOldSub')} onPress={onSend} />
      </View>
      <View style={[s.card, { marginTop: 22, gap: 6 }]}>
        <Text style={[s.body, { fontFamily: F.bold, marginBottom: 4 }]}>{t('transfer.before')}</Text>
        <Bullet>{t('transfer.before1')}</Bullet>
        <Bullet>{t('transfer.before2')}</Bullet>
        <Bullet>{t('transfer.before3')}</Bullet>
        <Bullet>{t('transfer.before4')}</Bullet>
      </View>
    </Page>
  );
}

function Receive({ code, onCancel }: { code: string | null; onCancel: () => void }) {
  useKeepAwake();
  const { width } = useWindowDimensions();
  const size = Math.min(width - 48, 320);
  return (
    <Page footer={<Button label={t('common.cancel')} kind="ghost" onPress={onCancel} />}>
      <Text style={s.label}>{t('transfer.newPhone')}</Text>
      <View style={{ height: 8 }} />
      <Title>{t('transfer.scanThis')}</Title>
      <Body style={{ color: C.muted, marginBottom: 20 }}>{t('transfer.scanHow')}</Body>
      <View style={{ alignItems: 'center' }}>
        {code ? <Qr text={code} size={size} /> : <View style={{ width: size, height: size, borderRadius: 16, backgroundColor: C.surface }} />}
      </View>
      <Text style={[s.small, { textAlign: 'center', marginTop: 16 }]}>
        {t('transfer.codeNote')}
      </Text>
    </Page>
  );
}

/** Draws a QR code with plain views (one per run of dark modules), black on white. */
function Qr({ text, size }: { text: string; size: number }) {
  const rows = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const out: { start: number; len: number }[][] = [];
    for (let r = 0; r < n; r++) {
      const runs: { start: number; len: number }[] = [];
      let c = 0;
      while (c < n) {
        if (!qr.isDark(r, c)) {
          c++;
          continue;
        }
        const start = c;
        while (c < n && qr.isDark(r, c)) c++;
        runs.push({ start, len: c - start });
      }
      out.push(runs);
    }
    return out;
  }, [text]);
  const quiet = 4;
  const cell = size / (rows.length + quiet * 2);
  return (
    <View accessibilityLabel={t('transfer.codeA11y')} style={{ width: size, height: size, backgroundColor: '#FFFFFF', borderRadius: 12, padding: cell * quiet }}>
      {rows.map((runs, r) => (
        <View key={r} style={{ height: cell, flexDirection: 'row' }}>
          {runs.map((run) => (
            <View key={run.start} style={{ position: 'absolute', left: run.start * cell, width: run.len * cell + 0.5, height: cell + 0.5, backgroundColor: '#000000' }} />
          ))}
        </View>
      ))}
    </View>
  );
}

function Scan({ onScanned, onCancel, suspendAutoLock }: { onScanned: (data: string) => void; onCancel: () => void; suspendAutoLock: (on: boolean) => void }) {
  useKeepAwake();
  const [perm, request] = useCameraPermissions();
  const handled = useRef(false);
  if (!perm) return <View style={s.screen} />;
  if (!perm.granted) {
    return (
      <Page onBack={onCancel}>
        <Title>{t('transfer.cameraTitle')}</Title>
        <Body style={{ color: C.muted, marginBottom: 24 }}>{t('transfer.cameraBody')}</Body>
        <Button
          label={t('transfer.allowCamera')}
          onPress={async () => {
            suspendAutoLock(true);
            try {
              await request();
            } finally {
              suspendAutoLock(false);
            }
          }}
        />
      </Page>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: '#050608' }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={(r) => {
          if (handled.current || !r.data?.startsWith('PVT1:')) return;
          handled.current = true;
          onScanned(r.data);
        }}
      />
      <View style={{ position: 'absolute', top: 56, left: 24, right: 24 }}>
        <Text style={s.label}>{t('transfer.oldPhone')}</Text>
        <View style={{ height: 8 }} />
        <Text style={{ fontFamily: F.title, fontSize: 26, color: C.ivory }}>{t('transfer.scanNew')}</Text>
      </View>
      <View style={{ position: 'absolute', bottom: 40, left: 24, right: 24 }}>
        <Button label={t('common.cancel')} kind="ghost" onPress={onCancel} style={{ backgroundColor: 'rgba(11,13,18,0.7)' }} />
      </View>
    </View>
  );
}

function Running({ role, event, onCancel }: { role: 'send' | 'receive'; event: TransferEvent | null; onCancel: () => void }) {
  useKeepAwake();
  const done = event?.itemsDone ?? 0;
  const total = event?.itemsTotal ?? 0;
  const bytesTotal = event?.bytesTotal ?? 0;
  const pct = bytesTotal > 0 ? Math.round(((event?.bytesDone ?? 0) / bytesTotal) * 100) : total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <Page footer={<Button label={t('transfer.stop')} kind="ghost" onPress={onCancel} />}>
      <View style={{ alignItems: 'center', marginTop: 24, marginBottom: 24 }}>
        <View style={{ width: 168, height: 168, borderRadius: 84, borderWidth: 6, borderColor: C.line, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: F.title, fontSize: 48, color: C.ivory }}>{Math.min(pct, 100)}%</Text>
        </View>
        <View style={{ width: 168, height: 4, borderRadius: 2, backgroundColor: C.line, marginTop: 16, overflow: 'hidden' }}>
          <View style={{ width: `${Math.min(pct, 100)}%`, height: 4, backgroundColor: C.brass }} />
        </View>
      </View>
      <Text style={s.label}>{role === 'send' ? t('transfer.sending') : t('transfer.receiving')}</Text>
      <View style={{ height: 8 }} />
      <Title>{event ? t('transfer.progress', { done, total }) : t('transfer.connecting')}</Title>
      <Body style={{ color: C.muted }}>{t('transfer.keepOpen')}</Body>
      {!!event?.alreadyThere && <Text style={[s.small, { marginTop: 10 }]}>{t('transfer.alreadySkipped', { n: event.alreadyThere })}</Text>}
    </Page>
  );
}

function Done({ role, event, onClose }: { role: 'send' | 'receive'; event: TransferEvent; onClose: () => void }) {
  const st = usePremium();
  const moved = event.itemsDone ?? 0;
  const skipped = event.skipped ?? 0;
  return (
    <Page footer={<Button label={t('premium.backToVault')} onPress={onClose} />}>
      <Ionicons name="checkmark-circle" size={44} color={C.ok} />
      <View style={{ height: 12 }} />
      <Text style={s.label}>{t('transfer.complete')}</Text>
      <View style={{ height: 8 }} />
      <Title>{tn(role === 'send' ? 'transfer.sent' : 'transfer.received', moved - skipped)}</Title>
      <View style={{ gap: 10 }}>
        {!!event.alreadyThere && <Body style={{ color: C.muted }}>{t('transfer.alreadyThere', { n: event.alreadyThere })}</Body>}
        {skipped > 0 && (
          <Body style={{ color: C.danger }}>
            {tn('transfer.damaged', skipped)}
          </Body>
        )}
        {role === 'send' ? (
          <Body style={{ color: C.muted }}>
            {t('transfer.doneSend')}
          </Body>
        ) : (
          <Body style={{ color: C.muted }}>{t('transfer.doneReceive')}</Body>
        )}
        {role === 'receive' && !st.premium && (
          <Body style={{ color: C.muted }}>
            {t('transfer.restoreHint', { max: FREE_LIMIT })}
          </Body>
        )}
      </View>
    </Page>
  );
}
