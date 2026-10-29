/**
 * What this site tells the engine (`$lib/xr`) about itself: where its platform services are, what it ships, and the language
 * it speaks. The engine knows none of this by itself; it is imported by the root layout so every page that uses the engine
 * (the play pages, the Studio) finds it already said.
 */
import { PUBLIC_STUN_URLS } from '$env/static/public';
import { PLATFORM_NAME } from '$lib/platform';
import { configurePlatform } from '@kithin/engine/xr/platform/config';
import { registerContent } from '@kithin/engine/xr/content/registry';
import { BUNDLED_ASSETS } from '$lib/content/bundledAssets';
import pulse from '$lib/content/templates/pulse.json';
import type { SlotTree } from '@kithin/engine/ecs/types';
import { paintDisc } from '$lib/content/templates/recordDisc';

configurePlatform({ stunUrls: PUBLIC_STUN_URLS, name: PLATFORM_NAME });

/** The only scripts allowed to call a route of our own site are the ones the game ships: the Feedback Center's, byte for byte. */
const feedbackCode = new Set((pulse as SlotTree).flatMap((slot) => slot.components.flatMap((component) => (component.type === 'codeBlock' ? [component.code] : []))));

registerContent({
	loadWorlds: async () => {
		const { BUILTIN_WORLDS, DEV_WORLD_IDS } = await import('$lib/content/templates/builtinWorlds');
		// The local packs of worlds/ (dev server only) are development worlds too.
		const packs = await (await import('$lib/content/worldPacks')).loadPackWorlds();
		return { worlds: [...BUILTIN_WORLDS, ...packs], devWorldIds: [...DEV_WORLD_IDS, ...packs.map((world) => world.id)] };
	},
	loadHome: async () => {
		const [{ default: lobby }, { buildLobbyExtras }] = await Promise.all([import('$lib/content/templates/lobby.json'), import('$lib/content/templates/lobbyExtras')]);
		return [...lobby, ...buildLobbyExtras()] as SlotTree;
	},
	preloadWorlds: true,
	loadStarterKit: async () => (await import('$lib/content/starterKit/catalog')).starterKit,
	// A record disc's label, rim and grooves follow its title, author and colours.
	repainters: { recordDisc: paintDisc },
	bundledAssets: BUNDLED_ASSETS,
	worldPreviewBase: '/assets/world-previews',
	sameOriginPathsFor: (code) => (feedbackCode.has(code) ? ['/api/feedback'] : [])
});
