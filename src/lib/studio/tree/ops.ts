import type { Component, Slot, SlotTree } from '../../ecs/types';

/**
 * Pure, immutable operations on a SlotTree. Every function returns a new
 * tree (or `null` when the operation is not allowed) and never mutates its
 * input, so the Studio document can snapshot trees for undo/redo cheaply.
 */

export function cloneTree(tree: SlotTree): SlotTree {
	// SlotTree is deliberately JSON data. JSON cloning also unwraps Svelte 5
	// reactive proxies, which cannot be passed to structuredClone directly.
	return JSON.parse(JSON.stringify(tree)) as SlotTree;
}

export function getSlot(tree: SlotTree, id: string | null): Slot | undefined {
	return id ? tree.find((slot) => slot.id === id) : undefined;
}

export function childrenOf(tree: SlotTree, parentId: string | null): Slot[] {
	return tree.filter((slot) => slot.parentId === parentId);
}

/** Ids of `id` and everything below it. */
export function subtreeIds(tree: SlotTree, id: string): Set<string> {
	const result = new Set<string>([id]);
	let grew = true;
	while (grew) {
		grew = false;
		for (const slot of tree) {
			if (slot.parentId && result.has(slot.parentId) && !result.has(slot.id)) {
				result.add(slot.id);
				grew = true;
			}
		}
	}
	return result;
}

/** Slots whose parent is missing from the tree count as roots too. */
export function rootSlots(tree: SlotTree): Slot[] {
	const ids = new Set(tree.map((slot) => slot.id));
	return tree.filter((slot) => slot.parentId === null || !ids.has(slot.parentId));
}

export function addSlot(
	tree: SlotTree,
	parentId: string | null,
	partial: Partial<Slot> & { name: string },
	newId: () => string = () => crypto.randomUUID()
): { tree: SlotTree; id: string } {
	const id = partial.id ?? newId();
	const slot: Slot = {
		id,
		parentId: getSlot(tree, parentId) ? parentId : null,
		name: partial.name,
		position: partial.position ?? [0, 0, 0],
		rotation: partial.rotation ?? [0, 0, 0, 1],
		scale: partial.scale ?? [1, 1, 1],
		components: partial.components ?? []
	};
	return { tree: [...tree, slot], id };
}

/** A tree must keep at least one slot, so deleting the last root is refused. */
export function canRemoveSlot(tree: SlotTree, id: string): boolean {
	if (!getSlot(tree, id)) return false;
	const doomed = subtreeIds(tree, id);
	return tree.some((slot) => !doomed.has(slot.id));
}

export function removeSlot(tree: SlotTree, id: string): SlotTree | null {
	if (!canRemoveSlot(tree, id)) return null;
	const doomed = subtreeIds(tree, id);
	return tree.filter((slot) => !doomed.has(slot.id));
}

/** Clones a slot and all its descendants with fresh ids, inserted right after the original subtree. */
export function duplicateSlot(
	tree: SlotTree,
	id: string,
	newId: () => string = () => crypto.randomUUID()
): { tree: SlotTree; id: string } | null {
	const source = getSlot(tree, id);
	if (!source) return null;
	const ids = subtreeIds(tree, id);
	const remap = new Map<string, string>();
	for (const oldId of ids) remap.set(oldId, newId());

	const copies = cloneTree(tree.filter((slot) => ids.has(slot.id))).map((slot) => {
		const copy: Slot = { ...slot, id: remap.get(slot.id)!, parentId: slot.parentId ? (remap.get(slot.parentId) ?? slot.parentId) : null };
		if (slot.id === id) copy.name = `${slot.name} copy`;
		return copy;
	});

	let lastIndex = -1;
	tree.forEach((slot, index) => {
		if (ids.has(slot.id)) lastIndex = index;
	});
	const next = [...tree.slice(0, lastIndex + 1), ...copies, ...tree.slice(lastIndex + 1)];
	return { tree: next, id: remap.get(id)! };
}

/**
 * Inserts a copy of another tree (an inventory object, a pasted fragment)
 * under `parentId`, giving every slot a fresh id. Its roots become children
 * of the parent; returns the id of the first root.
 */
export function insertSubtree(
	tree: SlotTree,
	parentId: string | null,
	fragment: SlotTree,
	newId: () => string = () => crypto.randomUUID()
): { tree: SlotTree; id: string; idMap: Record<string, string> } | null {
	if (fragment.length === 0) return null;
	const target = getSlot(tree, parentId) ? parentId : null;
	const ids = new Set(fragment.map((slot) => slot.id));
	const remap = new Map<string, string>();
	for (const slot of fragment) remap.set(slot.id, newId());
	const copies = cloneTree(fragment).map((slot) => ({
		...slot,
		id: remap.get(slot.id)!,
		parentId: slot.parentId && ids.has(slot.parentId) ? remap.get(slot.parentId)! : target
	}));
	const firstRoot = copies.find((slot) => slot.parentId === target) ?? copies[0];
	return { tree: [...tree, ...copies], id: firstRoot.id, idMap: Object.fromEntries(remap) };
}

/** Moves a slot under a new parent (or to the root). Refuses cycles. The local transform is kept as is. */
export function reparent(tree: SlotTree, id: string, newParentId: string | null): SlotTree | null {
	if (!getSlot(tree, id)) return null;
	if (newParentId !== null) {
		if (!getSlot(tree, newParentId)) return null;
		if (subtreeIds(tree, id).has(newParentId)) return null;
	}
	return tree.map((slot) => (slot.id === id ? { ...slot, parentId: newParentId } : slot));
}

export function updateSlot(tree: SlotTree, id: string, patch: Partial<Omit<Slot, 'id'>>): SlotTree {
	return tree.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot));
}

export function addComponent(tree: SlotTree, id: string, component: Component): SlotTree {
	return tree.map((slot) => (slot.id === id ? { ...slot, components: [...slot.components, component] } : slot));
}

export function removeComponent(tree: SlotTree, id: string, index: number): SlotTree {
	return tree.map((slot) =>
		slot.id === id ? { ...slot, components: slot.components.filter((_, i) => i !== index) } : slot
	);
}

/** Sets (or, with `undefined`, clears) one field of one component. */
export function setComponentField(tree: SlotTree, id: string, index: number, key: string, value: unknown): SlotTree {
	return tree.map((slot) => {
		if (slot.id !== id || !slot.components[index]) return slot;
		const next = { ...slot.components[index] } as Record<string, unknown>;
		if (value === undefined) delete next[key];
		else next[key] = value;
		return { ...slot, components: slot.components.map((c, i) => (i === index ? (next as unknown as Component) : c)) };
	});
}

export interface TreeRow {
	slot: Slot;
	depth: number;
}

/**
 * Flattens a SlotTree into depth-first hierarchy order (every parent
 * immediately followed by its whole subtree) with an accurate `depth`. A slot
 * whose parentId doesn't resolve inside this tree (a fragment pasted without
 * its root, for example) still renders — as its own root.
 */
export function flattenTree(tree: SlotTree, collapsed: ReadonlySet<string> = new Set()): TreeRow[] {
	const byParent = new Map<string | null, Slot[]>();
	for (const slot of tree) {
		const list = byParent.get(slot.parentId) ?? [];
		list.push(slot);
		byParent.set(slot.parentId, list);
	}

	const rows: TreeRow[] = [];
	const visited = new Set<string>();
	const visit = (parentId: string | null, depth: number) => {
		for (const slot of byParent.get(parentId) ?? []) {
			if (visited.has(slot.id)) continue;
			visited.add(slot.id);
			rows.push({ slot, depth });
			if (!collapsed.has(slot.id)) visit(slot.id, depth + 1);
			else markSubtree(slot.id);
		}
	};
	const markSubtree = (id: string) => {
		for (const child of byParent.get(id) ?? []) {
			visited.add(child.id);
			markSubtree(child.id);
		}
	};
	visit(null, 0);
	for (const slot of tree) {
		if (!visited.has(slot.id)) {
			visited.add(slot.id);
			rows.push({ slot, depth: 0 });
			if (!collapsed.has(slot.id)) visit(slot.id, 1);
		}
	}
	return rows;
}
