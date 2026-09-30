import type { AbstractEngine } from '@babylonjs/core';
import type { SlotTree } from '$lib/ecs/types';
import type { AssetId } from '$lib/assets/ref';
import type { AssetResolver } from '$lib/assets/resolve';
import { importAsset } from '$lib/assets/importAsset';
import { getLocalAssetStore } from '$lib/assets/store';
import type { InventoryKind } from '$lib/inventory/types';
import { renderObjectThumbnail, renderWorldPanorama, type RenderOptions } from './renderThumbnail';

/**
 * The one way the app makes a preview for an inventory item: render it, and keep the picture as an `image` asset in the
 * on-device store. What happens to it after that (staying local, or going to the cloud with a cloud item) is up to
 * the inventory that saves the item.
 */

interface ThumbnailConfig {
	/** In the game: the running engine, so previews are drawn as a second scene on it. */
	engine?: AbstractEngine;
	getResolvers?: () => AssetResolver[];
}

let config: ThumbnailConfig = {};

export function configureThumbnails(next: ThumbnailConfig): void {
	config = next;
}

const CAPTURE_TIMEOUT_MS = 8000;

/**
 * A preview of the item, stored as an asset, or null if none could be made. It never throws and never takes long: a preview
 * is a nicety that must not stand between a player and saving what they built.
 */
export async function captureItemThumbnail(
	tree: SlotTree,
	kind: InventoryKind,
	options: { name?: string; getResolvers?: () => AssetResolver[] } = {}
): Promise<AssetId | null> {
	const signal = { cancelled: false };
	const render: RenderOptions = { engine: config.engine, getResolvers: options.getResolvers ?? config.getResolvers, signal };
	try {
		const work = kind === 'world' ? renderWorldPanorama(tree, render) : renderObjectThumbnail(tree, kind, render);
		const blob = await Promise.race([work, new Promise<null>((resolve) => setTimeout(() => resolve(null), CAPTURE_TIMEOUT_MS))]);
		if (!blob) {
			signal.cancelled = true;
			return null;
		}
		const { manifest } = await importAsset(new Uint8Array(await blob.arrayBuffer()), options.name ? `${options.name} preview` : 'Preview', getLocalAssetStore(), { type: 'image' });
		return manifest.assetId;
	} catch (error) {
		signal.cancelled = true;
		console.warn('[thumbnail] could not make a preview', error);
		return null;
	}
}
