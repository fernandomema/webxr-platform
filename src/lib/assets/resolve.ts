import { GlbError } from './glb.ts';
import { assetIdOf } from './hash.ts';
import { importGlb } from './importGlb.ts';
import type { AssetId } from './ref.ts';
import type { AssetStore } from './store.ts';

/** A place bytes can come from besides this device: the cloud, or the host of the current session. */
export interface AssetResolver {
	readonly name: string;
	/** Returns the bytes, or null when this source does not have them. May throw on transport errors. */
	resolve(id: AssetId, signal: AbortSignal): Promise<Uint8Array | null>;
}

export type ResolveResult =
	| { ok: true; bytes: Uint8Array; source: string }
	| { ok: false; reason: 'unavailable' | 'invalid'; message: string };

/**
 * Finds a model's bytes: this device first, then each remote source in order.
 * Whatever a remote source returns is checked against the hash it was asked for
 * and against the same import rules as a local file, then cached on this
 * device — a source can be wrong or hostile, but it cannot make the wrong
 * model appear.
 */
export async function resolveAsset(
	id: AssetId,
	sources: AssetResolver[],
	store: AssetStore,
	options: { signal?: AbortSignal; nameHint?: string } = {}
): Promise<ResolveResult> {
	const signal = options.signal ?? new AbortController().signal;
	const local = await store.getBytes(id);
	if (local) return { ok: true, bytes: local, source: 'device' };

	let invalid: string | null = null;
	for (const source of sources) {
		if (signal.aborted) break;
		let bytes: Uint8Array | null;
		try {
			bytes = await source.resolve(id, signal);
		} catch {
			continue; // this source failed; try the next
		}
		if (!bytes) continue;
		if ((await assetIdOf(bytes)) !== id) {
			invalid = `${source.name} returned different data than requested.`;
			continue;
		}
		try {
			await importGlb(bytes, options.nameHint ?? 'Model', store);
		} catch (error) {
			if (error instanceof GlbError) {
				invalid = error.message;
				continue;
			}
			// Storing failed (quota, private mode); the bytes are still good for this session.
		}
		return { ok: true, bytes, source: source.name };
	}
	return invalid
		? { ok: false, reason: 'invalid', message: invalid }
		: { ok: false, reason: 'unavailable', message: 'No source has this model.' };
}
