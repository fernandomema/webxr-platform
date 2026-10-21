import type { ImageManifest } from '../manifest.ts';
import { AssetImportError, type AssetKindDef } from './types.ts';

/**
 * Small raster images, PNG or WebP. Today they are the previews of inventory items, but the kind is general: anything
 * that needs a picture (a texture, a sign) can reference one the same way as a model or a sound.
 * Only the header is read (no decoding), so the width and height are what the file declares.
 */

const MAX_BYTES = 6 * 1024 * 1024;
const MAX_SIDE = 4096;
/** A 4096 × 4096 picture: the two eyes of a stereo 360° preview, one above the other. */
const MAX_PIXELS = 4096 * 4096;

const ascii = (bytes: Uint8Array, at: number, text: string) => {
	if (at + text.length > bytes.byteLength) return false;
	for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
	return true;
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const isPng = (bytes: Uint8Array) => bytes.byteLength >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
const isWebp = (bytes: Uint8Array) => ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP');

function pngSize(bytes: Uint8Array): { width: number; height: number } {
	if (bytes.byteLength < 24 || !ascii(bytes, 12, 'IHDR')) throw new AssetImportError('not-image', 'This PNG has no readable header.');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

function webpSize(bytes: Uint8Array): { width: number; height: number } {
	const unreadable = new AssetImportError('not-image', 'This WebP has no readable header.');
	if (bytes.byteLength < 30) throw unreadable;
	if (ascii(bytes, 12, 'VP8X')) {
		// Canvas size, 24 bits each, stored minus one.
		return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) };
	}
	if (ascii(bytes, 12, 'VP8L') && bytes[20] === 0x2f) {
		const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
		return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
	}
	if (ascii(bytes, 12, 'VP8 ') && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
		return { width: (bytes[26] | (bytes[27] << 8)) & 0x3fff, height: (bytes[28] | (bytes[29] << 8)) & 0x3fff };
	}
	throw unreadable;
}

export const imageKind: AssetKindDef<ImageManifest> = {
	type: 'image',
	label: 'Images',
	defaultName: 'Image',
	formats: [
		{ format: 'png', extensions: ['.png'], mimeType: 'image/png' },
		{ format: 'webp', extensions: ['.webp'], mimeType: 'image/webp' }
	],
	maxBytes: MAX_BYTES,
	headBytes: 12,
	sniff(head) {
		if (isPng(head)) return 'png';
		if (isWebp(head)) return 'webp';
		return null;
	},
	analyze(bytes, _fileName) {
		if (bytes.byteLength > MAX_BYTES) {
			throw new AssetImportError('too-large', `The image is ${(bytes.byteLength / 1048576).toFixed(1)} MB; the limit is ${(MAX_BYTES / 1048576).toFixed(0)} MB.`);
		}
		const format = imageKind.sniff(bytes) as ImageManifest['format'] | null;
		if (!format) throw new AssetImportError('not-image', 'This is not a supported image (.png or .webp).');
		const { width, height } = format === 'png' ? pngSize(bytes) : webpSize(bytes);
		if (!(width >= 1 && height >= 1) || width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
			throw new AssetImportError('too-large', `The image is ${width}×${height}; the limit is ${MAX_SIDE}×${MAX_SIDE}.`);
		}
		return { format, width, height };
	},
	validate(m) {
		for (const key of ['width', 'height'] as const) {
			const value = m[key];
			if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_SIDE) throw new Error(`Invalid image ${key}`);
		}
		if ((m.width as number) * (m.height as number) > MAX_PIXELS) throw new Error('The image has too many pixels');
	},
	summary: (m) => ({ width: m.width, height: m.height })
};
