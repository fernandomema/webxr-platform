import type { SlotTree } from '$lib/ecs/types';
import type { AssetId } from '$lib/assets/ref';
import { importAsset } from '$lib/assets/importAsset';
import { getLocalAssetStore } from '$lib/assets/store';
import type { BakeQuality, BakeReply, BakeStats } from './bakeJob';

export interface BakeResult {
	assetId: AssetId;
	stats: BakeStats;
}

/** Bakes the lighting of a world in a worker and keeps the file as a `lightmap` asset on this device. */
export function bakeWorld(tree: SlotTree, options: { quality: BakeQuality; skyIntensity: number; onProgress?: (fraction: number) => void; signal?: AbortSignal }): Promise<BakeResult> {
	return new Promise((resolve, reject) => {
		const worker = new Worker(new URL('./bake.worker.ts', import.meta.url), { type: 'module' });
		const finish = () => { options.signal?.removeEventListener('abort', cancel); worker.terminate(); };
		const cancel = () => { finish(); reject(new DOMException('The bake was cancelled.', 'AbortError')); };
		options.signal?.addEventListener('abort', cancel);
		worker.onerror = () => { finish(); reject(new Error('The bake could not run in this browser.')); };
		worker.onmessage = async ({ data }: MessageEvent<BakeReply>) => {
			if (data.type === 'progress') return options.onProgress?.(data.fraction);
			finish();
			if (data.type === 'error') return reject(new Error(data.message));
			try {
				const { manifest } = await importAsset(data.bytes, 'baked-lighting.lvol', getLocalAssetStore(), { type: 'lightmap' });
				resolve({ assetId: manifest.assetId, stats: data.stats });
			} catch (error) { reject(error); }
		};
		worker.postMessage({ tree: JSON.parse(JSON.stringify(tree)), quality: options.quality, skyIntensity: options.skyIntensity });
	});
}
