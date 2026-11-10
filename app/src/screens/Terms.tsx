import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { TERMS, TERMS_TITLE, TERMS_VERSION } from '../legal';
import { C, F } from '../theme';
import { READABLE_WIDTH, s } from '../ui';

/** Full Terms of Use in a sheet. Opened from the vault setup screen and from Settings. */
export function TermsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 }}>
          <Text style={{ flex: 1, fontFamily: F.title, fontSize: 24, color: C.ivory }}>{TERMS_TITLE}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ padding: 8 }}>
            <Ionicons name="close" size={24} color={C.brass} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48, gap: 16, width: '100%', maxWidth: READABLE_WIDTH, alignSelf: 'center' }}>
          <Text style={s.small}>Version {TERMS_VERSION}</Text>
          {TERMS.map((t) => (
            <View key={t.heading} style={{ gap: 6 }}>
              <Text style={[s.body, { fontFamily: F.bold }]}>{t.heading}</Text>
              <Text style={s.small}>{t.body}</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}
