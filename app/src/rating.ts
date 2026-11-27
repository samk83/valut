import { File, Paths } from 'expo-file-system';
import * as StoreReview from 'expo-store-review';
import { AppState } from 'react-native';

import { currentHold } from './autoLockHold';
import { parseRating, RatingState, shouldAskRating, withAsked, withFirstUse } from './ratingRule';

// Only dates are stored (first use, when the sheet was shown). Nothing about photos, and nothing
// is sent anywhere by the app: the rating sheet is the phone's own App Store / Play Store sheet.
const ratingFile = () => new File(Paths.document, 'rating-ask');

function read(): RatingState {
  try {
    const f = ratingFile();
    return parseRating(f.exists ? f.textSync() : null);
  } catch {
    return parseRating(null);
  }
}

function save(s: RatingState) {
  try {
    const f = ratingFile();
    if (!f.exists) f.create();
    f.write(JSON.stringify(s));
  } catch {}
}

/** Call when the vault is opened: remembers the first day of use. */
export function noteVaultOpened() {
  const s = read();
  if (s.firstUse === null) save(withFirstUse(s, Date.now()));
}

// The sheet sits over the app and may make it "inactive" for a moment. Without this the
// auto-lock would close the vault under the sheet. Kept short: leaving the app while the
// sheet is up still locks at the latest when this ends.
const SHEET_GRACE_MS = 20_000;

/**
 * After an import that added [added] items: maybe show the rating sheet.
 * [suspendAutoLock] is the app's own switch (see App.tsx).
 */
export async function maybeAskRating(itemCount: number, added: number, suspendAutoLock: (on: boolean) => void) {
  const s = read();
  const now = Date.now();
  if (!shouldAskRating(s, now, itemCount, added)) return;
  try {
    if (!(await StoreReview.isAvailableAsync())) return;
  } catch {
    return;
  }
  save(withAsked(s, now));
  suspendAutoLock(true);
  const mine = currentHold();
  let left = false;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    sub.remove();
    clearTimeout(timer);
    // A picker or another flow paused auto-lock after us: that flow releases it, not us.
    if (currentHold() === mine) suspendAutoLock(false);
  };
  const sub = AppState.addEventListener('change', (state) => {
    if (state !== 'active') left = true;
    else if (left) finish(); // the sheet closed
  });
  const timer = setTimeout(finish, SHEET_GRACE_MS);
  try {
    await StoreReview.requestReview();
  } catch {
    finish();
  }
}
