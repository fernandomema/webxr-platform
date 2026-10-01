import sharp from 'sharp';
import type { RequestHandler } from './$types';
import { openAssetForReading } from '$lib/server/services/assets';
import { getPublishedWorldApp } from '$lib/server/services/publications';
import { describeWorldApp, parseIconName, parseScreenshotName } from '$lib/worlds/appManifest';
import { toHttpError } from '$lib/server/apiError';
import { error } from '@sveltejs/kit';

/** Maskable icons keep their picture inside the central 80% so the launcher can crop the edges. */
const MASKABLE_FILL = 0.6;

async function readAsset(assetId: string): Promise<Buffer | null> {
	try {
		// Assets of a published revision are readable without a session.
		const { stream } = await openAssetForReading(null, assetId);
		return Buffer.from(await new Response(stream).arrayBuffer());
	} catch {
		return null;
	}
}

/** `/play/<world>/icon/512.png`: the world's icon (or its thumbnail, or the Kithin mark) at the size the manifest asks for. */
export const GET: RequestHandler = async ({ params, fetch }) => {
	const wanted = parseIconName(params.name);
	const screenshot = parseScreenshotName(params.name);
	if (!wanted && !screenshot) error(404, 'Not found');
	try {
		const app = await getPublishedWorldApp(params.worldId);
		const { backgroundColor } = describeWorldApp(app.worldName, app.info);
		const source =
			(app.iconAssetId && (await readAsset(app.iconAssetId))) ||
			(app.thumbnailAssetId && (await readAsset(app.thumbnailAssetId))) ||
			(await fetch('/icons/icon-512.png').then(async (res) => (res.ok ? Buffer.from(await res.arrayBuffer()) : null)).catch(() => null));
		if (!source) error(404, 'Not found');
		const headers = { 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000, immutable' };
		if (screenshot) {
			// The world's picture on its own background, centred, as large as fits.
			const fit = Math.round(Math.min(screenshot.width, screenshot.height) * 0.6);
			const picture = await sharp(source).resize(fit, fit, { fit: 'cover' }).png().toBuffer();
			const canvas = sharp({ create: { width: screenshot.width, height: screenshot.height, channels: 4, background: backgroundColor } }).composite([{ input: picture, gravity: 'center' }]);
			return new Response(new Uint8Array(await canvas.png().toBuffer()), { headers });
		}
		const { size, maskable } = wanted!;
		const inner = Math.round(size * (maskable ? MASKABLE_FILL : 1));
		let image = sharp(source).resize(inner, inner, { fit: 'cover' });
		if (inner < size) {
			const padded = await image.png().toBuffer();
			image = sharp({ create: { width: size, height: size, channels: 4, background: backgroundColor } }).composite([{ input: padded, gravity: 'center' }]);
		}
		return new Response(new Uint8Array(await image.png().toBuffer()), { headers });
	} catch (err) {
		toHttpError(err);
	}
};
