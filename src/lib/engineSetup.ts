/**
 * What this site tells the engine (`$lib/xr`) about itself: where its platform services are, what it ships, and the language
 * it speaks. The engine knows none of this by itself; it is imported by the root layout so every page that uses the engine
 * (the play pages, the Studio) finds it already said.
 */
import { PUBLIC_STUN_URLS } from '$env/static/public';
import { PLATFORM_NAME } from '$lib/platform';
import { configurePlatform } from '$lib/xr/platform/config';
import { registerContent } from '$lib/xr/content/registry';
import { BUNDLED_ASSETS } from '$lib/content/bundledAssets';
import pulse from '$lib/xr/templates/pulse.json';
import type { SlotTree } from '$lib/ecs/types';

configurePlatform({ stunUrls: PUBLIC_STUN_URLS, name: PLATFORM_NAME });

/** The only scripts allowed to call a route of our own site are the ones the game ships: the Feedback Center's, byte for byte. */
const feedbackCode = new Set((pulse as SlotTree).flatMap((slot) => slot.components.flatMap((component) => (component.type === 'codeBlock' ? [component.code] : []))));

registerContent({
	loadWorlds: async () => {
		const { BUILTIN_WORLDS, DEV_WORLD_IDS } = await import('$lib/xr/templates/builtinWorlds');
		return { worlds: BUILTIN_WORLDS, devWorldIds: DEV_WORLD_IDS };
	},
	loadHome: async () => {
		const [{ default: lobby }, { buildLobbyExtras }] = await Promise.all([import('$lib/xr/templates/lobby.json'), import('$lib/xr/templates/lobbyExtras')]);
		return [...lobby, ...buildLobbyExtras()] as SlotTree;
	},
	loadStarterKit: async () => (await import('$lib/content/starterKit/catalog')).starterKit,
	bundledAssets: BUNDLED_ASSETS,
	worldPreviewBase: '/assets/world-previews',
	sameOriginPathsFor: (code) => (feedbackCode.has(code) ? ['/api/feedback'] : [])
});
