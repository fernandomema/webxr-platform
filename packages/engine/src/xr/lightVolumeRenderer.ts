import type { LightVolumeComponent } from '../ecs/types.ts';
import { decodeTexelsAsync } from '../lighting/format.ts';
import type { BlobAssetLibrary, BlobLease } from './blobAssetLibrary.ts';
import { LightVolumeManager, tintOf } from './lightVolumeManager.ts';
import type { Scene } from '@babylonjs/core';

export interface LightVolumeBinding {
	dispose(): void;
	sync(component: LightVolumeComponent): void;
}

/**
 * Loads the baked data of a `lightVolume` component and hands it to the scene's `LightVolumeManager`, which packs it with the
 * others and lights the world with it. The numbers that can change while the world runs (`intensity`, `tint`, `enabled`) are
 * followed live: a script can dim a room or turn it red.
 */
export function setupLightVolume(scene: Scene, id: string, initial: LightVolumeComponent, assets?: BlobAssetLibrary): LightVolumeBinding {
	const manager = LightVolumeManager.for(scene);
	let current = initial;
	let disposed = false;
	let loaded = false;
	let loading = false;
	let lease: BlobLease | null = null;

	async function load(url: string): Promise<void> {
		if (loading || loaded) return;
		loading = true;
		try {
			const response = await fetch(url);
			const { header, texels } = await decodeTexelsAsync(new Uint8Array(await response.arrayBuffer()));
			if (disposed) return;
			manager.add(id, { min: header.spec.min, voxel: header.spec.voxel, dims: header.spec.dims, range: header.range }, texels, tintOf(current.tint), current.intensity ?? 1, current.enabled !== false);
			loaded = true;
		} catch (error) {
			console.warn('[lighting] the baked lighting could not be read', error);
		} finally {
			loading = false;
		}
	}

	const check = () => { if (lease && lease.state === 'ready' && lease.url) void load(lease.url); };
	if (initial.data?.kind === 'asset' && assets) {
		lease = assets.acquire(initial.data.assetId, check);
		check();
	}

	return {
		dispose() {
			disposed = true;
			lease?.release();
			manager.remove(id);
		},
		sync(component) {
			current = component;
			if (loaded) manager.update(id, tintOf(component.tint), component.intensity ?? 1, component.enabled !== false);
		}
	};
}
