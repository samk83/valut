import Ionicons from '@expo/vector-icons/Ionicons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ComponentProps, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import VaultCore, { VaultItem } from '../../modules/vault-core';
import { C, F } from '../theme';
import { Busy, Button, s } from '../ui';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const dayLabel = (ms: number) => {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${sameYear ? '' : `, ${d.getFullYear()}`}`;
};

const fullDate = (ms: number) => {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} · ${hh}:${mm}`;
};

const sizeLabel = (bytes: number) => {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const typeLabel = (item: VaultItem) => {
  const sub = item.mimeType?.split('/')[1]?.toUpperCase();
  const kind = item.kind === 'VIDEO' ? 'Video' : 'Photo';
  return sub ? `${kind} · ${sub}` : kind;
};

const clock = (sec: number) => {
  const t = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

type IconName = ComponentProps<typeof Ionicons>['name'];

function RoundButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [vs.round, pressed && { opacity: 0.7 }]}>
      <Ionicons name={icon} size={20} color={C.ivory} />
    </Pressable>
  );
}

function ToolButton({ icon, label, color = '#D9D4CA', onPress, active }: { icon: IconName; label: string; color?: string; onPress: () => void; active?: boolean }) {
  const c = active ? C.brass : color;
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [vs.tool, pressed && { opacity: 0.6 }]}>
      <Ionicons name={icon} size={22} color={c} />
      <Text style={[vs.toolText, { color: c }]}>{label}</Text>
    </Pressable>
  );
}

const BLOCKED = 'This item failed its integrity check and is blocked.';

/** Bottom sheet in place of a system alert. Deletion goes only through VaultCore.delete. */
function DestroySheet({ item, visible, onCancel, onDone }: { item: VaultItem; visible: boolean; onCancel: () => void; onDone: () => void }) {
  const [working, setWorking] = useState(false);
  const destroy = async () => {
    setWorking(true);
    try {
      await VaultCore.delete(item.id);
      onDone();
    } catch {
      setWorking(false);
      Alert.alert('Not destroyed', 'The item could not be destroyed. Try again.');
    }
  };
  const size = sizeLabel(item.size);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => {
        if (!working) onCancel();
      }} statusBarTranslucent>
      <Pressable style={vs.scrim} onPress={() => !working && onCancel()} accessibilityLabel="Keep it" />
      <View style={vs.sheet}>
        <View style={vs.grabber} />
        <Text style={[s.label, { color: C.danger, letterSpacing: 3, marginTop: 6 }]}>Permanent</Text>
        <Text style={vs.sheetTitle}>Destroy 1 item?</Text>
        <Text style={[s.body, { fontSize: 14, color: C.muted, lineHeight: 23 }]}>
          Its encryption key will be erased. Not even you will be able to open it again, and there is no trash to restore from.
        </Text>
        <View style={vs.meta}>
          <Text style={[s.small, { color: '#D9D4CA' }]}>{typeLabel(item)}</Text>
          {!!size && <Text style={[s.small, { color: C.faint, marginLeft: 'auto' }]}>{size}</Text>}
        </View>
        {working ? (
          <View style={{ height: 56 + 12 + 48, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={C.danger} />
          </View>
        ) : (
          <>
            <Button label="Destroy" kind="danger" onPress={destroy} style={{ marginTop: 6 }} />
            <Button label="Keep it" kind="ghost" onPress={onCancel} style={{ height: 48 }} />
          </>
        )}
      </View>
    </Modal>
  );
}

/** Decrypted in memory only; there is no share or save button (SPEC AC-40). */
export function PhotoViewer({ item: first, onClose, onDeleted }: { item: VaultItem; onClose: () => void; onDeleted: () => void }) {
  const [item, setItem] = useState(first);
  const [photos, setPhotos] = useState<VaultItem[]>([]);
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [info, setInfo] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const touch = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    VaultCore.list()
      .then((all) => setPhotos(all.filter((i) => i.kind === 'PHOTO')))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let live = true;
    setUri(null);
    setError(false);
    setRotation(0);
    VaultCore.photoUri(item)
      .then((u) => live && setUri(u))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [item]);

  const index = photos.findIndex((p) => p.id === item.id);
  const go = (step: number) => {
    if (index < 0) return;
    const next = photos[index + step];
    if (next) setItem(next);
  };

  const sideways = rotation % 180 !== 0;
  const imgStyle = box.w ? { width: sideways ? box.h : box.w, height: sideways ? box.w : box.h, transform: [{ rotate: `${rotation}deg` }] } : { flex: 1 };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={vs.top}>
        <RoundButton icon="chevron-back" label="Back" onPress={onClose} />
        <View style={{ alignItems: 'center', gap: 2, flex: 1 }}>
          <Text style={vs.date}>{dayLabel(item.createdAt)}</Text>
          {index >= 0 && <Text style={vs.count}>{`${index + 1} of ${photos.length}`}</Text>}
        </View>
        <View style={{ width: 44 }} />
      </View>

      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
        onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        onTouchStart={(e) => (touch.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
        onTouchEnd={(e) => {
          const t = touch.current;
          touch.current = null;
          if (!t) return;
          const dx = e.nativeEvent.pageX - t.x;
          const dy = e.nativeEvent.pageY - t.y;
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
        }}
      >
        {uri && <Image source={{ uri }} style={imgStyle} resizeMode="contain" />}
        {error && <Text style={[s.body, { margin: 24, color: C.danger, textAlign: 'center' }]}>{BLOCKED}</Text>}
        {!uri && !error && <ActivityIndicator color={C.brass} size="large" />}
        {index > 0 && (
          <Pressable accessibilityLabel="Previous photo" onPress={() => go(-1)} style={[vs.arrow, { left: 8 }]}>
            <Ionicons name="chevron-back" size={22} color={C.ivory} />
          </Pressable>
        )}
        {index >= 0 && index < photos.length - 1 && (
          <Pressable accessibilityLabel="Next photo" onPress={() => go(1)} style={[vs.arrow, { right: 8 }]}>
            <Ionicons name="chevron-forward" size={22} color={C.ivory} />
          </Pressable>
        )}
      </View>

      {info && (
        <View style={vs.info}>
          {[
            ['Date', fullDate(item.createdAt)],
            ['Size', sizeLabel(item.size) || '—'],
            ['Type', typeLabel(item)],
          ].map(([k, v]) => (
            <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
              <Text style={[s.small, { color: C.faint }]}>{k}</Text>
              <Text style={[s.small, { color: C.ivory }]}>{v}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={vs.toolbar}>
        <ToolButton icon="sync-outline" label="Rotate" onPress={() => setRotation((r) => (r + 90) % 360)} />
        <ToolButton icon="information-circle-outline" label="Info" active={info} onPress={() => setInfo((v) => !v)} />
        <ToolButton icon="trash-outline" label="Destroy" color={C.danger} onPress={() => setConfirm(true)} />
      </View>
      <DestroySheet item={item} visible={confirm} onCancel={() => setConfirm(false)} onDone={onDeleted} />
    </View>
  );
}

/** Streams from the vault through a local decrypting source; nothing is written in the clear. */
export function VideoPlayer({ item, onClose, onDeleted }: { item: VaultItem; onClose: () => void; onDeleted: () => void }) {
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [time, setTime] = useState({ now: 0, total: 0, playing: false, muted: false });
  const [barWidth, setBarWidth] = useState(0);
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  useEffect(() => {
    VaultCore.openVideo(item.id).then(setUri).catch(() => setError(true));
    return () => VaultCore.closeVideo();
  }, [item]);
  useEffect(() => {
    if (uri) player.play();
  }, [uri, player]);
  useEffect(() => {
    const t = setInterval(() => {
      try {
        setTime({ now: player.currentTime, total: player.duration, playing: player.playing, muted: player.muted });
      } catch {}
    }, 250);
    return () => clearInterval(t);
  }, [player]);

  const progress = time.total > 0 ? Math.min(1, time.now / time.total) : 0;
  const toggle = () => {
    if (player.playing) player.pause();
    else {
      if (time.total > 0 && time.now >= time.total - 0.25) player.currentTime = 0;
      player.play();
    }
  };
  const askDestroy = () => {
    try {
      player.pause();
    } catch {}
    setConfirm(true);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={vs.top}>
        <RoundButton icon="chevron-back" label="Back" onPress={onClose} />
        <View style={vs.streamPill}>
          <Text style={[s.small, { fontSize: 11, lineHeight: 15, color: C.muted }]}>Streaming from vault · nothing cached</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <Pressable style={{ flex: 1, justifyContent: 'center' }} onPress={uri ? toggle : undefined} accessibilityLabel={time.playing ? 'Pause' : 'Play'}>
        {uri && <VideoView player={player} style={{ flex: 1 }} nativeControls={false} contentFit="contain" />}
        {error && <Text style={[s.body, { margin: 24, color: C.danger, textAlign: 'center' }]}>{BLOCKED}</Text>}
      </Pressable>

      <View style={{ paddingHorizontal: 22, gap: 10, paddingTop: 12 }}>
        <Pressable
          accessibilityLabel="Seek"
          onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
          onPress={(e) => {
            if (barWidth > 0 && time.total > 0) player.currentTime = Math.max(0, Math.min(1, e.nativeEvent.locationX / barWidth)) * time.total;
          }}
          style={{ height: 24, justifyContent: 'center' }}
        >
          <View style={vs.track}>
            <View style={[vs.fill, { width: `${progress * 100}%` }]} />
          </View>
          <View style={[vs.knob, { left: progress * barWidth - 8 }]} />
        </Pressable>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={vs.time}>{clock(time.now)}</Text>
          <Text style={vs.time}>{clock(time.total)}</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 40, paddingTop: 18, paddingBottom: 10 }}>
        <Pressable accessibilityLabel="Back 10 seconds" onPress={() => player.seekBy(-10)} style={vs.skip}>
          <Text style={vs.skipText}>−10</Text>
        </Pressable>
        <Pressable accessibilityLabel={time.playing ? 'Pause' : 'Play'} onPress={toggle} style={({ pressed }) => [vs.play, pressed && { opacity: 0.8 }]}>
          <Ionicons name={time.playing ? 'pause' : 'play'} size={26} color={C.bg} style={time.playing ? undefined : { marginLeft: 3 }} />
        </Pressable>
        <Pressable accessibilityLabel="Forward 10 seconds" onPress={() => player.seekBy(10)} style={vs.skip}>
          <Text style={vs.skipText}>+10</Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, paddingTop: 6, paddingBottom: 36 }}>
        <Pressable
          accessibilityLabel={time.muted ? 'Unmute' : 'Mute'}
          onPress={() => (player.muted = !player.muted)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 6 }}
        >
          <Ionicons name={time.muted ? 'volume-mute-outline' : 'volume-medium-outline'} size={20} color={C.muted} />
          <Text style={[s.small, { fontSize: 12 }]}>{time.muted ? 'Muted' : 'Sound on'}</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable accessibilityLabel="Destroy video" onPress={askDestroy} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 6 }}>
          <Ionicons name="trash-outline" size={20} color={C.danger} />
          <Text style={[s.small, { fontSize: 12, color: C.danger }]}>Destroy</Text>
        </Pressable>
      </View>
      {!uri && !error && <Busy label="Decrypting…" />}
      <DestroySheet item={item} visible={confirm} onCancel={() => setConfirm(false)} onDone={onDeleted} />
    </View>
  );
}

const vs = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 52, paddingHorizontal: 14, paddingBottom: 10 },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(28,33,44,0.7)', alignItems: 'center', justifyContent: 'center' },
  date: { fontFamily: F.title, fontSize: 16, color: C.ivory },
  count: { fontFamily: F.body, fontSize: 11, color: C.faint },
  arrow: { position: 'absolute', top: '50%', marginTop: -22, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(28,33,44,0.55)', alignItems: 'center', justifyContent: 'center' },
  info: { marginHorizontal: 16, marginTop: 10, padding: 14, borderRadius: 14, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  toolbar: { flexDirection: 'row', justifyContent: 'space-around', paddingTop: 10, paddingHorizontal: 12, paddingBottom: 34 },
  tool: { minWidth: 72, minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 6 },
  toolText: { fontFamily: F.medium, fontSize: 11 },
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
  sheetTitle: { fontFamily: F.title, fontSize: 30, lineHeight: 36, color: C.ivory },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14, backgroundColor: '#0E1117', borderWidth: 1, borderColor: C.line },
  streamPill: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: '#2A2F3A', flexShrink: 1, marginHorizontal: 8 },
  track: { height: 4, borderRadius: 2, backgroundColor: '#2A2F3A', overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2, backgroundColor: C.brass },
  knob: { position: 'absolute', top: 4, width: 16, height: 16, borderRadius: 8, backgroundColor: C.brass },
  time: { fontFamily: F.body, fontSize: 12, color: C.muted, fontVariant: ['tabular-nums'] },
  skip: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  skipText: { fontFamily: F.medium, fontSize: 14, color: C.ivory },
  play: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.brass, alignItems: 'center', justifyContent: 'center' },
});
