import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import VaultCore, { VaultItem } from '../../modules/vault-core';
import { spacing, t, tn } from '../i18n';
import { C, F } from '../theme';
import { useThumb } from '../thumb';
import { Button, s } from '../ui';

const PREVIEW = 5;

export const sizeLabel = (bytes: number) => {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

/**
 * Destroys every item in [items], one at a time through VaultCore.delete, and returns the ids
 * that could not be destroyed. Nothing else in the app can remove more than one item.
 */
export async function destroyAll(items: VaultItem[], onProgress?: (done: number) => void): Promise<string[]> {
  const failed: string[] = [];
  let done = 0;
  for (const item of items) {
    try {
      await VaultCore.delete(item.id);
    } catch {
      failed.push(item.id);
    }
    done++;
    onProgress?.(done);
  }
  return failed;
}

/**
 * Bottom sheet that confirms destroying several items. It states the exact count, how many are
 * photos and videos, their total size, and shows the first few. Nothing happens until the
 * Destroy button is pressed; the scrim and Keep cancel.
 */
export function BulkDestroySheet({
  items,
  visible,
  onCancel,
  onDone,
}: {
  items: VaultItem[];
  visible: boolean;
  onCancel: () => void;
  /** [failed] holds the ids still in the vault, empty when everything was destroyed. */
  onDone: (failed: string[]) => void;
}) {
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState(0);
  const inFlight = useRef(false);
  const n = items.length;
  const photos = items.filter((i) => i.kind === 'PHOTO').length;
  const videos = n - photos;
  const size = sizeLabel(items.reduce((sum, i) => sum + (i.size || 0), 0));
  const summary = [photos > 0 ? tn('result.photos', photos) : '', videos > 0 ? tn('result.videos', videos) : ''].filter(Boolean).join(' · ');

  const destroy = async () => {
    if (inFlight.current || n === 0) return;
    inFlight.current = true;
    setDone(0);
    setWorking(true);
    try {
      const failed = await destroyAll(items, setDone);
      if (failed.length > 0) Alert.alert(t('bulk.failedTitle'), tn('bulk.failedBody', failed.length));
      onDone(failed);
    } finally {
      inFlight.current = false;
      setWorking(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (!working) onCancel();
      }}
      statusBarTranslucent
    >
      <Pressable style={bs.scrim} onPress={() => !working && onCancel()} accessibilityLabel={t('viewer.keep')} />
      <View style={bs.sheet}>
        <View style={bs.grabber} />
        <Text style={[s.label, { color: C.danger, letterSpacing: spacing(3), marginTop: 6 }]}>{t('viewer.permanent')}</Text>
        <Text style={bs.title}>{tn('bulk.title', n)}</Text>
        <Text style={[s.body, { fontSize: 14, color: C.muted, lineHeight: 23 }]}>{t('bulk.body')}</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {items.slice(0, PREVIEW).map((it) => (
            <Preview key={it.id} item={it} />
          ))}
          {n > PREVIEW && (
            <View style={[bs.preview, { backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ fontFamily: F.bold, fontSize: 14, color: C.muted }}>+{n - PREVIEW}</Text>
            </View>
          )}
        </View>
        <View style={bs.meta}>
          <Text style={[s.small, { color: '#D9D4CA', flexShrink: 1 }]}>{summary}</Text>
          {!!size && <Text style={[s.small, { color: C.faint, marginLeft: 'auto' }]}>{size}</Text>}
        </View>
        {working ? (
          <View style={{ height: 56 + 14 + 48, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <ActivityIndicator color={C.danger} />
            <Text style={s.small}>{t('bulk.working', { done, n })}</Text>
          </View>
        ) : (
          <>
            <Button label={tn('bulk.confirm', n)} kind="danger" onPress={destroy} disabled={n === 0} style={{ marginTop: 4 }} />
            <Button label={t('viewer.keep')} kind="ghost" onPress={onCancel} style={{ height: 48 }} />
          </>
        )}
      </View>
    </Modal>
  );
}

function Preview({ item }: { item: VaultItem }) {
  const uri = useThumb(item.id);
  return <View style={bs.preview}>{uri && <Image source={{ uri }} style={{ width: '100%', height: '100%' }} />}</View>;
}

const bs = StyleSheet.create({
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
    // iPad: keep the sheet a readable width in the middle.
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#3A3F4A' },
  title: { fontFamily: F.title, fontSize: 28, lineHeight: 34, color: C.ivory },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14, backgroundColor: '#0E1117', borderWidth: 1, borderColor: C.line },
  preview: { width: 52, height: 52, borderRadius: 9, overflow: 'hidden', backgroundColor: C.surface },
});
