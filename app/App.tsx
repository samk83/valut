import { Fraunces_400Regular } from '@expo-google-fonts/fraunces/400Regular';
import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces/600SemiBold';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { useFonts } from 'expo-font';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, View } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import VaultCore, { VaultItem } from './modules/vault-core';
import { CreatePin, Destroyed, Unlock, Welcome } from './src/screens/Auth';
import { VaultCamera } from './src/screens/Camera';
import { Home } from './src/screens/Home';
import { Settings } from './src/screens/Settings';
import { PhotoViewer, VideoPlayer } from './src/screens/Viewer';
import { C } from './src/theme';
import { Busy } from './src/ui';

type Route =
  | { name: 'loading' }
  | { name: 'welcome' }
  | { name: 'create' }
  | { name: 'unlock'; remaining: number }
  | { name: 'destroyed'; cause: 'attempts' | 'reset' }
  | { name: 'home' }
  | { name: 'camera' }
  | { name: 'settings' }
  | { name: 'view'; item: VaultItem };

const UNLOCKED: Route['name'][] = ['home', 'camera', 'settings', 'view'];
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
    setRoute(st.exists ? { name: 'unlock', remaining: st.remainingAttempts } : { name: 'welcome' });
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
      const since = backgroundedAt.current;
      backgroundedAt.current = null;
      if (since !== null && Date.now() - since > SUSPEND_GRACE_MS) {
        VaultCore.lock();
        toLocked();
      }
    },
    [toLocked],
  );

  useEffect(() => {
    toLocked();
  }, [toLocked]);

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
      if (r === 'view' || r === 'settings' || r === 'camera') {
        setRoute({ name: 'home' });
        return true;
      }
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
      screen = <Busy label="Opening…" />;
      break;
    case 'welcome':
      screen = <Welcome onNext={() => setRoute({ name: 'create' })} />;
      break;
    case 'create':
      screen = <CreatePin onDone={home} onLocked={toLocked} />;
      break;
    case 'unlock':
      screen = <Unlock key={route.remaining} remaining={route.remaining} onUnlocked={afterUnlock} onDestroyed={() => setRoute({ name: 'destroyed', cause: 'attempts' })} />;
      break;
    case 'destroyed':
      screen = <Destroyed cause={route.cause} onNew={() => setRoute({ name: 'create' })} />;
      break;
    case 'home':
      screen = (
        <Home
          refreshKey={refreshKey}
          suspendAutoLock={suspendAutoLock}
          onOpen={(item) => setRoute({ name: 'view', item })}
          onCamera={() => setRoute({ name: 'camera' })}
          onSettings={() => setRoute({ name: 'settings' })}
          onLock={() => {
            VaultCore.lock();
            toLocked();
          }}
        />
      );
      break;
    case 'camera':
      screen = <VaultCamera suspendAutoLock={suspendAutoLock} onClose={home} />;
      break;
    case 'settings':
      screen = <Settings onBack={home} onDestroyed={() => setRoute({ name: 'destroyed', cause: 'reset' })} />;
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
        {fontsLoaded || fontError ? screen : null}
      </BottomInset>
    </SafeAreaProvider>
  );
}

/** Keeps every screen's bottom controls above the Android navigation bar / iPhone home indicator. */
function BottomInset({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return <View style={{ flex: 1, backgroundColor: C.bg, paddingBottom: insets.bottom }}>{children}</View>;
}
