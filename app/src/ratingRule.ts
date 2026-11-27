// When to show Apple's / Google's own "rate this app" sheet (owner decision 2026-11-27).
// Only after a good moment (an import that added something), never on first use, and rarely.
// The system sheet itself also limits how often it appears (iOS: at most 3 times a year).

export const MIN_ITEMS = 10;
export const MIN_DAYS_SINCE_FIRST_USE = 3;
export const MIN_DAYS_BETWEEN_ASKS = 120;
export const MAX_ASKS = 3;

const DAY = 24 * 60 * 60 * 1000;

export type RatingState = { firstUse: number | null; asked: number[] };

export const EMPTY: RatingState = { firstUse: null, asked: [] };

/** Reads the saved text; anything unreadable counts as "never asked, first use now unknown". */
export function parseRating(text: string | null): RatingState {
  if (!text) return EMPTY;
  try {
    const v = JSON.parse(text);
    const firstUse = typeof v?.firstUse === 'number' && Number.isFinite(v.firstUse) ? v.firstUse : null;
    const asked = Array.isArray(v?.asked) ? v.asked.filter((t: unknown) => typeof t === 'number' && Number.isFinite(t)) : [];
    return { firstUse, asked };
  } catch {
    return EMPTY;
  }
}

/** Records the first time the vault was opened (kept once set). */
export function withFirstUse(s: RatingState, now: number): RatingState {
  return s.firstUse === null ? { ...s, firstUse: now } : s;
}

/** True when the rating sheet may be shown now, right after an import that added [added] items. */
export function shouldAskRating(s: RatingState, now: number, itemCount: number, added: number): boolean {
  if (added <= 0) return false;
  if (itemCount < MIN_ITEMS) return false;
  if (s.firstUse === null || now - s.firstUse < MIN_DAYS_SINCE_FIRST_USE * DAY) return false;
  if (s.asked.length >= MAX_ASKS) return false;
  const last = s.asked.length ? Math.max(...s.asked) : null;
  if (last !== null && now - last < MIN_DAYS_BETWEEN_ASKS * DAY) return false;
  return true;
}

export function withAsked(s: RatingState, now: number): RatingState {
  return { ...s, asked: [...s.asked, now] };
}
