import { CameraType, CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';

import VaultCore from '../../modules/vault-core';
import { C } from '../theme';
import { Body, Busy, Button, s, Title } from '../ui';

/** Captures straight into the vault. Nothing is saved to the gallery and no location is added. */
export function VaultCamera({ onClose, suspendAutoLock }: { onClose: (saved: boolean) => void; suspendAutoLock: (on: boolean) => void }) {
  const ref = useRef<CameraView>(null);
  const [cam, requestCam] = useCameraPermissions();
  const [mic, requestMic] = useMicrophonePermissions();
  const [mode, setMode] = useState<'picture' | 'video'>('picture');
  const [facing, setFacing] = useState<CameraType>('back');
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(0);

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

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView ref={ref} style={{ flex: 1 }} facing={facing} mode={mode} mute={false} />
      <View style={{ position: 'absolute', top: 48, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' }}>
        <Pressable onPress={() => onClose(saved > 0)} disabled={recording} style={{ padding: 8 }}>
          <Text style={{ color: C.ivory, fontSize: 16 }}>✕ Done</Text>
        </Pressable>
        <Text style={[s.label, { padding: 8 }]}>{recording ? '● REC' : `Vault camera · ${saved} saved`}</Text>
      </View>
      <View style={{ paddingVertical: 24, paddingHorizontal: 24, backgroundColor: C.bg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 24, marginBottom: 16 }}>
          {(['picture', 'video'] as const).map((m) => (
            <Pressable key={m} disabled={recording} onPress={() => setMode(m)}>
              <Text style={[s.label, { color: mode === m ? C.brass : C.muted }]}>{m === 'picture' ? 'Photo' : 'Video'}</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ width: 56 }} />
          <Pressable
            accessibilityLabel="Shutter"
            onPress={shutter}
            style={{ width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: C.brass, alignItems: 'center', justifyContent: 'center' }}
          >
            <View style={{ width: recording ? 28 : 58, height: recording ? 28 : 58, borderRadius: recording ? 6 : 29, backgroundColor: mode === 'video' ? C.danger : C.ivory }} />
          </Pressable>
          <Pressable accessibilityLabel="Flip camera" disabled={recording} onPress={() => setFacing(facing === 'back' ? 'front' : 'back')} style={{ width: 56, alignItems: 'center' }}>
            <Text style={{ color: C.ivory, fontSize: 26 }}>⟲</Text>
          </Pressable>
        </View>
      </View>
      {busy && <Busy label="Encrypting into the vault…" />}
    </View>
  );
}
