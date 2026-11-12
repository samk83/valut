// Builds the how-to video (assets/video/how-to.mp4) and its poster from the real app screenshots.
// Needs: Node, Playwright with Chromium, ffmpeg.  Run from the repo root:
//   node website/beta/myvisionvault/tools/make_video.js <folder with 01-welcome.png ... 08-unlock.png>
// Each scene is drawn as an HTML slide (site fonts and colors), saved as a PNG, then joined by ffmpeg
// with a slow zoom and crossfades. No audio track.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SITE = path.resolve(__dirname, '..');
const SHOTS = path.resolve(process.argv[2] || path.join(SITE, 'assets/shots'));
const OUT = path.join(SITE, 'assets/video');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pvv-video-'));
const W = 1920, H = 1080, FPS = 30, SCENE = 5.5, FADE = 0.6;

const scenes = [
  { kind: 'title' },
  { shot: '01-welcome', step: '01', tag: 'Start', title: 'Open the app.<br>No sign-up.', body: 'No account, no email, no cloud. Your vault is created on this phone.' },
  { shot: '02-create-pin', step: '02', tag: 'Lock', title: 'Choose a PIN<br>or a pattern.', body: 'At least 4 digits, and 10 or more is safer. Nobody can reset it, so pick one you will remember.' },
  { shot: '05-import-options', step: '03', tag: 'Import', title: 'Bring photos in.', body: 'Each item is copied in, encrypted, then checked. Your originals stay in your gallery.' },
  { shot: '03-home-photos', step: '04', tag: 'Your vault', title: 'Everything stays<br>on this phone.', body: 'Photos and videos sit in their own tabs, encrypted on the device.' },
  { shot: '04-home-videos', step: '05', tag: 'Camera', title: 'Shoot straight<br>into the vault.', body: 'Tap the camera button. What you capture never goes to your photo library.' },
  { shot: '06-photo-viewer', step: '06', tag: 'View', title: 'Look, but only<br>in here.', body: 'There is no share or export button. Swipe through, rotate, or check the details.' },
  { shot: '07-settings', step: '07', tag: 'Check', title: 'Your protection<br>at a glance.', body: 'Settings shows what guards your vault. It locks the moment you leave the app.' },
  { shot: '08-unlock', step: '08', tag: 'Return', title: 'Come back with<br>your PIN.', body: 'Wrong tries make you wait, but never erase your vault. Never share your PIN with anyone.' },
  { kind: 'outro' },
];

const fontsCss = 'file://' + path.join(SITE, 'assets/fonts/fonts.css');
const dial = fs.readFileSync(path.join(SITE, 'assets/favicon.svg'), 'utf8');

function slide(s) {
  const head = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${fontsCss}"><style>
  *{box-sizing:border-box;margin:0}
  body{width:${W}px;height:${H}px;overflow:hidden;background:radial-gradient(1200px 800px at 25% 30%,#1D2230 0%,#0B0D12 60%);color:#F2EEE6;font-family:Inter,sans-serif;-webkit-font-smoothing:antialiased}
  .wrap{display:grid;grid-template-columns:620px 1fr;align-items:center;gap:110px;height:100%;padding:0 150px 0 190px}
  .phone{width:440px;height:956px;border-radius:64px;padding:12px;background:linear-gradient(160deg,#3A3F4A,#14171E 40%,#2A2E38);box-shadow:0 40px 120px rgba(0,0,0,.6),0 0 0 1px #2E3340;justify-self:center}
  .phone img{width:100%;height:100%;border-radius:52px;display:block;object-fit:cover}
  .step{font-family:'IBM Plex Mono',monospace;font-size:26px;letter-spacing:.14em;color:#C9A66B;text-transform:uppercase}
  h1{font-family:Fraunces,serif;font-weight:300;font-size:92px;line-height:1.02;margin-top:26px;letter-spacing:-.01em}
  p{font-size:34px;line-height:1.45;color:#B9B3A8;margin-top:34px;max-width:900px}
  .center{display:grid;place-items:center;align-content:center;gap:28px;height:100%;text-align:center}
  .center svg{width:220px;height:220px;filter:drop-shadow(0 30px 60px rgba(201,166,107,.22))}
  .center h1{font-size:120px;margin:0}
  .center h1 em{font-style:italic;color:#C9A66B}
  .center p{margin:0}
  .badge{font-family:'IBM Plex Mono',monospace;font-size:24px;letter-spacing:.2em;color:#0B0D12;background:linear-gradient(160deg,#F7E6BE,#C9A66B 45%,#9C7840);padding:8px 22px;border-radius:999px}
  .url{font-family:'IBM Plex Mono',monospace;font-size:32px;color:#F7E6BE}
  </style></head><body>`;
  if (s.kind === 'title') return head + `<div class="center">${dial}<span class="badge">BETA</span><h1>Private Vision <em>Vault</em></h1><p>How it works, in under a minute</p></div></body></html>`;
  if (s.kind === 'outro') return head + `<div class="center">${dial}<h1>Join the <em>beta.</em></h1><p>Try Private Vision Vault on iPhone and iPad with TestFlight.</p><span class="url">jellydock.com/beta/myvisionvault</span></div></body></html>`;
  const img = 'file://' + path.join(SHOTS, s.shot + (fs.existsSync(path.join(SHOTS, s.shot + '.png')) ? '.png' : '.webp'));
  return head + `<div class="wrap"><div class="phone"><img src="${img}"></div><div><div class="step">${s.step} · ${s.tag}</div><h1>${s.title}</h1><p>${s.body}</p></div></div></body></html>`;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const pngs = [];
  for (let i = 0; i < scenes.length; i++) {
    const html = path.join(TMP, `s${i}.html`);
    fs.writeFileSync(html, slide(scenes[i]));
    await page.goto('file://' + html);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    const png = path.join(TMP, `s${i}.png`);
    await page.screenshot({ path: png });
    pngs.push(png);
  }
  await browser.close();
  fs.mkdirSync(OUT, { recursive: true });

  // Slow zoom on every scene, then crossfade scenes together.
  const frames = Math.round(SCENE * FPS);
  const args = ['-y'];
  pngs.forEach(p => args.push('-i', p)); // one still frame each; zoompan makes the scene's frames
  const parts = pngs.map((_, i) =>
    `[${i}:v]scale=${W * 2}:${H * 2},zoompan=z='1+0.035*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS},setsar=1,format=yuv420p[v${i}]`);
  let last = 'v0';
  for (let i = 1; i < pngs.length; i++) {
    const off = (i * (SCENE - FADE)).toFixed(2);
    parts.push(`[${last}][v${i}]xfade=transition=fade:duration=${FADE}:offset=${off}[x${i}]`);
    last = `x${i}`;
  }
  const mp4 = path.join(OUT, 'how-to.mp4');
  args.push('-filter_complex', parts.join(';'), '-map', `[${last}]`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '24',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4);
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
  execFileSync('ffmpeg', ['-y', '-i', pngs[0], '-q:v', '4', path.join(OUT, 'poster.jpg')], { stdio: 'inherit' });
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('Wrote', mp4);
})();
