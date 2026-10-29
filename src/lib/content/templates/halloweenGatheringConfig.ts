import type { Vec3 } from '@kithin/engine/ecs/types';
import { makeFrame } from './arcadeKit.ts';
import type { Frame } from './arcadeKit.ts';

/**
 * The Lantern Night. Four houses stand round a square; each answers a double knock by opening its door a little and holding out a
 * hand with a gift, and waits for another one in return. What people leave is kept in the world's own storage (not in any account),
 * so whoever knocks later, in any session, can be given it.
 */
const house = (id: string, name: string, seed: 'jar' | 'brush' | 'music', color: string, x: number, z: number, yaw: number, mystery = false) => ({
	id,
	name,
	seed,
	/** Gives a random gift from everything visitors have left at any door, and keeps what it is given in the same pool. */
	mystery,
	color,
	frame: makeFrame(x, z, yaw) as Frame
});

export const HALLOWEEN = {
	director: 'hg-director',
	/** How many gifts shared in one session wake the Great Pumpkin. */
	goal: 6,
	/** Where the Great Pumpkin sleeps. */
	center: [0, 0, 7] as Vec3,
	houses: [
		house('hg-h0', 'Ghostlight', 'jar', '#8ff0cf', -8, 6.25, -Math.PI / 2),
		house('hg-h1', 'Witchlight', 'brush', '#c4b5fd', 8, 6.25, Math.PI / 2),
		house('hg-h2', 'Music Box', 'music', '#fb923c', 0, 14.15, 0),
		// Faces the square from the south-west corner (its door looks at the Great Pumpkin).
		house('hg-h3', 'Mystery Door', 'jar', '#f472b6', -7.5, 0.8, Math.atan2(-7.5, -6.2), true)
	],
	/** The gift each house starts with. They wait, switched off, as the model every copy is made from. */
	seeds: {
		jar: { id: 'hg-seed-jar', name: 'Spirit Jar' },
		brush: { id: 'hg-seed-brush', name: 'Witchlight Brush' },
		music: { id: 'hg-seed-music', name: 'Pumpkin Music Box' }
	}
} as const;

/** What the hand does, in the house's own coordinates (x to the visitor's right, z away from them, the door at z = -1.2). */
export const DOOR = {
	hinge: [-0.43, 0, -1.2] as Vec3,
	width: 0.86,
	height: 1.9,
	/** How far the door swings out when it is open. */
	swing: 0.9,
	/** The hand rests inside the doorway and reaches out to z = rest - reach. */
	handX: 0.24,
	handY: 1.1,
	rest: -0.6,
	reach: 1.2
} as const;
