import type { Slot, SlotTree, Vec3 } from '$lib/ecs/types';
import { migrateSlotTree } from '$lib/assets/ref';

export function serializeSlotTree(tree: SlotTree): string {
	return JSON.stringify(tree, null, 2);
}

/**
 * Parses pasted/edited raw JSON into a SlotTree for the Studio's "Raw"
 * editor — this is where a whole subtree exported from the live game (the
 * shape `extractSubtree`/`SceneGraph.serialize()` produce: a flat array,
 * root first, descendants linked via parentId) gets pasted back in as one
 * asset. Validates just enough of each Slot's shape to catch a bad paste
 * without silently corrupting the asset; doesn't try to fix broken
 * parentId references (unresolvable ones simply render outside the tree).
 */
export function parseSlotTreeJSON(text: string): { tree: SlotTree } | { error: string } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (err) {
		return { error: err instanceof Error ? `Invalid JSON: ${err.message}` : 'Invalid JSON.' };
	}

	// A single copied Slot object (not wrapped in an array) is a common paste too.
	const candidates = Array.isArray(parsed) ? parsed : [parsed];
	if (candidates.length === 0) return { error: 'Paste at least one slot.' };

	const tree: Slot[] = [];
	for (let i = 0; i < candidates.length; i++) {
		const raw = candidates[i] as Record<string, unknown>;
		if (typeof raw !== 'object' || raw === null) return { error: `Slot ${i} is not an object.` };
		if (typeof raw.id !== 'string' || !raw.id) return { error: `Slot ${i} is missing a string "id".` };
		if (typeof raw.name !== 'string') return { error: `Slot ${i} ("${raw.id}") is missing a string "name".` };
		if (raw.parentId !== null && typeof raw.parentId !== 'string') {
			return { error: `Slot ${i} ("${raw.id}") has an invalid "parentId" — must be a string or null.` };
		}
		if (!isVec3(raw.position)) return { error: `Slot ${i} ("${raw.id}") has an invalid "position" — must be [x, y, z].` };
		if (!isQuat(raw.rotation)) return { error: `Slot ${i} ("${raw.id}") has an invalid "rotation" — must be [x, y, z, w].` };
		if (!isVec3(raw.scale)) return { error: `Slot ${i} ("${raw.id}") has an invalid "scale" — must be [x, y, z].` };
		if (!Array.isArray(raw.components)) return { error: `Slot ${i} ("${raw.id}") is missing a "components" array.` };
		for (const [ci, component] of (raw.components as unknown[]).entries()) {
			if (typeof component !== 'object' || component === null || typeof (component as { type?: unknown }).type !== 'string') {
				return { error: `Slot ${i} ("${raw.id}"), component ${ci} is missing a string "type".` };
			}
		}
		tree.push(raw as unknown as Slot);
	}

	const ids = new Set(tree.map((slot) => slot.id));
	if (ids.size !== tree.length) return { error: 'Duplicate slot ids — every slot needs a unique id.' };

	return { tree: migrateSlotTree(tree) };
}

function isVec3(value: unknown): value is Vec3 {
	return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number');
}

function isQuat(value: unknown): value is [number, number, number, number] {
	return Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number');
}
