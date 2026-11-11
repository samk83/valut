import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library/legacy';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Image, Platform, Pressable, ScrollView, SectionList, Switch, Text, useWindowDimensions, View } from 'react-native';

import VaultCore, { ItemKind, VaultItem } from '../../modules/vault-core';
import { C, F } from '../theme';
import { monthStandalone, t, tn } from '../i18n';
import { Body, Bullet, Button, READABLE_WIDTH, Rich, s, Segmented, TestBanner, Title } from '../ui';

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
      return { deleted: 0, kept: imported.length, note: t('note.preview') };
    }
    const candidates = imported.filter((d) => d.safe && d.assetId);
    const unknown = imported.length - candidates.length;
    if (candidates.length === 0) {
      return { deleted: 0, kept: imported.length, note: imported.length ? t('note.notIdentified') : null };
    }
    suspendAutoLock(true);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) return { deleted: 0, kept: imported.length, note: t('note.noAccess') };
      // Re-read each original and compare it with the vault copy; only exact matches go.
      const ids: string[] = [];
      for (const d of candidates) {
        if (await VaultCore.matchesOriginal(d.id, d.assetId as string, d.kind).catch(() => false)) ids.push(d.assetId as string);
      }
      if (ids.length > 0 && !(await MediaLibrary.deleteAssetsAsync(ids))) {
        return { deleted: 0, kept: imported.length, note: t('note.deleteCancelled') };
      }
      const kept = imported.length - ids.length;
      return {
        deleted: ids.length,
        kept,
        note: kept > 0 ? tn(unknown ? 'note.keptUnconfirmedOrUnknown' : 'note.keptUnconfirmed', kept) : null,
      };
    } catch {
      return { deleted: 0, kept: imported.length, note: t('note.deleteFailed') };
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
    // iPhone: the exact original is imported straight from Photos (so it can be verified and
    // deleted later), which needs Photos access. Asked before the picker opens.
    let fromAsset = false;
    try {
      if (Platform.OS === 'ios' && deleteChosen && VaultCore.importAsset) {
        fromAsset = (await MediaLibrary.requestPermissionsAsync().catch(() => ({ granted: false }))).granted;
      }
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
        const kind: ItemKind = isVideo ? 'VIDEO' : 'PHOTO';
        let r: { id: string; safeToDeleteOriginal: boolean } | null = null;
        if (fromAsset && a.assetId && VaultCore.importAsset) {
          r = await VaultCore.importAsset(a.assetId, kind, a.uri).catch(() => null);
        }
        // The picker hands us a plaintext copy in the app cache; the native side deletes it.
        if (!r) r = await VaultCore.importUri(a.uri, kind, a.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg'), true);
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
  // 3 columns on a phone; more on an iPad or an unfolded iPhone (about 130 pt per tile).
  const { width } = useWindowDimensions();
  const cols = Math.max(3, Math.min(8, Math.floor(width / 130)));
  const sections = useMemo(() => byMonth(shown, cols), [shown, cols]);

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
          <Text style={[s.label, { color: C.faint }]}>Private Vision Vault</Text>
          <Text style={{ fontFamily: F.title, fontSize: 34, color: C.ivory, marginTop: 6 }}>{t('home.title')}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('home.lockNow')}
            onPress={onLock}
            style={({ pressed }) => [
              { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: C.outline },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Ionicons name="lock-closed-outline" size={15} color={C.brass} />
            <Text style={{ fontFamily: F.medium, fontSize: 13, color: C.ivory }}>{t('home.lockNow')}</Text>
          </Pressable>
          <Pressable accessibilityLabel={t('common.settings')} onPress={onSettings} style={{ padding: 8 }}>
            <Ionicons name="settings-outline" size={22} color={C.brass} />
          </Pressable>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 22, paddingTop: 14 }}>
        <Chip>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.ok }} />
          <Text style={chipText}>{t('home.chipEncrypted')}</Text>
        </Chip>
        <Chip>
          <Text style={chipText}>{t('home.chipOffline')}</Text>
        </Chip>
      </View>
      <View style={{ paddingHorizontal: 22, paddingTop: 18 }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'PHOTO', label: t('home.photosTab', { n: photos.length }), icon: <Ionicons name="image-outline" size={18} color={tab === 'PHOTO' ? C.brass : C.faint} /> },
            { value: 'VIDEO', label: t('home.videosTab', { n: videos.length }), icon: <Ionicons name="videocam-outline" size={18} color={tab === 'VIDEO' ? C.brass : C.faint} /> },
          ]}
        />
      </View>
      <SectionList
        key={`${tab}-${cols}`}
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
            {Array.from({ length: cols - row.length }).map((_, i) => (
              <View key={`pad${i}`} style={{ flex: 1 }} />
            ))}
          </View>
        )}
        ListEmptyComponent={
          <View style={[s.card, { margin: 18 }]}>
            <Body>{tab === 'PHOTO' ? t('home.noPhotos') : t('home.noVideos')}</Body>
            <Text style={s.small}>{t('home.emptyHint')}</Text>
          </View>
        }
      />
      <View
        style={{
          position: 'absolute',
          // Phone: 22 pt from each edge. iPad / unfolded: a centred bar at most 560 pt wide.
          left: Math.max(22, (width - 560) / 2),
          right: Math.max(22, (width - 560) / 2),
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
          <Text style={{ fontFamily: F.medium, fontSize: 15, color: C.ivory, flexShrink: 1 }} numberOfLines={1}>{t('home.import')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.camera')}
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
function byMonth(list: VaultItem[], cols: number): { title: string; data: VaultItem[][] }[] {
  const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt);
  const out: { title: string; data: VaultItem[][] }[] = [];
  let current: { title: string; items: VaultItem[] } | null = null;
  const groups: { title: string; items: VaultItem[] }[] = [];
  for (const it of sorted) {
    const d = new Date(it.createdAt);
    const title = t('home.month', { month: monthStandalone(d.getMonth()), year: d.getFullYear() });
    if (!current || current.title !== title) {
      current = { title, items: [] };
      groups.push(current);
    }
    current.items.push(it);
  }
  for (const g of groups) {
    const rows: VaultItem[][] = [];
    for (let i = 0; i < g.items.length; i += cols) rows.push(g.items.slice(i, i + cols));
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
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24, width: '100%', maxWidth: READABLE_WIDTH, alignSelf: 'center' }}>
        {children}
      </ScrollView>
      {footer && <View style={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 30, width: '100%', maxWidth: READABLE_WIDTH, alignSelf: 'center' }}>{footer}</View>}
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
    <Page footer={<Button label={t('import.choose')} onPress={onChoose} />}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={onBack} style={{ alignSelf: 'flex-start', padding: 8, marginLeft: -8, marginBottom: 12 }}>
        <Ionicons name="chevron-back" size={26} color={C.ivory} />
      </Pressable>
      <Text style={s.label}>{t('import.beforeYouPick')}</Text>
      <View style={{ height: 8 }} />
      <Title>{t('import.title')}</Title>
      <Body style={{ color: C.muted, marginBottom: 20 }}>{t('import.intro')}</Body>

      <View style={[s.card, { borderColor: deleteAfter ? C.brassDim : C.line }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text style={[s.body, { flex: 1, fontFamily: F.bold }]}>{t('import.deleteOriginals')}</Text>
          <Switch
            value={deleteAfter}
            onValueChange={setDeleteAfter}
            trackColor={{ true: C.brass, false: C.outline }}
            thumbColor={C.ivory}
            ios_backgroundColor={C.outline}
            accessibilityLabel={t('import.deleteOriginals')}
          />
        </View>
        <Text style={[s.small, { marginTop: 8 }]}>
          {deleteAfter
            ? t('import.deleteOn')
            : t('import.deleteOff')}
        </Text>
      </View>

      <Text style={[s.label, { color: C.faint, marginTop: 24, marginBottom: 6 }]}>{t('import.forEach')}</Text>
      <Step n={1} label={t('import.stepEncrypt')} state="active" />
      <Step n={2} label={t('import.stepVerify')} state="active" />
      <Step n={3} label={deleteAfter ? t('import.stepDelete') : t('import.stepKeep')} state="active" />
      <Text style={[s.small, { marginTop: 8 }]}>{t('import.failKeeps')}</Text>

      <View style={{ height: 20 }} />
      <InfoRow icon="information-circle-outline" color={C.faint}>
        <Text style={s.small}>{t('import.systemDialog')}</Text>
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
        <Title>{t('importing.deleting')}</Title>
        <Body style={{ color: C.muted, textAlign: 'center' }}>
          {t('importing.deletingBody')}
        </Body>
      </View>
    );
  }
  return (
    <Page
      footer={
        <>
          <Text style={[s.small, { textAlign: 'center', marginBottom: 12 }]}>{t('importing.keepOpen')}</Text>
          <Button label={cancelling ? t('importing.stopping') : t('importing.cancel')} kind="ghost" disabled={cancelling} onPress={onCancel} />
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
      <Text style={s.label}>{t('importing.sealing')}</Text>
      <View style={{ height: 8 }} />
      <Title>{t('importing.progress', { index, total })}</Title>
      {deleteChosen && <Body style={{ color: C.muted, marginBottom: 12 }}>{t('importing.deleteNote')}</Body>}
      <Step n={1} label={t('import.stepEncrypt')} state={sealedCurrent ? 'done' : 'active'} />
      <Step n={2} label={t('import.stepVerify')} state={sealedCurrent ? 'done' : 'todo'} />
      <Step n={3} label={deleteChosen ? t('import.stepDelete') : t('import.stepKeep')} state={sealedCurrent ? (deleteChosen ? 'active' : 'done') : 'todo'} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 }}>
        <Ionicons name="lock-closed" size={14} color={C.ok} />
        <Text style={[s.body, { color: C.ok }]}>{t('importing.sealed', { n: sealed })}</Text>
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
          <Button label={t('result.howToEmpty')} kind="ghost" onPress={() => setHelp((h) => !h)} />
          <View style={{ height: 10 }} />
          <Button label={t('result.backToVault')} onPress={onDone} />
        </>
      }
    >
      <View style={{ height: 24 }} />
      <Text style={s.label}>{t('result.complete')}</Text>
      <View style={{ height: 8 }} />
      <Title>{r.deleteChosen ? t('result.titleDeleted', { ok: r.ok, deleted: r.deleted }) : t('result.title', { ok: r.ok })}</Title>
      <Text style={[s.small, { marginBottom: 20 }]}>
        {tn('result.photos', r.photos)} · {tn('result.videos', r.videos)}
        {r.cancelled ? t('result.cancelled') : ''}
      </Text>

      <View style={{ gap: 14 }}>
        {r.ok > 0 && (
          <InfoRow icon="checkmark-circle" color={C.ok}>
            <Text style={[s.body, { fontFamily: F.bold }]}>{t('result.verified')}</Text>
            <Text style={s.small}>{t('result.allStored', { n: r.ok })}</Text>
          </InfoRow>
        )}
        {r.deleted > 0 && (
          <InfoRow icon="checkmark-circle" color={C.ok}>
            <Text style={[s.body, { fontFamily: F.bold }]}>{t('result.originalsDeleted')}</Text>
          </InfoRow>
        )}
        {r.failed > 0 && (
          <InfoRow icon="alert-circle" color={C.danger}>
            <Text style={[s.body, { fontFamily: F.bold, color: C.danger }]}>{t('result.failed', { n: r.failed })}</Text>
            <Text style={s.small}>{t('result.failedBody')}</Text>
          </InfoRow>
        )}
        {r.note && (
          <InfoRow icon="information-circle-outline" color={C.faint}>
            <Text style={s.small}>{r.note}</Text>
          </InfoRow>
        )}
        {!r.deleteChosen && (
          <InfoRow icon="information-circle-outline" color={C.faint}>
            <Text style={s.small}>{t('result.stillInGallery')}</Text>
          </InfoRow>
        )}
      </View>

      <View style={[s.card, { marginTop: 24, gap: 6 }]}>
        <Text style={[s.body, { fontFamily: F.bold, marginBottom: 4 }]}>{t('result.copiesTitle')}</Text>
        <Bullet>{t('result.copiesRecent')}</Bullet>
        <Bullet>{t('result.copiesCloud')}</Bullet>
        <Bullet>{t('result.copiesSent')}</Bullet>
      </View>

      {help && (
        <View style={[s.card, { marginTop: 12, gap: 8 }]}>
          <Rich text={t('result.helpIphone')} style={s.small} strongStyle={{ fontFamily: F.bold, color: C.ivory }} />
          <Rich text={t('result.helpAndroid')} style={s.small} strongStyle={{ fontFamily: F.bold, color: C.ivory }} />
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
