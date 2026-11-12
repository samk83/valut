import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Image, Pressable, ScrollView, SectionList, Text, useWindowDimensions, View } from 'react-native';

import VaultCore, { ItemKind, VaultItem } from '../../modules/vault-core';
import { fitToSlots, FREE_LIMIT, freeSlots, refreshPremium, usePremium } from '../premium';
import { C, F } from '../theme';
import { monthStandalone, t, tn } from '../i18n';
import { Body, Button, READABLE_WIDTH, s, Segmented, TestBanner, Title } from '../ui';

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

let lastTab: ItemKind = 'PHOTO';

export function Home({
  onOpen,
  onCamera,
  onSettings,
  onPremium,
  onLock,
  suspendAutoLock,
  refreshKey,
}: {
  onOpen: (item: VaultItem) => void;
  onCamera: () => void;
  onSettings: () => void;
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
  // Remembered across visits so Back from a video lands on the Videos page again.
  const [tab, setTabState] = useState<ItemKind>(lastTab);
  const setTab = (t: ItemKind) => {
    lastTab = t;
    setTabState(t);
  };
  const importing = useRef(false);
  const [view, setView] = useState<View_>('home');
  const [progress, setProgress] = useState<Progress>({ index: 0, total: 0, sealed: 0, sealedCurrent: false });
  const [result, setResult] = useState<Result | null>(null);
  const cancelRef = useRef(false);
  const [cancelling, setCancelling] = useState(false);

  // The free-plan check needs the real count, so it waits until the list has loaded.
  const loadedRef = useRef(false);
  const load = useCallback(async () => {
    try {
      const list = await VaultCore.list();
      itemsRef.current = list;
      loadedRef.current = true;
      setItems(list);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

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
  const shown = tab === 'PHOTO' ? photos : videos;
  // 3 columns on a phone; more on an iPad or an unfolded iPhone (about 130 pt per tile).
  const { width } = useWindowDimensions();
  const cols = Math.max(3, Math.min(8, Math.floor(width / 130)));
  const sections = useMemo(() => byMonth(shown, cols), [shown, cols]);

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
        {plan.loaded && !plan.premium && (
          <Pressable accessibilityRole="button" accessibilityLabel={t('plan.chipA11y', { used: Math.min(items.length, FREE_LIMIT), max: FREE_LIMIT })} onPress={() => onPremium()}>
            <Chip>
              <Text style={[chipText, items.length >= FREE_LIMIT && { color: C.brass }]}>
                {t('plan.chip', { used: Math.min(items.length, FREE_LIMIT), max: FREE_LIMIT })}
              </Text>
            </Chip>
          </Pressable>
        )}
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
