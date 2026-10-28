import type { Slot, UIElementComponent } from '@kithin/engine/ecs/types';
import { createSlot } from '@kithin/engine/ecs/types';
import { CARDS, DIFFICULTY, LENGTHS, LOBBY, RARITY_BG, TEAM, type Vec3 } from './data.ts';
import { ID, mesh, polyHaven, yawQuat } from './kit.ts';
import { sign } from './arena.ts';
import { model } from './models.ts';
import { bakedVolume } from './lighting.ts';

/** The colours of the menu: a dark violet room with an orange heart, blue and orange for the two sides. */
export const UI = {
	panel: '#0a0620',
	card: '#150c36',
	chip: '#1e1748',
	chipText: '#c4b5fd',
	chosen: '#f97316',
	chosenText: '#1a0b00',
	go: '#22c55e',
	goText: '#04260f',
	wait: '#475569',
	invite: '#0891b2',
	title: '#fb923c',
	muted: '#8b7fd6'
} as const;

/** What the menu offers, in the order of the script's choices. */
export const MENU = {
	rivals: DIFFICULTY.map((level) => level.name),
	lengths: LENGTHS.map((n) => `FIRST TO ${n}`)
};

type Layout = Partial<Omit<UIElementComponent, 'type' | 'kind'>>;

function element(id: string, parentId: string, kind: UIElementComponent['kind'], layout: Layout): Slot {
	return createSlot({ id, parentId, name: id, components: [{ type: 'uiElement', kind, ...layout }] });
}

const LOBBY_SIZE = { halfX: 7, minZ: 32.6, maxZ: 42.4, height: 5.2 };
const wood = polyHaven('brown_planks_03', 1.6, 'Wooden planks');
const brick = polyHaven('red_brick_03', 1.6, 'Red brick');
const plaster = polyHaven('painted_plaster_wall', 2.4, 'Painted plaster');

/** The room itself: a wooden floor, brick below and violet plaster above, a ceiling with beams and four hanging lamps. */
function buildShell(): Slot[] {
	const parentId = ID.lobby;
	const { halfX, minZ, maxZ, height } = LOBBY_SIZE;
	const depth = maxZ - minZ, midZ = (minZ + maxZ) / 2;
	const slots: Slot[] = [
		createSlot({ id: 'rd-lobby-floor', parentId, name: 'Lobby Floor', position: [0, 0, midZ], scale: [(halfX * 2) / 20, 1, depth / 20], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'ground' }, color: '#e8c9a0' }, wood, { type: 'collider', shape: 'box' }] }),
		mesh('rd-lobby-rug', 'Rug', 'disc', [0, 0.012, LOBBY.spawn[2] + 1.2], [5.4, 1, 5.4], '#3b1a78', { parentId }),
		mesh('rd-lobby-rug-ring', 'Rug Ring', 'disc', [0, 0.016, LOBBY.spawn[2] + 1.2], [4.6, 1, 4.6], '#6d28d9', { parentId }),
		mesh('rd-lobby-ring', 'Arrival Ring', 'disc', [LOBBY.spawn[0], 0.02, LOBBY.spawn[2]], [2.2, 1, 2.2], TEAM[0].color, { parentId, unlit: true, opacity: 0.85 }),
		mesh('rd-lobby-ceiling', 'Ceiling', 'box', [0, height + 0.15, midZ], [halfX * 2 + 0.8, 0.3, depth + 0.8], '#3a2a4a', { parentId })
	];
	// Four walls: brick up to the chair rail, painted plaster above, a gold rail between.
	const wall = (key: string, at: Vec3, size: [number, number, number]) => {
		const along = size[0] > size[2];
		const lower: Vec3 = [size[0], 1.2, size[2]], upper: Vec3 = [size[0], height - 1.2, size[2]];
		slots.push(
			mesh(`rd-lobby-${key}-lo`, 'Wall', 'box', [at[0], 0.6, at[2]], lower, '#eaa387', { parentId, solid: true, material: brick }),
			mesh(`rd-lobby-${key}-hi`, 'Wall', 'box', [at[0], 1.2 + upper[1] / 2, at[2]], upper, '#b794b8', { parentId, solid: true, material: plaster }),
			mesh(`rd-lobby-${key}-rail`, 'Rail', 'box', [at[0], 1.22, at[2]], along ? [size[0], 0.1, size[2] + 0.12] : [size[0] + 0.12, 0.1, size[2]], '#fbbf24', { parentId, unlit: true })
		);
	};
	wall('back', [0, 0, maxZ + 0.2], [halfX * 2 + 0.8, 0, 0.4]);
	wall('front', [0, 0, minZ - 0.2], [halfX * 2 + 0.8, 0, 0.4]);
	wall('west', [-halfX - 0.2, 0, midZ], [0.4, 0, depth]);
	wall('east', [halfX + 0.2, 0, midZ], [0.4, 0, depth]);
	// Beams across the ceiling, and lamps hanging from them.
	for (const z of [34.5, 37.5, 40.5]) slots.push(mesh(`rd-lobby-beam-${z}`, 'Beam', 'box', [0, height - 0.12, z], [halfX * 2, 0.26, 0.34], '#5a3b24', { parentId, material: wood }));
	([[-4, 35.6], [4, 35.6], [-3, 40], [3, 40]] as [number, number][]).forEach(([x, z], n) => {
		slots.push(
			mesh(`rd-lamp-${n}-cord`, 'Lamp Cord', 'box', [x, height - 0.6, z], [0.03, 0.9, 0.03], '#1a1033', { parentId }),
			model(`rd-lamp-${n}-shade`, 'Lamp Shade', 'lamp', [x, height - 1.3, z], { parentId }),
			mesh(`rd-lamp-${n}-bulb`, 'Bulb', 'sphere', [x, height - 1.2, z], [0.2, 0.2, 0.2], '#fff1c2', { parentId, unlit: true }),
			createSlot({ id: `rd-lamp-${n}-light`, parentId, name: 'Lamp Light', position: [x, height - 1.4, z], components: [{ type: 'pointLight', color: '#ffd9a0', intensity: 0.8, range: 16, baked: true }] })
		);
	});
	return slots;
}

/** The arcade cabinet around the menu panel: cheeks, a marquee, a control deck with a stick and buttons, and neon along the edges. */
function buildCabinet(): Slot[] {
	const parentId = ID.lobby;
	const [, py, pz] = LOBBY.panel.p;
	const panelH = (LOBBY.panel.worldWidth * LOBBY.panel.height) / LOBBY.panel.width;
	const top = py + panelH / 2, bottom = py - panelH / 2;
	const body = '#2a1255';
	const slots: Slot[] = [
		// The cheeks, the marquee on top and the base.
		mesh('rd-cab-cheek-w', 'Cabinet Side', 'box', [-2.25, (top + 0.5) / 2, pz + 0.12], [0.5, top + 0.5, 0.9], body, { parentId, solid: true }),
		mesh('rd-cab-cheek-e', 'Cabinet Side', 'box', [2.25, (top + 0.5) / 2, pz + 0.12], [0.5, top + 0.5, 0.9], body, { parentId, solid: true }),
		mesh('rd-cab-marquee', 'Marquee', 'box', [0, top + 0.5, pz + 0.12], [5, 0.95, 0.9], body, { parentId, solid: true }),
		mesh('rd-cab-base', 'Cabinet Base', 'box', [0, bottom / 2 - 0.1, pz + 0.12], [5, bottom + 0.2, 0.9], body, { parentId, solid: true }),
		// Neon on the edges of the cheeks.
		mesh('rd-cab-neon-w', 'Neon', 'box', [-1.97, (top + 0.5) / 2, pz - 0.34], [0.05, top + 0.4, 0.05], '#22d3ee', { parentId, unlit: true }),
		mesh('rd-cab-neon-e', 'Neon', 'box', [1.97, (top + 0.5) / 2, pz - 0.34], [0.05, top + 0.4, 0.05], '#e879f9', { parentId, unlit: true }),
		mesh('rd-cab-neon-t', 'Neon', 'box', [0, top + 0.07, pz - 0.34], [3.95, 0.05, 0.05], '#fbbf24', { parentId, unlit: true }),
		mesh('rd-cab-neon-b', 'Neon', 'box', [0, bottom - 0.07, pz - 0.34], [3.95, 0.05, 0.05], '#fbbf24', { parentId, unlit: true }),
		sign('rd-cab-sign', 'Marquee Sign', [0, top + 0.5, pz - 0.35], [4.4, 0.7], 0, 'ROUNDS VR', ['SHOOT  ·  BLOCK  ·  PICK A CARD'], { color: '#14082e', scale: 1.15, verticalAlign: 'middle', parentId }),
		// The control deck: tilted toward the player, with a stick and buttons.
		mesh('rd-cab-deck', 'Control Deck', 'box', [0, bottom - 0.12, pz - 0.38], [3.7, 0.12, 0.55], '#1b0f38', { parentId, rotation: [Math.sin(0.12), 0, 0, Math.cos(0.12)] }),
		mesh('rd-cab-stick', 'Stick', 'cylinder', [-1.2, bottom - 0.02, pz - 0.4], [0.05, 0.22, 0.05], '#d1d5db', { parentId }),
		mesh('rd-cab-ball', 'Stick Ball', 'sphere', [-1.2, bottom + 0.13, pz - 0.4], [0.16, 0.16, 0.16], '#ef4444', { parentId })
	];
	['#ef4444', '#fbbf24', '#22c55e', '#38bdf8', '#e879f9', '#ffffff'].forEach((color, n) => {
		slots.push(mesh(`rd-cab-button-${n}`, 'Button', 'cylinder', [-0.35 + n * 0.32, bottom - 0.04, pz - 0.42], [0.17, 0.05, 0.17], color, { parentId, unlit: true }));
	});
	return slots;
}

/** The two blobs of the game, as statues on pedestals either side of the cabinet, turned toward the arrival ring. Their eyes follow the player. */
function buildStatues(): Slot[] {
	const parentId = ID.lobby;
	const slots: Slot[] = [];
	TEAM.forEach((team, side) => {
		const name = team.name.toLowerCase();
		const x = side === 0 ? -LOBBY.statues.x : LOBBY.statues.x, z = LOBBY.statues.z, top = LOBBY.statues.top;
		// In the model the front is +z; the statue is turned half way round, so what is in front of it is toward the arrival ring.
		const at = (dx: number, y: number, dz: number): Vec3 => [x - dx, top + y, z - dz];
		slots.push(
			model(`rd-statue-${side}-base`, 'Pedestal', `pedestal-${name}`, [x, 0, z], { parentId, solid: true }),
			model(`rd-statue-${side}-body`, 'Blob', `blob-${name}`, [x, top, z], { parentId, rotation: yawQuat(Math.PI) }),
			mesh(`rd-statue-${side}-eye-l`, 'Eye', 'sphere', at(-0.17, 0.95, 0.44), [0.2, 0.26, 0.1], '#ffffff', { parentId, unlit: true }),
			mesh(`rd-statue-${side}-eye-r`, 'Eye', 'sphere', at(0.17, 0.95, 0.44), [0.2, 0.26, 0.1], '#ffffff', { parentId, unlit: true }),
			mesh(`rd-statue-${side}-pupil-l`, 'Pupil', 'sphere', at(-0.17, 0.95, 0.49), [0.09, 0.12, 0.05], '#0b1020', { parentId, unlit: true }),
			mesh(`rd-statue-${side}-pupil-r`, 'Pupil', 'sphere', at(0.17, 0.95, 0.49), [0.09, 0.12, 0.05], '#0b1020', { parentId, unlit: true }),
			mesh(`rd-statue-${side}-mouth`, 'Mouth', 'box', at(0, 0.65, 0.5), [0.2, 0.035, 0.05], '#0b1020', { parentId, unlit: true }),
			model(`rd-statue-${side}-gun`, 'Blob Gun', `pistol-${name}`, at(0.45, 0.62, 0.38), { parentId, rotation: yawQuat(Math.PI), scale: 1.7 })
		);
	});
	return slots;
}

/** Posters of cards on the back wall, a trophy shelf, bean bags, plants and crates: the room is lived in. */
function buildProps(): Slot[] {
	const parentId = ID.lobby;
	const slots: Slot[] = [];
	// Card posters: three real cards of the game, framed.
	const picks = ['phoenix', 'bouncy', 'teleport'].map((id) => CARDS.find((card) => card.id === id)!);
	picks.forEach((card, n) => {
		const x = -5.6 + n * 1.35, z = LOBBY_SIZE.maxZ - 0.02;
		slots.push(
			mesh(`rd-poster-${n}-frame`, 'Poster Frame', 'box', [x, 3.3, z - 0.02], [1.04, 1.44, 0.06], '#3a2412', { parentId, material: wood }),
			sign(`rd-poster-${n}`, 'Card Poster', [x, 3.3, z - 0.07], [0.92, 1.32], 0, card.name, [card.text], { color: RARITY_BG[card.rarity], scale: 0.6, parentId })
		);
	});
	slots.push(sign('rd-wall-banner', 'Wall Banner', [0.2, 4.7, LOBBY_SIZE.maxZ - 0.05], [8, 0.55], 0, 'FIRST TO 2 POINTS WINS THE ROUND', [], { color: '#14082e', scale: 1.6, verticalAlign: 'middle', parentId }));
	// A trophy shelf on the back wall, to the right.
	slots.push(mesh('rd-shelf', 'Shelf', 'box', [5, 2.9, LOBBY_SIZE.maxZ - 0.3], [2.6, 0.08, 0.5], '#5a3b24', { parentId, material: wood }));
	[4.2, 5, 5.8].forEach((x, n) => {
		slots.push(model(`rd-trophy-${n}`, 'Trophy', 'trophy', [x, 2.94, LOBBY_SIZE.maxZ - 0.3], { parentId, scale: 0.9 - n * 0.1 }));
	});
	// Bean bags and crates, plants in the corners.
	slots.push(
		model('rd-bag-0', 'Bean Bag', 'beanbag-violet', [-5.2, 0.4, 36.4], { parentId, rotation: yawQuat(0.5) }),
		model('rd-bag-1', 'Bean Bag', 'beanbag-pink', [-5.5, 0.36, 38.1], { parentId, rotation: yawQuat(-0.4), scale: 0.9 }),
		model('rd-crate-0', 'Crate', 'crate', [5.9, 0.4, 40.6], { parentId, solid: true }),
		model('rd-crate-1', 'Crate', 'crate', [5.9, 1.17, 40.6], { parentId, solid: true, scale: 0.86, rotation: yawQuat(0.3) }),
		model('rd-crate-2', 'Crate', 'crate', [5.0, 0.34, 41.1], { parentId, solid: true, scale: 0.85, rotation: yawQuat(-0.2) })
	);
	for (const x of [-6.3, 6.3]) {
		slots.push(model(`rd-plant-${x}`, 'Plant', 'plant', [x, 0, 33.5], { parentId, scale: 1.7, rotation: yawQuat(x * 0.3) }));
	}
	return slots;
}

/** The how-to-play board on the west wall, as a panel of its own: numbered rows with the controls of the device the player holds. */
function buildHowTo(): Slot[] {
	const parentId = ID.lobby;
	const panel = ID.ui('howto');
	const rows: [string, string][] = [
		['1', 'Shoot with the gun hand: {use}'],
		['2', 'Block with the shield hand: {use}'],
		['3', 'A button: jump. Jump again at a wall to climb it'],
		['4', 'Two hits kill. Two points win a round'],
		['5', 'The loser shoots one of three cards'],
		['6', 'Radial menu: reload, block, quit match']
	];
	return [
		createSlot({ id: panel, parentId, name: 'How To Play', position: [-LOBBY_SIZE.halfX + 0.06, 2.6, 37.6], rotation: yawQuat(-Math.PI / 2), components: [{ type: 'uiPanel', width: 1000, height: 760, worldWidth: 2.9, background: UI.panel }] }),
		element(ID.ui('howto-title'), panel, 'text', { text: 'HOW TO PLAY', height: 88, fontSize: 64, fontWeight: 'bold', textAlign: 'center', color: UI.title }),
		...rows.flatMap(([number, text], n) => [
			element(ID.ui(`howto-row-${n}`), panel, 'container', { width: 880, height: 82, flexDirection: 'row', gap: 20, margin: 5, background: UI.card, cornerRadius: 22, padding: 9 }),
			element(ID.ui(`howto-n-${n}`), ID.ui(`howto-row-${n}`), 'container', { width: 60, height: 60, background: UI.chosen, cornerRadius: 32, padding: 4 }),
			element(ID.ui(`howto-nt-${n}`), ID.ui(`howto-n-${n}`), 'text', { text: number, width: 52, height: 52, fontSize: 34, fontWeight: 'bold', textAlign: 'center', color: UI.chosenText }),
			element(ID.ui(`howto-t-${n}`), ID.ui(`howto-row-${n}`), 'text', { text, width: 740, height: 60, fontSize: 31, color: '#e9e5ff' })
		])
	];
}

/**
 * The lobby and its menu: a room of its own, far from the arena along z: an arcade cabinet whose screen is the menu, with
 * the gear, the board of how to play, posters and statues. The menu is a panel whose elements hang below the director, so that a
 * press reaches its script; the gear is given to whoever presses START.
 */
export function buildLobby(): Slot[] {
	const panel = ID.ui('panel');
	const row = (name: string, title: string, labels: string[], width: number) => [
		element(ID.ui(`${name}-label`), panel, 'text', { text: title, height: 34, fontSize: 24, fontWeight: 'bold', textAlign: 'center', color: UI.muted }),
		element(ID.ui(`${name}-row`), panel, 'container', { width: 1120, height: 84, flexDirection: 'row', gap: 14, margin: 3 }),
		...labels.map((text, n) => element(ID.ui(`${name}-${n}`), ID.ui(`${name}-row`), 'button', { width, height: 76, text, fontSize: 30, fontWeight: 'bold', textAlign: 'center', cornerRadius: 22, background: UI.chip, color: UI.chipText }))
	];
	// One card for each side: who plays it, and what they are.
	const sideCard = (side: number, role: string, name: string, extra: Slot[]) => {
		const team = TEAM[side], card = ID.ui(`card-${side}`);
		return [
			element(card, ID.ui('cards'), 'container', { width: 556, height: 236, flexDirection: 'column', padding: 14, gap: 2, background: side === 0 ? '#0c2a46' : '#46200a', cornerRadius: 28, borderColor: team.color, borderWidth: 4 }),
			element(ID.ui(`team-${side}`), card, 'text', { text: team.name, height: 32, fontSize: 26, fontWeight: 'bold', textAlign: 'left', color: team.color }),
			element(ID.ui(`p${side}`), card, 'text', { text: name, height: 60, fontSize: 46, fontWeight: 'bold', textAlign: 'left', color: '#ffffff' }),
			element(ID.ui(`p${side}-role`), card, 'text', { text: role, height: 36, fontSize: 25, textAlign: 'left', color: side === 0 ? '#7dd3fc' : '#fdba74' }),
			...extra
		];
	};
	const slots: Slot[] = [
		createSlot({ id: ID.lobby, parentId: ID.director, name: 'Lobby', components: [{ type: 'container' }] }),
		...buildShell(),
		...buildCabinet(),
		...buildStatues(),
		...buildProps(),
		...buildHowTo(),
		// The menu.
		createSlot({ id: panel, parentId: ID.lobby, name: 'Menu', position: LOBBY.panel.p, components: [{ type: 'uiPanel', width: LOBBY.panel.width, height: LOBBY.panel.height, worldWidth: LOBBY.panel.worldWidth, background: UI.panel }] }),
		element(ID.ui('title'), panel, 'text', { text: 'ROUNDS VR', height: 84, fontSize: 72, fontWeight: 'bold', textAlign: 'center', color: UI.title }),
		element(ID.ui('tagline'), panel, 'text', { text: 'A duel in 3D. Shoot, block, and take a card after every round.', height: 38, fontSize: 26, textAlign: 'center', color: '#a78bfa' }),
		element(ID.ui('who-label'), panel, 'text', { text: 'WHO PLAYS', height: 40, fontSize: 24, fontWeight: 'bold', textAlign: 'center', color: UI.muted, margin: 6 }),
		element(ID.ui('cards'), panel, 'container', { width: 1128, height: 240, flexDirection: 'row', gap: 16 }),
		...sideCard(0, 'YOU · HOST', 'Player', []),
		...sideCard(1, 'LEVEL: NORMAL', 'RIVAL BOT', [
			element(ID.ui('invite'), ID.ui('card-1'), 'button', { width: 520, height: 52, margin: 4, text: '+  INVITE A FRIEND', fontSize: 27, fontWeight: 'bold', textAlign: 'center', cornerRadius: 18, background: UI.invite, color: '#f0fdff' })
		]),
		...row('rival', 'RIVAL LEVEL', MENU.rivals, 360),
		...row('match', 'MATCH', MENU.lengths, 546),
		element(ID.ui('start'), panel, 'button', { width: 1120, height: 104, margin: 10, text: 'START', fontSize: 54, fontWeight: 'bold', textAlign: 'center', cornerRadius: 28, background: UI.go, color: UI.goText }),
		element(ID.ui('status'), panel, 'text', { text: 'Your gear is given when you press START', height: 46, fontSize: 28, textAlign: 'center', color: '#e9e5ff' }),
		createSlot({ id: 'rd-sign-light', parentId: ID.lobby, name: 'Cabinet Light', position: [0, 3, 38], components: [{ type: 'pointLight', color: '#a78bfa', intensity: 0.9, range: 9, baked: true }] })
	];
	const baked = bakedVolume('lobby');
	if (baked) slots.push(createSlot({ id: 'rd-lobby-lighting', parentId: ID.lobby, name: 'Lobby Lighting', components: [{ type: 'lightVolume', data: { kind: 'asset', assetId: baked }, intensity: 0.8 }] }));
	return slots;
}
