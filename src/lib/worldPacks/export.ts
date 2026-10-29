import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importAsset } from '@kithin/engine/assets/importAsset';
import { MemoryAssetStore } from '@kithin/engine/assets/store';
import { exportContainer } from '@kithin/engine/container/kithinFile';
import type { AssetId } from '@kithin/engine/assets/ref';
import type { SlotTree } from '@kithin/engine/ecs/types';
import type { PackWorld } from './types.ts';
import { scanPackAssets } from './core.ts';

const THUMBNAILS = ['thumbnail.webp', 'thumbnail.png', 'thumbnail.jpg'];

export interface PreparedPack {
	name: string;
	scene: SlotTree;
	/** Every file of the pack's `assets/` (and its thumbnail) as the engine stores it. */
	store: MemoryAssetStore;
	thumbnail: AssetId | null;
	/** Files of `assets/` the engine does not accept as an asset. */
	skipped: string[];
}

/** Builds a pack's world and loads the files it can use into a store, the way the Studio would hold them. */
export async function preparePack(packDir: string, world: PackWorld): Promise<PreparedPack> {
	const store = new MemoryAssetStore();
	const skipped: string[] = [];
	for (const path of Object.keys(scanPackAssets(packDir))) {
		try {
			await importAsset(new Uint8Array(readFileSync(join(packDir, 'assets', ...path.split('/')))), path.split('/').pop()!, store);
		} catch {
			skipped.push(path);
		}
	}
	let thumbnail: AssetId | null = null;
	for (const name of THUMBNAILS) {
		try {
			thumbnail = (await importAsset(new Uint8Array(readFileSync(join(packDir, name))), name, store)).manifest.assetId;
			break;
		} catch {
			// no thumbnail with this name
		}
	}
	return { name: world.name, scene: world.build(), store, thumbnail, skipped };
}

/** Packs a pack's world, with the files it uses, as a Kithin file ready to import in the Studio of any environment. */
export async function exportPack(packDir: string, world: PackWorld) {
	const { name, scene, store, thumbnail, skipped } = await preparePack(packDir, world);
	const result = await exportContainer({ kind: 'world', name, scene, thumbnail }, store);
	return { ...result, skipped };
}
