import { configurePlatform, configureFeatures, loadBundle, useStoredToken, type LoadedBundle } from '@kithin/engine';

/** Where Kithin's services live, and the id of this game's app (Settings → Apps on Kithin, which also lists this site's origin). Set at build time. */
const KITHIN_URL = import.meta.env.PUBLIC_KITHIN_URL ?? 'http://localhost:5173';
const APP_ID = import.meta.env.PUBLIC_KITHIN_APP_ID ?? null;

let bundle: Promise<LoadedBundle> | null = null;

/** Tells the engine where Kithin is, which parts of its interface this game uses, and where the game's own files are. */
export function setUpEngine(): Promise<LoadedBundle> {
	return (bundle ??= (async () => {
		configurePlatform({ apiBase: KITHIN_URL, appId: APP_ID, name: 'Standalone game' });
		// Accounts: this page is not on Kithin's origin, so a player signs in with a code and the token is kept here.
		useStoredToken('standalone-game.token');
		// A single-player level has no use for the world browser or the in-game inspector.
		configureFeatures({ worldsTab: false, inspector: false });
		return loadBundle('/content/bundle.json');
	})());
}
