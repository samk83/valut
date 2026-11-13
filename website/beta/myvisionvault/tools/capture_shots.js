// Captures the app screens for the beta page and how-to video from the Expo web build of the app
// (preview vault, nothing encrypted), with the temporary screenshot-only changes from
// tools/screenshot_patch.py applied. Usage, from the repo root:
//   node website/beta/myvisionvault/tools/capture_shots.js <workDir> <outDir> <file...>
//   workDir/en.json         : English app strings (dumped from app/src/i18n/en.ts, see README.md)
//   workDir/notes.json      : search notes per file name (gen_text_samples.py writes the text ones;
//                             photos without an entry get no labels)
//   file...                 : photos and clips to import, in this order (absolute paths)
// The web build must be served at http://localhost:8765. Writes <outDir>/<screen>.png (1320x2868).
const { chromium } = require('playwright');
const fs = require('fs');
const W = process.argv[2];
const T = JSON.parse(fs.readFileSync(W + '/en.json', 'utf8'));
const NOTES = fs.existsSync(W + '/notes.json') ? JSON.parse(fs.readFileSync(W + '/notes.json', 'utf8')) : {};
const out = process.argv[3]; const files = process.argv.slice(4);
fs.mkdirSync(out, { recursive: true });
const notes = files.map(f => { const n = NOTES[require('path').basename(f)]; return n ? JSON.stringify(n) : JSON.stringify({ v: 1, engine: 'demo', w: 1, h: 1, text: '', lines: [], labels: ['outdoor'] }); });
const fmt = (k, v) => T[k].replace(/\{(\w+)\}/g, (_, x) => v[x]);
(async () => {
  const b = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const ctx = await b.newContext({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, locale: 'en-US' });
  await ctx.addInitScript(n => { globalThis.__NOTES = n; }, notes);
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('ERR', e.message));
  const shot = async (n, w = 900) => { await p.waitForTimeout(w); await p.screenshot({ path: `${out}/${n}.png` }); console.log('shot', n); };
  const lab = s => p.locator(`[aria-label="${s.replace(/"/g, '\\"')}"]:visible`).first();
  const txt = s => p.getByText(s, { exact: true }).first();
  const pin = async s => { for (const c of s) await lab(c).click(); await lab(T['common.confirm']).click(); };
  const step = process.env.STEP || 'all';
  const hide = (t, up = 0) => p.evaluate(([t, up]) => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (n.nodeValue.trim().startsWith(t)) { let e = n.parentElement; for (let i = 0; i < up; i++) e = e.parentElement; e.style.visibility = 'hidden'; } }, [t, up]);
  try {
    await p.goto('http://localhost:8765/'); await p.waitForTimeout(2500);
    await shot('01-welcome', 300);
    await txt(T['welcome.create']).click(); await p.waitForTimeout(600);
    await p.getByText(T['create.agree'].split('**')[0].trim().slice(0, 12), { exact: false }).first().click();
    for (const c of '135790') await lab(c).click();
    await shot('02-create-pin', 400);
    await lab(T['common.confirm']).click(); await p.waitForTimeout(900);
    await pin('135790'); await p.waitForTimeout(2500);
    await shot('03-backup', 300);
    await lab(T['common.back']).click(); await p.waitForTimeout(1500);
    const fc = p.waitForEvent('filechooser'); await txt(T['home.import']).click();
    if (T['import.choose']) { await txt(T['import.choose']).click(); }
    (await fc).setFiles(files);
    await shot('04-import', 1700);
    await p.waitForTimeout(12000);
    await txt(T['result.backToVault']).click(); await shot('05-home', 2500);
    await txt(T['home.seeAll']).click(); await shot('06-gallery', 2000);
    await lab(T['gallery.search']).click(); await p.waitForTimeout(800);
    await p.keyboard.type(process.env.Q || 'coffee', { delay: 90 }); await p.waitForTimeout(800); await p.keyboard.press('Tab'); await shot('07-search', 2000);
    await p.getByText('2 x Flat white', { exact: false }).first().click(); await shot('08-viewer-text', 2500);
    const back = async () => { const n = p.locator(`[aria-label="${T['common.back']}"]:visible`); if (await n.count()) await n.last().click(); else await p.keyboard.press('Escape'); await p.waitForTimeout(1000); };
    await back();
    const cancel = p.getByText(T['common.cancel'], { exact: true }); if (await cancel.count()) await cancel.first().click(); await p.waitForTimeout(800);
    await back();
    await p.getByText(T['home.videos'], { exact: true }).first().click(); await shot('09-videos', 1800);
    await back();
    await lab(T['common.settings']).click(); await p.waitForTimeout(1200); await hide(T['settings.screenshotsBlocked'], 1); await shot('10-settings', 200);
    await back();
    await lab(T['home.lockNow']).click(); await p.waitForTimeout(1500); await hide('This phone has no screen lock', 1); await shot('11-unlock', 200);
  } catch (e) { console.log('FAIL', e.message.slice(0, 500)); console.log(await p.evaluate(() => document.body.innerText.slice(0, 500))); await p.screenshot({ path: `${out}/_fail.png` }); }
  finally { await b.close(); }
})();
