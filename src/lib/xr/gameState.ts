/**
 * Plain mutable state shared between the imperative Babylon engine code and
 * the Dash panel UI — not a Svelte store, since none of this lives inside
 * component reactivity; read on demand (e.g. when a tab is opened).
 */
import type { WorldVisibility } from '$lib/worldVisibility';

/** The inventory world the current scene was loaded from, so saving can add a revision to it instead of creating a new world. */
export interface LoadedWorld {
	adapterId: 'local' | 'world' | 'cloud' | 'filesystem';
	worldLineageId: string;
	folderId: string | null;
	name: string;
	revisionNumber: number | null;
}

/** The published world (and revision) the current scene was launched from. Persistent storage is keyed by `publicationId`; the server re-verifies it on every request, so this is never trusted on its own. */
export interface PublicationContext {
	publicationId: string;
	revisionId: string | null;
}

export interface GameState {
	loadedWorld: LoadedWorld | null;
	publication: PublicationContext | null;
	worldId: string | null;
	worldName: string | null;
	roomCode: string | null;
	worldVisibility: WorldVisibility | null;
	sessionStartedAt: string | null;
	role: 'solo' | 'host' | 'guest';
	userId: string | null;
	userName: string | null;
	/** Which inventory root is open in the Dash's Inventory tab ('local' | 'world' | 'cloud'), or null at the very root. */
	currentInventoryAdapterId: string | null;
	/** The folder open within that adapter ("pwd") — null means that adapter's own root folder. */
	currentInventoryFolderId: string | null;
}

export const gameState: GameState = {
	loadedWorld: null,
	publication: null,
	worldId: null,
	worldName: null,
	roomCode: null,
	worldVisibility: null,
	sessionStartedAt: null,
	role: 'solo',
	userId: null,
	userName: null,
	currentInventoryAdapterId: null,
	currentInventoryFolderId: null
};

export function getInventoryContext() {
	return { worldId: gameState.worldId, userId: gameState.userId };
}
