// Pure helpers for selecting many gallery tiles at once (tap, long press, drag).

/**
 * Index of the tile under a point in a grid of [cols] columns of square tiles [size] wide,
 * [gap] apart. [x] is from the grid's left edge, [y] from the top of the first row (scroll
 * included). Points outside the grid snap to the nearest tile; null when there are no tiles.
 */
export function tileAt(x: number, y: number, cols: number, size: number, gap: number, count: number): number | null {
  if (count <= 0 || cols <= 0) return null;
  const step = size + gap;
  const col = Math.min(cols - 1, Math.max(0, Math.floor(x / step)));
  const row = Math.max(0, Math.floor(y / step));
  return Math.min(count - 1, row * cols + col);
}

/**
 * Selection while dragging: what was selected when the drag began ([base]) plus every id from
 * the tile where the drag began ([anchor]) to the tile under the finger ([current]), either way.
 */
export function dragSelection(ids: readonly string[], base: ReadonlySet<string>, anchor: number, current: number): Set<string> {
  const next = new Set(base);
  const from = Math.max(0, Math.min(anchor, current));
  const to = Math.min(ids.length - 1, Math.max(anchor, current));
  for (let i = from; i <= to; i++) next.add(ids[i]);
  return next;
}

/** Adds [id] if missing, removes it if present. */
export function toggle(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Selected ids that still exist, in gallery order. */
export function inOrder(ids: readonly string[], selected: ReadonlySet<string>): string[] {
  return ids.filter((id) => selected.has(id));
}
