import { Vector3, Quaternion, type TransformNode } from '@babylonjs/core';
import type { Slot, Vec3, Quat } from '$lib/ecs/types';

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
	setComponentField(slotId: string, componentType: string, field: string, value: unknown): void;
	/** Every non-system Slot whose world position is within `radius` of `worldPos` — a generic spatial query for proximity/collision-style logic (hit detection, triggers, area effects), not tied to any one demo. O(live slot count) per call. */
	findNear(worldPos: Vec3, radius: number): Slot[];
	/** Resolves a grabberId (from `getGrabbers`/`ctx.grab.heldBy()`) to a stable player id + display name — generic attribution for scripts that need to know "who did this" (scoreboards, ownership tags, logs), not tied to any one demo. */
	resolvePlayer(grabberId: string): { id: string; name: string };
}

export interface RadialItemDef {
	label: string;
	isEnabled(): boolean;
	onSelect(): void | Promise<void>;
}

export interface CodeBlockHandlers {
	onSpawn?(): void;
	onGrab?(): void;
	onRelease?(): void;
	/** Fired by PressableButtonSystem once a `pressableButton` component's depression crosses its threshold — see interaction/pressableButtonSystem.ts. Unrelated to grabbing. */
	onPress?(): void;
	tick?(dt: number): void;
	getRadialItems?(): RadialItemDef[];
}

export interface CodeBlockLogEntry {
	level: 'log' | 'error';
	hook: string;
	message: string;
	timestamp: number;
}

/** What `createCodeBlockHandlers` actually returns — the script-authored handlers plus a runtime-owned debug feed the Inspector can read (see inspector/codeBlockDebug.ts). Not part of `CodeBlockHandlers` because scripts never provide `getDebugLog` themselves. */
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
	}
};

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
			findByName: (name: string) => host.allSlots().find((s) => s.name === name)
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
			deleteSelf: () => host.requestDelete(slotId),
			deleteSlot: (id: string) => host.requestDelete(id),
			setComponentField: (targetId: string, componentType: string, field: string, value: unknown) =>
				host.setComponentField(targetId, componentType, field, value),
			findNear: (worldPos: Vec3, radius: number) => host.findNear(worldPos, radius),
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
				return fn(...args);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(`[codeBlock:${slotId}] ${key} threw`, err);
				pushLog('error', key, message);
			}
		}) as CodeBlockHandlers[K];
	};

	try {
		handlers.onSpawn?.();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[codeBlock:${slotId}] onSpawn threw`, err);
		pushLog('error', 'onSpawn', message);
	}

	return {
		onGrab: safe('onGrab'),
		onRelease: safe('onRelease'),
		onPress: safe('onPress'),
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
