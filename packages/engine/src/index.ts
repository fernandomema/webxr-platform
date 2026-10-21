/**
 * The public face of the engine. An app configures it (where the platform is, what the app ships, which parts of the interface
 * are on, the language) and then mounts a game on a canvas, either with `mountGame` or with the `PlayShell` component
 * (`@kithin/engine/xr/PlayShell.svelte`), which adds the launch screen and the desktop HUD. Everything else is importable by its
 * path (`@kithin/engine/ecs/types`, …) for apps that build on the engine's pieces, such as an editor.
 */
export { configurePlatform, getPlatformConfig, platformFetch, platformUrl, assetUrl, type PlatformConfig } from './xr/platform/config.ts';
export { platformAuth } from './xr/platform/auth.ts';
export { registerContent, type EngineContent, type BuiltinWorld, type StarterKit } from './xr/content/registry.ts';
export { configureFeatures, getFeatures, type EngineFeatures } from './xr/features.ts';
export { setEngineLocale, engineLocale, registerTranslations, translate } from './xr/i18n/locale.ts';
export type { MountedGame, MountGameOptions } from './xr/engine.ts';
export type { WorldPackage } from './worlds/types.ts';

import type { MountedGame, MountGameOptions } from './xr/engine.ts';

/** Boots the game on a canvas. The engine itself (and Babylon with it) is loaded when this is first called. */
export async function mountGame(canvas: HTMLCanvasElement, roomCode?: string, options?: MountGameOptions): Promise<MountedGame> {
	return (await import('./xr/engine.ts')).mountGame(canvas, roomCode, options);
}
