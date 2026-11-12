// Builds App Store screenshots: headline + subline from docs/aso/listing.json over a raw app screen.
// Usage: node compose.js <rawDir> <outDir> <fontFile> [locales] [devices]
//   rawDir/<device>/<lang>/<screen>.png  (made by capture.js)  ->  outDir/<device>/<locale>/NN-<screen>.png
// Needs Playwright (preinstalled in the cloud container). Sizes: iPhone 6.9" 1320x2868, iPad 13" 2064x2752.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const [rawDir, outDir, fontFile] = process.argv.slice(2, 5);
const listing = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'listing.json'), 'utf8'));
// Store order: strongest message first. Index matches "shots" in listing.json.
const ORDER = ['home', 'gate', 'sealing', 'settings', 'transfer', 'premium', 'welcome'];
// listing.json locale -> app language folder from capture.js
const LANG = { 'en-US': 'en', ko: 'ko', ja: 'ja', 'zh-Hans': 'zh', hi: 'hi', id: 'id', 'pt-BR': 'pt', ru: 'ru', 'es-MX': 'es', 'de-DE': 'de', tr: 'tr' };
const SERIF = ['en-US', 'id', 'pt-BR', 'es-MX', 'de-DE', 'tr']; // Fraunces covers Latin only
const DEV = {
  iphone: { w: 1320, h: 2868, top: 250, head: 104, sub: 52, shotW: 1060, gap: 96, radius: 64 },
  ipad: { w: 2064, h: 2752, top: 200, head: 112, sub: 56, shotW: 1560, gap: 90, radius: 44 },
};
// TWO_STEP=0: the build has no two-step unlock (PR #14), so leave out the "two locks" shot.
const SKIP = process.env.TWO_STEP === '0' ? new Set(['gate']) : new Set();
const locales = (process.argv[5] || Object.keys(LANG).join(',')).split(',');
const devices = (process.argv[6] || 'iphone,ipad').split(',');
const font = fs.readFileSync(fontFile).toString('base64');
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ deviceScaleFactor: 1 });
  for (const dv of devices) for (const loc of locales) {
    const d = DEV[dv];
    const shots = listing.locales[loc].shots;
    const out = path.join(outDir, dv, loc);
    fs.mkdirSync(out, { recursive: true });
    // Start clean so a rerun (e.g. with TWO_STEP=0) leaves no old or misnumbered images behind.
    for (const f of fs.readdirSync(out)) if (f.endsWith('.png')) fs.unlinkSync(path.join(out, f));
    let n = 0;
    for (let i = 0; i < ORDER.length; i++) {
      if (SKIP.has(ORDER[i])) continue;
      n++;
      const raw = path.join(rawDir, dv, LANG[loc], ORDER[i] + '.png');
      if (!fs.existsSync(raw)) { console.log('missing', raw); continue; }
      const img = fs.readFileSync(raw).toString('base64');
      const [h, s] = shots[i];
      const headFont = SERIF.includes(loc) ? "'Fraunces', serif" : "'Inter', 'Noto Sans CJK SC', 'Noto Sans', sans-serif";
      const html = `<!doctype html><html lang="${loc}"><head><meta charset="utf-8"><style>
        @font-face { font-family: 'Fraunces'; src: url(data:font/ttf;base64,${font}); }
        html,body { margin:0; width:${d.w}px; height:${d.h}px; overflow:hidden; }
        body { display:flex; flex-direction:column; align-items:center; box-sizing:border-box; padding-top:${d.top}px; background: radial-gradient(120% 60% at 50% 0%, #2a2416 0%, #12141b 45%, #0B0D12 100%); font-family: 'Inter', 'Noto Sans', sans-serif; }
        .t { padding:0 80px; text-align:center; flex:none; }
        h1 { font-family:${headFont}; font-weight:600; font-size:${d.head}px; line-height:1.12; color:#F3EEE3; margin:0 0 28px; letter-spacing:-0.5px; }
        p { font-size:${d.sub}px; line-height:1.3; color:#C9A45C; margin:0; font-weight:500; }
        .s { flex:none; margin-top:${d.gap}px; width:${d.shotW}px; border-radius:${d.radius}px; overflow:hidden;
             border:3px solid #3a3426; box-shadow: 0 30px 90px rgba(0,0,0,.6), 0 0 0 1px rgba(201,164,92,.15); }
        .s img { display:block; width:100%; }
      </style></head><body>
        <div class="t"><h1>${esc(h)}</h1><p>${esc(s)}</p></div>
        <div class="s"><img src="data:image/png;base64,${img}"></div>
      </body></html>`;
      await p.setViewportSize({ width: d.w, height: d.h });
      await p.setContent(html, { waitUntil: 'load' });
      await p.evaluate(() => document.fonts.ready);
      const file = path.join(out, `${String(n).padStart(2, '0')}-${ORDER[i]}.png`);
      await p.screenshot({ path: file });
    }
    console.log('done', dv, loc);
  }
  await b.close();
})();
