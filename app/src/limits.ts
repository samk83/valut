// Pure rules of the free plan, kept free of imports so they can be unit-tested with Node.

/** Free plan: every security feature, up to this many photos and videos (owner, 2026-11-10). */
export const FREE_LIMIT = 100;

/**
 * How many more items may be added. Premium has no limit (Infinity). Items already in the
 * vault always stay viewable and deletable, even above the limit; only adding is blocked.
 */
export function freeSlots(itemCount: number, premium: boolean): number {
  if (premium) return Infinity;
  return Math.max(0, FREE_LIMIT - itemCount);
}

/** Splits a selection into what fits and what is left out. */
export function fitToSlots<T>(picked: T[], slots: number): { take: T[]; leftOut: number } {
  if (slots >= picked.length) return { take: picked, leftOut: 0 };
  return { take: picked.slice(0, Math.max(0, slots)), leftOut: picked.length - Math.max(0, slots) };
}

/** At or below this many free spaces left, Settings says how many are left. */
export const NEAR_LIMIT_LEFT = 10;

export type PlanCard = 'premium' | 'free' | 'near' | 'full';

/** Which upgrade card Settings shows at the top for this many items. */
export function planCard(itemCount: number, premium: boolean): PlanCard {
  if (premium) return 'premium';
  const left = freeSlots(itemCount, false);
  if (left <= 0) return 'full';
  if (left <= NEAR_LIMIT_LEFT) return 'near';
  return 'free';
}
