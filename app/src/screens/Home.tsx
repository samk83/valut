import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library/legacy';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Image, Pressable, Text, View } from 'react-native';

import VaultCore, { ItemKind, VaultItem } from '../../modules/vault-core';
import { C } from '../theme';
import { Body, Busy, Button, s, Segmented, TestBanner, Title } from '../ui';

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
  const [tab, setTab] = useState<ItemKind>('PHOTO');
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<{ ok: number; failed: number; deleted: number; kept: number; note: string | null; deleteChosen: boolean } | null>(null);

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

  /** Deletes the gallery originals of verified imports. Only exact matches are removed. */
  const deleteOriginals = async (imported: Imported[]): Promise<{ deleted: number; kept: number; note: string | null }> => {
    if (VaultCore.isDemo) {
      return { deleted: 0, kept: imported.length, note: 'Preview only: nothing is kept after the app closes, so originals are never deleted here. The real app deletes them at this step.' };
    }
    const candidates = imported.filter((d) => d.safe && d.assetId);
    const unknown = imported.length - candidates.length;
    if (candidates.length === 0) {
      return { deleted: 0, kept: imported.length, note: imported.length ? 'The gallery did not say which originals these were, so they were left in place.' : null };
    }
    suspendAutoLock(true);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) return { deleted: 0, kept: imported.length, note: 'Photo access was not granted, so the originals are still in your gallery.' };
      // Re-read each original and compare it with the vault copy; only exact matches go.
      const ids: string[] = [];
      for (const d of candidates) {
        if (await VaultCore.matchesOriginal(d.id, d.assetId as string, d.kind).catch(() => false)) ids.push(d.assetId as string);
      }
      if (ids.length > 0 && !(await MediaLibrary.deleteAssetsAsync(ids))) {
        return { deleted: 0, kept: imported.length, note: 'Deletion was cancelled, so the originals are still in your gallery.' };
      }
      const kept = imported.length - ids.length;
      return {
        deleted: ids.length,
        kept,
        note: kept > 0 ? `${kept} original(s) could not be confirmed identical to the vault copy${unknown ? ' or were not identified' : ''} and were left in your gallery.` : null,
      };
    } catch {
      return { deleted: 0, kept: imported.length, note: 'The originals could not be deleted. Remove them in the Photos app.' };
    } finally {
      suspendAutoLock(false);
    }
  };

  const importFromGallery = async (deleteAfter: boolean) => {
    setAsking(false);
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
    const imported: Imported[] = [];
    for (const [i, a] of picked.assets.entries()) {
      setBusy(`Encrypting ${i + 1} of ${picked.assets.length}…\nEncrypt → verify → ${deleteAfter ? 'delete original' : 'register'}`);
      const isVideo = a.type === 'video';
      try {
        // The picker hands us a plaintext copy in the app cache; the native side deletes it.
        const r = await VaultCore.importUri(a.uri, isVideo ? 'VIDEO' : 'PHOTO', a.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg'), true);
        ok++;
        imported.push({ id: r.id, kind: isVideo ? 'VIDEO' : 'PHOTO', assetId: a.assetId, safe: r.safeToDeleteOriginal });
      } catch {
        failed++;
      }
    }
    let gone = { deleted: 0, kept: 0, note: null as string | null };
    if (deleteAfter && imported.length > 0) {
      setBusy('Deleting the originals that were sealed…');
      gone = await deleteOriginals(imported);
    }
    setBusy(null);
    setResult({ ok, failed, ...gone, deleteChosen: deleteAfter });
    load();
  };

  const photos = items.filter((i) => i.kind === 'PHOTO');
  const videos = items.filter((i) => i.kind === 'VIDEO');
  const shown = tab === 'PHOTO' ? photos : videos;

  return (
    <View style={[s.screen, { paddingHorizontal: 16 }]}>
      {VaultCore.isDemo && <TestBanner />}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, marginBottom: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>Vault · {items.length} items</Text>
          <Title>PrivateVault</Title>
        </View>
        <Pressable accessibilityLabel="Settings" onPress={onSettings} style={{ padding: 8 }}>
          <Ionicons name="settings-outline" size={24} color={C.brass} />
        </Pressable>
      </View>
      <View style={{ marginHorizontal: 4, marginBottom: 12 }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'PHOTO', label: `Photos ${photos.length}`, icon: <Ionicons name="image-outline" size={18} color={tab === 'PHOTO' ? C.bg : C.ivory} /> },
            { value: 'VIDEO', label: `Videos ${videos.length}`, icon: <Ionicons name="videocam-outline" size={18} color={tab === 'VIDEO' ? C.bg : C.ivory} /> },
          ]}
        />
      </View>
      <FlatList
        key={tab}
        data={shown}
        keyExtractor={(i) => i.id}
        numColumns={3}
        style={{ flex: 1 }}
        columnWrapperStyle={{ gap: 4 }}
        contentContainerStyle={{ gap: 4 }}
        ListEmptyComponent={
          <View style={[s.card, { margin: 8 }]}>
            <Body>{tab === 'PHOTO' ? 'No photos yet.' : 'No videos yet.'}</Body>
            <Text style={s.small}>Use the vault camera, or import from your gallery.</Text>
          </View>
        }
        renderItem={({ item }) => <Thumb item={item} onPress={() => onOpen(item)} />}
      />
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
        <Button label="Camera" onPress={onCamera} style={{ flex: 1 }} />
        <Button label="Import" kind="ghost" onPress={() => setAsking(true)} style={{ flex: 1 }} />
      </View>
      {busy && <Busy label={busy} />}
      {asking && (
        <View style={[s.busy, { alignItems: 'stretch' }]}>
          <View style={s.card}>
            <Text style={s.label}>Import from gallery</Text>
            <Title>Keep the originals?</Title>
            <Body style={{ color: C.muted, marginBottom: 16 }}>
              With delete, every original you pick is removed from the gallery once its vault copy is sealed and checked. The phone asks you to confirm, and deleted items stay in Recently Deleted for 30 days.
            </Body>
            <Button label="Import & delete originals" kind="danger" onPress={() => importFromGallery(true)} />
            <View style={{ height: 10 }} />
            <Button label="Import & keep originals" kind="ghost" onPress={() => importFromGallery(false)} />
            <View style={{ height: 10 }} />
            <Button label="Cancel" kind="ghost" style={{ borderColor: 'transparent' }} onPress={() => setAsking(false)} />
          </View>
        </View>
      )}
      {result && (
        <View style={[s.busy, { alignItems: 'stretch' }]}>
          <View style={s.card}>
            <Text style={s.label}>Import result</Text>
            <Title>
              {result.ok} sealed{result.deleteChosen ? ` · ${result.deleted} originals deleted` : ''}
            </Title>
            {result.failed > 0 && <Body style={{ color: C.danger }}>{result.failed} failed. Nothing was saved for those and their originals are untouched.</Body>}
            {result.note && <Body style={{ color: C.muted }}>{result.note}</Body>}
            <Body style={{ color: C.muted, marginBottom: 16 }}>
              {result.deleteChosen
                ? 'Deleted originals stay in Recently Deleted for 30 days and may remain in cloud backups.'
                : 'The originals are still in your gallery.'}
            </Body>
            <Button label="Done" onPress={() => setResult(null)} />
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
        <View style={{ position: 'absolute', bottom: 4, right: 4, backgroundColor: 'rgba(11,13,18,0.7)', borderRadius: 10, padding: 3 }}>
          <Ionicons name="play" size={12} color={C.ivory} />
        </View>
      )}
    </Pressable>
  );
}
