// Albums (owner decision 2026-11-25, mockup A): the Home album row, the album screen, and the
// sheets to make, fill, rename and delete albums. Albums are labels only (src/albums.ts):
// nothing on these screens can delete a photo. Removing a photo stays the 파기 button.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { VaultItem } from '../../modules/vault-core';
import { changeAlbums, newAlbumId, useAlbums } from '../albumStore';
import {
  addToAlbum,
  Album,
  cleanName,
  coverOf,
  createAlbum,
  deleteAlbum,
  liveItems,
  MAX_NAME,
  removeFromAlbum,
  renameAlbum,
  setCover,
  sortedAlbums,
} from '../albums';
import { t, tn } from '../i18n';
import { C, F } from '../theme';
import { Thumb } from '../thumb';
import { Body, Button, s } from '../ui';

const GAP = 2;

function saveFailed() {
  Alert.alert(t('album.saveFailed'));
}

/** Folder with a small plus: the "make an album" icon. */
export function FolderPlusIcon({ size = 20, color = C.brass }: { size?: number; color?: string }) {
  return (
    <View style={{ width: size + 4, height: size + 4, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="folder-outline" size={size} color={color} />
      <View style={{ position: 'absolute', top: size * 0.34, left: 0, right: 0, alignItems: 'center' }}>
        <Ionicons name="add" size={Math.round(size * 0.7)} color={color} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------
// Home: the album row under the Photos and Videos cards.

export function AlbumRow({ items, onOpenAlbum, onNewAlbum }: { items: VaultItem[]; onOpenAlbum: (id: string) => void; onNewAlbum: () => void }) {
  const { doc, unreadable } = useAlbums();
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const albums = sortedAlbums(doc);
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, paddingTop: 22, paddingBottom: 10, gap: 8 }}>
        <Text style={{ flex: 1, fontFamily: F.title, fontSize: 18, color: C.muted }} accessibilityRole="header">
          {t('album.section')}
        </Text>
        {!unreadable && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('album.createNew')}
            onPress={onNewAlbum}
            hitSlop={6}
            style={({ pressed }) => [st.newIcon, pressed && { opacity: 0.7 }]}
          >
            <FolderPlusIcon size={18} />
          </Pressable>
        )}
      </View>
      {unreadable ? (
        <Text style={[s.small, { paddingHorizontal: 22 }]}>{t('album.unreadable')}</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 22, gap: 10 }}>
          {albums.map((a) => {
            const cover = coverOf(a, byId);
            const count = liveItems(a, byId).length;
            return (
              <Pressable
                key={a.id}
                accessibilityRole="button"
                accessibilityLabel={`${a.name}, ${tn('settings.items', count)}`}
                onPress={() => onOpenAlbum(a.id)}
                style={({ pressed }) => [{ width: 112 }, pressed && { opacity: 0.85 }]}
              >
                <View style={st.albumCover}>
                  {cover ? (
                    <Thumb item={cover} style={{ width: '100%', height: '100%', aspectRatio: undefined }} />
                  ) : (
                    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="folder-outline" size={30} color={C.faint} />
                    </View>
                  )}
                </View>
                <Text style={st.albumName} numberOfLines={1}>
                  {a.name}
                </Text>
                <Text style={st.albumCount}>{count}</Text>
              </Pressable>
            );
          })}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('album.createNew')}
            onPress={onNewAlbum}
            style={({ pressed }) => [{ width: 112 }, pressed && { opacity: 0.85 }]}
          >
            <View style={[st.albumCover, st.addCover]}>
              <FolderPlusIcon size={26} />
              <Text style={{ fontFamily: F.medium, fontSize: 12, color: C.brass }}>{t('album.new')}</Text>
            </View>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------------------------
// Sheets

function Sheet({ visible, onClose, children, busy }: { visible: boolean; onClose: () => void; children: React.ReactNode; busy?: boolean }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => {
        if (!busy) onClose();
      }} statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={st.scrim} onPress={() => !busy && onClose()} accessibilityLabel={t('common.cancel')} />
        <View style={st.sheet}>
          <View style={st.grabber} />
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

type NameProps = {
  visible: boolean;
  album: Album | null;
  /** For a new album: items to put in it right away (from a selection). */
  initialItems?: string[];
  onCancel: () => void;
  onDone: (albumId: string, name: string) => void;
};

/** Name an album: a new one ([album] null) or a rename. Calls [onDone] with the album id. */
export function AlbumNameSheet(props: NameProps) {
  // Mounted only while shown, so each opening starts fresh.
  return props.visible ? <NameSheetBody {...props} /> : null;
}

function NameSheetBody({
  visible,
  album,
  initialItems = [],
  onCancel,
  onDone,
}: NameProps) {
  const [name, setName] = useState(album?.name ?? '');
  const [busy, setBusy] = useState(false);
  const clean = cleanName(name);
  const save = async () => {
    if (!clean || busy) return;
    setBusy(true);
    try {
      if (album) {
        await changeAlbums((d) => renameAlbum(d, album.id, clean, Date.now()));
        onDone(album.id, clean);
      } else {
        const id = newAlbumId();
        await changeAlbums((d) => createAlbum(d, clean, id, Date.now(), initialItems));
        onDone(id, clean);
      }
    } catch {
      setBusy(false);
      saveFailed();
    }
  };
  const suggestions = t('album.suggestions').split('|');
  return (
    <Sheet visible={visible} onClose={onCancel} busy={busy}>
      <Text style={st.sheetTitle}>{album ? t('album.renameTitle') : t('album.new')}</Text>
      {!album && <Text style={st.sheetBody}>{t('album.nameHint')}</Text>}
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder={t('album.namePlaceholder')}
        placeholderTextColor={C.faint}
        autoFocus
        maxLength={MAX_NAME * 2}
        returnKeyType="done"
        onSubmitEditing={save}
        style={st.input}
        accessibilityLabel={t('album.namePlaceholder')}
      />
      {!album && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {suggestions.map((sug) => (
            <Pressable key={sug} accessibilityRole="button" onPress={() => setName(sug)} style={({ pressed }) => [st.sugg, pressed && { opacity: 0.7 }]}>
              <Text style={{ fontFamily: F.body, fontSize: 13, color: C.muted }}>{sug}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {busy ? (
        <View style={{ height: 56, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.brass} />
        </View>
      ) : (
        <Button
          label={album ? t('album.save') : initialItems.length ? t('album.createNew') : t('album.createPick')}
          onPress={save}
          disabled={!clean}
        />
      )}
    </Sheet>
  );
}

/**
 * "Add to album": puts [ids] into an album the user picks, or into a new one. For the
 * selection mode of the gallery (multi-select) and anywhere else that has a selection.
 */
type AddProps = {
  visible: boolean;
  ids: string[];
  items: VaultItem[];
  onCancel: () => void;
  /** Called after the items were added, with the album's name. */
  onDone: (albumName: string) => void;
};

export function AddToAlbumSheet(props: AddProps) {
  // Mounted only while shown, so each opening starts fresh.
  return props.visible ? <AddSheetBody {...props} /> : null;
}

function AddSheetBody({ visible, ids, items, onCancel, onDone }: AddProps) {
  const { doc } = useAlbums();
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState(false);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const add = async (album: Album) => {
    if (busy) return;
    setBusy(true);
    try {
      await changeAlbums((d) => addToAlbum(d, album.id, ids, Date.now()));
      onDone(album.name);
    } catch {
      setBusy(false);
      saveFailed();
    }
  };
  return (
    <>
      <Sheet visible={visible && !naming} onClose={onCancel} busy={busy}>
        <Text style={st.sheetTitle}>{t('album.addN', { n: ids.length })}</Text>
        <Text style={st.sheetBody}>{t('album.addBody')}</Text>
        <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ paddingBottom: 4 }}>
          <Pressable accessibilityRole="button" onPress={() => setNaming(true)} style={({ pressed }) => [st.row, pressed && { opacity: 0.7 }]}>
            <View style={[st.rowThumb, st.addCover]}>
              <FolderPlusIcon size={22} />
            </View>
            <Text style={[st.rowText, { color: C.brass }]}>{t('album.createNew')}</Text>
          </Pressable>
          {sortedAlbums(doc).map((a) => {
            const cover = coverOf(a, byId);
            return (
              <Pressable key={a.id} accessibilityRole="button" onPress={() => add(a)} style={({ pressed }) => [st.row, pressed && { opacity: 0.7 }]}>
                <View style={st.rowThumb}>
                  {cover ? <Thumb item={cover} style={{ width: '100%', height: '100%', aspectRatio: undefined }} /> : <Ionicons name="folder-outline" size={22} color={C.faint} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.rowText} numberOfLines={1}>
                    {a.name}
                  </Text>
                  <Text style={st.albumCount}>{tn('settings.items', liveItems(a, byId).length)}</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
        {busy && <ActivityIndicator color={C.brass} />}
      </Sheet>
      <AlbumNameSheet
        visible={visible && naming}
        album={null}
        initialItems={ids}
        onCancel={() => setNaming(false)}
        onDone={(_id, name) => {
          setNaming(false);
          onDone(name);
        }}
      />
    </>
  );
}

function DeleteAlbumSheet({ album, visible, onCancel, onDone }: { album: Album; visible: boolean; onCancel: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await changeAlbums((d) => deleteAlbum(d, album.id));
      onDone();
    } catch {
      setBusy(false);
      saveFailed();
    }
  };
  return (
    <Sheet visible={visible} onClose={onCancel} busy={busy}>
      <Text style={st.sheetTitle}>{t('album.deleteTitle', { name: album.name })}</Text>
      <View style={st.safe}>
        <Ionicons name="shield-checkmark-outline" size={20} color={C.ok} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontFamily: F.bold, fontSize: 14, color: '#E6F3E8' }}>{t('album.deleteSafe')}</Text>
          <Text style={{ fontFamily: F.body, fontSize: 13, lineHeight: 20, color: '#CFE6D3' }}>{t('album.deleteSafeBody')}</Text>
        </View>
      </View>
      {busy ? (
        <View style={{ height: 56 + 48, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.brass} />
        </View>
      ) : (
        <>
          <Button label={t('album.deleteConfirm')} kind="ghost" onPress={remove} style={{ backgroundColor: C.surface2 }} />
          <Button label={t('common.cancel')} kind="ghost" onPress={onCancel} style={{ height: 48, borderWidth: 0 }} />
        </>
      )}
    </Sheet>
  );
}

type MenuAction = 'add' | 'remove' | 'cover' | 'rename' | 'delete';

function AlbumMenu({ visible, hasItems, onClose, onPick }: { visible: boolean; hasItems: boolean; onClose: () => void; onPick: (a: MenuAction) => void }) {
  const rows: { key: MenuAction; icon: keyof typeof Ionicons.glyphMap; label: string; show: boolean; warm?: boolean }[] = [
    { key: 'add', icon: 'add-circle-outline', label: t('album.addPhotos'), show: true },
    { key: 'remove', icon: 'remove-circle-outline', label: t('album.removePhotos'), show: hasItems },
    { key: 'cover', icon: 'image-outline', label: t('album.changeCover'), show: hasItems },
    { key: 'rename', icon: 'create-outline', label: t('album.rename'), show: true },
    { key: 'delete', icon: 'folder-open-outline', label: t('album.delete'), show: true, warm: true },
  ];
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View>
        {rows
          .filter((r) => r.show)
          .map((r) => (
            <Pressable key={r.key} accessibilityRole="button" onPress={() => onPick(r.key)} style={({ pressed }) => [st.menuRow, pressed && { opacity: 0.7 }]}>
              <Ionicons name={r.icon} size={20} color={r.warm ? '#F0B98A' : C.ivory} />
              <Text style={[st.rowText, r.warm && { color: '#F0B98A' }]}>{r.label}</Text>
            </Pressable>
          ))}
      </View>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------
// Picking photos for an album (add), out of it (remove) or its cover.

type PickMode = 'add' | 'remove' | 'cover';

function AlbumPicker({ album, items, mode, onClose }: { album: Album; items: VaultItem[]; mode: PickMode; onClose: () => void }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const choices = useMemo(() => {
    if (mode === 'add') {
      const inAlbum = new Set(album.items);
      return [...items].sort((a, b) => b.createdAt - a.createdAt).filter((i) => !inAlbum.has(i.id));
    }
    return liveItems(album, byId);
  }, [mode, album, items, byId]);
  const cols = Math.max(4, Math.floor(width / 96));
  const size = (width - GAP * (cols - 1)) / cols;
  const toggle = (id: string) => {
    if (mode === 'cover') setPicked([id]);
    else setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };
  const apply = async () => {
    if (!picked.length || busy) return;
    setBusy(true);
    const now = Date.now();
    try {
      await changeAlbums((d) =>
        mode === 'add' ? addToAlbum(d, album.id, picked, now) : mode === 'remove' ? removeFromAlbum(d, album.id, picked, now) : setCover(d, album.id, picked[0], now),
      );
      onClose();
    } catch {
      setBusy(false);
      saveFailed();
    }
  };
  const title = mode === 'add' ? t('album.pickTitle') : mode === 'remove' ? t('album.pickRemoveTitle') : t('album.pickCoverTitle');
  const action =
    mode === 'add' ? t('album.pickAdd', { n: picked.length }) : mode === 'remove' ? t('album.pickRemove', { n: picked.length }) : t('album.pickCover');
  return (
    <Modal visible animationType="slide" onRequestClose={() => {
        if (!busy) onClose();
      }} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <View style={[st.bar, { paddingTop: Math.max(insets.top, 20) + 6 }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={() => !busy && onClose()} hitSlop={4} style={st.barBtn}>
            <Ionicons name="close" size={24} color={C.ivory} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={st.barTitle} numberOfLines={1}>
              {title}
            </Text>
            <Text style={st.barSub} numberOfLines={1}>
              {mode === 'cover' ? album.name : t('album.pickSelected', { n: picked.length })}
            </Text>
          </View>
        </View>
        <FlatList
          data={choices}
          key={cols}
          numColumns={cols}
          keyExtractor={(i) => i.id}
          columnWrapperStyle={{ gap: GAP }}
          ItemSeparatorComponent={Separator}
          contentContainerStyle={{ paddingBottom: 140 }}
          renderItem={({ item }) => {
            const on = picked.includes(item.id);
            return (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => toggle(item.id)}
                style={{ width: size, height: size, backgroundColor: on ? C.surface2 : C.surface }}
              >
                <Thumb item={item} style={on ? { position: 'absolute', top: 8, left: 8, right: 8, bottom: 8, borderRadius: 8, aspectRatio: undefined } : { width: size, height: size }} />
                <View style={[st.check, on && st.checkOn]} pointerEvents="none">
                  {on && <Ionicons name="checkmark" size={14} color={C.bg} />}
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View style={[s.card, { margin: 18 }]}>
              <Body>{mode === 'add' ? t('album.nothingToAdd') : t('album.empty')}</Body>
            </View>
          }
        />
        <View style={[st.footer, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          {mode === 'remove' && <Text style={[s.small, { textAlign: 'center' }]}>{t('album.pickRemoveNote')}</Text>}
          {busy ? (
            <View style={{ height: 56, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={C.brass} />
            </View>
          ) : (
            <Button label={action} onPress={apply} disabled={!picked.length} kind={mode === 'remove' ? 'light' : 'primary'} />
          )}
        </View>
      </View>
    </Modal>
  );
}

function Separator() {
  return <View style={{ height: GAP }} />;
}

// ---------------------------------------------------------------------------------------------
// The album itself: its photos edge to edge, and the ⋯ menu.

export function AlbumScreen({
  albumId,
  items,
  startPicking,
  onBack,
  onOpen,
}: {
  albumId: string;
  items: VaultItem[];
  /** Open "Add photos" at once (right after the album was made). */
  startPicking?: boolean;
  onBack: () => void;
  onOpen: (item: VaultItem) => void;
}) {
  const { doc, loaded } = useAlbums();
  const album = doc.albums.find((a) => a.id === albumId) ?? null;
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [menu, setMenu] = useState(false);
  const [pick, setPick] = useState<PickMode | null>(startPicking ? 'add' : null);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const shown = useMemo(() => (album ? liveItems(album, byId) : []), [album, byId]);
  const cols = Math.max(3, Math.floor(width / 130));
  const size = (width - GAP * (cols - 1)) / cols;

  // The album is gone (deleted here): back to Home.
  useEffect(() => {
    if (loaded && !album) onBack();
  }, [loaded, album, onBack]);

  if (!album) return <View style={{ flex: 1, backgroundColor: C.bg }} />;
  const top = Math.max(insets.top, 20) + 6;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <FlatList
        key={cols}
        data={shown}
        numColumns={cols}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => <Thumb item={item} onPress={() => onOpen(item)} style={{ width: size, height: size }} />}
        columnWrapperStyle={{ gap: GAP }}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={{ paddingTop: top + 52, paddingBottom: 60 }}
        ListEmptyComponent={
          <View style={[s.card, { margin: 18, gap: 6 }]}>
            <Body>{t('album.empty')}</Body>
            <Text style={s.small}>{t('album.emptyHint')}</Text>
            <Button label={t('album.addPhotos')} onPress={() => setPick('add')} style={{ marginTop: 10 }} />
          </View>
        }
      />
      <View style={[st.bar, { position: 'absolute', left: 0, right: 0, top: 0, paddingTop: top }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={onBack} hitSlop={4} style={st.barBtn}>
          <Ionicons name="chevron-back" size={24} color={C.ivory} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={st.barTitle} numberOfLines={1} accessibilityRole="header">
            {album.name}
          </Text>
          <Text style={st.barSub}>{tn('settings.items', shown.length)}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('album.menu')} onPress={() => setMenu(true)} hitSlop={4} style={st.barBtn}>
          <Ionicons name="ellipsis-horizontal" size={22} color={C.ivory} />
        </Pressable>
      </View>

      <AlbumMenu
        visible={menu}
        hasItems={shown.length > 0}
        onClose={() => setMenu(false)}
        onPick={(a) => {
          setMenu(false);
          if (a === 'rename') setRenaming(true);
          else if (a === 'delete') setDeleting(true);
          else setPick(a);
        }}
      />
      {pick && <AlbumPicker album={album} items={items} mode={pick} onClose={() => setPick(null)} />}
      <AlbumNameSheet visible={renaming} album={album} onCancel={() => setRenaming(false)} onDone={() => setRenaming(false)} />
      <DeleteAlbumSheet album={album} visible={deleting} onCancel={() => setDeleting(false)} onDone={() => setDeleting(false)} />
    </View>
  );
}

const st = StyleSheet.create({
  newIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(201,166,107,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(201,166,107,0.45)',
  },
  albumCover: { width: 112, height: 112, borderRadius: 16, overflow: 'hidden', backgroundColor: C.surface2, borderWidth: 1, borderColor: C.outline },
  addCover: { backgroundColor: C.surface, borderStyle: 'dashed', borderColor: 'rgba(201,166,107,0.55)', alignItems: 'center', justifyContent: 'center', gap: 6 },
  albumName: { fontFamily: F.medium, fontSize: 14, color: C.ivory, marginTop: 7 },
  albumCount: { fontFamily: F.body, fontSize: 12, color: C.faint, marginTop: 1 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    paddingTop: 14,
    paddingHorizontal: 24,
    paddingBottom: 36,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: '#161A23',
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 14,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#3A3F4A' },
  sheetTitle: { fontFamily: F.title, fontSize: 26, lineHeight: 32, color: C.ivory },
  sheetBody: { fontFamily: F.body, fontSize: 14, lineHeight: 22, color: C.muted },
  input: {
    height: 54,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: C.brass,
    backgroundColor: '#0E1117',
    paddingHorizontal: 16,
    fontFamily: F.medium,
    fontSize: 17,
    color: C.ivory,
  },
  sugg: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: C.outline },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  rowThumb: { width: 50, height: 50, borderRadius: 10, overflow: 'hidden', backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, fontFamily: F.medium, fontSize: 16, color: C.ivory },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: C.line },
  safe: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(123,197,154,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(123,197,154,0.35)',
  },
  bar: {
    paddingHorizontal: 8,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(11,13,18,0.95)',
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  barBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  barTitle: { fontFamily: F.bold, fontSize: 17, color: C.ivory },
  barSub: { fontFamily: F.body, fontSize: 12, color: C.muted },
  check: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: C.brass, borderColor: C.brass },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 12, gap: 8, backgroundColor: 'rgba(11,13,18,0.96)', borderTopWidth: 1, borderTopColor: C.line },
});
