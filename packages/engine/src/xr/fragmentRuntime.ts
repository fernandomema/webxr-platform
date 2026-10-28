import type { FragmentComponent, Slot } from '../ecs/types.ts';
import { instantiateFragment, parseFragment, type FragmentData } from '../assets/fragment.ts';
import type { AssetId } from '../assets/ref.ts';
import type { BlobAssetLibrary, BlobLease } from './blobAssetLibrary.ts';

/** What a fragment needs of the scene it is loaded into. */
export interface FragmentHost {
	/** Builds the slots under the owner. False when refused (over budget). */
	load(ownerId: string, slots: Slot[]): boolean;
	/** Takes down what `load` built for the owner. */
	unload(ownerId: string): void;
	/** Whether the owner's node is on (it and everything above it). */
	isEnabled(): boolean;
}

export interface FragmentBinding {
	/** Once a frame: builds the fragment when the slot has been switched on and its data is here, takes it down when it is off. */
	tick(): void;
	sync(component: FragmentComponent): void;
	dispose(): void;
	/** Whether its slots are built now. */
	readonly built: boolean;
}

const sourceKey = (component: FragmentComponent): AssetId | '' => (component.source?.kind === 'asset' ? component.source.assetId : '');

/**
 * Keeps the content of a `fragment` component built while its slot is enabled. The asset is asked for only when the slot is first on and
 * let go of when it goes off, so a map that is not in use costs neither slots nor memory.
 */
export function setupFragment(ownerId: string, initial: FragmentComponent, assets: BlobAssetLibrary | undefined, host: FragmentHost, onError: (error: unknown) => void = (error) => console.warn(`[fragment] ${ownerId}`, error)): FragmentBinding {
	let current = initial;
	let lease: BlobLease | null = null;
	let data: FragmentData | null = null;
	let fetching = false;
	let built = false;
	let failed = false;
	let disposed = false;

	const drop = () => {
		if (built) { host.unload(ownerId); built = false; }
		lease?.release();
		lease = null;
		data = null;
		failed = false;
	};

	async function read(url: string): Promise<void> {
		if (fetching || data || failed) return;
		fetching = true;
		const mine = lease;
		try {
			const response = await fetch(url);
			const parsed = parseFragment(new Uint8Array(await response.arrayBuffer()));
			if (disposed || lease !== mine) return;
			data = parsed;
		} catch (error) {
			failed = true;
			onError(error);
		} finally {
			fetching = false;
		}
	}

	const check = () => { if (lease && lease.state === 'ready' && lease.url) void read(lease.url); };

	return {
		get built() { return built; },
		tick() {
			if (disposed) return;
			const on = host.isEnabled();
			if (!on) { if (built || lease) drop(); return; }
			if (!lease) {
				const id = sourceKey(current);
				if (id && assets) { lease = assets.acquire(id, check); check(); }
				return;
			}
			if (data && !built) {
				built = true;
				if (!host.load(ownerId, instantiateFragment(ownerId, data))) { built = false; failed = true; }
			}
		},
		sync(component) {
			const changed = sourceKey(component) !== sourceKey(current);
			current = component;
			if (changed) drop();
		},
		dispose() {
			disposed = true;
			drop();
		}
	};
}
