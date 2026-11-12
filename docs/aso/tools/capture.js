// Captures raw app screens for the App Store from the Expo web build (demo vault, no encryption).
// Usage: node capture.js <workDir> [langs] [devices]
//   workDir/pw/i18n.json : app strings, dumped from app/src/i18n/*.ts (see ASO.md)
//   workDir/samples/     : sample pictures (IMG_10xx.jpg) and clips (MOV_*.mp4), see gen_samples.py
//   output               : workDir/raw/<iphone|ipad>/<lang>/<screen>.png
// The web build must be served at http://localhost:8765 and built with the screenshot-only patches
// listed in ASO.md (hardware key shown as Secure Enclave, App Store wording on Premium, gate held still).
const { chromium } = require('playwright');
const fs = require('fs');
const S = process.argv[2];
const D = JSON.parse(fs.readFileSync(S + '/pw/i18n.json'));
const LOC = { en: 'en-US', zh: 'zh-CN', hi: 'hi-IN', id: 'id-ID', pt: 'pt-BR', ru: 'ru-RU', ja: 'ja-JP', es: 'es-MX', de: 'de-DE', tr: 'tr-TR', ko: 'ko-KR' };
const DEV = { iphone: { viewport: { width: 440, height: 956 }, deviceScaleFactor: 3 }, ipad: { viewport: { width: 1032, height: 1376 }, deviceScaleFactor: 2 } };
const langs = (process.argv[3] || Object.keys(LOC).join(',')).split(',');
const devs = (process.argv[4] || 'iphone,ipad').split(',');
const files = fs.readdirSync(S + '/samples').filter(f => /IMG_10(0|1[0-7])/.test(f) || f.endsWith('.mp4')).sort().map(f => S + '/samples/' + f);
(async () => {
  const b = await chromium.launch();
  for (const l of langs) for (const dv of devs) {
    const T = D[l]; const fmt = (k, v) => T[k].replace(/\{(\w+)\}/g, (_, x) => v[x]);
    const out = `${S}/raw/${dv}/${l}`; fs.mkdirSync(out, { recursive: true });
    const ctx = await b.newContext({ ...DEV[dv], locale: LOC[l] });
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log(l, dv, 'ERR', e.message));
    const shot = async (n, w = 900) => { await p.waitForTimeout(w); await p.screenshot({ path: `${out}/${n}.png` }); };
    const lab = (s) => p.locator(`[aria-label="${s.replace(/"/g, '\\"')}"]:visible`).first();
    const txt = (s) => p.getByText(s, { exact: true }).first();
    const pin = async (s) => { for (const c of s) await lab(c).click(); await lab(T['common.confirm']).click(); };
    try {
      await p.goto('http://localhost:8765/'); await p.waitForTimeout(2500);
      await shot('welcome', 300);
      await txt(T['welcome.create']).click(); await p.waitForTimeout(600);
      await p.getByText(T['create.agree'].split('**')[0].trim().slice(0, 12), { exact: false }).first().click();
      await pin('135790'); await p.waitForTimeout(900); await pin('135790'); await p.waitForTimeout(1500);
      // Builds with an import options screen (before copy-only import) show it first.
      const fc = p.waitForEvent('filechooser'); await txt(T['home.import']).click();
      if (T['import.choose']) { await shot('import'); await txt(T['import.choose']).click(); }
      (await fc).setFiles(files);
      await shot('sealing', 1700);
      await p.waitForTimeout(9000);
      await txt(T['result.backToVault']).click(); await shot('home', 1800);
      await lab(fmt('plan.chipA11y', { used: 22, max: 100 })).click(); await shot('premium');
      await lab(T['common.close']).click(); await p.waitForTimeout(700);
      await lab(T['common.settings']).click(); await shot('settings');
      await txt(T['transfer.title']).click(); await shot('transfer');
      const back = async () => { const n = p.locator(`[aria-label="${T['common.back']}"]:visible`); if (await n.count()) await n.last().click(); else await p.getByText(T['common.back'], { exact: true }).last().click(); await p.waitForTimeout(800); };
      for (let i = 0; i < 3 && !(await p.locator(`[aria-label="${T['home.lockNow']}"]:visible`).count()); i++) { const n = p.locator(`[aria-label="${T['common.back']}"]:visible`); if (await n.count()) await n.last().click(); else await p.locator('[role=button]:visible').first().click(); await p.waitForTimeout(900); }
      await lab(T['home.lockNow']).click(); await shot('gate', 1500);
      console.log('ok', l, dv);
    } catch (e) { console.log('FAIL', l, dv, e.message.slice(0,400)); await p.screenshot({ path: `${out}/_fail.png` }); }
    await ctx.close();
  }
  await b.close();
})();
