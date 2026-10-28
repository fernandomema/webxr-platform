import { configurePlatform, configureFeatures, loadBundle, useStoredToken, type LoadedBundle, type WorldPackage } from '@kithin/engine';
import type { GameConfig } from './index.ts';

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Tells the engine what the game declared and returns how to find its first world. Call it before the component that mounts the
 * engine is created.
 */
export function startGame(game: GameConfig, env: Record<string, string | undefined> = import.meta.env ?? {}): { loadWorld: () => Promise<WorldPackage | undefined>; content: () => Promise<LoadedBundle> } {
	configurePlatform({
		...game.platform,
		apiBase: game.kithinUrl ?? env.VITE_KITHIN_URL ?? 'https://localhost:5173',
		appId: game.appId ?? (env.VITE_KITHIN_APP_ID || null),
		name: game.name
	});
	// This page is not on Kithin's origin, so a player signs in with a code and the token is kept here.
	useStoredToken(game.tokenKey ?? `${slug(game.name)}.token`);
	configureFeatures({ worldsTab: false, inspector: false, ...game.features });

	let bundle: Promise<LoadedBundle> | null = null;
	const content = () => (bundle ??= loadBundle(game.contentUrl ?? '/content/bundle.json'));
	const loadWorld = async () => {
		const loaded = await content();
		const id = game.world ?? loaded.manifest.home;
		return id === undefined ? undefined : loaded.world(id);
	};
	return { loadWorld, content };
}
