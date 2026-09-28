/**
 * Slot/Component data model, patterned after Neos/Resonite's scene graph:
 * every entity is a "Slot" (transform node) carrying zero or more
 * "Components" that add behaviour/data. This is the single serialization
 * format shared by world templates, the inventory (all three backends) and
 * the host->guest scene snapshot sent over the DataChannel.
 */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface MeshRendererComponent {
	type: 'meshRenderer';
	/** Built-in primitive id ('box' | 'sphere' | 'plane' | 'ground' | ...) or an asset URL. */
	meshRef: string;
	color?: string;
}

export interface ColliderComponent {
	type: 'collider';
	shape: 'box' | 'sphere' | 'mesh';
}

export interface GrabbableComponent {
	type: 'grabbable';
	/** Whether a two-point grab (two hands / two lasers / one of each) is allowed to scale this slot. */
	scalable: boolean;
}

export interface AudioSourceComponent {
	type: 'audioSource';
}

export type Component =
	| MeshRendererComponent
	| ColliderComponent
	| GrabbableComponent
	| AudioSourceComponent;
// A 'script' component (ProtoFlux-like visual logic) is explicitly out of scope for v1.

export interface Slot {
	id: string;
	parentId: string | null;
	name: string;
	position: Vec3;
	rotation: Quat;
	scale: Vec3;
	components: Component[];
}

/** A flat list of slots forming one or more trees via parentId — the on-disk/over-the-wire shape. */
export type SlotTree = Slot[];

export function createSlot(partial: Partial<Slot> & { name: string }): Slot {
	return {
		id: partial.id ?? crypto.randomUUID(),
		parentId: partial.parentId ?? null,
		name: partial.name,
		position: partial.position ?? [0, 0, 0],
		rotation: partial.rotation ?? [0, 0, 0, 1],
		scale: partial.scale ?? [1, 1, 1],
		components: partial.components ?? []
	};
}

export function findComponent<T extends Component['type']>(
	slot: Slot,
	type: T
): Extract<Component, { type: T }> | undefined {
	return slot.components.find((c) => c.type === type) as Extract<Component, { type: T }> | undefined;
}

export function isGrabbable(slot: Slot): GrabbableComponent | undefined {
	return findComponent(slot, 'grabbable');
}
