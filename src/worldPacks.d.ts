declare module 'virtual:world-packs' {
	import type { PackWorld } from '$lib/worldPacks/types';
	/** The local world packs (`worlds/<id>/`); empty outside the dev server. */
	export const packWorlds: { id: string; load: () => Promise<{ default: PackWorld }> }[];
	/** The files of every pack by content hash, and where the dev server serves them. */
	export const packAssets: Record<`sha256:${string}`, string>;
}
