// Checks every language pack against English: same keys, same {placeholders}, same ** markers,
// the plural forms each language needs, and 12 month names. Usage: node scripts/check-i18n.js [lang...]
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const dir = path.join(__dirname, '..', 'src', 'i18n');
const load = (name) => {
  const src = fs.readFileSync(path.join(dir, `${name}.ts`), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, () => ({}));
  return mod.exports.default;
};

const NEEDS = { ru: ['one', 'few', 'many'], zh: [], ja: [], ko: [], id: [] };
const holders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const stars = (s) => (s.match(/\*\*/g) || []).length;

const en = load('en');
const langs = process.argv.slice(2).length ? process.argv.slice(2) : ['zh', 'hi', 'id', 'pt', 'ru', 'ja', 'es', 'de', 'tr', 'ko'];
let errors = 0;
const err = (lang, msg) => {
  errors++;
  console.log(`${lang}: ${msg}`);
};

for (const lang of langs) {
  let p;
  try {
    p = load(lang);
  } catch (e) {
    err(lang, `cannot load (${e.message})`);
    continue;
  }
  for (const k of Object.keys(en)) {
    if (!(k in p)) {
      err(lang, `missing ${k}`);
      continue;
    }
    const e = en[k];
    const v = p[k];
    if (typeof e === 'string') {
      if (typeof v !== 'string') {
        err(lang, `${k} must be a string`);
        continue;
      }
      if (k !== 'terms.translationNote' && e.length > 0 && v.trim().length === 0) err(lang, `${k} is empty`);
      if (holders(e) !== holders(v)) err(lang, `${k} placeholders ${holders(v)} != ${holders(e)}`);
      if (stars(e) !== stars(v)) err(lang, `${k} has ${stars(v)} ** markers, English has ${stars(e)}`);
    } else {
      if (typeof v !== 'object' || typeof v.other !== 'string') {
        err(lang, `${k} must be a plural object with "other"`);
        continue;
      }
      const need = NEEDS[lang] ?? ['one'];
      for (const f of need) if (typeof v[f] !== 'string') err(lang, `${k} needs plural form "${f}"`);
      const want = holders(e.other);
      for (const [f, s] of Object.entries(v)) {
        // A singular form may spell out the number instead of using {n}.
        const got = holders(s);
        if (got !== want && !(f === 'one' && got === want.split(',').filter((x) => x !== 'n').join(','))) err(lang, `${k}.${f} placeholders ${got} != ${want}`);
      }
    }
  }
  for (const k of Object.keys(p)) if (!(k in en)) err(lang, `extra key ${k}`);
  for (const mk of ['months', 'months.standalone']) if (typeof p[mk] === 'string' && p[mk].split('|').length !== 12) err(lang, `${mk} must have 12 names`);
  if (lang !== 'en' && !(p['terms.translationNote'] || '').trim()) err(lang, 'terms.translationNote must say the English version applies');
  const loc = path.join(__dirname, '..', 'locales', `${lang}.json`);
  if (!fs.existsSync(loc)) err(lang, `missing locales/${lang}.json`);
  else {
    const j = JSON.parse(fs.readFileSync(loc, 'utf8'));
    for (const k of ['NSCameraUsageDescription', 'NSMicrophoneUsageDescription', 'NSPhotoLibraryUsageDescription', 'CFBundleDisplayName'])
      if (!(j.ios && typeof j.ios[k] === 'string' && j.ios[k].trim())) err(lang, `locales/${lang}.json ios.${k} missing`);
  }
}
console.log(errors ? `${errors} problem(s)` : `OK: ${langs.join(', ')}`);
process.exit(errors ? 1 : 0);
