import { Fraunces_400Regular } from '@expo-google-fonts/fraunces/400Regular';
import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces/600SemiBold';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { useFonts } from 'expo-font';
import { enableAppSwitcherProtectionAsync, usePreventScreenCapture } from 'expo-screen-capture';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Platform, View } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import VaultCore, { VaultItem } from './modules/vault-core';
import { CreatePin, Destroyed, Unlock, Welcome } from './src/screens/Auth';
import { Backup, RestoreFlow, Restoring } from './src/screens/Backup';
import { DeviceGate } from './src/screens/DeviceGate';
import { VaultCamera } from './src/screens/Camera';
import { Home } from './src/screens/Home';
import { Premium } from './src/screens/Premium';
import { Settings } from './src/screens/Settings';
import { Transfer } from './src/screens/Transfer';
import { PhotoViewer, VideoPlayer } from './src/screens/Viewer';
import { C } from './src/theme';
import { t } from './src/i18n';
import { Busy, READABLE_WIDTH } from './src/ui';

type Route =
  | { name: 'loading' }
  | { name: 'welcome' }
  | { name: 'create'; restore?: { uri: string; key: string } }
  | { name: 'restoreStart' }
  | { name: 'restoring'; uri: string; key: string }
  | { name: 'backup'; intro?: boolean; back: 'home' | 'settings' }
  | { name: 'unlock'; remaining: number; lockedForMs: number }
  | { name: 'destroyed' }
  | { name: 'home' }
  | { name: 'camera' }
  | { name: 'settings' }
  | { name: 'premium'; reason?: 'limit'; itemCount?: number; back: 'home' | 'settings' }
  | { name: 'transfer' }
  | { name: 'view'; item: VaultItem };

const UNLOCKED: Route['name'][] = ['home', 'camera', 'settings', 'premium', 'transfer', 'view', 'backup', 'restoring'];
// Screens that use the whole width on an iPad; the rest are centred in a readable column.
const FULL_WIDTH: Route['name'][] = ['home', 'camera', 'view'];
// A system picker or dialog may keep the app in the background this long before it locks.
const SUSPEND_GRACE_MS = 90_000;

export default function App() {
  usePreventScreenCapture();
  const [fontsLoaded, fontError] = useFonts({ Fraunces_400Regular, Fraunces_600SemiBold, Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  const [route, setRoute] = useState<Route>({ name: 'loading' });
  const [refreshKey, setRefreshKey] = useState(0);
  const routeRef = useRef(route);
  routeRef.current = route;
  // System pickers and permission dialogs push the app to the background; do not lock then.
  const suspended = useRef(false);
  const backgroundedAt = useRef<number | null>(null);
  const suspendTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const toLocked = useCallback(async () => {
    // Hide decrypted content at once; status() may wait behind a long native call.
    setRoute({ name: 'loading' });
    const st = await VaultCore.status();
    setRoute(st.exists ? { name: 'unlock', remaining: st.remainingAttempts, lockedForMs: st.lockedForMs } : { name: 'welcome' });
  }, []);

  const suspendAutoLock = useCallback(
    (on: boolean) => {
      suspended.current = on;
      if (on) {
        backgroundedAt.current = null;
        return;
      }
      clearTimeout(suspendTimer.current);
      // If the user left the app while a picker or dialog was open, lock now on return.
      // Released while still in the background (e.g. a transfer connected with the app
      // hidden): no later change event would lock it, so lock right away. ("inactive" is
      // only a system sheet over the app, which closes on its own.)
      const since = backgroundedAt.current;
      backgroundedAt.current = null;
      if (AppState.currentState === 'background' || (since !== null && Date.now() - since > SUSPEND_GRACE_MS)) {
        VaultCore.lock();
        toLocked();
      }
    },
    [toLocked],
  );

  useEffect(() => {
    toLocked();
  }, [toLocked]);

  // iPhone/iPad: blur the app switcher snapshot so vault content never shows there.
  useEffect(() => {
    if (Platform.OS === 'ios') enableAppSwitcherProtectionAsync(1).catch(() => {});
  }, []);

  // Auto-lock: drop the master key the moment the app leaves the screen (SPEC AC-07).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') return;
      if (suspended.current) {
        if (backgroundedAt.current === null) {
          backgroundedAt.current = Date.now();
          // Do not wait for the picker to return: the grace period ends on its own.
          clearTimeout(suspendTimer.current);
          suspendTimer.current = setTimeout(() => {
            if (!suspended.current) return;
            VaultCore.lock();
            if (UNLOCKED.includes(routeRef.current.name)) toLocked();
          }, SUSPEND_GRACE_MS);
        }
        return;
      }
      VaultCore.lock();
      if (UNLOCKED.includes(routeRef.current.name)) toLocked();
    });
    return () => sub.remove();
  }, [toLocked]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const r = routeRef.current.name;
      // The backup and restore screens handle Back themselves.
      if (r === 'backup' || r === 'restoring' || r === 'restoreStart') return true;
      if (r === 'view' || r === 'settings' || r === 'camera') {
        setRoute({ name: 'home' });
        return true;
      }
      if (r === 'premium') {
        const cur = routeRef.current;
        setRoute(cur.name === 'premium' && cur.back === 'settings' ? { name: 'settings' } : { name: 'home' });
        return true;
      }
      // The transfer screen handles Back itself (it may need to stop a transfer first).
      if (r === 'transfer') return true;
      return false;
    });
    return () => sub.remove();
  }, []);

  const home = () => {
    setRefreshKey((k) => k + 1);
    setRoute({ name: 'home' });
  };

  // Captures that could not be saved earlier (app killed, battery died) are added now.
  const afterUnlock = () => {
    // The app was left while the PIN was being checked: it must not come back already open.
    if (AppState.currentState !== 'active') {
      VaultCore.lock();
      toLocked();
      return;
    }
    home();
    VaultCore.recoverPending()
      .then((r) => {
        if (r.saved > 0) setRefreshKey((k) => k + 1);
      })
      .catch(() => {});
  };

  let screen: React.ReactNode;
  switch (route.name) {
    case 'loading':
      screen = <Busy label={t('common.opening')} />;
      break;
    case 'welcome':
      screen = <Welcome onNext={() => setRoute({ name: 'create' })} onRestore={() => setRoute({ name: 'restoreStart' })} />;
      break;
    case 'restoreStart':
      screen = (
        <RestoreFlow
          mode="new"
          suspendAutoLock={suspendAutoLock}
          onCancel={() => setRoute({ name: 'welcome' })}
          onReady={(uri, key) => setRoute({ name: 'create', restore: { uri, key } })}
        />
      );
      break;
    case 'create': {
      const restore = route.restore;
      // A new vault first sets up its backup (recovery key + folder); one made to restore a
      // backup takes over that backup's key and folder instead.
      screen = (
        <CreatePin
          onDone={() => setRoute(restore ? { name: 'restoring', ...restore } : { name: 'backup', intro: true, back: 'home' })}
          onLocked={toLocked}
        />
      );
      break;
    }
    case 'restoring':
      screen = <Restoring uri={route.uri} recoveryKey={route.key} onDone={home} />;
      break;
    case 'backup': {
      const back = route.back;
      screen = <Backup intro={route.intro} suspendAutoLock={suspendAutoLock} onClose={() => (back === 'settings' ? setRoute({ name: 'settings' }) : home())} />;
      break;
    }
    case 'unlock':
      // Two-step unlock: the phone's own lock first, then the app's PIN or pattern.
      screen = (
        <DeviceGate>
          <Unlock key={route.remaining} remaining={route.remaining} lockedForMs={route.lockedForMs} onUnlocked={afterUnlock} onNoVault={toLocked} />
        </DeviceGate>
      );
      break;
    case 'destroyed':
      screen = <Destroyed onNew={() => setRoute({ name: 'create' })} />;
      break;
    case 'home':
      screen = (
        <Home
          refreshKey={refreshKey}
          suspendAutoLock={suspendAutoLock}
          onOpen={(item) => setRoute({ name: 'view', item })}
          onCamera={() => setRoute({ name: 'camera' })}
          onSettings={() => setRoute({ name: 'settings' })}
          onBackup={() => setRoute({ name: 'backup', back: 'home' })}
          onPremium={(reason, itemCount) => setRoute({ name: 'premium', reason, itemCount, back: 'home' })}
          onLock={() => {
            VaultCore.lock();
            toLocked();
          }}
        />
      );
      break;
    case 'camera':
      screen = <VaultCamera suspendAutoLock={suspendAutoLock} onClose={home} onLimit={(itemCount) => setRoute({ name: 'premium', reason: 'limit', itemCount, back: 'home' })} />;
      break;
    case 'settings':
      screen = (
        <Settings
          onBack={home}
          onDestroyed={() => setRoute({ name: 'destroyed' })}
          onPremium={() => setRoute({ name: 'premium', back: 'settings' })}
          onTransfer={() => setRoute({ name: 'transfer' })}
          onBackup={() => setRoute({ name: 'backup', back: 'settings' })}
          suspendAutoLock={suspendAutoLock}
        />
      );
      break;
    case 'premium': {
      const back = route.back;
      screen = (
        <Premium
          reason={route.reason}
          itemCount={route.itemCount}
          suspendAutoLock={suspendAutoLock}
          onClose={() => (back === 'settings' ? setRoute({ name: 'settings' }) : home())}
        />
      );
      break;
    }
    case 'transfer':
      screen = <Transfer suspendAutoLock={suspendAutoLock} onClose={home} />;
      break;
    case 'view':
      screen =
        route.item.kind === 'VIDEO' ? (
          <VideoPlayer item={route.item} onClose={home} onDeleted={home} />
        ) : (
          <PhotoViewer item={route.item} onClose={home} onDeleted={home} />
        );
      break;
  }

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <BottomInset>
        <StatusBar style="light" />
        {fontsLoaded || fontError ? (
          <View style={{ flex: 1, width: '100%', maxWidth: FULL_WIDTH.includes(route.name) ? undefined : READABLE_WIDTH, alignSelf: 'center' }}>{screen}</View>
        ) : null}
      </BottomInset>
    </SafeAreaProvider>
  );
}

/** Keeps every screen's bottom controls above the Android navigation bar / iPhone home indicator. */
function BottomInset({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return <View style={{ flex: 1, backgroundColor: C.bg, paddingBottom: insets.bottom }}>{children}</View>;
}
