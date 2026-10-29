/**
 * Where everything is in the bowling alley, shared by the builders, the script and the tests. Metres; +Y is up and the lanes run along +Z,
 * so a player who arrives looks down them. A lane's own frame (see bowlingLogic.ts) is `u` across it and `w` along it from the foul line.
 */
export const LANE_COUNT = 4;

export const HALL = {
	minX: -10,
	maxX: 10,
	minZ: -14,
	maxZ: 24.5,
	height: 4.6
} as const;

export const BOWLING = {
	/** The middle of each lane. Two pairs, a ball return between the lanes of a pair and a wide aisle between the pairs. */
	laneX: [-4.4, -2.0, 2.0, 4.4],
	/** The ball return each lane uses, and where along it that lane's balls rest. */
	returnX: [-3.2, -3.2, 3.2, 3.2],
	foulZ: 4.0,
	approachStartZ: -0.6,
	/** Lane block edges: the invisible walls keep people off the lanes. */
	blockMinX: -5.4,
	blockMaxX: 5.4,
	pitBackZ: 24.2,
	ballRestY: 0.93,
	/** Where the first ball rests along a return, and the gap between balls. */
	ballHomeZ: 1.9,
	ballGap: 0.5,
	/** Where players arrive. */
	spawn: [0, 0, -8.5],
	deskZ: -1.55,
	maxPlayers: 4,
	hallOfFameBoard: 'bw-hall-board'
} as const;

export const laneIds = (lane: number) => ({
	root: `bw-lane-${lane}`,
	ball: (k: number) => `bw-ball-${lane}-${k}`,
	pin: (n: number) => `bw-l${lane}-pin-${n}`,
	board: `bw-l${lane}-board`,
	monitor: `bw-l${lane}-monitor`,
	console: `bw-l${lane}-console`,
	status: `bw-l${lane}-status`,
	join: `bw-l${lane}-join`,
	leave: `bw-l${lane}-leave`,
	bumpers: `bw-l${lane}-bumpers`,
	assist: `bw-l${lane}-assist`,
	newGame: `bw-l${lane}-new`,
	cheer: `bw-l${lane}-cheer`,
	bumperRail: (side: 0 | 1) => `bw-l${lane}-rail-${side}`,
	glow: (side: 0 | 1) => `bw-l${lane}-glow-${side}`
});

/** Balls on each lane's return: how many, and where each rests. */
export const BALLS_PER_LANE = 2;

export function ballHome(lane: number, k: number): [number, number, number] {
	// The four balls of a return sit in a row along it: the first lane of the pair takes the first two places, the second the others.
	return [BOWLING.returnX[lane], BOWLING.ballRestY, BOWLING.ballHomeZ + BOWLING.ballGap * ((lane % 2) * BALLS_PER_LANE + k)];
}

export const DIRECTOR_ID = 'bw-director';
export const JUKEBOX_ID = 'bw-jukebox';

/** Where the jukebox stands, against the east wall. */
export const JUKEBOX_AT = { x: HALL.maxX - 0.45, z: -1.6 } as const;
