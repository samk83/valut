import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import VaultCore, { VaultItem } from '../../modules/vault-core';
import { Key, month, t } from '../i18n';
import en from '../i18n/en';
import { CATEGORIES, Filter, searchNotes, snippet, terms } from '../search';
import { entries, getNote, useSearchProgress } from '../searchIndex';
import { C, F } from '../theme';
import { Thumb } from '../thumb';
import { s } from '../ui';

// Kept while the app runs, so Back from a photo returns to the same results.
const remembered: { query: string; filter: Filter } = { query: '', filter: 'all' };

function rememberQuery(q: string) {
  remembered.query = q;
}

function rememberFilter(f: Filter) {
  remembered.filter = f;
}

export function resetSearchScreen() {
  remembered.query = '';
  remembered.filter = 'all';
}

const FILTERS: { key: Filter; label: Key }[] = [
  { key: 'all', label: 'search.filterAll' },
  { key: 'text', label: 'search.filterText' },
  { key: 'document', label: 'search.filterDocument' },
  { key: 'screenshot', label: 'search.filterScreenshot' },
];

/** Category words in the user's language plus English, e.g. food → "음식, 식사, …, food, meal". */
const categoryNames = (): Record<string, string> =>
  Object.fromEntries(
    CATEGORIES.map((c) => {
      const key = `search.cat.${c.key}` as Key;
      return [c.key, `${t(key)}, ${en[key] as string}`];
    }),
  );

const dayOf = (ms: number) => {
  const d = new Date(ms);
  return t('date.dayYear', { month: month(d.getMonth()), day: d.getDate(), year: d.getFullYear() });
};

export function Search({ items, onBack, onOpen }: { items: VaultItem[]; onBack: () => void; onOpen: (item: VaultItem, query: string) => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [query, setQueryState] = useState(remembered.query);
  const [filter, setFilterState] = useState<Filter>(remembered.filter);
  const [settled, setSettled] = useState(remembered.query);
  const progress = useSearchProgress();
  const names = useMemo(() => categoryNames(), []);

  const setQuery = (q: string) => {
    rememberQuery(q);
    setQueryState(q);
  };
  const setFilter = (f: Filter) => {
    rememberFilter(f);
    setFilterState(f);
  };
  // Search once typing pauses.
  useEffect(() => {
    const id = setTimeout(() => setSettled(query), 150);
    return () => clearTimeout(id);
  }, [query]);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const results = useMemo(
    () => searchNotes(entries(), settled, filter, names),
    // progress.done changes whenever a newly read photo arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settled, filter, names, progress.done, items],
  );
  const textHits = results.text.flatMap((h) => (byId.has(h.id) ? [byId.get(h.id)!] : []));
  const contentHits = results.content.flatMap((h) => (byId.has(h.id) ? [byId.get(h.id)!] : []));
  const firstWord = terms(settled)[0] ?? '';
  const browsing = !terms(settled).length;
  const cols = Math.max(3, Math.floor(width / 130));
  const tile = Math.floor((width - 2 * (cols - 1)) / cols);
  const preparing = VaultCore.canRead && progress.total > 0 && progress.done < progress.total;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: Math.max(insets.top, 20) + 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 }}>
        <View
          style={{
            flex: 1,
            height: 46,
            borderRadius: 14,
            backgroundColor: C.surface2,
            borderWidth: 1,
            borderColor: C.brass,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingLeft: 12,
            paddingRight: 6,
          }}
        >
          <Ionicons name="search" size={17} color={C.brass} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            autoFocus={!remembered.query && remembered.filter === 'all'}
            placeholder={t('home.search')}
            placeholderTextColor={C.faint}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            textContentType="none"
            autoComplete="off"
            importantForAutofill="no"
            accessibilityLabel={t('gallery.search')}
            style={{ flex: 1, minWidth: 0, color: C.ivory, fontFamily: F.body, fontSize: 16, paddingVertical: 0 }}
          />
          {!!query && (
            <Pressable accessibilityRole="button" accessibilityLabel={t('search.clear')} onPress={() => setQuery('')} hitSlop={8} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="close-circle" size={20} color={C.faint} />
            </Pressable>
          )}
        </View>
        <Pressable accessibilityRole="button" onPress={onBack} hitSlop={6} style={{ paddingVertical: 12, paddingHorizontal: 4 }}>
          <Text style={{ fontFamily: F.medium, fontSize: 15, color: C.brass }}>{t('common.cancel')}</Text>
        </Pressable>
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 }} keyboardShouldPersistTaps="handled">
          {FILTERS.map((f) => {
            const on = filter === f.key;
            return (
              <Pressable
                key={f.key}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setFilter(f.key)}
                style={{
                  height: 36,
                  paddingHorizontal: 14,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: on ? C.brass : C.outline,
                  backgroundColor: on ? C.brass : 'transparent',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontFamily: F.medium, fontSize: 13, color: on ? C.bg : C.ivory }}>{t(f.label)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 90 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {!VaultCore.canRead && (
          <View style={[s.card, { margin: 16 }]}>
            <Text style={s.small}>{t('search.unavailable')}</Text>
          </View>
        )}
        {preparing && (
          <View style={{ margin: 16, padding: 16, borderRadius: 18, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, gap: 10 }}>
            <Text style={{ fontFamily: F.bold, fontSize: 14, color: C.ivory }}>{t('search.preparing', { done: progress.done, total: progress.total })}</Text>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: C.line, overflow: 'hidden' }}>
              <View style={{ width: `${Math.round((progress.done / progress.total) * 100)}%`, height: 6, backgroundColor: C.brass }} />
            </View>
            <Text style={s.small}>{t('search.preparingBody')}</Text>
          </View>
        )}

        {browsing && filter === 'all' && VaultCore.canRead && <Text style={[s.small, { marginHorizontal: 16, marginTop: 18 }]}>{t('search.hint')}</Text>}

        {textHits.length > 0 && (
          <>
            <SectionHeader icon="text-outline" title={browsing ? t(FILTERS.find((f) => f.key === filter)!.label) : t('search.inText')} count={textHits.length} />
            {browsing ? (
              <Grid items={textHits} tile={tile} onOpen={(i) => onOpen(i, '')} />
            ) : (
              <View style={{ gap: 2 }}>
                {textHits.map((item) => {
                  const note = getNote(item.id);
                  const sn = note ? snippet(note, firstWord) : null;
                  return (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      onPress={() => onOpen(item, settled)}
                      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: C.surface }, pressed && { opacity: 0.75 }]}
                    >
                      <Thumb item={item} rounded style={{ width: 64, height: 64 }} />
                      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                        {sn && (
                          <Text style={{ fontFamily: F.body, fontSize: 14, lineHeight: 20, color: C.muted }} numberOfLines={2}>
                            {sn.before}
                            <Text style={{ color: C.ivory, fontFamily: F.bold, backgroundColor: 'rgba(201,166,107,0.28)' }}>{sn.match}</Text>
                            {sn.after}
                          </Text>
                        )}
                        <Text style={{ fontFamily: F.body, fontSize: 12, color: C.faint }}>{dayOf(item.createdAt)}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </>
        )}

        {contentHits.length > 0 && (
          <>
            <SectionHeader icon="image-outline" title={t('search.inContent')} count={contentHits.length} />
            <Grid items={contentHits} tile={tile} onOpen={(i) => onOpen(i, '')} />
          </>
        )}

        {(!browsing || filter !== 'all') && textHits.length === 0 && contentHits.length === 0 && VaultCore.canRead && (
          <Text style={[s.small, { marginHorizontal: 16, marginTop: 24, textAlign: 'center' }]}>
            {t('search.none', { q: browsing ? t(FILTERS.find((f) => f.key === filter)!.label) : settled.trim() })}
          </Text>
        )}
      </ScrollView>

      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingVertical: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.line }}>
        <Ionicons name="lock-closed" size={13} color={C.ok} />
        <Text style={[s.small, { fontSize: 12, flex: 1 }]}>{t('search.privacy')}</Text>
      </View>
    </View>
  );
}

function SectionHeader({ icon, title, count }: { icon: keyof typeof Ionicons.glyphMap; title: string; count: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 22, paddingBottom: 10 }}>
      <Ionicons name={icon} size={16} color={C.brass} />
      <Text style={{ flex: 1, fontFamily: F.bold, fontSize: 14, color: C.ivory }}>{title}</Text>
      <Text style={{ fontFamily: F.body, fontSize: 13, color: C.muted }}>{count}</Text>
    </View>
  );
}

function Grid({ items, tile, onOpen }: { items: VaultItem[]; tile: number; onOpen: (item: VaultItem) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>
      {items.slice(0, 300).map((item) => (
        <Thumb key={item.id} item={item} onPress={() => onOpen(item)} style={{ width: tile, height: tile }} />
      ))}
    </View>
  );
}
