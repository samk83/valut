import Ionicons from '@expo/vector-icons/Ionicons';
import { ComponentRef, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ItemKind, VaultItem } from '../../modules/vault-core';
import { monthStandalone, t, tn } from '../i18n';
import { clampOffset, dragSelection, inOrder, tileAt, toggle } from '../selection';
import { C, F } from '../theme';
import { Thumb } from '../thumb';
import { Body, s } from '../ui';
import { BulkDestroySheet } from './BulkDestroy';

const GAP = 2;
// While dragging a selection near the top or bottom edge, the grid scrolls this far per tick.
const EDGE = 70;
const EDGE_STEP = 18;
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
 *
 * Select mode: a long press on a tile selects it; keeping the finger down and dragging adds
 * every tile between there and the finger. Taps then add or remove single tiles. The bottom
 * bar turns into "Destroy (n)", which only opens a confirmation sheet; nothing is destroyed
 * until its Destroy button is pressed.
 */
export function Gallery({
  kind,
  items,
  onBack,
  onOpen,
  onSearch,
  onDeleted,
  actionBar,
  selectionActions,
}: {
  kind: ItemKind;
  items: VaultItem[];
  onBack: () => void;
  onOpen: (item: VaultItem) => void;
  onSearch: () => void;
  /** Called after items were destroyed from select mode, so the list can be loaded again. */
  onDeleted: () => void;
  actionBar: ReactNode;
  /** Extra buttons for the select-mode bar, shown before Destroy. [ids] are in gallery order. */
  selectionActions?: (ids: string[], exit: () => void) => ReactNode;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [isDense, setDense] = useState(remembered.dense);
  // About 130 pt per tile normally (3 on a phone), about 78 pt when dense (5 on a phone).
  const cols = isDense ? Math.max(5, Math.floor(width / 78)) : Math.max(3, Math.floor(width / 130));
  const size = (width - GAP * (cols - 1)) / cols;
  const sorted = useMemo(() => [...items].sort((a, b) => b.createdAt - a.createdAt), [items]);
  const [month, setMonth] = useState(sorted[0] ? monthOf(sorted[0].createdAt) : '');
  const ids = useMemo(() => sorted.map((i) => i.id), [sorted]);

  // null = not selecting. An empty set keeps select mode open with nothing chosen.
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const selecting = selected !== null;
  const chosen = useMemo(() => (selected ? inOrder(ids, selected) : []), [ids, selected]);
  const [confirm, setConfirm] = useState(false);
  const exitSelect = () => {
    setConfirm(false);
    setSelected(null);
  };
  // Android back leaves select mode first.
  useEffect(() => {
    if (!selecting) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      exitSelect();
      return true;
    });
    return () => sub.remove();
  }, [selecting]);

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
    if (y <= barHeight || selected !== null) showBar(true);
    else if (dy > 6) showBar(false);
    else if (dy < -6) showBar(true);
  };

  // Drag to select. A long press arms it; while armed, the first move takes the touch from the
  // tile, the list stops scrolling, and every tile from the anchor to the finger is selected.
  const listRef = useRef<FlatList<VaultItem>>(null);
  const rootRef = useRef<ComponentRef<typeof View>>(null);
  const origin = useRef({ x: 0, y: 0 });
  const geo = useRef({ cols, size, padTop: barHeight, ids });
  const viewHeight = useRef(0);
  const contentHeight = useRef(0);
  const measure = () =>
    rootRef.current?.measureInWindow((x, y) => {
      origin.current = { x, y };
    });
  // A new column count remounts the list at the top, so the remembered offset must follow.
  useEffect(() => {
    lastY.current = 0;
  }, [cols]);
  const drag = useRef<{ armed: boolean; moving: boolean; anchor: number; base: Set<string>; last: { x: number; y: number } | null }>({
    armed: false,
    moving: false,
    anchor: 0,
    base: new Set(),
    last: null,
  });
  const edgeTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [dragging, setDragging] = useState(false);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (releaseTimer.current) clearTimeout(releaseTimer.current);
    },
    [],
  );

  const selectUnder = (pageX: number, pageY: number) => {
    const g = geo.current;
    const x = pageX - origin.current.x;
    const y = pageY - origin.current.y - g.padTop + lastY.current;
    const at = tileAt(x, y, g.cols, g.size, GAP, g.ids.length);
    if (at === null) return;
    setSelected(dragSelection(g.ids, drag.current.base, drag.current.anchor, at));
  };
  const stopEdge = () => {
    if (edgeTimer.current) clearInterval(edgeTimer.current);
    edgeTimer.current = null;
  };
  const endDrag = () => {
    stopEdge();
    drag.current = { ...drag.current, armed: false, moving: false, last: null };
    setDragging(false);
  };
  useEffect(() => stopEdge, []);
  const edgeScroll = () => {
    const d = drag.current;
    if (!d.moving || !d.last) return stopEdge();
    const top = origin.current.y + geo.current.padTop;
    const bottom = origin.current.y + viewHeight.current;
    const dir = d.last.y > bottom - EDGE ? 1 : d.last.y < top + EDGE ? -1 : 0;
    if (dir === 0) return stopEdge();
    // Never past either end: the offset is what maps the finger to a tile.
    const next = clampOffset(lastY.current, dir * EDGE_STEP, contentHeight.current, viewHeight.current);
    if (next === lastY.current) return;
    lastY.current = next;
    listRef.current?.scrollToOffset({ offset: next, animated: false });
    selectUnder(d.last.x, d.last.y);
  };
  const ctl = useRef<DragControl | null>(null);
  useEffect(() => {
    geo.current = { cols, size, padTop: barHeight, ids };
    ctl.current = {
      armed: () => drag.current.armed,
      grant: () => {
        drag.current.moving = true;
      },
      move: (x, y) => {
        drag.current.last = { x, y };
        selectUnder(x, y);
        if (!edgeTimer.current) edgeTimer.current = setInterval(edgeScroll, 30);
      },
      end: endDrag,
    };
  });
  // The responder only reads ctl.current from its touch callbacks, never while rendering.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() => dragPan(ctl));

  const startSelect = (index: number) => {
    const id = ids[index];
    if (id === undefined) return;
    const base = new Set(selected ?? []);
    measure();
    drag.current = { armed: true, moving: false, anchor: index, base, last: null };
    setDragging(true);
    showBar(true);
    setSelected(dragSelection(ids, base, index, index));
  };
  // A long press that ends without moving: disarm. When the drag took over the touch, the tile
  // also gets a press-out; the drag ends itself on release, so leave it running.
  const tileReleased = () => {
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    releaseTimer.current = setTimeout(() => {
      if (drag.current.armed && !drag.current.moving) endDrag();
    }, 0);
  };

  // FlatList needs these two to stay the same object for its whole life.
  const [onViewable] = useState(() => ({ viewableItems }: { viewableItems: { item: unknown; isViewable: boolean }[] }) => {
    const first = viewableItems.find((v) => v.isViewable)?.item as VaultItem | undefined;
    if (first) setMonth(monthOf(first.createdAt));
  });
  const [viewability] = useState(() => ({ itemVisiblePercentThreshold: 50 }));

  const title = kind === 'PHOTO' ? t('home.photosTab', { n: items.length }) : t('home.videosTab', { n: items.length });

  return (
    <View
      ref={rootRef}
      style={{ flex: 1, backgroundColor: C.bg }}
      onLayout={(e) => {
        viewHeight.current = e.nativeEvent.layout.height;
        measure();
      }}
      {...pan.panHandlers}
    >
      <FlatList
        ref={listRef}
        key={cols}
        data={sorted}
        extraData={selected}
        numColumns={cols}
        keyExtractor={(i) => i.id}
        scrollEnabled={!dragging}
        onContentSizeChange={(_, h) => {
          contentHeight.current = h;
        }}
        renderItem={({ item, index }) => (
          <Thumb
            item={item}
            onPress={() => (selected ? setSelected((cur) => (cur ? toggle(cur, item.id) : cur)) : onOpen(item))}
            onLongPress={() => startSelect(index)}
            onSelectAction={() => (selected ? setSelected((cur) => (cur ? toggle(cur, item.id) : cur)) : setSelected(new Set([item.id])))}
            onPressOut={tileReleased}
            selected={selected ? selected.has(item.id) : undefined}
            style={{ width: size, height: size }}
            label={monthOf(item.createdAt)}
          />
        )}
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
          backgroundColor: 'rgba(11,13,18,0.95)',
          borderBottomWidth: 1,
          borderBottomColor: C.line,
          transform: [{ translateY: shift }],
        }}
      >
        {selecting ? (
          <>
            <BarButton icon="close" label={t('select.cancel')} onPress={exitSelect} plain />
            <View style={{ flex: 1, paddingLeft: 2 }}>
              <Text style={{ fontFamily: F.bold, fontSize: 17, color: C.ivory }} numberOfLines={1} accessibilityLiveRegion="polite">
                {tn('select.count', chosen.length)}
              </Text>
              {!!month && (
                <Text style={{ fontFamily: F.body, fontSize: 12, color: C.muted }} numberOfLines={1}>
                  {month}
                </Text>
              )}
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setSelected((cur) => (cur && inOrder(ids, cur).length === ids.length ? new Set() : new Set(ids)))}
              hitSlop={6}
              style={({ pressed }) => [
                { height: 36, paddingHorizontal: 12, borderRadius: 18, justifyContent: 'center', backgroundColor: 'rgba(201,166,107,0.12)' },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={{ fontFamily: F.medium, fontSize: 15, color: C.brass }} numberOfLines={1}>
                {chosen.length === ids.length && ids.length > 0 ? t('select.none') : t('select.all')}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
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
          </>
        )}
      </Animated.View>

      {selecting ? (
        <SelectBar>
          {selectionActions?.(chosen, exitSelect)}
          <Pressable
            accessibilityRole="button"
            disabled={chosen.length === 0}
            onPress={() => setConfirm(true)}
            style={({ pressed }) => [
              {
                flex: 1,
                height: 52,
                borderRadius: 16,
                backgroundColor: C.danger,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              },
              chosen.length === 0 && { opacity: 0.35 },
              pressed && { opacity: 0.8 },
            ]}
          >
            <Ionicons name="trash-outline" size={20} color="#1A0F08" />
            <Text style={{ fontFamily: F.bold, fontSize: 16, color: '#1A0F08' }} numberOfLines={1}>
              {t('select.destroy', { n: chosen.length })}
            </Text>
          </Pressable>
        </SelectBar>
      ) : (
        actionBar
      )}
      <BulkDestroySheet
        items={confirm ? sorted.filter((i) => selected?.has(i.id)) : []}
        visible={confirm}
        onCancel={() => setConfirm(false)}
        onDone={(failed) => {
          setConfirm(false);
          // Whatever could not be destroyed stays selected so it can be tried again.
          if (failed.length > 0) setSelected(new Set(failed));
          else setSelected(null);
          onDeleted();
        }}
      />
    </View>
  );
}

/** Same place and shape as the Home action bar, so the gallery does not jump. */
function SelectBar({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  return (
    <View
      style={{
        position: 'absolute',
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
        gap: 8,
        paddingHorizontal: 10,
        shadowColor: '#000',
        shadowOpacity: 0.55,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 12 },
        elevation: 12,
      }}
    >
      {children}
    </View>
  );
}

type DragControl = { armed: () => boolean; grant: () => void; move: (pageX: number, pageY: number) => void; end: () => void };

/** Takes the touch from a tile once a long press has armed a drag, and hands every move on. */
function dragPan(ctl: { current: DragControl | null }) {
  return PanResponder.create({
    onMoveShouldSetPanResponderCapture: () => ctl.current?.armed() ?? false,
    onPanResponderGrant: () => ctl.current?.grant(),
    onPanResponderMove: (e) => ctl.current?.move(e.nativeEvent.pageX, e.nativeEvent.pageY),
    onPanResponderRelease: () => ctl.current?.end(),
    onPanResponderTerminate: () => ctl.current?.end(),
    onPanResponderTerminationRequest: () => false,
  });
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
