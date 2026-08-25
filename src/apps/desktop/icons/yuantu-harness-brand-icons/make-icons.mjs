// YuanTu-Harness brand icon generator (Node + sharp)
// Run:  node make-icons.mjs
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIGHT = path.join(__dirname, 'assets', 'yuantu-harness.svg');
const DARK = path.join(__dirname, 'assets', 'yuantu-harness-dark.svg');

async function png(svg, size, out) {
  await sharp(svg).resize(size, size).png().toFile(out);
}
async function pngBuf(svg, size) {
  return sharp(svg).resize(size, size).png().toBuffer();
}
function ensure(dir) { fs.mkdirSync(dir, { recursive: true }); }
function write(file, buf) { ensure(path.dirname(file)); fs.writeFileSync(file, buf); }

// --- Multi-size ICO (PNG entries, Vista+) ---
function buildIco(entries) { // entries: [{size, png}]
  const count = entries.length;
  const dataOffset = 6 + 16 * count;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const dirs = [];
  let offset = dataOffset;
  for (const e of entries) {
    const d = Buffer.alloc(16);
    const dim = e.size >= 256 ? 0 : e.size;
    d.writeUInt8(dim, 0);
    d.writeUInt8(dim, 1);
    d.writeUInt8(0, 2);
    d.writeUInt8(0, 3);
    d.writeUInt16LE(1, 4);
    d.writeUInt16LE(32, 6);
    d.writeUInt32LE(e.png.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += e.png.length;
    dirs.push(d);
  }
  return Buffer.concat([header, ...dirs, ...entries.map((e) => e.png)]);
}

// --- Multi-size ICNS (PNG entries) ---
// type -> physical pixel size
const ICNS_TYPES = [
  ['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128],
  ['ic08', 256], ['ic09', 512], ['ic10', 1024],
  ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512],
];
function buildIcns(iconBySize) { // iconBySize: {size: pngBuf}
  const chunks = [];
  for (const [type, size] of ICNS_TYPES) {
    const png = iconBySize[size];
    if (!png) continue;
    const h = Buffer.alloc(8);
    h.write(type, 0, 'ascii');
    h.writeUInt32BE(png.length + 8, 4);
    chunks.push(Buffer.concat([h, png]));
  }
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

async function main() {
  // ---- favicon ----
  const fav = path.join(__dirname, 'favicon');
  ensure(fav);
  fs.copyFileSync(LIGHT, path.join(fav, 'favicon.svg'));
  const favIcoEntries = [];
  for (const s of [16, 32, 48]) {
    const b = await pngBuf(LIGHT, s);
    write(path.join(fav, `favicon-${s}.png`), b);
    favIcoEntries.push({ size: s, png: b });
  }
  write(path.join(fav, 'favicon.ico'), buildIco(favIcoEntries));

  // ---- desktop ----
  const desk = path.join(__dirname, 'desktop');
  const icon512 = await pngBuf(LIGHT, 512);
  write(path.join(desk, 'icon.png'), icon512);
  const iconIcoEntries = [];
  for (const s of [16, 24, 32, 48, 64, 128, 256]) {
    const b = await pngBuf(LIGHT, s);
    iconIcoEntries.push({ size: s, png: b });
  }
  write(path.join(desk, 'icon.ico'), buildIco(iconIcoEntries));
  // icns
  const icnsBufs = {};
  for (const [, size] of ICNS_TYPES) {
    if (!icnsBufs[size]) icnsBufs[size] = await pngBuf(LIGHT, size);
  }
  write(path.join(desk, 'icon.icns'), buildIcns(icnsBufs));

  // Linux hicolor set
  for (const s of [16, 32, 48, 64, 96, 128, 256, 512]) {
    const b = await pngBuf(LIGHT, s);
    write(path.join(desk, 'hicolor', `${s}x${s}`, 'apps', 'yuantu-harness-desktop.png'), b);
  }

  // Windows Store logo set
  for (const s of [30, 44, 71, 89, 107, 142, 150, 284, 310]) {
    const b = await pngBuf(LIGHT, s);
    write(path.join(desk, 'windows', `Square${s}x${s}Logo.png`), b);
  }
  write(path.join(desk, 'windows', 'StoreLogo.png'), await pngBuf(LIGHT, 50));

  // ---- mobile ----
  const mob = path.join(__dirname, 'mobile');
  for (const s of [128, 256, 512]) {
    write(path.join(mob, `icon-${s}.png`), await pngBuf(LIGHT, s));
  }

  // ---- installer ----
  const inst = path.join(__dirname, 'installer');
  for (const s of [128, 256, 512]) {
    write(path.join(inst, `installer-${s}.png`), await pngBuf(LIGHT, s));
  }
  const instIco = [];
  for (const s of [16, 32, 48, 256]) {
    instIco.push({ size: s, png: await pngBuf(LIGHT, s) });
  }
  write(path.join(inst, 'installer.ico'), buildIco(instIco));

  // ---- dark mode ----
  const dark = path.join(__dirname, 'dark-mode');
  ensure(dark);
  fs.copyFileSync(DARK, path.join(dark, 'logo-dark.svg'));
  write(path.join(dark, 'icon-256-dark.png'), await pngBuf(DARK, 256));
  write(path.join(dark, 'icon-512-dark.png'), await pngBuf(DARK, 512));
  write(path.join(dark, 'favicon-dark-32.png'), await pngBuf(DARK, 32));

  console.log('Brand icon kit generated.');
}

main().catch((e) => { console.error(e); process.exit(1); });
