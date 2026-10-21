import type { AssetId } from '../../assets/ref.ts';
import type { WorldPackage } from '../../worlds/types.ts';
import { registerContent, type BuiltinWorld } from './registry.ts';

/**
 * A folder of files that ship with a game, listed in a `bundle.json` that `kithin-engine-bundle` writes: the models, pictures and
 * sounds its worlds use (found by the content hash their scenes name) and the worlds themselves, as `WorldPackage` files.
 * With a bundle a game needs no cloud storage: everything is served as static files next to the page.
 */
export interface BundleManifest {
	formatVersion: 1;
	/** Content hash of a file → its address, relative to the manifest. */
	assets: Record<AssetId, string>;
	worlds: Array<{ id: string; name: string; description?: string; url: string; development?: boolean }>;
	/** The world to stand in when none is asked for. */
	home?: string;
}

export interface LoadedBundle {
	manifest: BundleManifest;
	/** The world package with this id (the file name without `.json`). */
	world(id: string): Promise<WorldPackage>;
}

function isManifest(value: unknown): value is BundleManifest {
	const manifest = value as Partial<BundleManifest> | null;
	return Boolean(manifest) && manifest!.formatVersion === 1 && typeof manifest!.assets === 'object' && manifest!.assets !== null && Array.isArray(manifest!.worlds);
}

/**
 * Reads a bundle and tells the engine about it: its files become the bundled assets, its worlds the built-in worlds (listed in the
 * Worlds tab, openable from a portal), and its home world the scene to stand in. `fetchFn` defaults to `fetch`.
 */
export async function loadBundle(manifestUrl: string, fetchFn: typeof fetch = fetch): Promise<LoadedBundle> {
	const base = new URL(manifestUrl, typeof location === 'undefined' ? 'http://localhost/' : location.href);
	const response = await fetchFn(base.href);
	if (!response.ok) throw new Error(`Could not load the content bundle (HTTP ${response.status})`);
	const manifest: unknown = await response.json();
	if (!isManifest(manifest)) throw new Error('This is not a content bundle');
	const at = (path: string) => new URL(path, base).href;

	const packages = new Map<string, Promise<WorldPackage>>();
	const world = (id: string): Promise<WorldPackage> => {
		const entry = manifest.worlds.find((candidate) => candidate.id === id);
		if (!entry) return Promise.reject(new Error(`The bundle has no world "${id}"`));
		let loading = packages.get(id);
		if (!loading) {
			loading = fetchFn(at(entry.url)).then(async (answer) => {
				if (!answer.ok) throw new Error(`Could not load the world "${id}" (HTTP ${answer.status})`);
				return (await answer.json()) as WorldPackage;
			});
			packages.set(id, loading);
			loading.catch(() => packages.delete(id)); // a failed load is tried again next time
		}
		return loading;
	};

	registerContent({
		bundledAssets: Object.fromEntries(Object.entries(manifest.assets).map(([id, path]) => [id, at(path)])),
		loadWorlds: async () => {
			const worlds: BuiltinWorld[] = await Promise.all(manifest.worlds.map(async (entry) => ({ id: entry.id, name: entry.name, description: entry.description ?? '', scene: (await world(entry.id)).scene })));
			return { worlds, devWorldIds: manifest.worlds.filter((entry) => entry.development).map((entry) => entry.id) };
		},
		...(manifest.home ? { loadHome: async () => (await world(manifest.home!)).scene } : {})
	});
	return { manifest, world };
}
