import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useKeepAwake } from 'expo-keep-awake';
import qrcode from 'qrcode-generator';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';

import VaultCore, { TransferEvent } from '../../modules/vault-core';
import { FREE_LIMIT, usePremium } from '../premium';
import { C, F } from '../theme';
import { Body, Bullet, Button, s, Title } from '../ui';

type Step =
  | { name: 'choose' }
  | { name: 'receive'; code: string | null }
  | { name: 'scan' }
  | { name: 'running'; role: 'send' | 'receive' }
  | { name: 'done'; role: 'send' | 'receive'; event: TransferEvent }
  | { name: 'error'; role: 'send' | 'receive'; message: string };

const ERRORS: Record<string, string> = {
  E_NO_WIFI: 'This phone is not on Wi-Fi. Connect both phones to the same Wi-Fi network (or turn on one phone’s hotspot and join it with the other), then try again.',
  E_BAD_CODE: 'That is not a PrivateVault code. Scan the code shown on your new phone.',
  E_LOCKED: 'The vault locked. Unlock it and start again.',
  E_UNAVAILABLE: 'The preview app has nothing real to move. This works in the installed app.',
  CONNECTION: 'The phones lost each other. Keep both on the same Wi-Fi with the screens on, then start again. Items already moved are kept and will not be sent twice.',
  WRONG_PEER: 'The connection could not be verified, so nothing was accepted. Start again and scan the code on your new phone.',
  STORAGE_FULL: 'The new phone is out of storage. Free up space, then start again; items already moved are kept.',
  LOCKED: 'One of the phones locked or left the app. Keep both apps open, then start again. Items already moved are kept.',
  INTEGRITY: 'An item did not arrive intact, so it was not saved. Start again; items already moved are kept.',
  CANCELLED: 'The transfer was stopped. Items already moved are kept.',
  OTHER: 'Something went wrong. Start again; items already moved are kept.',
};

const message = (code: string | undefined) => ERRORS[code ?? 'OTHER'] ?? ERRORS.OTHER;

/** Moves the vault to a new phone: directly between the two phones, encrypted, no cloud. */
export function Transfer({ onClose, suspendAutoLock }: { onClose: () => void; suspendAutoLock: (on: boolean) => void }) {
  const [step, setStep] = useState<Step>({ name: 'choose' });
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  // Native events: progress, done, error.
  const [event, setEvent] = useState<TransferEvent | null>(null);
  useEffect(() => {
    const sub = VaultCore.onTransfer((e) => {
      const cur = stepRef.current;
      const role = cur.name === 'scan' || (cur.name === 'running' && cur.role === 'send') ? 'send' : 'receive';
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
    };
  }, []);

  const back = () => {
    VaultCore.transferCancel();
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
    try {
      const code = await VaultCore.transferReceive();
      setStep((cur) => (cur.name === 'receive' ? { name: 'receive', code } : cur));
    } catch (e) {
      setStep({ name: 'error', role: 'receive', message: message(codeOf(e)) });
    }
  };

  const scanned = async (data: string) => {
    if (stepRef.current.name !== 'scan') return;
    setEvent(null);
    setStep({ name: 'running', role: 'send' });
    try {
      await VaultCore.transferSend(data);
    } catch (e) {
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
        <Page footer={<Button label="Start again" onPress={() => setStep({ name: 'choose' })} />} onBack={onClose}>
          <Ionicons name="alert-circle-outline" size={40} color={C.danger} />
          <View style={{ height: 12 }} />
          <Title>Transfer stopped</Title>
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
      <Text style={s.label}>Move to a new phone</Text>
      <View style={{ height: 8 }} />
      <Title>Phone to phone, encrypted</Title>
      <Body style={{ color: C.muted, marginBottom: 20 }}>
        Your photos and videos go straight from one phone to the other over your Wi-Fi. Nothing is uploaded anywhere, and nothing can be read on the way.
      </Body>
      <View style={{ gap: 12 }}>
        <Choice icon="phone-portrait-outline" title="This is my new phone" text="Shows a code for the old phone to scan" onPress={onReceive} />
        <Choice icon="scan-outline" title="This is my old phone" text="Scans the code on the new phone and sends everything" onPress={onSend} />
      </View>
      <View style={[s.card, { marginTop: 22, gap: 6 }]}>
        <Text style={[s.body, { fontFamily: F.bold, marginBottom: 4 }]}>Before you start</Text>
        <Bullet>Install the app on the new phone and create its own PIN or pattern.</Bullet>
        <Bullet>Put both phones on the same Wi-Fi, or turn on one phone’s hotspot and join it with the other.</Bullet>
        <Bullet>Keep both apps open with the screens on until it finishes.</Bullet>
        <Bullet>Your old phone keeps its copy. Erase it yourself once you have checked the new phone.</Bullet>
      </View>
    </Page>
  );
}

function Receive({ code, onCancel }: { code: string | null; onCancel: () => void }) {
  useKeepAwake();
  const { width } = useWindowDimensions();
  const size = Math.min(width - 48, 320);
  return (
    <Page footer={<Button label="Cancel" kind="ghost" onPress={onCancel} />}>
      <Text style={s.label}>New phone</Text>
      <View style={{ height: 8 }} />
      <Title>Scan this with your old phone</Title>
      <Body style={{ color: C.muted, marginBottom: 20 }}>On the old phone open Settings › Move to a new phone › This is my old phone.</Body>
      <View style={{ alignItems: 'center' }}>
        {code ? <Qr text={code} size={size} /> : <View style={{ width: size, height: size, borderRadius: 16, backgroundColor: C.surface }} />}
      </View>
      <Text style={[s.small, { textAlign: 'center', marginTop: 16 }]}>
        This code works once, only for the next 10 minutes, and only on this Wi-Fi. Do not share it or take a picture of it.
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
    <View accessibilityLabel="Transfer code" style={{ width: size, height: size, backgroundColor: '#FFFFFF', borderRadius: 12, padding: cell * quiet }}>
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
        <Title>Camera access</Title>
        <Body style={{ color: C.muted, marginBottom: 24 }}>The camera is used only to read the code on your new phone. No picture is taken.</Body>
        <Button
          label="Allow camera"
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
        <Text style={s.label}>Old phone</Text>
        <View style={{ height: 8 }} />
        <Text style={{ fontFamily: F.title, fontSize: 26, color: C.ivory }}>Scan the code on your new phone</Text>
      </View>
      <View style={{ position: 'absolute', bottom: 40, left: 24, right: 24 }}>
        <Button label="Cancel" kind="ghost" onPress={onCancel} style={{ backgroundColor: 'rgba(11,13,18,0.7)' }} />
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
    <Page footer={<Button label="Stop" kind="ghost" onPress={onCancel} />}>
      <View style={{ alignItems: 'center', marginTop: 24, marginBottom: 24 }}>
        <View style={{ width: 168, height: 168, borderRadius: 84, borderWidth: 6, borderColor: C.line, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: F.title, fontSize: 48, color: C.ivory }}>{Math.min(pct, 100)}%</Text>
        </View>
        <View style={{ width: 168, height: 4, borderRadius: 2, backgroundColor: C.line, marginTop: 16, overflow: 'hidden' }}>
          <View style={{ width: `${Math.min(pct, 100)}%`, height: 4, backgroundColor: C.brass }} />
        </View>
      </View>
      <Text style={s.label}>{role === 'send' ? 'Sending' : 'Receiving'}</Text>
      <View style={{ height: 8 }} />
      <Title>{event ? `${done} of ${total}` : 'Connecting…'}</Title>
      <Body style={{ color: C.muted }}>Keep both apps open with the screens on. Each item is checked on the new phone before the next one is sent.</Body>
      {!!event?.alreadyThere && <Text style={[s.small, { marginTop: 10 }]}>{event.alreadyThere} already on the new phone, skipped.</Text>}
    </Page>
  );
}

function Done({ role, event, onClose }: { role: 'send' | 'receive'; event: TransferEvent; onClose: () => void }) {
  const st = usePremium();
  const moved = event.itemsDone ?? 0;
  const skipped = event.skipped ?? 0;
  return (
    <Page footer={<Button label="Back to vault" onPress={onClose} />}>
      <Ionicons name="checkmark-circle" size={44} color={C.ok} />
      <View style={{ height: 12 }} />
      <Text style={s.label}>Transfer complete</Text>
      <View style={{ height: 8 }} />
      <Title>{role === 'send' ? `${moved - skipped} sent` : `${moved - skipped} received`}</Title>
      <View style={{ gap: 10 }}>
        {!!event.alreadyThere && <Body style={{ color: C.muted }}>{event.alreadyThere} were already on the new phone.</Body>}
        {skipped > 0 && (
          <Body style={{ color: C.danger }}>
            {skipped} {skipped === 1 ? 'item was' : 'items were'} damaged on the old phone and could not be moved.
          </Body>
        )}
        {role === 'send' ? (
          <Body style={{ color: C.muted }}>
            This phone still has its copy. Open the vault on your new phone and check it. When you are happy, you can erase this vault in Settings › Destroy entire vault.
          </Body>
        ) : (
          <Body style={{ color: C.muted }}>Everything is now encrypted with this phone’s own key and PIN.</Body>
        )}
        {role === 'receive' && !st.premium && (
          <Body style={{ color: C.muted }}>
            Bought Premium on your old phone? Tap Restore purchases in Settings with the same account. Without it, the free plan lets you keep everything but add new items only below {FREE_LIMIT}.
          </Body>
        )}
      </View>
    </Page>
  );
}
