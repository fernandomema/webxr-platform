import { Observable } from '@babylonjs/core';

/**
 * Fired around every mirror's reflection render. Things that are hidden from the player's own eyes but
 * belong in a reflection (their own avatar's head) show themselves for the duration.
 */
export const mirrorRenderHooks = {
	before: new Observable<void>(),
	after: new Observable<void>()
};
