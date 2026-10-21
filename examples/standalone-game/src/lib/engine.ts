import { configurePlatform, configureFeatures, loadBundle, useStoredToken, type LoadedBundle } from '@kithin/engine';

// Where Kithin's services live, and the id of this game's app (Settings → Apps on Kithin, which also lists the site this game runs on).
// Set VITE_KITHIN_URL and VITE_KITHIN_APP_ID when building. Kithin's dev server is https with a certificate of its own: open it once in
// this browser and accept it, or its API will not answer (the game still starts, without an account).
const KITHIN_URL = import.meta.env.VITE_KITHIN_URL ?? 'https://localhost:5173';
const APP_ID = import.meta.env.VITE_KITHIN_APP_ID || null;

/**
 * Tells the engine where Kithin is and which parts of its interface this game uses. Call it before the game component is created: the
 * launch screen reads the game's name and the features when it appears.
 */
export function configureEngine(): void {
	configurePlatform({ apiBase: KITHIN_URL, appId: APP_ID, name: 'Standalone game' });
	// Accounts: this page is not on Kithin's origin, so a player signs in with a code and the token is kept here.
	useStoredToken('standalone-game.token');
	// A single-player level has no use for the world browser or the in-game inspector.
	configureFeatures({ worldsTab: false, inspector: false });
}

let bundle: Promise<LoadedBundle> | null = null;

/** The game's own worlds and files (see `kithin-engine-bundle`). */
export function loadContent(): Promise<LoadedBundle> {
	return (bundle ??= loadBundle('/content/bundle.json'));
}
