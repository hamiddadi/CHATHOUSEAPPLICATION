/**
 * Generates the iOS AppIcon from the code-native Chathouse brand mark.
 *
 * `graphic-eq` is paired with the Chathouse wordmark in MapTopAppBar,
 * RoomFeedScreen and RoomScreen. The geometry below is the Material Icons
 * 24-unit `graphic-eq` path already shipped through
 * @react-native-vector-icons/material-icons; the colours come from theme.ts.
 *
 * The output is deliberately RGB (PNG colour type 2): App Store icons must
 * not contain an alpha channel, even when every alpha value is opaque.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(
  ROOT,
  'ios',
  'ChatHouse',
  'Images.xcassets',
  'AppIcon.appiconset',
  'AppIcon.png',
);

const SIZE = 1024;
const NAVY = [12, 17, 46]; // theme.palette.background — #0c112e
const PERIWINKLE = [176, 198, 255]; // theme.palette.primary — #b0c6ff

const png = new PNG({ width: SIZE, height: SIZE });

const fillRect = (left, top, width, height, color) => {
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      const offset = (y * SIZE + x) * 4;
      png.data[offset] = color[0];
      png.data[offset + 1] = color[1];
      png.data[offset + 2] = color[2];
      png.data[offset + 3] = 255;
    }
  }
};

fillRect(0, 0, SIZE, SIZE, NAVY);

// Exact rectangles from Material Icons `graphic-eq` on its 24 × 24 grid:
// M7 18h2V6H7v12zm4 4h2V2h-2v20zM3 14h2v-4H3v4zm12 4h2V6h-2v12zm4-8v4h2v-4h-2z
const GRID_SCALE = 30;
const GRID_OFFSET = (SIZE - 24 * GRID_SCALE) / 2;
const bars = [
  [3, 10, 2, 4],
  [7, 6, 2, 12],
  [11, 2, 2, 20],
  [15, 6, 2, 12],
  [19, 10, 2, 4],
];

for (const [x, y, width, height] of bars) {
  fillRect(
    GRID_OFFSET + x * GRID_SCALE,
    GRID_OFFSET + y * GRID_SCALE,
    width * GRID_SCALE,
    height * GRID_SCALE,
    PERIWINKLE,
  );
}

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(
  OUTPUT,
  PNG.sync.write(png, {
    colorType: 2,
    inputColorType: 6,
    inputHasAlpha: true,
  }),
);

console.log(`Wrote RGB AppIcon: ${OUTPUT} (${SIZE}x${SIZE}, no alpha channel)`);
