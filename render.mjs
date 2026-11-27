import { execFile } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const OUT_FILE = join(ROOT, 'entry.png');
const TMP_FILE = join(ROOT, '.render-tmp.png');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function assertPng(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(sig)) {
    throw new Error('Rendered file is not a valid PNG.');
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width !== 1024 || height !== 1024) {
    throw new Error(`Expected 1024x1024 PNG, got ${width}x${height}.`);
  }
  return { width, height };
}

async function render() {
  const server = createServer((req, res) => {
    const reqPath = (req.url || '/').split('?')[0];
    const rel = reqPath === '/' ? 'poster.html' : reqPath.replace(/^\/+/, '');
    const full = resolve(ROOT, rel);
    if (!full.startsWith(ROOT) || !existsSync(full)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const mime = MIME_TYPES[extname(full).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
    res.end(readFileSync(full));
  });

  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const { port } = server.address();
  const targetUrl = `http://127.0.0.1:${port}/poster.html`;

  const py = [
    'from playwright.sync_api import sync_playwright',
    'with sync_playwright() as p:',
    '    b = p.chromium.launch(headless=True)',
    '    pg = b.new_page(viewport={"width": 1024, "height": 1024}, device_scale_factor=1)',
    `    pg.goto(${JSON.stringify(targetUrl)}, wait_until="load", timeout=15000)`,
    `    pg.screenshot(path=${JSON.stringify(TMP_FILE)}, full_page=False)`,
    '    b.close()',
  ].join('\n');

  try {
    await execFileAsync('python', ['-c', py], { timeout: 25000 });
  } finally {
    server.close();
  }

  const rawBuf = readFileSync(TMP_FILE);
  assertPng(rawBuf);

  // Optimize PNG compression for smaller tie-break byte size while staying lossless
  const optPy = [
    'from PIL import Image',
    `im = Image.open(${JSON.stringify(TMP_FILE)})`,
    `im.save(${JSON.stringify(OUT_FILE)}, format="PNG", optimize=True, compress_level=9)`,
  ].join('\n');
  await execFileAsync('python', ['-c', optPy], { timeout: 15000 });
  rmSync(TMP_FILE, { force: true });

  const finalBuf = readFileSync(OUT_FILE);
  const { width, height } = assertPng(finalBuf);
  console.log(`Rendered ${OUT_FILE}: ${width}x${height}, ${statSync(OUT_FILE).size} bytes`);
}

render().catch((err) => {
  console.error(err);
  process.exit(1);
});
