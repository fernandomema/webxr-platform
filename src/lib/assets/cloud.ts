import type { AssetManifest } from './manifest.ts';
import type { AssetId } from './ref.ts';
import type { AssetResolver } from './resolve.ts';

/** An error from the model storage API. `missing` is set when a scene uses models that are not uploaded (HTTP 409). */
export class CloudAssetError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly missing?: string[]
	) {
		super(message);
		this.name = 'CloudAssetError';
	}
}

async function failure(response: Response): Promise<CloudAssetError> {
	let body: { message?: string; missing?: string[] } = {};
	try {
		body = await response.json();
	} catch {
		// Not JSON.
	}
	return new CloudAssetError(body.message ?? `Model storage error (${response.status})`, response.status, body.missing);
}

async function post<T>(path: string, json: unknown): Promise<T> {
	const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) });
	if (!response.ok) throw await failure(response);
	return (await response.json()) as T;
}

export interface ResolvedCloudAsset {
	url: string;
	expiresAt: number;
	manifest: AssetManifest;
}

export interface MyCloudAsset {
	assetId: AssetId;
	name: string;
	byteSize: number;
	source: string;
	ownedSince: string;
	manifest: AssetManifest;
	usedIn: { items: number; worlds: number; publications: number };
}

export const cloudAssets = {
	/**
	 * Stores a model in the cloud. If it is already there (uploaded by anyone)
	 * nothing is sent — this account just becomes another owner.
	 */
	async upload(manifest: AssetManifest, bytes: Uint8Array): Promise<'uploaded' | 'existing'> {
		const answer = await post<{ exists: true } | { exists: false; upload: { method: 'PUT'; url: string; headers: Record<string, string> } }>('/api/assets/uploads', { manifest });
		if (answer.exists) return 'existing';
		const put = await fetch(answer.upload.url, { method: answer.upload.method, headers: answer.upload.headers, body: bytes as unknown as BodyInit });
		if (!put.ok) throw await failure(put);
		await post('/api/assets/uploads/complete', { assetId: manifest.assetId });
		return 'uploaded';
	},

	async resolve(ids: AssetId[]): Promise<Record<string, ResolvedCloudAsset>> {
		return (await post<{ assets: Record<string, ResolvedCloudAsset> }>('/api/assets/resolve', { ids })).assets;
	},

	async list(): Promise<MyCloudAsset[]> {
		const response = await fetch('/api/assets');
		if (!response.ok) throw await failure(response);
		return (await response.json()) as MyCloudAsset[];
	},

	async usage(): Promise<{ bytes: number; count: number; quota: number }> {
		const response = await fetch('/api/assets/usage');
		if (!response.ok) throw await failure(response);
		return await response.json();
	},

	async release(id: AssetId): Promise<void> {
		const response = await fetch(`/api/assets/${encodeURIComponent(id)}`, { method: 'DELETE' });
		if (!response.ok) throw await failure(response);
	}
};

/**
 * Downloads models from the cloud. Requests made in the same moment (a world
 * with many models) are sent as one lookup. Works signed out for models that a
 * published or hosted world uses.
 */
export class CloudResolver implements AssetResolver {
	readonly name = 'cloud';
	private pending = new Map<AssetId, Array<(value: ResolvedCloudAsset | null) => void>>();
	private scheduled = false;

	private lookup(id: AssetId): Promise<ResolvedCloudAsset | null> {
		return new Promise((resolve) => {
			this.pending.set(id, [...(this.pending.get(id) ?? []), resolve]);
			if (this.scheduled) return;
			this.scheduled = true;
			setTimeout(() => void this.flush(), 0);
		});
	}

	private async flush(): Promise<void> {
		const batch = this.pending;
		this.pending = new Map();
		this.scheduled = false;
		let found: Record<string, ResolvedCloudAsset> = {};
		try {
			found = await cloudAssets.resolve([...batch.keys()]);
		} catch {
			// Offline or the storage is not configured: every waiter simply gets nothing from here.
		}
		for (const [id, waiters] of batch) for (const waiter of waiters) waiter(found[id] ?? null);
	}

	async resolve(id: AssetId, signal: AbortSignal): Promise<Uint8Array | null> {
		const entry = await this.lookup(id);
		if (!entry || signal.aborted) return null;
		const response = await fetch(entry.url, { signal });
		if (!response.ok) return null;
		return new Uint8Array(await response.arrayBuffer());
	}
}
