import type { Component, Slot, SlotTree, Vec3 } from '../../ecs/types';
import { eulerToQuat } from '../../math/euler.ts';
import { componentSchema, type ComponentType } from '../schema/components.ts';
import * as ops from '../tree/ops.ts';
import { paintDisc } from '../../xr/templates/recordDisc.ts';

/**
 * Every edit the inspector can make, as plain data. The Studio applies them to its own document; the in-game inspector
 * applies them optimistically to its copy of the tree and sends the same op to the host, which applies it to the live
 * scene. `reduceDocOp` is the single, pure definition of what each op does, so both sides always agree.
 *
 * Ops that create slots carry a `nonce` (or an explicit id): ids are derived from it, so the optimistic copy and the
 * host create the same ids and a later patch from the host lines up instead of duplicating.
 */
export type DocOp =
	| { op: 'rename'; id: string; name: string }
	| { op: 'setPosition'; id: string; position: Vec3 }
	| { op: 'setScale'; id: string; scale: Vec3 }
	/** Euler angles in degrees, the way the inspector shows them. */
	| { op: 'setRotationEuler'; id: string; degrees: Vec3 }
	| { op: 'addComponent'; id: string; type: ComponentType; nonce?: string }
	| { op: 'addRawComponent'; id: string; component: Component }
	| { op: 'removeComponent'; id: string; index: number }
	| { op: 'setField'; id: string; index: number; key: string; value: unknown }
	| { op: 'addSlot'; parentId: string | null; slot: Partial<Slot> & { name: string; id: string } }
	| { op: 'removeSlot'; id: string }
	| { op: 'reparent'; id: string; parentId: string | null }
	| { op: 'duplicate'; id: string; nonce?: string };

export interface DocOpResult {
	tree: SlotTree;
	/** The slot the editor should select after this op, when the op implies one (added, duplicated, deleted). */
	selectId?: string | null;
}

/** The key edits made in a row to the same thing share, so undo steps over a whole drag or typing burst. Undefined for ops that never coalesce. */
export function coalesceKeyOf(op: DocOp): string | undefined {
	switch (op.op) {
		case 'rename': return `name:${op.id}`;
		case 'setPosition': return `pos:${op.id}`;
		case 'setScale': return `scale:${op.id}`;
		case 'setRotationEuler': return `rot:${op.id}`;
		case 'setField': return `field:${op.id}:${op.index}:${op.key}`;
		default: return undefined;
	}
}

export function newNonce(): string {
	return crypto.randomUUID();
}

/** Ids derived from one nonce, so the same op yields the same ids wherever it is applied. */
function idsFrom(nonce: string | undefined): () => string {
	if (!nonce) return () => crypto.randomUUID();
	let n = 0;
	return () => `${nonce}.${n++}`;
}

/** Applies `op` to `tree`. Returns null when the op is refused (unknown slot, cycle, deleting the last root…). */
export function reduceDocOp(tree: SlotTree, op: DocOp): DocOpResult | null {
	switch (op.op) {
		case 'rename':
			return ops.getSlot(tree, op.id) ? { tree: ops.updateSlot(tree, op.id, { name: op.name }) } : null;
		case 'setPosition':
			return ops.getSlot(tree, op.id) ? { tree: ops.updateSlot(tree, op.id, { position: op.position }) } : null;
		case 'setScale':
			return ops.getSlot(tree, op.id) ? { tree: ops.updateSlot(tree, op.id, { scale: op.scale }) } : null;
		case 'setRotationEuler':
			return ops.getSlot(tree, op.id) ? { tree: ops.updateSlot(tree, op.id, { rotation: eulerToQuat(op.degrees) }) } : null;
		case 'addComponent': {
			const slot = ops.getSlot(tree, op.id);
			if (!slot) return null;
			const component = componentSchema(op.type).create();
			// A Preview camera is a point of view, not a property of what it looks at. On a slot that already is something (or holds
			// something) it goes on a child of its own, so that moving the camera does not move the object.
			if (op.type === 'previewCamera' && (slot.components.length > 0 || ops.childrenOf(tree, op.id).length > 0)) {
				const result = ops.addSlot(tree, op.id, { name: 'Preview Camera', position: [0, 1.2, -3], components: [component] }, idsFrom(op.nonce));
				return { tree: result.tree, selectId: result.id };
			}
			// A Drop zone is a box of its own, sized by its slot's scale: on a slot that is already something it would scale (and move)
			// what is on it, so it goes on a child slot of its own too, starting as a flat slab above the origin.
			if (op.type === 'dropZone' && (slot.components.length > 0 || ops.childrenOf(tree, op.id).length > 0)) {
				const result = ops.addSlot(tree, op.id, { name: 'Drop Zone', position: [0, 0.5, 0], scale: [0.6, 0.3, 0.6], components: [component] }, idsFrom(op.nonce));
				return { tree: result.tree, selectId: result.id };
			}
			return { tree: ops.addComponent(tree, op.id, component) };
		}
		case 'addRawComponent':
			return ops.getSlot(tree, op.id) ? { tree: ops.addComponent(tree, op.id, op.component) } : null;
		case 'removeComponent':
			return ops.getSlot(tree, op.id) ? { tree: ops.removeComponent(tree, op.id, op.index) } : null;
		case 'setField': {
			if (!ops.getSlot(tree, op.id)) return null;
			const next = ops.setComponentField(tree, op.id, op.index, op.key, op.value);
			// A record disc's look follows its title, author and colours: the parts are redrawn from them here, once, for everyone.
			return { tree: ops.getSlot(next, op.id)?.components[op.index]?.type === 'recordDisc' ? paintDisc(next, op.id) : next };
		}
		case 'addSlot': {
			const result = ops.addSlot(tree, op.parentId, op.slot);
			return { tree: result.tree, selectId: result.id };
		}
		case 'removeSlot': {
			const parentId = ops.getSlot(tree, op.id)?.parentId ?? null;
			const next = ops.removeSlot(tree, op.id);
			if (!next) return null;
			return { tree: next, selectId: ops.getSlot(next, parentId)?.id ?? ops.rootSlots(next)[0]?.id ?? null };
		}
		case 'reparent': {
			const next = ops.reparent(tree, op.id, op.parentId);
			return next ? { tree: next } : null;
		}
		case 'duplicate': {
			const result = ops.duplicateSlot(tree, op.id, idsFrom(op.nonce));
			return result ? { tree: result.tree, selectId: result.id } : null;
		}
	}
}

/** What the inspector components need from whatever document they edit: the Studio's own, or the in-game inspector's remote copy. */
export interface InspectorDocument {
	readonly tree: SlotTree;
	readonly selectedId: string | null;
	readonly selected: Slot | undefined;
	readonly kind: 'object' | 'world';
	/** True when edits would be refused (a guest in someone else's world): the controls are disabled. */
	readonly readonly: boolean;
	select(id: string | null): void;
	renameSlot(id: string, name: string): void;
	setPosition(id: string, position: Vec3): void;
	setScale(id: string, scale: Vec3): void;
	setRotationEuler(id: string, degrees: Vec3): void;
	addComponent(id: string, type: ComponentType): void;
	addRawComponent(id: string, component: Component): void;
	removeComponent(id: string, index: number): void;
	setField(id: string, index: number, key: string, value: unknown): void;
	addSlot(partial: Partial<Slot> & { name: string }, parentId?: string | null): string;
	removeSelected(): boolean;
	duplicateSelected(): void;
	reparent(id: string, newParentId: string | null): boolean;
}
