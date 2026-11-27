// Who holds the auto-lock pause (App.tsx suspendAutoLock). Each new pause gets a new number,
// so a flow that ends late (the rating sheet timer) can tell a newer flow (a picker) took over
// and must not release the pause under it.
let gen = 0;

/** Called by App.tsx each time auto-lock is paused. */
export function newHold(): number {
  gen += 1;
  return gen;
}

/** The newest pause's number. */
export function currentHold(): number {
  return gen;
}
