import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { buyPremium, FREE_LIMIT, refreshPremium, restorePremium, usePremium } from '../premium';
import { t } from '../i18n';
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
  const account = Platform.OS === 'ios' ? t('plan.accountApple') : t('plan.accountGoogle');

  const buy = async () => {
    if (busy) return;
    setBusy('buy');
    suspendAutoLock(true);
    const outcome = await buyPremium().finally(() => suspendAutoLock(false));
    setBusy(null);
    if (outcome === 'purchased') return;
    if (outcome === 'pending') {
      Alert.alert(t('premium.pending'), t('premium.pendingBody', { store }));
    } else if (outcome === 'unavailable') {
      Alert.alert(t('premium.unavailable'), t('premium.unavailableBody', { store }));
    } else if (outcome === 'error') {
      Alert.alert(t('premium.failed'), t('premium.failedBody'));
    }
  };

  const restore = async () => {
    if (busy) return;
    setBusy('restore');
    suspendAutoLock(true);
    const premium = await restorePremium().finally(() => suspendAutoLock(false));
    setBusy(null);
    if (!premium) Alert.alert(t('plan.nothing'), t('plan.nothingBodyLong', { account }));
  };

  if (st.premium) {
    return (
      <View style={[s.screen, { justifyContent: 'center' }]}>
        <Ionicons name="infinite" size={44} color={C.brass} />
        <View style={{ height: 12 }} />
        <Text style={s.label}>{t('plan.premium')}</Text>
        <View style={{ height: 8 }} />
        <Title>{t('premium.onTitle')}</Title>
        <Body style={{ color: C.muted, marginBottom: 28 }}>{t('premium.onBody', { account })}</Body>
        <Button label={t('premium.backToVault')} onPress={onClose} />
      </View>
    );
  }

  const price = st.price ?? FALLBACK_PRICE;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: 56, paddingHorizontal: 24, paddingBottom: 24 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} style={{ alignSelf: 'flex-start', padding: 8, marginLeft: -8, marginBottom: 12 }}>
          <Ionicons name="close" size={26} color={C.ivory} />
        </Pressable>
        <Text style={s.label}>{reason === 'limit' ? t('premium.fullLabel') : t('plan.premium')}</Text>
        <View style={{ height: 8 }} />
        <Title>{reason === 'limit' ? t('premium.fullTitle', { max: FREE_LIMIT }) : t('premium.title')}</Title>
        <Body style={{ color: C.muted, marginBottom: 22 }}>
          {reason === 'limit'
            ? itemCount
              ? t('premium.fullBodyCount', { count: itemCount })
              : t('premium.fullBody')
            : t('premium.body', { max: FREE_LIMIT })}
        </Body>

        <View style={[s.card, { borderColor: C.brassDim, gap: 12 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: F.titleBold, fontSize: 22, color: C.ivory }}>{t('premium.product')}</Text>
            <Text style={{ fontFamily: F.bold, fontSize: 20, color: C.brass }}>{price}</Text>
          </View>
          <Text style={s.small}>{t('premium.once')}</Text>
          {[
            t('premium.perkUnlimited'),
            t('premium.perkSecurity'),
            t('premium.perkRestore', { account }),
            Platform.OS === 'ios' ? t('premium.perkFamily') : null,
          ]
            .filter((x): x is string => !!x)
            .map((perk) => (
              <View key={perk} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                <Ionicons name="checkmark-circle" size={18} color={C.ok} style={{ marginTop: 2 }} />
                <Text style={[s.body, { flex: 1 }]}>{perk}</Text>
              </View>
            ))}
        </View>

        <Text style={[s.small, { marginTop: 16 }]}>
          {t('premium.paidThrough', { store })}
        </Text>
      </ScrollView>
      <View style={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 30, gap: 10 }}>
        <Button label={t('premium.unlock', { price })} onPress={buy} disabled={!!busy || (st.loaded && !st.available)} />
        {st.loaded && !st.available && <Text style={[s.small, { textAlign: 'center' }]}>{t('premium.unreachable', { store })}</Text>}
        {st.pending && <Text style={[s.small, { textAlign: 'center' }]}>{t('premium.pendingNote')}</Text>}
        <Button label={t('plan.restore')} kind="ghost" onPress={restore} disabled={!!busy} />
      </View>
      {busy && <Busy label={busy === 'buy' ? t('premium.opening', { store }) : t('premium.checking')} />}
    </View>
  );
}
