// Albums (owner decision 2026-11-25, mockup A): pure rules, kept free of imports so they can
// be unit-tested with Node. The store that reads and writes the sealed list is albumStore.ts.
//
// An album is only a label: a name and the ids of the photos and videos it shows. Making,
// renaming or deleting an album, or taking a photo out of one, never touches the photo
// itself. The only way to remove a photo stays the 파기 (destroy) button.

export type Album = {
  id: string;
  name: string;
  /** Item ids, most recently added first. May hold ids of items no longer here (filtered when shown). */
  items: string[];
  /** Item id shown on the album card, or null for the newest item. */
  cover: string | null;
  createdAt: number;
  updatedAt: number;
};

export type AlbumDoc = { v: 1; albums: Album[] };

export const EMPTY: AlbumDoc = { v: 1, albums: [] };
export const MAX_NAME = 40;
/** Same cap as the native side (4 MB); far above any real use. */
export const MAX_ALBUMS = 1000;

const ID = /^[0-9a-f]{32}$/;

/**
 * Reads a saved list. Unknown fields are dropped; a broken entry is skipped rather than
 * failing the whole list. Throws only if the text is not an album list at all, so the caller
 * never overwrites what it could not read.
 */
export function parseAlbums(json: string): AlbumDoc {
  const raw = JSON.parse(json) as { v?: unknown; albums?: unknown };
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.albums)) throw new Error('Not an album list');
  const albums: Album[] = [];
  const seen = new Set<string>();
  for (const a of raw.albums as Record<string, unknown>[]) {
    if (!a || typeof a !== 'object' || typeof a.id !== 'string' || !a.id || seen.has(a.id)) continue;
    const name = cleanName(typeof a.name === 'string' ? a.name : '');
    if (!name) continue;
    seen.add(a.id);
    const items = Array.isArray(a.items) ? uniq((a.items as unknown[]).filter((x): x is string => typeof x === 'string' && ID.test(x))) : [];
    const cover = typeof a.cover === 'string' && ID.test(a.cover) ? a.cover : null;
    const createdAt = typeof a.createdAt === 'number' ? a.createdAt : 0;
    const updatedAt = typeof a.updatedAt === 'number' ? a.updatedAt : createdAt;
    albums.push({ id: a.id, name, items, cover, createdAt, updatedAt });
  }
  return { v: 1, albums };
}

export function serializeAlbums(doc: AlbumDoc): string {
  return JSON.stringify({ v: 1, albums: doc.albums });
}

/** Trims, folds runs of spaces and cuts to [MAX_NAME] characters. Empty means invalid. */
export function cleanName(name: string): string {
  return [...name.replace(/\s+/g, ' ').trim()].slice(0, MAX_NAME).join('');
}

function uniq(ids: string[]): string[] {
  return [...new Set(ids)];
}

export function createAlbum(doc: AlbumDoc, name: string, id: string, now: number, items: string[] = []): AlbumDoc {
  const clean = cleanName(name);
  if (!clean) throw new Error('Empty album name');
  if (doc.albums.length >= MAX_ALBUMS) throw new Error('Too many albums');
  const album: Album = { id, name: clean, items: uniq(items.filter((x) => ID.test(x))), cover: null, createdAt: now, updatedAt: now };
  return { v: 1, albums: [album, ...doc.albums.filter((a) => a.id !== id)] };
}

function update(doc: AlbumDoc, id: string, now: number, change: (a: Album) => Album): AlbumDoc {
  return { v: 1, albums: doc.albums.map((a) => (a.id === id ? { ...change(a), updatedAt: now } : a)) };
}

export function renameAlbum(doc: AlbumDoc, id: string, name: string, now: number): AlbumDoc {
  const clean = cleanName(name);
  if (!clean) throw new Error('Empty album name');
  return update(doc, id, now, (a) => ({ ...a, name: clean }));
}

/** Removes the label only. The photos in it stay in the vault. */
export function deleteAlbum(doc: AlbumDoc, id: string): AlbumDoc {
  return { v: 1, albums: doc.albums.filter((a) => a.id !== id) };
}

/** Adds [ids] (newly added first). Items already in the album keep their place. */
export function addToAlbum(doc: AlbumDoc, id: string, ids: string[], now: number): AlbumDoc {
  return update(doc, id, now, (a) => {
    const fresh = uniq(ids.filter((x) => ID.test(x) && !a.items.includes(x)));
    return { ...a, items: [...fresh, ...a.items] };
  });
}

/** Takes [ids] out of the album only. The photos stay in the vault. */
export function removeFromAlbum(doc: AlbumDoc, id: string, ids: string[], now: number): AlbumDoc {
  const out = new Set(ids);
  return update(doc, id, now, (a) => ({ ...a, items: a.items.filter((x) => !out.has(x)), cover: a.cover && out.has(a.cover) ? null : a.cover }));
}

export function setCover(doc: AlbumDoc, id: string, itemId: string | null, now: number): AlbumDoc {
  return update(doc, id, now, (a) => ({ ...a, cover: itemId && a.items.includes(itemId) ? itemId : null }));
}

/** The album's items that are still in the vault, in album order. */
export function liveItems<T extends { id: string }>(album: Album, byId: Map<string, T>): T[] {
  const out: T[] = [];
  for (const id of album.items) {
    const it = byId.get(id);
    if (it) out.push(it);
  }
  return out;
}

/** Item for the album card: the chosen cover if still here, else the most recently added one. */
export function coverOf<T extends { id: string }>(album: Album, byId: Map<string, T>): T | null {
  if (album.cover && byId.has(album.cover)) return byId.get(album.cover) ?? null;
  return liveItems(album, byId)[0] ?? null;
}

/**
 * Merges an album list that came from a backup or another phone into this phone's list.
 * Same album id: the items are joined and this phone's name and cover win. New albums are
 * added. Nothing is ever removed, so a merge can only add labels.
 *
 * [mapId] translates the other list's item ids into this phone's ids (a transfer gives items
 * new ids); ids it maps to null are dropped. For a backup the ids are the same.
 */
export function mergeAlbums(local: AlbumDoc, incoming: AlbumDoc, mapId: (id: string) => string | null = (x) => x): AlbumDoc {
  const albums = local.albums.map((a) => ({ ...a, items: [...a.items] }));
  const index = new Map(albums.map((a, i) => [a.id, i]));
  for (const a of incoming.albums) {
    const items = uniq(a.items.map(mapId).filter((x): x is string => !!x && ID.test(x)));
    const cover = a.cover ? mapId(a.cover) : null;
    const at = index.get(a.id);
    if (at === undefined) {
      if (albums.length >= MAX_ALBUMS) continue;
      index.set(a.id, albums.length);
      albums.push({ ...a, items, cover: cover && items.includes(cover) ? cover : null });
    } else {
      const mine = albums[at];
      const added = items.filter((x) => !mine.items.includes(x));
      if (added.length) albums[at] = { ...mine, items: [...mine.items, ...added], updatedAt: Math.max(mine.updatedAt, a.updatedAt) };
    }
  }
  return { v: 1, albums };
}

/** Albums newest first (by when they were made). */
export function sortedAlbums(doc: AlbumDoc): Album[] {
  return [...doc.albums].sort((a, b) => b.createdAt - a.createdAt);
}
