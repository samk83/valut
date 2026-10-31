import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraType, CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import VaultCore from '../../modules/vault-core';
import { C, F } from '../theme';
import { Body, Busy, Button, s, Title } from '../ui';

const REC_RED = '#EF5B5B';

const clock = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

/** Captures straight into the vault. Nothing is saved to the gallery and no location is added. */
export function VaultCamera({ onClose, suspendAutoLock }: { onClose: (saved: boolean) => void; suspendAutoLock: (on: boolean) => void }) {
  const ref = useRef<CameraView>(null);
  const [cam, requestCam] = useCameraPermissions();
  const [mic, requestMic] = useMicrophonePermissions();
  const [mode, setMode] = useState<'picture' | 'video'>('picture');
  const [facing, setFacing] = useState<CameraType>('back');
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(0);

  useEffect(() => {
    if (!recording) return;
    setElapsed(0);
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(t);
  }, [recording]);

  const ask = async (fn: () => Promise<unknown>) => {
    suspendAutoLock(true);
    try {
      await fn();
    } finally {
      suspendAutoLock(false);
    }
  };

  if (!cam) return <View style={s.screen} />;
  if (!cam.granted) {
    return (
      <View style={[s.screen, { justifyContent: 'center' }]}>
        <Title>Camera access</Title>
        <Body style={{ color: C.muted, marginBottom: 24 }}>The vault camera saves directly into the vault, never to the gallery.</Body>
        <Button label="Allow camera" onPress={() => ask(requestCam)} />
        <View style={{ height: 12 }} />
        <Button label="Back" kind="ghost" onPress={() => onClose(false)} />
      </View>
    );
  }

  const seal = async (uri: string, kind: 'PHOTO' | 'VIDEO') => {
    setBusy(true);
    try {
      const r = await VaultCore.importCapture(uri, kind);
      if (r.saved) setSaved((n) => n + 1);
      else Alert.alert('Saved for later', 'This capture could not be encrypted right now (for example, the phone is low on space). It is kept safely and will be added to the vault after your next unlock.');
    } catch {
      Alert.alert('Saved for later', 'This capture will be added to the vault after your next unlock.');
    } finally {
      setBusy(false);
    }
  };

  const shutter = async () => {
    if (!ref.current || busy) return;
    if (mode === 'picture') {
      let pic;
      try {
        pic = await ref.current.takePictureAsync({ quality: 0.92, exif: false });
      } catch {
        return Alert.alert('Camera error', 'The photo could not be taken.');
      }
      if (pic?.uri) await seal(pic.uri, 'PHOTO');
      return;
    }
    if (recording) {
      ref.current.stopRecording();
      return;
    }
    if (!mic?.granted) {
      if (mic && !mic.canAskAgain) {
        Alert.alert('Microphone blocked', 'Video needs the microphone. Allow it in Android Settings.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => ask(() => Linking.openSettings()) },
        ]);
      } else {
        await ask(requestMic);
      }
      return;
    }
    setRecording(true);
    try {
      const video = await ref.current.recordAsync({ maxDuration: 600 });
      if (video?.uri) await seal(video.uri, 'VIDEO');
    } catch {
      Alert.alert('Camera error', 'The video could not be recorded.');
    } finally {
      setRecording(false);
    }
  };

  const video = mode === 'video';

  return (
    <View style={{ flex: 1, backgroundColor: '#050608' }}>
      <View style={cs.top}>
        <Pressable
          accessibilityLabel={saved > 0 ? `Close, ${saved} saved` : 'Close'}
          onPress={() => onClose(saved > 0)}
          disabled={recording}
          style={({ pressed }) => [cs.round, (pressed || recording) && { opacity: recording ? 0.4 : 0.7 }]}
        >
          <Ionicons name="close" size={20} color={C.ivory} />
        </Pressable>
        <View style={cs.pill}>
          <Ionicons name="lock-closed-outline" size={12} color="#E6CFA0" />
          <Text style={cs.pillText}>Straight to vault · never to Photos</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <View style={cs.preview}>
        <CameraView ref={ref} style={StyleSheet.absoluteFill} facing={facing} mode={mode} mute={false} />
        {recording && (
          <View style={cs.timer}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: REC_RED }} />
            <Text style={cs.timerText}>{clock(elapsed)}</Text>
          </View>
        )}
        <View style={cs.chip} pointerEvents="none">
          <Text style={cs.chipText}>Location data stripped</Text>
        </View>
        {saved > 0 && !recording && (
          <View style={cs.savedChip} pointerEvents="none">
            <Text style={cs.chipText}>{saved} saved</Text>
          </View>
        )}
      </View>

      <View style={{ alignItems: 'center', paddingTop: 18, paddingBottom: 10 }}>
        <View style={cs.switch}>
          {(['picture', 'video'] as const).map((m) => {
            const on = mode === m;
            return (
              <Pressable
                key={m}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                disabled={recording}
                onPress={() => setMode(m)}
                style={[cs.switchItem, on && { backgroundColor: C.surface2 }]}
              >
                <Text style={[cs.switchText, { color: on ? C.ivory : C.faint }]}>{m === 'picture' ? 'Photo' : 'Video'}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={cs.controls}>
        <View style={{ width: 52 }} />
        <Pressable accessibilityLabel={video ? (recording ? 'Stop recording' : 'Start recording') : 'Take photo'} onPress={shutter} style={cs.shutter}>
          <View
            style={{
              width: recording ? 28 : 60,
              height: recording ? 28 : 60,
              borderRadius: recording ? 6 : 30,
              backgroundColor: video ? REC_RED : C.ivory,
            }}
          />
        </Pressable>
        <Pressable
          accessibilityLabel="Flip camera"
          disabled={recording}
          onPress={() => setFacing(facing === 'back' ? 'front' : 'back')}
          style={({ pressed }) => [cs.flip, (pressed || recording) && { opacity: recording ? 0.4 : 0.7 }]}
        >
          <Ionicons name="camera-reverse-outline" size={24} color={C.ivory} />
        </Pressable>
      </View>
      {busy && <Busy label="Encrypting into the vault…" />}
    </View>
  );
}

const cs = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 52, paddingHorizontal: 18, paddingBottom: 14 },
  round: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: '#2A2F3A', backgroundColor: '#10131A', alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: '#4A3E28', backgroundColor: '#15120C', flexShrink: 1, marginHorizontal: 8 },
  pillText: { fontFamily: F.medium, fontSize: 11, letterSpacing: 0.4, color: '#E6CFA0', flexShrink: 1 },
  preview: { flex: 1, marginHorizontal: 10, borderRadius: 20, overflow: 'hidden', backgroundColor: '#161A21' },
  timer: { position: 'absolute', top: 18, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, paddingHorizontal: 12, borderRadius: 8, backgroundColor: 'rgba(11,13,18,0.75)' },
  timerText: { fontFamily: F.medium, fontSize: 13, color: C.ivory, fontVariant: ['tabular-nums'] },
  chip: { position: 'absolute', bottom: 16, alignSelf: 'center', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8, backgroundColor: 'rgba(11,13,18,0.6)' },
  savedChip: { position: 'absolute', top: 16, right: 16, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8, backgroundColor: 'rgba(11,13,18,0.6)' },
  chipText: { fontFamily: F.body, fontSize: 11, letterSpacing: 0.4, color: C.muted },
  switch: { flexDirection: 'row', backgroundColor: C.surface, borderRadius: 999, borderWidth: 1, borderColor: C.line, padding: 4, gap: 4 },
  switchItem: { minWidth: 92, height: 38, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  switchText: { fontFamily: F.bold, fontSize: 12, letterSpacing: 2, textTransform: 'uppercase' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 36, paddingTop: 4, paddingBottom: 36 },
  shutter: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: C.ivory, alignItems: 'center', justifyContent: 'center' },
  flip: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: '#2A2F3A', backgroundColor: '#10131A', alignItems: 'center', justifyContent: 'center' },
});
