import type { Component, Slot, SlotTree, Vec3 } from '$lib/ecs/types';
import { eulerToQuat } from '$lib/math/euler';
import { componentSchema, type ComponentType } from '../schema/components';
import * as ops from '../tree/ops';
import { History } from './history';

export type DocumentKind = 'object' | 'world';

/**
 * The single source of truth for what the editor is showing: the slot tree,
 * the selection, undo/redo and the "unsaved changes" flag. UI components call
 * these methods instead of mutating the tree themselves.
 */
export class StudioDocument {
	tree = $state.raw<SlotTree>([]);
	selectedId = $state<string | null>(null);
	name = $state('Untitled');
	kind = $state<DocumentKind>('object');
	/** Serialized tree + name at the last save/load, used to compute `dirty`. */
	private saved = $state('');
	private history = new History<SlotTree>();
	/** Bumped on undo/redo so `canUndo`/`canRedo` stay reactive. */
	private revision = $state(0);

	readonly selected = $derived<Slot | undefined>(ops.getSlot(this.tree, this.selectedId));
	readonly dirty = $derived(this.snapshot() !== this.saved);
	readonly canUndo = $derived.by(() => (this.revision, this.history.canUndo));
	readonly canRedo = $derived.by(() => (this.revision, this.history.canRedo));

	constructor(tree: SlotTree = [], name = 'Untitled', kind: DocumentKind = 'object') {
		this.load(tree, name, kind);
	}

	private snapshot(): string {
		return JSON.stringify([this.name, this.tree]);
	}

	/** Replaces the document (open / new) and resets history and the dirty flag. */
	load(tree: SlotTree, name: string, kind: DocumentKind): void {
		this.tree = ops.cloneTree(tree);
		this.name = name;
		this.kind = kind;
		this.selectedId = ops.rootSlots(this.tree)[0]?.id ?? null;
		this.history.clear();
		this.revision++;
		this.markSaved();
	}

	markSaved(): void {
		this.saved = this.snapshot();
	}

	/** Applies a tree change, recording the previous tree for undo. Returns false if `next` is null (refused). */
	private commit(next: SlotTree | null, coalesceKey?: string): boolean {
		if (!next) return false;
		this.history.record(this.tree, coalesceKey);
		this.tree = next;
		this.revision++;
		return true;
	}

	/** Replaces the whole tree (raw JSON apply, code changes from other sources). */
	replaceTree(next: SlotTree): void {
		this.commit(ops.cloneTree(next));
		if (!ops.getSlot(this.tree, this.selectedId)) this.selectedId = ops.rootSlots(this.tree)[0]?.id ?? null;
	}

	select(id: string | null): void {
		this.selectedId = id && ops.getSlot(this.tree, id) ? id : null;
	}

	undo(): void {
		const previous = this.history.undo(this.tree);
		if (!previous) return;
		this.tree = previous;
		this.revision++;
		if (!ops.getSlot(this.tree, this.selectedId)) this.selectedId = ops.rootSlots(this.tree)[0]?.id ?? null;
	}

	redo(): void {
		const next = this.history.redo(this.tree);
		if (!next) return;
		this.tree = next;
		this.revision++;
		if (!ops.getSlot(this.tree, this.selectedId)) this.selectedId = ops.rootSlots(this.tree)[0]?.id ?? null;
	}

	rename(name: string): void {
		this.name = name;
	}

	addSlot(partial: Partial<Slot> & { name: string }, parentId: string | null = this.selectedId): string {
		const result = ops.addSlot(this.tree, parentId, partial);
		this.commit(result.tree);
		this.selectedId = result.id;
		return result.id;
	}

	removeSelected(): boolean {
		const id = this.selectedId;
		if (!id) return false;
		const parentId = ops.getSlot(this.tree, id)?.parentId ?? null;
		if (!this.commit(ops.removeSlot(this.tree, id))) return false;
		this.selectedId = ops.getSlot(this.tree, parentId)?.id ?? ops.rootSlots(this.tree)[0]?.id ?? null;
		return true;
	}

	duplicateSelected(): void {
		if (!this.selectedId) return;
		const result = ops.duplicateSlot(this.tree, this.selectedId);
		if (!result) return;
		this.commit(result.tree);
		this.selectedId = result.id;
	}

	/** Inserts a copy of an inventory object under `parentId` (default: the selection) and selects it. */
	insertFragment(fragment: SlotTree, parentId: string | null = this.selectedId): boolean {
		const result = ops.insertSubtree(this.tree, parentId, fragment);
		if (!result || !this.commit(result.tree)) return false;
		this.selectedId = result.id;
		return true;
	}

	reparent(id: string, newParentId: string | null): boolean {
		return this.commit(ops.reparent(this.tree, id, newParentId));
	}

	renameSlot(id: string, name: string): void {
		this.commit(ops.updateSlot(this.tree, id, { name }), `name:${id}`);
	}

	setPosition(id: string, position: Vec3): void {
		this.commit(ops.updateSlot(this.tree, id, { position }), `pos:${id}`);
	}

	setScale(id: string, scale: Vec3): void {
		this.commit(ops.updateSlot(this.tree, id, { scale }), `scale:${id}`);
	}

	/** Takes Euler angles in degrees, the way the inspector shows them. */
	setRotationEuler(id: string, degrees: Vec3): void {
		this.commit(ops.updateSlot(this.tree, id, { rotation: eulerToQuat(degrees) }), `rot:${id}`);
	}

	addComponent(id: string, type: ComponentType): void {
		this.commit(ops.addComponent(this.tree, id, componentSchema(type).create()));
	}

	addRawComponent(id: string, component: Component): void {
		this.commit(ops.addComponent(this.tree, id, component));
	}

	removeComponent(id: string, index: number): void {
		this.commit(ops.removeComponent(this.tree, id, index));
	}

	setField(id: string, index: number, key: string, value: unknown): void {
		this.commit(ops.setComponentField(this.tree, id, index, key, value), `field:${id}:${index}:${key}`);
	}
}
