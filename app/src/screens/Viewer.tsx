import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Alert, Image, Pressable, Text, View } from 'react-native';

import VaultCore, { VaultItem } from '../../modules/vault-core';
import { C } from '../theme';
import { Busy, s } from '../ui';

function Bar({ item, onClose, onDeleted }: { item: VaultItem; onClose: () => void; onDeleted: () => void }) {
  const confirmDelete = () =>
    Alert.alert('Delete permanently?', 'This item is erased from the vault. It cannot be recovered.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await VaultCore.delete(item.id);
          onDeleted();
        },
      },
    ]);
  return (
    <View style={{ position: 'absolute', top: 48, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' }}>
      <Pressable onPress={onClose} style={{ padding: 8 }}>
        <Text style={{ color: C.ivory, fontSize: 16 }}>‹ Back</Text>
      </Pressable>
      <Text style={[s.small, { padding: 8 }]}>{new Date(item.createdAt).toLocaleString()}</Text>
      <Pressable onPress={confirmDelete} style={{ padding: 8 }}>
        <Text style={{ color: C.danger, fontSize: 16 }}>Delete</Text>
      </Pressable>
    </View>
  );
}

/** Decrypted in memory only; there is no share or save button (SPEC AC-40). */
export function PhotoViewer({ item, onClose, onDeleted }: { item: VaultItem; onClose: () => void; onDeleted: () => void }) {
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    VaultCore.readPhoto(item.id)
      .then((b64) => setUri(`data:${item.mimeType || 'image/jpeg'};base64,${b64}`))
      .catch(() => setError(true));
  }, [item]);
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {uri && <Image source={{ uri }} style={{ flex: 1 }} resizeMode="contain" />}
      {error && <Text style={[s.body, { margin: 24, marginTop: 120, color: C.danger }]}>This item failed its integrity check and is blocked.</Text>}
      <Bar item={item} onClose={onClose} onDeleted={onDeleted} />
      {!uri && !error && <Busy label="Decrypting…" />}
    </View>
  );
}

export function VideoPlayer({ item, onClose, onDeleted }: { item: VaultItem; onClose: () => void; onDeleted: () => void }) {
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  useEffect(() => {
    VaultCore.openVideo(item.id).then(setUri).catch(() => setError(true));
    return () => VaultCore.closeVideo();
  }, [item]);
  useEffect(() => {
    if (uri) player.play();
  }, [uri, player]);
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {uri && <VideoView player={player} style={{ flex: 1 }} nativeControls contentFit="contain" />}
      {error && <Text style={[s.body, { margin: 24, marginTop: 120, color: C.danger }]}>This item failed its integrity check and is blocked.</Text>}
      <Bar item={item} onClose={onClose} onDeleted={onDeleted} />
      {!uri && !error && <Busy label="Decrypting…" />}
    </View>
  );
}
