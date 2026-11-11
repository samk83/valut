import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { PurchaseOutcome, Store, StoreStatus } from '../modules/vault-core';

export { FREE_LIMIT, fitToSlots, freeSlots } from './limits';

// One shared status for every screen, refreshed from the store.
let current: StoreStatus = { available: false, premium: false, pending: false, price: null };
let loaded = false;
const listeners = new Set<(s: StoreStatus) => void>();

function publish(next: StoreStatus) {
  current = next;
  loaded = true;
  listeners.forEach((l) => l(next));
}

export async function refreshPremium(): Promise<StoreStatus> {
  try {
    publish(await Store.status());
  } catch {
    // Keep the last answer; the store may be busy or offline.
  }
  return current;
}

Store.onPremiumChanged((e) => publish({ ...current, premium: e.premium }));

// Back in the app: ask again (a refund, Ask to Buy approval, or a purchase that still needs
// its acknowledgement on Google Play, which refunds unacknowledged purchases after 3 days).
AppState.addEventListener('change', (state) => {
  if (state === 'active' && loaded) refreshPremium();
});

export async function buyPremium(): Promise<PurchaseOutcome> {
  let outcome: PurchaseOutcome = 'error';
  try {
    outcome = await Store.purchase();
  } catch {
    outcome = 'error';
  }
  if (outcome === 'purchased') publish({ ...current, premium: true, pending: false });
  else if (outcome === 'pending') publish({ ...current, pending: true });
  return outcome;
}

export async function restorePremium(): Promise<boolean> {
  let premium = current.premium;
  try {
    premium = await Store.restore();
  } catch {
    // Unchanged.
  }
  publish({ ...current, premium });
  refreshPremium();
  return premium;
}

/** Current store status for a screen; asks the store once per app start. */
export function usePremium(): StoreStatus & { loaded: boolean } {
  const [state, setState] = useState(current);
  const [isLoaded, setLoaded] = useState(loaded);
  useEffect(() => {
    const l = (s: StoreStatus) => {
      setState(s);
      setLoaded(true);
    };
    listeners.add(l);
    if (!loaded) refreshPremium();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return { ...state, loaded: isLoaded };
}
