import type { Quat, Slot, SlotTree } from '@kithin/engine/ecs/types';
import { createSlot } from '@kithin/engine/ecs/types';
import { box, cylinder, group } from './beatTurntableParts.ts';
import type { Vec3 } from './beatTurntableParts.ts';
import { yawQuat } from './arcadeKit.ts';
import { DOOR, HALLOWEEN } from './halloweenGatheringConfig.ts';
import { HALLOWEEN_SCRIPT } from './halloweenGatheringScript.ts';
import { BRUSH_SCRIPT, CRANK, MUSIC_BOX_SCRIPT, SPIRIT_JAR_SCRIPT } from './halloweenGatheringToys.ts';

const ORANGE = '#fb923c';
const WOOD = '#3b2a1e';
const STONE = '#4b5563';
const SKIN = '#e2e8f0';
const root = HALLOWEEN.director;

const rotZ = (angle: number): Quat => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];

/** `createSlot` leaves `disabled` out, so a slot that starts switched off is marked afterwards. */
const off = (slot: Slot): Slot => ((slot.disabled = true), slot);

const lamp = (id: string, parentId: string | null, at: Vec3, color: string, intensity: number, range: number): Slot =>
	createSlot({ id, parentId, name: 'Light', position: at, components: [{ type: 'pointLight', color, intensity, range }] });

const glow = (id: string, name: string, at: Vec3, scale: Vec3, color: string, parentId: string | null = null, shape: 'box' | 'sphere' = 'box', opacity?: number): Slot =>
	createSlot({ id, parentId, name, position: at, scale, components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: shape }, color, unlit: true, ...(opacity === undefined ? {} : { opacity }) }] });

/** A jack-o'-lantern whose face glows. */
function pumpkin(id: string, at: Vec3, size: number, parentId: string | null = null): Slot[] {
	const part = (suffix: string, name: string, l: Vec3, s: Vec3): Slot => glow(`${id}-${suffix}`, name, [at[0] + l[0], at[1] + l[1], at[2] + l[2]], s, '#fde68a', parentId);
	return [
		createSlot({ id, parentId, name: 'Pumpkin', position: at, scale: [size, size * 0.85, size], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' }, color: '#c2410c' }, { type: 'collider', shape: 'sphere' }] }),
		box(`${id}-stem`, 'Stem', [at[0], at[1] + size * 0.45, at[2]], [size * 0.12, size * 0.2, size * 0.12], '#4d7c0f', { parentId }),
		part('eye-l', 'Eye', [-size * 0.2, size * 0.08, -size * 0.46], [size * 0.14, size * 0.16, size * 0.05]),
		part('eye-r', 'Eye', [size * 0.2, size * 0.08, -size * 0.46], [size * 0.14, size * 0.16, size * 0.05]),
		part('mouth', 'Mouth', [0, -size * 0.18, -size * 0.46], [size * 0.4, size * 0.09, size * 0.05])
	];
}

/**
 * One house, built in its own coordinates (the container turns it into the square): the visitors stand toward negative z, the door
 * is at z = -1.2, and behind it is a short dark doorway where a hand waits. Nothing here is a button: the script listens for
 * knocking, opens the door, and moves the hand and the fingers.
 */
function house(index: number): Slot[] {
	const { id: hid, name, color, frame } = HALLOWEEN.houses[index];
	const roofColor = ['#0f172a', '#1e1b4b', '#292524', '#2a0a1a'][index];
	const wallColor = ['#134e4a', '#4c1d95', '#7c2d12', '#831843'][index];
	const part = (suffix: string, partName: string, l: Vec3, scale: Vec3, partColor: string, collider = false): Slot => box(`${hid}-${suffix}`, partName, l, scale, partColor, { parentId: hid }, collider);
	const lit = (suffix: string, partName: string, l: Vec3, scale: Vec3, partColor: string, shape: 'box' | 'sphere' = 'box'): Slot => glow(`${hid}-${suffix}`, partName, l, scale, partColor, hid, shape);
	const hinge = `${hid}-door`;
	const hand = `${hid}-hand`;
	const finger = (k: number): Slot[] => {
		const length = k === 1 || k === 2 ? 0.085 : 0.07;
		return [
			createSlot({ id: `${hand}-f${k}`, parentId: hand, name: 'Finger', position: [-0.036 + k * 0.024, 0, -0.055], components: [{ type: 'container' }] }),
			box(`${hand}-f${k}-b`, 'Finger Bone', [0, 0, -length / 2], [0.02, 0.018, length], SKIN, { parentId: `${hand}-f${k}` })
		];
	};
	return [
		createSlot({ id: hid, name: `${name} House`, position: [frame.o[0], 0, frame.o[2]], rotation: yawQuat(frame.yaw), components: [{ type: 'container' }] }),
		// Walls: a solid back, and a front with the doorway cut out of it (a short dark tunnel the hand waits in).
		part('back', 'Back Walls', [0, 1.3, 0.4], [2.8, 2.6, 1.6], wallColor, true),
		part('wall-l', 'Front Wall', [-0.915, 1.3, -0.8], [0.97, 2.6, 0.8], wallColor, true),
		part('wall-r', 'Front Wall', [0.915, 1.3, -0.8], [0.97, 2.6, 0.8], wallColor, true),
		part('lintel', 'Lintel', [0, 2.25, -0.8], [0.86, 0.7, 0.8], wallColor, true),
		part('tunnel-floor', 'Doorway Floor', [0, 0.02, -0.8], [0.86, 0.04, 0.8], '#2a1a0e'),
		lit('inside', 'Inside', [0, 0.95, -0.41], [0.86, 1.9, 0.02], '#6b3f17'),
		lamp(`${hid}-glow`, hid, [0, 1.3, -0.55], '#ffb347', 0, 4),
		// The door turns on a hinge at the visitor's left and swings out, so the gap it leaves is on the hand's side.
		createSlot({ id: hinge, parentId: hid, name: 'Door Hinge', position: [...DOOR.hinge], components: [{ type: 'container' }] }),
		createSlot({ id: `${hinge}-panel`, parentId: hinge, name: 'Door', position: [DOOR.width / 2, DOOR.height / 2, 0], scale: [DOOR.width, DOOR.height, 0.06], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color: '#2b1a0d' }, { type: 'collider', shape: 'box' }] }),
		box(`${hinge}-plank-a`, 'Door Plank', [DOOR.width / 2, 1.35, -0.035], [DOOR.width - 0.1, 0.07, 0.02], '#1a0f06', { parentId: hinge }),
		box(`${hinge}-plank-b`, 'Door Plank', [DOOR.width / 2, 0.55, -0.035], [DOOR.width - 0.1, 0.07, 0.02], '#1a0f06', { parentId: hinge }),
		glow(`${hinge}-knob`, 'Door Knob', [DOOR.width - 0.11, 0.95, -0.05], [0.07, 0.07, 0.05], '#facc15', hinge, 'sphere'),
		// The hand: it rests in the doorway and the script slides it out. It points along -z, palm up, and has fingers that curl.
		createSlot({ id: hand, parentId: hid, name: 'Hand', position: [DOOR.handX, DOOR.handY, DOOR.rest], components: [{ type: 'container' }] }),
		box(`${hand}-palm`, 'Palm', [0, 0, 0], [0.1, 0.028, 0.11], SKIN, { parentId: hand }),
		box(`${hand}-cuff`, 'Cuff', [0, 0, 0.085], [0.12, 0.05, 0.045], color, { parentId: hand }),
		box(`${hand}-sleeve`, 'Sleeve', [0, 0, 0.62], [0.1, 0.075, 1.04], wallColor, { parentId: hand }),
		...[0, 1, 2, 3].flatMap(finger),
		createSlot({ id: `${hand}-thumb`, parentId: hand, name: 'Thumb', position: [0.055, 0, -0.01], rotation: [0, -0.3, 0, 0.954], components: [{ type: 'container' }] }),
		box(`${hand}-thumb-b`, 'Thumb Bone', [0, 0, -0.03], [0.024, 0.02, 0.06], SKIN, { parentId: `${hand}-thumb` }),
		// What the hand is asking for: the ghost of a gift floating over the open palm, and a soft glow round it.
		off(createSlot({ id: `${hand}-want`, parentId: hand, name: 'Wanted Gift', position: [0, 0.2, -0.04], components: [{ type: 'container' }] })),
		glow(`${hand}-want-box`, 'Gift Outline', [0, 0, 0], [0.13, 0.11, 0.13], '#c4b5fd', `${hand}-want`, 'box', 0.28),
		glow(`${hand}-want-rb1`, 'Ribbon', [0, 0, 0], [0.145, 0.115, 0.022], '#fde68a', `${hand}-want`, 'box', 0.7),
		glow(`${hand}-want-rb2`, 'Ribbon', [0, 0, 0], [0.022, 0.115, 0.145], '#fde68a', `${hand}-want`, 'box', 0.7),
		glow(`${hand}-want-orb`, 'Glow', [0, -0.1, 0], [0.34, 0.34, 0.34], '#a78bfa', `${hand}-want`, 'sphere', 0.14),
		// The rest of the house.
		lit('window-l', 'Window', [-0.92, 1.4, -1.21], [0.4, 0.45, 0.04], '#fcd34d'),
		lit('window-r', 'Window', [0.92, 1.4, -1.21], [0.4, 0.45, 0.04], '#fcd34d'),
		part('bar-l', 'Window Bar', [-0.92, 1.4, -1.24], [0.44, 0.04, 0.03], '#1a0f06'),
		part('bar-r', 'Window Bar', [0.92, 1.4, -1.24], [0.44, 0.04, 0.03], '#1a0f06'),
		...[-1, 1].map((side) => createSlot({ id: `${hid}-roof-${side}`, parentId: hid, name: 'Roof', position: [side * 0.78, 2.95, 0.4], rotation: rotZ(-side * 0.62), scale: [1.85, 0.14, 2.8], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color: roofColor }] })),
		part('chimney', 'Chimney', [0.85, 3.5, 0.55], [0.3, 1.0, 0.3], STONE),
		createSlot({
			id: `${hid}-sign`,
			parentId: hid,
			name: `${name} Sign`,
			position: [0, 2.25, -1.23],
			scale: [1.5, 0.5, 1],
			components: [
				{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#0b0618' },
				{ type: 'textDisplay', title: name, lines: [], color: '#0b0618', titleColor: color, scale: 1.2, verticalAlign: 'middle' }
			]
		}),
		// A post by the path says what to do.
		part('post', 'Hint Post', [-1.15, 0.45, -2.1], [0.06, 0.9, 0.06], WOOD),
		createSlot({
			id: `${hid}-hint`,
			parentId: hid,
			name: 'Hint',
			position: [-1.15, 0.98, -2.14],
			scale: [0.7, 0.28, 1],
			components: [
				{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#0b0618' },
				{ type: 'textDisplay', title: 'Knock twice', lines: [], color: '#0b0618', titleColor: '#fde68a', scale: 0.9, verticalAlign: 'middle' }
			]
		}),
		...pumpkin(`${hid}-pumpkin`, [1.2, 0.22, -1.7], 0.42, hid),
		...pumpkin(`${hid}-pumpkin-b`, [-1.45, 0.17, -1.55], 0.32, hid),
		lamp(`${hid}-porch`, hid, [0, 2.2, -1.9], color, 1.4, 7),
		// A path of flagstones from the square.
		...[0, 1, 2, 3].map((k) => box(`${hid}-path-${k}`, 'Flagstone', [k % 2 ? 0.08 : -0.06, 0.02, -2.3 - k * 0.85], [0.8, 0.04, 0.55], '#57534e', { parentId: hid, rotation: [0, k % 2 ? 0.04 : -0.03, 0, 1] }))
	];
}

const rotX = (angle: number): Quat => [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];

/**
 * The model of each gift: enough parts to read as a toy, and a script for how it is played with. Every copy that a door holds out
 * is made from this, so these wait switched off, out of the way. Only the brush is used with a trigger (and so worn); the jar is
 * shaken and the music box wound by hand.
 */
function seeds(): Slot[] {
	const pose = { position: [0, 0, 0] as Vec3, rotation: [0, 0, 0] as Vec3 };
	const at: Vec3 = [0, -50, 0];
	type Kind = keyof typeof HALLOWEEN.seeds;
	const shell = (kind: Kind, code: string): Slot =>
		off(createSlot({
			id: HALLOWEEN.seeds[kind].id,
			name: HALLOWEEN.seeds[kind].name,
			position: at,
			components: [
				{ type: 'container' },
				{ type: 'grabbable', scalable: false, autoGrip: true },
				...(kind === 'brush' ? [{ type: 'equippable' as const, left: pose, right: pose, autoGrip: true }] : []),
				{ type: 'scriptState', data: {} },
				{ type: 'codeBlock', code }
			]
		}));
	interface Look { shape?: 'box' | 'sphere' | 'cylinder'; parent?: string; rotation?: Quat; collider?: boolean; unlit?: boolean; opacity?: number }
	const sub = (kind: Kind, suffix: string, name: string, position: Vec3, scale: Vec3, color: string, look: Look = {}): Slot => {
		const shape = look.shape ?? 'box';
		return createSlot({
			id: `${HALLOWEEN.seeds[kind].id}-${suffix}`,
			parentId: look.parent ? `${HALLOWEEN.seeds[kind].id}-${look.parent}` : HALLOWEEN.seeds[kind].id,
			name,
			position,
			scale,
			...(look.rotation ? { rotation: look.rotation } : {}),
			components: [
				{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: shape }, color, ...(look.unlit ? { unlit: true } : {}), ...(look.opacity === undefined ? {} : { opacity: look.opacity }) },
				...(look.collider ? [{ type: 'collider' as const, shape: shape === 'sphere' ? ('sphere' as const) : ('box' as const) }] : [])
			]
		});
	};
	const GOLD = '#fbbf24', BLACK = '#0c0a09';
	const jar = HALLOWEEN.seeds.jar.id, music = HALLOWEEN.seeds.music.id;
	return [
		// The spirit jar: a glass jar with a purple lid and a little spirit glowing inside.
		shell('jar', SPIRIT_JAR_SCRIPT),
		sub('jar', 'base', 'Jar Base', [0, 0.012, 0], [0.12, 0.024, 0.12], '#1f2937', { shape: 'cylinder' }),
		sub('jar', 'glass', 'Jar Glass', [0, 0.1, 0], [0.11, 0.16, 0.11], '#99f6e4', { shape: 'cylinder', collider: true, opacity: 0.32 }),
		sub('jar', 'label', 'Jar Label', [0, 0.06, 0], [0.113, 0.035, 0.113], '#f59e0b', { shape: 'cylinder' }),
		sub('jar', 'lid', 'Jar Lid', [0, 0.19, 0], [0.12, 0.026, 0.12], '#4c1d95', { shape: 'cylinder' }),
		sub('jar', 'lid-knob', 'Jar Lid Knob', [0, 0.21, 0], [0.035, 0.025, 0.035], GOLD, { shape: 'sphere' }),
		sub('jar', 'spirit', 'Spirit', [0, 0.11, 0], [0.05, 0.06, 0.05], '#ccfbf1', { shape: 'sphere', unlit: true, opacity: 0.9 }),
		sub('jar', 'spirit-eye-l', 'Spirit Eye', [-0.12, 0.08, -0.42], [0.18, 0.24, 0.1], BLACK, { shape: 'sphere', parent: 'spirit', unlit: true }),
		sub('jar', 'spirit-eye-r', 'Spirit Eye', [0.12, 0.08, -0.42], [0.18, 0.24, 0.1], BLACK, { shape: 'sphere', parent: 'spirit', unlit: true }),
		lamp(`${jar}-light`, jar, [0, 0.11, 0], '#5eead4', 0.5, 2),

		shell('brush', BRUSH_SCRIPT),
		sub('brush', 'handle', 'Brush Handle', [0, 0, 0], [0.025, 0.025, 0.3], '#5b21b6', { collider: true }),
		sub('brush', 'ferrule', 'Brush Ferrule', [0, 0, -0.17], [0.035, 0.035, 0.06], '#c4b5fd'),
		glow(`${HALLOWEEN.seeds.brush.id}-tip`, 'Brush Tip', [0, 0, 0.17], [0.04, 0.04, 0.04], '#c4b5fd', HALLOWEEN.seeds.brush.id, 'sphere'),

		// The music box: a purple chest on golden feet, orange bands, a glowing pumpkin face on the front, its lid open behind a
		// little stage where a pumpkin in a witch's hat turns as the tune plays.
		shell('music', MUSIC_BOX_SCRIPT),
		sub('music', 'body', 'Music Box', [0, 0.1, 0], [0.3, 0.16, 0.22], '#2e1065', { collider: true }),
		sub('music', 'band-low', 'Music Box Band', [0, 0.03, 0], [0.31, 0.022, 0.23], '#c2410c'),
		sub('music', 'band-high', 'Music Box Band', [0, 0.172, 0], [0.31, 0.018, 0.23], '#c2410c'),
		...([[-1, -1], [-1, 1], [1, -1], [1, 1]] as const).flatMap(([x, z], k) => [
			sub('music', `post-${k}`, 'Music Box Post', [x * 0.15, 0.1, z * 0.11], [0.026, 0.17, 0.026], GOLD, { shape: 'cylinder' }),
			sub('music', `foot-${k}`, 'Music Box Foot', [x * 0.14, 0.008, z * 0.1], [0.032, 0.024, 0.032], GOLD, { shape: 'sphere' })
		]),
		sub('music', 'plaque', 'Pumpkin Plaque', [0, 0.1, -0.112], [0.13, 0.09, 0.006], '#ea580c'),
		sub('music', 'eye-l', 'Pumpkin Eye', [-0.03, 0.115, -0.116], [0.024, 0.02, 0.004], '#fde68a', { unlit: true }),
		sub('music', 'eye-r', 'Pumpkin Eye', [0.03, 0.115, -0.116], [0.024, 0.02, 0.004], '#fde68a', { unlit: true }),
		sub('music', 'mouth', 'Pumpkin Mouth', [0, 0.082, -0.116], [0.07, 0.014, 0.004], '#fde68a', { unlit: true }),
		sub('music', 'lid', 'Music Box Lid', [0, 0.27, 0.125], [0.31, 0.2, 0.014], '#3b0764', { rotation: rotX(-0.2) }),
		sub('music', 'lid-mirror', 'Music Box Mirror', [0, 0.27, 0.116], [0.26, 0.16, 0.004], '#a78bfa', { rotation: rotX(-0.2), unlit: true, opacity: 0.85 }),
		sub('music', 'stage', 'Music Box Stage', [0, 0.184, 0], [0.16, 0.008, 0.16], '#7f1d1d', { shape: 'cylinder' }),
		// The dancer turns as one: the script spins this slot.
		createSlot({ id: `${music}-dancer`, parentId: music, name: 'Dancer', position: [0, 0.19, 0], components: [{ type: 'container' }] }),
		sub('music', 'dancer-body', 'Little Pumpkin', [0, 0.03, 0], [0.06, 0.05, 0.06], '#f97316', { shape: 'sphere', parent: 'dancer' }),
		sub('music', 'dancer-eye-l', 'Little Eye', [-0.012, 0.035, -0.028], [0.01, 0.012, 0.004], '#fde68a', { parent: 'dancer', unlit: true }),
		sub('music', 'dancer-eye-r', 'Little Eye', [0.012, 0.035, -0.028], [0.01, 0.012, 0.004], '#fde68a', { parent: 'dancer', unlit: true }),
		sub('music', 'dancer-brim', 'Hat Brim', [0, 0.056, 0], [0.075, 0.004, 0.075], BLACK, { shape: 'cylinder', parent: 'dancer' }),
		sub('music', 'dancer-hat', 'Witch Hat', [0, 0.08, 0], [0.032, 0.045, 0.032], BLACK, { shape: 'cylinder', parent: 'dancer' }),
		sub('music', 'dancer-hat-tip', 'Witch Hat Tip', [0, 0.106, 0.004], [0.016, 0.02, 0.016], BLACK, { shape: 'cylinder', parent: 'dancer', rotation: rotX(0.35) }),
		// The crank: a fixed axle, an arm the script draws from the axle to the knob, and the knob, which is the only part that is grabbed.
		sub('music', 'axle', 'Crank Axle', [...CRANK.axle], [0.03, 0.025, 0.025], GOLD),
		sub('music', 'crank-arm', 'Crank Arm', [CRANK.armX, (CRANK.rest[1] + CRANK.axle[1]) / 2, 0], [0.012, CRANK.rest[1] - CRANK.axle[1], 0.012], GOLD),
		createSlot({
			id: `${music}-crank`,
			parentId: music,
			name: 'Crank Knob',
			position: [...CRANK.rest],
			scale: [0.055, 0.055, 0.055],
			components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' }, color: GOLD }, { type: 'collider', shape: 'sphere' }, { type: 'grabbable', scalable: false, autoGrip: true }]
		})
	];
}

/** The signs of the square: how it works, what has been left lately, and how awake the Great Pumpkin is. */
function signs(): Slot[] {
	const board = (id: string, name: string, at: Vec3, size: [number, number], title: string, lines: string[], scale: number): Slot =>
		createSlot({
			id,
			name,
			position: at,
			scale: [size[0], size[1], 1],
			components: [
				{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#0b0618' },
				{ type: 'textDisplay', title, lines, color: '#0b0618', titleColor: ORANGE, lineColor: '#e9d5ff', scale, verticalAlign: 'top' }
			]
		});
	return [
		box('hg-board-post-l', 'Post', [-1.3, 0.9, 3.2], [0.1, 1.8, 0.1], WOOD, {}, true),
		box('hg-board-post-r', 'Post', [1.3, 0.9, 3.2], [0.1, 1.8, 0.1], WOOD, {}, true),
		box('hg-board-frame', 'Board Frame', [0, 1.55, 3.22], [2.7, 1.5, 0.06], WOOD),
		board('hg-board', 'Welcome Board', [0, 1.55, 3.17], [2.56, 1.36], 'LANTERN NIGHT', ['Knock twice on a door.', 'Take what the hand offers,', 'then put something in it:', 'whatever you give stays for the next visitor.', '', 'Nobody has left anything yet.'], 0.62),
		board('hg-pumpkin-sign', 'Great Pumpkin Sign', [0, 0.55, 6.05], [1.0, 0.36], 'THE GREAT PUMPKIN', ['Sleeping · 0 / ' + HALLOWEEN.goal], 0.7)
	];
}

/** The Great Pumpkin, asleep on its plinth, and the wisps that wake one by one as the group shares gifts. */
function pumpkinRing(): Slot[] {
	const [cx, , cz] = HALLOWEEN.center;
	const parts: Slot[] = [
		cylinder('hg-plinth', 'Plinth', [cx, 0.15, cz], 1.5, 0.3, STONE),
		createSlot({ id: 'hg-big-pumpkin', name: 'Great Pumpkin', position: [cx, 0.82, cz], scale: [1.05, 0.9, 1.05], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' }, color: '#7c2d12' }, { type: 'collider', shape: 'sphere' }] }),
		box('hg-big-stem', 'Great Stem', [cx, 1.38, cz], [0.14, 0.24, 0.14], '#4d7c0f'),
		off(group('hg-pumpkin-face', 'Great Pumpkin Face', [cx, 0.9, cz - 0.55])),
		glow('hg-big-eye-l', 'Eye', [-0.22, 0.12, 0], [0.16, 0.2, 0.05], '#fde68a', 'hg-pumpkin-face'),
		glow('hg-big-eye-r', 'Eye', [0.22, 0.12, 0], [0.16, 0.2, 0.05], '#fde68a', 'hg-pumpkin-face'),
		glow('hg-big-mouth', 'Mouth', [0, -0.22, 0], [0.5, 0.11, 0.05], '#fde68a', 'hg-pumpkin-face'),
		lamp('hg-big-light', null, [cx, 1.0, cz - 0.8], ORANGE, 0.8, 6)
	];
	for (let i = 0; i < HALLOWEEN.goal; i++) {
		const angle = (i / HALLOWEEN.goal) * Math.PI * 2;
		const tint = i % 2 ? '#a78bfa' : '#8ff0cf';
		const wisp = glow(`hg-awakening-${i}`, 'Wisp', [cx + Math.sin(angle) * 2.3, 2.0 + (i % 2) * 0.25, cz + Math.cos(angle) * 2.3], [0.22, 0.22, 0.22], tint, null, 'sphere');
		wisp.components.push({ type: 'pointLight', color: tint, intensity: 0.7, range: 4 });
		parts.push(off(wisp));
	}
	return parts;
}

/** What the group has when it is done: friendly ghosts, a glow and fireflies. */
function celebration(): Slot[] {
	const [cx, , cz] = HALLOWEEN.center;
	const ghost = (i: number): Slot[] => {
		const id = `hg-ghost-${i}`;
		const angle = (i * Math.PI * 2) / 3;
		return [
			off(createSlot({ id, name: 'Friendly Ghost', position: [cx + Math.sin(angle) * 3.2, 2.25, cz + Math.cos(angle) * 3.2], components: [{ type: 'container' }] })),
			createSlot({ id: `${id}-body`, parentId: id, name: 'Ghost Body', scale: [0.5, 0.62, 0.5], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' }, color: '#f1f5f9', unlit: true, opacity: 0.85 }] }),
			createSlot({ id: `${id}-tail`, parentId: id, name: 'Ghost Tail', position: [0, -0.3, 0], scale: [0.4, 0.3, 0.4], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'cylinder' }, color: '#f1f5f9', unlit: true, opacity: 0.7 }] }),
			glow(`${id}-eye-l`, 'Eye', [-0.1, 0.06, -0.23], [0.07, 0.1, 0.03], '#111827', id, 'sphere'),
			glow(`${id}-eye-r`, 'Eye', [0.1, 0.06, -0.23], [0.07, 0.1, 0.03], '#111827', id, 'sphere')
		];
	};
	return [
		off(createSlot({ id: 'hg-celebration', name: 'Celebration', components: [{ type: 'container' }] })),
		createSlot({ id: 'hg-celebration-dust', parentId: 'hg-celebration', name: 'Fireflies', position: [cx, 1.2, cz], components: [{ type: 'particleEmitter', color: '#fde68a', rate: 14, radius: 3.4, size: 0.07, lifetime: 3, speed: 0.4, active: false }] }),
		lamp('hg-celebration-light', 'hg-celebration', [cx, 3.2, cz], '#c4b5fd', 1.6, 9),
		...[0, 1, 2].flatMap(ghost)
	];
}

/** The square itself: sky, ground, a fence, dead trees, graves, benches and a string of lights. */
function scenery(): Slot[] {
	const parts: Slot[] = [
		createSlot({ id: 'hg-sky', name: 'Sky', components: [{ type: 'skybox', topColor: '#05030f', horizonColor: '#1e1b4b', bottomColor: '#0b0618', stars: 0.55, ambientIntensity: 0.75 }] }),
		createSlot({ id: 'hg-spawn', name: 'Spawn Point', position: [0, 0, 0], components: [{ type: 'spawnPoint' }] }),
		createSlot({ id: 'hg-ground', name: 'Ground', position: [0, -0.05, 7], scale: [1.7, 1, 1.35], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'ground' }, color: '#1b2a1c' }, { type: 'collider', shape: 'box' }] }),
		glow('hg-moon', 'Moon', [-10, 20, 30], [4, 4, 4], '#fef3c7', null, 'sphere'),
		box('hg-fence-s', 'Fence', [0, 0.5, -3.6], [34, 1, 0.12], WOOD, {}, true),
		box('hg-fence-n', 'Fence', [0, 0.5, 17.6], [34, 1, 0.12], WOOD, {}, true),
		box('hg-fence-w', 'Fence', [-17, 0.5, 7], [0.12, 1, 21.2], WOOD, {}, true),
		box('hg-fence-e', 'Fence', [17, 0.5, 7], [0.12, 1, 21.2], WOOD, {}, true)
	];
	const trees: Array<[number, number, number]> = [[-13, 2, 1.1], [13.5, 3.5, 1], [-14, 12, 1.2], [14, 13.5, 1.1], [-11, 16, 0.9], [11.5, 16.2, 0.95]];
	trees.forEach(([x, z, s], i) => {
		parts.push(
			cylinder(`hg-tree-${i}`, 'Dead Tree', [x, 1.6 * s, z], 0.4 * s, 3.2 * s, '#1c1410'),
			box(`hg-tree-${i}-a`, 'Branch', [x + 0.5 * s, 3.0 * s, z], [1.3 * s, 0.14 * s, 0.14 * s], '#1c1410', { rotation: rotZ(0.5) }),
			box(`hg-tree-${i}-b`, 'Branch', [x - 0.45 * s, 2.6 * s, z + 0.1], [1.1 * s, 0.12 * s, 0.12 * s], '#1c1410', { rotation: rotZ(-0.6) })
		);
	});
	const graves: Array<[number, number]> = [[-14.5, 7], [-14.2, 8.6], [-14.8, 10.2], [14.5, 7.4], [14.3, 9], [14.7, 10.6], [-15.2, 4.6], [9.2, -1.8]];
	graves.forEach(([x, z], i) => {
		parts.push(box(`hg-grave-${i}`, 'Gravestone', [x, 0.4, z], [0.55, 0.8, 0.14], '#6b7280', { rotation: rotZ(((i % 3) - 1) * 0.07) }, true), box(`hg-grave-${i}-top`, 'Grave Mound', [x, 0.06, z + 0.55], [0.6, 0.12, 0.9], '#14210f'));
	});
	// Benches round the Great Pumpkin: somewhere to sit and talk about what you were given.
	const benches: Array<[number, number, number]> = [[-3.4, 7, Math.PI / 2], [3.4, 7, -Math.PI / 2], [0, 10.3, Math.PI]];
	benches.forEach(([x, z, yaw], i) => {
		const turn = yawQuat(yaw);
		parts.push(
			box(`hg-bench-${i}`, 'Bench Seat', [x, 0.45, z], [1.6, 0.08, 0.5], WOOD, { rotation: turn }, true),
			box(`hg-bench-${i}-back`, 'Bench Back', [x + Math.sin(yaw) * 0.22, 0.8, z + Math.cos(yaw) * 0.22], [1.6, 0.5, 0.06], WOOD, { rotation: turn }),
			box(`hg-bench-${i}-l`, 'Bench Leg', [x - Math.cos(yaw) * 0.65, 0.22, z + Math.sin(yaw) * 0.65], [0.08, 0.44, 0.4], '#1c1410', { rotation: turn }),
			box(`hg-bench-${i}-r`, 'Bench Leg', [x + Math.cos(yaw) * 0.65, 0.22, z - Math.sin(yaw) * 0.65], [0.08, 0.44, 0.4], '#1c1410', { rotation: turn })
		);
	});
	const pumpkins: Array<[number, number, number]> = [[-4.2, 3.2, 0.45], [6.2, 2, 0.4], [-2.2, 15.5, 0.5], [2.4, 15.5, 0.42], [-12, 6, 0.5], [12, 6.3, 0.46]];
	pumpkins.forEach(([x, z, s], i) => parts.push(...pumpkin(`hg-deco-pumpkin-${i}`, [x, s * 0.42, z], s)));
	for (let i = 0; i < 7; i++) {
		const sag = Math.sin((i / 6) * Math.PI) * -0.6;
		parts.push(glow(`hg-string-${i}`, 'String Light', [-9 + i * 3, 3.6 + sag, 1.2], [0.14, 0.14, 0.14], i % 2 ? ORANGE : '#c4b5fd', null, 'sphere'));
	}
	return parts;
}

/**
 * The Lantern Night: a Halloween gathering for a group. Four houses answer a double knock by opening their door a little and
 * holding out a hand with a gift, and then wait, palm up, for another one. What visitors give is kept in the world's storage, so
 * the next ones, in any session, are the ones who receive it. Everyone shares the Great Pumpkin: it wakes when the group has
 * exchanged enough. There is no menu: everything is done with the hands.
 */
export function buildHalloweenGathering(): SlotTree {
	return [
		createSlot({ id: root, name: 'Lantern Night', components: [{ type: 'container' }, { type: 'scriptState', data: { phase: 'gathering', shared: 0, players: {} } }, { type: 'codeBlock', code: HALLOWEEN_SCRIPT }] }),
		...scenery(),
		...signs(),
		...HALLOWEEN.houses.flatMap((_, index) => house(index)),
		...seeds(),
		...pumpkinRing(),
		...celebration()
	];
}
