// Generates PLACEHOLDER brand assets (app icon, Android adaptive foreground,
// splash, web favicon) so the build pipeline references real, owned images
// instead of the generic Expo defaults (which get a store rejection).
//
// These are intentionally simple geometric placeholders drawn from the brand
// palette — REPLACE them with final artwork from a designer before launch.
// Re-run with:  node scripts/generate-placeholder-assets.mjs
//
// Pure Node + pngjs (already a transitive dep); no native canvas needed.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets');
mkdirSync(OUT, { recursive: true });

// Brand palette (src/shared/constants/theme.ts)
const NAVY = [12, 17, 46]; // #0c112e
const PERIWINKLE = [176, 198, 255]; // #b0c6ff

const lerp = (a, b, t) => Math.round(a + (b - a) * t);

/** Draw the chat-bubble monogram into a fresh canvas. */
function render(size, { background }) {
  const png = new PNG({ width: size, height: size });
  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (size * y + x) << 2;
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = a;
  };

  // Background: solid navy, or transparent (Android adaptive composites the
  // foreground over its own backgroundColor).
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (background === 'navy') set(x, y, NAVY, 255);
      else set(x, y, NAVY, 0); // transparent
    }
  }

  // Mark geometry, centered. `scale` = fraction of the canvas the mark spans.
  const scale = background === 'navy' ? 0.6 : 0.52; // tighter for adaptive safe zone
  const mw = size * scale;
  const mh = mw * 0.82;
  const cx = size / 2;
  const cy = size / 2 - mh * 0.06;
  const left = cx - mw / 2;
  const top = cy - mh / 2;
  const radius = mw * 0.26;

  const inRoundedRect = (x, y) => {
    const rx = Math.min(Math.max(x, left + radius), left + mw - radius);
    const ry = Math.min(Math.max(y, top + radius), top + mh - radius);
    if (x >= left && x <= left + mw && y >= top + radius && y <= top + mh - radius) return true;
    if (x >= left + radius && x <= left + mw - radius && y >= top && y <= top + mh) return true;
    const dx = x - rx;
    const dy = y - ry;
    return dx * dx + dy * dy <= radius * radius;
  };

  // Speech-bubble tail (small triangle off the bottom-left).
  const tailTopY = top + mh - radius * 0.2;
  const tailH = mh * 0.22;
  const tailX0 = left + mw * 0.24;
  const tailX1 = left + mw * 0.46;
  const inTail = (x, y) => {
    if (y < tailTopY || y > tailTopY + tailH) return false;
    const t = (y - tailTopY) / tailH; // 0..1 downwards
    const xr = tailX1 - (tailX1 - tailX0) * t; // converges toward tailX0
    return x >= tailX0 && x <= xr;
  };

  // Three "typing" dots inside the bubble.
  const dotR = mw * 0.066;
  const dotY = cy;
  const dotXs = [cx - mw * 0.22, cx, cx + mw * 0.22];
  const inDot = (x, y) => dotXs.some(dxc => (x - dxc) ** 2 + (y - dotY) ** 2 <= dotR * dotR);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const bubble = inRoundedRect(x, y) || inTail(x, y);
      if (!bubble) continue;
      if (inDot(x, y)) {
        set(x, y, NAVY, 255); // dots punch back to navy
      } else {
        // subtle vertical sheen on the periwinkle bubble
        const t = (y - top) / mh;
        const c = [
          lerp(PERIWINKLE[0], 255, 0.12 * (1 - t)),
          lerp(PERIWINKLE[1], 255, 0.12 * (1 - t)),
          PERIWINKLE[2],
        ];
        set(x, y, c, 255);
      }
    }
  }
  return png;
}

function write(name, size, opts) {
  const png = render(size, opts);
  const file = join(OUT, name);
  // Path is built from a fixed dir + hardcoded asset names below (no user input).
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  writeFileSync(file, PNG.sync.write(png));
  console.log(`  wrote ${name} (${size}x${size}, ${opts.background})`);
}

console.log('Generating placeholder brand assets into assets/ …');
write('icon.png', 1024, { background: 'navy' }); // iOS app icon (full bleed)
write('adaptive-icon.png', 1024, { background: 'transparent' }); // Android foreground
write('splash.png', 1024, { background: 'transparent' }); // splash logo (contain over backgroundColor)
write('favicon.png', 48, { background: 'navy' }); // web
write('notification-icon.png', 96, { background: 'transparent' }); // Android push (monochrome-ish)
console.log(
  'Done. NOTE: these are placeholders — replace with final artwork before store submission.',
);
