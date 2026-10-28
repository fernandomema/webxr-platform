import { ARENA, MAPS, type Vec3 } from './data.ts';

/** How many looks a map can have: the places take turns (ruins, desert, cyber, ice). */
export const THEMES = 4;
export const themeOf = (map: number): number => map % THEMES;

/** A block of a map: its id inside the map's fragment, and its pose in the world. */
export interface Placed {
	id: string;
	position: Vec3;
	rotation: [number, number, number, number];
	scale: Vec3;
	kind: 'block' | 'pillar';
}

export const blockId = (n: number): string => `blk-${n}`;
export const pillarId = (n: number): string => `pil-${n}`;

const roll = (degrees: number): [number, number, number, number] => {
	const half = (degrees * Math.PI) / 360;
	return [0, 0, Math.sin(half), Math.cos(half)];
};

const round = (n: number) => Math.round(n * 1000) / 1000;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Where every block of a map goes: a box turned about z by the angle the game gave it, or a pillar for a circle, as deep as the arena. */
export function layoutOf(map: number): Placed[] {
	const def = MAPS[map];
	const depth = ARENA.depth + 0.5;
	return [
		...def.boxes.map((box, n): Placed => ({ kind: 'block', id: blockId(n), position: [round(box.x), round(box.y), 0], rotation: roll(box.a).map(round4) as Placed['rotation'], scale: [round(box.w), round(box.h), depth] })),
		...def.circles.map((circle, n): Placed => ({ kind: 'pillar', id: pillarId(n), position: [round(circle.x), round(circle.y), 0], rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2], scale: [round(circle.r * 2), depth, round(circle.r * 2)] }))
	];
}
