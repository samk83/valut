import { NativeModule, requireOptionalNativeModule } from 'expo';

/** 1.1 Premium: one-time, lifetime, unlimited storage. App Store / Google Play only. */
export type StoreStatus = {
  /** False when the store cannot be reached or the product is not set up yet. */
  available: boolean;
  premium: boolean;
  /** Google Play: a purchase is waiting for payment (for example cash at a shop). */
  pending: boolean;
  /** Localised price from the store, e.g. "$9.99" or "₩14,000". */
  price: string | null;
};

export type PurchaseOutcome = 'purchased' | 'pending' | 'cancelled' | 'unavailable' | 'error';

type Events = { onPremiumChanged: (e: { premium: boolean }) => void };

declare class VaultStoreModule extends NativeModule<Events> {
  status(): Promise<StoreStatus>;
  purchase(): Promise<PurchaseOutcome>;
  restore(): Promise<boolean>;
}

const native = requireOptionalNativeModule<VaultStoreModule>('VaultStore');

/** In Expo Go (preview) there is no store: everything reports "not available". */
export const Store = native
  ? {
      status: () => native.status(),
      purchase: () => native.purchase(),
      restore: () => native.restore(),
      onPremiumChanged: (fn: (e: { premium: boolean }) => void) => native.addListener('onPremiumChanged', fn),
    }
  : {
      status: async (): Promise<StoreStatus> => ({ available: false, premium: false, pending: false, price: null }),
      purchase: async (): Promise<PurchaseOutcome> => 'unavailable',
      restore: async () => false,
      onPremiumChanged: (_fn: (e: { premium: boolean }) => void) => ({ remove: () => {} }),
    };
