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

/** A square tile. [rounded] for cards on Home; the full-screen gallery uses square corners. */
export function Thumb({
  item,
  onPress,
  rounded = false,
  style,
  label,
}: {
  item: VaultItem;
  onPress?: () => void;
  rounded?: boolean;
  style?: ViewStyle;
  label?: string;
}) {
  const uri = useThumb(item.id);
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [{ aspectRatio: 1, backgroundColor: C.surface, borderRadius: rounded ? 6 : 0, overflow: 'hidden' }, style, pressed && { opacity: 0.8 }]}
    >
      {uri && <Image source={{ uri }} style={{ width: '100%', height: '100%' }} />}
      {item.kind === 'VIDEO' && (
        <View style={{ position: 'absolute', bottom: 4, right: 4, backgroundColor: 'rgba(11,13,18,0.7)', borderRadius: 10, padding: 3 }}>
          <Ionicons name="play" size={12} color={C.ivory} />
        </View>
      )}
    </Pressable>
  );
}
