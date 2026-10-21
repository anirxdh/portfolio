// Renders every article diagram (public/blog/diagrams/*.svg) to a raster image on the site's dark
// diagram background, for the syndicated copies of the articles.
//
// Why: the SVGs are drawn for the site's dark page. They have a transparent background and light
// grey lines and labels, so on dev.to, Hashnode or Medium (white pages) the arrows almost vanish.
// Medium also drops the diagrams on import, because the site inlines them as SVG. An image with
// the background baked in reads the same everywhere.
//
// Usage (local only; it uses the Playwright Chromium that `npm run diagrams` already uses):
//   node syndication/render-diagrams.mjs              renders new or changed diagrams (JPEG)
//   FORCE=1 node syndication/render-diagrams.mjs      renders all of them
//   node syndication/render-diagrams.mjs --png        lossless PNG instead of JPEG
//   node syndication/render-diagrams.mjs --out <dir>  writes somewhere else
// Default output: public/blog/diagrams/raster/ when that folder exists (then the images are
// deployed with the site and export.mjs links to them), otherwise syndication/diagrams/ (for
// uploading by hand, for example to Medium).
// Fonts: General Sans comes from the same CDN the site uses; offline it falls back to Helvetica.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'public', 'blog', 'diagrams');
const HOSTED = path.join(SRC, 'raster');
const LOCAL = path.join(ROOT, 'syndication', 'diagrams');
const outArg = process.argv.indexOf('--out');
const OUT = outArg > -1 ? path.resolve(process.argv[outArg + 1]) : fs.existsSync(HOSTED) ? HOSTED : LOCAL;
const FORCE = process.env.FORCE === '1';
const BG = '#0E0E10'; // mermaid "background" in scripts/blog/mermaid.json (the site's black-200)
const PAD = 32;
const MAX_WIDTH = 2000;
// JPEG: every target (dev.to, Hashnode, Medium) takes it, and it is about a third of the PNG size
// for these hatch-filled drawings. --png writes lossless PNGs instead.
const FORMAT = process.argv.includes('--png') ? 'png' : 'jpeg';
const EXT = FORMAT === 'png' ? 'png' : 'jpg';
const QUALITY = 85;

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'blog', 'puppeteer.json'), 'utf8'));
    if (cfg.executablePath && fs.existsSync(cfg.executablePath)) return cfg.executablePath;
  } catch {
    // fall through
  }
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort() : [];
  for (const d of dirs.reverse()) {
    const p = path.join(cache, d, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Chromium not found. Set CHROMIUM_PATH to a Chromium or Chrome binary.');
}

// Minimal Chrome DevTools Protocol client over one browser WebSocket (flattened sessions).
async function launch() {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-raster-'));
  const proc = spawn(
    chromiumPath(),
    ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${userDir}`, 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('Chromium did not start')), 20000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    proc.on('exit', (code) => reject(new Error(`Chromium exited (${code})`)));
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const l of [...listeners]) l(msg);
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      id += 1;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  const once = (method, sessionId) =>
    new Promise((resolve) => {
      const l = (msg) => {
        if (msg.method === method && msg.sessionId === sessionId) {
          listeners.splice(listeners.indexOf(l), 1);
          resolve(msg.params);
        }
      };
      listeners.push(l);
    });
  // Wait for Chromium to exit before deleting its profile folder (it keeps writing until then).
  const close = async () => {
    ws.close();
    const exited = new Promise((resolve) => proc.once('exit', resolve));
    proc.kill();
    await exited;
    fs.rmSync(userDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  return { send, once, close };
}

const fontFaces = fs
  .readFileSync(path.join(ROOT, 'scripts', 'blog', 'blog.css'), 'utf8')
  .split('\n')
  .filter((l) => l.startsWith('@font-face'))
  .join('\n');

function wrapper(svg) {
  const vb = /viewBox="([^"]+)"/.exec(svg);
  if (!vb) throw new Error('no viewBox');
  const [, , vw, vh] = vb[1].trim().split(/[\s,]+/).map(Number);
  const width = Math.min(MAX_WIDTH, Math.ceil(vw));
  const height = Math.ceil((width * vh) / vw);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${fontFaces}
html,body{margin:0;background:${BG}}body{padding:${PAD}px;display:inline-block}
svg{display:block;width:${width}px!important;height:${height}px!important;max-width:none!important}</style></head>
<body>${svg.replace(/<\?xml[^>]*\?>/, '')}</body></html>`;
  return { html, width: width + 2 * PAD, height: height + 2 * PAD };
}

const files = fs.existsSync(SRC) ? fs.readdirSync(SRC).filter((f) => f.endsWith('.svg')).sort() : [];
const todo = files.filter((f) => {
  const out = path.join(OUT, f.replace(/\.svg$/, `.${EXT}`));
  return FORCE || !fs.existsSync(out) || fs.statSync(out).mtimeMs < fs.statSync(path.join(SRC, f)).mtimeMs;
});
if (!todo.length) {
  console.log(`[diagram-images] ${files.length} diagram(s), all up to date in ${path.relative(ROOT, OUT)}/`);
  process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-html-'));
const cdp = await launch();
let failed = 0;
try {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  for (const f of todo) {
    const name = f.replace(/\.svg$/, '');
    try {
      const { html, width, height } = wrapper(fs.readFileSync(path.join(SRC, f), 'utf8'));
      const file = path.join(tmp, `${name}.html`);
      fs.writeFileSync(file, html);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
      const loaded = cdp.once('Page.loadEventFired', sessionId);
      await cdp.send('Page.navigate', { url: pathToFileURL(file).href }, sessionId);
      await loaded;
      await cdp.send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true }, sessionId);
      const shot = await cdp.send(
        'Page.captureScreenshot',
        { format: FORMAT, ...(FORMAT === 'jpeg' ? { quality: QUALITY } : {}), clip: { x: 0, y: 0, width, height, scale: 1 }, captureBeyondViewport: true },
        sessionId,
      );
      const dest = path.join(OUT, `${name}.${EXT}`);
      fs.writeFileSync(dest, Buffer.from(shot.data, 'base64'));
      console.log(`rendered ${path.relative(ROOT, dest)} (${width}x${height})`);
    } catch (e) {
      failed += 1;
      console.error(`FAILED  ${f}: ${e.message}`);
    }
  }
} finally {
  await cdp.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`[diagram-images] ${todo.length - failed} rendered, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
