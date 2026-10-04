// Draws the app's icons into public/icons/: the SVG (the favicon), and the PNGs the manifest
// (app/manifest.ts) and the notifications (public/sw.js) use. Run it after changing the drawing:
//
//   node scripts/icons.ts
//
// sharp comes with Next.js (it optimises images), so nothing else is installed; no service online.
// The picture: a briefcase in the brand's blue (--brand in app/globals.css).

import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const BRAND = '#2f5bd3';
const OUT = new URL('../public/icons/', import.meta.url);

/** The briefcase on a 512 × 512 canvas, in `color`; the gap across its body shows what's behind. */
const briefcase = (color: string) => `
  <path d="M196 168V140a24 24 0 0 1 24-24h72a24 24 0 0 1 24 24v28" fill="none" stroke="${color}" stroke-width="28"/>
  <path d="M148 168h216a36 36 0 0 1 36 36v46H112v-46a36 36 0 0 1 36-36z" fill="${color}"/>
  <path d="M112 272h288v76a36 36 0 0 1-36 36H148a36 36 0 0 1-36-36z" fill="${color}"/>`;

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}</svg>`;

/** a rounded tile: the favicon and the plain icon */
const icon = svg(`<rect width="512" height="512" rx="112" fill="${BRAND}"/>${briefcase('#fff')}`);
/** full bleed, the briefcase inside the middle 80 % (Android crops a maskable icon to its own shape) */
const maskable = svg(
  `<rect width="512" height="512" fill="${BRAND}"/><g transform="translate(256 256) scale(0.8) translate(-256 -256)">${briefcase('#fff')}</g>`,
);
/** the status bar's small icon: Android draws only its shape, so white on nothing */
const badge = svg(`<g transform="translate(256 256) scale(1.2) translate(-256 -256)">${briefcase('#fff')}</g>`);

mkdirSync(OUT, { recursive: true });
writeFileSync(new URL('icon.svg', OUT), `${icon}\n`);
const png = (source: string, size: number, name: string) =>
  sharp(Buffer.from(source)).resize(size, size).png({ compressionLevel: 9 }).toFile(new URL(name, OUT).pathname);
await Promise.all([
  png(icon, 192, 'icon-192.png'),
  png(icon, 512, 'icon-512.png'),
  png(maskable, 192, 'maskable-192.png'),
  png(maskable, 512, 'maskable-512.png'),
  png(badge, 96, 'badge-96.png'),
]);
console.log('public/icons/: icon.svg, icon-192.png, icon-512.png, maskable-192.png, maskable-512.png, badge-96.png');
