import type { AssetId } from './ref';
import type { AssetResolver } from './resolve';
import { getContent } from '../xr/content/registry.ts';

export const POLYGON_QUEST_PROBE = {
	px: 'sha256:f2458dbd8140f541eb184124e05ce606383f83ac44b128c7d03b1d24a6946585',
	nx: 'sha256:d56f94ca788868acce9c595bd541dc6fdbebc9f809a01abe1c4ef96f8d5ad183',
	py: 'sha256:a4aa0eed092bade033d9f2dc0cad5c754563315899e8004f7a8db5f86ec7977f',
	ny: 'sha256:a46de5872d202bfa8a0f4c76477eff30fd806504a59e8cb28f09f17cd51c78fe',
	pz: 'sha256:18f08e2c46fb6b4c2d50e6595d9b6657025bf7b1fe34a5635d50a208f2264163',
	nz: 'sha256:c378eecd14a8ebc9d23925ca8cd9f43effac7499241323cecad364ea86f68c3e',
} as const;

/** Files that ship with the hosting app, addressed by the content hash they have (see `registerContent`). */
export const bundledAssetResolver: AssetResolver = {
	name: 'bundled',
	async resolve(id, signal) {
		const url = getContent().bundledAssets?.[id];
		if (!url) return null;
		const response = await fetch(url, { signal });
		if (!response.ok) return null;
		return new Uint8Array(await response.arrayBuffer());
	}
};
