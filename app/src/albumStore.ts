// The album list while the vault is open: read from the sealed file, kept in memory, written
// back after every change. Albums are labels only (see albums.ts); nothing here touches a photo.
import { randomUUID } from 'expo-crypto';
import { useSyncExternalStore } from 'react';

import VaultCore from '../modules/vault-core';
import { AlbumDoc, EMPTY, mergeAlbums, parseAlbums, serializeAlbums } from './albums';

type State = { doc: AlbumDoc; loaded: boolean; /** The saved list could not be read: never overwrite it. */ unreadable: boolean };

let state: State = { doc: EMPTY, loaded: false, unreadable: false };
let generation = 0;
const listeners = new Set<() => void>();
// Writes go one after another, in the order the changes were made.
let queue: Promise<unknown> = Promise.resolve();

function set(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

export function useAlbums(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** After a lock: forget the list (it is read again after the next unlock). */
export function resetAlbums() {
  generation++;
  set({ doc: EMPTY, loaded: false, unreadable: false });
}

/**
 * Reads the list, then merges any album lists that came with a restored backup or from the
 * old phone. A list from another phone uses that phone's item ids; they are translated to
 * this phone's ids, and albums of items that did not arrive are simply left empty.
 */
export async function loadAlbums(): Promise<void> {
  const gen = generation;
  let doc: AlbumDoc = EMPTY;
  try {
    const json = await VaultCore.readAlbums();
    if (json) doc = parseAlbums(json);
  } catch {
    if (gen === generation) set({ doc: EMPTY, loaded: true, unreadable: true });
    return;
  }
  try {
    const incoming = await VaultCore.incomingAlbums();
    if (incoming.length) {
      let merged = doc;
      let toLocal: Map<string, string> | null = null;
      const done: string[] = [];
      for (const inc of incoming) {
        let other: AlbumDoc;
        try {
          other = parseAlbums(inc.json);
        } catch {
          done.push(inc.name); // Not an album list: nothing to keep.
          continue;
        }
        if (inc.origin === 'transfer') {
          if (!toLocal) {
            const map = await VaultCore.receivedMap();
            toLocal = new Map(Object.entries(map).map(([local, source]) => [source, local]));
          }
          const m = toLocal;
          merged = mergeAlbums(merged, other, (id) => m.get(id) ?? null);
        } else {
          merged = mergeAlbums(merged, other);
        }
        done.push(inc.name);
      }
      if (gen !== generation) return;
      // Saved first, then forgotten: a crash in between only merges the same list again.
      if (merged !== doc) await VaultCore.writeAlbums(serializeAlbums(merged));
      await VaultCore.clearIncomingAlbums(done);
      doc = merged;
    }
  } catch {
    // Left waiting; the next unlock tries again. The list read above is still shown.
  }
  if (gen === generation) set({ doc, loaded: true, unreadable: false });
}

/** Applies [change] and saves the result. Rejects (and changes nothing) if saving fails. */
export function changeAlbums(change: (doc: AlbumDoc) => AlbumDoc): Promise<AlbumDoc> {
  const run = async () => {
    if (!state.loaded) await loadAlbums();
    if (state.unreadable) throw new Error('Album list unreadable');
    const gen = generation;
    const next = change(state.doc);
    await VaultCore.writeAlbums(serializeAlbums(next));
    if (gen === generation) set({ ...state, doc: next });
    return next;
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

export function newAlbumId(): string {
  return randomUUID().replace(/-/g, '');
}
