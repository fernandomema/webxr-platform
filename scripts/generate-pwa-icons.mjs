// Renders the Kithin mark into the PNG icons the web app manifest needs. Run: node scripts/generate-pwa-icons.mjs
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const background = '#07070c';
const mark = await readFile(new URL('../src/lib/assets/favicon.svg', import.meta.url));

/** `fill` is how much of the square the mark takes; maskable icons keep it inside the 80% safe zone. */
async function render(size, fill, file) {
	const inner = Math.round(size * fill);
	const glyph = await sharp(mark, { density: 384 }).resize(inner, inner).png().toBuffer();
	const png = await sharp({ create: { width: size, height: size, channels: 4, background } })
		.composite([{ input: glyph, gravity: 'center' }])
		.png()
		.toBuffer();
	await writeFile(new URL(`../static/icons/${file}`, import.meta.url), png);
}

await render(192, 0.8, 'icon-192.png');
await render(512, 0.8, 'icon-512.png');
await render(512, 0.6, 'icon-512-maskable.png');
await render(180, 0.8, 'apple-touch-icon.png');

/** Branded install-dialog screenshot (narrow, so it also shows on mobile). Replace with a real capture when one exists. */
async function renderScreenshot(width, height, file) {
	const logo = await readFile(new URL('../static/assets/kithin-logo-stacked.svg', import.meta.url));
	const inner = Math.round(width * 0.6);
	const glyph = await sharp(logo, { density: 384 }).resize(inner, inner, { fit: 'inside' }).png().toBuffer();
	const png = await sharp({ create: { width, height, channels: 4, background } })
		.composite([{ input: glyph, gravity: 'center' }])
		.png()
		.toBuffer();
	await writeFile(new URL(`../static/icons/${file}`, import.meta.url), png);
}

await renderScreenshot(720, 1280, 'screenshot-narrow.png');
await renderScreenshot(1280, 720, 'screenshot-wide.png');
