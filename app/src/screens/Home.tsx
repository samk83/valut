import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library/legacy';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Image, Pressable, ScrollView, SectionList, Switch, Text, View } from 'react-native';

import VaultCore, { ItemKind, VaultItem } from '../../modules/vault-core';
import { C, F } from '../theme';
import { Body, Bullet, Button, s, Segmented, TestBanner, Title } from '../ui';

type Imported = { id: string; kind: ItemKind; assetId?: string | null; safe: boolean };
type Result = {
  ok: number;
  failed: number;
  deleted: number;
  kept: number;
  note: string | null;
  deleteChosen: boolean;
  photos: number;
  videos: number;
  cancelled: boolean;
};
type Progress = { index: number; total: number; sealed: number; sealedCurrent: boolean };
type View_ = 'home' | 'options' | 'importing' | 'deleting' | 'result';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

let lastTab: ItemKind = 'PHOTO';

export function Home({
  onOpen,
  onCamera,
  onSettings,
  onLock,
  suspendAutoLock,
  refreshKey,
}: {
  onOpen: (item: VaultItem) => void;
  onCamera: () => void;
  onSettings: () => void;
  onLock: () => void;
  suspendAutoLock: (on: boolean) => void;
  refreshKey: number;
}) {
  const [items, setItems] = useState<VaultItem[]>([]);
  // Remembered across visits so Back from a video lands on the Videos page again.
  const [tab, setTabState] = useState<ItemKind>(lastTab);
  const setTab = (t: ItemKind) => {
    lastTab = t;
    setTabState(t);
  };
  const importing = useRef(false);
  const [view, setView] = useState<View_>('home');
  const [deleteAfter, setDeleteAfter] = useState(true);
  const [progress, setProgress] = useState<Progress>({ index: 0, total: 0, sealed: 0, sealedCurrent: false });
  const [result, setResult] = useState<Result | null>(null);
  const cancelRef = useRef(false);
  const [cancelling, setCancelling] = useState(false);

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

  // Android back: leave the options page or the result page instead of closing the app.
  useEffect(() => {
    if (view === 'home') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (view === 'options') setView('home');
      if (view === 'result') {
        setResult(null);
        setView('home');
      }
      return true; // never leave while importing or deleting
    });
    return () => sub.remove();
  }, [view]);

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

  const importFromGallery = async (deleteChosen: boolean) => {
    // A second tap while the picker is opening must not start another import.
    if (importing.current) return;
    importing.current = true;
    try {
      await runImport(deleteChosen);
    } finally {
      importing.current = false;
    }
  };

  const runImport = async (deleteChosen: boolean) => {
    suspendAutoLock(true);
    let picked: ImagePicker.ImagePickerResult;
    try {
      picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, quality: 1, exif: false, legacy: true });
    } catch {
      return;
    } finally {
      suspendAutoLock(false);
    }
    if (picked.canceled || picked.assets.length === 0) return;
    cancelRef.current = false;
    setCancelling(false);
    setView('importing');
    const total = picked.assets.length;
    let ok = 0;
    let failed = 0;
    const imported: Imported[] = [];
    let stoppedEarly = false;
    for (const [i, a] of picked.assets.entries()) {
      if (cancelRef.current) {
        stoppedEarly = true;
        break;
      }
      setProgress({ index: i + 1, total, sealed: ok, sealedCurrent: false });
      const isVideo = a.type === 'video';
      try {
        // The picker hands us a plaintext copy in the app cache; the native side deletes it.
        const r = await VaultCore.importUri(a.uri, isVideo ? 'VIDEO' : 'PHOTO', a.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg'), true);
        ok++;
        imported.push({ id: r.id, kind: isVideo ? 'VIDEO' : 'PHOTO', assetId: a.assetId, safe: r.safeToDeleteOriginal });
        setProgress({ index: i + 1, total, sealed: ok, sealedCurrent: true });
      } catch {
        failed++;
      }
    }
    let gone = { deleted: 0, kept: 0, note: null as string | null };
    // Only the items that were sealed reach this step; failed or skipped ones are never touched.
    if (deleteChosen && imported.length > 0) {
      setView('deleting');
      gone = await deleteOriginals(imported);
    }
    setResult({
      ok,
      failed,
      ...gone,
      deleteChosen,
      photos: imported.filter((d) => d.kind === 'PHOTO').length,
      videos: imported.filter((d) => d.kind === 'VIDEO').length,
      cancelled: stoppedEarly,
    });
    setView('result');
    load();
  };

  const photos = useMemo(() => items.filter((i) => i.kind === 'PHOTO'), [items]);
  const videos = useMemo(() => items.filter((i) => i.kind === 'VIDEO'), [items]);
  const shown = tab === 'PHOTO' ? photos : videos;
  const sections = useMemo(() => byMonth(shown), [shown]);

  if (view === 'options') {
    return <ImportOptions deleteAfter={deleteAfter} setDeleteAfter={setDeleteAfter} onBack={() => setView('home')} onChoose={() => importFromGallery(deleteAfter)} />;
  }
  if (view === 'importing' || view === 'deleting') {
    return (
      <Importing
        progress={progress}
        deleting={view === 'deleting'}
        deleteChosen={deleteAfter}
        cancelling={cancelling}
        onCancel={() => {
          cancelRef.current = true;
          setCancelling(true);
        }}
      />
    );
  }
  if (view === 'result' && result) {
    return (
      <ImportResult
        result={result}
        onDone={() => {
          setResult(null);
          setView('home');
        }}
      />
    );
  }

  return (
    <View style={[s.screen, { paddingHorizontal: 0, paddingBottom: 0 }]}>
      <View style={{ paddingHorizontal: 22 }}>
        <TestBanner />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 22 }}>
        <View style={{ flex: 1 }}>
          <Text style={[s.label, { color: C.faint }]}>PrivateVault</Text>
          <Text style={{ fontFamily: F.title, fontSize: 34, color: C.ivory, marginTop: 6 }}>Your Vault</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Lock now"
            onPress={onLock}
            style={({ pressed }) => [
              { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: C.outline },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Ionicons name="lock-closed-outline" size={15} color={C.brass} />
            <Text style={{ fontFamily: F.medium, fontSize: 13, color: C.ivory }}>Lock now</Text>
          </Pressable>
          <Pressable accessibilityLabel="Settings" onPress={onSettings} style={{ padding: 8 }}>
            <Ionicons name="settings-outline" size={22} color={C.brass} />
          </Pressable>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 22, paddingTop: 14 }}>
        <Chip>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.ok }} />
          <Text style={chipText}>Encrypted on device</Text>
        </Chip>
        <Chip>
          <Text style={chipText}>Offline · no cloud</Text>
        </Chip>
      </View>
      <View style={{ paddingHorizontal: 22, paddingTop: 18 }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'PHOTO', label: `Photos ${photos.length}`, icon: <Ionicons name="image-outline" size={18} color={tab === 'PHOTO' ? C.brass : C.faint} /> },
            { value: 'VIDEO', label: `Videos ${videos.length}`, icon: <Ionicons name="videocam-outline" size={18} color={tab === 'VIDEO' ? C.brass : C.faint} /> },
          ]}
        />
      </View>
      <SectionList
        key={tab}
        sections={sections}
        keyExtractor={(row) => row.map((i) => i.id).join('|')}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 4, paddingBottom: 130 }}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Text style={{ fontFamily: F.title, fontSize: 17, color: C.muted, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 10 }}>{section.title}</Text>
        )}
        renderItem={({ item: row }) => (
          <View style={{ flexDirection: 'row', gap: 4, marginBottom: 4 }}>
            {row.map((it) => (
              <Thumb key={it.id} item={it} onPress={() => onOpen(it)} />
            ))}
            {Array.from({ length: 3 - row.length }).map((_, i) => (
              <View key={`pad${i}`} style={{ flex: 1 }} />
            ))}
          </View>
        )}
        ListEmptyComponent={
          <View style={[s.card, { margin: 18 }]}>
            <Body>{tab === 'PHOTO' ? 'No photos yet.' : 'No videos yet.'}</Body>
            <Text style={s.small}>Use the vault camera, or import from your gallery.</Text>
          </View>
        }
      />
      <View
        style={{
          position: 'absolute',
          left: 22,
          right: 22,
          bottom: 30,
          height: 72,
          borderRadius: 24,
          backgroundColor: 'rgba(28,33,44,0.96)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.10)',
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: 8,
          paddingRight: 10,
          shadowColor: '#000',
          shadowOpacity: 0.55,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 12 },
          elevation: 12,
        }}
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => setView('options')}
          style={({ pressed }) => [{ flex: 1, height: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderRadius: 16 }, pressed && { backgroundColor: C.surface2 }]}
        >
          <Ionicons name="download-outline" size={20} color={C.ivory} />
          <Text style={{ fontFamily: F.medium, fontSize: 15, color: C.ivory }}>Import from Photos</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Camera"
          onPress={onCamera}
          style={({ pressed }) => [
            { width: 52, height: 52, borderRadius: 26, backgroundColor: C.brass, alignItems: 'center', justifyContent: 'center' },
            pressed && { opacity: 0.8 },
          ]}
        >
          <Ionicons name="camera-outline" size={24} color={C.bg} />
        </Pressable>
      </View>
    </View>
  );
}

/** Newest first, grouped by month, three tiles per row. */
function byMonth(list: VaultItem[]): { title: string; data: VaultItem[][] }[] {
  const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt);
  const out: { title: string; data: VaultItem[][] }[] = [];
  let current: { title: string; items: VaultItem[] } | null = null;
  const groups: { title: string; items: VaultItem[] }[] = [];
  for (const it of sorted) {
    const d = new Date(it.createdAt);
    const title = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    if (!current || current.title !== title) {
      current = { title, items: [] };
      groups.push(current);
    }
    current.items.push(it);
  }
  for (const g of groups) {
    const rows: VaultItem[][] = [];
    for (let i = 0; i < g.items.length; i += 3) rows.push(g.items.slice(i, i + 3));
    out.push({ title: g.title, data: rows });
  }
  return out;
}

const chipText = { fontFamily: F.body, fontSize: 11, color: C.muted };

function Chip({ children }: { children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: C.outline }}>
      {children}
    </View>
  );
}

function Page({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <View style={[s.screen, { paddingHorizontal: 0, paddingBottom: 0 }]}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24 }}>
        {children}
      </ScrollView>
      {footer && <View style={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 30 }}>{footer}</View>}
    </View>
  );
}

function Step({ n, label, state }: { n: number; label: string; state: 'todo' | 'active' | 'done' }) {
  const done = state === 'done';
  const active = state === 'active';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: done ? C.ok : active ? C.brass : C.outline,
          backgroundColor: done ? 'rgba(123,197,154,0.12)' : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {done ? (
          <Ionicons name="checkmark" size={16} color={C.ok} />
        ) : (
          <Text style={{ fontFamily: F.bold, fontSize: 13, lineHeight: 16, color: active ? C.brass : C.faint, includeFontPadding: false }}>{n}</Text>
        )}
      </View>
      <Text style={[s.body, { flex: 1, color: state === 'todo' ? C.muted : C.ivory }]}>{label}</Text>
    </View>
  );
}

function InfoRow({ icon, color, children }: { icon: keyof typeof Ionicons.glyphMap; color: string; children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <Ionicons name={icon} size={20} color={color} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

function ImportOptions({
  deleteAfter,
  setDeleteAfter,
  onBack,
  onChoose,
}: {
  deleteAfter: boolean;
  setDeleteAfter: (v: boolean) => void;
  onBack: () => void;
  onChoose: () => void;
}) {
  return (
    <Page footer={<Button label="Choose photos and videos" onPress={onChoose} />}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={{ alignSelf: 'flex-start', padding: 8, marginLeft: -8, marginBottom: 12 }}>
        <Ionicons name="chevron-back" size={26} color={C.ivory} />
      </Pressable>
      <Text style={s.label}>Before you pick</Text>
      <View style={{ height: 8 }} />
      <Title>Import from your gallery</Title>
      <Body style={{ color: C.muted, marginBottom: 20 }}>Choose what happens to the originals first. It applies to every item you pick.</Body>

      <View style={[s.card, { borderColor: deleteAfter ? C.brassDim : C.line }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text style={[s.body, { flex: 1, fontFamily: F.bold }]}>Delete originals after import</Text>
          <Switch
            value={deleteAfter}
            onValueChange={setDeleteAfter}
            trackColor={{ true: C.brass, false: C.outline }}
            thumbColor={C.ivory}
            ios_backgroundColor={C.outline}
            accessibilityLabel="Delete originals after import"
          />
        </View>
        <Text style={[s.small, { marginTop: 8 }]}>
          {deleteAfter
            ? 'On. Every imported original is deleted from your gallery once its encrypted copy is verified.'
            : 'Off. Originals stay in your gallery. You can delete them yourself later.'}
        </Text>
      </View>

      <Text style={[s.label, { color: C.faint, marginTop: 24, marginBottom: 6 }]}>For each item</Text>
      <Step n={1} label="Encrypt into the vault" state="active" />
      <Step n={2} label="Verify the encrypted copy" state="active" />
      <Step n={3} label={deleteAfter ? 'Delete the original' : 'Keep the original'} state="active" />
      <Text style={[s.small, { marginTop: 8 }]}>If encryption or verification fails, that original is kept.</Text>

      <View style={{ height: 20 }} />
      <InfoRow icon="information-circle-outline" color={C.faint}>
        <Text style={s.small}>
          iPhone and Android ask you to confirm the deletion once in a system dialog. Deleted items stay in Recently Deleted for 30 days until you empty it.
        </Text>
      </InfoRow>
    </Page>
  );
}

function Importing({
  progress,
  deleting,
  deleteChosen,
  cancelling,
  onCancel,
}: {
  progress: Progress;
  deleting: boolean;
  deleteChosen: boolean;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const { index, total, sealed, sealedCurrent } = progress;
  const pct = total ? Math.round(((index - 1 + (sealedCurrent ? 1 : 0.5)) / total) * 100) : 0;
  if (deleting) {
    return (
      <View style={[s.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <Ionicons name="trash-outline" size={40} color={C.brass} />
        <View style={{ height: 16 }} />
        <Title>Deleting originals…</Title>
        <Body style={{ color: C.muted, textAlign: 'center' }}>
          Only originals whose encrypted copy matches exactly are removed. Confirm in the system dialog if asked.
        </Body>
      </View>
    );
  }
  return (
    <Page
      footer={
        <>
          <Text style={[s.small, { textAlign: 'center', marginBottom: 12 }]}>Keep the app open. If it closes, any original not yet verified stays in your gallery.</Text>
          <Button label={cancelling ? 'Stopping after this item…' : 'Cancel import'} kind="ghost" disabled={cancelling} onPress={onCancel} />
        </>
      }
    >
      <View style={{ alignItems: 'center', marginTop: 24, marginBottom: 24 }}>
        <View style={{ width: 168, height: 168, borderRadius: 84, borderWidth: 6, borderColor: C.line, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: F.title, fontSize: 48, color: C.ivory }}>{Math.min(pct, 100)}%</Text>
        </View>
        <View style={{ width: 168, height: 4, borderRadius: 2, backgroundColor: C.line, marginTop: 16, overflow: 'hidden' }}>
          <View style={{ width: `${Math.min(pct, 100)}%`, height: 4, backgroundColor: C.brass }} />
        </View>
      </View>
      <Text style={s.label}>Sealing</Text>
      <View style={{ height: 8 }} />
      <Title>
        Encrypting {index} of {total}
      </Title>
      {deleteChosen && <Body style={{ color: C.muted, marginBottom: 12 }}>Each original is deleted from your gallery only after its encrypted copy is verified.</Body>}
      <Step n={1} label="Encrypt into the vault" state={sealedCurrent ? 'done' : 'active'} />
      <Step n={2} label="Verify the encrypted copy" state={sealedCurrent ? 'done' : 'todo'} />
      <Step n={3} label={deleteChosen ? 'Delete the original' : 'Keep the original'} state={sealedCurrent ? (deleteChosen ? 'active' : 'done') : 'todo'} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 }}>
        <Ionicons name="lock-closed" size={14} color={C.ok} />
        <Text style={[s.body, { color: C.ok }]}>{sealed} sealed</Text>
      </View>
    </Page>
  );
}

function ImportResult({ result, onDone }: { result: Result; onDone: () => void }) {
  const [help, setHelp] = useState(false);
  const r = result;
  return (
    <Page
      footer={
        <>
          <Button label="How to empty Recently Deleted" kind="ghost" onPress={() => setHelp((h) => !h)} />
          <View style={{ height: 10 }} />
          <Button label="Back to vault" onPress={onDone} />
        </>
      }
    >
      <View style={{ height: 24 }} />
      <Text style={s.label}>Import complete</Text>
      <View style={{ height: 8 }} />
      <Title>{r.deleteChosen ? `${r.ok} sealed · ${r.deleted} originals deleted` : `${r.ok} sealed`}</Title>
      <Text style={[s.small, { marginBottom: 20 }]}>
        {r.photos} {r.photos === 1 ? 'photo' : 'photos'} · {r.videos} {r.videos === 1 ? 'video' : 'videos'}
        {r.cancelled ? ' · import cancelled' : ''}
      </Text>

      <View style={{ gap: 14 }}>
        {r.ok > 0 && (
          <InfoRow icon="checkmark-circle" color={C.ok}>
            <Text style={[s.body, { fontFamily: F.bold }]}>Encrypted and verified</Text>
            <Text style={s.small}>All {r.ok} stored inside the vault</Text>
          </InfoRow>
        )}
        {r.deleted > 0 && (
          <InfoRow icon="checkmark-circle" color={C.ok}>
            <Text style={[s.body, { fontFamily: F.bold }]}>Originals deleted from gallery</Text>
          </InfoRow>
        )}
        {r.failed > 0 && (
          <InfoRow icon="alert-circle" color={C.danger}>
            <Text style={[s.body, { fontFamily: F.bold, color: C.danger }]}>{r.failed} failed · original kept</Text>
            <Text style={s.small}>Nothing was saved for those and their originals are untouched.</Text>
          </InfoRow>
        )}
        {r.note && (
          <InfoRow icon="information-circle-outline" color={C.faint}>
            <Text style={s.small}>{r.note}</Text>
          </InfoRow>
        )}
        {!r.deleteChosen && (
          <InfoRow icon="information-circle-outline" color={C.faint}>
            <Text style={s.small}>The originals are still in your gallery.</Text>
          </InfoRow>
        )}
      </View>

      <View style={[s.card, { marginTop: 24, gap: 6 }]}>
        <Text style={[s.body, { fontFamily: F.bold, marginBottom: 4 }]}>Copies may still exist</Text>
        <Bullet>Recently Deleted keeps them for 30 days on iPhone and Android. Empty it to remove them now.</Bullet>
        <Bullet>iCloud Photos or Google Photos backups</Bullet>
        <Bullet>Anything you already sent through other apps</Bullet>
      </View>

      {help && (
        <View style={[s.card, { marginTop: 12, gap: 8 }]}>
          <Text style={s.small}>
            <Text style={{ fontFamily: F.bold, color: C.ivory }}>iPhone: </Text>Photos › Albums › Recently Deleted › Select › Delete All
          </Text>
          <Text style={s.small}>
            <Text style={{ fontFamily: F.bold, color: C.ivory }}>Android: </Text>Gallery/Photos › Trash/Bin › Empty
          </Text>
        </View>
      )}
    </Page>
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
    <Pressable onPress={onPress} style={{ flex: 1, aspectRatio: 1, backgroundColor: C.surface, borderRadius: 6, overflow: 'hidden' }}>
      {uri && <Image source={{ uri }} style={{ width: '100%', height: '100%' }} />}
      {item.kind === 'VIDEO' && (
        <View style={{ position: 'absolute', bottom: 4, right: 4, backgroundColor: 'rgba(11,13,18,0.7)', borderRadius: 10, padding: 3 }}>
          <Ionicons name="play" size={12} color={C.ivory} />
        </View>
      )}
    </Pressable>
  );
}
