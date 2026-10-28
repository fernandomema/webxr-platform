import type { EngineFeatures, PlatformConfig } from '@kithin/engine';

/** What a game says about itself. Everything but the name has a default. */
export interface GameConfig {
	/** Shown on the launch screen and as the page title. */
	name: string;
	/** The world to start in: its file name under `static/content/worlds` without `.json`. Defaults to the first one. */
	world?: string;
	/** Where Kithin's services live. Defaults to `VITE_KITHIN_URL`, then to `https://localhost:5173`. */
	kithinUrl?: string;
	/**
	 * The id of the game's app (Kithin → Settings → Apps), which also lists the sites the game runs on. Defaults to `VITE_KITHIN_APP_ID`;
	 * without one the game is anonymous.
	 */
	appId?: string;
	/** Where the signed-in token is kept in the browser's storage. Defaults to the name as a slug plus `.token`, as in `rounds-vr.token`. */
	tokenKey?: string;
	/** Which parts of the engine's interface are on. A game has no use for the world browser or the in-game inspector, so they start off. */
	features?: Partial<EngineFeatures>;
	/** Any other platform setting (`signalingUrl`, `stunUrls`, `assetBase`…). */
	platform?: Partial<Omit<PlatformConfig, 'apiBase' | 'appId' | 'name' | 'getToken' | 'setToken'>>;
	/** The content bundle `kithin-game` writes from `static/content`. */
	contentUrl?: string;
}

/** Declares the game in `src/game.ts`: `export default defineGame({ name: 'My game' })`. */
export function defineGame(config: GameConfig): GameConfig {
	return config;
}
