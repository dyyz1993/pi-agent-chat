#!/usr/bin/env node
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BG_COLOR = { r: 3, g: 7, b: 18 };
const ICON_PATH = join(__dirname, '../src/mainview/public/icons/icon-512.png');
const OUTPUT_DIR = join(__dirname, '../src/mainview/public/splash');

const splashImages = [
  { file: 'splash-2048x2732.png', width: 2048, height: 2732, device: 'iPad Pro 12.9"' },
  { file: 'splash-1668x2388.png', width: 1668, height: 2388, device: 'iPad Pro 11"' },
  { file: 'splash-1536x2048.png', width: 1536, height: 2048, device: 'iPad Air/Mini' },
  { file: 'splash-1125x2436.png', width: 1125, height: 2436, device: 'iPhone X/XS/11 Pro' },
  { file: 'splash-1242x2688.png', width: 1242, height: 2688, device: 'iPhone XS Max/11 Pro Max' },
  { file: 'splash-828x1792.png', width: 828, height: 1792, device: 'iPhone XR/11' },
  { file: 'splash-1242x2208.png', width: 1242, height: 2208, device: 'iPhone 6/7/8 Plus' },
  { file: 'splash-750x1334.png', width: 750, height: 1334, device: 'iPhone 6/7/8' },
  { file: 'splash-1170x2532.png', width: 1170, height: 2532, device: 'iPhone 12/12 Pro/13/13 Pro/14' },
];

async function generateSplashImages() {
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const iconBuffer = await sharp(ICON_PATH).png().toBuffer();

  for (const { file, width, height, device } of splashImages) {
    const shorter = Math.min(width, height);
    const iconSize = Math.round(shorter * 0.3);

    const resizedIcon = await sharp(iconBuffer)
      .resize(iconSize, iconSize)
      .png()
      .toBuffer();

    const x = Math.round((width - iconSize) / 2);
    const y = Math.round((height - iconSize) / 2);

    const outputPath = join(OUTPUT_DIR, file);

    await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: BG_COLOR,
      },
    })
      .composite([{ input: resizedIcon, left: x, top: y }])
      .png()
      .toFile(outputPath);

    console.log(`✓ ${file} (${width}x${height}) — ${device}`);
  }

  console.log('Done!');
}

generateSplashImages();
