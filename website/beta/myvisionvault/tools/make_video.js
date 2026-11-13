// Builds the how-to video (assets/video/how-to.mp4) and its poster from the real app screenshots.
// Needs: Node, Playwright with Chromium, ffmpeg.  Run from the repo root:
//   node website/beta/myvisionvault/tools/make_video.js <screenshot folder> [narration folder | -] [music.wav]
// Screenshots come from tools/capture_shots.js (full-size PNGs named like the `shot` keys below).
// The narration folder holds one MP3 per scene, named by the scene's `vo` key (00.mp3, 01.mp3, ...,
// ta.mp3, tb.mp3, tc.mp3, outro.mp3); each scene is stretched to fit its line. Scenes without a file
// keep the default length and show their caption only. The music (tools/make_music.py) plays under
// everything, ducks while the narration speaks and fades out at the end.
// Each scene is an HTML slide (site fonts and colors) saved as a PNG, joined by ffmpeg with a slow zoom
// and crossfades; narration lines are placed at the start of their scenes.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SITE = path.resolve(__dirname, '..');
const SHOTS = path.resolve(process.argv[2] || path.join(SITE, 'assets/shots'));
const VO = process.argv[3] && process.argv[3] !== '-' ? path.resolve(process.argv[3]) : null;
const MUSIC = process.argv[4] ? path.resolve(process.argv[4]) : null;
const OUT = path.join(SITE, 'assets/video');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pvv-video-'));
const W = 1920, H = 1080, FPS = 30, SCENE = 5.5, FADE = 0.6, VO_LEAD = 0.5, VO_TAIL = 0.9;

const scenes = [
  { kind: 'title', vo: '00' },
  { vo: '01', shot: '01-welcome', step: '01', tag: 'Start', title: 'Open the app.<br>No sign-up.', body: 'No account, no email. Your vault is created on this phone.' },
  { vo: '02', shot: '02-create-pin', step: '02', tag: 'Lock', title: 'Choose a PIN<br>or a pattern.', body: 'At least 4 digits, and 10 or more is safer. Nobody can reset it, so pick one you will remember.' },
  { vo: 'bk', shot: '03-backup', step: '03', tag: 'Backup', title: 'Turn on the<br><em>encrypted backup.</em>', body: 'Pick a folder such as iCloud Drive and keep your recovery key safe. Only that key can open the backup.' },
  { vo: '03', shot: '04-import', step: '04', tag: 'Import', title: 'Bring photos in.', body: 'Each item is copied in, encrypted, then checked. Your originals stay in your gallery.' },
  { vo: '04', shot: '05-home', step: '05', tag: 'Your vault', title: 'Everything stays<br>on this phone.', body: 'Photos and videos, encrypted on the device, with the newest ones up front.' },
  { vo: 'gl', shot: '06-gallery', step: '06', tag: 'Gallery', title: 'Browse it all,<br>full screen.', body: 'Every photo by month, edge to edge, with larger or smaller tiles.' },
  { vo: 'sr', shot: '07-search', step: '07', tag: 'Search', title: 'Find a photo<br><em>by what is in it.</em>', body: 'Type a word from a receipt or a note, or what a photo shows. Searched on this phone only, with no internet.' },
  { vo: '06', shot: '08-viewer-text', step: '08', tag: 'View', title: 'Look, but only<br>in here.', body: 'Read the text in a photo and copy what you need. There is no share or export button.' },
  { vo: '05', shot: '09-videos', step: '09', tag: 'Camera', title: 'Shoot straight<br>into the vault.', body: 'Tap the camera button. What you capture never goes to your photo library.' },
  { vo: 'ta', kind: 'tech-keys' },
  { vo: 'tb', kind: 'tech-files' },
  { vo: 'tc', kind: 'tech-network' },
  { vo: '07', shot: '10-settings', step: '10', tag: 'Check', title: 'Your protection<br>at a glance.', body: 'Settings shows what guards your vault. It locks the moment you leave the app.' },
  { vo: '08', shot: '11-unlock', step: '11', tag: 'Return', title: 'Come back with<br>your PIN.', body: 'Wrong tries make you wait, but never erase your photos. Never share your PIN with anyone.' },
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
  if (s.kind === 'tech-network') return head + `<div class="tech"><div><div class="step">Technology · 3</div><h1 style="margin-top:22px">Nothing goes <em>to us.</em></h1></div>
    <div class="net"><div class="mini">${lock}</div><div class="wifi"><span>your own Wi-Fi · encrypted</span><div class="link"></div><span>moving to a new phone</span></div><div class="mini">${lock}</div>
      <div class="cloud"><svg viewBox="0 0 24 24" fill="none" stroke="#C9A66B" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><rect x="9.5" y="12" width="5" height="4" rx=".8"/><path d="M10.5 12v-1a1.5 1.5 0 0 1 3 0v1"/></svg><span style="color:#F7E6BE">your backup folder</span><span>encrypted · opens only with your recovery key</span></div></div>
    <div class="chips"><span class="chip">no servers</span><span class="chip">no accounts</span><span class="chip">no tracking</span><span class="chip">nothing is sent to us</span></div></div></body></html>`;
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
  const musicIdx = MUSIC ? pngs.length + audioInputs.length : -1;
  if (MUSIC) args.push('-i', MUSIC);

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
  const T = total.toFixed(3);
  if (audioInputs.length || MUSIC) {
    if (audioInputs.length) {
      audioInputs.forEach((a, n) => parts.push(`[${a.idx}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(a.at * 1000)}:all=1[a${n}]`));
      parts.push(`${audioInputs.map((_, n) => `[a${n}]`).join('')}amix=inputs=${audioInputs.length}:normalize=0,apad=whole_dur=${T}${MUSIC ? '[vo]' : ',loudnorm=I=-16:TP=-1.5[aout]'}`);
    }
    if (MUSIC) {
      // The music sits well under the voice and dips further while she speaks.
      parts.push(`[${musicIdx}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${T},apad=whole_dur=${T},volume=0.16,afade=t=in:d=1.5,afade=t=out:st=${(total - 3.5).toFixed(3)}:d=3.5[mus]`);
      if (audioInputs.length) {
        parts.push('[vo]asplit=2[vo1][vo2]', '[mus][vo2]sidechaincompress=threshold=0.03:ratio=5:attack=60:release=700[duck]',
          `[vo1][duck]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,atrim=0:${T}[aout]`);
      } else parts.push('[mus]loudnorm=I=-18:TP=-1.5[aout]');
    }
    map.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000');
  } else {
    map.push('-an');
  }
  args.push('-filter_complex', parts.join(';'), ...map, '-c:v', 'libx264', '-preset', 'slow', '-crf', '24',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', total.toFixed(3), mp4);
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
  execFileSync('ffmpeg', ['-y', '-i', pngs[0], '-frames:v', '1', '-update', '1', '-q:v', '4', path.join(OUT, 'poster.jpg')], { stdio: 'inherit' });
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('Wrote', mp4, 'scenes', lens.map(l => l.toFixed(1)).join(' '));
})();
