import type { AssetId } from '$lib/assets/ref';
import { resolveAsset, type AssetResolver } from '$lib/assets/resolve';
import { assetStoreChanges, getLocalAssetStore, type AssetStore } from '$lib/assets/store';

/**
 * pending  – waiting for the bytes
 * ready    – `url` is a `blob:` URL the browser can play or show
 * missing  – no source has the bytes right now (retried later, or when new bytes reach this device)
 * error    – the bytes are invalid (not retried)
 */
export type BlobState = 'pending' | 'ready' | 'missing' | 'error';

interface Entry {
	id: AssetId;
	state: BlobState;
	url?: string;
	error?: string;
	leases: Set<BlobLease>;
	abort?: AbortController;
	releaseTimer?: ReturnType<typeof setTimeout>;
	retryTimer?: ReturnType<typeof setTimeout>;
}

export interface BlobAssetLibraryOptions {
	store?: AssetStore;
	/** Remote sources, tried in order after this device. Read at load time, so sources can appear later. */
	getResolvers?: () => AssetResolver[];
	/** How long an unused asset stays cached before its URL is revoked. */
	releaseDelayMs?: number;
	/** How long before a `missing` asset is looked for again. */
	retryMs?: number;
}

/** One user of an asset (a slot). Holding a lease keeps the asset loaded. */
export class BlobLease {
	private released = false;

	constructor(
		private library: BlobAssetLibrary,
		private entry: Entry,
		private onChange: () => void
	) {}

	get state(): BlobState {
		return this.entry.state;
	}

	/** A playable `blob:` URL once `state` is `ready`. */
	get url(): string | undefined {
		return this.entry.url;
	}

	notify(): void {
		if (!this.released) this.onChange();
	}

	release(): void {
		if (this.released) return;
		this.released = true;
		this.library.releaseLease(this.entry, this);
	}
}

/**
 * Serves assets whose bytes the browser consumes directly (audio today;
 * textures or html later) as object URLs. Finding the bytes reuses the same
 * path as models: this device, then the cloud, then the session host, with the
 * hash checked on the way in.
 */
export class BlobAssetLibrary {
	private entries = new Map<AssetId, Entry>();
	private disposed = false;
	private readonly store: AssetStore;
	private readonly releaseDelayMs: number;
	private readonly retryMs: number;

	constructor(private options: BlobAssetLibraryOptions = {}) {
		this.store = options.store ?? getLocalAssetStore();
		this.releaseDelayMs = options.releaseDelayMs ?? 30_000;
		this.retryMs = options.retryMs ?? 15_000;
		assetStoreChanges.addEventListener('put', this.onStorePut);
	}

	private onStorePut = () => this.retryMissing();

	acquire(id: AssetId, onChange: () => void): BlobLease {
		let entry = this.entries.get(id);
		if (!entry) {
			entry = { id, state: 'pending', leases: new Set() };
			this.entries.set(id, entry);
		}
		clearTimeout(entry.releaseTimer);
		entry.releaseTimer = undefined;
		const lease = new BlobLease(this, entry, onChange);
		entry.leases.add(lease);
		if (entry.state === 'pending' && !entry.abort) void this.load(entry);
		else queueMicrotask(() => lease.notify());
		return lease;
	}

	/** Call when a new source may have become available (joined a session, signed in). */
	retryMissing(): void {
		for (const entry of this.entries.values()) {
			if (entry.state === 'missing' && entry.leases.size > 0 && !entry.abort) this.requeue(entry);
		}
	}

	private requeue(entry: Entry): void {
		clearTimeout(entry.retryTimer);
		entry.retryTimer = undefined;
		entry.state = 'pending';
		entry.error = undefined;
		void this.load(entry);
	}

	private notify(entry: Entry): void {
		for (const lease of [...entry.leases]) lease.notify();
	}

	private async load(entry: Entry): Promise<void> {
		const controller = new AbortController();
		entry.abort = controller;
		try {
			const result = await resolveAsset(entry.id, this.options.getResolvers?.() ?? [], this.store, { signal: controller.signal });
			if (controller.signal.aborted || this.disposed) return;
			if (!result.ok) {
				entry.state = result.reason === 'invalid' ? 'error' : 'missing';
				entry.error = result.message;
				if (entry.state === 'missing') entry.retryTimer = setTimeout(() => this.requeue(entry), this.retryMs);
				return;
			}
			const manifest = await this.store.getManifest(entry.id);
			const bytes = result.bytes as Uint8Array<ArrayBuffer>;
			entry.url = URL.createObjectURL(new Blob([bytes], { type: manifest?.mimeType ?? 'application/octet-stream' }));
			entry.state = 'ready';
		} catch (error) {
			entry.state = 'error';
			entry.error = error instanceof Error ? error.message : 'The asset could not be loaded.';
		} finally {
			entry.abort = undefined;
			this.notify(entry);
		}
	}

	releaseLease(entry: Entry, lease: BlobLease): void {
		entry.leases.delete(lease);
		if (entry.leases.size > 0) return;
		entry.abort?.abort();
		clearTimeout(entry.retryTimer);
		clearTimeout(entry.releaseTimer);
		// Slots are often removed and recreated (world swaps, rebuilds), so keep it briefly.
		entry.releaseTimer = setTimeout(() => this.free(entry), this.releaseDelayMs);
	}

	private free(entry: Entry): void {
		if (entry.leases.size > 0) return;
		if (entry.url) URL.revokeObjectURL(entry.url);
		this.entries.delete(entry.id);
	}

	dispose(): void {
		this.disposed = true;
		assetStoreChanges.removeEventListener('put', this.onStorePut);
		for (const entry of this.entries.values()) {
			entry.abort?.abort();
			clearTimeout(entry.releaseTimer);
			clearTimeout(entry.retryTimer);
			if (entry.url) URL.revokeObjectURL(entry.url);
		}
		this.entries.clear();
	}
}
