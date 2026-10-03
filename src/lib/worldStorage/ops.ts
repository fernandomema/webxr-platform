/**
 * Pure rules for a published world's persistent storage: request parsing, limits and how each operation
 * changes one stored value. The server applies them inside a database transaction (see
 * server/services/worldStorage.ts); keeping them free of I/O is what makes the atomic cases testable.
 */

export const STORAGE_SCOPES = ['player', 'world'] as const;
export type StorageScope = (typeof STORAGE_SCOPES)[number];

export const STORAGE_LIMITS = {
	maxValueBytes: 16_384,
	maxKeysPerScope: 100,
	maxOpsPerRequest: 20,
	maxKeyLength: 64,
	maxSetItems: 500,
	writesPerMinute: 120
} as const;

export type StorageOp =
	| { op: 'get'; key: string }
	| { op: 'set'; key: string; value: unknown; expectedVersion?: number }
	| { op: 'increment'; key: string; by: number; min?: number; max?: number }
	| { op: 'addToSet'; key: string; value: unknown }
	| { op: 'removeFromSet'; key: string; value: unknown }
	| { op: 'remove'; key: string };

export interface StorageRequest {
	scope: StorageScope;
	ops: StorageOp[];
}

export interface StoredEntry {
	value: unknown;
	version: number;
}

/** What a failed operation means to the caller: `bad` is a malformed request, `conflict` a rule that did not hold (stale version, not enough coins). */
export class StorageOpError extends Error {
	constructor(readonly kind: 'bad' | 'conflict', message: string) {
		super(message);
	}
}

const KEY_PATTERN = /^[A-Za-z0-9_.:-]+$/;
const isPlainNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function assertValidKey(key: unknown): asserts key is string {
	if (typeof key !== 'string' || key.length === 0 || key.length > STORAGE_LIMITS.maxKeyLength || !KEY_PATTERN.test(key)) {
		throw new StorageOpError('bad', 'Invalid storage key');
	}
}

export function assertValidValue(value: unknown): void {
	const json = JSON.stringify(value);
	if (json === undefined) throw new StorageOpError('bad', 'Storage values must be JSON');
	if (json.length > STORAGE_LIMITS.maxValueBytes) throw new StorageOpError('bad', 'Storage value is too large');
}

export function parseStorageRequest(body: unknown): StorageRequest {
	if (!body || typeof body !== 'object') throw new StorageOpError('bad', 'Invalid storage request');
	const { scope, ops } = body as Record<string, unknown>;
	if (!STORAGE_SCOPES.includes(scope as StorageScope)) throw new StorageOpError('bad', 'Invalid storage scope');
	if (!Array.isArray(ops) || ops.length === 0 || ops.length > STORAGE_LIMITS.maxOpsPerRequest) throw new StorageOpError('bad', 'Invalid storage operations');
	return { scope: scope as StorageScope, ops: ops.map(parseOp) };
}

function parseOp(raw: unknown): StorageOp {
	if (!raw || typeof raw !== 'object') throw new StorageOpError('bad', 'Invalid storage operation');
	const o = raw as Record<string, unknown>;
	assertValidKey(o.key);
	const key = o.key;
	switch (o.op) {
		case 'get':
			return { op: 'get', key };
		case 'remove':
			return { op: 'remove', key };
		case 'set':
			assertValidValue(o.value);
			if (o.expectedVersion !== undefined && (!Number.isInteger(o.expectedVersion) || (o.expectedVersion as number) < 0)) throw new StorageOpError('bad', 'Invalid expected version');
			return { op: 'set', key, value: o.value, expectedVersion: o.expectedVersion as number | undefined };
		case 'increment':
			if (!isPlainNumber(o.by)) throw new StorageOpError('bad', 'Increment needs a number');
			for (const bound of [o.min, o.max]) if (bound !== undefined && !isPlainNumber(bound)) throw new StorageOpError('bad', 'Invalid increment bound');
			return { op: 'increment', key, by: o.by, min: o.min as number | undefined, max: o.max as number | undefined };
		case 'addToSet':
		case 'removeFromSet':
			assertValidValue(o.value);
			return { op: o.op, key, value: o.value };
		default:
			throw new StorageOpError('bad', 'Unknown storage operation');
	}
}

export const isWriteOp = (op: StorageOp): boolean => op.op !== 'get';

/** Structural equality for JSON values, so a set holds each distinct item once. */
export function jsonEqual(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

export type OpOutcome =
	| { kind: 'unchanged'; entry: StoredEntry | null }
	| { kind: 'write'; entry: StoredEntry }
	| { kind: 'delete' };

/** Applies one operation to the current entry (null when the key does not exist yet). A version only moves when the stored value really changes. */
export function applyOp(current: StoredEntry | null, op: StorageOp): OpOutcome {
	const next = (value: unknown): OpOutcome => {
		assertValidValue(value);
		return { kind: 'write', entry: { value, version: (current?.version ?? 0) + 1 } };
	};
	switch (op.op) {
		case 'get':
			return { kind: 'unchanged', entry: current };
		case 'set':
			if (op.expectedVersion !== undefined && (current?.version ?? 0) !== op.expectedVersion) throw new StorageOpError('conflict', 'The stored value changed; read it again');
			return next(op.value);
		case 'remove':
			return current ? { kind: 'delete' } : { kind: 'unchanged', entry: null };
		case 'increment': {
			const base = current === null ? 0 : current.value;
			if (!isPlainNumber(base)) throw new StorageOpError('bad', 'Only numbers can be incremented');
			const result = base + op.by;
			if (!Number.isFinite(result)) throw new StorageOpError('bad', 'Number out of range');
			if (op.min !== undefined && result < op.min) throw new StorageOpError('conflict', 'Not enough to spend');
			if (op.max !== undefined && result > op.max) throw new StorageOpError('conflict', 'Over the allowed maximum');
			return next(result);
		}
		case 'addToSet':
		case 'removeFromSet': {
			const base = current === null ? [] : current.value;
			if (!Array.isArray(base)) throw new StorageOpError('bad', 'Only lists can be used as sets');
			const has = base.some((item) => jsonEqual(item, op.value));
			if (op.op === 'addToSet') {
				if (has) return { kind: 'unchanged', entry: current };
				if (base.length >= STORAGE_LIMITS.maxSetItems) throw new StorageOpError('conflict', 'This set is full');
				return next([...base, op.value]);
			}
			if (!has) return { kind: 'unchanged', entry: current };
			return next(base.filter((item) => !jsonEqual(item, op.value)));
		}
	}
}

/** Applies a whole request in order over the current entries. Every operation sees the results of those before it, and the first failure rejects them all. */
export function applyOps(entries: ReadonlyMap<string, StoredEntry>, ops: readonly StorageOp[]): { states: Map<string, OpOutcome>; results: Array<{ value: unknown; version: number } | null> } {
	const working = new Map<string, StoredEntry | null>(entries);
	const states = new Map<string, OpOutcome>();
	const results: Array<{ value: unknown; version: number } | null> = [];
	for (const op of ops) {
		const outcome = applyOp(working.get(op.key) ?? null, op);
		if (outcome.kind === 'delete') {
			working.set(op.key, null);
			states.set(op.key, outcome);
			results.push(null);
		} else if (outcome.kind === 'write') {
			working.set(op.key, outcome.entry);
			states.set(op.key, outcome);
			results.push(outcome.entry);
		} else {
			results.push(outcome.entry);
		}
	}
	return { states, results };
}

// --- leaderboards ---

export const LEADERBOARD_LIMITS = { maxEntries: 10_000, maxTop: 100, maxScore: 1e12, submitsPerMinute: 60 } as const;
export const LEADERBOARD_ORDERS = ['high', 'low'] as const;
export type LeaderboardOrder = (typeof LEADERBOARD_ORDERS)[number];

export function assertValidBoardName(name: unknown): asserts name is string {
	if (typeof name !== 'string' || name.length === 0 || name.length > STORAGE_LIMITS.maxKeyLength || !KEY_PATTERN.test(name)) throw new StorageOpError('bad', 'Invalid leaderboard name');
}

export function assertValidScore(score: unknown): asserts score is number {
	if (!isPlainNumber(score) || Math.abs(score) > LEADERBOARD_LIMITS.maxScore) throw new StorageOpError('bad', 'Invalid score');
}

export function isBetterScore(order: LeaderboardOrder, candidate: number, current: number): boolean {
	return order === 'high' ? candidate > current : candidate < current;
}

// --- relaying a guest's own data through the host ---

/**
 * What a host asks a guest's client to do with that guest's account. The guest runs it with its own session and
 * only for the publication its room declared, so the host never holds a credential for anyone else.
 */
export type PlayerApiCall =
	| { api: 'storage'; ops: StorageOp[] }
	| { api: 'board-submit'; name: string; score: number; order: LeaderboardOrder }
	| { api: 'board-read'; name: string; limit: number };

export type PlayerApiResult = { ok: true; unavailable?: boolean; data?: unknown } | { ok: false; error: string };

export function parsePlayerApiCall(raw: unknown): PlayerApiCall {
	if (!raw || typeof raw !== 'object') throw new StorageOpError('bad', 'Invalid request');
	const call = raw as Record<string, unknown>;
	if (call.api === 'storage') return { api: 'storage', ops: parseStorageRequest({ scope: 'player', ops: call.ops }).ops };
	assertValidBoardName(call.name);
	if (call.api === 'board-submit') {
		assertValidScore(call.score);
		if (!LEADERBOARD_ORDERS.includes(call.order as LeaderboardOrder)) throw new StorageOpError('bad', 'Invalid leaderboard order');
		return { api: 'board-submit', name: call.name, score: call.score, order: call.order as LeaderboardOrder };
	}
	if (call.api === 'board-read') {
		const limit = Number.isInteger(call.limit) ? Math.min(LEADERBOARD_LIMITS.maxTop, Math.max(1, call.limit as number)) : 10;
		return { api: 'board-read', name: call.name, limit };
	}
	throw new StorageOpError('bad', 'Unknown request');
}
