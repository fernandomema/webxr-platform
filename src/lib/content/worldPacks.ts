import type { BuiltinWorld } from '@kithin/engine/xr/content/registry';
import { packWorlds } from 'virtual:world-packs';

/** The world packs of `worlds/`, as development worlds. Nothing outside the dev server (the list is empty in a build). */
export async function loadPackWorlds(): Promise<BuiltinWorld[]> {
	const loaded = await Promise.all(
		packWorlds.map(async ({ id, load }) => {
			try {
				const { default: world } = await load();
				return { id, name: world.name, description: world.description, scene: world.build() };
			} catch (error) {
				console.error(`World pack "${id}" failed to load:`, error);
				return null;
			}
		})
	);
	return loaded.filter((world): world is BuiltinWorld => world !== null);
}

export async function findPackWorld(id: string): Promise<BuiltinWorld | undefined> {
	return packWorlds.some((pack) => pack.id === id) ? (await loadPackWorlds()).find((world) => world.id === id) : undefined;
}
