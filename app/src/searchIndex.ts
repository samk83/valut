// Keeps the photos' search notes while the vault is open, and reads photos that have none yet,
// one at a time, in the background. Everything is forgotten on lock (reset()); the notes
// themselves stay sealed in the vault.
import { useSyncExternalStore } from 'react';

import VaultCore, { VaultItem } from '../modules/vault-core';
import { parseNote, SearchNote } from './search';

type Progress = { done: number; total: number; running: boolean };

const notes = new Map<string, SearchNote>();
// Photos that could not be read this session (damaged or unsupported); tried again next unlock.
const failed = new Set<string>();
let photos: VaultItem[] = [];
let generation = 0;
let running = false;
let progress: Progress = { done: 0, total: 0, running: false };
const listeners = new Set<() => void>();

function publish() {
  // notes and failed only hold ids of photos in the current list (pruned in update()).
  progress = { done: notes.size + failed.size, total: photos.length, running };
  for (const fn of listeners) fn();
}

/** Forget everything (called on lock). A read that is still running is discarded. */
export function reset() {
  generation++;
  notes.clear();
  failed.clear();
  photos = [];
  running = false;
  publish();
}

export function getNote(id: string): SearchNote | undefined {
  return notes.get(id);
}

/** All photos with a note, for searching. */
export function entries(): { id: string; note: SearchNote; createdAt: number; mimeType: string }[] {
  return photos.flatMap((p) => {
    const note = notes.get(p.id);
    return note ? [{ id: p.id, note, createdAt: p.createdAt, mimeType: p.mimeType }] : [];
  });
}

/** Reads one photo now (the viewer's text button), or returns the note it already has. */
export async function noteFor(id: string): Promise<SearchNote | null> {
  const known = notes.get(id);
  if (known) return known;
  const gen = generation;
  const note = parseNote(await VaultCore.analyze(id));
  if (note && gen === generation && photos.some((p) => p.id === id)) {
    notes.set(id, note);
    publish();
  }
  return note;
}

/**
 * Called whenever the item list changes (unlock, import, delete). Loads saved notes first,
 * then reads the photos that have none, newest first.
 */
export function update(items: VaultItem[]) {
  if (!VaultCore.canRead) return;
  // Newest first: the order photos are read in.
  photos = items.filter((i) => i.kind === 'PHOTO').sort((a, b) => b.createdAt - a.createdAt);
  const live = new Set(photos.map((p) => p.id));
  for (const id of [...notes.keys()]) if (!live.has(id)) notes.delete(id);
  for (const id of [...failed]) if (!live.has(id)) failed.delete(id);
  publish();
  if (!running) void run();
}

async function run() {
  const gen = generation;
  running = true;
  publish();
  try {
    // Saved notes, in batches.
    const unknown = photos.filter((p) => !notes.has(p.id) && !failed.has(p.id)).map((p) => p.id);
    for (let i = 0; i < unknown.length; i += 40) {
      const batch = await VaultCore.searchNotes(unknown.slice(i, i + 40));
      if (gen !== generation) return;
      for (const [id, json] of Object.entries(batch)) {
        const n = parseNote(json);
        if (n) notes.set(id, n);
      }
      publish();
    }
    // Then read the rest, newest first. update() may replace the list meanwhile (import,
    // delete): then the walk starts over on the new list.
    let list = photos;
    let at = 0;
    for (;;) {
      if (list !== photos) {
        list = photos;
        at = 0;
      }
      while (at < list.length && (notes.has(list[at].id) || failed.has(list[at].id))) at++;
      if (at >= list.length) break;
      const next = list[at];
      try {
        const n = parseNote(await VaultCore.analyze(next.id));
        if (gen !== generation) return;
        // Deleted while it was being read: keep nothing for it.
        if (!photos.some((p) => p.id === next.id)) continue;
        if (n) notes.set(next.id, n);
        else failed.add(next.id);
      } catch (e) {
        if (gen !== generation) return;
        // Locked: stop; the next unlock starts again. Anything else: skip this photo.
        if (String((e as { code?: string })?.code ?? e).includes('E_LOCKED')) return;
        failed.add(next.id);
      }
      publish();
    }
  } catch {
    // The vault was locked while loading notes; the next unlock starts again.
  } finally {
    if (gen === generation) {
      running = false;
      publish();
    }
  }
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useSearchProgress(): Progress {
  return useSyncExternalStore(subscribe, () => progress);
}
