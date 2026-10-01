// Builds src/lib/xr/templates/pulse.json: Feedback Center, an indoor space where players speak up. Screens at the far end
// of the hall show the ideas and bugs players want worked on, each with an up and a down button to vote; a suggestion desk
// and a mood wall let anyone add their own voice (see feedback-board.mjs). The screens use persistent feedback APIs.
// Run with `node scripts/generate-pulse.mjs`.
//
// The player arrives on a glowing pad just inside the hall, looking down its long axis (towards -Z; +X is on their left).
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorld, mesh, pitch, solid, turn, yaw } from './world-kit.mjs';
import { MOODS, moodWallSlots, roadmapSlots, suggestionBoxSlots, votingBoardSlots } from './feedback-board.mjs';

const LEFT = 1, RIGHT = -1;
/** The hall: its inside runs between the side walls at ±HALF and from the entrance wall (z = FRONT) to the back wall. */
const HALF = 14, FRONT = 6, BACK = -26, HEIGHT = 7, WALL = 0.4;
const INNER = HALF - WALL / 2; // x of the inner face of a side wall
const midZ = (FRONT + BACK) / 2;
const LENGTH = FRONT - BACK;

const COLORS = {
	floor: '#26314d',
	runner: '#3a4a72',
	wall: '#2e3c6b',
	wood: '#7a573a',
	woodLight: '#9a7049',
	ceiling: '#5a6a9c',
	beam: '#3d4c7c',
	glow: '#5eead4',
	warm: '#fde68a',
	light: '#fff4d6',
	stage: '#3a4870',
	stageEdge: '#0f172a',
	frame: '#0b1224',
	post: '#64748b',
	white: '#e5e9f0',
	sofaTeal: '#0f766e',
	sofaAmber: '#b45309',
	leaf: '#22a35a',
	pot: '#c2703d',
	idea: '#fcd34d',
	bug: '#fb7185'
};

const { slots, slot, group, box, floor, sign } = createWorld();

/** A box that can be turned: given by its centre, size and rotation. */
const rbox = (id, name, parentId, center, size, rotation, color, walkThrough = true) =>
	slot(id, name, parentId, { position: center, rotation, scale: size, components: [mesh('box', color), ...(walkThrough ? [] : [solid])] });

// --- the hall's shell -------------------------------------------------------------------------------------------------------
slot('pulse-sky', 'Night Sky', null, { components: [{ type: 'skybox', topColor: '#0a0f1f', horizonColor: '#1b2440', bottomColor: '#0a0f1f', stars: 0 }] });
floor('pulse-floor', 'Hall Floor', null, [-HALF, HALF], [BACK, FRONT], 0, COLORS.floor);

group('pulse-shell', 'Shell');
box('pulse-wall-left', 'Wall Left', 'pulse-shell', [LEFT * HALF, HEIGHT / 2, midZ], [WALL, HEIGHT, LENGTH + WALL], COLORS.wall);
box('pulse-wall-right', 'Wall Right', 'pulse-shell', [RIGHT * HALF, HEIGHT / 2, midZ], [WALL, HEIGHT, LENGTH + WALL], COLORS.wall);
box('pulse-wall-back', 'Wall Back', 'pulse-shell', [0, HEIGHT / 2, BACK], [2 * HALF + WALL, HEIGHT, WALL], COLORS.wall);
box('pulse-wall-front', 'Wall Front', 'pulse-shell', [0, HEIGHT / 2, FRONT], [2 * HALF + WALL, HEIGHT, WALL], COLORS.wall);
box('pulse-ceiling', 'Ceiling', 'pulse-shell', [0, HEIGHT + 0.15, midZ], [2 * HALF + WALL, 0.3, LENGTH + WALL], COLORS.ceiling, true);

// Wood panelling low on every inside wall, and a line of light along their tops.
for (const [id, center, size] of [
	['left', [LEFT * (INNER - 0.03), 0.6, midZ], [0.06, 1.2, LENGTH - WALL]],
	['right', [RIGHT * (INNER - 0.03), 0.6, midZ], [0.06, 1.2, LENGTH - WALL]],
	['front', [0, 0.6, FRONT - WALL / 2 + 0.03], [2 * INNER, 1.2, 0.06]]
]) {
	box(`pulse-panelling-${id}`, 'Wall Panelling', 'pulse-shell', center, size, COLORS.wood, true);
	box(`pulse-panelling-cap-${id}`, 'Wall Panelling Cap', 'pulse-shell', [center[0], 1.23, center[2]], [size[0] + (size[0] > 1 ? 0 : 0.03), 0.05, size[2] + (size[2] > 1 ? 0 : 0.03)], COLORS.glow, true);
	box(`pulse-glow-${id}`, 'Wall Light Line', 'pulse-shell', [center[0], HEIGHT - 0.2, center[2]], [size[0] > 1 ? size[0] : 0.05, 0.1, size[2] > 1 ? size[2] : 0.05], COLORS.glow, true);
}

// Wooden slats over the back wall, which the boards stand in front of.
group('pulse-slats', 'Back Wall Slats');
for (let i = 0; i < 37; i++) {
	box(`pulse-slat-${i}`, 'Wall Slat', 'pulse-slats', [-13.5 + i * 0.75, HEIGHT / 2, BACK + WALL / 2 + 0.06], [0.4, HEIGHT - 0.4, 0.12], i % 2 ? COLORS.woodLight : COLORS.wood, true);
}

// Columns along the side walls, each with a strip of light, and the beams and lights of the ceiling.
group('pulse-columns', 'Columns');
for (const side of [LEFT, RIGHT]) {
	const s = side === LEFT ? 'l' : 'r';
	for (const [n, z] of [-3, -11, -19].entries()) {
		box(`pulse-column-${s}${n}`, 'Column', 'pulse-columns', [side * (INNER - 0.35), HEIGHT / 2, z], [0.7, HEIGHT, 0.7], COLORS.beam);
		box(`pulse-column-${s}${n}-light`, 'Column Light', 'pulse-columns', [side * (INNER - 0.72), HEIGHT / 2, z], [0.05, HEIGHT - 1.6, 0.16], COLORS.glow, true);
	}
}
group('pulse-ceiling-lights', 'Ceiling Lights');
for (const [n, x] of [-10, -5, 0, 5, 10].entries()) {
	box(`pulse-ceiling-strip-${n}`, 'Ceiling Light', 'pulse-ceiling-lights', [x, HEIGHT - 0.06, midZ], [0.3, 0.06, LENGTH - 2], COLORS.light, true);
}
for (const [n, z] of [-4, -12, -20].entries()) {
	box(`pulse-ceiling-beam-${n}`, 'Ceiling Beam', 'pulse-ceiling-lights', [0, HEIGHT - 0.14, z], [2 * INNER, 0.28, 0.3], COLORS.beam, true);
}

// --- arrival -------------------------------------------------------------------------------------------------------------------
group('pulse-arrival', 'Arrival');
slot('pulse-rug', 'Arrival Rug', 'pulse-arrival', { position: [0, 0.006, 1.5], scale: [9, 0.01, 9], components: [mesh('cylinder', '#123a3f')] });
slot('pulse-rug-ring', 'Arrival Rug Ring', 'pulse-arrival', { position: [0, 0.009, 1.5], scale: [6.6, 0.01, 6.6], components: [mesh('cylinder', '#17505a')] });
slot('pulse-pad-ring', 'Arrival Pad Ring', 'pulse-arrival', { position: [0, 0.014, 1.5], scale: [3.4, 0.02, 3.4], components: [mesh('cylinder', COLORS.glow)] });
slot('pulse-pad', 'Arrival Pad', 'pulse-arrival', { position: [0, 0.018, 1.5], scale: [3, 0.02, 3], components: [mesh('cylinder', COLORS.frame)] });
// A runner from the pad to the stage, edged with light.
box('pulse-runner', 'Runner', 'pulse-arrival', [0, 0.006, -8.5], [3.2, 0.01, 18], COLORS.runner, true);
for (const side of [LEFT, RIGHT]) box(`pulse-runner-edge-${side === LEFT ? 'l' : 'r'}`, 'Runner Edge', 'pulse-arrival', [side * 1.65, 0.012, -8.5], [0.06, 0.012, 18], COLORS.glow, true);

// The name, big, on the entrance wall behind the arrival pad, and what to do on the side walls.
sign('pulse-name', 'pulse-arrival', [0, 3.7, FRONT - WALL / 2 - 0.03], [8, 1.9], '-z', { title: 'FEEDBACK CENTER', lines: ['The feedback center · your voice moves us'], scale: 2.4 }, COLORS.glow, '#0b1224');
sign('pulse-how-vote', 'pulse-arrival', [LEFT * (INNER - 0.05), 3, -1], [2.6, 1.6], '-x', { title: 'VOTE', lines: ['Tap ▲ or ▼ on the boards', 'ahead to push ideas and bugs', 'up or down.'] }, COLORS.idea, '#0b1224');
sign('pulse-how-speak', 'pulse-arrival', [RIGHT * (INNER - 0.05), 3, -1], [2.6, 1.6], '+x', { title: 'SPEAK UP', lines: ['Send your own idea or bug', 'at the desk, or tell us how', 'you feel at the mood wall.'] }, COLORS.bug, '#0b1224');

// --- the stage the boards stand on -------------------------------------------------------------------------------------------
const STAGE_TOP = 0.25;
group('pulse-stage', 'Stage');
floor('pulse-stage-floor', 'Stage Floor', 'pulse-stage', [-12, 12], [BACK + WALL / 2, -16.5], STAGE_TOP, COLORS.stage);
box('pulse-stage-riser-front', 'Stage Riser', 'pulse-stage', [0, STAGE_TOP / 2, -16.5], [24, STAGE_TOP, 0.06], COLORS.stageEdge, true);
box('pulse-stage-riser-left', 'Stage Riser', 'pulse-stage', [12, STAGE_TOP / 2, (BACK + WALL / 2 - 16.5) / 2], [0.06, STAGE_TOP, 9.3], COLORS.stageEdge, true);
box('pulse-stage-riser-right', 'Stage Riser', 'pulse-stage', [-12, STAGE_TOP / 2, (BACK + WALL / 2 - 16.5) / 2], [0.06, STAGE_TOP, 9.3], COLORS.stageEdge, true);
box('pulse-stage-edge', 'Stage Edge Light', 'pulse-stage', [0, STAGE_TOP + 0.012, -16.46], [24, 0.02, 0.08], COLORS.glow, true);

sign('pulse-headline', 'pulse-stage', [0, 6.35, BACK + WALL / 2 + 0.14], [13, 0.9], '+z', { title: 'WHAT SHOULD WE BUILD NEXT?', lines: [], scale: 1.6 }, COLORS.glow, '#0b1224');

// --- screens -------------------------------------------------------------------------------------------------------------------------
group('pulse-boards', 'Boards');
const PANEL_DEPTH = 0.06;
const heightOf = (worldWidth, pixels) => (worldWidth * pixels.height) / pixels.width;
const BOARD_PIXELS = { width: 1200, height: 900 };
const BOARD_BOTTOM = 1.25; // metres above the stage

/** The frame and the two posts behind a screen whose centre is `position`, turned by `angle`. The screen itself faces +Z. */
function mount(id, name, parentId, position, angle, worldWidth, height, floorY) {
	const rotation = yaw(angle);
	const at = (local) => turn(local, angle).map((v, i) => v + position[i]);
	rbox(`${id}-frame`, `${name} Frame`, parentId, at([0, 0, -PANEL_DEPTH]), [worldWidth + 0.3, height + 0.3, 0.1], rotation, COLORS.frame);
	rbox(`${id}-glow`, `${name} Light`, parentId, at([0, -height / 2 - 0.2, -PANEL_DEPTH]), [worldWidth * 0.8, 0.04, 0.12], rotation, COLORS.glow);
	const postHeight = position[1] - height / 2 - 0.15 - floorY;
	if (postHeight <= 0.05) return;
	for (const [n, x] of [worldWidth / 2 - 0.4, -(worldWidth / 2 - 0.4)].entries()) {
		const [px, , pz] = at([x, 0, -0.2]);
		rbox(`${id}-post-${n}`, `${name} Post`, parentId, [px, floorY + postHeight / 2, pz], [0.2, postHeight, 0.2], rotation, COLORS.post, false);
	}
}

const centre = { worldWidth: 5.2, y: STAGE_TOP + BOARD_BOTTOM + heightOf(5.2, BOARD_PIXELS) / 2, z: -22.2 };
const side = { worldWidth: 4.2, y: STAGE_TOP + BOARD_BOTTOM + heightOf(4.2, BOARD_PIXELS) / 2, x: 9.4, z: -21, angle: 0.4 };

// Ideas in the middle, bugs on the left and the roadmap on the right, the side ones turned a little towards the player.
votingBoardSlots(slot, {
	id: 'pulse-ideas-board',
	name: 'Ideas Board',
	parentId: 'pulse-boards',
	title: 'TOP IDEAS',
	subtitle: 'What should we build next? Live ideas from players.',
	noun: 'idea',
	accent: COLORS.idea,
	items: [],
	position: [0, centre.y, centre.z],
	worldWidth: centre.worldWidth
});
mount('pulse-ideas-board', 'Ideas Board', 'pulse-boards', [0, centre.y, centre.z], 0, centre.worldWidth, heightOf(centre.worldWidth, BOARD_PIXELS), STAGE_TOP);

votingBoardSlots(slot, {
	id: 'pulse-bugs-board',
	name: 'Bugs Board',
	parentId: 'pulse-boards',
	title: 'BUG TRACKER',
	subtitle: 'What should we fix first? Live bug reports from players.',
	noun: 'bug',
	accent: COLORS.bug,
	items: [],
	position: [LEFT * side.x, side.y, side.z],
	rotation: yaw(-LEFT * side.angle),
	worldWidth: side.worldWidth
});
mount('pulse-bugs-board', 'Bugs Board', 'pulse-boards', [LEFT * side.x, side.y, side.z], -LEFT * side.angle, side.worldWidth, heightOf(side.worldWidth, BOARD_PIXELS), STAGE_TOP);

roadmapSlots(slot, {
	id: 'pulse-roadmap-board',
	name: 'Roadmap Board',
	parentId: 'pulse-boards',
	subtitle: 'Live status of player suggestions.',
	entries: Array.from({ length: 6 }, () => ({ status: 'planned', title: '' })),
	position: [RIGHT * side.x, side.y, side.z],
	rotation: yaw(-RIGHT * side.angle),
	worldWidth: side.worldWidth
});
mount('pulse-roadmap-board', 'Roadmap Board', 'pulse-boards', [RIGHT * side.x, side.y, side.z], -RIGHT * side.angle, side.worldWidth, heightOf(side.worldWidth, BOARD_PIXELS), STAGE_TOP);

// --- the suggestion desk (left) and the mood wall (right), each a screen standing on a counter ----------------------------------
group('pulse-desks', 'Desks');
const COUNTER = { width: 3, height: 1, depth: 0.8 };
const DESK_ANGLE = 0.45;

/** A counter at `position` turned by `angle`, with a screen of `pixels` standing on it; returns the screen's slot position. */
function desk(id, name, position, angle, worldWidth, pixels) {
	const rotation = yaw(angle);
	const at = (local) => turn(local, angle).map((v, i) => v + position[i]);
	rbox(`${id}-counter`, `${name} Counter`, 'pulse-desks', at([0, COUNTER.height / 2, 0]), [COUNTER.width, COUNTER.height, COUNTER.depth], rotation, COLORS.white, false);
	rbox(`${id}-counter-top`, `${name} Counter Top`, 'pulse-desks', at([0, COUNTER.height + 0.025, 0]), [COUNTER.width + 0.1, 0.05, COUNTER.depth + 0.1], rotation, COLORS.frame);
	rbox(`${id}-counter-light`, `${name} Counter Light`, 'pulse-desks', at([0, 0.06, COUNTER.depth / 2 + 0.01]), [COUNTER.width - 0.2, 0.05, 0.02], rotation, COLORS.glow);
	const height = heightOf(worldWidth, pixels);
	const y = COUNTER.height + 0.05 + 0.15 + height / 2;
	const screen = at([0, 0, -0.22]).map((v, i) => (i === 1 ? y : v));
	mount(id, name, 'pulse-desks', screen, angle, worldWidth, height, COUNTER.height + 0.05);
	return { position: screen, rotation, worldWidth };
}

const suggest = desk('pulse-suggestion-box', 'Suggestion Desk', [LEFT * 8, 0, -9.5], -LEFT * DESK_ANGLE, 2.6, { width: 1000, height: 640 });
suggestionBoxSlots(slot, {
	id: 'pulse-suggestion-box',
	name: 'Suggestion Desk',
	parentId: 'pulse-desks',
	position: suggest.position,
	rotation: suggest.rotation,
	worldWidth: suggest.worldWidth
});

const mood = desk('pulse-mood-wall', 'Mood Wall', [RIGHT * 8, 0, -9.5], -RIGHT * DESK_ANGLE, 2.6, { width: 1000, height: 700 });
moodWallSlots(slot, {
	id: 'pulse-mood-wall',
	name: 'Mood Wall',
	parentId: 'pulse-desks',
	counts: MOODS.map(() => 0),
	position: mood.position,
	rotation: mood.rotation,
	worldWidth: mood.worldWidth
});

// --- lounge: sofas facing the boards, plants and lamps -----------------------------------------------------------------------------
group('pulse-lounge', 'Lounge');
function sofa(id, x, z, color) {
	box(`${id}-seat`, 'Sofa Seat', 'pulse-lounge', [x, 0.25, z], [2.6, 0.5, 0.95], color);
	box(`${id}-back`, 'Sofa Back', 'pulse-lounge', [x, 0.75, z + 0.4], [2.6, 0.6, 0.2], color, true);
	for (const side of [-1, 1]) box(`${id}-arm-${side < 0 ? 'a' : 'b'}`, 'Sofa Arm', 'pulse-lounge', [x + side * 1.3, 0.4, z], [0.2, 0.8, 0.95], color, true);
	box(`${id}-cushion`, 'Sofa Cushion', 'pulse-lounge', [x, 0.56, z - 0.05], [2.2, 0.12, 0.7], '#f1f5f9', true);
}
for (const [s, side] of [['l', LEFT], ['r', RIGHT]]) {
	sofa(`pulse-sofa-${s}1`, side * 3.6, -13.5, side === LEFT ? COLORS.sofaTeal : COLORS.sofaAmber);
	sofa(`pulse-sofa-${s}2`, side * 6.6 + side * 1.2, -4.5, side === LEFT ? COLORS.sofaAmber : COLORS.sofaTeal);
	// A round low table between each pair.
	slot(`pulse-table-${s}`, 'Coffee Table', 'pulse-lounge', { position: [side * 4.9, 0.2, -10.8], scale: [0.9, 0.4, 0.9], components: [mesh('cylinder', COLORS.woodLight), solid] });
}

function plant(id, x, z, size = 1) {
	slot(`${id}-pot`, 'Plant Pot', 'pulse-lounge', { position: [x, 0.3 * size, z], scale: [0.6 * size, 0.6 * size, 0.6 * size], components: [mesh('cylinder', COLORS.pot), solid] });
	slot(`${id}-leaves`, 'Plant', 'pulse-lounge', { position: [x, 0.95 * size, z], scale: [0.9 * size, 0.85 * size, 0.9 * size], components: [mesh('sphere', COLORS.leaf)] });
	slot(`${id}-top`, 'Plant', 'pulse-lounge', { position: [x + 0.1 * size, 1.4 * size, z - 0.05 * size], scale: [0.55 * size, 0.55 * size, 0.55 * size], components: [mesh('sphere', '#34c46e')] });
}
for (const [s, side] of [['l', LEFT], ['r', RIGHT]]) {
	plant(`pulse-plant-${s}1`, side * 12.6, 4.6, 1.5);
	plant(`pulse-plant-${s}2`, side * 12.6, -6.6, 1.3);
	plant(`pulse-plant-${s}3`, side * 12.6, -24.4, 1.5);
}

// Lamps hanging over the lounge.
function pendant(id, x, z, color) {
	const y = 4.6;
	slot(`${id}-cord`, 'Lamp Cord', 'pulse-lounge', { position: [x, (HEIGHT + y) / 2, z], scale: [0.02, HEIGHT - y, 0.02], components: [mesh('cylinder', COLORS.frame)] });
	slot(id, 'Pendant Lamp', 'pulse-lounge', { position: [x, y, z], scale: [0.6, 0.35, 0.6], components: [mesh('sphere', color)] });
}
for (const [n, x] of [-6, -3, 3, 6].entries()) pendant(`pulse-pendant-${n}`, x, -12, COLORS.warm);
pendant('pulse-pendant-l', LEFT * 8, -9.5, COLORS.glow);
pendant('pulse-pendant-r', RIGHT * 8, -9.5, COLORS.glow);

// --- a podium for the team on the stage ------------------------------------------------------------------------------------------------
group('pulse-podium', 'Podium');
box('pulse-podium-base', 'Podium Base', 'pulse-podium', [RIGHT * 4.3, STAGE_TOP + 0.5, -19.3], [0.9, 1, 0.6], COLORS.woodLight);
slot('pulse-podium-top', 'Podium Desk', 'pulse-podium', { position: [RIGHT * 4.3, STAGE_TOP + 1.05, -19.32], rotation: pitch(0.35), scale: [1.05, 0.08, 0.75], components: [mesh('box', COLORS.wood)] });
sign('pulse-podium-sign', 'pulse-podium', [RIGHT * 4.3, STAGE_TOP + 0.55, -18.97], [0.7, 0.3], '+z', { title: 'Dev Updates', lines: ['Coming soon'] }, COLORS.glow, '#0b1224');

writeFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/lib/xr/templates/pulse.json'), JSON.stringify(slots, null, '\t') + '\n');
console.log(`pulse.json: ${slots.length} slots`);
