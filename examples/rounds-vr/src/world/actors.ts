import type { Slot } from '@kithin/engine/ecs/types';
import { createSlot } from '@kithin/engine/ecs/types';
import { BAR, POOLS, SCALE, TEAM, WAITING, type Vec3 } from './data.ts';
import { ID, PARKED, mesh, pitchQuat } from './kit.ts';
import { model } from './models.ts';
import { brainScript } from './script.ts';

/**
 * Where the bars on a gun and a shield sit and how long they are. The script moves them every frame (`setLocalPose`), so it gets
 * these numbers as data: a bar is a box centred on `x`, scaled in length to the fraction it shows and shifted to stay on its left end.
 */
export { BAR };

/** How a gun sits in the hand: tipped down a little, as a wrist holds it, with the middle of the handle at the hand. */
const HANDLE: Vec3 = [0, -0.05, -0.02];
const TILT_DEGREES = 15;
const HELD = (() => {
	const a = (TILT_DEGREES * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
	const round = (n: number) => Math.round(n * 10000) / 10000;
	return { position: [0, round(-(HANDLE[1] * c - HANDLE[2] * s)), round(-(HANDLE[1] * s + HANDLE[2] * c))] as Vec3, rotation: [TILT_DEGREES, 0, 0] as Vec3 };
})();

/** The two guns, one per side, out of the way until START gives them. Bars on top show health, magazine and reload; a small screen says it in words. */
export function buildGuns(): Slot[] {
	return TEAM.flatMap((team, side) => {
		const root = ID.gun(side);
		const part = (key: string, name: string, position: Vec3, scale: Vec3, color: string, options: { solid?: boolean; unlit?: boolean } = {}) =>
			mesh(ID.gunPart(side, key), name, 'box', position, scale, color, { parentId: root, ...options });
		const bar = (key: string, name: string, z: number, color: string) =>
			part(key, name, [0, BAR.gun.y, z], [BAR.gun.width, BAR.gun.height, BAR.gun.depth], color, { unlit: true });
		return [
			createSlot({
				id: root,
				name: `${team.name} Gun`,
				position: WAITING[side],
				components: [
					{ type: 'container' },
					{ type: 'grabbable', scalable: false, autoGrip: true },
					{ type: 'equippable', left: HELD, right: HELD, autoGrip: true }
				]
			}),
			model(ID.gunPart(side, 'model'), 'Pistol', `pistol-${team.name.toLowerCase()}`, [0, 0, 0], { parentId: root, solid: true }),
			createSlot({ id: ID.gunPart(side, 'muzzle'), parentId: root, name: 'Muzzle', position: [0, 0.034, 0.225] }),
			part('bar-bg', 'Bars', [0, BAR.gun.y - 0.004, 0.075], [BAR.gun.width + 0.006, 0.004, 0.092], '#0c0a09', { unlit: true }),
			bar('hp', 'Health Bar', BAR.gun.hpZ, '#4ade80'),
			bar('ammo', 'Magazine Bar', BAR.gun.ammoZ, '#facc15'),
			bar('reload', 'Reload Bar', BAR.gun.reloadZ, '#60a5fa'),
			createSlot({ id: ID.gunPart(side, 'brain'), parentId: root, name: 'Gun Brain', components: [{ type: 'scriptState', data: {} }, { type: 'codeBlock', code: brainScript('gun', side, ID.gunPart(side, 'brain'), ID.commands) }] })
		];
	});
}

/** The two shields: a disc held in the other hand. The trigger raises it; a bar shows how recharged it is. */
export function buildShields(): Slot[] {
	return TEAM.flatMap((team, side) => {
		const root = ID.shield(side);
		const held = { position: [0, 0, 0.06] as Vec3, rotation: [0, 0, 0] as Vec3 };
		return [
			createSlot({
				id: root,
				name: `${team.name} Shield`,
				position: WAITING[side],
				components: [
					{ type: 'container' },
					{ type: 'grabbable', scalable: false, autoGrip: true },
					{ type: 'equippable', left: held, right: held, autoGrip: true }
				]
			}),
			model(ID.shieldPart(side, 'model'), 'Shield', `shield-${team.name.toLowerCase()}`, [0, 0, 0], { parentId: root, solid: true }),
			mesh(ID.shieldPart(side, 'bar-bg'), 'Bar Background', 'box', [0, BAR.shield.y, BAR.shield.z], [BAR.shield.width + 0.012, BAR.shield.height + 0.008, BAR.shield.depth], '#0c0a09', { parentId: root, unlit: true }),
			mesh(ID.shieldPart(side, 'bar'), 'Recharge Bar', 'box', [0, BAR.shield.y, BAR.shield.z], [BAR.shield.width, BAR.shield.height, BAR.shield.depth + 0.004], '#22d3ee', { parentId: root, unlit: true }),
			createSlot({ id: ID.shieldPart(side, 'brain'), parentId: root, name: 'Shield Brain', components: [{ type: 'scriptState', data: {} }, { type: 'codeBlock', code: brainScript('shield', side, ID.shieldPart(side, 'brain'), ID.commands) }] })
		];
	});
}

/** A health bar that floats over each fighter's head. */
export function buildTags(): Slot[] {
	return TEAM.flatMap((team, side) => [
		createSlot({ id: ID.tag(side), name: `${team.name} Health`, position: PARKED, components: [{ type: 'container' }] }),
		mesh(ID.tagPart(side, 'bg'), 'Health Background', 'box', [0, 0, 0], [0.72, 0.1, 0.03], '#0b1020', { parentId: ID.tag(side), unlit: true }),
		mesh(ID.tagPart(side, 'fg'), 'Health', 'box', [0, 0, 0], [0.68, 0.07, 0.05], team.color, { parentId: ID.tag(side), unlit: true })
	]);
}

/** What a player sees while they are down: a red veil in front of the eyes. */
export function buildVeils(): Slot[] {
	return TEAM.flatMap((_, side) => {
		const id = ID.veil(side);
		return [
			createSlot({ id, name: 'Defeat Veil', position: PARKED, components: [{ type: 'container' }] }),
			mesh(`${id}-veil`, 'Veil', 'plane', [0, 0, 0], [3.4, 2.4, 1], '#7f0d0d', { parentId: id, unlit: true, opacity: 0.6 }),
			createSlot({
				id: `${id}-text`,
				parentId: id,
				name: 'Defeat Banner',
				position: [0, 0, -0.01],
				scale: [0.9, 0.24, 1],
				components: [
					{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#0c0a09' },
					{ type: 'textDisplay', title: 'DOWN', lines: [''], color: '#0c0a09', scale: 1.6, verticalAlign: 'middle' }
				]
			})
		];
	});
}

/** The bubble that shows a raised shield. */
export function buildBubbles(): Slot[] {
	return TEAM.map((team, side) => mesh(ID.bubble(side), `${team.name} Shield Bubble`, 'sphere', PARKED, [1.9, 1.9, 1.9], team.color, { unlit: true, opacity: 0.3 }));
}

/** The rival: a round blob with eyes and a gun, as in the game. One body for each side, because either side can be played by the script. */
export function buildBots(): Slot[] {
	// The blob model is 1.24 wide and 1.42 tall with its origin at the feet: scaled by the game's scale, its middle goes to the middle of the body.
	const k = SCALE, lift = 0.69 * k;
	return TEAM.flatMap((team, side) => {
		const root = ID.bot(side);
		const vis = ID.botPart(side, 'vis');
		const aim = ID.botPart(side, 'aim');
		const part = (key: string, name: string, shape: 'sphere' | 'box', position: Vec3, scale: Vec3, color: string, parentId: string, unlit = false) =>
			mesh(ID.botPart(side, key), name, shape, position, scale, color, { parentId, unlit });
		return [
			createSlot({ id: root, name: `${team.name} Rival`, position: PARKED, components: [{ type: 'container' }] }),
			createSlot({ id: vis, parentId: root, name: 'Body', position: [0, -lift, 0], scale: [k, k, k], components: [{ type: 'container' }] }),
			model(ID.botPart(side, 'body'), 'Body', `blob-${team.name.toLowerCase()}`, [0, 0, 0], { parentId: vis }),
			part('eye-l', 'Eye', 'sphere', [-0.17, 0.95, 0.44], [0.2, 0.26, 0.1], '#ffffff', vis, true),
			part('eye-r', 'Eye', 'sphere', [0.17, 0.95, 0.44], [0.2, 0.26, 0.1], '#ffffff', vis, true),
			part('pupil-l', 'Pupil', 'sphere', [-0.17, 0.95, 0.49], [0.09, 0.12, 0.05], '#0b1020', vis, true),
			part('pupil-r', 'Pupil', 'sphere', [0.17, 0.95, 0.49], [0.09, 0.12, 0.05], '#0b1020', vis, true),
			part('mouth', 'Mouth', 'box', [0, 0.65, 0.5], [0.2, 0.035, 0.05], '#0b1020', vis, true),
			createSlot({ id: aim, parentId: root, name: 'Aim', position: [0, 0, 0], components: [{ type: 'container' }] }),
			model(ID.botPart(side, 'gun'), 'Gun', `pistol-${team.name.toLowerCase()}`, [0, -0.04, 0.32], { parentId: aim, scale: 1.1 })
		];
	});
}

/** The bullets: bright streaks (a sphere the script stretches along the way it flies), half of them for each side so that every shot is the colour of who fired it. */
export function buildBullets(): Slot[] {
	const slots: Slot[] = [];
	for (let n = 0; n < POOLS.bullets * 2; n++) {
		const side = n < POOLS.bullets ? 0 : 1;
		slots.push(mesh(ID.bullet(n), 'Bullet', 'sphere', PARKED, [0.2, 0.2, 0.2], TEAM[side].color, { unlit: true }));
	}
	return slots;
}

/**
 * The words that appear in front of a player for a moment (3, 2, 1, FIGHT, who scored…), one for each side: the director puts it
 * where the player looks when it has something to say and parks it again.
 */
export function buildBanners(): Slot[] {
	return TEAM.map((team, side) =>
		createSlot({
			id: ID.banner(side),
			name: `${team.name} Banner`,
			position: PARKED,
			scale: [1.9, 0.62, 1],
			components: [
				{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#0b1020', opacity: 0.82, unlit: true },
				{ type: 'textDisplay', title: '', lines: [''], color: '#0b1020', scale: 1.7, verticalAlign: 'middle' }
			]
		})
	);
}

/** A red flash over the eyes for a moment when a player is hit. */
export function buildFlashes(): Slot[] {
	return TEAM.map((team, side) => mesh(ID.flash(side), `${team.name} Hit Flash`, 'plane', PARKED, [3, 2.2, 1], '#ef4444', { unlit: true, opacity: 0.35 }));
}
