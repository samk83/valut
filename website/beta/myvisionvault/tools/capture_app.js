// Captures the app screens used on the beta page and in the how-to video, from the Expo web build
// with the demo vault (no encryption in the browser preview). Run with Playwright installed:
//   node capture_app.js <workDir>
// workDir must hold:
//   en.json             app strings: app/src/i18n/en.ts dumped as JSON
//   samples/            photos and short clips to import, in import order (sorted by name)
//   notes_by_file.json  search note per photo (key = file name without the "NN_" prefix)
//   posters/            first frame of each clip, named <clip>_poster.jpg.tmp.jpg
// Output: workDir/raw/*.png (1320x2868, iPhone 6.9" size).
// The web build must be served at http://localhost:8765 and built in a scratch copy of the app with these
// screenshot-only changes (never committed): DemoVault reports hardware 'SECURE_ENCLAVE' and gives items
// ids d0, d1, ...; readLockMethod() falls back to 'pin'; the web VaultCore returns canRead: true,
// analyze/searchNotes from globalThis.__PVV_NOTES, video thumbnails from globalThis.__PVV_THUMBS, and a
// backupStatus that is on (folder 'iCloud Drive', key confirmed).
const { chromium } = require('playwright');
const fs = require('fs');
const S = require('path').resolve(process.argv[2] || '.');
const T = JSON.parse(fs.readFileSync(S + '/en.json'));
const names = fs.readdirSync(S + '/samples').sort();
const files = names.map(f => S + '/samples/' + f);
const BY = JSON.parse(fs.readFileSync(S + '/notes_by_file.json'));
const NOTES = {}, THUMBS = {};
names.forEach((f, i) => {
  const k = f.split('_').slice(1).join('_');
  if (BY[k]) NOTES['d' + i] = BY[k];
  if (f.endsWith('.mp4')) THUMBS['d' + i] = 'data:image/jpeg;base64,' + fs.readFileSync(S + '/posters/' + f.replace('.mp4', '_poster.jpg.tmp.jpg')).toString('base64');
});
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, locale: 'en-US', timezoneId: 'America/Vancouver' });
  await ctx.addInitScript(([n, t]) => { globalThis.__PVV_NOTES = n; globalThis.__PVV_THUMBS = t; }, [NOTES, THUMBS]);
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('ERR', e.message));
  fs.mkdirSync(S + '/raw', { recursive: true });
  const shot = async (n, w = 900) => { await p.waitForTimeout(w); await p.screenshot({ path: `${S}/raw/${n}.png` }); console.log('shot', n); };
  const lab = s => p.locator(`[aria-label="${s.replace(/"/g, '\\"')}"]:visible`).first();
  const txt = s => p.getByText(s, { exact: true }).first();
  const pin = async s => { for (const c of s) await lab(c).click(); await lab(T['common.confirm']).click(); };
  try {
    await p.goto('http://localhost:8765/'); await p.addStyleTag({ content: 'input,textarea{outline:none!important}' }); await p.waitForTimeout(2500);
    await shot('01-welcome', 300);
    await txt(T['welcome.create']).click(); await shot('02-create', 600);
    await p.getByText(T['create.agree'].split('**')[0].trim().slice(0, 12), { exact: false }).first().click();
    await pin('135790'); await p.waitForTimeout(900); await pin('135790'); await p.waitForTimeout(1500);
    await shot('09-backup', 300); // the backup screen opens after a new vault is created
    await lab(T['common.back']).click(); await p.waitForTimeout(1200);
    const fc = p.waitForEvent('filechooser'); await txt(T['home.import']).click();
    (await fc).setFiles(files);
    await shot('03-sealing', 1500);
    await p.waitForTimeout(12000);
    await txt(T['result.backToVault']).click(); await shot('04-home', 2500);
    await txt(T['home.photos']).click(); await shot('05-gallery', 1800);
    await lab(T['common.back']).click(); await p.waitForTimeout(1000);
    await txt(T['home.search']).click(); await p.waitForTimeout(1500);
    await p.keyboard.type('wifi', { delay: 120 }); await shot('06-search-text', 1500);
    await txt('Guest Wi-Fi').click(); await shot('07-viewer-text', 2500);
    await lab(T['common.back']).click(); await p.waitForTimeout(1000);
    const box = p.locator('input:visible').first(); await box.fill(''); await box.type('people', { delay: 100 });
    await shot('08-search-people', 1500);
    await txt(T['common.cancel']).click(); await p.waitForTimeout(1000);
    await lab(T['common.settings']).click(); await shot('10-settings', 1200);
    for (let i = 0; i < 3 && !(await p.locator(`[aria-label="${T['home.lockNow']}"]:visible`).count()); i++) { await lab(T['common.back']).click().catch(() => {}); await p.waitForTimeout(900); }
    await lab(T['home.lockNow']).click(); await shot('11-locked', 9000); // waits out the web-only "no screen lock" notice
  } catch (e) { console.log('FAIL', e.message.slice(0, 500)); await p.screenshot({ path: `${S}/raw/_fail.png` }); }
  await b.close();
})();
