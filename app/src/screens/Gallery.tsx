import Ionicons from '@expo/vector-icons/Ionicons';
import { ReactNode, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, NativeScrollEvent, NativeSyntheticEvent, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ItemKind, VaultItem } from '../../modules/vault-core';
import { monthStandalone, t } from '../i18n';
import { C, F } from '../theme';
import { Thumb } from '../thumb';
import { Body, s } from '../ui';

const GAP = 2;
// Remembered while the app runs.
const remembered = { dense: false };
function rememberDense(on: boolean) {
  remembered.dense = on;
}

const monthOf = (ms: number) => {
  const d = new Date(ms);
  return t('home.month', { month: monthStandalone(d.getMonth()), year: d.getFullYear() });
};

/**
 * Photos or videos edge to edge. The top bar slides away while scrolling down and comes back
 * on the way up, so the photos get the whole screen.
 */
export function Gallery({
  kind,
  items,
  onBack,
  onOpen,
  onSearch,
  actionBar,
}: {
  kind: ItemKind;
  items: VaultItem[];
  onBack: () => void;
  onOpen: (item: VaultItem) => void;
  onSearch: () => void;
  actionBar: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [isDense, setDense] = useState(remembered.dense);
  // About 130 pt per tile normally (3 on a phone), about 78 pt when dense (5 on a phone).
  const cols = isDense ? Math.max(5, Math.floor(width / 78)) : Math.max(3, Math.floor(width / 130));
  const size = (width - GAP * (cols - 1)) / cols;
  const sorted = useMemo(() => [...items].sort((a, b) => b.createdAt - a.createdAt), [items]);
  const [month, setMonth] = useState(sorted[0] ? monthOf(sorted[0].createdAt) : '');

  const top = Math.max(insets.top, 20) + 6;
  const barHeight = top + 52;
  const [shift] = useState(() => new Animated.Value(0));
  const hidden = useRef(false);
  const lastY = useRef(0);
  const showBar = (show: boolean) => {
    if (hidden.current === !show) return;
    hidden.current = !show;
    Animated.timing(shift, { toValue: show ? 0 : -barHeight, duration: 180, useNativeDriver: true }).start();
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastY.current;
    lastY.current = y;
    if (y <= barHeight) showBar(true);
    else if (dy > 6) showBar(false);
    else if (dy < -6) showBar(true);
  };

  // FlatList needs these two to stay the same object for its whole life.
  const [onViewable] = useState(() => ({ viewableItems }: { viewableItems: { item: unknown; isViewable: boolean }[] }) => {
    const first = viewableItems.find((v) => v.isViewable)?.item as VaultItem | undefined;
    if (first) setMonth(monthOf(first.createdAt));
  });
  const [viewability] = useState(() => ({ itemVisiblePercentThreshold: 50 }));

  const title = kind === 'PHOTO' ? t('home.photosTab', { n: items.length }) : t('home.videosTab', { n: items.length });

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <FlatList
        key={cols}
        data={sorted}
        numColumns={cols}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => <Thumb item={item} onPress={() => onOpen(item)} style={{ width: size, height: size }} label={monthOf(item.createdAt)} />}
        columnWrapperStyle={{ gap: GAP }}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={{ paddingTop: barHeight, paddingBottom: 130 }}
        onScroll={onScroll}
        scrollEventThrottle={32}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={viewability}
        initialNumToRender={cols * 8}
        windowSize={7}
        removeClippedSubviews
        ListEmptyComponent={
          <View style={[s.card, { margin: 18 }]}>
            <Body>{kind === 'PHOTO' ? t('home.noPhotos') : t('home.noVideos')}</Body>
            <Text style={s.small}>{t('home.emptyHint')}</Text>
          </View>
        }
      />

      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: barHeight,
          paddingTop: top,
          paddingHorizontal: 8,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          backgroundColor: 'rgba(11,13,18,0.86)',
          transform: [{ translateY: shift }],
        }}
      >
        <BarButton icon="chevron-back" label={t('common.back')} onPress={onBack} plain />
        <View style={{ flex: 1, paddingLeft: 2 }}>
          <Text style={{ fontFamily: F.bold, fontSize: 17, color: C.ivory }} numberOfLines={1}>
            {title}
          </Text>
          {!!month && (
            <Text style={{ fontFamily: F.body, fontSize: 12, color: C.muted }} numberOfLines={1}>
              {month}
            </Text>
          )}
        </View>
        <BarButton
          icon={isDense ? 'grid-outline' : 'apps-outline'}
          label={isDense ? t('gallery.larger') : t('gallery.denser')}
          onPress={() => {
            rememberDense(!isDense);
            setDense(!isDense);
          }}
        />
        <BarButton icon="search" label={t('gallery.search')} onPress={onSearch} />
      </Animated.View>

      {actionBar}
    </View>
  );
}

function Separator() {
  return <View style={{ height: GAP }} />;
}

function BarButton({ icon, label, onPress, plain }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; plain?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: plain ? 'transparent' : 'rgba(29,33,43,0.85)' },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Ionicons name={icon} size={plain ? 24 : 19} color={C.ivory} />
    </Pressable>
  );
}
