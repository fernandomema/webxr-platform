import type { Component, Slot, SlotTree, Vec3 } from '$lib/ecs/types';
import type { ComponentType } from '../schema/components';
import * as ops from '../tree/ops';
import { coalesceKeyOf, reduceDocOp, type DocOp, type DocOpResult, type InspectorDocument } from './docOps';
import { History } from './history';

export type DocumentKind = 'object' | 'world';

/**
 * The single source of truth for what the editor is showing: the slot tree,
 * the selection, undo/redo and the "unsaved changes" flag. UI components call
 * these methods instead of mutating the tree themselves.
 */
export class StudioDocument implements InspectorDocument {
	/** The Studio's own document is always editable. */
	readonly readonly = false;
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

	/** Applies one op to the tree (undoable). Returns the result so callers can read `selectId`; null when refused. */
	private apply(op: DocOp): DocOpResult | null {
		const result = reduceDocOp(this.tree, op);
		if (!result || !this.commit(result.tree, coalesceKeyOf(op))) return null;
		return result;
	}

	addSlot(partial: Partial<Slot> & { name: string }, parentId: string | null = this.selectedId): string {
		const id = partial.id ?? crypto.randomUUID();
		this.apply({ op: 'addSlot', parentId, slot: { ...partial, id } });
		this.selectedId = id;
		return id;
	}

	removeSelected(): boolean {
		const id = this.selectedId;
		if (!id) return false;
		const result = this.apply({ op: 'removeSlot', id });
		if (!result) return false;
		this.selectedId = result.selectId ?? null;
		return true;
	}

	duplicateSelected(): void {
		if (!this.selectedId) return;
		const result = this.apply({ op: 'duplicate', id: this.selectedId });
		if (result?.selectId) this.selectedId = result.selectId;
	}

	/** Inserts a copy of an inventory object under `parentId` (default: the selection) and selects it. */
	insertFragment(fragment: SlotTree, parentId: string | null = this.selectedId): boolean {
		const result = ops.insertSubtree(this.tree, parentId, fragment);
		if (!result || !this.commit(result.tree)) return false;
		this.selectedId = result.id;
		return true;
	}

	reparent(id: string, newParentId: string | null): boolean {
		return this.apply({ op: 'reparent', id, parentId: newParentId }) !== null;
	}

	renameSlot(id: string, name: string): void {
		this.apply({ op: 'rename', id, name });
	}

	setPosition(id: string, position: Vec3): void {
		this.apply({ op: 'setPosition', id, position });
	}

	setScale(id: string, scale: Vec3): void {
		this.apply({ op: 'setScale', id, scale });
	}

	/** Takes Euler angles in degrees, the way the inspector shows them. */
	setRotationEuler(id: string, degrees: Vec3): void {
		this.apply({ op: 'setRotationEuler', id, degrees });
	}

	addComponent(id: string, type: ComponentType): void {
		const result = this.apply({ op: 'addComponent', id, type });
		if (result?.selectId) this.selectedId = result.selectId;
	}

	addRawComponent(id: string, component: Component): void {
		this.apply({ op: 'addRawComponent', id, component });
	}

	removeComponent(id: string, index: number): void {
		this.apply({ op: 'removeComponent', id, index });
	}

	setField(id: string, index: number, key: string, value: unknown): void {
		this.apply({ op: 'setField', id, index, key, value });
	}
}
