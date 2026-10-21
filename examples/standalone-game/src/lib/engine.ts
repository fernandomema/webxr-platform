import { configurePlatform, configureFeatures, loadBundle, useStoredToken, type LoadedBundle } from '@kithin/engine';

/** Where Kithin's services live. Set PUBLIC_KITHIN_URL at build time; the site must list this game's origin in ENGINE_ALLOWED_ORIGINS. */
const KITHIN_URL = import.meta.env.PUBLIC_KITHIN_URL ?? 'http://localhost:5173';

let bundle: Promise<LoadedBundle> | null = null;

/** Tells the engine where Kithin is, which parts of its interface this game uses, and where the game's own files are. */
export function setUpEngine(): Promise<LoadedBundle> {
	return (bundle ??= (async () => {
		configurePlatform({ apiBase: KITHIN_URL, name: 'Standalone game' });
		// Accounts: this page is not on Kithin's origin, so a player signs in with a code and the token is kept here.
		useStoredToken('standalone-game.token');
		// A single-player level has no use for the world browser or the in-game inspector.
		configureFeatures({ worldsTab: false, inspector: false });
		return loadBundle('/content/bundle.json');
	})());
}
