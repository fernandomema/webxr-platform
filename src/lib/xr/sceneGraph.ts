import {
	Mesh,
	Matrix,
	MeshBuilder,
	StandardMaterial,
	Color3,
	Color4,
	PointLight,
	Vector3,
	Quaternion,
	Ray,
	TransformNode,
	type Scene,
	type AbstractMesh,
	type InstancedMesh
} from '@babylonjs/core';
import type { MediaControlAction, Slot, SlotTree, UIEvent, Vec3, Quat } from '$lib/ecs/types';
import { findComponent, isGrabbable } from '$lib/ecs/types';
import { normalizeMeshRef, type AssetId, type MeshRef } from '$lib/assets/ref';
import { needsRebuild } from './slotRebuild';
import { batchMaterialUpdates, batchMeshDisposal } from './performance';
import type { BlobAssetLibrary } from './blobAssetLibrary';
import type { ModelInstance, ModelLease, ModelLibrary, ModelState } from './modelLibrary';
import { setupMirrorSurface } from './specialSurfaces';
import { setupCameraSurface } from './cameraSurface';
import { setupAudioPlayerSurface, type MediaRuntimeBinding } from './mediaSurfaces';
import { setupHtmlView } from './htmlViewSurface';
import { setupParticleBurst } from './particleEffects';
import { setupSurfaceMask } from './surfaceMaskRenderer';
import { setupStroke } from './strokeRenderer';
import { setupSkybox } from './skyboxRenderer';
import { setupWorldGlobe } from './worldGlobe';
import { setupImpactSound } from './impactSoundEffects';
import type { ScriptAudio } from './scriptAudio';
import { setupTextDisplay } from './textDisplaySurface';
import { setupScoreboard } from './scoreboardSurface';
import { setupUIPanel, type UIMediaState, type UIPanelBinding } from './uiPanelSurface';
import type { WorldStorageService } from './worldStorageService';
import { createCodeBlockHandlers, type CodeBlockHost, type RadialItemDef, type CodeBlockLogEntry, type HandEvent, type TriggerEvent, type RaycastHit } from './codeBlockRuntime';

/**
 * Built-in shapes drawn as instances of one shared mesh each: the GPU gets one draw call per shape, however many boxes
 * or spheres a world has (each keeps its own pose, colour, picking and collisions). Floors and planes stay meshes of
 * their own: planes carry signs, mirrors and screens, and floors are few.
 */
const INSTANCED_SHAPES = new Set(['box', 'sphere', 'cylinder']);
/** Components that draw onto their slot's own mesh (a texture, or a material of its own): such a mesh cannot be shared. */
const OWN_SURFACE = new Set<string>(['mirror', 'camera', 'textDisplay', 'htmlView', 'scoreboard', 'uiPanel', 'uiElement', 'surfaceMask', 'worldPortal', 'audioPlayer']);

const instanceColor = (color: string | undefined): Color4 => {
	const c = Color3.FromHexString(color ?? '#ffffff');
	return new Color4(c.r, c.g, c.b, 1);
};

interface LiveSlot {
	slot: Slot;
	node: TransformNode;
	/** System nodes (e.g. the Dash/Inspector panels) are grabbable like any Slot but excluded from serialize(). */
	system?: boolean;
	/** Present for a `meshRenderer` that points at a model asset: the TransformNode holds a pickable proxy, a placeholder, and (once loaded) the model. */
	model?: {
		assetId: AssetId;
		lease: ModelLease;
		proxy: Mesh;
		placeholder: Mesh;
		instance?: ModelInstance;
	};
	/** Load state of this slot's model, for the inspector and the network layer. */
	assetState?: ModelState;
	/** Present for an `htmlView`: the iframe its page lives in, for a host that talks to the page. */
	htmlFrame?: HTMLIFrameElement;
	/** Present on a `uiPanel` root: the controls rendered from its uiElement subtree. */
	ui?: UIPanelBinding;
	runtime?: {
		dispose: () => void;
		sync?: (slot: Slot) => void;
		control?: (action: MediaControlAction) => void;
		tick?: (dt: number) => void;
		onGrab?: () => void;
		onRelease?: () => void;
		onPress?: () => void;
		onUIEvent?: (event: UIEvent) => void;
		onPlayerReady?: (player: { id: string; name: string }) => void | Promise<void>;
		onEquip?: (event: HandEvent) => void;
		onUnequip?: (event: HandEvent) => void;
		onTrigger?: (event: TriggerEvent) => boolean | void;
		/** The trigger of the hand holding this, handled on this device whoever runs the world (a camera saves its pictures where it is held). */
		localUse?: (phase: 'press' | 'release' | 'value') => void;
		getRadialItems?: () => RadialItemDef[];
		getDebugLog?: () => CodeBlockLogEntry[];
	};
}

export interface SceneGraphOptions {
	onMediaControl?: (slotId: string, action: MediaControlAction) => void;
	/** Routes UI interactions (button press, input change/submit) through the host-authoritative world channel. */
	onUIEvent?: (event: UIEvent) => void;
	/** Imports a Poly Haven model for a world codeBlock. */
	onImportPolyHavenModel?: (id: string, name: string) => Promise<string>;
	/** codeBlock's `world.spawn`/`deleteSelf`/`deleteSlot` — route through the host-authoritative sync pipeline (see engine.ts, mirrors onMediaControl). */
	onSpawnRequest?: (slot: Slot) => void;
	onDeleteRequest?: (slotId: string) => void;
	/** codeBlock's `world.setComponentField` on ANOTHER slot — host/solo only, broadcasts the mutation. */
	onSlotMutated?: (slotId: string) => void;
	/** codeBlock's `world.isHost()`. */
	isHost?: () => boolean;
	/** codeBlock's `world.getPlayer(grabberId)` — resolves a GrabSystem grabberId to a stable player id + display name. */
	resolvePlayer?: (grabberId: string) => { id: string; name: string };
	/** Persistent storage and leaderboards for `ctx.storage` / `ctx.leaderboards` (see worldStorageService.ts). */
	storage?: WorldStorageService;
	/** Audio analysis and clock-accurate playback for `ctx.audio.analyze` / `ctx.audio.playTrack` (see scriptAudio.ts). */
	audio?: ScriptAudio;
	/** Where model bytes come from. Without it, a slot that points at a model stays a placeholder. */
	models?: ModelLibrary;
	/** Where asset-backed media (audio) gets its bytes. */
	mediaAssets?: BlobAssetLibrary;
	/** The viewer's position, to load nearby models first. */
	getViewerPosition?: () => Vector3 | null;
	/** A slot's model changed state (queued, loading, ready, missing, error). */
	onAssetStateChanged?: (slotId: string, state: ModelState) => void;
}

/** Minimal surface SceneGraph needs from GrabSystem — set post-construction (GrabSystem is built AFTER SceneGraph and itself depends on it), never imported directly to avoid a circular dependency. */
export interface GrabQuery {
	getGrabbersForSlot(slotId: string): string[];
}

/** Same idea for EquipmentSystem: which player/hand has a slot (or an ancestor of it) equipped. */
export interface EquipQuery {
	getHolderOfSlotOrAncestor(slotId: string): { playerId: string; hand: 'left' | 'right' } | null;
}

/**
 * Runtime instantiation of a SlotTree into real Babylon nodes/meshes, kept in
 * sync via Slot.id <-> node.metadata.slotId. Can serialize its current live
 * state back into a SlotTree (positions/rotations/scales reflect grabs/edits) —
 * used for saving to inventory, saving a world template, and host->guest sync.
 */
export class SceneGraph {
	private live = new Map<string, LiveSlot>();
	/** The hidden mesh each instanced shape is drawn from, and the material they all share. */
	private primitiveSources = new Map<string, Mesh>();
	private primitiveMaterial: StandardMaterial | null = null;
	/** Slots by the components they carry, and whole objects, for the systems that look every frame; rebuilt after the scene changes. */
	private byComponent = new Map<string, LiveSlot[]>();
	private subtrees = new Map<string, LiveSlot[]>();
	private serializedMatrix = Matrix.Identity();
	private serializedParentInverse = Matrix.Identity();
	private serializedPosition = Vector3.Zero();
	private serializedRotation = Quaternion.Identity();
	private serializedScale = Vector3.One();

	private invalidateIndexes(): void {
		this.byComponent.clear();
		this.subtrees.clear();
	}
	private grabQuery: GrabQuery | null = null;
	private equipQuery: EquipQuery | null = null;

	private changeListeners = new Set<(ids: readonly string[] | null) => void>();

	constructor(private scene: Scene, private options: SceneGraphOptions = {}) {}

	/**
	 * Calls `listener` (synchronously) whenever the set of slots or what they hold changes: added, removed, reparented,
	 * edited, or reconciled with a snapshot. It is given the ids of the slots concerned, or null when anything may have
	 * changed (a snapshot). Frequent pose changes (grabs) are not announced. Returns the function that stops listening.
	 */
	onChanged(listener: (ids: readonly string[] | null) => void): () => void {
		this.changeListeners.add(listener);
		return () => this.changeListeners.delete(listener);
	}

	private notifyChanged(ids: readonly string[] | null): void {
		for (const listener of this.changeListeners) {
			try {
				listener(ids);
			} catch (err) {
				console.warn('[sceneGraph] change listener threw', err);
			}
		}
	}

	/** The iframe of a slot's `htmlView`, once it exists. */
	getHtmlViewFrame(slotId: string): HTMLIFrameElement | null {
		return this.live.get(slotId)?.htmlFrame ?? null;
	}

	/** Called once from engine.ts right after `new GrabSystem(scene, sceneGraph)` — see GrabQuery's doc comment. */
	setGrabQuery(grabQuery: GrabQuery): void {
		this.grabQuery = grabQuery;
	}

	setEquipQuery(equipQuery: EquipQuery): void {
		this.equipQuery = equipQuery;
	}

	load(tree: SlotTree): void {
		batchMaterialUpdates(this.scene, () => {
			for (const slot of tree) this.spawnNode(slot);
			for (const slot of tree) {
				if (!slot.parentId) continue;
				const parent = this.parentNodeFor(slot);
				const self = this.live.get(slot.id)?.node;
				if (parent && self) self.parent = parent;
			}
		});
		for (const slot of tree) {
			const node = this.live.get(slot.id)?.node;
			if (node) this.activateCodeBlock(slot, node);
		}
		this.syncUIPanels();
	}

	addSlot(slot: Slot, options?: { system?: boolean }): TransformNode {
		const node = this.spawnNode(slot);
		if (options?.system) {
			const entry = this.live.get(slot.id);
			if (entry) entry.system = true;
		}
		if (slot.parentId) {
			const parent = this.parentNodeFor(slot);
			if (parent) node.parent = parent;
		}
		this.activateCodeBlock(slot, node);
		this.syncUIPanels();
		if (!options?.system) this.notifyChanged([slot.id]);
		return node;
	}

	removeSlot(slotId: string): void {
		const idsToRemove = [...this.live.entries()]
			.filter(([id, entry]) => id === slotId || this.isDescendantOf(entry.slot, slotId))
			.map(([id]) => id);
		if (idsToRemove.length === 0) return;
		batchMeshDisposal(this.scene, () => {
			for (const id of idsToRemove) {
				const entry = this.live.get(id);
				if (!entry) continue;
				this.disposeRuntime(entry);
				entry.node.dispose();
				this.live.delete(id);
			}
		});
		this.invalidateIndexes();
		this.syncUIPanels();
		this.notifyChanged(idsToRemove);
	}

	dispose(): void {
		batchMaterialUpdates(this.scene, () => batchMeshDisposal(this.scene, () => {
			for (const entry of this.live.values()) {
				this.disposeRuntime(entry);
				entry.node.dispose();
			}
			this.live.clear();
			this.invalidateIndexes();
			for (const source of this.primitiveSources.values()) source.dispose();
			this.primitiveSources.clear();
			this.primitiveMaterial?.dispose();
			this.primitiveMaterial = null;
			for (const material of Object.values(this.placeholderMaterials)) material?.dispose();
			this.placeholderMaterials = {};
		}));
	}

	/** One runtime failing to clean up (e.g. a media player with no audio engine) must not stop the rest of the scene from being torn down. */
	private disposeRuntime(entry: LiveSlot): void {
		try {
			entry.runtime?.dispose();
		} catch (err) {
			console.warn(`[sceneGraph] runtime dispose failed for ${entry.slot.id}`, err);
		}
		if (entry.model) {
			try {
				entry.model.instance?.dispose();
				entry.model.lease.release();
			} catch (err) {
				console.warn(`[sceneGraph] model release failed for ${entry.slot.id}`, err);
			}
			entry.model = undefined;
		}
	}

	getLive(slotId: string): LiveSlot | undefined {
		return this.live.get(slotId);
	}

	getSlotIdForNode(node: AbstractMesh | TransformNode | null | undefined): string | null {
		// Walk up: a model's real meshes are children of the slot's node.
		for (let current: { metadata?: { slotId?: string } | null; parent?: unknown } | null | undefined = node; current; current = current.parent as typeof current) {
			const slotId = current.metadata?.slotId;
			if (slotId) return slotId;
		}
		return null;
	}

	getChildren(parentId: string | null): LiveSlot[] {
		return [...this.live.values()].filter(
			(entry) =>
				!entry.system &&
				(parentId === null
					? entry.slot.parentId === null || !this.live.has(entry.slot.parentId ?? '')
					: entry.slot.parentId === parentId)
		);
	}

	/** `rootId` and every descendant, root first then depth-first in creation order — the order equipped-object scripts are dispatched in. */
	getSubtree(rootId: string): LiveSlot[] {
		const root = this.live.get(rootId);
		if (!root) return [];
		const result: LiveSlot[] = [];
		const visit = (entry: LiveSlot) => {
			result.push(entry);
			for (const child of this.getChildren(entry.slot.id)) visit(child);
		};
		visit(root);
		return result;
	}

	/** Finds the nearest grabbable slot, preferring the directly hit child. */
	resolveGrabTarget(slotId: string): string | null {
		let current = this.live.get(slotId);
		while (current) {
			if (isGrabbable(current.slot)) return current.slot.id;
			current = current.slot.parentId ? this.live.get(current.slot.parentId) : undefined;
		}
		return null;
	}

	/** Reparents a slot while preserving its current world transform. */
	reparentSlot(slotId: string, parentId: string | null): boolean {
		const entry = this.live.get(slotId);
		if (!entry || entry.system || parentId === slotId) return false;
		if (parentId && (!this.live.has(parentId) || this.isDescendantOf(this.live.get(parentId)!.slot, slotId))) return false;

		// A bone attachment only means something under the model it names; moving on drops it.
		if (entry.slot.parentId !== parentId && findComponent(entry.slot, 'boneAttach')) {
			entry.slot.components = entry.slot.components.filter((component) => component.type !== 'boneAttach');
			this.invalidateIndexes();
		}
		entry.slot.parentId = parentId;
		this.invalidateIndexes();
		entry.node.setParent(this.parentNodeFor(entry.slot));
		this.syncSlotTransform(entry);
		this.notifyChanged([slotId]);
		return true;
	}

	/**
	 * The node a slot hangs from: its parent slot's node, or, for a `boneAttach` slot whose parent's
	 * skinned model has loaded, the named bone. Until the model loads it falls back to the parent's
	 * node, and `syncModel` re-binds once the bones exist.
	 */
	private parentNodeFor(slot: Slot): TransformNode | null {
		if (!slot.parentId) return null;
		const parent = this.live.get(slot.parentId);
		if (!parent) return null;
		const attach = findComponent(slot, 'boneAttach');
		const bone = attach?.bone ? parent.model?.instance?.boneNodes.get(attach.bone) : undefined;
		return bone ?? parent.node;
	}

	/** Once a skinned model is ready, moves its `boneAttach` children from the model root onto their bones. */
	private bindBoneChildren(parentId: string): void {
		for (const entry of this.live.values()) {
			if (entry.slot.parentId !== parentId || !findComponent(entry.slot, 'boneAttach')) continue;
			const target = this.parentNodeFor(entry.slot);
			if (target && entry.node.parent !== target && entry.node.parent === this.live.get(parentId)?.node) entry.node.parent = target;
		}
	}

	/** Puts a slot at a pose in its parent's space, keeping the slot data in step with the node. */
	placeSlotLocal(slotId: string, position: Vec3, rotation: Quat): void {
		const entry = this.live.get(slotId);
		if (!entry) return;
		entry.node.position.copyFromFloats(...position);
		entry.node.rotationQuaternion = Quaternion.FromArray(rotation);
		this.syncSlotTransform(entry);
	}

	/**
	 * Changes only which slot the data says is the parent, leaving the node where it is. For a slot that is
	 * momentarily under a hand: `serialize()` already sends it in its data parent's space.
	 */
	setSlotParentData(slotId: string, parentId: string | null): void {
		const entry = this.live.get(slotId);
		if (entry && !entry.system) {
			entry.slot.parentId = parentId;
			this.invalidateIndexes();
		}
	}

	controlMedia(slotId: string, action: MediaControlAction): boolean {
		const entry = this.live.get(slotId);
		if (!entry?.runtime?.control) return false;
		entry.runtime.control(action);
		return true;
	}

	/**
	 * Delivers a UI interaction: a pressed button's own `onPress`, then `onUIEvent`
	 * on the element and every ancestor (so one codeBlock on the panel can drive
	 * the whole UI). The caller decides whether this is local or host-authoritative.
	 */
	dispatchUIEvent(event: UIEvent): boolean {
		const entry = this.live.get(event.slotId);
		const element = entry && findComponent(entry.slot, 'uiElement');
		if (!entry || !element) return false;
		let handled = false;
		if (event.type === 'press' && element.kind === 'button' && entry.runtime?.onPress) {
			entry.runtime.onPress();
			handled = true;
		}
		for (let current: LiveSlot | undefined = entry; current; current = current.slot.parentId ? this.live.get(current.slot.parentId) : undefined) {
			if (!current.runtime?.onUIEvent) continue;
			current.runtime.onUIEvent(event);
			handled = true;
		}
		return handled;
	}

	private findUIBinding(slotId: string): UIPanelBinding | undefined {
		for (let entry = this.live.get(slotId); entry; entry = entry.slot.parentId ? this.live.get(entry.slot.parentId) : undefined) {
			if (entry.ui) return entry.ui;
		}
		return undefined;
	}

	getUIMedia(slotId: string): UIMediaState | undefined {
		return this.findUIBinding(slotId)?.getMedia(slotId);
	}

	getUIInputText(slotId: string): string | undefined {
		return this.findUIBinding(slotId)?.getInputText(slotId);
	}

	allSlots(): LiveSlot[] {
		return [...this.live.values()];
	}

	/**
	 * The live slots carrying a component of `type`. Kept between calls until the scene changes, so a system that looks
	 * every frame (buttons, avatars) does not walk every slot of the world each time. Do not modify the list.
	 */
	/** `getSubtree`, kept between calls until the scene changes (a hand holding an object looks at its parts every frame). */
	subtreeOf(rootId: string): readonly LiveSlot[] {
		let list = this.subtrees.get(rootId);
		if (!list) {
			list = this.getSubtree(rootId);
			this.subtrees.set(rootId, list);
		}
		return list;
	}

	slotsWith(type: Slot['components'][number]['type']): readonly LiveSlot[] {
		let list = this.byComponent.get(type);
		if (!list) {
			list = [...this.live.values()].filter((entry) => entry.slot.components.some((component) => component.type === type));
			this.byComponent.set(type, list);
		}
		return list;
	}

	/**
	 * Current world state as a fresh SlotTree (ids/parentId unchanged, transforms live). System nodes (UI panels) are excluded.
	 * Avatars belong to the session, not the world, so anything saved or re-hosted asks for `withoutAvatars`.
	 */
	serialize(options: { withoutAvatars?: boolean } = {}): SlotTree {
		const avatarIds = options.withoutAvatars
			? [...this.live.values()].filter((entry) => findComponent(entry.slot, 'avatar')).map((entry) => entry.slot.id)
			: [];
		return [...this.live.values()]
			.filter((entry) => !entry.system)
			.filter((entry) => !avatarIds.some((id) => entry.slot.id === id || this.isDescendantOf(entry.slot, id)))
			.map((entry) => this.serializeEntry(entry));
	}

	/** The ids serialize() would return, in the same order, without the cost of reading every pose. */
	slotIds(options: { withoutAvatars?: boolean } = {}): string[] {
		const avatarIds = options.withoutAvatars
			? [...this.live.values()].filter((entry) => findComponent(entry.slot, 'avatar')).map((entry) => entry.slot.id)
			: [];
		return [...this.live.values()]
			.filter((entry) => !entry.system && !avatarIds.some((id) => entry.slot.id === id || this.isDescendantOf(entry.slot, id)))
			.map((entry) => entry.slot.id);
	}

	/** One slot as serialize() would give it, or null when it does not exist (or is a system slot). */
	serializeSlot(slotId: string): Slot | null {
		const entry = this.live.get(slotId);
		return entry && !entry.system ? this.serializeEntry(entry) : null;
	}

	private serializeEntry({ slot, node }: LiveSlot): Slot {
		// A grabbed node is temporarily parented to a hand. Serialize it in
		// its Slot parent space so remote peers receive the same world pose,
		// without reparenting it: setParent walks the entire object's hierarchy
		// and repeated decomposition also changes the live transform while held.
		const expectedParent = this.parentNodeFor(slot);
		let position = node.position;
		let rotation = node.rotationQuaternion ?? Quaternion.FromEulerVector(node.rotation);
		let scale = node.scaling;
		if (node.parent !== expectedParent) {
			// Match setParent's conversion of local TRS, including its pivot-independent semantics.
			Matrix.ComposeToRef(scale, rotation, position, this.serializedMatrix);
			if (node.parent) this.serializedMatrix.multiplyToRef(node.parent.computeWorldMatrix(true), this.serializedMatrix);
			if (expectedParent) {
				expectedParent.computeWorldMatrix(true).invertToRef(this.serializedParentInverse);
				this.serializedMatrix.multiplyToRef(this.serializedParentInverse, this.serializedMatrix);
			}
			this.serializedMatrix.decompose(this.serializedScale, this.serializedRotation, this.serializedPosition);
			position = this.serializedPosition;
			rotation = this.serializedRotation;
			scale = this.serializedScale;
		}
		return {
			...slot,
			position: position.asArray() as Slot['position'],
			rotation: rotation.asArray() as Slot['rotation'],
			scale: scale.asArray() as Slot['scale']
		};
	}

	/**
	 * Reconciles the live scene to match `tree` (a host-broadcast snapshot):
	 * adds slots that are new, removes slots that disappeared, and updates
	 * the transform of existing ones — except any id in `ignoreSlotIds`
	 * (typically whatever this client is itself actively grabbing, so a
	 * locally-optimistic grab isn't fought by a slightly-stale broadcast).
	 */
	reconcile(tree: SlotTree, ignoreSlotIds: Set<string> = new Set()): void {
		const incomingIds = new Set(tree.map((s) => s.id));
		const removedIds = [...this.live.keys()].filter((id) => !incomingIds.has(id) && !this.live.get(id)?.system);
		if (removedIds.length > 0) {
			batchMeshDisposal(this.scene, () => {
				for (const id of removedIds) this.removeSlot(id);
			});
		}

		for (const slot of tree) {
			if (ignoreSlotIds.has(slot.id)) continue;
			const existing = this.live.get(slot.id);
			if (!existing) {
				this.addSlot(slot);
				continue;
			}
			if (existing.system) continue;
			if (needsRebuild(existing.slot, slot)) {
				this.rebuildSubtree(slot, tree);
				continue;
			}
			this.applyLive(existing, slot);
		}

		// Apply hierarchy after every slot exists so incoming local transforms are
		// interpreted against the correct parent.
		for (const slot of tree) {
			if (ignoreSlotIds.has(slot.id)) continue;
			const entry = this.live.get(slot.id);
			if (!entry || entry.system) continue;
			const node = entry.node;
			node.parent = this.parentNodeFor(slot);
		}
		this.syncUIPanels();
		this.notifyChanged(null);
	}

	/**
	 * Applies an edit made in the inspector to one live slot (host and solo only; the caller then broadcasts). What can be
	 * updated in place is; what cannot (see `needsRebuild`) rebuilds the slot and what hangs from it. The slot's own
	 * parent is not changed here, use `reparentSlot`. Returns false for an unknown or system slot.
	 */
	applySlotEdit(slotId: string, next: Slot): boolean {
		const entry = this.live.get(slotId);
		if (!entry || entry.system) return false;
		if (needsRebuild(entry.slot, next)) {
			const tree = this.serialize().map((slot) => (slot.id === slotId ? { ...next, parentId: entry.slot.parentId } : slot));
			this.rebuildSubtree(tree.find((slot) => slot.id === slotId)!, tree);
		} else {
			this.applyLive(entry, { ...next, parentId: entry.slot.parentId });
			this.syncUIPanels();
			this.notifyChanged([slotId]);
		}
		return true;
	}

	/** Brings a live slot up to date with `slot` without rebuilding it: its data, its surface, its colour and its pose. */
	private applyLive(entry: LiveSlot, slot: Slot): void {
		entry.slot = slot;
		this.invalidateIndexes();
		entry.runtime?.sync?.(slot);
		const color = findComponent(slot, 'meshRenderer')?.color;
		if (color && !entry.model) this.paint(entry.node, color);
		entry.node.position = Vector3.FromArray(slot.position);
		entry.node.rotationQuaternion = Quaternion.FromArray(slot.rotation);
		entry.node.scaling = Vector3.FromArray(slot.scale);
		if (entry.node.isEnabled(false) === !!slot.disabled) entry.node.setEnabled(!slot.disabled);
	}

	/** Applies frequent pose updates without re-sending component payloads such as world packages. */
	applyTransforms(transforms: Array<Pick<Slot, 'id' | 'position' | 'rotation' | 'scale'>>, ignoreSlotIds: Set<string> = new Set()): void {
		for (const transform of transforms) {
			if (ignoreSlotIds.has(transform.id)) continue;
			const entry = this.live.get(transform.id);
			if (!entry || entry.system) continue;
			entry.node.position = Vector3.FromArray(transform.position);
			entry.node.rotationQuaternion = Quaternion.FromArray(transform.rotation);
			entry.node.scaling = Vector3.FromArray(transform.scale);
			entry.slot.position = transform.position;
			entry.slot.rotation = transform.rotation;
			entry.slot.scale = transform.scale;
		}
	}

	private isDescendantOf(slot: Slot, ancestorId: string): boolean {
		let parentId = slot.parentId;
		while (parentId) {
			if (parentId === ancestorId) return true;
			parentId = this.live.get(parentId)?.slot.parentId ?? null;
		}
		return false;
	}

	private spawnNode(slot: Slot): TransformNode {
		const mesh = findComponent(slot, 'meshRenderer');
		const ref = mesh ? normalizeMeshRef(mesh.meshRef) : null;
		const modelAssetId = ref?.kind === 'asset' ? ref.assetId : null;
		const uiPanel = findComponent(slot, 'uiPanel');
		const worldWidth = uiPanel?.worldWidth ?? 1.2;
		const node: TransformNode = mesh
			? modelAssetId
				? new TransformNode(slot.id, this.scene) // only the children render or participate in picking
				: this.createMesh(slot, ref!, mesh.color)
			: uiPanel
				? MeshBuilder.CreatePlane(slot.id, { width: worldWidth, height: worldWidth * uiPanel.height / uiPanel.width }, this.scene)
				: new TransformNode(slot.id, this.scene);

		node.position = Vector3.FromArray(slot.position);
		node.rotationQuaternion = Quaternion.FromArray(slot.rotation);
		node.scaling = Vector3.FromArray(slot.scale);
		node.metadata = { ...(node.metadata ?? {}), slotId: slot.id };
		if (slot.disabled) node.setEnabled(false);

		const entry: LiveSlot = { slot, node };
		this.live.set(slot.id, entry);
		this.invalidateIndexes();
		if (modelAssetId) this.bindModel(entry, modelAssetId);
		// Surfaces that draw onto the mesh itself do not apply to a model.
		if (mesh && !modelAssetId) {
			const mirror = findComponent(slot, 'mirror');
			if (mirror) entry.runtime = { dispose: setupMirrorSurface(this.scene, node as AbstractMesh, mirror.resolution) };
			const camera = findComponent(slot, 'camera');
			if (camera) entry.runtime = setupCameraSurface(this.scene, node as AbstractMesh, camera);
			const audio = findComponent(slot, 'audioPlayer');
			if (audio) entry.runtime = this.createMediaRuntime(slot, node as AbstractMesh, setupAudioPlayerSurface);
			const htmlView = findComponent(slot, 'htmlView');
			if (htmlView) {
				const binding = setupHtmlView(this.scene, node as AbstractMesh, htmlView);
				entry.runtime = binding;
				entry.htmlFrame = binding.frame;
			}
			const textDisplay = findComponent(slot, 'textDisplay');
			if (textDisplay) entry.runtime = setupTextDisplay(this.scene, node as AbstractMesh, textDisplay);
			const scoreboard = findComponent(slot, 'scoreboard');
			if (scoreboard) entry.runtime = setupScoreboard(this.scene, node as AbstractMesh, scoreboard);
			const surfaceMask = findComponent(slot, 'surfaceMask');
			if (surfaceMask) entry.runtime = setupSurfaceMask(this.scene, node as AbstractMesh, surfaceMask, ref);
			// A world orb whose world has a 360° preview shows it inside a glass globe.
			const preview = findComponent(slot, 'worldPortal')?.world.preview;
			if (preview && this.options.mediaAssets) entry.runtime = setupWorldGlobe(this.scene, node as AbstractMesh, preview, this.options.mediaAssets);
		}
		if (uiPanel && node instanceof Mesh) {
			const binding = setupUIPanel(
				this.scene,
				node,
				uiPanel,
				() => this.getSubtree(slot.id).map((child) => child.slot),
				(event) => {
					if (this.options.onUIEvent) this.options.onUIEvent(event);
					else this.dispatchUIEvent(event);
				}
			);
			entry.ui = binding;
			const previousRuntime = entry.runtime;
			entry.runtime = { ...(previousRuntime ?? { dispose: () => {} }), dispose: () => previousRuntime?.dispose(), sync: (currentSlot) => { previousRuntime?.sync?.(currentSlot ?? slot); binding.sync(); } };
		}
		// particleBurst/impactSound don't require a mesh, and are always
		// root-level slots with a self-contained world position (see
		// codeBlockRuntime.ts's particles.burst/audio.play), so they're safe
		// to activate immediately — unlike codeBlock (see activateCodeBlock).
		const particleBurst = findComponent(slot, 'particleBurst');
		if (particleBurst) {
			const dispose = setupParticleBurst(
				this.scene,
				node,
				particleBurst.color,
				particleBurst.count,
				particleBurst.durationMs
			);
			entry.runtime = { dispose };
		}
		const pointLight = findComponent(slot, 'pointLight');
		if (pointLight) {
			const light = new PointLight(`${slot.id}-light`, Vector3.Zero(), this.scene);
			light.parent = node;
			const apply = (value: typeof pointLight) => {
				light.diffuse = Color3.FromHexString(value.color);
				light.intensity = Math.max(0, value.intensity);
				light.range = Math.max(0.1, value.range);
			};
			apply(pointLight);
			entry.runtime = { dispose: () => light.dispose(), sync: (currentSlot) => { const next = findComponent(currentSlot, 'pointLight'); if (next) apply(next); } };
		}
		const skybox = findComponent(slot, 'skybox');
		if (skybox) entry.runtime = setupSkybox(this.scene, node, skybox, this.options.mediaAssets);
		const stroke = findComponent(slot, 'stroke');
		if (stroke) entry.runtime = setupStroke(this.scene, node, stroke);
		const impactSound = findComponent(slot, 'impactSound');
		if (impactSound) entry.runtime = { dispose: setupImpactSound(this.scene, node, impactSound) };
		return node;
	}

	/**
	 * Compiles a slot's codeBlock and fires its onSpawn — deliberately kept
	 * separate from spawnNode() and called only once the node is fully
	 * parented (see load()/addSlot()). onSpawn typically reads
	 * ctx.self.getWorldPosition(), which is meaningless before the node is
	 * parented: an unparented node's "world" position is just its raw local
	 * Slot data, only correct by coincidence when the intended parent
	 * happens to sit at the identity transform (as it did for every
	 * container this bug happened not to be visible on).
	 */
	private activateCodeBlock(slot: Slot, node: TransformNode): void {
		const codeBlock = findComponent(slot, 'codeBlock');
		if (!codeBlock) return;
		const handlers = createCodeBlockHandlers(slot.id, node, codeBlock.code, this.buildCodeBlockHost());
		const entry = this.live.get(slot.id);
		if (!entry) {
			handlers.dispose();
			return;
		}
		const previous = entry.runtime;
		// The surface the slot may also have (a panel, a mesh) is disposed first, then what the script left running.
		entry.runtime = { ...(previous ?? { dispose: () => {} }), ...handlers, dispose: () => { try { previous?.dispose(); } finally { handlers.dispose(); } } };
	}

	private buildCodeBlockHost(): CodeBlockHost {
		return {
			getSlot: (slotId) => this.live.get(slotId)?.slot,
			getNode: (slotId) => this.live.get(slotId)?.node,
			getChildren: (parentId) => this.getChildren(parentId).map((entry) => entry.slot),
			allSlots: () => this.allSlots().map((entry) => entry.slot),
			getGrabbers: (slotId) => this.grabQuery?.getGrabbersForSlot(slotId) ?? [],
			isHost: () => this.options.isHost?.() ?? true,
			requestSpawn: (slot) => this.options.onSpawnRequest?.(slot),
			requestDelete: (slotId) => this.options.onDeleteRequest?.(slotId),
			setComponentField: (slotId, componentType, field, value, broadcast = true) => {
				// Host/solo-only: a guest calling this would only affect its own
				// unauthoritative copy, silently reverted by the next broadcast —
				// so it's a documented no-op rather than a confusing flash-then-revert.
				if (!(this.options.isHost?.() ?? true)) return;
				if (this.setComponentField(slotId, componentType, field, value) && broadcast) {
					this.options.onSlotMutated?.(slotId);
				}
			},
			commitTransform: (slotId, broadcast = true) => {
				const entry = this.live.get(slotId);
				if (!entry || entry.system || !(this.options.isHost?.() ?? true)) return;
				this.syncSlotTransform(entry);
				if (broadcast) this.options.onSlotMutated?.(slotId);
			},
			findNear: (worldPos, radius) => this.findSlotsNear(worldPos, radius),
			raycast: (origin, direction, maxDistance) => this.raycastScene(origin, direction, maxDistance),
			resolvePlayer: (grabberId) => this.options.resolvePlayer?.(grabberId) ?? { id: grabberId, name: 'Player' },
			setSlotEnabled: (slotId, enabled, broadcast = true) => {
				if (!(this.options.isHost?.() ?? true)) return false;
				const changed = this.setSlotEnabled(slotId, enabled);
				if (changed && broadcast) this.options.onSlotMutated?.(slotId);
				return changed;
			},
			storage: this.options.storage,
			audio: this.options.audio,
			getEquipHolder: (slotId) => this.equipQuery?.getHolderOfSlotOrAncestor(slotId) ?? null,
			getUIMedia: (slotId) => this.getUIMedia(slotId),
			getUIInputText: (slotId) => this.getUIInputText(slotId),
			importPolyHavenModel: (id, name) => {
				if (!(this.options.isHost?.() ?? true) || !this.options.onImportPolyHavenModel) throw new Error('Model importing is unavailable here.');
				return this.options.onImportPolyHavenModel(id, name);
			}
		};
	}

	/** Every non-system Slot within `radius` of `worldPos` — see CodeBlockHost.findNear's doc comment. */
	private findSlotsNear(worldPos: Vec3, radius: number): Slot[] {
		const [x, y, z] = worldPos;
		const radiusSq = radius * radius;
		const results: Slot[] = [];
		for (const entry of this.live.values()) {
			if (entry.system) continue;
			entry.node.computeWorldMatrix(true);
			const p = entry.node.absolutePosition;
			const dx = p.x - x;
			const dy = p.y - y;
			const dz = p.z - z;
			if (dx * dx + dy * dy + dz * dz <= radiusSq) results.push(entry.slot);
		}
		return results;
	}

	/** Casts a ray through every pickable mesh in the scene and resolves the closest hit back to its owning Slot — see CodeBlockHost.raycast's doc comment. `null` if nothing pickable (or nothing owned by a Slot, e.g. a placeholder proxy) is hit within `maxDistance`. */
	private raycastScene(origin: Vec3, direction: Vec3, maxDistance: number): RaycastHit | null {
		const dir = Vector3.FromArray(direction).normalize();
		const ray = new Ray(Vector3.FromArray(origin), dir, Math.max(0.001, maxDistance));
		const pick = this.scene.pickWithRay(ray, (mesh) => mesh.isPickable && mesh.isEnabled());
		if (!pick?.hit || !pick.pickedMesh || !pick.pickedPoint) return null;
		const slotId = this.getSlotIdForNode(pick.pickedMesh);
		if (!slotId) return null;
		const normal = pick.getNormal(true, true) ?? Vector3.Up();
		const uv = pick.getTextureCoordinates();
		return {
			slotId,
			point: pick.pickedPoint.asArray() as Vec3,
			normal: normal.asArray() as Vec3,
			u: uv?.x ?? 0,
			v: uv?.y ?? 0
		};
	}

	/** Applies each codeBlock's tick() (own try/catch inside), integrates generic `velocity` components, and sweeps expired slots — call every frame, on every peer, solo included. Returns how many slots were removed by expiry. */
	tick(dt: number): number {
		// These cached component lists are invalidated whenever the graph changes. Large authored worlds contain hundreds
		// of static decorative slots, so do not scan all of them several times on every headset frame.
		for (const entry of this.slotsWith('codeBlock')) entry.runtime?.tick?.(dt);
		this.flushUISync();
		this.updateModelPriorities(dt);

		// Everything below is engine code, not user script, but it now runs
		// every frame ahead of movement/rotation/grab controllers in the
		// observer list (see engine.ts) — an uncaught throw here must not be
		// able to silently stop those from running, this frame or any after.
		try {
			this.integrateVelocities(dt);
		} catch (err) {
			console.error('[sceneGraph] integrateVelocities threw', err);
		}

		try {
			const now = Date.now();
			const expiredIds: string[] = [];
			for (const entry of this.slotsWith('expires')) {
				const expires = findComponent(entry.slot, 'expires');
				if (expires && expires.expiresAt <= now) expiredIds.push(entry.slot.id);
			}
			for (const id of expiredIds) this.removeSlot(id);
			return expiredIds.length;
		} catch (err) {
			console.error('[sceneGraph] expires sweep threw', err);
			return 0;
		}
	}

	/**
	 * Generic simple kinematics: moves every Slot's local position by its
	 * `velocity.linear * dt` and applies `velocity.drag` — host/solo only.
	 * Unlike codeBlock's own tick() (deterministic per-peer, safe to run
	 * everywhere), this accumulates state frame over frame, so independent
	 * per-peer integration would slowly drift apart under differing frame
	 * timing; only the host advances it, and guests see the result via the
	 * existing ~20Hz `world-state` broadcast (HostAuthority.broadcastStateIfChanged) —
	 * the same pattern the hand-authored "Bouncy Ball" demo already uses for
	 * its own free-flight simulation. Skips a currently grabbed slot so it
	 * doesn't fight the hand it's parented to. Position is local space —
	 * correct for the common case of an unparented (root) moving object; a
	 * velocity component on a nested Slot would integrate relative to its
	 * parent instead of world space.
	 */
	private integrateVelocities(dt: number): void {
		if (!(this.options.isHost?.() ?? true)) return;
		for (const entry of this.slotsWith('velocity')) {
			const velocity = findComponent(entry.slot, 'velocity');
			if (!velocity) continue;
			const [vx, vy, vz] = velocity.linear;
			if (vx === 0 && vy === 0 && vz === 0) continue;
			if ((this.grabQuery?.getGrabbersForSlot(entry.slot.id).length ?? 0) > 0) continue;

			entry.node.position.x += vx * dt;
			entry.node.position.y += vy * dt;
			entry.node.position.z += vz * dt;

			const drag = velocity.drag ?? 0;
			if (drag > 0) {
				const decay = Math.max(1 - drag * dt, 0);
				velocity.linear = [vx * decay, vy * decay, vz * decay];
			}
		}
	}

	/** codeBlock-contributed radial menu items for whatever this hand currently holds — see radialMenu.ts. */
	getRadialExtras(slotId: string): RadialItemDef[] {
		try {
			// The object's parts count too: a camera's screen is a child of its body.
			return this.getSubtree(slotId).flatMap((entry) => entry.runtime?.getRadialItems?.() ?? []);
		} catch (err) {
			console.error(`[sceneGraph] getRadialExtras(${slotId}) threw`, err);
			return [];
		}
	}

	/** Radial items contributed by the slot and all of its descendants (a gun's scripts may live on child slots). */
	getRadialExtrasForSubtree(rootId: string): RadialItemDef[] {
		return this.getSubtree(rootId).flatMap((entry) => this.getRadialExtras(entry.slot.id));
	}

	/** Recent errors/log lines from a slot's codeBlock (compile + every hook) — surfaced in the Inspector for in-game debugging. Empty for a slot with no codeBlock. */
	getCodeBlockDebugLog(slotId: string): CodeBlockLogEntry[] {
		try {
			return this.live.get(slotId)?.runtime?.getDebugLog?.() ?? [];
		} catch (err) {
			console.error(`[sceneGraph] getCodeBlockDebugLog(${slotId}) threw`, err);
			return [];
		}
	}

	/** Narrow, host/solo-only mutation of a single field on another slot's component — used by codeBlock's `world.setComponentField`. Returns whether anything changed. */
	setComponentField(slotId: string, componentType: string, field: string, value: unknown): boolean {
		const entry = this.live.get(slotId);
		const component = entry?.slot.components.find((c) => c.type === componentType);
		if (!entry || !component) return false;
		(component as unknown as Record<string, unknown>)[field] = value;
		// Mutating the Slot's data doesn't retroactively touch the mesh created
		// from it at spawn time — refresh the one thing that visibly matters
		// for the switch/lever demo (a meshRenderer's color).
		if (componentType === 'meshRenderer' && field === 'color' && typeof value === 'string') this.paint(entry.node, value);
		// Same redraw hook reconcile() already uses for an incoming snapshot —
		// so a LOCAL mutation (e.g. a script updating its own scoreboard) also
		// redraws immediately, not just once a broadcast round-trips back.
		entry.runtime?.sync?.(entry.slot);
		// A panel is redrawn from its elements, so only a change to one of them calls for it, and once per frame however many
		// fields a script wrote (a score board rewrites several every update): see `flushUISync`.
		if (componentType === 'uiElement' || componentType === 'uiPanel') this.markUIDirty(entry);
		this.notifyChanged([slotId]);
		return true;
	}

	private uiDirty = new Set<string>();

	/** Remembers the panel that `entry` is part of (or is) as needing a redraw before the next frame. */
	private markUIDirty(entry: LiveSlot): void {
		let current: LiveSlot | undefined = entry;
		while (current && !findComponent(current.slot, 'uiPanel')) current = current.slot.parentId ? this.live.get(current.slot.parentId) : undefined;
		if (current) this.uiDirty.add(current.slot.id);
	}

	/** Redraws the panels whose elements changed since the last frame. Run after the scripts, so their writes show the same frame. */
	private flushUISync(): void {
		if (this.uiDirty.size === 0) return;
		const ids = [...this.uiDirty];
		this.uiDirty.clear();
		for (const id of ids) {
			const entry = this.live.get(id);
			if (entry) entry.runtime?.sync?.(entry.slot);
		}
	}

	/** Switches a slot (and everything below it) on or off for every player. Host/solo only; the caller broadcasts. Returns whether the state changed. */
	setSlotEnabled(slotId: string, enabled: boolean): boolean {
		const entry = this.live.get(slotId);
		if (!entry || entry.system || !!entry.slot.disabled === !enabled) return false;
		if (enabled) delete entry.slot.disabled;
		else entry.slot.disabled = true;
		entry.node.setEnabled(enabled);
		this.invalidateIndexes();
		this.notifyChanged([slotId]);
		return true;
	}

	/** Tells every code block a participant is identified and ready (its saved data can be restored). */
	dispatchPlayerReady(player: { id: string; name: string }): void {
		for (const entry of this.slotsWith('codeBlock')) entry.runtime?.onPlayerReady?.(player);
	}

	private syncUIPanels(): void {
		for (const entry of this.live.values()) {
			if (findComponent(entry.slot, 'uiPanel')) entry.runtime?.sync?.(entry.slot);
		}
	}

	private createMediaRuntime<T extends Slot['components'][number]>(
		slot: Slot,
		mesh: AbstractMesh,
		setup: (scene: Scene, mesh: AbstractMesh, component: T, callbacks: { onControl(action: MediaControlAction): void; assets?: BlobAssetLibrary; interactive?: boolean }) => MediaRuntimeBinding
	): LiveSlot['runtime'] {
		const component = slot.components.find((candidate) => candidate.type === 'audioPlayer') as T;
		const runtime = setup(this.scene, mesh, component, {
			onControl: (action) => this.options.onMediaControl?.(slot.id, action),
			assets: this.options.mediaAssets,
			// An insertable object (a disc) is played by the socket it sits in, not by clicking it.
			interactive: !findComponent(slot, 'insertable')
		});
		return runtime;
	}

	private syncSlotTransform(entry: LiveSlot): void {
		entry.slot.position = entry.node.position.asArray() as Slot['position'];
		entry.slot.rotation = (entry.node.rotationQuaternion ?? Quaternion.Identity()).asArray() as Slot['rotation'];
		entry.slot.scale = entry.node.scaling.asArray() as Slot['scale'];
	}

	// --- models ------------------------------------------------------------

	private placeholderMaterials: Partial<Record<'pending' | 'missing' | 'error', StandardMaterial>> = {};
	private priorityClock = 0;

	private placeholderMaterial(kind: 'pending' | 'missing' | 'error'): StandardMaterial {
		let material = this.placeholderMaterials[kind];
		if (!material) {
			material = new StandardMaterial(`model-placeholder-${kind}`, this.scene);
			material.emissiveColor = Color3.FromHexString(kind === 'error' ? '#ef4444' : kind === 'missing' ? '#f59e0b' : '#7c6cf6');
			material.disableLighting = true;
			material.alpha = 0.35;
			material.wireframe = false;
			this.placeholderMaterials[kind] = material;
		}
		return material;
	}

	/**
	 * A model slot exists, with its transform and logic, from the first frame.
	 * Until the model arrives it is a translucent box sized from the model's
	 * bounds; an invisible box of the same size stays in place afterwards so the
	 * laser, hand grabs and selection always have something simple to hit.
	 */
	private bindModel(entry: LiveSlot, assetId: AssetId): void {
		const root = entry.node;
		const slotId = entry.slot.id;
		const proxy = MeshBuilder.CreateBox(`${slotId}-hit`, { size: 1 }, this.scene);
		proxy.parent = root;
		proxy.visibility = 0; // not drawn, but still visible/pickable to rays
		// Use the actual triangles for large mesh colliders; a bounding proxy blocks rays from inside.
		const meshCollider = findComponent(entry.slot, 'collider')?.shape === 'mesh';
		proxy.isPickable = !meshCollider;
		proxy.metadata = { slotId };
		const placeholder = MeshBuilder.CreateBox(`${slotId}-placeholder`, { size: 1 }, this.scene);
		placeholder.parent = root;
		placeholder.isPickable = false;
		placeholder.material = this.placeholderMaterial('pending');
		root.metadata = { ...(root.metadata ?? {}), selectionMesh: proxy };

		const models = this.options.models;
		if (!models) {
			entry.assetState = 'missing';
			placeholder.material = this.placeholderMaterial('missing');
			return;
		}
		const lease = models.acquire(assetId, () => this.syncModel(slotId));
		entry.model = { assetId, lease, proxy, placeholder };
		entry.assetState = lease.state;
		this.updateModelPriority(entry);
		this.syncModel(slotId);
	}

	private syncModel(slotId: string): void {
		const entry = this.live.get(slotId);
		const model = entry?.model;
		if (!entry || !model) return;
		const state = model.lease.state;
		const extents = model.instance?.extents ?? model.lease.extents;
		model.proxy.scaling.set(...extents);
		model.placeholder.scaling.set(...extents);

		if (state === 'ready' && !model.instance) {
			// Avatars keep real-world metres so bones, height and attached items line up with the player.
			const instance = model.lease.instantiate(`${slotId}-model`, { normalize: !findComponent(entry.slot, 'avatar') });
			if (instance) {
				instance.root.parent = entry.node;
				for (const mesh of instance.root.getChildMeshes(false)) {
					mesh.metadata = { ...(mesh.metadata ?? {}), slotId };
					if (findComponent(entry.slot, 'collider')?.shape === 'mesh') mesh.isPickable = true;
				}
				model.instance = instance;
				model.placeholder.setEnabled(false);
				model.proxy.scaling.set(...instance.extents);
				if (findComponent(entry.slot, 'avatar')) model.proxy.isPickable = false;
				this.bindBoneChildren(slotId);
			} else {
				model.placeholder.material = this.placeholderMaterial('error');
				entry.assetState = 'error';
				this.options.onAssetStateChanged?.(slotId, 'error');
				return;
			}
		} else if (!model.instance) {
			model.placeholder.material = this.placeholderMaterial(state === 'error' ? 'error' : state === 'missing' ? 'missing' : 'pending');
		}
		if (entry.assetState !== state) {
			entry.assetState = state;
			this.options.onAssetStateChanged?.(slotId, state);
		}
	}

	/** Models the player is holding or standing near load first. */
	private updateModelPriority(entry: LiveSlot): void {
		const model = entry.model;
		if (!model) return;
		const viewer = this.options.getViewerPosition?.();
		let priority = viewer ? -Vector3.Distance(viewer, entry.node.getAbsolutePosition()) : 0;
		if ((this.grabQuery?.getGrabbersForSlot(entry.slot.id).length ?? 0) > 0 || this.equipQuery?.getHolderOfSlotOrAncestor(entry.slot.id)) priority += 1_000_000;
		model.lease.setPriority(priority);
	}

	private updateModelPriorities(dt: number): void {
		this.priorityClock += dt;
		if (this.priorityClock < 0.5) return;
		this.priorityClock = 0;
		for (const entry of this.live.values()) if (entry.model && entry.model.lease.state !== 'ready') this.updateModelPriority(entry);
	}

	/** A slot whose mesh changed is rebuilt together with its descendants (their nodes hang off it). */
	private rebuildSubtree(slot: Slot, tree: SlotTree): void {
		const byParent = new Map<string | null, Slot[]>();
		for (const candidate of tree) byParent.set(candidate.parentId, [...(byParent.get(candidate.parentId) ?? []), candidate]);
		const order: Slot[] = [];
		const visit = (current: Slot) => {
			order.push(current);
			for (const child of byParent.get(current.id) ?? []) visit(child);
		};
		visit(slot);
		batchMaterialUpdates(this.scene, () => {
			this.removeSlot(slot.id);
			for (const item of order) this.addSlot(item);
		});
	}

	/** Changes the colour a slot's mesh is drawn in: its instance's own colour, or its own material's. */
	private paint(node: TransformNode, color: string): void {
		const mesh = node as AbstractMesh;
		if (mesh.getClassName() === 'InstancedMesh') {
			(mesh as InstancedMesh).instancedBuffers.color = instanceColor(color);
			return;
		}
		// By class name: the material may come from another copy of Babylon's module than this file's import.
		const material = mesh.material;
		if (material?.getClassName() === 'StandardMaterial') (material as StandardMaterial).diffuseColor = Color3.FromHexString(color);
	}

	/** The hidden mesh a shape's instances are drawn from, made the first time the shape is needed. */
	private primitiveSource(shape: string): Mesh {
		let source = this.primitiveSources.get(shape);
		if (source) return source;
		if (!this.primitiveMaterial) {
			this.primitiveMaterial = new StandardMaterial('primitive-shared', this.scene);
			this.primitiveMaterial.diffuseColor = Color3.White();
			// A soft shine for every shape alike (each colour comes from its instance).
			this.primitiveMaterial.specularColor = new Color3(0.2, 0.2, 0.2);
		}
		const name = `primitive-${shape}`;
		source = shape === 'sphere'
			? MeshBuilder.CreateSphere(name, { diameter: 1 }, this.scene)
			: shape === 'cylinder'
				? MeshBuilder.CreateCylinder(name, { diameter: 1, height: 1 }, this.scene)
				: MeshBuilder.CreateBox(name, { size: 1 }, this.scene);
		source.material = this.primitiveMaterial;
		source.registerInstancedBuffer('color', 4);
		source.instancedBuffers.color = instanceColor(undefined);
		// Only its instances are seen, picked and collided with.
		source.isVisible = false;
		source.isPickable = false;
		this.primitiveSources.set(shape, source);
		return source;
	}

	// Model slots are built by bindModel(); an unknown builtin id still falls back to a box.
	private createMesh(slot: Slot, ref: MeshRef, color?: string): AbstractMesh {
		const id = slot.id;
		const shape = ref.kind === 'builtin' ? ref.id : 'box';
		// A mirrored scale turns a mesh inside out, which instances of the same mesh cannot each do their own way.
		const opacity = findComponent(slot, 'meshRenderer')?.opacity;
		const translucent = opacity !== undefined && opacity < 1;
		// A see-through mesh needs a material of its own, so it cannot be an instance either.
		if (INSTANCED_SHAPES.has(shape) && !translucent && !slot.components.some((c) => OWN_SURFACE.has(c.type)) && slot.scale.every((v) => v > 0)) {
			const instance = this.primitiveSource(shape).createInstance(id);
			instance.instancedBuffers.color = instanceColor(color);
			return instance;
		}
		let mesh: AbstractMesh;
		switch (ref.kind === 'builtin' ? ref.id : 'box') {
			case 'ground':
				mesh = MeshBuilder.CreateGround(id, { width: 20, height: 20 }, this.scene);
				break;
			case 'disc': {
				// A flat round floor of diameter 1, facing up (Babylon discs face -Z until turned).
				const disc = MeshBuilder.CreateDisc(id, { radius: 0.5, tessellation: 96, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
				disc.bakeTransformIntoVertices(Matrix.RotationX(Math.PI / 2));
				mesh = disc;
				break;
			}
			case 'sphere':
				mesh = MeshBuilder.CreateSphere(id, { diameter: 1 }, this.scene);
				break;
			case 'plane':
				mesh = MeshBuilder.CreatePlane(id, { size: 1 }, this.scene);
				break;
			case 'cylinder':
				mesh = MeshBuilder.CreateCylinder(id, { diameter: 1, height: 1 }, this.scene);
				break;
			case 'box':
			default:
				mesh = MeshBuilder.CreateBox(id, { size: 1 }, this.scene);
				break;
		}
		if (color || translucent) {
			const mat = new StandardMaterial(`${id}-mat`, this.scene);
			mat.diffuseColor = Color3.FromHexString(color ?? '#ffffff');
			if (translucent) {
				mat.alpha = Math.max(0, opacity ?? 1);
				mat.backFaceCulling = false;
			}
			mesh.material = mat;
		}
		return mesh;
	}
}
