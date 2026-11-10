import { getLocales } from 'expo-localization';

import de from './de';
import en from './en';
import es from './es';
import hi from './hi';
import id from './id';
import ja from './ja';
import ko from './ko';
import pt from './pt';
import ru from './ru';
import tr from './tr';
import zh from './zh';

export type Key = keyof typeof en;
export type PluralForms = { one?: string; few?: string; many?: string; other: string };
/** A language pack: every English key, each a string or (where English has one) a plural entry. */
export type Pack = { [K in Key]: (typeof en)[K] extends string ? string : PluralForms };

// The top 10 countries by smartphone users (China, India, USA, Indonesia, Brazil, Russia,
// Japan, Mexico, Germany, Turkey) plus Korean. English is the fallback.
export const PACKS: Record<string, Pack> = { en, zh, hi, id, pt, ru, ja, es, de, tr, ko };
export const LANGUAGES = Object.keys(PACKS);

/** First of the device's preferred languages that has a pack, else English. Fixed for the session. */
function detect(): string {
  try {
    for (const l of getLocales()) {
      let code = (l.languageCode ?? '').toLowerCase();
      // Android may still report the old code "in" for Indonesian.
      if (code === 'in') code = 'id';
      // Only Simplified Chinese is translated; Traditional Chinese readers get English.
      if (code === 'zh' && isTraditional(l.languageTag, l.regionCode)) continue;
      if (Object.prototype.hasOwnProperty.call(PACKS, code)) return code;
    }
  } catch {}
  return 'en';
}

function isTraditional(tag: string | null | undefined, region: string | null | undefined): boolean {
  const t = (tag ?? '').toLowerCase();
  if (t.includes('hant')) return true;
  if (t.includes('hans')) return false;
  return ['TW', 'HK', 'MO'].includes((region ?? '').toUpperCase());
}

export const lang = detect();
const pack = PACKS[lang];

type Vars = Record<string, string | number>;

const fill = (text: string, vars?: Vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m)) : text);

/** Translated text for [key] with {placeholders} filled in. */
export function t(key: Key, vars?: Vars): string {
  const v = pack[key] ?? en[key];
  return fill(typeof v === 'string' ? v : v.other, vars);
}

/** Plural category of [n] in [language] (CLDR rules, integers only). */
export function pluralCategory(n: number, language: string = lang): 'one' | 'few' | 'many' | 'other' {
  const abs = Math.abs(Math.trunc(n));
  switch (language) {
    case 'ru': {
      const m10 = abs % 10;
      const m100 = abs % 100;
      if (m10 === 1 && m100 !== 11) return 'one';
      if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'few';
      return 'many';
    }
    case 'hi':
      return abs === 0 || abs === 1 ? 'one' : 'other';
    case 'pt':
      // Brazilian Portuguese: 0 and 1 are singular.
      return abs === 0 || abs === 1 ? 'one' : 'other';
    case 'zh':
    case 'ja':
    case 'ko':
    case 'id':
      return 'other';
    default:
      return abs === 1 ? 'one' : 'other';
  }
}

/** Plural-aware text: picks the form for [n] and fills {n} plus any other placeholders. */
export function tn(key: Key, n: number, vars?: Vars): string {
  const v = pack[key] ?? en[key];
  const forms: PluralForms = typeof v === 'string' ? { other: v } : v;
  const cat = pluralCategory(n);
  const text = forms[cat] ?? (cat === 'few' || cat === 'many' ? forms.many ?? forms.other : forms.other);
  return fill(text, { n, ...vars });
}

/** Month name for a date, 0 = January. */
export const month = (index: number) => t('months').split('|')[index] ?? '';
/** Month name on its own, for month headers. */
export const monthStandalone = (index: number) => t('months.standalone').split('|')[index] ?? '';

/**
 * Splits translated text on ** markers: even parts are plain, odd parts are emphasised.
 * "a **b** c" -> [{text:'a ',strong:false},{text:'b',strong:true},{text:' c',strong:false}]
 */
export function rich(text: string): { text: string; strong: boolean }[] {
  return text.split('**').map((part, i) => ({ text: part, strong: i % 2 === 1 })).filter((p) => p.text.length > 0);
}
