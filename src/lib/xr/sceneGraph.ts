import {
	MeshBuilder,
	StandardMaterial,
	Color3,
	Vector3,
	Quaternion,
	TransformNode,
	type Scene,
	type AbstractMesh
} from '@babylonjs/core';
import type { MediaControlAction, Slot, SlotTree, Vec3 } from '$lib/ecs/types';
import { findComponent, isGrabbable } from '$lib/ecs/types';
import { setupMirrorSurface } from './specialSurfaces';
import { setupAudioPlayerSurface, setupVideoPlayerSurface, type MediaRuntimeBinding } from './mediaSurfaces';
import { setupParticleBurst } from './particleEffects';
import { setupImpactSound } from './impactSoundEffects';
import { setupTextDisplay } from './textDisplaySurface';
import { setupScoreboard } from './scoreboardSurface';
import { createCodeBlockHandlers, type CodeBlockHost, type RadialItemDef, type CodeBlockLogEntry } from './codeBlockRuntime';

interface LiveSlot {
	slot: Slot;
	node: TransformNode;
	/** System nodes (e.g. the Dash/Inspector panels) are grabbable like any Slot but excluded from serialize(). */
	system?: boolean;
	runtime?: {
		dispose: () => void;
		sync?: (slot: Slot) => void;
		control?: (action: MediaControlAction) => void;
		tick?: (dt: number) => void;
		onGrab?: () => void;
		onRelease?: () => void;
		onPress?: () => void;
		getRadialItems?: () => RadialItemDef[];
		getDebugLog?: () => CodeBlockLogEntry[];
	};
}

export interface SceneGraphOptions {
	onMediaControl?: (slotId: string, action: MediaControlAction) => void;
	/** codeBlock's `world.spawn`/`deleteSelf`/`deleteSlot` — route through the host-authoritative sync pipeline (see engine.ts, mirrors onMediaControl). */
	onSpawnRequest?: (slot: Slot) => void;
	onDeleteRequest?: (slotId: string) => void;
	/** codeBlock's `world.setComponentField` on ANOTHER slot — host/solo only, broadcasts the mutation. */
	onSlotMutated?: (slotId: string) => void;
	/** codeBlock's `world.isHost()`. */
	isHost?: () => boolean;
	/** codeBlock's `world.getPlayer(grabberId)` — resolves a GrabSystem grabberId to a stable player id + display name. */
	resolvePlayer?: (grabberId: string) => { id: string; name: string };
}

/** Minimal surface SceneGraph needs from GrabSystem — set post-construction (GrabSystem is built AFTER SceneGraph and itself depends on it), never imported directly to avoid a circular dependency. */
export interface GrabQuery {
	getGrabbersForSlot(slotId: string): string[];
}

/**
 * Runtime instantiation of a SlotTree into real Babylon nodes/meshes, kept in
 * sync via Slot.id <-> node.metadata.slotId. Can serialize its current live
 * state back into a SlotTree (positions/rotations/scales reflect grabs/edits) —
 * used for saving to inventory, saving a world template, and host->guest sync.
 */
export class SceneGraph {
	private live = new Map<string, LiveSlot>();
	private grabQuery: GrabQuery | null = null;

	constructor(private scene: Scene, private options: SceneGraphOptions = {}) {}

	/** Called once from engine.ts right after `new GrabSystem(scene, sceneGraph)` — see GrabQuery's doc comment. */
	setGrabQuery(grabQuery: GrabQuery): void {
		this.grabQuery = grabQuery;
	}

	load(tree: SlotTree): void {
		for (const slot of tree) this.spawnNode(slot);
		for (const slot of tree) {
			if (!slot.parentId) continue;
			const parent = this.live.get(slot.parentId)?.node;
			const self = this.live.get(slot.id)?.node;
			if (parent && self) self.parent = parent;
		}
		for (const slot of tree) {
			const node = this.live.get(slot.id)?.node;
			if (node) this.activateCodeBlock(slot, node);
		}
	}

	addSlot(slot: Slot, options?: { system?: boolean }): TransformNode {
		const node = this.spawnNode(slot);
		if (options?.system) {
			const entry = this.live.get(slot.id);
			if (entry) entry.system = true;
		}
		if (slot.parentId) {
			const parent = this.live.get(slot.parentId)?.node;
			if (parent) node.parent = parent;
		}
		this.activateCodeBlock(slot, node);
		return node;
	}

	removeSlot(slotId: string): void {
		const idsToRemove = [...this.live.entries()]
			.filter(([id, entry]) => id === slotId || this.isDescendantOf(entry.slot, slotId))
			.map(([id]) => id);
		for (const id of idsToRemove) {
			const entry = this.live.get(id);
			if (!entry) continue;
			entry.runtime?.dispose();
			entry.node.dispose();
			this.live.delete(id);
		}
	}

	dispose(): void {
		for (const entry of this.live.values()) {
			entry.runtime?.dispose();
			entry.node.dispose();
		}
		this.live.clear();
	}

	getLive(slotId: string): LiveSlot | undefined {
		return this.live.get(slotId);
	}

	getSlotIdForNode(node: AbstractMesh | TransformNode | null | undefined): string | null {
		if (!node) return null;
		return (node.metadata?.slotId as string | undefined) ?? null;
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

		entry.node.setParent(parentId ? this.live.get(parentId)!.node : null);
		entry.slot.parentId = parentId;
		this.syncSlotTransform(entry);
		return true;
	}

	controlMedia(slotId: string, action: MediaControlAction): boolean {
		const entry = this.live.get(slotId);
		if (!entry?.runtime?.control) return false;
		entry.runtime.control(action);
		return true;
	}

	allSlots(): LiveSlot[] {
		return [...this.live.values()];
	}

	/** Current world state as a fresh SlotTree (ids/parentId unchanged, transforms live). System nodes (UI panels) are excluded. */
	serialize(): SlotTree {
		return [...this.live.values()]
			.filter((entry) => !entry.system)
			.map(({ slot, node }) => {
				// A grabbed node is temporarily parented to a hand. Serialize it in
				// its Slot parent space so remote peers receive the same world pose,
				// without breaking the live grab relationship.
				const expectedParent = slot.parentId ? this.live.get(slot.parentId)?.node ?? null : null;
				const transientParent = node.parent;
				if (transientParent !== expectedParent) node.setParent(expectedParent);
				const serialized = {
					...slot,
					position: node.position.asArray() as Slot['position'],
					rotation: (node.rotationQuaternion ?? Quaternion.Identity()).asArray() as Slot['rotation'],
					scale: node.scaling.asArray() as Slot['scale']
				};
				if (transientParent !== expectedParent) node.setParent(transientParent);
				return serialized;
			});
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

		for (const id of [...this.live.keys()]) {
			if (!incomingIds.has(id) && !this.live.get(id)?.system) this.removeSlot(id);
		}

		for (const slot of tree) {
			if (ignoreSlotIds.has(slot.id)) continue;
			const existing = this.live.get(slot.id);
			if (!existing) {
				this.addSlot(slot);
				continue;
			}
			existing.slot = slot;
			existing.runtime?.sync?.(slot);
			existing.node.position = Vector3.FromArray(slot.position);
			existing.node.rotationQuaternion = Quaternion.FromArray(slot.rotation);
			existing.node.scaling = Vector3.FromArray(slot.scale);
		}

		// Apply hierarchy after every slot exists so incoming local transforms are
		// interpreted against the correct parent.
		for (const slot of tree) {
			if (ignoreSlotIds.has(slot.id)) continue;
			const node = this.live.get(slot.id)?.node;
			if (!node) continue;
			node.parent = slot.parentId ? this.live.get(slot.parentId)?.node ?? null : null;
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
		const node: TransformNode = mesh
			? this.createMesh(slot.id, mesh.meshRef, mesh.color)
			: new TransformNode(slot.id, this.scene);

		node.position = Vector3.FromArray(slot.position);
		node.rotationQuaternion = Quaternion.FromArray(slot.rotation);
		node.scaling = Vector3.FromArray(slot.scale);
		node.metadata = { ...(node.metadata ?? {}), slotId: slot.id };

		const entry: LiveSlot = { slot, node };
		this.live.set(slot.id, entry);
		if (mesh) {
			const mirror = findComponent(slot, 'mirror');
			if (mirror) entry.runtime = { dispose: setupMirrorSurface(this.scene, node as AbstractMesh, mirror.resolution) };
			const video = findComponent(slot, 'videoPlayer');
			if (video) entry.runtime = this.createMediaRuntime(slot, node as AbstractMesh, setupVideoPlayerSurface);
			const audio = findComponent(slot, 'audioPlayer');
			if (audio) entry.runtime = this.createMediaRuntime(slot, node as AbstractMesh, setupAudioPlayerSurface);
			const textDisplay = findComponent(slot, 'textDisplay');
			if (textDisplay) entry.runtime = setupTextDisplay(this.scene, node as AbstractMesh, textDisplay);
			const scoreboard = findComponent(slot, 'scoreboard');
			if (scoreboard) entry.runtime = setupScoreboard(this.scene, node as AbstractMesh, scoreboard);
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
		if (entry) entry.runtime = { dispose: () => {}, ...handlers };
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
			setComponentField: (slotId, componentType, field, value) => {
				// Host/solo-only: a guest calling this would only affect its own
				// unauthoritative copy, silently reverted by the next broadcast —
				// so it's a documented no-op rather than a confusing flash-then-revert.
				if (!(this.options.isHost?.() ?? true)) return;
				if (this.setComponentField(slotId, componentType, field, value)) {
					this.options.onSlotMutated?.(slotId);
				}
			},
			findNear: (worldPos, radius) => this.findSlotsNear(worldPos, radius),
			resolvePlayer: (grabberId) => this.options.resolvePlayer?.(grabberId) ?? { id: grabberId, name: 'Player' }
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

	/** Applies each codeBlock's tick() (own try/catch inside), integrates generic `velocity` components, and sweeps expired slots — call every frame, on every peer, solo included. Returns how many slots were removed by expiry. */
	tick(dt: number): number {
		for (const entry of this.live.values()) entry.runtime?.tick?.(dt);

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
			const expiredIds = [...this.live.entries()]
				.filter(([, entry]) => {
					const expires = findComponent(entry.slot, 'expires');
					return expires && expires.expiresAt <= now;
				})
				.map(([id]) => id);
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
		for (const entry of this.live.values()) {
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
			return this.live.get(slotId)?.runtime?.getRadialItems?.() ?? [];
		} catch (err) {
			console.error(`[sceneGraph] getRadialExtras(${slotId}) threw`, err);
			return [];
		}
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
		if (componentType === 'meshRenderer' && field === 'color' && typeof value === 'string') {
			const material = (entry.node as AbstractMesh).material as StandardMaterial | null;
			if (material) material.diffuseColor = Color3.FromHexString(value);
		}
		// Same redraw hook reconcile() already uses for an incoming snapshot —
		// so a LOCAL mutation (e.g. a script updating its own scoreboard) also
		// redraws immediately, not just once a broadcast round-trips back.
		entry.runtime?.sync?.(entry.slot);
		return true;
	}

	private createMediaRuntime<T extends Slot['components'][number]>(
		slot: Slot,
		mesh: AbstractMesh,
		setup: (scene: Scene, mesh: AbstractMesh, component: T, callbacks: { onControl(action: MediaControlAction): void }) => MediaRuntimeBinding
	): LiveSlot['runtime'] {
		const component = slot.components.find((candidate) => candidate.type === 'videoPlayer' || candidate.type === 'audioPlayer') as T;
		const runtime = setup(this.scene, mesh, component, {
			onControl: (action) => this.options.onMediaControl?.(slot.id, action)
		});
		return runtime;
	}

	private syncSlotTransform(entry: LiveSlot): void {
		entry.slot.position = entry.node.position.asArray() as Slot['position'];
		entry.slot.rotation = (entry.node.rotationQuaternion ?? Quaternion.Identity()).asArray() as Slot['rotation'];
		entry.slot.scale = entry.node.scaling.asArray() as Slot['scale'];
	}

	private createMesh(id: string, ref: string, color?: string): AbstractMesh {
		let mesh: AbstractMesh;
		switch (ref) {
			case 'ground':
				mesh = MeshBuilder.CreateGround(id, { width: 20, height: 20 }, this.scene);
				break;
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
		if (color) {
			const mat = new StandardMaterial(`${id}-mat`, this.scene);
			mat.diffuseColor = Color3.FromHexString(color);
			mesh.material = mat;
		}
		return mesh;
	}
}
