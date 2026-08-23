/**
 * Unified public site for Vercel:
 *   /       → marketing promo (docs/promo)
 *   /play/  → obfuscated game (dist-protected)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist-site');
const PROMO = path.join(ROOT, 'docs', 'promo');
const GAME = path.join(ROOT, 'dist-protected');

function rm(p) {
  fs.rmSync(p, { recursive: true, force: true });
}
function mkdir(p) {
  fs.mkdirSync(p, { recursive: true });
}
function copyDir(src, dest) {
  mkdir(dest);
  for (const name of fs.readdirSync(src)) {
    if (name === '.vercel' || name === '.git') continue;
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function patchPromoPlayLinks(html) {
  return html
    .replaceAll('https://muzz-galaxy.vercel.app', '/play')
    .replaceAll('https://borincano.github.io/trash/docs/play.html', '/play')
    .replaceAll('https://borincano.github.io/trash/docs/ios-install.html', '/play/ios-install.html');
}

console.log('1) Building protected game…');
const build = spawnSync(process.execPath, [path.join(__dirname, 'build-protected.mjs')], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, MUZZ_GAME_URL: 'https://www.muzzgalaxy.com/play' },
});
if (build.status !== 0) process.exit(build.status || 1);

if (!fs.existsSync(GAME)) {
  console.error('missing dist-protected');
  process.exit(1);
}

console.log('2) Assembling dist-site…');
rm(OUT);
mkdir(OUT);

// Promo at root
copyDir(PROMO, OUT);
const promoIndex = path.join(OUT, 'index.html');
let html = fs.readFileSync(promoIndex, 'utf8');
html = patchPromoPlayLinks(html);
// Ensure relative media paths still work
fs.writeFileSync(promoIndex, html);

// Remove godaddy helper from public site root (optional keep)
try {
  fs.unlinkSync(path.join(OUT, 'godaddy-embed.html'));
} catch (_) {}

// Game under /play
copyDir(GAME, path.join(OUT, 'play'));
// Fix game SW scope / relative assets — already relative

// Root vercel config
fs.writeFileSync(
  path.join(OUT, 'vercel.json'),
  JSON.stringify(
    {
      version: 2,
      headers: [
        {
          source: '/(.*)',
          headers: [
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          ],
        },
        {
          source: '/play/sw.js',
          headers: [
            { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
            { key: 'Service-Worker-Allowed', value: '/play/' },
          ],
        },
      ],
      rewrites: [
        { source: '/play', destination: '/play/index.html' },
        { source: '/ios', destination: '/play/ios-install.html' },
      ],
    },
    null,
    2
  )
);

fs.writeFileSync(
  path.join(OUT, 'config.json'),
  JSON.stringify(
    {
      edition: 'Survivor',
      landing: '/',
      play: '/play',
      domain: 'www.muzzgalaxy.com',
    },
    null,
    2
  )
);

console.log('OK', OUT);
console.log('Deploy: npx vercel deploy dist-site --prod --yes --scope borincanoprs-projects --archive=tgz');
