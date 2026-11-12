// Photo search, all on the phone. The native side reads each photo once (text + what it shows)
// and seals that "search note" next to the photo; this file only matches notes against what the
// user types. Pure functions, so they are unit-tested (tests/search.test.ts).

export type NoteLine = { t: string; b: [number, number, number, number] };

export type SearchNote = {
  v: number;
  engine: string;
  /** Size of the upright image the boxes refer to. */
  w: number;
  h: number;
  text: string;
  lines: NoteLine[];
  /** English words for what the photo shows (Apple Vision / ML Kit identifiers). */
  labels: string[];
};

export function parseNote(json: string | null | undefined): SearchNote | null {
  if (!json) return null;
  try {
    const n = JSON.parse(json);
    if (!n || typeof n !== 'object' || typeof n.text !== 'string') return null;
    return {
      v: Number(n.v) || 1,
      engine: String(n.engine ?? ''),
      w: Number(n.w) || 0,
      h: Number(n.h) || 0,
      text: n.text,
      lines: Array.isArray(n.lines)
        ? n.lines.filter((l: unknown): l is NoteLine => !!l && typeof (l as NoteLine).t === 'string' && Array.isArray((l as NoteLine).b) && (l as NoteLine).b.length === 4)
        : [],
      labels: Array.isArray(n.labels) ? n.labels.filter((l: unknown): l is string => typeof l === 'string') : [],
    };
  } catch {
    return null;
  }
}

/**
 * Text as it is compared: same Unicode form (so Korean typed on any keyboard matches),
 * lower case, and no spaces or punctuation (OCR often adds or drops a space, and "9,000"
 * should match "9000").
 */
export function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

/**
 * A second, looser form for letters OCR mixes up: 0/o, 1/l/i/|, 5/s, 8/b. Used only after
 * the exact form found nothing, so exact matches always rank first.
 */
export function loosen(normalized: string): string {
  return normalized.replace(/[0]/g, 'o').replace(/[1i|]/g, 'l').replace(/[5]/g, 's').replace(/[8]/g, 'b');
}

/** Levenshtein distance up to [max]; returns max + 1 when it is further. */
function within(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

/** True when [hay] holds [needle] with at most one letter wrong, missing or extra. */
function fuzzyContains(hay: string, needle: string): boolean {
  const n = needle.length;
  for (let start = 0; start + n - 1 <= hay.length; start++) {
    for (const len of [n - 1, n, n + 1]) {
      if (len <= 0 || start + len > hay.length) continue;
      if (within(hay.slice(start, start + len), needle, 1)) return true;
    }
  }
  return false;
}

// Each note's text is normalized once, not on every keystroke.
const forms = new WeakMap<SearchNote, { exact: string; loose: string }>();
function formsOf(note: SearchNote) {
  let f = forms.get(note);
  if (!f) {
    const exact = normalize(note.text);
    f = { exact, loose: loosen(exact) };
    forms.set(note, f);
  }
  return f;
}

// One-letter-off matching is slow on long texts; long pages still match exactly or loosely.
const FUZZY_MAX_CHARS = 3000;

/** 3 = exact, 2 = OCR look-alike letters, 1 = one letter off, 0 = no match. */
export function textScore(note: SearchNote, term: string): number {
  const q = normalize(term);
  if (!q) return 0;
  const hay = formsOf(note);
  if (hay.exact.includes(q)) return 3;
  if (hay.loose.includes(loosen(q))) return 2;
  // A one-letter slip only for words long enough that it cannot match by chance.
  if (q.length >= 5 && hay.exact.length <= FUZZY_MAX_CHARS && fuzzyContains(hay.exact, q)) return 1;
  return 0;
}

/** Indexes of the lines that hold [term] (for the boxes in the photo viewer). */
export function matchingLines(note: SearchNote, term: string): number[] {
  const q = normalize(term);
  if (!q) return [];
  const exact: number[] = [];
  const loose: number[] = [];
  note.lines.forEach((l, i) => {
    const t = normalize(l.t);
    if (t.includes(q)) exact.push(i);
    else if (loosen(t).includes(loosen(q))) loose.push(i);
  });
  if (exact.length || loose.length) return [...exact, ...loose];
  // The word may be split over two lines: mark both.
  for (let i = 0; i + 1 < note.lines.length; i++) {
    if (normalize(note.lines[i].t + note.lines[i + 1].t).includes(q)) return [i, i + 1];
  }
  return [];
}

/** The line to show under a result, with the matched part split out for highlighting. */
export function snippet(note: SearchNote, term: string): { before: string; match: string; after: string } | null {
  const q = term.trim();
  const idx = matchingLines(note, q)[0];
  const line = idx === undefined ? note.lines.find((l) => l.t.trim()) : note.lines[idx];
  if (!line) return null;
  const text = line.t;
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (!q || at < 0) return { before: text, match: '', after: '' };
  return { before: text.slice(0, at), match: text.slice(at, at + q.length), after: text.slice(at + q.length) };
}

/** Splits what the user typed into words; every word must be found. */
export function terms(query: string): string[] {
  return query
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => normalize(w).length > 0);
}

export type Category = {
  key: string;
  /** Lower-case pieces of Apple Vision / ML Kit label words that belong to it. */
  labels: string[];
};

/**
 * What a photo shows, in groups people search for. The words come from Apple's and Google's
 * on-device label lists; a label belongs to a group when it contains one of these pieces.
 */
export const CATEGORIES: Category[] = [
  { key: 'document', labels: ['document', 'receipt', 'paper', 'text', 'menu', 'book', 'poster', 'whiteboard', 'handwriting', 'printed', 'letter', 'envelope', 'business card'] },
  { key: 'people', labels: ['people', 'person', 'adult', 'child', 'baby', 'selfie', 'portrait', 'face', 'crowd', 'team', 'smile'] },
  { key: 'food', labels: ['food', 'meal', 'dish', 'dessert', 'cake', 'bread', 'fruit', 'vegetable', 'pizza', 'sushi', 'noodle', 'rice', 'meat', 'salad', 'snack', 'cuisine', 'bakery'] },
  { key: 'drink', labels: ['drink', 'beverage', 'coffee', 'tea', 'cup', 'wine', 'beer', 'juice', 'cocktail', 'mug'] },
  { key: 'animal', labels: ['animal', 'dog', 'cat', 'pet', 'bird', 'fish', 'horse', 'puppy', 'kitten', 'mammal'] },
  { key: 'nature', labels: ['plant', 'flower', 'tree', 'forest', 'garden', 'grass', 'leaf', 'nature'] },
  { key: 'outdoor', labels: ['sky', 'beach', 'mountain', 'sea', 'ocean', 'lake', 'river', 'sunset', 'sunrise', 'snow', 'landscape', 'cloud', 'waterfall', 'outdoor'] },
  { key: 'city', labels: ['building', 'city', 'street', 'architecture', 'bridge', 'tower', 'skyscraper', 'road', 'structure'] },
  { key: 'vehicle', labels: ['car', 'vehicle', 'bus', 'train', 'airplane', 'aircraft', 'bicycle', 'motorcycle', 'boat', 'ship', 'truck'] },
  { key: 'screen', labels: ['screenshot', 'screen', 'monitor', 'computer', 'phone', 'display', 'website'] },
  { key: 'clothes', labels: ['clothing', 'shoe', 'dress', 'jacket', 'shirt', 'bag', 'jewelry', 'hat', 'glasses', 'sunglasses'] },
  { key: 'home', labels: ['room', 'furniture', 'bed', 'sofa', 'couch', 'kitchen', 'table', 'chair', 'interior'] },
];

export function inCategory(note: SearchNote, key: string): boolean {
  const cat = CATEGORIES.find((c) => c.key === key);
  if (!cat) return false;
  return note.labels.some((l) => cat.labels.some((piece) => l.includes(piece)));
}

/**
 * Category keys a typed word points at, from their names in the user's language and in
 * English ([names] maps key → words, e.g. food → "food, meal, 음식").
 */
export function categoriesFor(term: string, names: Record<string, string>): string[] {
  const q = normalize(term);
  if (q.length < 2) return [];
  return Object.entries(names)
    .filter(([, words]) => words.split(',').some((w) => {
      const n = normalize(w);
      return n.length > 0 && (n === q || (q.length >= 2 && n.startsWith(q)));
    }))
    .map(([key]) => key);
}

/** The photo shows [term] by its own (English) label words, or by a category name. */
export function contentMatch(note: SearchNote, term: string, names: Record<string, string>): boolean {
  const q = normalize(term);
  if (q.length < 2) return false;
  if (note.labels.some((l) => normalize(l) === q || (q.length >= 3 && normalize(l).startsWith(q)))) return true;
  return categoriesFor(term, names).some((key) => inCategory(note, key));
}

export type Filter = 'all' | 'text' | 'document' | 'screenshot';

export function passesFilter(note: SearchNote, mimeType: string, filter: Filter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'text':
      return formsOf(note).exact.length >= 3;
    case 'document':
      return inCategory(note, 'document') || formsOf(note).exact.length >= 80;
    case 'screenshot':
      // Phone screenshots are PNG files; camera photos are JPEG or HEIC.
      return mimeType === 'image/png' || inCategory(note, 'screen');
  }
}

export type Hit = { id: string; score: number; inText: boolean };

/**
 * Every word must be found, in the text or in what the photo shows. Text hits rank above
 * content-only hits; within each, exact above look-alike above one-letter-off, then newest.
 */
export function searchNotes(
  entries: { id: string; note: SearchNote; createdAt: number; mimeType: string }[],
  query: string,
  filter: Filter,
  names: Record<string, string>,
): { text: Hit[]; content: Hit[] } {
  const words = terms(query);
  const text: (Hit & { at: number })[] = [];
  const content: (Hit & { at: number })[] = [];
  for (const e of entries) {
    if (!passesFilter(e.note, e.mimeType, filter)) continue;
    if (words.length === 0) {
      // A filter alone browses everything that fits it.
      if (filter !== 'all') text.push({ id: e.id, score: 0, inText: false, at: e.createdAt });
      continue;
    }
    let score = 0;
    let allInText = true;
    let ok = true;
    for (const w of words) {
      const s = textScore(e.note, w);
      if (s > 0) {
        score += s;
        continue;
      }
      allInText = false;
      if (contentMatch(e.note, w, names)) continue;
      ok = false;
      break;
    }
    if (!ok) continue;
    (allInText ? text : content).push({ id: e.id, score, inText: allInText, at: e.createdAt });
  }
  const order = (a: { score: number; at: number }, b: { score: number; at: number }) => b.score - a.score || b.at - a.at;
  const strip = ({ at: _at, ...h }: Hit & { at: number }): Hit => h;
  return { text: text.sort(order).map(strip), content: content.sort(order).map(strip) };
}
