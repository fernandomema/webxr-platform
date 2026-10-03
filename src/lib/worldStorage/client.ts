/**
 * Client side of a world's persistent storage: what a codeblock's `ctx.storage` and `ctx.leaderboards` talk to.
 * A transport carries operations somewhere (the server, a throwaway in-memory store for drafts, or nowhere when
 * there is no account); the handle on top gives scripts a small promise API with safe defaults.
 */
import { LEADERBOARD_LIMITS, applyOps, isBetterScore, type LeaderboardOrder, type StorageOp, type StorageScope, type StoredEntry } from './ops.ts';

export type StorageResult = { value: unknown; version: number } | null;

/** Runs a batch of operations atomically. Resolves `null` when storage is not available (no account), so scripts keep working with defaults. */
export interface StorageTransport {
	readonly available: boolean;
	run(scope: StorageScope, ops: StorageOp[]): Promise<StorageResult[] | null>;
}

export interface LeaderboardRow { rank: number; displayName: string; score: number; isMe: boolean }
export interface LeaderboardView { order: LeaderboardOrder | null; rows: LeaderboardRow[]; me: { score: number; rank: number } | null }
export interface SubmitResult { order: LeaderboardOrder; score: number; improved: boolean; rank: number }

/** Leaderboard calls for one participant. `null` results mean the feature is unavailable. */
export interface BoardTransport {
	readonly available: boolean;
	submit(name: string, score: number, order: LeaderboardOrder): Promise<SubmitResult | null>;
	read(name: string, limit: number): Promise<LeaderboardView | null>;
}

async function failure(response: Response): Promise<Error> {
	const detail = await response.json().then((body: { message?: string }) => String(body.message ?? '').slice(0, 160), () => '');
	return new Error(detail || `Storage request failed (HTTP ${response.status})`);
}

type Fetch = typeof fetch;

export function createRemoteStorage(publicationId: string, roomCode: string | null, fetchFn: Fetch = fetch): StorageTransport {
	const query = roomCode ? `?room=${encodeURIComponent(roomCode)}` : '';
	return {
		available: true,
		async run(scope, ops) {
			const response = await fetchFn(`/api/published-worlds/${encodeURIComponent(publicationId)}/storage${query}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ scope, ops }),
				signal: AbortSignal.timeout(15_000)
			});
			if (!response.ok) throw await failure(response);
			return ((await response.json()) as { results: StorageResult[] }).results;
		}
	};
}

export function createRemoteBoards(publicationId: string, roomCode: string | null, fetchFn: Fetch = fetch): BoardTransport {
	const base = `/api/published-worlds/${encodeURIComponent(publicationId)}/leaderboards`;
	return {
		available: true,
		async submit(name, score, order) {
			const response = await fetchFn(`${base}/${encodeURIComponent(name)}${roomCode ? `?room=${encodeURIComponent(roomCode)}` : ''}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ score, order }),
				signal: AbortSignal.timeout(15_000)
			});
			if (!response.ok) throw await failure(response);
			return (await response.json()) as SubmitResult;
		},
		async read(name, limit) {
			const response = await fetchFn(`${base}/${encodeURIComponent(name)}?limit=${limit}`, { signal: AbortSignal.timeout(15_000) });
			if (!response.ok) throw await failure(response);
			return (await response.json()) as LeaderboardView;
		}
	};
}

/** Nothing is saved: used when a published world is played without an account. */
export const unavailableStorage: StorageTransport = { available: false, run: async () => null };
export const unavailableBoards: BoardTransport = { available: false, submit: async () => null, read: async () => null };

/**
 * Throwaway storage for drafts and unpublished worlds, with the same rules as the server. Lives as long as the
 * session; `reset` clears it. `owner` keeps each participant's player data apart.
 */
export class EphemeralStore {
	private data = new Map<string, Map<string, StoredEntry>>();
	private boards = new Map<string, { order: LeaderboardOrder; rows: Map<string, { name: string; score: number }> }>();

	reset(): void {
		this.data.clear();
		this.boards.clear();
	}

	storage(owner: string): StorageTransport {
		return {
			available: true,
			run: async (scope, ops) => {
				const bucket = this.bucket(scope === 'world' ? 'world' : `player:${owner}`);
				const { states, results } = applyOps(bucket, ops);
				for (const [key, state] of states) {
					if (state.kind === 'delete') bucket.delete(key);
					else if (state.kind === 'write') bucket.set(key, state.entry);
				}
				return results.map((entry) => (entry ? { value: structuredClone(entry.value), version: entry.version } : null));
			}
		};
	}

	boardsFor(owner: string, displayName: string): BoardTransport {
		const rank = (board: { order: LeaderboardOrder; rows: Map<string, { name: string; score: number }> }, score: number) =>
			1 + [...board.rows.values()].filter((row) => isBetterScore(board.order, row.score, score)).length;
		return {
			available: true,
			submit: async (name, score, order) => {
				const board = this.boards.get(name) ?? { order, rows: new Map() };
				this.boards.set(name, board);
				const current = board.rows.get(owner);
				const improved = !current || isBetterScore(board.order, score, current.score);
				if (improved) board.rows.set(owner, { name: displayName, score });
				const best = board.rows.get(owner)!.score;
				return { order: board.order, score: best, improved, rank: rank(board, best) };
			},
			read: async (name, limit) => {
				const board = this.boards.get(name);
				if (!board) return { order: null, rows: [], me: null };
				const sorted = [...board.rows.entries()].sort((a, b) => (board.order === 'high' ? b[1].score - a[1].score : a[1].score - b[1].score));
				const mine = board.rows.get(owner);
				return {
					order: board.order,
					rows: sorted.slice(0, Math.min(limit, LEADERBOARD_LIMITS.maxTop)).map(([id, row], index) => ({ rank: index + 1, displayName: row.name, score: row.score, isMe: id === owner })),
					me: mine ? { score: mine.score, rank: rank(board, mine.score) } : null
				};
			}
		};
	}

	private bucket(id: string): Map<string, StoredEntry> {
		let bucket = this.data.get(id);
		if (!bucket) this.data.set(id, (bucket = new Map()));
		return bucket;
	}
}

export interface IncrementOptions { min?: number; max?: number }

/** What a script holds for one scope: `ctx.storage.world` or `ctx.storage.player(player)`. */
export interface StorageHandle {
	/** False when nothing can be saved (published world played without an account): reads return the default, writes do nothing. */
	readonly available: boolean;
	get<T = unknown>(key: string, fallback?: T): Promise<T>;
	/** The value together with its version, for `set(..., { expectedVersion })`; `null` when the key does not exist. */
	getEntry<T = unknown>(key: string): Promise<{ value: T; version: number } | null>;
	set(key: string, value: unknown, options?: { expectedVersion?: number }): Promise<void>;
	increment(key: string, by?: number, options?: IncrementOptions): Promise<number | undefined>;
	addToSet(key: string, value: unknown): Promise<unknown[] | undefined>;
	removeFromSet(key: string, value: unknown): Promise<unknown[] | undefined>;
	remove(key: string): Promise<void>;
	/** Several operations applied together, all or none: `[{ op: 'increment', key: 'coins', by: -100, min: 0 }, { op: 'addToSet', key: 'upgrades', value: 'generator-2' }]`. */
	transaction(ops: StorageOp[]): Promise<StorageResult[]>;
}

export function createStorageHandle(scope: StorageScope, transport: StorageTransport): StorageHandle {
	const single = async (op: StorageOp): Promise<StorageResult> => (await transport.run(scope, [op]))?.[0] ?? null;
	return {
		get available() {
			return transport.available;
		},
		async get<T>(key: string, fallback?: T) {
			const result = await single({ op: 'get', key });
			return (result ? result.value : fallback) as T;
		},
		async getEntry<T>(key: string) {
			return (await single({ op: 'get', key })) as { value: T; version: number } | null;
		},
		async set(key, value, options) {
			await single({ op: 'set', key, value, expectedVersion: options?.expectedVersion });
		},
		async increment(key, by = 1, options) {
			return (await single({ op: 'increment', key, by, ...options }))?.value as number | undefined;
		},
		async addToSet(key, value) {
			return (await single({ op: 'addToSet', key, value }))?.value as unknown[] | undefined;
		},
		async removeFromSet(key, value) {
			return (await single({ op: 'removeFromSet', key, value }))?.value as unknown[] | undefined;
		},
		async remove(key) {
			await single({ op: 'remove', key });
		},
		async transaction(ops) {
			return (await transport.run(scope, ops)) ?? [];
		}
	};
}

/** What a script holds for leaderboards: `ctx.leaderboards`. Boards are created by the first `submit` to a name. */
export interface BoardsHandle {
	readonly available: boolean;
	submit(name: string, player: unknown, score: number, options?: { order?: LeaderboardOrder }): Promise<SubmitResult | null>;
	best(name: string, player: unknown): Promise<{ score: number; rank: number } | null>;
	top(name: string, options?: { limit?: number }): Promise<LeaderboardRow[]>;
}
