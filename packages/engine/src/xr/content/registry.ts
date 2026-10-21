import type { SlotTree } from '../../ecs/types.ts';
import type { AssetId } from '../../assets/ref.ts';

/** A world that ships with the app: always there to go to. */
export interface BuiltinWorld {
	id: string;
	name: string;
	description: string;
	scene: SlotTree;
}

export interface StarterKitFolder {
	id: string;
	name: string;
	/** The folder this one is inside; none (the default) for a folder at the top of the kit. */
	parentId?: string;
}

export interface StarterKitEntry {
	id: string;
	folderId: string;
	name: string;
	/** A fresh tree on every call, so nobody shares (or edits) the catalog's own data. */
	build: () => SlotTree;
}

/** Ready-made objects every player has, listed read-only in the inventory. */
export interface StarterKit {
	folders: StarterKitFolder[];
	entries: StarterKitEntry[];
}

/**
 * What the app that hosts the engine ships with it: the worlds to go to, the scene to stand in before going anywhere, the
 * starter objects and the files addressed by content hash that its worlds use. The engine has none of this of its own; every
 * part is optional, and is loaded when it is first needed so an app only pays for what is used.
 */
export interface EngineContent {
	/** The worlds listed in the Worlds tab; `devWorldIds` are the ones shown under Development instead of the official ones. */
	loadWorlds: () => Promise<{ worlds: readonly BuiltinWorld[]; devWorldIds: readonly string[] }>;
	/** The scene shown when no world was asked for (a lobby). Without it the player starts on a plain floor. */
	loadHome: () => Promise<SlotTree>;
	loadStarterKit: () => Promise<StarterKit>;
	/** Files that ship with the app, by the content hash they have, for worlds that name them. */
	bundledAssets: Partial<Record<AssetId, string>>;
	/** Where the pictures of the built-in worlds are served from (`<base>/<id>.webp`). */
	worldPreviewBase: string;
	/** Redraws the parts a component's slot is made of from the component's own fields, by component type (a record disc's label follows its title). */
	repainters: Record<string, (tree: SlotTree, slotId: string) => SlotTree>;
	/** The paths of the app's own API a script may call, if it is one of the scripts the app ships (byte for byte). */
	sameOriginPathsFor: (code: string) => string[];
}

const content: Partial<EngineContent> = {};
const listeners = new Set<() => void>();

/** Says what the hosting app ships. Can be called more than once; each call adds to (or replaces) what was said before. */
export function registerContent(next: Partial<EngineContent>): void {
	Object.assign(content, next);
	for (const listener of listeners) listener();
}

export function getContent(): Readonly<Partial<EngineContent>> {
	return content;
}

/** Calls `listener` whenever content is registered. Returns a function that stops it. */
export function onContentRegistered(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export async function loadBuiltinWorlds(): Promise<{ worlds: readonly BuiltinWorld[]; devWorldIds: readonly string[] }> {
	return (await content.loadWorlds?.()) ?? { worlds: [], devWorldIds: [] };
}

export async function findBuiltinWorld(id: string): Promise<BuiltinWorld | undefined> {
	return (await loadBuiltinWorlds()).worlds.find((world) => world.id === id);
}
