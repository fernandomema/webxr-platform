import type { WorldStorageService } from './worldStorageService.ts';
import type { ScriptWorldItems } from './scriptWorldItems.ts';
import { normalizeExternalSource } from '../inventory/external.ts';
import { requestScriptJson } from './scriptNet.ts';
import { CodeBlockVm, isCodeBlockSandboxReady, type ReturnMode } from './sandbox/codeBlockVm.ts';
import { Vector3, Quaternion, type TransformNode } from '@babylonjs/core';
import type { Component, Slot, UIEvent, Vec3, Quat } from '../ecs/types.ts';
import type { UIMediaState } from './uiPanelSurface.ts';
import type { AudioTrackHandle, ScriptAudio } from './scriptAudio.ts';
import type { PlayerPoseView, PlayerSummary, TeleportTarget } from './playerPoses.ts';
import type { PayResult, ScriptPayments } from './payments/types.ts';
import type { ScriptPhysics } from './scriptPhysics.ts';
import type { ScriptDash, ScriptDashTab, ScriptSystem } from './scriptDash.ts';
import { isAssetId } from '../assets/ref.ts';
import { hashSlot } from '../ecs/slotHash.ts';

/** What SceneGraph exposes to a codeBlock's compiled handlers — narrow, read-mostly, no Babylon types leak into `ctx`. */
export interface CodeBlockHost {
	getSlot(slotId: string): Slot | undefined;
	getNode(slotId: string): TransformNode | undefined;
	getChildren(parentId: string | null): Slot[];
	allSlots(): Slot[];
	getGrabbers(slotId: string): string[];
	isHost(): boolean;
	/** `ephemeral`: the slot expires by itself (a sound, a spark), so guests get just it and not a whole new snapshot of the world. */
	requestSpawn(slot: Slot, options?: { ephemeral?: boolean }): void;
	requestDelete(slotId: string): void;
	/** Host/solo only — a guest's call is a documented no-op, corrected by the next broadcast anyway. */
	setComponentField(slotId: string, componentType: string, field: string, value: unknown, broadcast?: boolean): void;
	/** Adds a component to another slot, or replaces the one of its type. Host/solo only; returns whether it was done. */
	setComponent(slotId: string, component: Component, broadcast?: boolean): boolean;
	/** Takes a component of a type off another slot. Host/solo only; returns whether it was done. */
	removeComponent(slotId: string, componentType: string, broadcast?: boolean): boolean;
	/** Moves a slot under another (or to the root, `null`), keeping where it is in the world. Host/solo only; returns whether it was done. */
	reparent(slotId: string, parentId: string | null, broadcast?: boolean): boolean;
	/** Records a slot's node transform (moved by a script) as its data and, when `broadcast`, sends it to guests. Host/solo only. */
	commitTransform(slotId: string, broadcast?: boolean): void;
	/** Every non-system Slot whose world position is within `radius` of `worldPos` — a generic spatial query for proximity/collision-style logic (hit detection, triggers, area effects), not tied to any one demo. O(live slot count) per call. */
	findNear(worldPos: Vec3, radius: number): Slot[];
	/** Casts a ray through the live scene — generic aiming/hit-testing for any tool (a laser, a thrown object, a spray), not tied to any one demo. `null` when nothing pickable is hit within `maxDistance`. */
	raycast(origin: Vec3, direction: Vec3, maxDistance: number, ignore?: readonly string[]): RaycastHit | null;
	/**
	 * The slots whose pickable meshes come within `radius` of the segment `from`-`to` (a capsule; a sphere when both ends are
	 * the same point), nearest first — generic touch-testing for any tool (a blade, a screw, a hand-sized trigger zone), not
	 * tied to any one demo. Meshes are taken as their oriented bounding boxes (ellipsoids for builtin spheres).
	 */
	overlap(from: Vec3, to: Vec3, radius: number, ignore?: readonly string[]): string[];
	/** Resolves a grabberId (from `getGrabbers`/`ctx.grab.heldBy()`) to a stable player id + display name — generic attribution for scripts that need to know "who did this" (scoreboards, ownership tags, logs), not tied to any one demo. */
	resolvePlayer(grabberId: string): { id: string; name: string };
	/** Everyone in the world, the host included. Each `id` is the one `onPlayerReady`, `ctx.storage.player` and hand events use. */
	getPlayers(): PlayerSummary[];
	/** Where a player's head (and tracked hands) are now, in world space; `null` when that player is not in the world. */
	getPlayerPose(playerId: string): PlayerPoseView | null;
	/** Moves a player to a floor position and optionally turns them. Host/solo only; returns whether the player was found and the target was usable. */
	teleportPlayer(playerId: string, target: TeleportTarget): boolean;
	/** Puts an equippable slot in a hand of a player (replacing what that hand held). Host/solo only, and for the player at this device: returns whether it was done. */
	equipPlayer(playerId: string, slotId: string, hand: 'left' | 'right'): boolean;
	/** Takes whatever a player holds equipped in a hand off it. Same limits as `equipPlayer`. */
	unequipPlayer(playerId: string, hand: 'left' | 'right'): boolean;
	/** Which player/hand has this slot — or one of its ancestors — equipped, if any. */
	getEquipHolder(slotId: string): { playerId: string; hand: 'left' | 'right' } | null;
	/** Playback state, on this peer, of the `video` uiElement `slotId`. */
	getUIMedia(slotId: string): UIMediaState | undefined;
	/** Current text, on this peer, of the `input` uiElement `slotId`. */
	getUIInputText(slotId: string): string | undefined;
	/** Opens the game's menu (the dash) at a tab on this device; `invite` shows the choices of who can join first. Absent where there is no menu. */
	openDash?(tab: string, options?: { invite?: boolean }): void;
	/** What the scripts of the player's own menu may do to it (add tabs). Absent for a world's scripts. */
	dash?: ScriptDash;
	/** Readings of the game (frame rate, session) for the scripts of the player's menu. Absent for a world's scripts. */
	system?: ScriptSystem;
	/** Questions about the solids of the world (rays, sweeps, overlaps). Absent where the engine keeps no collision world. */
	physics?: ScriptPhysics;
	/** Sets a player's body speed, or adds to it (a push). Host/solo only; returns whether the player was found. Absent where bodies are not driven by the engine. */
	setPlayerVelocity?(playerId: string, velocity: Vec3, add: boolean): boolean;
	/** Makes a controller of a player buzz. Host/solo only; returns whether the player was found. */
	hapticPulse?(playerId: string, hand: 'left' | 'right' | 'both', intensity: number, durationMs: number): boolean;
	/** Sends guests what scripts wrote with `broadcast: false` since the last send, as a difference. Host/solo only. */
	flush?(): void;
	/** Switches a slot and everything below it on or off for every player. Host/solo only (`false` on a guest). */
	setSlotEnabled(slotId: string, enabled: boolean, broadcast?: boolean): boolean;
	/** Persistent storage and leaderboards. Absent where the engine provides none; scripts then see them as unavailable. */
	storage?: WorldStorageService;
	/** Objects the world has saved for its host (see `ctx.storage.items`). Absent where nothing can be kept. */
	worldItems?: ScriptWorldItems;
	/** Audio analysis and clock-accurate playback. Absent where the engine has no audio. */
	audio?: ScriptAudio;
	/**
	 * Routes of our own site a script with this source may call through `ctx.net` (with the player's session). The game answers for
	 * the scripts it ships itself, so a world's own code can never reach our API; absent means none.
	 */
	sameOriginPathsFor?(code: string): readonly string[];
	/** Paying for the products a published world sells. Absent where credits cannot be spent (an unpublished world, a guest that is not the host). */
	payments?: ScriptPayments;
	/** Imports an asset of an external library (`source:id`) into this device's asset store and local inventory. Host/solo only. */
	importLibraryAsset(ref: string, name: string): Promise<string>;
	/** Builds an object from outside the world (see `inventory/external.ts`) with no slot of its own to hold it. Host/solo only; null when it could not be loaded. */
	loadExternalItem(source: unknown, options?: { id?: unknown; parentId?: unknown; position?: unknown; rotation?: unknown; scale?: unknown }): Promise<{ id: string; roots: string[] } | null>;
	/** Takes down an object `loadExternalItem` built. Returns whether there was one. */
	unloadExternalItem(id: string): boolean;
}

/** A ray's hit against the live scene, resolved back to the Slot it belongs to — see `CodeBlockHost.raycast`. */
export interface RaycastHit {
	slotId: string;
	point: Vec3;
	normal: Vec3;
	/** Texture coordinates at the hit point, if the mesh has UVs (every builtin primitive does) — for painting a `surfaceMask` or similar at the exact spot touched. */
	u: number;
	v: number;
}

/** Who and which hand an equip/unequip/trigger event is about. */
export interface HandEvent {
	hand: 'left' | 'right';
	playerId: string;
	playerName: string;
}

/**
 * The trigger of the hand holding this object. `press`/`release` fire on the
 * button edges; `value` carries the analog pull (0-1) when the controller
 * reports one.
 */
export interface TriggerEvent extends HandEvent {
	phase: 'press' | 'release' | 'value';
	value: number;
}

export interface RadialItemDef {
	label: string;
	isEnabled(): boolean;
	onSelect(): void | Promise<void>;
}

export interface CodeBlockHandlers {
	onSpawn?(): void;
	/**
	 * A participant is identified and their saved data can be restored: fired for the local player once the
	 * world is up, and for each guest when it joins. Runs once, on the host (or solo player); `player` is the
	 * same `{ id, name }` that `ctx.storage.player(player)` takes. May be async; a rejection is logged.
	 */
	onPlayerReady?(player: { id: string; name: string }): void | Promise<void>;
	/** A guest left the world (closed the tab, lost the connection, or was dropped). Runs once, on the host (or solo player). */
	onPlayerLeft?(player: { id: string; name: string }): void;
	/** An `instancer` on this slot finished building its object: the values its parameters took and the ids of the slots it made. Runs once, on the host (or solo player). */
	onInstance?(instance: { values: Record<string, string | number | boolean>; slotIds: string[] }): void;
	onGrab?(): void;
	onRelease?(): void;
	/** Fired by PressableButtonSystem once a `pressableButton` component's depression crosses its threshold — see interaction/pressableButtonSystem.ts. Unrelated to grabbing. */
	onPress?(): void;
	/**
	 * A UI interaction on this element or any uiElement below it: `press` (button), `change` (input text,
	 * debounced) or `submit` (Enter in an input). Runs once, on the host (or solo player).
	 */
	onUIEvent?(event: UIEvent): void;
	/** Fired when this object (or the object this one is a child of) is equipped in a hand. */
	onEquip?(event: HandEvent): void;
	onUnequip?(event: HandEvent): void;
	/**
	 * Fired for the trigger of the hand holding the equipped object, on this
	 * slot and every descendant. Returning `false` lets the press fall through
	 * to the normal laser/UI behaviour; anything else consumes it. Runs once,
	 * on the host (or solo player), so effects such as `ctx.world.spawn` are not duplicated.
	 */
	onTrigger?(event: TriggerEvent): boolean | void;
	tick?(dt: number): void;
	getRadialItems?(): RadialItemDef[];
}

export interface CodeBlockLogEntry {
	level: 'log' | 'error';
	hook: string;
	message: string;
	timestamp: number;
}

/** What `createCodeBlockHandlers` actually returns — the script-authored handlers plus a runtime-owned debug feed the Inspector can read (see WorldObjectActions.svelte, which shows it in the in-game inspector). Not part of `CodeBlockHandlers` because scripts never provide `getDebugLog` themselves. */
export interface CodeBlockRuntime extends CodeBlockHandlers {
	getDebugLog(): CodeBlockLogEntry[];
	/** Called when the slot goes away (a world is left, the slot is deleted or rebuilt): stops what the script started and still runs, such as tracks it is playing. */
	dispose(): void;
}

/** What a code block has started that outlives a call, so that removing the block can end it. */
interface ScriptScope {
	disposed: boolean;
	tracks: Set<AudioTrackHandle>;
	/** The clock this script sees: its `tick` gets `delta`, which is the frame's time times `scale`. */
	time?: ScriptClock;
}

/** The clock of one script (`ctx.time`): a scale for slow motion, and an accumulator for steps of a fixed length. */
interface ScriptClock {
	scale: number;
	delta: number;
	rawDelta: number;
	elapsed: number;
	accumulator: number;
}

const newClock = (): ScriptClock => ({ scale: 1, delta: 0, rawDelta: 0, elapsed: 0, accumulator: 0 });

const MAX_LOG_ENTRIES = 30;

// --- world/local transform conversion (a grabbed node is re-parented to the
// hand, so its LOCAL transform is meaningless to a script reasoning in world
// space — see sceneGraph.ts's serialize() comment, same trap) ---

function getWorldPosition(node: TransformNode): Vec3 {
	node.computeWorldMatrix(true);
	return node.absolutePosition.asArray() as Vec3;
}

function getWorldRotation(node: TransformNode): Quat {
	node.computeWorldMatrix(true);
	const parent = node.parent as TransformNode | null;
	if (!parent) return (node.rotationQuaternion ?? Quaternion.Identity()).asArray() as Quat;
	parent.computeWorldMatrix(true);
	const parentWorldQuat = Quaternion.FromRotationMatrix(parent.getWorldMatrix().getRotationMatrix());
	const local = node.rotationQuaternion ?? Quaternion.Identity();
	return parentWorldQuat.multiply(local).asArray() as Quat;
}

function setWorldPosition(node: TransformNode, worldPos: Vec3): void {
	const parent = node.parent as TransformNode | null;
	if (!parent) {
		node.position = Vector3.FromArray(worldPos);
		return;
	}
	parent.computeWorldMatrix(true);
	const invParent = parent.getWorldMatrix().clone().invert();
	node.position = Vector3.TransformCoordinates(Vector3.FromArray(worldPos), invParent);
}

function setWorldRotation(node: TransformNode, worldRot: Quat): void {
	const worldQuat = Quaternion.FromArray(worldRot);
	const parent = node.parent as TransformNode | null;
	if (!parent) {
		node.rotationQuaternion = worldQuat;
		return;
	}
	parent.computeWorldMatrix(true);
	const parentWorldQuat = Quaternion.FromRotationMatrix(parent.getWorldMatrix().getRotationMatrix());
	node.rotationQuaternion = Quaternion.Inverse(parentWorldQuat).multiply(worldQuat);
}

// --- small math helpers so scripts don't need to hand-roll quaternion math ---
const math = {
	quatFromAxisAngle: (axis: Vec3, angleRad: number): Quat =>
		Quaternion.RotationAxis(Vector3.FromArray(axis).normalize(), angleRad).asArray() as Quat,
	vecAdd: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
	vecSub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
	vecScale: (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s],
	vecDot: (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
	vecCross: (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
	vecLength: (a: Vec3): number => Math.hypot(a[0], a[1], a[2]),
	vecNormalize: (a: Vec3): Vec3 => {
		const len = Math.hypot(a[0], a[1], a[2]) || 1;
		return [a[0] / len, a[1] / len, a[2] / len];
	},
	quatMultiply: (a: Quat, b: Quat): Quat =>
		Quaternion.FromArray(a).multiply(Quaternion.FromArray(b)).asArray() as Quat,
	/** Rotates a vector by a quaternion — e.g. `rotateVec(pose.rotation, [0, 0, 1])` is the forward direction. */
	rotateVec: (q: Quat, v: Vec3): Vec3 =>
		Vector3.FromArray(v).applyRotationQuaternion(Quaternion.FromArray(q)).asArray() as Vec3
};

export interface WorldPose {
	position: Vec3;
	rotation: Quat;
	/** Unit vectors in world space (local +Z, +Y, +X). Unaffected by the node's scale. */
	forward: Vec3;
	up: Vec3;
	right: Vec3;
}

/** The true world pose of a node, computed from its full world matrix so nested rotation and scale are handled correctly. */
function getWorldPose(node: TransformNode): WorldPose {
	node.computeWorldMatrix(true);
	const rotation = new Quaternion();
	node.getWorldMatrix().decompose(new Vector3(), rotation, new Vector3());
	const position = node.absolutePosition.asArray() as Vec3;
	const axis = (v: Vector3) => v.applyRotationQuaternion(rotation).asArray() as Vec3;
	return {
		position,
		rotation: rotation.asArray() as Quat,
		forward: axis(new Vector3(0, 0, 1)),
		up: axis(new Vector3(0, 1, 0)),
		right: axis(new Vector3(1, 0, 0))
	};
}

function formatLogArgs(args: unknown[]): string {
	return args
		.map((a) => {
			if (typeof a === 'string') return a;
			try {
				return JSON.stringify(a);
			} catch {
				return String(a);
			}
		})
		.join(' ');
}

function requireStorage(host: CodeBlockHost): WorldStorageService {
	if (!host.storage) throw new Error('Storage is not available here');
	return host.storage;
}

/** A player named the way scripts name them: an id, or anything with an `id` (`{ id, name }` from an event or `world.getPlayer`). */
function playerIdOf(player: unknown): string | undefined {
	const id = typeof player === 'string' ? player : (player as { id?: unknown } | null | undefined)?.id;
	return typeof id === 'string' && id ? id : undefined;
}

function requireAudio(host: CodeBlockHost): ScriptAudio {
	if (!host.audio) throw new Error('Audio is not available here');
	return host.audio;
}

function buildCtx(slotId: string, node: TransformNode, host: CodeBlockHost, pushLog: (level: 'log' | 'error', hook: string, message: string) => void, scope: ScriptScope, sameOriginPaths: readonly string[] = []) {
	return {
		self: {
			id: slotId,
			getSlot: () => host.getSlot(slotId),
			getComponent: (type: string) => host.getSlot(slotId)?.components.find((c) => c.type === type),
			/** One field of one of its components, as a copy (undefined when it has none): one call, where reading it through `getComponent` crosses into the world at each step. */
			getField: (type: string, field: string) => fieldOf(host.getSlot(slotId), type, field),
			getWorldPosition: () => getWorldPosition(node),
			getWorldRotation: () => getWorldRotation(node),
			setWorldPosition: (v: Vec3) => setWorldPosition(node, v),
			setWorldRotation: (q: Quat) => setWorldRotation(node, q),
			/** Local decorative animation on this peer; does not mutate authored transforms or broadcast a pose. */
			setLocalTransform: (pose: { position?: Vec3; rotation?: Quat; scale?: Vec3 }) => {
				if (pose.position?.length === 3 && pose.position.every(Number.isFinite)) node.position.copyFromFloats(...pose.position);
				if (pose.rotation?.length === 4 && pose.rotation.every(Number.isFinite)) node.rotationQuaternion = Quaternion.FromArray(pose.rotation);
				if (pose.scale?.length === 3 && pose.scale.every((value) => Number.isFinite(value) && value > 0)) node.scaling.copyFromFloats(...pose.scale);
			}
		},
		hierarchy: {
			getSlot: (id: string) => host.getSlot(id),
			getChildren: (id: string | null) => host.getChildren(id),
			getParent: (id: string) => {
				const parentId = host.getSlot(id)?.parentId;
				return parentId ? host.getSlot(parentId) : undefined;
			},
			findByName: (name: string) => host.allSlots().find((s) => s.name === name),
			/**
			 * One field of a component of any slot, as a copy (undefined when the slot or the component is missing). One call, where `getSlot(id).components.find(...)`
			 * crosses into the world at every step: what to use in a `tick`, which runs every frame.
			 */
			getField: (id: string, type: string, field: string) => fieldOf(host.getSlot(id), type, field),
			/** Stable content hash of a slot and its descendants, independent of ids and the root's world pose; null for a missing slot. */
			getSlotHash: async (id: string): Promise<string | null> => {
				const root = host.getSlot(id);
				return root ? hashSlot(root, (parentId) => host.getChildren(parentId)) : null;
			},
			/** World position, rotation and direction vectors of any slot — use this (not summed local positions) to spawn from a child such as a gun's muzzle. */
			getWorldPose: (id: string): WorldPose | undefined => {
				const target = host.getNode(id);
				return target ? getWorldPose(target) : undefined;
			}
		},
		equip: {
			/** Whether this object (or the one it belongs to) is equipped in a hand right now. */
			isEquipped: () => host.getEquipHolder(slotId) !== null,
			holder: () => host.getEquipHolder(slotId)
		},
		grab: {
			isHeld: () => host.getGrabbers(slotId).length > 0,
			heldBy: () => host.getGrabbers(slotId),
			/** Whether a hand holds ANOTHER slot or has it (or what it belongs to) equipped — for tools that must leave alone what a player has hold of. */
			isSlotHeld: (targetId: string) => host.getGrabbers(targetId).length > 0 || host.getEquipHolder(targetId) !== null
		},
		world: {
			isHost: () => host.isHost(),
			/**
			 * Adds a slot to the world for everyone. With `{ ephemeral: true }` the slot should carry an `expires` (a sound, a spark, a
			 * tracer): guests then get only that slot, not a new snapshot of the whole world, so it is cheap enough to do every shot.
			 */
			spawn: (partial: Partial<Slot> & { name: string }, options?: { ephemeral?: boolean }) => {
				const spawned: Slot = {
					id: crypto.randomUUID(),
					parentId: null,
					position: [0, 0, 0],
					rotation: [0, 0, 0, 1],
					scale: [1, 1, 1],
					components: [],
					...partial
				};
				host.requestSpawn(spawned, options);
			},
			/**
			 * Builds a scene fragment (a `fragment` asset: a map, a room) in the world for everyone, under a new slot placed by `options`, and
			 * returns that slot's id (null when `assetId` is not an asset). Every peer builds the content itself from the asset, so only the
			 * small slot travels. The content is scenery and does not count in the world's slot limit. Switch the slot off with
			 * `setSlotEnabled` to take the content down and keep the slot, or `unloadFragment` to remove both.
			 */
			loadFragment: (assetId: string, options?: { id?: string; name?: string; parentId?: string | null; position?: Vec3; rotation?: Quat; scale?: Vec3; disabled?: boolean }): string | null => {
				if (!isAssetId(assetId)) return null;
				const o = options ?? {};
				const vec = (v: unknown, n: number, fallback: number[]) => (Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? v : fallback);
				const id = typeof o.id === 'string' && o.id.length > 0 && o.id.length <= 120 ? o.id : crypto.randomUUID();
				host.requestSpawn({
					id,
					parentId: typeof o.parentId === 'string' ? o.parentId : null,
					name: typeof o.name === 'string' ? o.name.slice(0, 120) : 'Fragment',
					position: vec(o.position, 3, [0, 0, 0]) as Vec3,
					rotation: vec(o.rotation, 4, [0, 0, 0, 1]) as Quat,
					scale: vec(o.scale, 3, [1, 1, 1]) as Vec3,
					components: [{ type: 'fragment', source: { kind: 'asset', assetId } }],
					...(o.disabled ? { disabled: true } : {})
				});
				return id;
			},
			/** Removes a slot made by `loadFragment`, and with it the content it built. */
			unloadFragment: (slotId: string) => host.requestDelete(slotId),
			/**
			 * Adds a slot with a `loader` component for an object from outside the world and returns its id; null when `source` does not name one.
			 * `source` is `{ adapter: 'builtin' | 'marketplace' | 'cloud', id }` or `{ adapter: 'worldStorage', key }` (or `id`). Only the host
			 * reads the object, everyone sees it. The slot is part of the world and is saved with it; the object it builds is not. Switch the
			 * slot off with `setSlotEnabled` to take the object down, or delete the slot.
			 */
			addLoader: (source: unknown, options?: { id?: string; name?: string; parentId?: string | null; position?: Vec3; rotation?: Quat; scale?: Vec3; disabled?: boolean }): string | null => {
				const ref = normalizeExternalSource(source);
				if (!ref) return null;
				const o = options ?? {};
				const vec = (v: unknown, n: number, fallback: number[]) => (Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? v : fallback);
				const id = typeof o.id === 'string' && o.id.length > 0 && o.id.length <= 120 ? o.id : crypto.randomUUID();
				host.requestSpawn({
					id,
					parentId: typeof o.parentId === 'string' ? o.parentId : null,
					name: typeof o.name === 'string' ? o.name.slice(0, 120) : 'Loader',
					position: vec(o.position, 3, [0, 0, 0]) as Vec3,
					rotation: vec(o.rotation, 4, [0, 0, 0, 1]) as Quat,
					scale: vec(o.scale, 3, [1, 1, 1]) as Vec3,
					components: [{ type: 'loader', adapter: ref.adapter, ...(ref.id ? { id: ref.id } : {}), ...(ref.key ? { key: ref.key } : {}) }],
					...(o.disabled ? { disabled: true } : {})
				});
				return id;
			},
			/**
			 * Builds an object from outside the world right away, with no slot or component of your own to hold it (`source` as in `addLoader`).
			 * `options` may give the `parentId` its roots hang from, and a `position`, `rotation` and `scale` for them. Resolves `{ id, roots }`
			 * (the id to take it down with, and its root slots), or null when it could not be loaded: not the host, it does not exist, it is
			 * not public, or too much is loaded already. Nothing is saved: do it again the next time the world runs.
			 */
			loadItem: (source: unknown, options?: { id?: string; parentId?: string | null; position?: Vec3; rotation?: Quat; scale?: Vec3 }) => host.loadExternalItem(source, options),
			/** Takes down an object `loadItem` built. Returns whether there was one. */
			unloadItem: (id: string): boolean => host.unloadExternalItem(id),
			/**
			 * Sends everything written with `broadcast: false` since the last send to the guests, as one difference (only the slots and
			 * components that changed), instead of a write per change: update quietly as often as needed, `flush()` a few times a second.
			 */
			flush: () => host.flush?.(),
			/** Switches a slot (and everything below it) on or off for all players: hidden, not pickable, not grabbable. Host/solo only; returns whether it changed. Its code blocks keep running. */
			setSlotEnabled: (targetId: string, enabled: boolean, broadcast = true): boolean => host.setSlotEnabled(targetId, enabled, broadcast),
			deleteSelf: () => host.requestDelete(slotId),
			deleteSlot: (id: string) => host.requestDelete(id),
			/** `broadcast: false` updates this peer only (no snapshot to guests) — for per-frame updates, followed by a broadcasting call once in a while. */
			setComponentField: (targetId: string, componentType: string, field: string, value: unknown, broadcast = true) =>
				host.setComponentField(targetId, componentType, field, value, broadcast),
			/**
			 * Gives ANOTHER slot a component (or replaces the one of its type), for tools that change what a thing is made of. Host/solo
			 * only, like `setComponentField`; returns whether it was done. Refused for code and identity components.
			 */
			setComponent: (targetId: string, component: Component, broadcast = true): boolean => host.setComponent(targetId, component, broadcast),
			/** Takes the component of a type off ANOTHER slot (the counterpart of `setComponent`). Host/solo only; returns whether it was done. */
			removeComponent: (targetId: string, componentType: string, broadcast = true): boolean => host.removeComponent(targetId, componentType, broadcast),
			/**
			 * Puts ANOTHER slot at a world position and/or rotation, and optionally a local `scale` — for tools that straighten,
			 * snap, size or place objects. Host/solo only, like `setComponentField`. Refused (returns false) while a hand holds the
			 * slot or it is equipped, so it never fights a player. `broadcast: false` moves it on this peer only.
			 */
			setWorldPose: (targetId: string, pose: { position?: Vec3; rotation?: Quat; scale?: Vec3 }, broadcast = true): boolean => {
				if (!host.isHost()) return false;
				const target = host.getNode(targetId);
				if (!target || host.getGrabbers(targetId).length > 0 || host.getEquipHolder(targetId)) return false;
				if (pose.position) setWorldPosition(target, pose.position);
				if (pose.rotation) setWorldRotation(target, pose.rotation);
				if (pose.scale?.length === 3 && pose.scale.every((value) => Number.isFinite(value) && value > 0)) target.scaling.copyFromFloats(...pose.scale);
				host.commitTransform(targetId, broadcast);
				return true;
			},
			/**
			 * Sets where ANOTHER slot is relative to its parent, and optionally its scale — for parts that move inside something
			 * (a gauge needle, a bar that shrinks), including parts of a tool a player has equipped, which `setWorldPose` refuses.
			 * Host/solo only. Refused for a slot a hand holds or has equipped itself. With `broadcast: false` guests still get the
			 * new pose with the next ~20 Hz state update, so it is cheap enough to do every frame.
			 */
			setLocalPose: (targetId: string, pose: { position?: Vec3; rotation?: Quat; scale?: Vec3 }, broadcast = true): boolean => {
				if (!host.isHost()) return false;
				const target = host.getNode(targetId);
				const slot = host.getSlot(targetId);
				if (!target || !slot || host.getGrabbers(targetId).length > 0) return false;
				// The holder of the slot's parent is the same hand: only the slot a hand actually holds is out of bounds.
				if (host.getEquipHolder(targetId) && !(slot.parentId && host.getEquipHolder(slot.parentId))) return false;
				const finite = (v: readonly number[] | undefined, length: number) => !v || (v.length === length && v.every(Number.isFinite));
				if (!finite(pose.position, 3) || !finite(pose.rotation, 4) || (pose.scale && !(pose.scale.length === 3 && pose.scale.every((value) => Number.isFinite(value) && value > 0)))) return false;
				if (pose.position) target.position.copyFromFloats(...pose.position);
				if (pose.rotation) target.rotationQuaternion = Quaternion.FromArray(pose.rotation).normalize();
				if (pose.scale) target.scaling.copyFromFloats(...pose.scale);
				host.commitTransform(targetId, broadcast);
				return true;
			},
			/**
			 * Moves ANOTHER slot under `parentId` (or to the root, `null`), keeping where it is in the world — for tools that
			 * group, attach or detach things. Host/solo only. Refused (returns false) while a hand holds or has equipped the
			 * slot, and for a move that would put a slot under itself.
			 */
			setParent: (targetId: string, parentId: string | null, broadcast = true): boolean => {
				if (!host.isHost() || host.getGrabbers(targetId).length > 0 || host.getEquipHolder(targetId)) return false;
				return host.reparent(targetId, parentId, broadcast);
			},
			findNear: (worldPos: Vec3, radius: number) => host.findNear(worldPos, radius),
			/** `options.ignore`: slots the ray passes through, with everything under them (a tool aiming past its own parts and what it holds). */
			raycast: (origin: Vec3, direction: Vec3, maxDistance: number, options?: { ignore?: string[] }) => host.raycast(origin, direction, maxDistance, options?.ignore),
			/** Ids of the slots touching the capsule `from`-`to` of `radius` (nearest first). `options.ignore` as for `raycast`. */
			overlap: (from: Vec3, to: Vec3, radius: number, options?: { ignore?: string[] }) => host.overlap(from, to, radius, options?.ignore),
			getPlayer: (grabberId: string) => host.resolvePlayer(grabberId),
			/** Everyone in the world, as `{ id, name, role }`. The ids are the ones hand events and `ctx.storage.player` take. */
			getPlayers: () => host.getPlayers(),
			/**
			 * Where a player's head and hands are, as `{ head, left?, right? }` with `position`, `rotation` and the `forward`,
			 * `up` and `right` directions of each; `null` for someone who is not here. A desktop player has no hands.
			 */
			getPlayerPose: (playerId: string) => host.getPlayerPose(playerId),
			/** Puts a player's feet at `target.position`, facing `target.yaw` (radians, 0 looks along +Z). Host/solo only; returns whether it was done. */
			teleportPlayer: (playerId: string, target: TeleportTarget) => host.teleportPlayer(playerId, target),
			/**
			 * Sets the speed of a player's body (m/s, `[x, y, z]`), or with `{ add: true }` adds to it: a knockback, a launch pad, a shove. The
			 * vertical part is a jump if it points up; the horizontal part fades by the world's `characterController.impulseDrag`. Host/solo only;
			 * returns whether the player was found.
			 */
			setPlayerVelocity: (playerId: unknown, velocity: Vec3, options?: { add?: boolean }): boolean => {
				const id = playerIdOf(playerId);
				const ok = Array.isArray(velocity) && velocity.length === 3 && velocity.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 200);
				if (!id || !ok || !host.isHost()) return false;
				return host.setPlayerVelocity?.(id, velocity, options?.add === true) ?? false;
			},
			/**
			 * Puts the equippable `slotId` in the `hand` ('left' or 'right') of a player, replacing what it held, as if they had equipped it
			 * from the radial menu: its `onEquip` runs and its trigger then drives its `onTrigger`. Host/solo only, and only for the player at
			 * the device that runs the world (a guest equips by hand); returns whether it was done. A desktop player has the right hand only.
			 */
			equipPlayer: (playerId: string, slotId: string, hand: 'left' | 'right') => (hand === 'left' || hand === 'right') && host.equipPlayer(playerId, slotId, hand),
			/** Takes what a player holds equipped in a hand off it (`onUnequip` runs; it stays where the hand was). Same limits as `equipPlayer`. */
			unequipPlayer: (playerId: string, hand: 'left' | 'right') => (hand === 'left' || hand === 'right') && host.unequipPlayer(playerId, hand)
		},
		physics: {
			/** The first solid a ray meets within `maxDistance` m, as `{ slotId, t, point, normal }`, or null. `options.ignore`: slots to pass through, with what is under them. */
			raycast: (origin: Vec3, direction: Vec3, maxDistance: number, options?: { ignore?: string[] }) => host.physics?.raycast(origin, direction, maxDistance, options) ?? null,
			/** Moves a sphere along `direction` and says where it first touches a solid: `{ slotId, t, point, normal }`, or null. */
			sphereCast: (origin: Vec3, radius: number, direction: Vec3, maxDistance: number, options?: { ignore?: string[] }) => host.physics?.sphereCast(origin, radius, direction, maxDistance, options) ?? null,
			/** Every solid a sphere is inside of or touching, deepest first, as `{ slotId, normal, depth, point }`: push the sphere out along `normal` by `depth`. */
			overlapSphere: (center: Vec3, radius: number, options?: { ignore?: string[] }) => host.physics?.overlapSphere(center, radius, options) ?? [],
			/** The solid nearest to a point (within `maxDistance`), as `{ slotId, normal, depth, point, distance }`, or null. */
			closest: (point: Vec3, maxDistance?: number, options?: { ignore?: string[] }) => host.physics?.closest(point, maxDistance, options) ?? null
		},
		haptics: {
			/** Makes the controller(s) of a player buzz: `{ hand: 'left' | 'right' | 'both' (both), intensity: 0 to 1 (0.5), durationMs (100) }`. Host/solo only; returns whether the player was found. */
			pulse: (playerId: unknown, options: { hand?: 'left' | 'right' | 'both'; intensity?: number; durationMs?: number } = {}): boolean => {
				const id = playerIdOf(playerId);
				if (!id || !host.isHost()) return false;
				const hand = options.hand === 'left' || options.hand === 'right' ? options.hand : 'both';
				const intensity = typeof options.intensity === 'number' && Number.isFinite(options.intensity) ? Math.min(1, Math.max(0, options.intensity)) : 0.5;
				const durationMs = typeof options.durationMs === 'number' && Number.isFinite(options.durationMs) ? Math.min(2000, Math.max(1, options.durationMs)) : 100;
				return host.hapticPulse?.(id, hand, intensity, durationMs) ?? false;
			}
		},
		particles: {
			burst: (opts: { color?: string; count?: number; durationMs?: number } = {}) => {
				const pos = getWorldPosition(node);
				const durationMs = opts.durationMs ?? 1200;
				host.requestSpawn({
					id: crypto.randomUUID(),
					parentId: null,
					name: 'Particle Burst',
					position: pos,
					rotation: [0, 0, 0, 1],
					scale: [1, 1, 1],
					components: [
						{ type: 'particleBurst', color: opts.color, count: opts.count, durationMs },
						{ type: 'expires', expiresAt: Date.now() + durationMs }
					]
				}, { ephemeral: true });
			}
		},
		audio: {
			/** Plays a short synthesized percussive sound at self's current position — see impactSoundEffects.ts (no sound file to host/guess a URL for). */
			play: (
				opts: { frequency?: number; pitchDrop?: number; noiseMix?: number; durationMs?: number; volume?: number } = {}
			) => {
				const pos = getWorldPosition(node);
				const durationMs = opts.durationMs ?? 220;
				host.requestSpawn({
					id: crypto.randomUUID(),
					parentId: null,
					name: 'Impact Sound',
					position: pos,
					rotation: [0, 0, 0, 1],
					scale: [1, 1, 1],
					components: [
						{
							type: 'impactSound',
							frequency: opts.frequency,
							pitchDrop: opts.pitchDrop,
							noiseMix: opts.noiseMix,
							durationMs,
							volume: opts.volume
						},
						{ type: 'expires', expiresAt: Date.now() + durationMs + 500 }
					]
				}, { ephemeral: true });
			},
			/**
			 * Decodes an audio source (`{ kind: 'url', url }`, an asset ref, or an `audioPlayer`'s `source`) and resolves with
			 * `{ duration, bpm, bpmConfidence, onsets: [{ t, strength, band: 'low' | 'mid' | 'high' }], energy: { hop, low, mid, high } }`.
			 * Onset times are in seconds; band energy sample `i` is at `i * hop`. Cached per source. Async: a long track takes a moment.
			 */
			analyze: (source: unknown) => requireAudio(host).analyze(source),
			/**
			 * Starts playing an audio source now, not positioned in the world, and resolves with a handle:
			 * `{ time(), duration, playing, ended, pause(), resume(), stop(), setVolume(v) }`. `time()` is the track's position in
			 * seconds on the audio clock, the one to sync gameplay or visuals to. Options: `volume` (0-1), `loop`, `offset` (seconds).
			 * Runs on the peer that calls it, so gate it behind `world.isHost()` when only one player should hear it.
			 */
			playTrack: async (source: unknown, options?: { volume?: number; loop?: boolean; offset?: number; rate?: number }) => {
				const handle = await requireAudio(host).playTrack(source, options);
				// The track belongs to this code block: when the block is removed (a world is left) it stops, even if it only
				// finished loading after that. A script that outlives its slot would otherwise keep a song playing in another world.
				if (scope.disposed) handle.stop();
				else scope.tracks.add(handle);
				return handle;
			},
			/**
			 * Plays an audio source from a point in the world, heard from where it is (louder the nearer the listener): the handle is
			 * `playTrack`'s with `setPosition([x, y, z])`. Options: `volume`, `loop`, `offset`, `rate` (pitch), `refDistance` (1 m: as loud
			 * as it gets up to there), `maxDistance` (60 m) and `rolloff` (1). Runs on the peer that calls it: every peer that should hear it calls it.
			 */
			playAt: async (source: unknown, position: Vec3, options?: { volume?: number; loop?: boolean; offset?: number; rate?: number; refDistance?: number; maxDistance?: number; rolloff?: number }) => {
				const handle = await requireAudio(host).playAt(source, position, options);
				if (scope.disposed) handle.stop();
				else scope.tracks.add(handle);
				return handle;
			}
		},
		time: {
			/** The time the last `tick` was given, in seconds: the frame's time times the scale. */
			delta: () => scope.time?.delta ?? 0,
			/** The real time of the last frame, whatever the scale. */
			unscaledDelta: () => scope.time?.rawDelta ?? 0,
			/** Seconds this script has run for, at the scale it ran at. */
			now: () => scope.time?.elapsed ?? 0,
			/** How fast this script's time runs: 1 normally, 0.25 in slow motion, 0 stops it. `tick` gets the scaled time from the next frame on. */
			setScale: (scale: number) => {
				if (scope.time && typeof scale === 'number' && Number.isFinite(scale)) scope.time.scale = Math.min(10, Math.max(0, scale));
			},
			getScale: () => scope.time?.scale ?? 1,
			/**
			 * How many steps of `step` seconds are due now: run your simulation that many times per `tick` (`for (let i = ctx.time.fixed(0.02); i > 0; i--) simulate(0.02)`)
			 * and it behaves the same at any frame rate. At most `maxSteps` (8) in one frame; the rest of a long frame is dropped, not caught up.
			 */
			fixed: (step: number, maxSteps = 8): number => {
				const clock = scope.time;
				if (!clock || typeof step !== 'number' || !(step > 1e-4)) return 0;
				const due = Math.floor(clock.accumulator / step + 1e-9);
				const n = Math.min(due, Math.max(1, Math.min(60, Math.floor(maxSteps) || 8)));
				clock.accumulator = n < due ? 0 : clock.accumulator - n * step;
				return n;
			}
		},
		net: {
			/** GET JSON from an external HTTPS endpoint. Gate shared work behind world.isHost(). */
			fetchJson: (url: string) => requestScriptJson(url, 'GET', undefined, { sameOriginPaths }),
			/** POST a JSON body and read the JSON response. */
			postJson: (url: string, body: unknown) => requestScriptJson(url, 'POST', body, { sameOriginPaths })
		},
		storage: {
			/** False when nothing can be saved (a published world played without an account): reads return your default, writes do nothing. */
			get available(): boolean {
				return host.storage?.available ?? false;
			},
			/** Data of one player (from `onPlayerReady`, `world.getPlayer` or an event), saved per account and per published world. Async; use stable ids such as "generator-2", never node ids. */
			player: (player: { id: string } | string) => requireStorage(host).player(player),
			/** Data shared by every session of this published world. */
			get world() {
				return requireStorage(host).world;
			},
			/**
			 * Objects (a slot and everything under it) this world keeps for the person hosting it, per published world: a record put on a shelf,
			 * something built. Whoever plays in the session saves into the host's, because it is the host's session. Where they are kept (this
			 * device or the cloud) is the host's choice. Bring one back with `world.addLoader` or `world.loadItem` and `{ adapter: 'worldStorage', key }`.
			 * Host/solo only; in a draft or without a published world nothing is kept (`available` is false).
			 */
			items: {
				get available(): boolean {
					return host.worldItems?.available ?? false;
				},
				/** Saves the object at `slotId` under `key` (up to 64 letters, digits and `_ . : -`). Resolves whether it was saved. */
				save: async (key: string, slotId: string, options?: { name?: string }): Promise<boolean> => host.worldItems?.save(key, slotId, options) ?? false,
				/** What is saved, as `[{ key, name }]`. */
				list: async () => host.worldItems?.list() ?? [],
				has: async (key: string): Promise<boolean> => host.worldItems?.has(key) ?? false,
				remove: async (key: string): Promise<boolean> => host.worldItems?.remove(key) ?? false
			}
		},
		leaderboards: {
			get available(): boolean {
				return host.storage?.available ?? false;
			},
			/** Keeps the player's best: the first submit to a name creates the board (`order: 'high'` for points, `'low'` for times). */
			submit: (name: string, player: { id: string } | string, score: number, options?: { order?: 'high' | 'low' }) => requireStorage(host).boards.submit(name, player, score, options),
			best: (name: string, player: { id: string } | string) => requireStorage(host).boards.best(name, player),
			/** Rows `{ rank, displayName, score, isMe }`, best first. */
			top: (name: string, options?: { limit?: number }) => requireStorage(host).boards.top(name, options),
			/** Fills the `rows` of a `scoreboard` slot with a board's top entries (one score column, so give it `columns: ['Score']`). Host/solo only, like `world.setComponentField`. Returns the rows. */
			showOn: async (scoreboardSlotId: string, name: string, options?: { limit?: number }) => {
				const rows = await requireStorage(host).boards.top(name, options);
				host.setComponentField(
					scoreboardSlotId,
					'scoreboard',
					'rows',
					rows.map((row) => ({ name: `${row.rank}. ${row.displayName}`, cells: [String(row.score)], isLeader: row.rank === 1, highlight: row.isMe }))
				);
				return rows;
			}
		},
		pay: {
			/** Whether credits can be spent here: a published world, played by someone signed in. */
			get available(): boolean {
				return Boolean(host.payments) && host.isHost();
			},
			/**
			 * Asks a player (`options.player`: an id or `{ id }` from an event; the local player when left out) to pay for the product
			 * `options.sku` of this world's `shop` component. The price is the one published with the world; the player sees it in a
			 * window of the game that no script controls and decides there. Resolves `{ ok: true }` once it is paid, or
			 * `{ ok: false, reason }` with `declined`, `insufficient`, `owned`, `limit`, `busy` or `unavailable`. Host/solo only.
			 */
			request: async (options: { sku: string; player?: unknown }): Promise<PayResult> => {
				if (!host.payments || !host.isHost() || typeof options?.sku !== 'string') return { ok: false, reason: 'unavailable' };
				return host.payments.request(playerIdOf(options.player), options.sku);
			},
			/** Whether a player owns a product they paid for (the local player when `player` is left out). */
			owns: async (sku: string, player?: unknown): Promise<boolean> => {
				if (!host.payments || !host.isHost() || typeof sku !== 'string') return false;
				return host.payments.owns(playerIdOf(player), sku);
			}
		},
		assets: {
			/** Imports a model of an external library (`'polyhaven:chair_01'`) as a reusable local object and returns its content-addressed asset id. */
			importFromLibrary: (ref: string, name: string) => host.importLibraryAsset(ref, name),
			/** The older name of `importFromLibrary` for Poly Haven models; kept so existing worlds keep working. */
			importPolyHavenModel: (id: string, name: string) => host.importLibraryAsset(`polyhaven:${id}`, name)
		},
		dash: {
			/** True where this script runs in the player's own menu, the only place it can change the menu. */
			get available(): boolean {
				return Boolean(host.dash);
			},
			/**
			 * Adds a tab to the menu, with a page made of UI nodes: `{ id, label, icon?, order?, ui: [panelSlot, ...elementSlots] }`, slots
			 * as in a world (the panel has a `uiPanel`, the rest `uiElement`s tied with `parentId`). Returns `{ slots }`, the ids the slots
			 * really got by the ids you gave them (to change them later with `world.setComponentField`); null when refused. Adding again with
			 * the same id replaces the tab. Only works for scripts of the player's own menu.
			 */
			addTab: (tab: unknown) => {
				const spec = tabSpecOf(tab);
				return spec ? (host.dash?.addTab(slotId, spec) ?? null) : null;
			},
			/** A name for this piece of UI that stays the same every time it starts: use it to key what a tab keeps (the id of a `grid`). Null outside the player's menu. */
			instanceId: (): string | null => host.dash?.instanceId(slotId) ?? null,
			removeTab: (id: string) => typeof id === 'string' && (host.dash?.removeTab(slotId, id) ?? false),
			showTab: (id: string) => typeof id === 'string' && (host.dash?.showTab(slotId, id) ?? false),
			/** Reads or changes a setting of the game a script may touch: `masterVolume` (0 to 1). */
			settings: {
				get: (key: string): number | null => (typeof key === 'string' ? (host.dash?.getSetting(key) ?? null) : null),
				set: (key: string, value: number): boolean => typeof key === 'string' && Number.isFinite(value) && (host.dash?.setSetting(key, value) ?? false)
			}
		},
		system: {
			/** Frame rate and what a frame costs: `{ fps, frameMs, drawCalls, meshes, kilotriangles }`. Null outside the player's menu. */
			stats: () => host.system?.stats() ?? null,
			/** `{ role: 'solo' | 'host' | 'guest', roomCode, worldName }`. Null outside the player's menu. */
			session: () => host.system?.session() ?? null
		},
		ui: {
			/** Playback state of a `video` uiElement on this peer (position, duration, paused, ended...). Write `playing`/`src`/`currentTime` with `world.setComponentField` to control it. */
			getMedia: (slotId: string) => host.getUIMedia(slotId),
			/** What the user has typed in an `input` uiElement. */
			getInputText: (slotId: string) => host.getUIInputText(slotId),
			/**
			 * Opens the game's menu on this device at a tab (`'session'`, `'home'`, `'worlds'`, `'inventory'`, `'settings'`, `'account'`). With
			 * `{ invite: true }` the Session tab shows the choices of who can join: choosing one hosts the session, and the room code is there.
			 * It opens on the device that runs the code: a press on a button reaches the host's, so the host's player is the one who sees it.
			 */
			openDash: (tab: string, options?: { invite?: boolean }) => {
				if (typeof tab === 'string') host.openDash?.(tab, options?.invite === true ? { invite: true } : undefined);
			}
		},
		math,
		log: (...args: unknown[]) => {
			const message = formatLogArgs(args);
			console.log(`[codeBlock:${slotId}]`, ...args);
			pushLog('log', 'log', message);
		}
	};
}

/** A field of a slot's component of `type`, or undefined. */
function fieldOf(slot: Slot | undefined, type: string, field: string): unknown {
	const component = slot?.components.find((c) => c.type === type) as Record<string, unknown> | undefined;
	return component ? component[field] : undefined;
}

/** A tab as a script wrote it, if it is one worth passing on: text where text is wanted, and a page of a sensible size. */
function tabSpecOf(value: unknown): ScriptDashTab | null {
	const tab = value as Partial<ScriptDashTab> | null;
	if (!tab || typeof tab.id !== 'string' || !tab.id || tab.id.length > 64 || typeof tab.label !== 'string' || !tab.label) return null;
	if (!Array.isArray(tab.ui) || tab.ui.length === 0 || tab.ui.length > 300) return null;
	return {
		id: tab.id,
		label: tab.label.slice(0, 24),
		...(typeof tab.icon === 'string' ? { icon: tab.icon.slice(0, 32) } : {}),
		...(typeof tab.order === 'number' && Number.isFinite(tab.order) ? { order: tab.order } : {}),
		ui: JSON.parse(JSON.stringify(tab.ui)) as ScriptDashTab['ui']
	};
}

export type CodeBlockCtx = ReturnType<typeof buildCtx>;

/** The host half of `ctx`, before it is handed to the sandbox. Exported so tests can exercise what each call does on the host. */
export { buildCtx as buildCodeBlockCtx };

/**
 * How the results of ctx functions reach a script. The objects of the world (slots, their components) are handed over as live
 * handles — a script still sees and edits the real thing, as it always has — and so are the storage and track handles with
 * methods. Everything else is copied into the sandbox as plain data.
 */
const RETURN_MODES: Record<string, ReturnMode> = {
	'self.getSlot': 'live',
	'self.getComponent': 'live',
	'hierarchy.getSlot': 'live',
	'hierarchy.getParent': 'live',
	'hierarchy.findByName': 'live',
	'hierarchy.getChildren': 'list',
	'world.findNear': 'list',
	'storage.player': 'live',
	'storage.world': 'live',
	'audio.playTrack': 'live',
	'audio.playAt': 'live'
};

const isThenable = (value: unknown): value is PromiseLike<unknown> => !!value && typeof (value as { then?: unknown }).then === 'function';
const describeError = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Runs `code` (the body of a function receiving `ctx` and returning handlers) once, inside a QuickJS sandbox (see
 * sandbox/codeBlockVm.ts): the script gets `ctx` and the standard language, and nothing of the page. Every entry point into
 * script-authored code is try/caught: a broken script must never abort SceneGraph.load()'s loop or stall other
 * onBeforeRenderObservable listeners for every peer, and one that spins or allocates without end is cut off by the VM's limits.
 */
export function createCodeBlockHandlers(slotId: string, node: TransformNode, code: string, host: CodeBlockHost): CodeBlockRuntime {
	const debugLog: CodeBlockLogEntry[] = [];
	const pushLog = (level: 'log' | 'error', hook: string, message: string) => {
		debugLog.push({ level, hook, message, timestamp: Date.now() });
		if (debugLog.length > MAX_LOG_ENTRIES) debugLog.shift();
	};
	const getDebugLog = () => debugLog.slice();
	const fail = (hook: string, err: unknown, what: string) => {
		console.error(`[codeBlock:${slotId}] ${what}`, err);
		pushLog('error', hook, describeError(err));
	};

	const scope: ScriptScope = { disposed: false, tracks: new Set(), time: newClock() };
	let vm: CodeBlockVm | undefined;
	const dispose = () => {
		scope.disposed = true;
		for (const track of scope.tracks) track.stop();
		scope.tracks.clear();
		vm?.dispose();
	};

	// Scripts never run outside the sandbox: if it is not loaded yet, the block stays inert instead of falling back to the page.
	if (!isCodeBlockSandboxReady()) {
		fail('compile', new Error('The code block sandbox is not loaded'), 'sandbox not ready');
		return { getDebugLog, dispose };
	}

	let handlerNames: string[];
	try {
		const ctx = buildCtx(slotId, node, host, pushLog, scope, host.sameOriginPathsFor?.(code) ?? []);
		vm = new CodeBlockVm({
			api: ctx as unknown as Record<string, unknown>,
			returnModes: RETURN_MODES,
			onConsole: (level, text) => console[level](`[codeBlock:${slotId}]`, text),
			onError: (where, err) => fail(where, err, `${where} failed`)
		});
		handlerNames = vm.load(code);
	} catch (err) {
		fail('compile', err, 'failed to compile/run');
		dispose();
		return { getDebugLog, dispose };
	}
	const sandbox = vm;

	const run = (key: string, args: unknown[]): unknown => {
		if (scope.disposed || !handlerNames.includes(key)) return undefined;
		try {
			const result = sandbox.invoke(key, args);
			// An async handler's failure arrives later as a rejected promise: it goes to the log like a thrown one.
			if (isThenable(result)) result.then(undefined, (err: unknown) => fail(key, err, `${key} rejected`));
			return result;
		} catch (err) {
			fail(key, err, `${key} threw`);
		}
	};
	const safe = <K extends keyof CodeBlockHandlers>(key: K): CodeBlockHandlers[K] => {
		if (!handlerNames.includes(key)) return undefined;
		return ((...args: unknown[]) => run(key, args)) as CodeBlockHandlers[K];
	};

	run('onSpawn', []);

	return {
		onPlayerReady: safe('onPlayerReady'),
		onPlayerLeft: safe('onPlayerLeft'),
		onInstance: safe('onInstance'),
		onGrab: safe('onGrab'),
		onRelease: safe('onRelease'),
		onPress: safe('onPress'),
		onUIEvent: safe('onUIEvent'),
		onEquip: safe('onEquip'),
		onUnequip: safe('onUnequip'),
		onTrigger: safe('onTrigger'),
		tick: handlerNames.includes('tick')
			? (dt: number) => {
					const clock = scope.time!;
					clock.rawDelta = dt;
					clock.delta = dt * clock.scale;
					clock.elapsed += clock.delta;
					clock.accumulator += clock.delta;
					run('tick', [clock.delta]);
				}
			: undefined,
		getRadialItems: () => {
			if (!handlerNames.includes('getRadialItems')) return [];
			const items = run('getRadialItems', []);
			if (!Array.isArray(items)) return [];
			const guard = <T>(key: string, fn: () => T, fallback: T): T => {
				try {
					return fn();
				} catch (err) {
					fail(key, err, `${key} threw`);
					return fallback;
				}
			};
			return (items as RadialItemDef[]).map((item) => ({
				label: String(item.label),
				isEnabled: () => guard('getRadialItems.isEnabled', () => Boolean(item.isEnabled?.()), false),
				onSelect: () => {
					const result = guard('getRadialItems.onSelect', () => item.onSelect?.(), undefined);
					if (isThenable(result)) result.then(undefined, (err: unknown) => fail('getRadialItems.onSelect', err, 'onSelect rejected'));
				}
			}));
		},
		getDebugLog,
		dispose
	};
}
