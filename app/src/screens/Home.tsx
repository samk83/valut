import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library/legacy';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Image, Pressable, Text, View } from 'react-native';

import VaultCore, { ItemKind, VaultItem } from '../../modules/vault-core';
import { C } from '../theme';
import { Body, Busy, Button, s, TestBanner, Title } from '../ui';

type Imported = { id: string; kind: ItemKind; assetId?: string | null; safe: boolean };

export function Home({
  onOpen,
  onCamera,
  onSettings,
  suspendAutoLock,
  refreshKey,
}: {
  onOpen: (item: VaultItem) => void;
  onCamera: () => void;
  onSettings: () => void;
  suspendAutoLock: (on: boolean) => void;
  refreshKey: number;
}) {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: number; failed: number; deletable: Imported[] } | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await VaultCore.list());
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const importFromGallery = async () => {
    suspendAutoLock(true);
    let picked: ImagePicker.ImagePickerResult;
    try {
      picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, quality: 1, exif: false, legacy: true });
    } finally {
      suspendAutoLock(false);
    }
    if (picked.canceled) return;
    let ok = 0;
    let failed = 0;
    const deletable: Imported[] = [];
    for (const [i, a] of picked.assets.entries()) {
      setBusy(`Encrypting ${i + 1} of ${picked.assets.length}…\nEncrypt → verify → register`);
      const isVideo = a.type === 'video';
      try {
        // The picker hands us a plaintext copy in the app cache; the native side deletes it.
        const r = await VaultCore.importUri(a.uri, isVideo ? 'VIDEO' : 'PHOTO', a.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg'), true);
        ok++;
        deletable.push({ id: r.id, kind: isVideo ? 'VIDEO' : 'PHOTO', assetId: a.assetId, safe: r.safeToDeleteOriginal });
      } catch {
        failed++;
      }
    }
    setBusy(null);
    setResult({ ok, failed, deletable });
    load();
  };

  const deleteOriginals = async () => {
    if (!result) return;
    const candidates = result.deletable.filter((d) => d.safe && d.assetId);
    if (candidates.length === 0) {
      Alert.alert('Originals kept', 'The gallery did not report which originals these were, so they were left untouched. Delete them yourself in the Gallery app.');
      return setResult(null);
    }
    suspendAutoLock(true);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Originals kept', 'Permission was not granted. The originals are still in your gallery.');
        return;
      }
      // Re-read each original and compare it with the vault copy; only exact matches go.
      const ids: string[] = [];
      for (const d of candidates) {
        if (await VaultCore.matchesOriginal(d.id, d.assetId as string, d.kind).catch(() => false)) ids.push(d.assetId as string);
      }
      if (ids.length > 0) await MediaLibrary.deleteAssetsAsync(ids);
      if (ids.length < candidates.length) {
        Alert.alert('Some originals kept', `${candidates.length - ids.length} original(s) could not be confirmed identical to the vault copy and were left in your gallery.`);
      }
    } catch {
      Alert.alert('Originals kept', 'The originals could not be deleted. Remove them manually in the Gallery app.');
    } finally {
      suspendAutoLock(false);
      setResult(null);
    }
  };

  return (
    <View style={[s.screen, { paddingHorizontal: 16 }]}>
      {VaultCore.isDemo && <TestBanner />}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, marginBottom: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>Vault · {items.length} items</Text>
          <Title>PrivateVault</Title>
        </View>
        <Pressable accessibilityLabel="Settings" onPress={onSettings} style={{ padding: 8 }}>
          <Text style={{ color: C.brass, fontSize: 24 }}>⚙</Text>
        </Pressable>
      </View>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        numColumns={3}
        style={{ flex: 1 }}
        columnWrapperStyle={{ gap: 4 }}
        contentContainerStyle={{ gap: 4 }}
        ListEmptyComponent={
          <View style={[s.card, { margin: 8 }]}>
            <Body>Empty vault.</Body>
            <Text style={s.small}>Take a photo or video with the vault camera, or import from your gallery. Use test pictures only.</Text>
          </View>
        }
        renderItem={({ item }) => <Thumb item={item} onPress={() => onOpen(item)} />}
      />
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
        <Button label="Camera" onPress={onCamera} style={{ flex: 1 }} />
        <Button label="Import" kind="ghost" onPress={importFromGallery} style={{ flex: 1 }} />
      </View>
      {busy && <Busy label={busy} />}
      {result && (
        <View style={[s.busy, { alignItems: 'stretch' }]}>
          <View style={s.card}>
            <Text style={s.label}>Import result</Text>
            <Title>{result.ok} sealed</Title>
            {result.failed > 0 && <Body style={{ color: C.danger }}>{result.failed} failed — nothing was saved for those, originals untouched.</Body>}
            <Body style={{ color: C.muted, marginBottom: 16 }}>
              Copies are encrypted and verified. The originals are still in your gallery. Delete them now? Android will ask you to confirm. Copies may remain in cloud backups or the gallery's trash.
            </Body>
            <Button label="Delete originals" kind="danger" onPress={deleteOriginals} />
            <View style={{ height: 10 }} />
            <Button label="Keep originals" kind="ghost" onPress={() => setResult(null)} />
          </View>
        </View>
      )}
    </View>
  );
}

function Thumb({ item, onPress }: { item: VaultItem; onPress: () => void }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    VaultCore.thumbnailUri(item.id)
      .then((u) => live && u && setUri(u))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [item.id]);
  return (
    <Pressable onPress={onPress} style={{ flex: 1 / 3, aspectRatio: 1, backgroundColor: C.surface, borderRadius: 6, overflow: 'hidden' }}>
      {uri && <Image source={{ uri }} style={{ width: '100%', height: '100%' }} />}
      {item.kind === 'VIDEO' && (
        <Text style={{ position: 'absolute', bottom: 4, right: 6, color: C.ivory, fontSize: 14 }}>▶</Text>
      )}
    </Pressable>
  );
}
