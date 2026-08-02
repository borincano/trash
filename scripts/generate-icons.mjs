import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const src = path.join(root, 'icons', 'source.jpg');
const wwwIcons = path.join(root, 'www', 'icons');
const resAndroid = path.join(root, 'android-icons');

fs.mkdirSync(wwwIcons, { recursive: true });
fs.mkdirSync(resAndroid, { recursive: true });

async function makePng(size, out, rounded = false) {
  let img = sharp(src).resize(size, size, { fit: 'cover' });
  if (rounded) {
    const r = Math.round(size * 0.22);
    const svg = Buffer.from(
      `<svg width="${size}" height="${size}"><rect x="0" y="0" width="${size}" height="${size}" rx="${r}" ry="${r}"/></svg>`
    );
    img = img.composite([{ input: svg, blend: 'dest-in' }]);
  }
  await img.png().toFile(out);
  console.log('wrote', out);
}

async function main() {
  // PWA / web
  for (const s of [48, 72, 96, 128, 144, 152, 180, 192, 256, 384, 512]) {
    await makePng(s, path.join(wwwIcons, `icon-${s}.png`), true);
  }
  await makePng(512, path.join(wwwIcons, 'icon-512-maskable.png'), false);
  await makePng(180, path.join(wwwIcons, 'apple-touch-icon.png'), true);
  await makePng(32, path.join(wwwIcons, 'favicon-32.png'), true);
  await makePng(16, path.join(wwwIcons, 'favicon-16.png'), true);
  // master
  await makePng(1024, path.join(root, 'icons', 'icon-1024.png'), false);
  await makePng(512, path.join(root, 'icons', 'icon-512.png'), true);

  // Android mipmap densities (legacy launcher)
  const dens = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192,
  };
  for (const [folder, size] of Object.entries(dens)) {
    const dir = path.join(resAndroid, folder);
    fs.mkdirSync(dir, { recursive: true });
    await makePng(size, path.join(dir, 'ic_launcher.png'), true);
    await makePng(size, path.join(dir, 'ic_launcher_round.png'), true);
    // foreground for adaptive (safe zone ~66%)
    const fg = Math.round(size * 1.5);
    await sharp(src)
      .resize(fg, fg, { fit: 'cover' })
      .extend({
        top: Math.round(size * 0.25),
        bottom: Math.round(size * 0.25),
        left: Math.round(size * 0.25),
        right: Math.round(size * 0.25),
        background: { r: 4, g: 4, b: 12, alpha: 1 },
      })
      .resize(size * 2, size * 2)
      .png()
      .toFile(path.join(dir, 'ic_launcher_foreground.png'));
  }

  // Play store
  await makePng(512, path.join(root, 'icons', 'playstore-icon.png'), false);
  console.log('All icons generated.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
