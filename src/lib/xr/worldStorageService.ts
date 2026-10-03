import {
	EphemeralStore, createRemoteBoards, createRemoteStorage, createStorageHandle, unavailableBoards, unavailableStorage,
	type BoardTransport, type BoardsHandle, type StorageHandle, type StorageTransport
} from '../worldStorage/client.ts';
import { LEADERBOARD_LIMITS, parsePlayerApiCall, type LeaderboardOrder, type PlayerApiCall, type PlayerApiResult } from '../worldStorage/ops.ts';
import type { PublicationContext } from './gameState';

export interface WorldStorageDeps {
	getLocalPlayerId(): string;
	getPlayerName(playerId: string): string;
	getPublication(): PublicationContext | null;
	getRoomCode(): string | null;
	getRole(): 'solo' | 'host' | 'guest';
	isSignedIn(): boolean;
	/** Host only: asks the connected guest `playerId` to run `call` with its own account. */
	relay(playerId: string, call: PlayerApiCall): Promise<PlayerApiResult>;
	fetch?: typeof fetch;
}

const playerId = (player: unknown): string => {
	const id = typeof player === 'string' ? player : (player as { id?: unknown } | null)?.id;
	if (typeof id !== 'string' || id.length === 0) throw new Error('Expected a player (an object with an id)');
	return id;
};

/**
 * Decides where a script's storage calls go: the server for a published world and a signed-in participant, a
 * throwaway in-memory store while the world is a draft, nothing when there is no account, and the guest's own
 * client when the host asks about a guest's data. See the plan in docs for the trust model.
 */
export class WorldStorageService {
	private ephemeral = new EphemeralStore();

	constructor(private deps: WorldStorageDeps) {}

	/** Forgets draft data; called when the session ends. */
	reset(): void {
		this.ephemeral.reset();
	}

	private remote(publicationId: string): { storage: StorageTransport; boards: BoardTransport } {
		const room = this.deps.getRole() === 'guest' ? this.deps.getRoomCode() : null;
		return { storage: createRemoteStorage(publicationId, room, this.deps.fetch), boards: createRemoteBoards(publicationId, room, this.deps.fetch) };
	}

	private local(id: string): { storage: StorageTransport; boards: BoardTransport } {
		const publication = this.deps.getPublication();
		if (!publication) return { storage: this.ephemeral.storage(id), boards: this.ephemeral.boardsFor(id, this.deps.getPlayerName(id)) };
		if (!this.deps.isSignedIn()) return { storage: unavailableStorage, boards: unavailableBoards };
		return this.remote(publication.publicationId);
	}

	/** The transports for a participant, chosen on every call so they follow the session as it changes. */
	private transportsFor(id: string): { storage: StorageTransport; boards: BoardTransport } {
		if (id === this.deps.getLocalPlayerId()) return this.local(id);
		if (!this.deps.getPublication() && this.deps.getRole() !== 'guest') {
			return { storage: this.ephemeral.storage(id), boards: this.ephemeral.boardsFor(id, this.deps.getPlayerName(id)) };
		}
		if (this.deps.getRole() === 'guest') {
			const refuse = () => Promise.reject(new Error("Only the host can use another player's data"));
			return { storage: { available: false, run: refuse }, boards: { available: false, submit: refuse, read: refuse } };
		}
		const call = async (c: PlayerApiCall): Promise<unknown> => {
			const result = await this.deps.relay(id, c);
			if (!result.ok) throw new Error(result.error);
			return result.unavailable ? null : (result.data ?? null);
		};
		return {
			storage: { available: true, run: async (_scope, ops) => (await call({ api: 'storage', ops })) as never },
			boards: {
				available: true,
				submit: async (name, score, order) => (await call({ api: 'board-submit', name, score, order })) as never,
				read: async (name, limit) => (await call({ api: 'board-read', name, limit })) as never
			}
		};
	}

	private dynamicStorage(id: () => string, scope: 'player' | 'world'): StorageHandle {
		const transport: StorageTransport = {
			get available() {
				return resolve().available;
			},
			run: (s, ops) => resolve().run(s, ops)
		};
		const resolve = () => (scope === 'world' ? this.local(this.deps.getLocalPlayerId()).storage : this.transportsFor(id()).storage);
		return createStorageHandle(scope, transport);
	}

	player(player: unknown): StorageHandle {
		const id = playerId(player);
		return this.dynamicStorage(() => id, 'player');
	}

	get world(): StorageHandle {
		return this.dynamicStorage(() => this.deps.getLocalPlayerId(), 'world');
	}

	get available(): boolean {
		const publication = this.deps.getPublication();
		return !publication || this.deps.isSignedIn();
	}

	get boards(): BoardsHandle {
		const service = this;
		return {
			get available() {
				return service.available;
			},
			async submit(name: string, player: unknown, score: number, options?: { order?: LeaderboardOrder }) {
				return service.transportsFor(playerId(player)).boards.submit(name, score, options?.order ?? 'high');
			},
			async best(name: string, player: unknown) {
				return (await service.transportsFor(playerId(player)).boards.read(name, 1))?.me ?? null;
			},
			async top(name: string, options?: { limit?: number }) {
				const limit = Math.min(LEADERBOARD_LIMITS.maxTop, Math.max(1, Math.floor(options?.limit ?? 10)));
				// Anyone can read a board, so the host's own transport serves it.
				return (await service.local(service.deps.getLocalPlayerId()).boards.read(name, limit))?.rows ?? [];
			}
		};
	}

	/** Guest side: runs what the host asked, with this client's own account. Anything malformed or outside the player scope is refused. */
	async handleRelayed(publicationId: string, raw: unknown): Promise<PlayerApiResult> {
		try {
			const call = parsePlayerApiCall(raw);
			if (typeof publicationId !== 'string' || publicationId.length === 0 || publicationId.length > 64) return { ok: false, error: 'Invalid publication' };
			if (!this.deps.isSignedIn()) return { ok: true, unavailable: true };
			const { storage, boards } = this.remote(publicationId);
			if (call.api === 'storage') return { ok: true, data: await storage.run('player', call.ops) };
			if (call.api === 'board-submit') return { ok: true, data: await boards.submit(call.name, call.score, call.order) };
			return { ok: true, data: await boards.read(call.name, call.limit) };
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message.slice(0, 160) : 'Storage request failed' };
		}
	}
}
