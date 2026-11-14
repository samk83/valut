// Builds the how-to video (assets/video/how-to.mp4) and its poster from the real app screenshots.
// Needs: Node, Playwright with Chromium, ffmpeg.  Run from the repo root:
//   node website/beta/myvisionvault/tools/make_video.js <prepared screenshot folder> [narration folder]
// Screenshots come from tools/capture_app.js (raw/*.png). The narration folder holds one MP3 per scene, named by
// the scene's `vo` key below (00.mp3, 01.mp3, ..., ta.mp3, tb.mp3, tc.mp3, outro.mp3); each scene is
// stretched to fit its line. Scenes without a file keep the default length and stay silent.
// Each scene is an HTML slide (site fonts and colors) saved as a PNG, joined by ffmpeg with a slow zoom
// and crossfades; narration lines are placed at the start of their scenes. Background music comes from
// make_music.py (original, generated, no third-party audio) and is ducked under the narration.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SITE = path.resolve(__dirname, '..');
const SHOTS = path.resolve(process.argv[2] || path.join(SITE, 'assets/shots'));
const VO = process.argv[3] ? path.resolve(process.argv[3]) : null;
const OUT = path.join(SITE, 'assets/video');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pvv-video-'));
const W = 1920, H = 1080, FPS = 30, SCENE = 5.8, FADE = 0.6, VO_LEAD = 0.5, VO_TAIL = 0.9;

const scenes = [
  { kind: 'title', vo: '00' },
  { vo: '01', shot: '01-welcome', step: '01', tag: 'Start', title: 'Open the app.<br>No sign-up.', body: 'No account, no email, no servers. Your vault is created on this phone.' },
  { vo: '02', shot: '02-create', step: '02', tag: 'Lock', title: 'Choose a PIN<br>or a pattern.', body: 'At least 4 digits, and 10 or more is safer. Nobody can reset it, so pick one you will remember.' },
  { vo: '03', shot: '03-sealing', step: '03', tag: 'Import', title: 'Bring photos in.', body: 'Each item is copied in, encrypted, then checked. Your originals stay in your gallery.' },
  { shot: '04-home', step: '04', tag: 'Your vault', title: 'Everything<br>in one place.', body: 'Photos and videos, encrypted on the device, with search right at the top.' },
  { shot: '05-gallery', step: '05', tag: 'Gallery', title: 'Full screen,<br>edge to edge.', body: 'Tap Photos for a gallery that fills the screen. Switch between bigger and smaller tiles.' },
  { shot: '06-search-text', step: '06', tag: 'Search', title: 'Find a photo by<br><em>the words in it.</em>', body: 'Type “wifi” and the receipt with the Wi-Fi password turns up. Text is read on the phone itself.' },
  { shot: '07-viewer-text', step: '07', tag: 'Read', title: 'See the match.<br>Copy the text.', body: 'The word is highlighted in the photo, and all the text in it can be copied.' },
  { shot: '08-search-people', step: '08', tag: 'Search', title: 'Or by what<br>it shows.', body: 'People, food, mountains, documents. Each photo is recognized on the device, never in the cloud.' },
  { vo: 'ta', kind: 'tech-keys' },
  { vo: 'tb', kind: 'tech-files' },
  { kind: 'tech-ai' },
  { vo: 'tc', kind: 'tech-network' },
  { shot: '09-backup', step: '09', tag: 'Backup', title: 'A backup only<br><em>you</em> can open.', body: 'Optional. Already-encrypted copies go to a folder you choose, like iCloud Drive, and only your recovery key opens them.' },
  { shot: '10-settings', step: '10', tag: 'Check', title: 'Your protection<br>at a glance.', body: 'Turn on the phone’s own lock as a first step before your PIN. The vault locks the moment you leave the app.' },
  { shot: '11-locked', step: '11', tag: 'Return', title: 'Come back with<br>your PIN.', body: 'Wrong tries make you wait, but never erase your vault. Never share your PIN with anyone.' },
  { kind: 'outro', vo: 'outro' },
];

const fontsCss = 'file://' + path.join(SITE, 'assets/fonts/fonts.css');
const dial = fs.readFileSync(path.join(SITE, 'assets/favicon.svg'), 'utf8');

const CSS = `
  *{box-sizing:border-box;margin:0}
  body{width:${W}px;height:${H}px;overflow:hidden;background:radial-gradient(1200px 800px at 25% 30%,#1D2230 0%,#0B0D12 60%);color:#F2EEE6;font-family:Inter,sans-serif;-webkit-font-smoothing:antialiased}
  .wrap{display:grid;grid-template-columns:620px 1fr;align-items:center;gap:110px;height:100%;padding:0 150px 0 190px}
  .phone{width:440px;height:956px;border-radius:64px;padding:12px;background:linear-gradient(160deg,#3A3F4A,#14171E 40%,#2A2E38);box-shadow:0 40px 120px rgba(0,0,0,.6),0 0 0 1px #2E3340;justify-self:center}
  .phone img{width:100%;height:100%;border-radius:52px;display:block;object-fit:cover}
  .step{font-family:'IBM Plex Mono',monospace;font-size:26px;letter-spacing:.14em;color:#C9A66B;text-transform:uppercase}
  h1{font-family:Fraunces,serif;font-weight:300;font-size:92px;line-height:1.02;margin-top:26px;letter-spacing:-.01em}
  h1 em{font-style:italic;color:#C9A66B}
  p{font-size:34px;line-height:1.45;color:#B9B3A8;margin-top:34px;max-width:900px}
  .center{display:grid;place-items:center;align-content:center;gap:28px;height:100%;text-align:center}
  .center svg{width:220px;height:220px;filter:drop-shadow(0 30px 60px rgba(201,166,107,.22))}
  .center h1{font-size:120px;margin:0}
  .center p{margin:0}
  .badge{font-family:'IBM Plex Mono',monospace;font-size:24px;letter-spacing:.2em;color:#0B0D12;background:linear-gradient(160deg,#F7E6BE,#C9A66B 45%,#9C7840);padding:8px 22px;border-radius:999px}
  .url{font-family:'IBM Plex Mono',monospace;font-size:32px;color:#F7E6BE}
  .tech{display:grid;align-content:center;gap:56px;height:100%;padding:0 150px}
  .tech h1{margin:0;font-size:86px}
  .row{display:flex;align-items:center;gap:28px}
  .node{border:1.5px solid #2E3340;background:#151922;border-radius:26px;padding:30px 34px;display:grid;gap:10px;min-width:330px}
  .node.hot{border-color:#C9A66B;box-shadow:0 0 80px rgba(201,166,107,.18)}
  .node .k{font-family:'IBM Plex Mono',monospace;font-size:20px;letter-spacing:.12em;color:#C9A66B}
  .node b{font-size:36px;font-weight:600}
  .node span{font-size:24px;color:#B9B3A8}
  .plus{font-family:'IBM Plex Mono',monospace;font-size:48px;color:#C9A66B}
  .arrow{flex:1;height:3px;min-width:60px;background:linear-gradient(90deg,#8A6635,#C9A66B);position:relative}
  .arrow:after{content:"";position:absolute;right:-2px;top:-9px;border:10px solid transparent;border-left:16px solid #C9A66B;border-right:0}
  .files{display:grid;grid-template-columns:repeat(6,1fr);gap:22px}
  .file{aspect-ratio:3/4;border-radius:20px;background:#151922;border:1.5px solid #2E3340;display:grid;place-items:center;align-content:center;gap:12px}
  .file svg{width:64px;height:64px}
  .file small{font-family:'IBM Plex Mono',monospace;font-size:18px;color:#C9A66B}
  .chips{display:flex;gap:16px;flex-wrap:wrap}
  .chip{font-family:'IBM Plex Mono',monospace;font-size:24px;color:#F7E6BE;border:1.5px solid #3A3426;border-radius:12px;padding:10px 18px}
  .net{display:flex;align-items:center;justify-content:center;gap:40px}
  .mini{width:200px;height:400px;border-radius:40px;border:3px solid #3A3F4A;background:#151922;display:grid;place-items:center}
  .mini svg{width:96px;height:96px}
  .wifi{display:grid;place-items:center;gap:14px;font-family:'IBM Plex Mono',monospace;font-size:22px;color:#C9A66B;min-width:420px}
  .link{width:420px;height:4px;background:repeating-linear-gradient(90deg,#C9A66B 0 22px,transparent 22px 36px)}
  .cloud{display:grid;place-items:center;gap:10px;margin-left:60px;font-family:'IBM Plex Mono',monospace;font-size:22px;color:#8F897F}
  .cloud svg{width:150px;height:150px}`;

const lock = '<svg viewBox="0 0 24 24" fill="none" stroke="#C9A66B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';

function slide(s) {
  const head = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${fontsCss}"><style>${CSS}</style></head><body>`;
  if (s.kind === 'title') return head + `<div class="center">${dial}<span class="badge">BETA</span><h1>Private Vision <em>Vault</em></h1><p>How it works, in under two minutes</p></div></body></html>`;
  if (s.kind === 'outro') return head + `<div class="center">${dial}<h1>Join the <em>beta.</em></h1><p>Try Private Vision Vault on iPhone and iPad with TestFlight.</p><span class="url">jellydock.com/beta/myvisionvault</span></div></body></html>`;
  if (s.kind === 'tech-keys') return head + `<div class="tech"><div><div class="step">Technology · 1</div><h1 style="margin-top:22px">A door that needs <em>two keys.</em></h1></div>
    <div class="row">
      <div style="display:grid;gap:18px;justify-items:center"><div class="node"><span class="k">SOMETHING YOU KNOW</span><b>PIN or pattern</b><span>stretched with Argon2id</span></div><div class="plus">+</div><div class="node"><span class="k">SOMETHING THE PHONE HAS</span><b>Secure Enclave key</b><span>can’t be copied out</span></div></div>
      <div class="arrow"></div>
      <div class="node hot"><span class="k">MASTER KEY</span><b>Opens only with both</b><span>erased from memory on lock</span></div>
      <div class="arrow"></div>
      <div class="node"><span class="k">YOUR VAULT</span><b>Unlocked</b><span>on this device only</span></div>
    </div></div></body></html>`;
  if (s.kind === 'tech-files') return head + `<div class="tech"><div><div class="step">Technology · 2</div><h1 style="margin-top:22px">Every file, <em>its own key.</em></h1></div>
    <div class="files">${Array.from({ length: 6 }, (_, i) => `<div class="file">${lock}<small>key #${String(i + 1).padStart(2, '0')}</small></div>`).join('')}</div>
    <div class="chips"><span class="chip">AES-256-GCM</span><span class="chip">separate key per photo &amp; video</span><span class="chip">video sealed chunk by chunk</span><span class="chip">names &amp; thumbnails encrypted too</span></div></div></body></html>`;
  if (s.kind === 'tech-ai') return head + `<div class="tech"><div><div class="step">Technology · 3</div><h1 style="margin-top:22px">Search that <em>stays on the phone.</em></h1></div>
    <div class="row">
      <div class="node"><span class="k">YOUR PHOTO</span><b>Opened in the vault</b><span>only while it is unlocked</span></div>
      <div class="arrow"></div>
      <div class="node hot"><span class="k">ON-DEVICE AI</span><b>Reads text, sees things</b><span>Apple Vision · offline ML Kit</span></div>
      <div class="arrow"></div>
      <div class="node"><span class="k">SEARCH NOTE</span><b>Sealed in the vault</b><span>encrypted like the photo itself</span></div>
    </div>
    <div class="chips"><span class="chip">no internet needed</span><span class="chip">nothing uploaded</span><span class="chip">deleted with the photo</span></div></div></body></html>`;
  if (s.kind === 'tech-network') return head + `<div class="tech"><div><div class="step">Technology · 4</div><h1 style="margin-top:22px">No servers. <em>No accounts.</em></h1></div>
    <div class="net"><div class="mini">${lock}</div><div class="wifi"><span>your own Wi-Fi · encrypted</span><div class="link"></div><span>phone to phone, directly</span></div><div class="mini">${lock}</div>
      <div class="cloud"><svg viewBox="0 0 24 24" fill="none" stroke="#8F897F" stroke-width="1.4" stroke-linecap="round"><path d="M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 18z"/><path d="M4 4l16 16" stroke="#F0996A" stroke-width="1.8"/></svg><span>no servers · no accounts · no tracking</span></div></div></div></body></html>`;
  const img = 'file://' + path.join(SHOTS, s.shot + (fs.existsSync(path.join(SHOTS, s.shot + '.png')) ? '.png' : '.webp'));
  return head + `<div class="wrap"><div class="phone"><img src="${img}"></div><div><div class="step">${s.step} · ${s.tag}</div><h1>${s.title}</h1><p>${s.body}</p></div></div></body></html>`;
}

function duration(file) {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
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

  // Scene lengths follow the narration; scene i starts (fades in) at starts[i].
  const voFiles = scenes.map(s => (VO && s.vo && fs.existsSync(path.join(VO, s.vo + '.mp3'))) ? path.join(VO, s.vo + '.mp3') : null);
  const lens = voFiles.map(f => f ? Math.max(4.2, VO_LEAD + duration(f) + VO_TAIL) : SCENE);
  const starts = [];
  lens.reduce((t, len, i) => { starts.push(i === 0 ? 0 : t - FADE); return (i === 0 ? 0 : t - FADE) + len; }, 0);

  const total = starts[starts.length - 1] + lens[lens.length - 1];
  const args = ['-y'];
  pngs.forEach(p => args.push('-i', p)); // one still frame each; zoompan makes the scene's frames
  const audioInputs = [];
  voFiles.forEach((f, i) => { if (f) { audioInputs.push({ idx: pngs.length + audioInputs.length, at: starts[i] + VO_LEAD }); args.push('-i', f); } });

  const parts = pngs.map((_, i) => {
    const frames = Math.round(lens[i] * FPS);
    return `[${i}:v]scale=${W * 2}:${H * 2},zoompan=z='1+0.035*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS},setsar=1,format=yuv420p[v${i}]`;
  });
  let last = 'v0';
  for (let i = 1; i < pngs.length; i++) {
    parts.push(`[${last}][v${i}]xfade=transition=fade:duration=${FADE}:offset=${starts[i].toFixed(3)}[x${i}]`);
    last = `x${i}`;
  }
  const mp4 = path.join(OUT, 'how-to.mp4');
  const map = ['-map', `[${last}]`];
  // Background music: an original track written by make_music.py, ducked under the narration.
  const music = path.join(TMP, 'music.wav');
  execFileSync('python3', [path.join(__dirname, 'make_music.py'), music, (total + 0.5).toFixed(2)], { stdio: 'inherit' });
  const musicIdx = pngs.length + audioInputs.length;
  args.push('-i', music);
  parts.push(`[${musicIdx}:a]aresample=48000,aecho=0.8:0.7:60|140:0.25|0.15,loudnorm=I=-25:TP=-6,aresample=48000,atrim=0:${total.toFixed(3)}[mus]`);
  if (audioInputs.length) {
    audioInputs.forEach((a, n) => parts.push(`[${a.idx}:a]aresample=48000,adelay=${Math.round(a.at * 1000)}:all=1[a${n}]`));
    parts.push(`${audioInputs.map((_, n) => `[a${n}]`).join('')}amix=inputs=${audioInputs.length}:normalize=0,loudnorm=I=-16:TP=-1.5,aresample=48000,apad=whole_dur=${total.toFixed(3)},asplit=2[vo][key]`);
    parts.push(`[mus][key]sidechaincompress=threshold=0.02:ratio=6:attack=30:release=600[duck]`);
    parts.push(`[vo][duck]amix=inputs=2:normalize=0,alimiter=limit=0.84[aout]`);
  } else {
    parts.push(`[mus]anull[aout]`);
  }
  map.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000');
  args.push('-filter_complex', parts.join(';'), ...map, '-c:v', 'libx264', '-preset', 'slow', '-crf', '24',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', total.toFixed(3), mp4);
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
  execFileSync('ffmpeg', ['-y', '-i', pngs[0], '-frames:v', '1', '-q:v', '4', path.join(OUT, 'poster.jpg')], { stdio: 'inherit' });
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('Wrote', mp4, 'scenes', lens.map(l => l.toFixed(1)).join(' '));
})();
