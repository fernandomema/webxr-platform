// Registers the glTF/GLB loader. Importing it here means every scene that shows models has it.
import '@babylonjs/loaders/glTF';
import { LoadAssetContainerAsync, TransformNode, Vector3, type AssetContainer, type Scene } from '@babylonjs/core';
import type { Vec3 } from '$lib/ecs/types';
import { normalizationTransform, normalizedExtents } from '$lib/assets/normalize';
import type { AssetId } from '$lib/assets/ref';
import { resolveAsset, type AssetResolver } from '$lib/assets/resolve';
import { assetStoreChanges, getLocalAssetStore, type AssetStore } from '$lib/assets/store';

/**
 * pending  – queued, waiting for a decode slot
 * loading  – fetching bytes / decoding
 * ready    – a container exists; instances can be made
 * missing  – no source has the bytes right now (retried later, or when a new source appears)
 * error    – the bytes are invalid or could not be decoded (not retried)
 */
export type ModelState = 'pending' | 'loading' | 'ready' | 'missing' | 'error';

export interface ModelInstance {
	/** Normalised: largest side 1, centred on the origin, like a built-in shape. */
	root: TransformNode;
	/** Extents of the normalised model. */
	extents: Vec3;
	/** Bone name (as written in the file) to the transform node that drives it. Empty for models without a skin. */
	boneNodes: Map<string, TransformNode>;
	dispose(): void;
}

export interface InstantiateOptions {
	/** Scale and centre the model like a built-in shape (default). Avatars turn this off to keep real-world metres. */
	normalize?: boolean;
}

interface Entry {
	id: AssetId;
	state: ModelState;
	error?: string;
	container: AssetContainer | null;
	bounds?: { min: Vec3; max: Vec3 };
	name?: string;
	leases: Set<ModelLease>;
	abort?: AbortController;
	releaseTimer?: ReturnType<typeof setTimeout>;
	retryTimer?: ReturnType<typeof setTimeout>;
}

export interface ModelLibraryOptions {
	store?: AssetStore;
	/** Remote sources, tried in order after this device. Read at load time, so sources can appear later (joining a session). */
	getResolvers?: () => AssetResolver[];
	/** Decodes running at once. Decoding is the expensive step on a headset. */
	maxConcurrent?: number;
	/** How long an unused model stays cached before it is freed. */
	releaseDelayMs?: number;
	/** How long before a `missing` model is looked for again. */
	retryMs?: number;
}

/** One user of a model (a slot). Holding a lease keeps the model cached and queued. */
export class ModelLease {
	priority = 0;
	private released = false;

	constructor(
		private library: ModelLibrary,
		private entry: Entry,
		private onChange: () => void
	) {}

	get state(): ModelState {
		return this.entry.state;
	}

	get error(): string | undefined {
		return this.entry.error;
	}

	/** The normalised extents, known as soon as the manifest is (before the model is decoded). */
	get extents(): Vec3 {
		return normalizedExtents(this.entry.bounds);
	}

	notify(): void {
		if (!this.released) this.onChange();
	}

	setPriority(priority: number): void {
		this.priority = priority;
	}

	instantiate(name: string, options?: InstantiateOptions): ModelInstance | null {
		return this.library.instantiate(this.entry.id, name, options);
	}

	release(): void {
		if (this.released) return;
		this.released = true;
		this.library.releaseLease(this.entry.id, this);
	}
}

export class ModelLibrary {
	private entries = new Map<AssetId, Entry>();
	private boundsHints = new Map<AssetId, { min: Vec3; max: Vec3 }>();
	private active = 0;
	private disposed = false;
	private readonly store: AssetStore;
	private readonly maxConcurrent: number;
	private readonly releaseDelayMs: number;
	private readonly retryMs: number;

	constructor(
		private scene: Scene,
		private options: ModelLibraryOptions = {}
	) {
		this.store = options.store ?? getLocalAssetStore();
		this.maxConcurrent = options.maxConcurrent ?? 2;
		this.releaseDelayMs = options.releaseDelayMs ?? 30_000;
		this.retryMs = options.retryMs ?? 15_000;
		assetStoreChanges.addEventListener('put', this.onStorePut);
	}

	/** New bytes arrived on this device: anything that was missing may be available now. */
	private onStorePut = () => this.retryMissing();

	acquire(id: AssetId, onChange: () => void): ModelLease {
		let entry = this.entries.get(id);
		if (!entry) {
			entry = { id, state: 'pending', container: null, leases: new Set(), bounds: this.boundsHints.get(id) };
			this.entries.set(id, entry);
			void this.learnManifest(entry);
		}
		clearTimeout(entry.releaseTimer);
		entry.releaseTimer = undefined;
		const lease = new ModelLease(this, entry, onChange);
		entry.leases.add(lease);
		// A model that is already loaded (or known to be broken) is reported straight away.
		if (entry.state !== 'pending') queueMicrotask(() => lease.notify());
		this.pump();
		return lease;
	}

	/** Bounds shipped with a snapshot let placeholders be sized before the manifest is available locally. */
	provideBounds(id: AssetId, bounds: { min: Vec3; max: Vec3 }): void {
		this.boundsHints.set(id, bounds);
		const entry = this.entries.get(id);
		if (entry && !entry.bounds) {
			entry.bounds = bounds;
			this.notify(entry);
		}
	}

	/** Call when a new source may have become available (joined a session, signed in): models that were missing are looked for again. */
	retryMissing(): void {
		for (const entry of this.entries.values()) {
			if (entry.state === 'missing' && entry.leases.size > 0) this.requeue(entry);
		}
		this.pump();
	}

	private async learnManifest(entry: Entry): Promise<void> {
		try {
			const manifest = await this.store.getManifest(entry.id);
			if (manifest?.type === 'model' && !entry.bounds) {
				entry.bounds = manifest.bounds;
				entry.name = manifest.name;
				this.notify(entry);
			}
		} catch {
			// Placeholders just keep their default size.
		}
	}

	private notify(entry: Entry): void {
		for (const lease of [...entry.leases]) lease.notify();
	}

	private requeue(entry: Entry): void {
		clearTimeout(entry.retryTimer);
		entry.retryTimer = undefined;
		entry.state = 'pending';
		entry.error = undefined;
		this.notify(entry);
	}

	private pump(): void {
		if (this.disposed) return;
		while (this.active < this.maxConcurrent) {
			let best: Entry | null = null;
			let bestPriority = -Infinity;
			for (const entry of this.entries.values()) {
				if (entry.state !== 'pending' || entry.leases.size === 0) continue;
				let priority = -Infinity;
				for (const lease of entry.leases) priority = Math.max(priority, lease.priority);
				if (priority > bestPriority) {
					best = entry;
					bestPriority = priority;
				}
			}
			if (!best) return;
			void this.load(best);
		}
	}

	private async load(entry: Entry): Promise<void> {
		entry.state = 'loading';
		this.active++;
		this.notify(entry);
		const controller = new AbortController();
		entry.abort = controller;
		try {
			const result = await resolveAsset(entry.id, this.options.getResolvers?.() ?? [], this.store, { signal: controller.signal, nameHint: entry.name });
			if (controller.signal.aborted || this.disposed) return;
			if (!result.ok) {
				entry.state = result.reason === 'invalid' ? 'error' : 'missing';
				entry.error = result.message;
				if (entry.state === 'missing') entry.retryTimer = setTimeout(() => { this.requeue(entry); this.pump(); }, this.retryMs);
				return;
			}
			const manifest = await this.store.getManifest(entry.id);
			if (manifest?.type === 'model') entry.bounds = manifest.bounds;
			const container = await LoadAssetContainerAsync(result.bytes, this.scene, { pluginExtension: '.glb', name: entry.id });
			// The glTF loader starts a model's first clip, even in a container nothing shows: its nodes would keep animating,
			// and every instance made later would be cloned mid-clip instead of in the model's own pose.
			for (const group of container.animationGroups) group.stop();
			if (controller.signal.aborted || this.disposed || entry.leases.size === 0) {
				container.dispose();
				return;
			}
			entry.container = container;
			entry.state = 'ready';
		} catch (error) {
			entry.state = 'error';
			entry.error = error instanceof Error ? error.message : 'The model could not be decoded.';
			console.warn(`[models] ${entry.id} failed to load`, error);
		} finally {
			entry.abort = undefined;
			this.active--;
			this.notify(entry);
			this.pump();
		}
	}

	instantiate(id: AssetId, name: string, options: InstantiateOptions = {}): ModelInstance | null {
		const entry = this.entries.get(id);
		if (!entry?.container) return null;
		const created = entry.container.instantiateModelsToScene((source) => `${name}:${source}`, false);
		// The app drives skeletons itself (avatars), so a clip baked into the file must not fight it, and every instance starts
		// in the model's rest pose: an avatar's rig measures its bones from it, and a hand measured mid-clip ends up turned.
		for (const group of created.animationGroups) group.stop();
		for (const skeleton of created.skeletons) skeleton.returnToRest();
		const root = new TransformNode(name, this.scene);
		for (const node of created.rootNodes) node.parent = root;

		// Measure what actually loaded (the file's own bounds can disagree once the loader has flipped handedness).
		root.computeWorldMatrix(true);
		const min = new Vector3(Infinity, Infinity, Infinity);
		const max = new Vector3(-Infinity, -Infinity, -Infinity);
		for (const mesh of root.getChildMeshes(false)) {
			mesh.computeWorldMatrix(true);
			mesh.isPickable = false; // the slot's proxy handles picking
			const box = mesh.getBoundingInfo().boundingBox;
			min.minimizeInPlace(box.minimumWorld);
			max.maximizeInPlace(box.maximumWorld);
		}
		if (!Number.isFinite(min.x + max.x)) {
			created.dispose();
			root.dispose();
			return null;
		}
		const bounds = { min: min.asArray() as Vec3, max: max.asArray() as Vec3 };
		const normalize = options.normalize !== false;
		if (normalize) {
			const { scale, offset } = normalizationTransform(bounds);
			root.scaling.setAll(scale);
			root.position.set(...offset);
		}

		const boneNodes = new Map<string, TransformNode>();
		for (const skeleton of created.skeletons) {
			for (const bone of skeleton.bones) {
				const node = bone.getTransformNode();
				if (node && !boneNodes.has(bone.name)) boneNodes.set(bone.name, node);
			}
		}

		return {
			root,
			extents: normalize ? normalizedExtents(bounds) : (max.subtract(min).asArray() as Vec3),
			boneNodes,
			dispose: () => {
				created.dispose();
				root.dispose();
			}
		};
	}

	releaseLease(id: AssetId, lease: ModelLease): void {
		const entry = this.entries.get(id);
		if (!entry) return;
		entry.leases.delete(lease);
		if (entry.leases.size > 0) return;
		entry.abort?.abort();
		clearTimeout(entry.retryTimer);
		clearTimeout(entry.releaseTimer);
		// Keep it around briefly: slots are often removed and recreated (world swaps, rebuilds).
		entry.releaseTimer = setTimeout(() => this.free(entry), this.releaseDelayMs);
	}

	private free(entry: Entry): void {
		if (entry.leases.size > 0) return;
		entry.container?.dispose();
		entry.container = null;
		this.entries.delete(entry.id);
	}

	dispose(): void {
		this.disposed = true;
		assetStoreChanges.removeEventListener('put', this.onStorePut);
		for (const entry of this.entries.values()) {
			entry.abort?.abort();
			clearTimeout(entry.releaseTimer);
			clearTimeout(entry.retryTimer);
			entry.container?.dispose();
		}
		this.entries.clear();
	}
}
