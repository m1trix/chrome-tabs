// Renders icons/icon.svg to the PNG sizes the manifest uses. Chrome and Edge don't accept
// SVG manifest icons, so the SVG is the source and the PNGs are generated from it.
//
//   node scripts/build-icons.mjs
//
// Uses headless Chrome or Edge (set CHROME=/path/to/browser to pick one).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SIZES = [16, 32, 48, 128];
const iconsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

const candidates = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/microsoft-edge',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const browser = candidates.find((p) => existsSync(p));
if (!browser) {
  console.error('No Chrome or Edge found. Set CHROME=/path/to/browser.');
  process.exit(1);
}

// The SVG is inlined as a data: URL so drawing it doesn't taint the canvas.
const svg = readFileSync(join(iconsDir, 'icon.svg'));
const page = `<!doctype html><pre id="out"></pre><script>
  const img = new Image();
  img.onload = () => {
    const out = {};
    for (const size of ${JSON.stringify(SIZES)}) {
      const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
      canvas.getContext('2d').drawImage(img, 0, 0, size, size);
      out[size] = canvas.toDataURL('image/png').split(',')[1];
    }
    document.getElementById('out').textContent = JSON.stringify(out);
  };
  img.src = 'data:image/svg+xml;base64,${svg.toString('base64')}';
</script>`;

const dir = mkdtempSync(join(tmpdir(), 'build-icons-'));
try {
  const htmlPath = join(dir, 'render.html');
  writeFileSync(htmlPath, page);
  const dom = execFileSync(
    browser,
    ['--headless', '--disable-gpu', '--virtual-time-budget=5000', '--dump-dom', pathToFileURL(htmlPath).href],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const json = dom.match(/<pre id="out">(.*?)<\/pre>/s)?.[1];
  if (!json) throw new Error('The browser did not render the icon.');
  for (const [size, base64] of Object.entries(JSON.parse(json))) {
    writeFileSync(join(iconsDir, `icon${size}.png`), Buffer.from(base64, 'base64'));
    console.log(`icons/icon${size}.png`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
