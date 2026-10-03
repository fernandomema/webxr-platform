import type { WorldStorageService } from './worldStorageService';
import { requestScriptJson } from './scriptNet';
import { Vector3, Quaternion, type TransformNode } from '@babylonjs/core';
import type { Slot, UIEvent, Vec3, Quat } from '$lib/ecs/types';
import type { UIMediaState } from './uiPanelSurface';

/** What SceneGraph exposes to a codeBlock's compiled handlers — narrow, read-mostly, no Babylon types leak into `ctx`. */
export interface CodeBlockHost {
	getSlot(slotId: string): Slot | undefined;
	getNode(slotId: string): TransformNode | undefined;
	getChildren(parentId: string | null): Slot[];
	allSlots(): Slot[];
	getGrabbers(slotId: string): string[];
	isHost(): boolean;
	requestSpawn(slot: Slot): void;
	requestDelete(slotId: string): void;
	/** Host/solo only — a guest's call is a documented no-op, corrected by the next broadcast anyway. */
	setComponentField(slotId: string, componentType: string, field: string, value: unknown, broadcast?: boolean): void;
	/** Records a slot's node transform (moved by a script) as its data and, when `broadcast`, sends it to guests. Host/solo only. */
	commitTransform(slotId: string, broadcast?: boolean): void;
	/** Every non-system Slot whose world position is within `radius` of `worldPos` — a generic spatial query for proximity/collision-style logic (hit detection, triggers, area effects), not tied to any one demo. O(live slot count) per call. */
	findNear(worldPos: Vec3, radius: number): Slot[];
	/** Casts a ray through the live scene — generic aiming/hit-testing for any tool (a laser, a thrown object, a spray), not tied to any one demo. `null` when nothing pickable is hit within `maxDistance`. */
	raycast(origin: Vec3, direction: Vec3, maxDistance: number): RaycastHit | null;
	/** Resolves a grabberId (from `getGrabbers`/`ctx.grab.heldBy()`) to a stable player id + display name — generic attribution for scripts that need to know "who did this" (scoreboards, ownership tags, logs), not tied to any one demo. */
	resolvePlayer(grabberId: string): { id: string; name: string };
	/** Which player/hand has this slot — or one of its ancestors — equipped, if any. */
	getEquipHolder(slotId: string): { playerId: string; hand: 'left' | 'right' } | null;
	/** Playback state, on this peer, of the `video` uiElement `slotId`. */
	getUIMedia(slotId: string): UIMediaState | undefined;
	/** Current text, on this peer, of the `input` uiElement `slotId`. */
	getUIInputText(slotId: string): string | undefined;
	/** Switches a slot and everything below it on or off for every player. Host/solo only (`false` on a guest). */
	setSlotEnabled(slotId: string, enabled: boolean, broadcast?: boolean): boolean;
	/** Persistent storage and leaderboards. Absent where the engine provides none; scripts then see them as unavailable. */
	storage?: WorldStorageService;
	/** Imports a Poly Haven model into this device's asset store and local inventory. Host/solo only. */
	importPolyHavenModel(id: string, name: string): Promise<string>;
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
}

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

function buildCtx(slotId: string, node: TransformNode, host: CodeBlockHost, pushLog: (level: 'log' | 'error', hook: string, message: string) => void) {
	return {
		self: {
			id: slotId,
			getSlot: () => host.getSlot(slotId),
			getComponent: (type: string) => host.getSlot(slotId)?.components.find((c) => c.type === type),
			getWorldPosition: () => getWorldPosition(node),
			getWorldRotation: () => getWorldRotation(node),
			setWorldPosition: (v: Vec3) => setWorldPosition(node, v),
			setWorldRotation: (q: Quat) => setWorldRotation(node, q)
		},
		hierarchy: {
			getSlot: (id: string) => host.getSlot(id),
			getChildren: (id: string | null) => host.getChildren(id),
			getParent: (id: string) => {
				const parentId = host.getSlot(id)?.parentId;
				return parentId ? host.getSlot(parentId) : undefined;
			},
			findByName: (name: string) => host.allSlots().find((s) => s.name === name),
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
			heldBy: () => host.getGrabbers(slotId)
		},
		world: {
			isHost: () => host.isHost(),
			spawn: (partial: Partial<Slot> & { name: string }) => {
				const spawned: Slot = {
					id: crypto.randomUUID(),
					parentId: null,
					position: [0, 0, 0],
					rotation: [0, 0, 0, 1],
					scale: [1, 1, 1],
					components: [],
					...partial
				};
				host.requestSpawn(spawned);
			},
			/** Switches a slot (and everything below it) on or off for all players: hidden, not pickable, not grabbable. Host/solo only; returns whether it changed. Its code blocks keep running. */
			setSlotEnabled: (targetId: string, enabled: boolean, broadcast = true): boolean => host.setSlotEnabled(targetId, enabled, broadcast),
			deleteSelf: () => host.requestDelete(slotId),
			deleteSlot: (id: string) => host.requestDelete(id),
			/** `broadcast: false` updates this peer only (no snapshot to guests) — for per-frame updates, followed by a broadcasting call once in a while. */
			setComponentField: (targetId: string, componentType: string, field: string, value: unknown, broadcast = true) =>
				host.setComponentField(targetId, componentType, field, value, broadcast),
			/**
			 * Puts ANOTHER slot at a world position and/or rotation, keeping its scale — for tools that straighten, snap or
			 * place objects. Host/solo only, like `setComponentField`. Refused (returns false) while a hand holds the slot
			 * or it is equipped, so it never fights a player. `broadcast: false` moves it on this peer only.
			 */
			setWorldPose: (targetId: string, pose: { position?: Vec3; rotation?: Quat }, broadcast = true): boolean => {
				if (!host.isHost()) return false;
				const target = host.getNode(targetId);
				if (!target || host.getGrabbers(targetId).length > 0 || host.getEquipHolder(targetId)) return false;
				if (pose.position) setWorldPosition(target, pose.position);
				if (pose.rotation) setWorldRotation(target, pose.rotation);
				host.commitTransform(targetId, broadcast);
				return true;
			},
			findNear: (worldPos: Vec3, radius: number) => host.findNear(worldPos, radius),
			raycast: (origin: Vec3, direction: Vec3, maxDistance: number) => host.raycast(origin, direction, maxDistance),
			getPlayer: (grabberId: string) => host.resolvePlayer(grabberId)
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
				});
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
				});
			}
		},
		net: {
			/** GET JSON from a local route or an external HTTPS endpoint. Gate shared work behind world.isHost(). */
			fetchJson: (url: string) => requestScriptJson(url),
			/** POST a JSON body and read the JSON response. */
			postJson: (url: string, body: unknown) => requestScriptJson(url, 'POST', body)
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
		assets: {
			/** Imports a Poly Haven model as a reusable local object and returns its content-addressed asset id. */
			importPolyHavenModel: (id: string, name: string) => host.importPolyHavenModel(id, name)
		},
		ui: {
			/** Playback state of a `video` uiElement on this peer (position, duration, paused, ended...). Write `playing`/`src`/`currentTime` with `world.setComponentField` to control it. */
			getMedia: (slotId: string) => host.getUIMedia(slotId),
			/** What the user has typed in an `input` uiElement. */
			getInputText: (slotId: string) => host.getUIInputText(slotId)
		},
		math,
		log: (...args: unknown[]) => {
			const message = formatLogArgs(args);
			console.log(`[codeBlock:${slotId}]`, ...args);
			pushLog('log', 'log', message);
		}
	};
}

export type CodeBlockCtx = ReturnType<typeof buildCtx>;

/**
 * Compiles `code` (the body of a function receiving `ctx` and returning
 * handlers) and runs it once. Every entry point into script-authored code is
 * try/caught: a broken script must never abort SceneGraph.load()'s loop or
 * stall other onBeforeRenderObservable listeners for every peer.
 */
export function createCodeBlockHandlers(slotId: string, node: TransformNode, code: string, host: CodeBlockHost): CodeBlockRuntime {
	const debugLog: CodeBlockLogEntry[] = [];
	const pushLog = (level: 'log' | 'error', hook: string, message: string) => {
		debugLog.push({ level, hook, message, timestamp: Date.now() });
		if (debugLog.length > MAX_LOG_ENTRIES) debugLog.shift();
	};
	const getDebugLog = () => debugLog.slice();

	const ctx = buildCtx(slotId, node, host, pushLog);
	let handlers: CodeBlockHandlers = {};
	try {
		// eslint-disable-next-line no-new-func -- intentional: bounded API, no real sandbox (see plan/ecs/types.ts docs)
		const factory = new Function('ctx', code) as (ctx: CodeBlockCtx) => CodeBlockHandlers | undefined;
		handlers = factory(ctx) ?? {};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[codeBlock:${slotId}] failed to compile/run`, err);
		pushLog('error', 'compile', message);
		return { getDebugLog };
	}

	const safe = <K extends keyof CodeBlockHandlers>(key: K): CodeBlockHandlers[K] => {
		const fn = handlers[key];
		if (!fn) return undefined;
		return ((...args: unknown[]) => {
			try {
				// @ts-expect-error -- generic passthrough wrapper over heterogeneous handler signatures
				const result = fn(...args);
				// An async handler's failure arrives later as a rejected promise: it goes to the log like a thrown one.
				if (result && typeof (result as Promise<unknown>).then === 'function') {
					(result as Promise<unknown>).then(undefined, (err: unknown) => {
						const message = err instanceof Error ? err.message : String(err);
						console.error(`[codeBlock:${slotId}] ${key} rejected`, err);
						pushLog('error', key, message);
					});
				}
				return result;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(`[codeBlock:${slotId}] ${key} threw`, err);
				pushLog('error', key, message);
			}
		}) as CodeBlockHandlers[K];
	};

	try {
		const spawned = handlers.onSpawn?.() as unknown;
		if (spawned && typeof (spawned as Promise<unknown>).then === 'function') {
			(spawned as Promise<unknown>).then(undefined, (err: unknown) => {
				console.error(`[codeBlock:${slotId}] onSpawn rejected`, err);
				pushLog('error', 'onSpawn', err instanceof Error ? err.message : String(err));
			});
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[codeBlock:${slotId}] onSpawn threw`, err);
		pushLog('error', 'onSpawn', message);
	}

	return {
		onPlayerReady: safe('onPlayerReady'),
		onGrab: safe('onGrab'),
		onRelease: safe('onRelease'),
		onPress: safe('onPress'),
		onUIEvent: safe('onUIEvent'),
		onEquip: safe('onEquip'),
		onUnequip: safe('onUnequip'),
		onTrigger: safe('onTrigger'),
		tick: safe('tick'),
		getRadialItems: () => {
			try {
				return handlers.getRadialItems?.() ?? [];
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(`[codeBlock:${slotId}] getRadialItems threw`, err);
				pushLog('error', 'getRadialItems', message);
				return [];
			}
		},
		getDebugLog
	};
}
