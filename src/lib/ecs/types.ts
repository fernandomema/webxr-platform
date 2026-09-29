/**
 * Slot/Component data model, patterned after Neos/Resonite's scene graph:
 * every entity is a "Slot" (transform node) carrying zero or more
 * "Components" that add behaviour/data. This is the single serialization
 * format shared by world templates, the inventory (all three backends) and
 * the host->guest scene snapshot sent over the DataChannel.
 */

import type { MeshRef } from '../assets/ref';

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface MeshRendererComponent {
	type: 'meshRenderer';
	/** A built-in primitive, or a model addressed by the SHA-256 of its bytes (see $lib/assets/ref). */
	meshRef: MeshRef;
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

/** Where an equipped object sits relative to the controller grip, in the grip's local space. */
export interface EquipPose {
	position: Vec3;
	/** Euler angles in degrees (pitch, yaw, roll — Babylon's yaw-pitch-roll order). The object's own scale is never changed by equipping. */
	rotation: Vec3;
}

/**
 * Lets a `grabbable` object be equipped in a hand from the radial menu. While
 * equipped it stays in that hand after the grip is released, and its (and its
 * children's) codeBlocks receive the hand's trigger through `onTrigger`.
 * Which hand holds it is session state; the serialized `parentId` never changes.
 */
export interface EquippableComponent {
	type: 'equippable';
	left: EquipPose;
	right: EquipPose;
}

export interface AudioSourceComponent {
	type: 'audioSource';
}

export interface ContainerComponent {
	type: 'container';
}

export interface WorldPortalComponent {
	type: 'worldPortal';
	/** A portable snapshot plus provenance. Other peers never read its owner's inventory. */
	world: import('$lib/worlds/types').WorldPackage;
}

export interface MirrorComponent {
	type: 'mirror';
	resolution?: number;
}

export interface VideoPlayerComponent {
	type: 'videoPlayer';
	/** A browser-loadable media URL (for example MP4/WebM/HLS when supported). */
	url: string;
	autoplay?: boolean;
	loop?: boolean;
	muted?: boolean;
	volume?: number;
	playing?: boolean;
	currentTime?: number;
}

export interface AudioPlayerComponent {
	type: 'audioPlayer';
	/** A browser-loadable audio URL (for example MP3/OGG/WAV when supported). */
	url: string;
	autoplay?: boolean;
	loop?: boolean;
	volume?: number;
	playing?: boolean;
	currentTime?: number;
}

export type MediaControlAction = 'toggle' | 'play' | 'pause';

export interface CodeBlockComponent {
	type: 'codeBlock';
	/**
	 * The body of a function receiving a bounded `ctx` API object and
	 * returning an optional handlers object: `{ onSpawn?, onGrab?, onRelease?,
	 * onEquip?, onUnequip?, onTrigger?, tick?, getRadialItems? }`. Compiled once per live instantiation via
	 * `new Function('ctx', code)` — NOT a real sandbox (see sceneGraph.ts):
	 * this data travels over the network like any other Slot field, so it
	 * runs inside the page of anyone who joins a world using it.
	 */
	code: string;
}

export interface ExpiresComponent {
	type: 'expires';
	/** Absolute epoch ms — every peer independently removes the slot once past this, see SceneGraph.tick(). */
	expiresAt: number;
}

export interface ParticleBurstComponent {
	type: 'particleBurst';
	color?: string;
	count?: number;
	durationMs?: number;
}

export interface VelocityComponent {
	type: 'velocity';
	/** Units/second, integrated into the Slot's position every tick by SceneGraph — generic simple kinematics for any thrown/rolling/sliding object, not tied to any one demo. Paused while the slot is grabbed (see SceneGraph.tick). */
	linear: Vec3;
	/** Fraction of speed lost per second (exponential decay); omitted/0 means it coasts forever. */
	drag?: number;
}

export interface TextDisplayComponent {
	type: 'textDisplay';
	/** Rendered larger, above `lines` — generic floating sign/label surface, not tied to any one demo. */
	title?: string;
	lines: string[];
	color?: string;
}

/**
 * A generic tabular leaderboard/scoreboard surface — a header row of
 * `columns` plus one row per player, styled like an arcade scoreboard.
 * All the game logic (turn order, what a cell means) lives in the codeBlock
 * that writes these fields; this component only knows how to lay a grid
 * out, so it's reusable for any multiplayer minigame that wants a shared
 * scoreboard, not just bowling.
 */
export interface ScoreboardComponent {
	type: 'scoreboard';
	title?: string;
	/** A short status line above the grid, e.g. "Up: Alice — throw 1/2". */
	status?: string;
	columns: string[];
	rows: {
		name: string;
		/** Aligned with `columns`, one string per column. */
		cells: string[];
		/** Highlights the row (e.g. whoever's turn it is). */
		highlight?: boolean;
		/** Shows a leader marker next to the name. */
		isLeader?: boolean;
	}[];
}

export interface ScriptStateComponent {
	type: 'scriptState';
	/**
	 * Arbitrary JSON a codeBlock reads/writes via `world.setComponentField` —
	 * a generic shared "blackboard" for coordinating several cooperating
	 * codeBlocks on different Slots (turn counters, tallies, reset signals),
	 * since scripts otherwise can't call into each other directly. Not tied
	 * to any one demo.
	 */
	data: Record<string, unknown>;
}

export interface PressableButtonComponent {
	type: 'pressableButton';
	/** Local-space direction the button travels when pressed, e.g. [0, -1, 0] to push straight down. Need not be unit length. */
	axis: Vec3;
	/** Local-space distance from resting to fully pressed. */
	travel: number;
	/** Local-space radius around the press axis a hand/controller tip must be within to register as touching the button. */
	radius: number;
	/** Depression fraction (0-1) at which the codeBlock's `onPress()` fires — defaults to 1 (fully pressed). */
	threshold?: number;
}

/** A short procedural percussive sound (noise burst + optional pitched tone) — see impactSoundEffects.ts. Generic game-feel audio (impacts, clicks, knocks) without needing to source/host external sound files. */
export interface ImpactSoundComponent {
	type: 'impactSound';
	/** Base tone frequency in Hz; omit/0 for a pure noise hit (e.g. a clatter/crash). */
	frequency?: number;
	/** How far the tone's pitch drops over the sound's life, in Hz — gives a "knock"/"thud" character. */
	pitchDrop?: number;
	/** 0-1, how much filtered noise is mixed in alongside the tone (1 = pure noise). */
	noiseMix?: number;
	durationMs?: number;
	volume?: number;
}

export type Component =
	| MeshRendererComponent
	| ColliderComponent
	| GrabbableComponent
	| EquippableComponent
	| AudioSourceComponent
	| ContainerComponent
	| WorldPortalComponent
	| MirrorComponent
	| VideoPlayerComponent
	| AudioPlayerComponent
	| CodeBlockComponent
	| ExpiresComponent
	| ParticleBurstComponent
	| VelocityComponent
	| PressableButtonComponent
	| ImpactSoundComponent
	| TextDisplayComponent
	| ScoreboardComponent
	| ScriptStateComponent;

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

export function isEquippable(slot: Slot): EquippableComponent | undefined {
	return findComponent(slot, 'equippable');
}

export function isGrabbable(slot: Slot): GrabbableComponent | undefined {
	return findComponent(slot, 'grabbable');
}
