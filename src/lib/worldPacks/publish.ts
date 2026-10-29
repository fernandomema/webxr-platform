/**
 * Publishes a pack's world to a running platform the way the Studio does: the files it uses first, then the world. It signs in
 * with the cookies of a browser session (`KITHIN_COOKIE`), so it publishes as that account.
 */
import { collectAssetIds, type AssetId } from '@kithin/engine/assets/ref';
import { preparePack } from './export.ts';
import type { PackWorld } from './types.ts';

export interface PublishTarget {
	/** The platform's address, such as `https://example.com` or `https://localhost:5173`. */
	host: string;
	/** The `cookie` header of a signed-in browser session. */
	cookie: string;
	fetch?: typeof fetch;
}

export class PublishError extends Error {
	constructor(
		message: string,
		readonly status = 0,
		readonly missing: string[] = []
	) {
		super(message);
		this.name = 'PublishError';
	}
}

export function normalizeHost(host: string): string {
	const url = new URL(/^[a-z]+:\/\//i.test(host) ? host : `https://${host}`);
	return url.origin;
}

function client({ host, cookie, fetch: fetcher = fetch }: PublishTarget) {
	const origin = normalizeHost(host);
	return {
		origin,
		async call(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
			const url = new URL(path, origin);
			const sameSite = url.origin === origin;
			const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
			if (init.json !== undefined) headers['content-type'] = 'application/json';
			if (sameSite) {
				headers.cookie = cookie;
				headers.origin = origin;
			}
			return fetcher(url, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body, redirect: 'manual' });
		}
	};
}

async function failure(response: Response): Promise<PublishError> {
	let body: { message?: string; missing?: string[] } = {};
	try {
		body = await response.json();
	} catch {
		// not JSON
	}
	const reason = response.status === 401 ? 'Not signed in: the cookie is missing or expired. Copy a fresh one from the browser.' : (body.message ?? `The platform answered ${response.status}`);
	return new PublishError(reason, response.status, body.missing);
}

/** Who the cookie signs in as, or null when the session is not valid. */
export async function whoami(target: PublishTarget): Promise<{ id: string; name: string; email: string } | null> {
	const response = await client(target).call('/api/auth/get-session');
	if (!response.ok) throw await failure(response);
	const session = (await response.json().catch(() => null)) as { user?: { id: string; name: string; email: string } } | null;
	return session?.user ?? null;
}

export interface PublishResult {
	id: string;
	name: string;
	revision: number;
	created: boolean;
	uploaded: number;
	existing: number;
	/** Used by the scene but not in the pack: the platform may still have them from before. */
	notInPack: AssetId[];
	skipped: string[];
}

/** Uploads what the world uses and publishes it: a new world, or a new revision of `publishedId`. */
export async function publishPack(
	packDir: string,
	world: PackWorld,
	target: PublishTarget,
	options: { publishedId?: string; onProgress?: (done: number, total: number, name: string) => void } = {}
): Promise<PublishResult> {
	const api = client(target);
	if (!(await whoami(target))) throw new PublishError('Not signed in: the cookie is missing or expired. Copy a fresh one from the browser.', 401);

	const prepared = await preparePack(packDir, world);
	const ids = [...new Set([...collectAssetIds(prepared.scene), ...(prepared.thumbnail ? [prepared.thumbnail] : [])])];
	const notInPack: AssetId[] = [];
	let uploaded = 0;
	let existing = 0;
	for (const [index, id] of ids.entries()) {
		const manifest = await prepared.store.getManifest(id);
		const bytes = manifest ? await prepared.store.getBytes(id) : undefined;
		options.onProgress?.(index, ids.length, manifest?.name ?? id);
		if (!manifest || !bytes) {
			notInPack.push(id);
			continue;
		}
		const announce = await api.call('/api/assets/uploads', { method: 'POST', json: { manifest } });
		if (!announce.ok) throw await failure(announce);
		const answer = (await announce.json()) as { exists: true } | { exists: false; upload: { method: string; url: string; headers: Record<string, string> } };
		if (answer.exists) {
			existing++;
			continue;
		}
		const put = await api.call(answer.upload.url, { method: answer.upload.method, headers: answer.upload.headers, body: bytes as unknown as BodyInit });
		if (!put.ok) throw await failure(put);
		const done = await api.call('/api/assets/uploads/complete', { method: 'POST', json: { assetId: id } });
		if (!done.ok) throw await failure(done);
		uploaded++;
	}
	options.onProgress?.(ids.length, ids.length, '');

	const body = { name: prepared.name, scene: prepared.scene, thumbnailAssetId: prepared.thumbnail ?? undefined };
	const response = options.publishedId
		? await api.call(`/api/published-worlds/${encodeURIComponent(options.publishedId)}/revisions`, { method: 'POST', json: body })
		: await api.call('/api/published-worlds', { method: 'POST', json: body });
	if (!response.ok) throw await failure(response);
	const published = (await response.json()) as { id?: string; name?: string; latestRevision?: number; number?: number };
	return {
		id: options.publishedId ?? published.id ?? '',
		name: published.name ?? prepared.name,
		revision: published.latestRevision ?? published.number ?? 1,
		created: !options.publishedId,
		uploaded,
		existing,
		notInPack,
		skipped: prepared.skipped
	};
}
