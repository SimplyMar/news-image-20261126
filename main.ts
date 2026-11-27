import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IEND = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

function verifyPngPayload(bytes: Buffer): { width: number; height: number } {
  if (bytes.length === 0 || bytes.length > MAX_BYTES) {
    throw new Error(`Invalid entry.png size: ${bytes.length} bytes (limit ${MAX_BYTES})`);
  }
  if (bytes.length < 36 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('entry.png does not carry a valid PNG signature.');
  }
  if (!bytes.subarray(bytes.length - 12).equals(PNG_IEND)) {
    throw new Error('entry.png is truncated (missing IEND trailer).');
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || width > 1024 || height < 1 || height > 1024) {
    throw new Error(`Invalid PNG dimensions: ${width}x${height} (max 1024x1024)`);
  }
  return { width, height };
}

function main(): void {
  const repoDir = dirname(fileURLToPath(import.meta.url));
  const srcPath = join(repoDir, 'entry.png');
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  const outPath = join(outDir, 'entry.png');

  const payload = readFileSync(srcPath);
  verifyPngPayload(payload);

  mkdirSync(outDir, { recursive: true, mode: 0o755 });
  writeFileSync(outPath, payload, { mode: 0o644 });
  try {
    chmodSync(outPath, 0o644);
  } catch {
    // Ignore chmod errors on platforms without POSIX mode bits.
  }
}

main();
