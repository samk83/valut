import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { buyPremium, FREE_LIMIT, refreshPremium, restorePremium, usePremium } from '../premium';
import { C, F } from '../theme';
import { Body, Busy, Button, s, Title } from '../ui';

const FALLBACK_PRICE = '$9.99';

/**
 * Premium: one payment, unlimited photos and videos for good. No subscription, no ads.
 * [reason] says why the screen opened ("limit" when the free 100 are used up).
 */
export function Premium({
  onClose,
  reason,
  itemCount,
  suspendAutoLock,
}: {
  onClose: () => void;
  reason?: 'limit';
  itemCount?: number;
  /** The store's payment sheet sends the app to the background; do not lock for that. */
  suspendAutoLock: (on: boolean) => void;
}) {
  const st = usePremium();
  const [busy, setBusy] = useState<null | 'buy' | 'restore'>(null);

  useEffect(() => {
    refreshPremium();
  }, []);

  const store = Platform.OS === 'ios' ? 'App Store' : 'Google Play';
  const account = Platform.OS === 'ios' ? 'Apple ID' : 'Google account';

  const buy = async () => {
    if (busy) return;
    setBusy('buy');
    suspendAutoLock(true);
    const outcome = await buyPremium().finally(() => suspendAutoLock(false));
    setBusy(null);
    if (outcome === 'purchased') return;
    if (outcome === 'pending') {
      Alert.alert('Payment pending', `${store} is waiting for the payment to finish. Premium turns on by itself when it does.`);
    } else if (outcome === 'unavailable') {
      Alert.alert('Not available right now', `${store} could not be reached. Check your connection and try again.`);
    } else if (outcome === 'error') {
      Alert.alert('Purchase did not finish', 'Nothing was charged. Try again in a moment.');
    }
  };

  const restore = async () => {
    if (busy) return;
    setBusy('restore');
    suspendAutoLock(true);
    const premium = await restorePremium().finally(() => suspendAutoLock(false));
    setBusy(null);
    if (!premium) Alert.alert('Nothing to restore', `No Premium purchase was found for this ${account}. Sign in with the ${account} you bought it with and try again.`);
  };

  if (st.premium) {
    return (
      <View style={[s.screen, { justifyContent: 'center' }]}>
        <Ionicons name="infinite" size={44} color={C.brass} />
        <View style={{ height: 12 }} />
        <Text style={s.label}>Premium</Text>
        <View style={{ height: 8 }} />
        <Title>Unlimited storage is on</Title>
        <Body style={{ color: C.muted, marginBottom: 28 }}>Thank you. Add as many photos and videos as your phone can hold. This purchase is yours for good, on every device with the same {account}.</Body>
        <Button label="Back to vault" onPress={onClose} />
      </View>
    );
  }

  const price = st.price ?? FALLBACK_PRICE;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: 56, paddingHorizontal: 24, paddingBottom: 24 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ alignSelf: 'flex-start', padding: 8, marginLeft: -8, marginBottom: 12 }}>
          <Ionicons name="close" size={26} color={C.ivory} />
        </Pressable>
        <Text style={s.label}>{reason === 'limit' ? 'Free plan is full' : 'Premium'}</Text>
        <View style={{ height: 8 }} />
        <Title>{reason === 'limit' ? `You've used all ${FREE_LIMIT} free spaces` : 'Unlimited photos and videos'}</Title>
        <Body style={{ color: C.muted, marginBottom: 22 }}>
          {reason === 'limit'
            ? `Everything already in your vault stays safe and viewable${itemCount ? ` (${itemCount} items)` : ''}. To add more, unlock unlimited storage once.`
            : `The free plan holds ${FREE_LIMIT} photos and videos with every security feature. Premium removes the limit.`}
        </Body>

        <View style={[s.card, { borderColor: C.brassDim, gap: 12 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: F.titleBold, fontSize: 22, color: C.ivory }}>Lifetime Premium</Text>
            <Text style={{ fontFamily: F.bold, fontSize: 20, color: C.brass }}>{price}</Text>
          </View>
          <Text style={s.small}>Pay once. No subscription, no ads, ever.</Text>
          {[
            'Unlimited photos and videos',
            'The same security: encrypted on this phone only',
            `Restore it free on a new phone with the same ${account}`,
            Platform.OS === 'ios' ? 'Shared with your family through Family Sharing' : null,
          ]
            .filter((x): x is string => !!x)
            .map((t) => (
              <View key={t} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                <Ionicons name="checkmark-circle" size={18} color={C.ok} style={{ marginTop: 2 }} />
                <Text style={[s.body, { flex: 1 }]}>{t}</Text>
              </View>
            ))}
        </View>

        <Text style={[s.small, { marginTop: 16 }]}>
          Paid through {store}. The app never sees your payment details, and nothing about you is sent to us. Moving your vault to a new phone stays free.
        </Text>
      </ScrollView>
      <View style={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 30, gap: 10 }}>
        <Button label={`Unlock for ${price}`} onPress={buy} disabled={!!busy || (st.loaded && !st.available)} />
        {st.loaded && !st.available && <Text style={[s.small, { textAlign: 'center' }]}>{store} is not reachable right now.</Text>}
        {st.pending && <Text style={[s.small, { textAlign: 'center' }]}>A payment is pending. Premium turns on when it completes.</Text>}
        <Button label="Restore purchases" kind="ghost" onPress={restore} disabled={!!busy} />
      </View>
      {busy && <Busy label={busy === 'buy' ? `Opening ${store}…` : 'Checking your purchases…'} />}
    </View>
  );
}
