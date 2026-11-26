import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Image, Pressable, View, ViewStyle } from 'react-native';

import VaultCore, { VaultItem } from '../modules/vault-core';
import { C } from './theme';

// Decrypted thumbnails, kept only while the vault is open (clearThumbs() on lock) so the
// gallery does not decrypt them again when it scrolls back or changes its column count.
const cache = new Map<string, string>();
const MAX = 400;
// Bumped on lock: a thumbnail that arrives after the lock is dropped, never cached.
let generation = 0;

export function clearThumbs() {
  generation++;
  cache.clear();
}

function remember(id: string, uri: string) {
  cache.set(id, uri);
  if (cache.size > MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export function useThumb(id: string): string | null {
  // Starts with the cached copy so a tile keeps its picture even if the cache drops it later.
  const [loaded, setLoaded] = useState<{ id: string; uri: string } | null>(() => {
    const k = cache.get(id);
    return k ? { id, uri: k } : null;
  });
  const known = cache.get(id);
  useEffect(() => {
    if (cache.has(id)) return;
    let live = true;
    const gen = generation;
    VaultCore.thumbnailUri(id)
      .then((u) => {
        if (!u || gen !== generation) return;
        remember(id, u);
        if (live) setLoaded({ id, uri: u });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id]);
  return known ?? (loaded?.id === id ? loaded.uri : null);
}

/**
 * A square tile. [rounded] for cards on Home; the full-screen gallery uses square corners.
 * [selected] is set only in the gallery's select mode: true shows a brass check and an inset
 * picture, false an empty circle.
 */
export function Thumb({
  item,
  onPress,
  onLongPress,
  onPressOut,
  rounded = false,
  style,
  label,
  selected,
}: {
  item: VaultItem;
  onPress?: () => void;
  onLongPress?: () => void;
  onPressOut?: () => void;
  rounded?: boolean;
  style?: ViewStyle;
  label?: string;
  selected?: boolean;
}) {
  const uri = useThumb(item.id);
  const selecting = selected !== undefined;
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      accessibilityState={selecting ? { selected } : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressOut={onPressOut}
      delayLongPress={350}
      disabled={!onPress}
      style={({ pressed }) => [
        { aspectRatio: 1, backgroundColor: selected ? '#1A1E27' : C.surface, borderRadius: rounded ? 6 : 0, overflow: 'hidden' },
        style,
        pressed && !selecting && { opacity: 0.8 },
      ]}
    >
      {uri && <Image source={{ uri }} style={selected ? { position: 'absolute', top: 8, left: 8, right: 8, bottom: 8, borderRadius: 8 } : { width: '100%', height: '100%' }} />}
      {selecting && (
        <View
          style={{
            position: 'absolute',
            top: selected ? 3 : 6,
            left: selected ? 3 : 6,
            width: 24,
            height: 24,
            borderRadius: 12,
            borderWidth: 2,
            borderColor: selected ? C.brass : 'rgba(255,255,255,0.9)',
            backgroundColor: selected ? C.brass : 'rgba(0,0,0,0.25)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {selected && <Ionicons name="checkmark" size={15} color={C.bg} />}
        </View>
      )}
      {item.kind === 'VIDEO' && (
        <View style={{ position: 'absolute', bottom: 4, right: 4, backgroundColor: 'rgba(11,13,18,0.7)', borderRadius: 10, padding: 3 }}>
          <Ionicons name="play" size={12} color={C.ivory} />
        </View>
      )}
    </Pressable>
  );
}
