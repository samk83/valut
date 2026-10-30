import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';

import VaultCore, { VaultStatus } from '../../modules/vault-core';
import { C, F } from '../theme';
import { Body, Busy, Button, s, TestBanner, Title } from '../ui';

export function Settings({ onBack, onDestroyed }: { onBack: () => void; onDestroyed: () => void }) {
  const [st, setSt] = useState<VaultStatus | null>(null);
  const [confirm, setConfirm] = useState('');
  const [resetting, setResetting] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    VaultCore.status().then(setSt);
  }, []);

  const row = (k: string, v: string) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderColor: C.line }}>
      <Text style={s.small}>{k}</Text>
      <Text style={[s.small, { color: C.ivory }]}>{v}</Text>
    </View>
  );

  const destroy = async () => {
    setBusy(true);
    try {
      await VaultCore.destroy();
      onDestroyed();
    } catch {
      setBusy(false);
      Alert.alert('Reset failed', 'The vault could not be destroyed. Try again.');
    }
  };

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={s.screen}>
      <Button label="‹ Back" kind="ghost" onPress={onBack} style={{ alignSelf: 'flex-start', height: 40, marginBottom: 16 }} />
      <Title>Security</Title>
      <TestBanner />
      <View style={s.card}>
        <Text style={s.label}>Status</Text>
        {row('Device key', st ? st.hardware : '…')}
        {row('StrongBox chip on this phone', st ? (st.strongBoxAvailable ? 'Yes' : 'No (TEE used)') : '…')}
        {row('Attempts left', st ? String(st.remainingAttempts) : '…')}
        {row('Auto-lock', 'Immediately when app leaves screen')}
        {row('Screenshots', 'Blocked')}
        {row('Internet permission', 'None')}
        {row('Backups', 'Excluded')}
      </View>
      <View style={[s.card, { marginTop: 16, borderColor: C.danger }]}>
        <Text style={[s.label, { color: C.danger }]}>Reset vault</Text>
        <Body style={{ color: C.muted, marginVertical: 8 }}>Destroys the keys and every item. This cannot be undone.</Body>
        {!resetting ? (
          <Button label="Reset vault…" kind="danger" onPress={() => setResetting(true)} />
        ) : (
          <>
            <Text style={s.small}>Type DESTROY to confirm.</Text>
            <TextInput
              value={confirm}
              onChangeText={setConfirm}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="DESTROY"
              placeholderTextColor={C.line}
              style={{ fontFamily: F.bold, color: C.ivory, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12, marginVertical: 10 }}
            />
            <Button label="Destroy vault" kind="danger" disabled={confirm !== 'DESTROY'} onPress={destroy} />
          </>
        )}
      </View>
      {busy && <Busy label="Destroying…" />}
    </ScrollView>
  );
}
