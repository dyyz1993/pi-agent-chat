#!/usr/bin/env node
/**
 * Generate PWA icons from SVG using sharp
 * Run: node scripts/generate-icons.js
 */

import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync, writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sizes = [16, 32, 72, 96, 128, 144, 152, 167, 180, 192, 512];
const svgPath = join(__dirname, '../src/mainview/assets/icon.svg');
const outputDir = join(__dirname, '../src/mainview/public/icons');

// Ensure output directory exists
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

// SVG content as fallback if file doesn't exist
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#4F46E5"/>
      <stop offset="100%" style="stop-color:#7C3AED"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="96" fill="url(#bgGrad)"/>
  <g transform="translate(256, 256)">
    <path d="M-80 -80 L-80 100 Q-80 130 -50 130 L-30 130" stroke="white" stroke-width="36" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="M80 -80 L80 100 Q80 130 50 130 L30 130" stroke="white" stroke-width="36" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="M-95 -80 L95 -80" stroke="white" stroke-width="36" stroke-linecap="round" fill="none"/>
    <circle cx="20" cy="50" r="16" fill="#818CF8" opacity="0.9"/>
    <circle cx="60" cy="20" r="10" fill="#A78BFA" opacity="0.7"/>
  </g>
</svg>`;

async function generateIcons() {
  console.log('Generating PWA icons...');

  for (const size of sizes) {
    const outputPath = join(outputDir, `icon-${size}.png`);

    try {
      await sharp(svgPath)
        .resize(size, size)
        .png()
        .toFile(outputPath);

      console.log(`✓ Generated ${size}x${size} -> ${outputPath}`);
    } catch (err) {
      // If sharp fails (e.g., SVG not found), try with buffer
      try {
        await sharp(Buffer.from(svgContent))
          .resize(size, size)
          .png()
          .toFile(outputPath);

        console.log(`✓ Generated ${size}x${size} (from buffer) -> ${outputPath}`);
      } catch (err2) {
        console.error(`✗ Failed to generate ${size}x${size}:`, err2.message);
      }
    }
  }

  console.log('Done!');
}

generateIcons();
