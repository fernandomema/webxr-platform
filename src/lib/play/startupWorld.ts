import type { WorldPackage } from '@kithin/engine/worlds/types';
import type { SlotTree } from '@kithin/engine/ecs/types';
import { findBuiltinWorld } from '@kithin/engine/xr/content/registry';
import { platformFetch } from '@kithin/engine/xr/platform/config';

const packageOf = (name: string, scene: SlotTree): WorldPackage => ({ formatVersion: 1, name: (name.trim() || 'Untitled world').slice(0, 120), scene: structuredClone(scene), defaultVisibility: 'solo' });

/**
 * The world a play page opens on its own, if its address names one: a published world (or a built-in one) by id, a built-in
 * one by `?world=`, or the scene the Studio hands over with `?studioPlay=` (through localStorage) when its "Play" is pressed.
 */
export async function loadStartupWorld(worldId: string | undefined, params: URLSearchParams): Promise<WorldPackage | undefined> {
	if (worldId) {
		const builtin = await findBuiltinWorld(worldId);
		if (builtin) return packageOf(builtin.name, builtin.scene);
		const response = await platformFetch(`/api/published-worlds/${encodeURIComponent(worldId)}`);
		if (!response.ok) throw new Error('Could not load the published world');
		return (await response.json()) as WorldPackage;
	}
	const studioPlayKey = params.get('studioPlay');
	if (studioPlayKey) {
		const storageKey = `studio:play:${studioPlayKey}`;
		try {
			const raw = localStorage.getItem(storageKey);
			localStorage.removeItem(storageKey);
			if (!raw) return undefined;
			const { name, scene } = JSON.parse(raw) as { name: string; scene: SlotTree };
			return packageOf(name, scene);
		} catch (error) {
			console.error('Could not play the Studio scene', error);
			return undefined;
		}
	}
	const builtin = await findBuiltinWorld(params.get('world') ?? '');
	return builtin ? packageOf(builtin.name, builtin.scene) : undefined;
}
