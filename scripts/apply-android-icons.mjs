import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const srcRoot = path.join(root, 'android-icons');
const resRoot = path.join(root, 'android', 'app', 'src', 'main', 'res');

if (!fs.existsSync(resRoot)) {
  console.error('Android project not found. Run: npx cap add android');
  process.exit(1);
}

const dens = ['mipmap-mdpi', 'mipmap-hdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi'];
for (const d of dens) {
  const from = path.join(srcRoot, d);
  const to = path.join(resRoot, d);
  if (!fs.existsSync(from)) continue;
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    fs.copyFileSync(path.join(from, f), path.join(to, f));
  }
  console.log('icons ->', d);
}

// colors for adaptive icon background
const values = path.join(resRoot, 'values');
fs.mkdirSync(values, { recursive: true });
const colorsPath = path.join(values, 'ic_launcher_background.xml');
// Prefer colors.xml entry
const colorsXml = path.join(values, 'colors.xml');
if (fs.existsSync(colorsXml)) {
  let xml = fs.readFileSync(colorsXml, 'utf8');
  if (!xml.includes('muzz_launcher_bg')) {
    xml = xml.replace(
      '</resources>',
      '    <color name="muzz_launcher_bg">#04040C</color>\n</resources>'
    );
    fs.writeFileSync(colorsXml, xml);
  }
} else {
  fs.writeFileSync(
    colorsXml,
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="muzz_launcher_bg">#04040C</color>\n    <color name="colorPrimary">#00E8FF</color>\n    <color name="colorPrimaryDark">#04040C</color>\n    <color name="colorAccent">#FF2D9B</color>\n</resources>\n`
  );
}

console.log('Android icons applied.');
