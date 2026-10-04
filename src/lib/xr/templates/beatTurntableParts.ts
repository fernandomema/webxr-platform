import type { Slot } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';

/** The layout of the Beat Turntable world, shared by its parts (see beatTurntable.ts for what the world is). */
export const BEAT_TURNTABLE = {
	socketId: 'bt-socket',
	boardId: 'bt-board',
	hudId: 'bt-hud',
	consoleId: 'bt-console',
	resultsId: 'bt-results',
	/** Notes in each hand's pool: enough for the densest level to have every block on screen. */
	poolSize: 14,
	playerZ: 2,
	hitZ: 2.75,
	/** Distance the blocks travel, from where they appear to the hit line. */
	field: 11,
	colX: [-0.6, -0.2, 0.2, 0.6],
	rowY: [0.85, 1.2, 1.55],
	difficultyButtons: ['bt-diff-easy', 'bt-diff-normal', 'bt-diff-hard'],
	/** Where the player stands to play: the hit line is in front of them. */
	hudZ: 7.2
} as const;

export const BLUE = '#2563eb';
export const RED = '#dc2626';

export type Vec3 = [number, number, number];

export const box = (id: string, name: string, position: Vec3, scale: Vec3, color: string, extra: Partial<Slot> = {}, collider = false, opacity?: number): Slot =>
	createSlot({
		id,
		name,
		position,
		scale,
		...extra,
		components: [
			{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color, ...(opacity === undefined ? {} : { opacity }) },
			...(collider ? [{ type: 'collider' as const, shape: 'box' as const }] : []),
			...(extra.components ?? [])
		]
	});

export const cylinder = (id: string, name: string, position: Vec3, diameter: number, height: number, color: string, extra: Partial<Slot> = {}): Slot =>
	createSlot({ id, name, position, scale: [diameter, height, diameter], ...extra, components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'cylinder' }, color }] });

export const sphere = (id: string, name: string, position: Vec3, diameter: number, color: string): Slot =>
	createSlot({ id, name, position, scale: [diameter, diameter, diameter], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' }, color }] });

/** A parent that only groups: it moves what is inside it and draws nothing. */
export const group = (id: string, name: string, position: Vec3): Slot => createSlot({ id, name, position, components: [{ type: 'container' }] });

export const uiPanel = (id: string, name: string, position: Vec3, width: number, height: number, worldWidth: number, background: string, extra: Slot['components'] = []): Slot =>
	createSlot({ id, name, position, components: [{ type: 'uiPanel', width, height, worldWidth, background }, ...extra] });

type Element = Partial<Extract<Slot['components'][number], { type: 'uiElement' }>>;

/** A uiElement slot: `kind` and the look in `element`. */
export const ui = (id: string, parentId: string | null, kind: 'container' | 'text' | 'button' | 'image', element: Element): Slot =>
	createSlot({ id, parentId, name: id, components: [{ type: 'uiElement', kind, ...element }] });
