/**
 * Re-encodes an image as WebP, smaller and capped in size. It is the image step of the content optimizer (see
 * docs/content-optimization-plan.md) and is reused wherever the Studio brings a picture in, such as the AI's textures.
 */
export interface ImageOptimizeOptions {
	/** The longest side allowed; a bigger image is scaled down, a smaller one is never enlarged. */
	maxSide: number;
	/** WebP quality, 0 to 1. */
	quality: number;
}

/** Presets for the maps of a PBR material. Normals keep more precision, since an error there shows as a bump that is not there. */
export const TEXTURE_PRESETS = {
	albedo: { maxSide: 2048, quality: 0.82 },
	normal: { maxSide: 2048, quality: 0.92 },
	arm: { maxSide: 2048, quality: 0.88 },
	/** Parallax draws the height map at 1024 pixels at most. */
	height: { maxSide: 1024, quality: 0.88 }
} as const satisfies Record<string, ImageOptimizeOptions>;

/** The size an image gets: scaled to fit `maxSide`, keeping its proportions, never enlarged. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
	const scale = Math.min(1, maxSide / Math.max(width, height));
	return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export interface OptimizedImage {
	bytes: Uint8Array;
	/** `image/webp`, or `image/png` in a browser that can not encode WebP. */
	mimeType: string;
	width: number;
	height: number;
}

/**
 * Decodes with no colour conversion (the maps carry data, such as roughness, that must not be touched), draws at the final size
 * and encodes. Runs in the browser.
 */
export async function optimizeImage(source: Uint8Array, options: ImageOptimizeOptions): Promise<OptimizedImage> {
	const bitmap = await createImageBitmap(new Blob([source as BlobPart]), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
	try {
		const { width, height } = fitWithin(bitmap.width, bitmap.height, options.maxSide);
		let blob: Blob | null;
		if (typeof OffscreenCanvas !== 'undefined') {
			const canvas = new OffscreenCanvas(width, height);
			canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
			blob = await canvas.convertToBlob({ type: 'image/webp', quality: options.quality });
		} else {
			const canvas = document.createElement('canvas');
			canvas.width = width; canvas.height = height;
			canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
			blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', options.quality));
		}
		if (!blob) throw new Error('The browser could not encode the image.');
		return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: blob.type || 'image/png', width, height };
	} finally {
		bitmap.close();
	}
}

/**
 * Occlusion, roughness and metallic maps packed into one picture: R = occlusion, G = roughness, B = metallic. Each source is the
 * RGBA pixels of a grey map at the same size (only its red channel is read). A map that is missing takes a neutral value: no
 * occlusion, fully rough, not metallic.
 */
export function packArmPixels(sources: { ao?: Uint8ClampedArray; roughness?: Uint8ClampedArray; metallic?: Uint8ClampedArray }, pixelCount: number): Uint8ClampedArray {
	const out = new Uint8ClampedArray(pixelCount * 4);
	for (let i = 0; i < pixelCount; i++) {
		out[i * 4] = sources.ao ? sources.ao[i * 4] : 255;
		out[i * 4 + 1] = sources.roughness ? sources.roughness[i * 4] : 255;
		out[i * 4 + 2] = sources.metallic ? sources.metallic[i * 4] : 0;
		out[i * 4 + 3] = 255;
	}
	return out;
}

async function pixelsOf(bytes: Uint8Array, width: number, height: number): Promise<Uint8ClampedArray> {
	const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
	try {
		const canvas = new OffscreenCanvas(width, height);
		const context = canvas.getContext('2d', { willReadFrequently: true })!;
		context.drawImage(bitmap, 0, 0, width, height);
		return context.getImageData(0, 0, width, height).data;
	} finally { bitmap.close(); }
}

/** Runs in the browser: decodes the separate maps at the size of the largest, packs them and encodes the ARM picture. */
export async function packArmMaps(maps: { ao?: Uint8Array; roughness?: Uint8Array; metallic?: Uint8Array }, options: ImageOptimizeOptions): Promise<OptimizedImage> {
	const present = Object.values(maps).filter((bytes): bytes is Uint8Array => Boolean(bytes));
	if (!present.length) throw new Error('There are no maps to pack.');
	const sizes = await Promise.all(present.map(async (bytes) => { const bitmap = await createImageBitmap(new Blob([bytes as BlobPart])); const size = { width: bitmap.width, height: bitmap.height }; bitmap.close(); return size; }));
	const { width, height } = fitWithin(Math.max(...sizes.map((size) => size.width)), Math.max(...sizes.map((size) => size.height)), options.maxSide);
	const decoded: Record<string, Uint8ClampedArray> = {};
	for (const key of ['ao', 'roughness', 'metallic'] as const) if (maps[key]) decoded[key] = await pixelsOf(maps[key]!, width, height);
	const canvas = new OffscreenCanvas(width, height);
	canvas.getContext('2d')!.putImageData(new ImageData(packArmPixels(decoded, width * height) as ImageDataArray, width, height), 0, 0);
	const blob = await canvas.convertToBlob({ type: 'image/webp', quality: options.quality });
	return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: blob.type || 'image/png', width, height };
}

/** For a picture that is not a map of a material: smaller, still sharp. */
export const PICTURE_PRESET: ImageOptimizeOptions = { maxSide: 2048, quality: 0.82 };
