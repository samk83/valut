import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';

import VaultCore, { BackupStatus, ItemKind, VaultItem } from '../../modules/vault-core';
import { autoBackup, backupErrorText } from '../backup';
import { fitToSlots, FREE_LIMIT, freeSlots, refreshPremium, usePremium } from '../premium';
import { C, F } from '../theme';
import { t, tn } from '../i18n';
import * as searchIndex from '../searchIndex';
import { Thumb } from '../thumb';
import { Body, Button, READABLE_WIDTH, s, TestBanner, Title } from '../ui';
import { Gallery } from './Gallery';
import { Search } from './Search';

// Import only copies: the originals always stay in the gallery, and the user deletes them
// there if they want to (owner decision 2026-11-12). The app never deletes from the gallery.
type Result = {
  ok: number;
  failed: number;
  photos: number;
  videos: number;
  cancelled: boolean;
  /** Picked but not added because the free plan was full. Their originals are untouched. */
  leftOut: number;
};
type Progress = { index: number; total: number; sealed: number; sealedCurrent: boolean };
type View_ = 'home' | 'importing' | 'result';

/** Home, a full-screen gallery (photos or videos) or search. */
type Mode = 'home' | ItemKind | 'search';
// Kept while the app runs, so Back from a photo lands on the same gallery or search results.
const remembered: { mode: Mode; searchFrom: Mode } = { mode: 'home', searchFrom: 'home' };

function rememberMode(m: Mode) {
  if (m === 'search' && remembered.mode !== 'search') remembered.searchFrom = remembered.mode;
  remembered.mode = m;
}

/** After a lock the next unlock starts on Home. */
export function resetHomeMode() {
  remembered.mode = 'home';
  remembered.searchFrom = 'home';
}

function searchOrigin(): Mode {
  return remembered.searchFrom;
}

export function Home({
  onOpen,
  onCamera,
  onSettings,
  onBackup,
  onPremium,
  onLock,
  suspendAutoLock,
  refreshKey,
}: {
  /** [highlight]: the search words to mark in the photo. */
  onOpen: (item: VaultItem, highlight?: string) => void;
  onCamera: () => void;
  onSettings: () => void;
  onBackup: () => void;
  onPremium: (reason?: 'limit', itemCount?: number) => void;
  onLock: () => void;
  suspendAutoLock: (on: boolean) => void;
  refreshKey: number;
}) {
  const [items, setItems] = useState<VaultItem[]>([]);
  const plan = usePremium();
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const [mode, setModeState] = useState<Mode>(remembered.mode);
  const setMode = (m: Mode) => {
    rememberMode(m);
    setModeState(m);
  };
  const importing = useRef(false);
  const [view, setView] = useState<View_>('home');
  const [progress, setProgress] = useState<Progress>({ index: 0, total: 0, sealed: 0, sealedCurrent: false });
  const [result, setResult] = useState<Result | null>(null);
  const cancelRef = useRef(false);
  const [cancelling, setCancelling] = useState(false);

  // The free-plan check needs the real count, so it waits until the list has loaded.
  const loadedRef = useRef(false);
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const load = useCallback(async () => {
    try {
      const list = await VaultCore.list();
      itemsRef.current = list;
      loadedRef.current = true;
      setItems(list);
    } catch {
      setItems([]);
    }
    // Anything new (imports, camera, deletes) goes to the backup folder in the background.
    autoBackup();
    VaultCore.backupStatus().then(setBackup).catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // Android back: from a gallery or search, back to Home.
  useEffect(() => {
    if (view !== 'home' || mode === 'home') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setMode(mode === 'search' ? searchOrigin() : 'home');
      return true;
    });
    return () => sub.remove();
  }, [view, mode]);

  // Android back: leave the result page instead of closing the app.
  useEffect(() => {
    if (view === 'home') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (view === 'result') {
        setResult(null);
        setView('home');
      }
      return true; // never leave while importing
    });
    return () => sub.remove();
  }, [view]);

  /** Free plan full: show Premium instead. Asks the store again first, in case it just changed. */
  const roomLeft = async (): Promise<number> => {
    if (!loadedRef.current) await load();
    if (!loadedRef.current) return 0; // Count unknown (vault busy or locked): add nothing.
    let slots = freeSlots(itemsRef.current.length, plan.premium);
    if (slots === 0) slots = freeSlots(itemsRef.current.length, (await refreshPremium()).premium);
    if (slots === 0) onPremium('limit', itemsRef.current.length);
    return slots;
  };

  const importFromGallery = async () => {
    // A second tap while the picker is opening must not start another import.
    if (importing.current) return;
    importing.current = true;
    try {
      await runImport();
    } finally {
      importing.current = false;
    }
  };

  const runImport = async () => {
    const slots = await roomLeft();
    if (slots === 0) return;
    suspendAutoLock(true);
    let picked: ImagePicker.ImagePickerResult;
    try {
      picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
        // Free plan: the picker stops at the space left (0 means no limit). Some pickers
        // ignore it, so the selection is also cut below.
        selectionLimit: Number.isFinite(slots) ? slots : 0,
        quality: 1,
        exif: false,
        // iPhone: keep the photo's own format (HEIC stays HEIC) instead of a converted copy.
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
        legacy: true,
      });
    } catch {
      return;
    } finally {
      suspendAutoLock(false);
    }
    if (picked.canceled || picked.assets.length === 0) return;
    const { take: assets, leftOut } = fitToSlots(picked.assets, slots);
    cancelRef.current = false;
    setCancelling(false);
    setView('importing');
    const total = assets.length;
    let ok = 0;
    let failed = 0;
    let photosAdded = 0;
    let videosAdded = 0;
    let stoppedEarly = false;
    for (const [i, a] of assets.entries()) {
      if (cancelRef.current) {
        stoppedEarly = true;
        break;
      }
      setProgress({ index: i + 1, total, sealed: ok, sealedCurrent: false });
      const isVideo = a.type === 'video';
      try {
        const kind: ItemKind = isVideo ? 'VIDEO' : 'PHOTO';
        // The picker hands us a plaintext copy in the app cache; the native side deletes that
        // temporary copy afterwards (never the gallery original, which stays where it was).
        await VaultCore.importUri(a.uri, kind, a.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg'), true);
        ok++;
        if (isVideo) videosAdded++;
        else photosAdded++;
        setProgress({ index: i + 1, total, sealed: ok, sealedCurrent: true });
      } catch {
        failed++;
      }
    }
    setResult({
      ok,
      failed,
      photos: photosAdded,
      videos: videosAdded,
      cancelled: stoppedEarly,
      leftOut,
    });
    setView('result');
    load();
  };

  const photos = useMemo(() => items.filter((i) => i.kind === 'PHOTO'), [items]);
  const videos = useMemo(() => items.filter((i) => i.kind === 'VIDEO'), [items]);
  const recent = useMemo(() => [...items].sort((a, b) => b.createdAt - a.createdAt), [items]);
  const { width } = useWindowDimensions();
  // Photos without a search note are read in the background while the vault is open.
  useEffect(() => {
    if (loadedRef.current) searchIndex.update(items);
  }, [items]);

  if (view === 'importing') {
    return (
      <Importing
        progress={progress}
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

  const actionBar = (
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
        onPress={async () => {
          await importFromGallery();
        }}
        style={({ pressed }) => [{ flex: 1, height: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderRadius: 16 }, pressed && { backgroundColor: C.surface2 }]}
      >
        <Ionicons name="download-outline" size={20} color={C.ivory} />
        <Text style={{ fontFamily: F.medium, fontSize: 15, color: C.ivory, flexShrink: 1 }} numberOfLines={1}>{t('home.import')}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.camera')}
        onPress={async () => {
          if ((await roomLeft()) > 0) onCamera();
        }}
        style={({ pressed }) => [
          { width: 52, height: 52, borderRadius: 26, backgroundColor: C.brass, alignItems: 'center', justifyContent: 'center' },
          pressed && { opacity: 0.8 },
        ]}
      >
        <Ionicons name="camera-outline" size={24} color={C.bg} />
      </Pressable>
    </View>
  );

  if (mode === 'PHOTO' || mode === 'VIDEO') {
    return (
      <Gallery
        kind={mode}
        items={mode === 'PHOTO' ? photos : videos}
        onBack={() => setMode('home')}
        onOpen={(item) => onOpen(item)}
        onSearch={() => setMode('search')}
        actionBar={actionBar}
      />
    );
  }
  if (mode === 'search') {
    return <Search items={items} onBack={() => setMode(searchOrigin())} onOpen={(item, query) => onOpen(item, query)} />;
  }

  // Up to five rows of the newest items, edge to edge.
  const recentCols = Math.max(4, Math.floor(width / 110));
  const recentTile = Math.floor((width - 2 * (recentCols - 1)) / recentCols);
  const shownRecent = recent.slice(0, recentCols * 5);

  return (
    <View style={[s.screen, { paddingHorizontal: 0, paddingBottom: 0 }]}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 130 }}>
        <View style={{ paddingHorizontal: 22 }}>
          <TestBanner />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 22, paddingRight: 14 }}>
          <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ flexShrink: 1, fontFamily: F.title, fontSize: 28, color: C.ivory }} numberOfLines={1} accessibilityRole="header">
              {t('home.title')}
            </Text>
            {plan.loaded && <PlanBadge premium={plan.premium} used={Math.min(items.length, FREE_LIMIT)} onPress={() => onPremium()} />}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('home.lockNow')}
              onPress={onLock}
              hitSlop={4}
              style={({ pressed }) => [
                // Icon only, so the title and the plan badge fit on one line in every language.
                { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, borderWidth: 1, borderColor: C.outline },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Ionicons name="lock-closed-outline" size={18} color={C.brass} />
            </Pressable>
            <Pressable accessibilityLabel={t('common.settings')} onPress={onSettings} style={{ padding: 8 }}>
              <Ionicons name="settings-outline" size={22} color={C.brass} />
            </Pressable>
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 22, paddingTop: 12 }}>
          <Chip>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.ok }} />
            <Text style={chipText}>{t('home.chipEncrypted')}</Text>
          </Chip>
          <Chip>
            <Text style={chipText}>{t('home.chipOffline')}</Text>
          </Chip>
        </View>
        {!VaultCore.isDemo && backup && (!backup.keyConfirmed || !backup.folderName || !!backup.lastError || backup.restorePending) && (
          <Pressable
            accessibilityRole="button"
            onPress={onBackup}
            style={({ pressed }) => [
              { marginHorizontal: 22, marginTop: 14, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#4A3420', backgroundColor: '#1A1410', flexDirection: 'row', gap: 12, alignItems: 'center' },
              pressed && { opacity: 0.8 },
            ]}
          >
            <Ionicons name={backup.lastError ? 'warning-outline' : 'cloud-upload-outline'} size={22} color="#F0B98A" />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.bold, fontSize: 14, color: '#F0B98A' }}>{backup.restorePending ? t('backup.bannerRestoreTitle') : backup.lastError ? t('backup.bannerProblem') : t('backup.bannerTitle')}
              </Text>
              <Text style={[s.small, { fontSize: 12, color: '#D4C4B5' }]}>{backup.restorePending ? t('backup.bannerRestoreBody') : backup.lastError ? backupErrorText(backup.lastError) : t('backup.bannerBody')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.faint} />
          </Pressable>
        )}

        <Pressable
          accessibilityRole="search"
          accessibilityLabel={t('home.search')}
          onPress={() => setMode('search')}
          style={({ pressed }) => [
            { marginHorizontal: 22, marginTop: 18, height: 50, borderRadius: 16, backgroundColor: C.surface, borderWidth: 1, borderColor: C.outline, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
            pressed && { opacity: 0.8 },
          ]}
        >
          <Ionicons name="search" size={18} color={C.brass} />
          <Text style={{ flex: 1, fontFamily: F.body, fontSize: 15, color: C.faint }} numberOfLines={1}>
            {t('home.search')}
          </Text>
        </Pressable>

        <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 22, paddingTop: 16 }}>
          <CategoryCard kind="PHOTO" count={photos.length} cover={photos.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 4)} onPress={() => setMode('PHOTO')} />
          <CategoryCard kind="VIDEO" count={videos.length} cover={videos.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 1)} onPress={() => setMode('VIDEO')} />
        </View>

        {items.length === 0 ? (
          <View style={[s.card, { margin: 22 }]}>
            <Body>{t('home.noPhotos')}</Body>
            <Text style={s.small}>{t('home.emptyHint')}</Text>
          </View>
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', paddingHorizontal: 22, paddingTop: 24, paddingBottom: 12 }}>
              <Text style={{ flex: 1, fontFamily: F.title, fontSize: 18, color: C.muted }} accessibilityRole="header">
                {t('home.recent')}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => setMode(photos.length ? 'PHOTO' : 'VIDEO')} hitSlop={10}>
                <Text style={{ fontFamily: F.medium, fontSize: 13, color: C.brass }}>{t('home.seeAll')}</Text>
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>
              {shownRecent.map((it) => (
                <Thumb key={it.id} item={it} onPress={() => onOpen(it)} style={{ width: recentTile, height: recentTile }} />
              ))}
            </View>
          </>
        )}
      </ScrollView>
      {actionBar}
    </View>
  );
}

function CategoryCard({ kind, count, cover, onPress }: { kind: ItemKind; count: number; cover: VaultItem[]; onPress: () => void }) {
  const label = kind === 'PHOTO' ? t('home.photos') : t('home.videos');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${count}`}
      onPress={onPress}
      style={({ pressed }) => [{ flex: 1, borderRadius: 22, overflow: 'hidden', backgroundColor: C.surface2, borderWidth: 1, borderColor: C.outline }, pressed && { opacity: 0.85 }]}
    >
      <View style={{ aspectRatio: 1.1, backgroundColor: C.surface2 }}>
        {kind === 'PHOTO' && cover.length >= 2 ? (
          <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>
            {[0, 1, 2, 3].map((i) =>
              cover[i] ? <Thumb key={cover[i].id} item={cover[i]} style={{ width: '49.4%', height: '49.4%', aspectRatio: undefined }} /> : <View key={`e${i}`} style={{ width: '49.4%', height: '49.4%', backgroundColor: C.surface }} />,
            )}
          </View>
        ) : cover[0] ? (
          <Thumb item={cover[0]} style={{ width: '100%', height: '100%', aspectRatio: undefined }} />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={kind === 'PHOTO' ? 'image-outline' : 'videocam-outline'} size={34} color={C.faint} />
          </View>
        )}
      </View>
      {/* A solid strip under the covers, so the name and count read clearly. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: C.surface2, borderTopWidth: 1, borderTopColor: C.outline }}>
        <Ionicons name={kind === 'PHOTO' ? 'image-outline' : 'videocam-outline'} size={18} color={C.brass} />
        <Text style={{ flex: 1, fontFamily: F.medium, fontSize: 16, color: C.ivory }} numberOfLines={1}>
          {label}
        </Text>
        <Text style={{ fontFamily: F.medium, fontSize: 15, color: C.ivory }}>{count}</Text>
      </View>
    </Pressable>
  );
}

/** Next to the title: "12 of 100 free" on the free plan (opens Premium), "Pro" after purchase. */
function PlanBadge({ premium, used, onPress }: { premium: boolean; used: number; onPress: () => void }) {
  if (premium) {
    return (
      <View accessible accessibilityLabel={t('plan.proA11y')} style={{ paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: C.brass }}>
        <Text style={{ fontFamily: F.bold, fontSize: 12, color: C.bg }}>{t('plan.pro')}</Text>
      </View>
    );
  }
  const full = used >= FREE_LIMIT;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('plan.chipA11y', { used, max: FREE_LIMIT })}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        { flexShrink: 0, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: full ? C.brass : C.outline, backgroundColor: C.surface2 },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={{ fontFamily: F.medium, fontSize: 12, color: full ? C.brass : C.muted }} numberOfLines={1}>
        {t('plan.chip', { used, max: FREE_LIMIT })}
      </Text>
    </Pressable>
  );
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

function Importing({ progress, cancelling, onCancel }: { progress: Progress; cancelling: boolean; onCancel: () => void }) {
  const { index, total, sealed, sealedCurrent } = progress;
  const pct = total ? Math.round(((index - 1 + (sealedCurrent ? 1 : 0.5)) / total) * 100) : 0;
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
      <Body style={{ color: C.muted, marginBottom: 12 }}>{t('importing.copyNote')}</Body>
      <Step n={1} label={t('import.stepEncrypt')} state={sealedCurrent ? 'done' : 'active'} />
      <Step n={2} label={t('import.stepVerify')} state={sealedCurrent ? 'done' : 'todo'} />
      <Step n={3} label={t('import.stepKeep')} state={sealedCurrent ? 'done' : 'todo'} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 }}>
        <Ionicons name="lock-closed" size={14} color={C.ok} />
        <Text style={[s.body, { color: C.ok }]}>{t('importing.sealed', { n: sealed })}</Text>
      </View>
    </Page>
  );
}

function ImportResult({ result, onDone }: { result: Result; onDone: () => void }) {
  const r = result;
  return (
    <Page footer={<Button label={t('result.backToVault')} onPress={onDone} />}>
      <View style={{ height: 24 }} />
      <Text style={s.label}>{t('result.complete')}</Text>
      <View style={{ height: 8 }} />
      <Title>{t('result.title', { ok: r.ok })}</Title>
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
        {r.failed > 0 && (
          <InfoRow icon="alert-circle" color={C.danger}>
            <Text style={[s.body, { fontFamily: F.bold, color: C.danger }]}>{t('result.failed', { n: r.failed })}</Text>
            <Text style={s.small}>{t('result.failedBody')}</Text>
          </InfoRow>
        )}
        {r.leftOut > 0 && (
          <InfoRow icon="information-circle-outline" color={C.brass}>
            <Text style={[s.body, { fontFamily: F.bold }]}>
              {tn('plan.leftOut', r.leftOut)}
            </Text>
            <Text style={s.small}>{t('plan.leftOutBody', { max: FREE_LIMIT })}</Text>
          </InfoRow>
        )}
        {r.ok > 0 && (
          <InfoRow icon="images-outline" color={C.faint}>
            <Text style={[s.body, { fontFamily: F.bold }]}>{t('result.stillInGallery')}</Text>
            <Text style={s.small}>{t('result.deleteYourself')}</Text>
          </InfoRow>
        )}
      </View>
    </Page>
  );
}
