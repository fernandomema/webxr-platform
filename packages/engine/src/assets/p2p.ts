import { isAssetId, type AssetId } from './ref.ts';
import type { AssetResolver } from './resolve.ts';
import type { AssetStore } from './store.ts';
import { ASSET_LIMITS } from './limits.ts';

/**
 * Sends assets straight between the two ends of a session, so a model that only exists on a player's
 * device (their avatar, something they imported) reaches everyone else without the cloud.
 *
 * It rides the ordered binary `asset-data` channel. Every frame is `type (1) | request id (4) | payload`:
 *
 *   REQUEST   payload = the asset id as text
 *   FOUND     payload = total size (4)
 *   CHUNK     payload = the next bytes
 *   NOT_FOUND
 *
 * The channel is ordered, so a response arrives whole and in sequence; several can interleave, told apart
 * by request id. Nothing here is trusted: `resolveAsset` checks the hash of what comes back.
 */

const REQUEST = 1;
const FOUND = 2;
const CHUNK = 3;
const NOT_FOUND = 4;

const HEADER = 5;
/** Kept under the 16 KB every WebRTC stack accepts for one message. */
const CHUNK_BYTES = 15_000;
const MAX_ID_BYTES = 128;

export interface AssetPeerOptions {
	/** Largest asset accepted or served. */
	maxBytes?: number;
	/** How long a request may go without hearing anything before it gives up. */
	idleTimeoutMs?: number;
	/** Requests being served at once; more wait their turn. */
	maxServing?: number;
}

interface Pending {
	id: AssetId;
	resolve(bytes: Uint8Array | null): void;
	buffer: Uint8Array | null;
	received: number;
	timer: ReturnType<typeof setTimeout> | undefined;
}

function frame(type: number, requestId: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
	const out = new Uint8Array(HEADER + payload.byteLength);
	out[0] = type;
	new DataView(out.buffer).setUint32(1, requestId >>> 0, true);
	out.set(payload, HEADER);
	return out;
}

/** One end of an asset link: answers the other end's requests from the local store, and makes requests of its own. */
export class AssetPeer implements AssetResolver {
	readonly name: string;
	private nextRequest = 1;
	private pending = new Map<number, Pending>();
	private serving = 0;
	private queue: Array<() => void> = [];
	private closed = false;
	private readonly maxBytes: number;
	private readonly idleTimeoutMs: number;
	private readonly maxServing: number;

	constructor(
		private send: (data: Uint8Array) => Promise<void>,
		private store: AssetStore,
		name: string,
		options: AssetPeerOptions = {}
	) {
		this.name = name;
		this.maxBytes = options.maxBytes ?? ASSET_LIMITS.maxBytes;
		this.idleTimeoutMs = options.idleTimeoutMs ?? 20_000;
		this.maxServing = options.maxServing ?? 2;
	}

	/** Asks the other end for an asset. Resolves null if it does not have it, is too slow, or the link closes. */
	resolve(id: AssetId, signal: AbortSignal): Promise<Uint8Array | null> {
		if (this.closed || signal.aborted) return Promise.resolve(null);
		return new Promise((resolve) => {
			const requestId = this.nextRequest++;
			const entry: Pending = { id, resolve, buffer: null, received: 0, timer: undefined };
			this.pending.set(requestId, entry);
			const finish = (bytes: Uint8Array | null) => {
				clearTimeout(entry.timer);
				signal.removeEventListener('abort', onAbort);
				if (this.pending.delete(requestId)) resolve(bytes);
			};
			const onAbort = () => finish(null);
			signal.addEventListener('abort', onAbort, { once: true });
			entry.resolve = finish;
			this.touch(entry);
			void this.send(frame(REQUEST, requestId, new TextEncoder().encode(id))).catch(() => finish(null));
		});
	}

	/** Feed every binary frame received from the other end. */
	handle(data: Uint8Array): void {
		if (this.closed || data.byteLength < HEADER) return;
		const type = data[0];
		const requestId = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(1, true);
		const payload = data.subarray(HEADER);
		if (type === REQUEST) this.serve(requestId, payload);
		else this.receive(type, requestId, payload);
	}

	close(): void {
		this.closed = true;
		for (const entry of [...this.pending.values()]) entry.resolve(null);
		this.pending.clear();
		this.queue = [];
	}

	private touch(entry: Pending): void {
		clearTimeout(entry.timer);
		entry.timer = setTimeout(() => entry.resolve(null), this.idleTimeoutMs);
	}

	private receive(type: number, requestId: number, payload: Uint8Array): void {
		const entry = this.pending.get(requestId);
		if (!entry) return;
		if (type === NOT_FOUND) return entry.resolve(null);
		if (type === FOUND) {
			if (payload.byteLength < 4) return entry.resolve(null);
			const total = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0, true);
			if (total === 0 || total > this.maxBytes) return entry.resolve(null);
			entry.buffer = new Uint8Array(total);
			this.touch(entry);
			return;
		}
		if (type === CHUNK && entry.buffer) {
			if (entry.received + payload.byteLength > entry.buffer.byteLength) return entry.resolve(null);
			entry.buffer.set(payload, entry.received);
			entry.received += payload.byteLength;
			if (entry.received === entry.buffer.byteLength) return entry.resolve(entry.buffer);
			this.touch(entry);
		}
	}

	private serve(requestId: number, payload: Uint8Array): void {
		const run = async () => {
			try {
				const id = payload.byteLength <= MAX_ID_BYTES ? new TextDecoder().decode(payload) : '';
				const bytes = isAssetId(id) ? await this.store.getBytes(id) : undefined;
				if (!bytes || bytes.byteLength === 0 || bytes.byteLength > this.maxBytes) {
					await this.send(frame(NOT_FOUND, requestId));
					return;
				}
				const total = new Uint8Array(4);
				new DataView(total.buffer).setUint32(0, bytes.byteLength, true);
				await this.send(frame(FOUND, requestId, total));
				for (let offset = 0; offset < bytes.byteLength && !this.closed; offset += CHUNK_BYTES) {
					await this.send(frame(CHUNK, requestId, bytes.subarray(offset, offset + CHUNK_BYTES)));
				}
			} catch {
				/* the link went away mid-transfer: the other end times out */
			}
		};
		const start = () => {
			this.serving++;
			void run().finally(() => {
				this.serving--;
				this.queue.shift()?.();
			});
		};
		if (this.serving < this.maxServing) start();
		else this.queue.push(start);
	}
}

/** Tries several links in turn (the host asking each guest), skipping any whose channel is not open. */
export class PeerResolver implements AssetResolver {
	readonly name = 'session peers';

	constructor(private getPeers: () => AssetPeer[]) {}

	async resolve(id: AssetId, signal: AbortSignal): Promise<Uint8Array | null> {
		for (const peer of this.getPeers()) {
			if (signal.aborted) return null;
			const bytes = await peer.resolve(id, signal);
			if (bytes) return bytes;
		}
		return null;
	}
}
