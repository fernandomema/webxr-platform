import type { Slot, SlotTree, Vec3 } from './types';

/**
 * Extracts `rootId` and every descendant from `tree` into a standalone
 * SlotTree (the root's parentId is cleared). Used to serialize a single
 * grabbed/selected object out of a live scene for saving into an inventory.
 */
export function extractSubtree(tree: SlotTree, rootId: string): SlotTree {
	const byParent = new Map<string | null, Slot[]>();
	for (const slot of tree) {
		const list = byParent.get(slot.parentId) ?? [];
		list.push(slot);
		byParent.set(slot.parentId, list);
	}

	const result: Slot[] = [];
	const visit = (id: string) => {
		const slot = tree.find((s) => s.id === id);
		if (!slot) return;
		result.push(slot);
		for (const child of byParent.get(id) ?? []) visit(child.id);
	};
	visit(rootId);

	if (result.length === 0) return [];
	return result.map((slot, i) => (i === 0 ? { ...slot, parentId: null } : slot));
}

/**
 * Clones a SlotTree with fresh ids (so the same inventory item can be
 * spawned multiple times into the same scene without id collisions),
 * re-rooted at `origin`.
 */
export function instantiate(tree: SlotTree, origin: Vec3 = [0, 0, 0]): SlotTree {
	const idMap = new Map<string, string>();
	for (const slot of tree) idMap.set(slot.id, crypto.randomUUID());

	const vector = (value: unknown, fallback: number[]) =>
		Array.isArray(value) && value.length === fallback.length && value.every(Number.isFinite) ? value : fallback;
	return tree.map((slot, i) => ({
		...slot,
		id: idMap.get(slot.id)!,
		parentId: slot.parentId ? (idMap.get(slot.parentId) ?? null) : null,
		position: i === 0 ? origin : vector(slot.position, [0, 0, 0]) as Slot['position'],
		rotation: vector(slot.rotation, [0, 0, 0, 1]) as Slot['rotation'],
		scale: vector(slot.scale, [1, 1, 1]) as Slot['scale']
	}));
}

/**
 * A tree as it should start when it comes out of storage: nothing playing. `playing` is the state of an audio player at the
 * moment it was saved (a disc saved while it sat on a record player), not part of what the object is, so a spawned copy does
 * not sound until something starts it (a socket, a script, its own `autoplay`).
 */
export function atRest(tree: SlotTree): SlotTree {
	return tree.map((slot) =>
		slot.components.some((component) => component.type === 'audioPlayer' && component.playing)
			? { ...slot, components: slot.components.map((component) => (component.type === 'audioPlayer' && component.playing ? { ...component, playing: false } : component)) }
			: slot
	);
}

export function toJSON(tree: SlotTree): string {
	return JSON.stringify(tree);
}

export function fromJSON(json: string): SlotTree {
	return JSON.parse(json) as SlotTree;
}
