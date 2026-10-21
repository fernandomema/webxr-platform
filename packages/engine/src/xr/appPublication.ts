import type { WorldSource } from '../worlds/types.ts';
import type { PublicationContext } from './gameState.ts';

/**
 * Whose saved data, leaderboards and shop a world uses. A world published on Kithin has its own; any other world a game opens takes
 * the game's app (`appId` in the platform configuration), so every level of a game shares one set. Without either there is none.
 */
export function publicationFor(source: WorldSource | undefined, appId: string | null): PublicationContext | null {
	if (source?.kind === 'published') return { publicationId: source.worldId, revisionId: source.revisionId ?? null };
	return appId ? { publicationId: appId, revisionId: null } : null;
}
