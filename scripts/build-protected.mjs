/**
 * Build a harder-to-copy (NOT secret) web bundle for Vercel.
 * Client JS always reaches the browser — obfuscation only raises the bar.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { minify as minifyHtml } from 'html-minifier-terser';
import { minify as minifyJs } from 'terser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'www');
const OUT = path.join(ROOT, 'dist-protected');

const GAME_PUBLIC_URL =
  process.env.MUZZ_GAME_URL || 'https://muzz-galaxy.vercel.app';

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function copyFile(rel) {
  const from = path.join(SRC, rel);
  const to = path.join(OUT, rel);
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
}

function copyDir(rel) {
  const from = path.join(SRC, rel);
  if (!fs.existsSync(from)) return;
  for (const name of fs.readdirSync(from)) {
    const p = path.join(from, name);
    const r = path.join(rel, name);
    if (fs.statSync(p).isDirectory()) copyDir(r);
    else copyFile(r);
  }
}

function obfuscate(code, level = 'game') {
  const compact = JavaScriptObfuscator.obfuscate(code, {
    compact: true,
    controlFlowFlattening: level === 'game',
    controlFlowFlatteningThreshold: 0.35,
    deadCodeInjection: false,
    debugProtection: false,
    disableConsoleOutput: false,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    selfDefending: false,
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 6,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.75,
    transformObjectKeys: false,
    unicodeEscapeSequence: false,
    // Keep PeerJS / Firebase / DOM working
    reservedNames: ['^Peer$', '^Meta$', '^Online$', '^Game$', '^Engine$', '^GS$'],
  }).getObfuscatedCode();
  return compact;
}

async function processOnlineJs() {
  const raw = fs.readFileSync(path.join(SRC, 'online.js'), 'utf8');
  const min = await minifyJs(raw, { compress: true, mangle: true, module: false });
  const code = obfuscate(min.code || raw, 'net');
  fs.writeFileSync(path.join(OUT, 'online.js'), code);
}

async function processIndexHtml() {
  let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');

  // Obfuscate inline <script> blocks (no src)
  const parts = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let last = 0;
  let m;
  while ((m = re.exec(html))) {
    parts.push(html.slice(last, m.index));
    const attrs = m[1] || '';
    const body = m[2] || '';
    if (/\bsrc\s*=/.test(attrs) || !body.trim()) {
      parts.push(m[0]);
    } else {
      let next = body;
      try {
        const min = await minifyJs(body, { compress: true, mangle: true });
        next = obfuscate(min.code || body, 'game');
      } catch (e) {
        console.warn('inline script obfuscate fallback:', e.message);
        next = obfuscate(body, 'game');
      }
      parts.push(`<script${attrs}>${next}</script>`);
    }
    last = m.index + m[0].length;
  }
  parts.push(html.slice(last));
  html = parts.join('');

  // Point SW to hashed-ish cache name already in source; strip helpful comments lightly via minify
  html = await minifyHtml(html, {
    collapseWhitespace: true,
    removeComments: true,
    removeRedundantAttributes: true,
    removeScriptTypeAttributes: true,
    minifyCSS: true,
    minifyJS: false, // already obfuscated
    ignoreCustomFragments: [/<\?[\s\S]*?\?>/],
  });

  fs.writeFileSync(path.join(OUT, 'index.html'), html);
}

function writeConfig() {
  const cfg = {
    edition: 'Survivor',
    gameUrl: GAME_PUBLIC_URL,
    playPath: '/',
    platforms: { web: true, ios: false, android: false },
    note: 'Public config only. Obfuscation is not encryption — browser still executes JS.',
  };
  fs.writeFileSync(path.join(OUT, 'config.json'), JSON.stringify(cfg));
}

function writeVercel() {
  const cfg = {
    version: 2,
    headers: [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/(index.html|online.js|config.json|manifest.webmanifest)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
      },
    ],
    rewrites: [
      { source: '/play', destination: '/index.html' },
      { source: '/ios', destination: '/ios-install.html' },
    ],
  };
  fs.writeFileSync(path.join(OUT, 'vercel.json'), JSON.stringify(cfg, null, 2));
}

async function main() {
  console.log('Building protected web bundle → dist-protected/');
  fs.rmSync(OUT, { recursive: true, force: true });
  ensureDir(OUT);

  copyDir('icons');
  for (const f of ['manifest.webmanifest', 'sw.js', 'ios-install.html', 'vercel.json']) {
    if (fs.existsSync(path.join(SRC, f))) copyFile(f);
  }

  await processOnlineJs();
  await processIndexHtml();
  writeConfig();
  writeVercel();

  console.log('OK', OUT);
  console.log('Public game URL hint:', GAME_PUBLIC_URL);
  console.log('Deploy: npx vercel deploy dist-protected --prod --yes');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
