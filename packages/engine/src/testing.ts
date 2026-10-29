import { NullEngine, Quaternion, Scene, TransformNode, Vector3 } from '@babylonjs/core';
import type { Component, Quat, Slot, SlotTree, UIEvent, Vec3 } from './ecs/types.ts';
import { instantiateFragment, type FragmentData } from './assets/fragment.ts';
import type { AssetId } from './assets/ref.ts';
import { CollisionWorld } from './physics/world.ts';
import { box, cylinder, sphere, type Shape, type V3 } from './physics/shapes.ts';
import type { ScriptContext, ScriptHandlers } from './script.ts';
import { buildCodeBlockCtx, type CodeBlockHost, type RaycastHit, type TriggerEvent } from './xr/codeBlockRuntime.ts';
import type { AudioTrackHandle, PlayAtOptions, PlayTrackOptions, PositionedTrackHandle, ScriptAudio } from './xr/scriptAudio.ts';
import { createScriptPhysics } from './xr/scriptPhysics.ts';
import { rotateVector, type PlayerPoseView, type PoseView, type TeleportTarget } from './xr/playerPoses.ts';

/**
 * A stand-in for the engine to run a world's scripts against, in a test: no browser, no headset, no sandbox. It keeps the world's real
 * slots (so a script that touches one that does not exist fails), answers `ctx` the way the engine does (it is the engine's own `ctx`,
 * over a host made of plain data), and records what the scripts asked for. Time only moves when the test says so.
 *
 * ```ts
 * const world = createTestWorld(tree);
 * const player = world.addPlayer({ id: 'p1', head: [0, 1.6, 0] });
 * const run = world.run('director');
 * run.onPlayerReady?.({ id: 'p1', name: 'p1' });
 * world.tick(2);
 * expect(world.component('score', 'textDisplay').lines[0]).toBe('0');
 * ```
 */

const DT = 1 / 60;
const find = (slot: Slot, type: string) => slot.components.find((c) => c.type === type);

/** A person in the world: where the head is and which way it looks (radians; 0 looks along +Z). Hands default to a VR player's, none for a `desktop` one. */
export interface TestPlayer {
	id: string;
	name: string;
	role: 'host' | 'guest';
	head: Vec3;
	yaw: number;
	pitch: number;
	desktop: boolean;
	/** Where a hand is, when a test wants to put it somewhere; else it hangs a little below and beside the head. */
	hands: { left?: { position: Vec3; rotation: Quat }; right?: { position: Vec3; rotation: Quat } };
	velocity: Vec3;
}

export interface TestWorldOptions {
	/** Whether this peer is the host (true). A guest's world changes are refused, as in the engine. */
	isHost?: boolean;
	/** A script that touches a slot that is not there throws, as it should in a test (true); false only records it in `unknown`. */
	strict?: boolean;
	/** The id the local player has (`host`). */
	localPlayerId?: string;
	/** The box a model fills, by asset id, for colliders made of models (they are left out otherwise). */
	modelBox?: (assetId: string) => { min: Vec3; max: Vec3 } | null;
	/** The content of a scene fragment by asset id: a `fragment` slot that is on has it built under it, as the engine does. */
	fragments?: (assetId: AssetId) => FragmentData | undefined;
	/** Persistent storage used by `ctx.storage`, with the same service the live engine uses. */
	storage?: CodeBlockHost['storage'];
}

/** A script that was started in the test world. */
export interface ScriptRun {
	readonly ctx: ScriptContext;
	readonly handlers: ScriptHandlers;
	/** Runs the script's `tick` for `seconds` of game time in steps of `dt`. */
	tick(seconds: number, dt?: number): void;
}

const yawPitch = (yaw: number, pitch: number): Quat => {
	const a = [Math.sin(pitch / 2), 0, 0, Math.cos(pitch / 2)], b = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
	return [b[3] * a[0] + b[0] * a[3] + b[1] * a[2] - b[2] * a[1], b[3] * a[1] - b[0] * a[2] + b[1] * a[3] + b[2] * a[0], b[3] * a[2] + b[0] * a[1] - b[1] * a[0] + b[2] * a[3], b[3] * a[3] - b[0] * a[0] - b[1] * a[1] - b[2] * a[2]];
};

const view = (position: Vec3, rotation: Quat): PoseView => ({ position: [...position], rotation, forward: rotateVector(rotation, [0, 0, 1]), up: rotateVector(rotation, [0, 1, 0]), right: rotateVector(rotation, [1, 0, 0]) });

/** A sound the scripts played. */
export interface PlayedSound {
	source: unknown;
	options?: PlayTrackOptions | PlayAtOptions;
	position?: Vec3;
	handle: PositionedTrackHandle;
}

class TestAudio implements ScriptAudio {
	played: PlayedSound[] = [];
	listener: { position: Vec3; forward: Vec3; up: Vec3 } | null = null;
	analyze(): Promise<never> { return Promise.reject(new Error('Audio analysis is not available in a test world')); }
	private handle(options?: PlayTrackOptions): PositionedTrackHandle {
		let volume = options?.volume ?? 1;
		const handle = {
			time: () => 0, duration: 1, playing: true, ended: false, stopped: false,
			pause() { (handle as { playing: boolean }).playing = false; },
			resume() { (handle as { playing: boolean }).playing = true; },
			stop() { (handle as { playing: boolean }).playing = false; (handle as { ended: boolean }).ended = true; (handle as { stopped: boolean }).stopped = true; },
			setVolume(v: number) { volume = v; (handle as { volume?: number }).volume = v; },
			setPosition(p: [number, number, number]) { (handle as { position?: Vec3 }).position = p; },
			volume
		};
		return handle as unknown as PositionedTrackHandle;
	}
	playTrack(source: unknown, options?: PlayTrackOptions): Promise<AudioTrackHandle> {
		const handle = this.handle(options);
		this.played.push({ source, options, handle });
		return Promise.resolve(handle);
	}
	playAt(source: unknown, position: [number, number, number], options?: PlayAtOptions): Promise<PositionedTrackHandle> {
		const handle = this.handle(options);
		this.played.push({ source, options, position, handle });
		return Promise.resolve(handle);
	}
	setListener(position: [number, number, number], forward: [number, number, number], up: [number, number, number]): void { this.listener = { position, forward, up }; }
	dispose(): void {}
}

export class TestWorld {
	readonly slots = new Map<string, Slot>();
	readonly players = new Map<string, TestPlayer>();
	/** Slots the scripts spawned (`ephemeral` ones are listed but not kept in the world). */
	readonly spawned: Array<Slot & { ephemeral: boolean }> = [];
	readonly deleted: string[] = [];
	readonly teleports: Array<{ playerId: string; position: Vec3; yaw?: number }> = [];
	readonly equips: Array<{ playerId: string; slotId: string; hand: 'left' | 'right' }> = [];
	readonly unequips: Array<{ playerId: string; hand: 'left' | 'right' }> = [];
	/** `setPlayerVelocity` calls. */
	readonly velocities: Array<{ playerId: string; velocity: Vec3; add: boolean }> = [];
	readonly haptics: Array<{ playerId: string; hand: 'left' | 'right' | 'both'; intensity: number; durationMs: number }> = [];
	/** Component writes by scripts: what, where, and whether they were to be broadcast. */
	readonly writes: Array<{ slotId: string; component: string; field: string; value: unknown; broadcast: boolean }> = [];
	/** How many times a script flushed its quiet writes to the guests. */
	flushes = 0;
	readonly dashOpens: Array<{ tab: string; options?: { invite?: boolean } }> = [];
	/** What scripts touched that does not exist (only filled when `strict` is off). */
	readonly unknown: string[] = [];
	readonly log: string[] = [];
	readonly audio = new TestAudio();
	/** Who holds a slot in a hand, for `ctx.grab` (set by a test). */
	readonly grabbers = new Map<string, string[]>();
	/** What `getUIInputText` and `getUIMedia` answer (set by a test). */
	readonly inputText = new Map<string, string>();
	time = 0;
	readonly host: CodeBlockHost;

	private readonly engine = new NullEngine();
	private readonly scene = new Scene(this.engine);
	private readonly nodes = new Map<string, TransformNode>();
	private readonly equipped = new Map<string, { playerId: string; hand: 'left' | 'right' }>();
	private readonly scripts: Array<{ slotId: string; run: ScriptRun; tick?: (dt: number) => void }> = [];
	private collisions: CollisionWorld | null = null;
	private readonly strict: boolean;
	private readonly isHost: boolean;
	private readonly localPlayerId: string;
	private readonly modelBox: TestWorldOptions['modelBox'];
	private readonly fragments: TestWorldOptions['fragments'];
	private readonly storage: TestWorldOptions['storage'];
	/** The slots each built fragment holds, by the slot that loaded it. */
	private readonly built = new Map<string, string[]>();

	constructor(tree: SlotTree, options: TestWorldOptions = {}) {
		this.strict = options.strict ?? true;
		this.isHost = options.isHost ?? true;
		this.localPlayerId = options.localPlayerId ?? 'host';
		this.modelBox = options.modelBox;
		this.fragments = options.fragments;
		this.storage = options.storage;
		for (const slot of tree) this.add(structuredClone(slot));
		for (const slot of this.slots.values()) this.attach(slot);
		this.host = this.makeHost();
		this.syncFragments();
	}

	dispose(): void {
		for (const { run } of this.scripts) (run.handlers as { dispose?: () => void }).dispose?.();
		this.scene.dispose();
		this.engine.dispose();
	}

	// --- reading the world ---

	slot(id: string): Slot {
		const slot = this.slots.get(id);
		if (!slot) { this.unknown.push(id); throw new Error(`The script touched a slot that does not exist: ${id}`); }
		return slot;
	}

	/** The component of a type on a slot (throws when there is none). */
	component<T extends Component['type']>(slotId: string, type: T): Extract<Component, { type: T }> {
		const found = find(this.slot(slotId), type);
		if (!found) throw new Error(`${slotId} has no ${type}`);
		return found as Extract<Component, { type: T }>;
	}

	/** Where a slot is in the world. */
	position(slotId: string): Vec3 {
		const node = this.node(slotId);
		node.computeWorldMatrix(true);
		return node.absolutePosition.asArray() as Vec3;
	}

	node(slotId: string): TransformNode {
		const node = this.nodes.get(slotId);
		if (!node) { this.unknown.push(slotId); throw new Error(`The script touched a slot that does not exist: ${slotId}`); }
		return node;
	}

	/** Puts a slot somewhere in the world (a test moving something the engine would move: a gun in a hand). */
	setPosition(slotId: string, position: Vec3, rotation?: Quat): void {
		const node = this.node(slotId);
		const parent = node.parent as TransformNode | null;
		const local = parent ? Vector3.TransformCoordinates(Vector3.FromArray(position), (parent.computeWorldMatrix(true), parent.getWorldMatrix().clone().invert())) : Vector3.FromArray(position);
		node.position = local;
		if (rotation) node.rotationQuaternion = Quaternion.FromArray(rotation);
		this.commit(slotId);
		this.collisions = null;
	}

	// --- people ---

	addPlayer(player: Partial<TestPlayer> & { id: string }): TestPlayer {
		const made: TestPlayer = { name: player.id, role: this.players.size === 0 ? 'host' : 'guest', head: [0, 1.6, 0], yaw: 0, pitch: 0, desktop: false, hands: {}, velocity: [0, 0, 0], ...player };
		this.players.set(made.id, made);
		return made;
	}

	/** Turns a player's head to look at a point. */
	look(playerId: string, target: Vec3): void {
		const p = this.player(playerId);
		const d = [target[0] - p.head[0], target[1] - p.head[1], target[2] - p.head[2]];
		p.yaw = Math.atan2(d[0], d[2]);
		p.pitch = -Math.atan2(d[1], Math.hypot(d[0], d[2]));
	}

	player(id: string): TestPlayer {
		const p = this.players.get(id);
		if (!p) throw new Error(`There is no player ${id} in the test world`);
		return p;
	}

	poseOf(player: TestPlayer): PlayerPoseView {
		const rotation = yawPitch(player.yaw, player.pitch);
		const head = view(player.head, rotation);
		if (player.desktop) return { head };
		const hand = (side: 'left' | 'right', sign: number): PoseView => {
			const given = player.hands[side];
			return given ? view(given.position, given.rotation) : view([player.head[0] + head.right[0] * 0.25 * sign, player.head[1] - 0.35, player.head[2] + head.right[2] * 0.25 * sign], rotation);
		};
		return { head, left: hand('left', -1), right: hand('right', 1) };
	}

	// --- running scripts ---

	/**
	 * Starts the script of a slot (its `codeBlock`, or `code` instead) and runs `onSpawn`. `now` is what `Date.now()` answers while the
	 * script starts, so that a script that seeds itself from the clock starts the same every time.
	 */
	run(slotId: string, options: { code?: string; now?: number } = {}): ScriptRun {
		const slot = this.slot(slotId);
		const code = options.code ?? (find(slot, 'codeBlock') as { code?: string } | undefined)?.code;
		if (code === undefined) throw new Error(`${slotId} has no codeBlock`);
		const scope = { disposed: false, tracks: new Set<AudioTrackHandle>(), time: { scale: 1, delta: 0, rawDelta: 0, elapsed: 0, accumulator: 0 } };
		const ctx = buildCodeBlockCtx(slotId, this.node(slotId), this.host, (level: string, hook: string, message: string) => this.log.push(`${level} ${hook}: ${message}`), scope as never) as unknown as ScriptContext;
		const realNow = Date.now;
		if (options.now !== undefined) Date.now = () => options.now!;
		let handlers: ScriptHandlers;
		try { handlers = new Function('ctx', code)(ctx); } finally { Date.now = realNow; }
		handlers.onSpawn?.();
		const clock = scope.time;
		const rawTick = handlers.tick;
		// As in the engine, the `tick` the script is called through moves its clock first: `ctx.time` and the delta it is given follow the scale.
		if (rawTick) {
			handlers.tick = (dt: number) => {
				clock.rawDelta = dt; clock.delta = dt * clock.scale; clock.elapsed += clock.delta; clock.accumulator += clock.delta;
				this.time += dt;
				this.collisions = null;
				// A fragment whose file has arrived is built, as the engine does every frame.
				this.syncFragments();
				rawTick.call(handlers, clock.delta);
			};
		}
		const tickHandler = handlers.tick;
		const run: ScriptRun = {
			ctx,
			handlers,
			tick: (seconds, dt = DT) => {
				const steps = Math.max(1, Math.round(seconds / dt));
				for (let i = 0; i < steps; i++) tickHandler?.(dt);
			}
		};
		this.scripts.push({ slotId, run, tick: tickHandler ? (dt) => tickHandler(dt) : undefined });
		return run;
	}

	/** Gives every started script `seconds` of game time. */
	tick(seconds: number, dt = DT): void {
		const steps = Math.max(1, Math.round(seconds / dt));
		for (let i = 0; i < steps; i++) for (const script of this.scripts) script.tick?.(dt);
	}

	/** Presses a UI element for a script's `onUIEvent`. */
	press(run: ScriptRun, slotId: string, extra: Partial<UIEvent> = {}): void {
		(run.handlers.onUIEvent as ((event: UIEvent) => void) | undefined)?.({ type: 'press', slotId, ...extra } as UIEvent);
	}

	/** The trigger of a hand holding the script's object. */
	trigger(run: ScriptRun, event: Partial<TriggerEvent> & { playerId: string }): boolean | void {
		return run.handlers.onTrigger?.({ hand: 'right', playerName: this.players.get(event.playerId)?.name ?? event.playerId, phase: 'press', value: 1, ...event });
	}

	/** The script that was started for a slot (`run` returns it too). */
	scriptOf(slotId: string): ScriptRun | undefined {
		return this.scripts.find((s) => s.slotId === slotId)?.run;
	}

	// --- the stand-in host ---

	/** Builds the content of every fragment slot that is on and takes down that of those that are off or gone, as the engine does. */
	private syncFragments(): void {
		if (!this.fragments) return;
		for (const [ownerId, ids] of [...this.built]) {
			const owner = this.slots.get(ownerId);
			if (owner && this.nodes.get(ownerId)!.isEnabled(false)) continue;
			for (const id of ids) { this.nodes.get(id)?.dispose(); this.nodes.delete(id); this.slots.delete(id); }
			this.built.delete(ownerId);
			this.collisions = null;
		}
		for (const slot of [...this.slots.values()]) {
			const component = find(slot, 'fragment') as { source?: { kind?: string; assetId?: AssetId } } | undefined;
			if (!component || this.built.has(slot.id) || component.source?.kind !== 'asset' || !component.source.assetId || !this.nodes.get(slot.id)?.isEnabled(false)) continue;
			const data = this.fragments(component.source.assetId);
			if (!data) continue;
			const content = instantiateFragment(slot.id, data).map((s) => structuredClone(s));
			for (const s of content) this.add(s);
			for (const s of content) this.attach(s);
			this.built.set(slot.id, content.map((s) => s.id));
		}
	}

	private add(slot: Slot): void {
		this.slots.set(slot.id, slot);
		const node = new TransformNode(slot.id, this.scene);
		node.position = Vector3.FromArray(slot.position);
		node.rotationQuaternion = Quaternion.FromArray(slot.rotation);
		node.scaling = Vector3.FromArray(slot.scale);
		if (slot.disabled) node.setEnabled(false);
		this.nodes.set(slot.id, node);
		this.collisions = null;
	}

	private attach(slot: Slot): void {
		const parent = slot.parentId ? this.nodes.get(slot.parentId) : undefined;
		if (parent) this.nodes.get(slot.id)!.parent = parent;
	}

	private commit(slotId: string): void {
		const slot = this.slots.get(slotId), node = this.nodes.get(slotId);
		if (!slot || !node) return;
		slot.position = node.position.asArray() as Vec3;
		slot.rotation = (node.rotationQuaternion ?? Quaternion.Identity()).asArray() as Quat;
		slot.scale = node.scaling.asArray() as Vec3;
	}

	/** Tells the scripts of a slot and of what is under it that a hand took it or let it go, as the engine does. */
	private hand(handler: 'onEquip' | 'onUnequip', slotId: string, playerId: string, hand: 'left' | 'right'): void {
		const under = new Set(this.descendants(slotId));
		for (const script of this.scripts) {
			if (!under.has(script.slotId)) continue;
			(script.run.handlers[handler] as ((event: { hand: 'left' | 'right'; playerId: string; playerName: string }) => void) | undefined)?.({ hand, playerId, playerName: this.players.get(playerId)?.name ?? playerId });
		}
	}

	/** Puts an equippable slot in a hand of a player, as the radial menu does (their scripts hear `onEquip`). */
	equip(playerId: string, slotId: string, hand: 'left' | 'right'): boolean {
		return this.host.equipPlayer(playerId, slotId, hand);
	}

	private isFragmentSlot(id: string): boolean {
		for (const ids of this.built.values()) if (ids.includes(id)) return true;
		return false;
	}

	private descendants(id: string): string[] {
		const out: string[] = [id];
		for (const slot of this.slots.values()) if (slot.parentId === id) out.push(...this.descendants(slot.id));
		return out;
	}

	private holder(slotId: string): { playerId: string; hand: 'left' | 'right' } | null {
		for (let id: string | null = slotId, guard = 0; id && guard < 64; id = this.slots.get(id)?.parentId ?? null, guard++) {
			const held = this.equipped.get(id);
			if (held) return held;
		}
		return null;
	}

	/** The solids of the world as shapes, as the engine's colliders would be: boxes, spheres, cylinders, discs and models whose box is known. */
	private world(): CollisionWorld {
		if (this.collisions) return this.collisions;
		const world = new CollisionWorld();
		for (const slot of this.slots.values()) {
			const mesh = find(slot, 'meshRenderer');
			if (!mesh || mesh.type !== 'meshRenderer' || !find(slot, 'collider') || find(slot, 'grabbable')) continue;
			const node = this.nodes.get(slot.id)!;
			if (!node.isEnabled(false)) continue;
			const shape = this.shapeOf(slot, node);
			if (shape) world.set(slot.id, shape);
		}
		this.collisions = world;
		return world;
	}

	private shapeOf(slot: Slot, node: TransformNode): Shape | null {
		const mesh = find(slot, 'meshRenderer');
		if (!mesh || mesh.type !== 'meshRenderer') return null;
		node.computeWorldMatrix(true);
		const m = node.getWorldMatrix().m;
		const lengths: V3 = [Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10])];
		const rotation = node.absoluteRotationQuaternion.asArray() as Quat;
		let center: V3 = node.absolutePosition.asArray() as V3;
		let half: V3 = [lengths[0] / 2, lengths[1] / 2, lengths[2] / 2];
		const ref = mesh.meshRef;
		if (ref.kind === 'asset') {
			const modelBox = this.modelBox?.(ref.assetId);
			if (!modelBox) return null;
			// The engine shows a model with its largest side 1, centred: a box that is the model's own box scaled to that.
			const size = [modelBox.max[0] - modelBox.min[0], modelBox.max[1] - modelBox.min[1], modelBox.max[2] - modelBox.min[2]];
			const largest = Math.max(...size) || 1;
			const local = new Vector3(0, 0, 0);
			center = Vector3.TransformCoordinates(local, node.getWorldMatrix()).asArray() as V3;
			half = [(size[0] / largest) * lengths[0] / 2, (size[1] / largest) * lengths[1] / 2, (size[2] / largest) * lengths[2] / 2];
			return box(center, [Math.max(half[0], 0.01), Math.max(half[1], 0.01), Math.max(half[2], 0.01)], rotation);
		}
		const min = (h: V3): V3 => [Math.max(h[0], 0.01), Math.max(h[1], 0.01), Math.max(h[2], 0.01)];
		switch (ref.id) {
			case 'sphere': return sphere(center, Math.max(...half));
			case 'cylinder': return cylinder(center, Math.max(half[0], half[2]), half[1], rotation);
			case 'disc': return cylinder(center, Math.max(half[0], half[2]), 0.01, rotation);
			case 'ground': return box(center, min([half[0] * 20, 0.01, half[2] * 20]), rotation);
			case 'plane': return box(center, min([half[0], half[1], 0.01]), rotation);
			default: return box(center, min(half), rotation);
		}
	}

	private makeHost(): CodeBlockHost {
		const unknownSlot = (id: string, what: string): boolean => {
			if (this.slots.has(id)) return false;
			this.unknown.push(`${what}: ${id}`);
			if (this.strict) throw new Error(`The script touched a slot that does not exist (${what}): ${id}`);
			return true;
		};
		const colliders = { sync: () => this.world() };
		return {
			getSlot: (id) => this.slots.get(id),
			getNode: (id) => this.nodes.get(id),
			getChildren: (parentId) => [...this.slots.values()].filter((s) => s.parentId === parentId),
			allSlots: () => [...this.slots.values()].filter((s) => !this.isFragmentSlot(s.id)),
			getGrabbers: (id) => this.grabbers.get(id) ?? [],
			isHost: () => this.isHost,
			requestSpawn: (slot, options) => {
				const entry: Slot = structuredClone(slot);
				this.spawned.push({ ...entry, ephemeral: Boolean(options?.ephemeral) });
				if (options?.ephemeral) return;
				this.add(entry);
				this.attach(entry);
				this.syncFragments();
			},
			requestDelete: (id) => {
				for (const gone of this.descendants(id)) {
					this.nodes.get(gone)?.dispose();
					this.nodes.delete(gone);
					this.slots.delete(gone);
				}
				this.deleted.push(id);
				this.collisions = null;
				this.syncFragments();
			},
			setComponentField: (id, type, field, value, broadcast = true) => {
				if (!this.isHost || unknownSlot(id, 'setComponentField')) return;
				const component = find(this.slots.get(id)!, type) as Record<string, unknown> | undefined;
				if (!component) { this.unknown.push(`no ${type} on ${id}`); if (this.strict) throw new Error(`${id} has no ${type}`); return; }
				component[field] = structuredClone(value);
				this.writes.push({ slotId: id, component: type, field, value: structuredClone(value), broadcast });
				if (type === 'collider' || type === 'meshRenderer') this.collisions = null;
			},
			setComponent: (id, component, broadcast = true) => {
				if (!this.isHost || unknownSlot(id, 'setComponent')) return false;
				const slot = this.slots.get(id)!;
				slot.components = [...slot.components.filter((c) => c.type !== component.type), structuredClone(component)];
				this.writes.push({ slotId: id, component: component.type, field: '*', value: structuredClone(component), broadcast });
				this.collisions = null;
				return true;
			},
			removeComponent: (id, type) => {
				if (!this.isHost || unknownSlot(id, 'removeComponent')) return false;
				const slot = this.slots.get(id)!;
				const had = slot.components.some((c) => c.type === type);
				slot.components = slot.components.filter((c) => c.type !== type);
				this.collisions = null;
				return had;
			},
			reparent: (id, parentId) => {
				if (!this.isHost || unknownSlot(id, 'reparent')) return false;
				const node = this.nodes.get(id)!;
				const parent = parentId ? this.nodes.get(parentId) : null;
				if (parentId && !parent) return false;
				node.computeWorldMatrix(true);
				const world = node.getWorldMatrix().clone();
				node.parent = parent ?? null;
				const local = parent ? world.multiply((parent.computeWorldMatrix(true), parent.getWorldMatrix().clone().invert())) : world;
				const scale = new Vector3(), rotation = new Quaternion(), position = new Vector3();
				local.decompose(scale, rotation, position);
				node.position = position; node.rotationQuaternion = rotation; node.scaling = scale;
				this.slots.get(id)!.parentId = parentId;
				this.commit(id);
				this.collisions = null;
				return true;
			},
			commitTransform: (id) => { if (this.isHost) { this.commit(id); this.collisions = null; } },
			findNear: (position, radius) => [...this.slots.values()].filter((s) => { const p = this.position(s.id); return Math.hypot(p[0] - position[0], p[1] - position[1], p[2] - position[2]) <= radius; }),
			raycast: (origin, direction, maxDistance, ignore): RaycastHit | null => {
				const skip = ignore?.length ? (id: string) => ignore.some((i) => this.descendants(i).includes(id)) : undefined;
				const hit = this.world().raycast(origin as V3, direction as V3, maxDistance, { ignore: skip });
				return hit ? { slotId: hit.id, point: hit.point, normal: hit.normal, u: 0, v: 0 } : null;
			},
			overlap: (from, to, radius, ignore) => {
				const skip = ignore?.length ? (id: string) => ignore.some((i) => this.descendants(i).includes(id)) : undefined;
				const ids = new Set<string>();
				for (let k = 0; k <= 4; k++) {
					const t = k / 4;
					for (const contact of this.world().overlapSphere([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t], radius, { ignore: skip })) ids.add(contact.id);
				}
				return [...ids];
			},
			resolvePlayer: (grabberId) => {
				const id = grabberId.includes(':') ? grabberId.split(':')[0] : this.localPlayerId;
				return { id, name: this.players.get(id)?.name ?? id };
			},
			getPlayers: () => [...this.players.values()].map((p) => ({ id: p.id, name: p.name, role: p.role })),
			getPlayerPose: (id) => { const p = this.players.get(id); return p ? this.poseOf(p) : null; },
			teleportPlayer: (id, target: TeleportTarget) => {
				const p = this.players.get(id);
				if (!this.isHost || !p) return false;
				this.teleports.push({ playerId: id, position: [...target.position], yaw: target.yaw });
				p.head = [target.position[0], target.position[1] + 1.6, target.position[2]];
				if (target.yaw !== undefined) p.yaw = target.yaw;
				p.pitch = 0;
				return true;
			},
			equipPlayer: (playerId, slotId, hand) => {
				const player = this.players.get(playerId);
				// A desktop player has no left hand.
				if (!this.isHost || !player || (player.desktop && hand === 'left') || unknownSlot(slotId, 'equipPlayer')) return false;
				for (const [held, who] of this.equipped) if (who.playerId === playerId && who.hand === hand) { this.equipped.delete(held); this.hand('onUnequip', held, playerId, hand); }
				this.equipped.set(slotId, { playerId, hand });
				this.equips.push({ playerId, slotId, hand });
				this.hand('onEquip', slotId, playerId, hand);
				return true;
			},
			unequipPlayer: (playerId, hand) => {
				if (!this.isHost || !this.players.has(playerId)) return false;
				for (const [held, who] of this.equipped) if (who.playerId === playerId && who.hand === hand) { this.equipped.delete(held); this.hand('onUnequip', held, playerId, hand); }
				this.unequips.push({ playerId, hand });
				return true;
			},
			getEquipHolder: (slotId) => this.holder(slotId),
			getUIMedia: () => undefined,
			getUIInputText: (id) => this.inputText.get(id),
			openDash: (tab, options) => { this.dashOpens.push({ tab, options }); },
			physics: createScriptPhysics(colliders, (id) => this.slots.get(id)?.parentId ?? null),
			setPlayerVelocity: (playerId, velocity, add) => {
				const p = this.players.get(playerId);
				if (!this.isHost || !p) return false;
				this.velocities.push({ playerId, velocity: [...velocity], add });
				p.velocity = add ? [p.velocity[0] + velocity[0], p.velocity[1] + velocity[1], p.velocity[2] + velocity[2]] : [...velocity];
				return true;
			},
			hapticPulse: (playerId, hand, intensity, durationMs) => {
				if (!this.isHost || !this.players.has(playerId)) return false;
				this.haptics.push({ playerId, hand, intensity, durationMs });
				return true;
			},
			flush: () => { this.flushes++; },
			setSlotEnabled: (id, enabled, broadcast = true) => {
				if (!this.isHost || unknownSlot(id, 'setSlotEnabled')) return false;
				const slot = this.slots.get(id)!;
				if (!!slot.disabled === !enabled) return false;
				if (enabled) delete slot.disabled; else slot.disabled = true;
				this.nodes.get(id)!.setEnabled(enabled);
				this.writes.push({ slotId: id, component: '', field: 'disabled', value: !enabled, broadcast });
				this.collisions = null;
				this.syncFragments();
				return true;
			},
			audio: this.audio,
			storage: this.storage,
			importPolyHavenModel: () => Promise.reject(new Error('Not available in a test world'))
		};
	}
}

/** A world to run scripts in. See `TestWorld`. */
export function createTestWorld(tree: SlotTree, options?: TestWorldOptions): TestWorld {
	return new TestWorld(tree, options);
}
