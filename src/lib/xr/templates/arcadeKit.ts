import type { Quat, Slot } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';
import { box, ui } from './beatTurntableParts.ts';
import type { Vec3 } from './beatTurntableParts.ts';

export { box, cylinder, group, sphere, ui, uiPanel } from './beatTurntableParts.ts';
export type { Vec3 } from './beatTurntableParts.ts';

/**
 * The frame of one arcade machine. A machine is built in its own coordinates: x to the right of whoever plays it, y up, z away
 * from the player (so the players stand at negative z and panels, which are read from their -Z side, need no turning). The
 * frame turns those into world coordinates; the scripts get the same frame to turn them back.
 */
export interface Frame {
	/** Where the machine's origin is on the floor. */
	o: Vec3;
	/** The machine's x axis in the world. */
	r: Vec3;
	/** The machine's z axis in the world: the way the players face. */
	d: Vec3;
	yaw: number;
}

export function makeFrame(x: number, z: number, yaw: number): Frame {
	const round = (value: number) => Math.round(value * 1e9) / 1e9;
	return { o: [x, 0, z], r: [round(Math.cos(yaw)), 0, round(-Math.sin(yaw))], d: [round(Math.sin(yaw)), 0, round(Math.cos(yaw))], yaw };
}

export const toWorld = (f: Frame, l: Vec3): Vec3 => [f.o[0] + f.r[0] * l[0] + f.d[0] * l[2], f.o[1] + l[1], f.o[2] + f.r[2] * l[0] + f.d[2] * l[2]];
export const yawQuat = (yaw: number): Quat => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];

export const NEON = { pink: '#ff2d95', cyan: '#22d3ee', yellow: '#facc15', green: '#4ade80', violet: '#a78bfa', orange: '#fb923c' } as const;

const BTN = { one: '#16a34a', versus: '#7c3aed', join: '#2563eb', start: '#ca8a04', leave: '#475569' } as const;

/** Ids of the pieces every machine has, from its prefix `p`. */
export const machineIds = (p: string) => ({
	root: `${p}-root`,
	panel: `${p}-ui`,
	message: `${p}-msg`,
	board: `${p}-board`,
	top: `${p}-top`,
	one: `${p}-b1`,
	versus: `${p}-bvs`,
	join: `${p}-bjoin`,
	start: `${p}-bstart`,
	leave: `${p}-bleave`
});

export interface MachineShell {
	p: string;
	name: string;
	frame: Frame;
	color: string;
	tagline: string;
	/** Where the control panel and the two boards float, in machine coordinates. */
	panelAt: Vec3;
	boardAt: Vec3;
	topAt: Vec3;
	/** The script of the machine, run by the control panel. */
	code: string;
}

/**
 * What every machine shares: a root that places it in the room, a control panel (title, what is going on, 1 Player / Versus /
 * Join / Start / Leave), a board with the game in progress and a board with the best scores. The game's own parts are added
 * by the machine and parented to `root`.
 */
export function machineShell(shell: MachineShell): Slot[] {
	const id = machineIds(shell.p);
	const button = (buttonId: string, row: string, text: string, background: string, width: number) =>
		ui(buttonId, row, 'button', { width, height: 56, text, fontSize: 24, fontWeight: 'bold', textAlign: 'center', cornerRadius: 16, background });
	return [
		createSlot({ id: id.root, name: `${shell.name} Machine`, position: shell.frame.o, rotation: yawQuat(shell.frame.yaw), components: [{ type: 'container' }, { type: 'scriptState', data: {} }] }),
		createSlot({
			id: id.panel,
			parentId: id.root,
			name: `${shell.name} Panel`,
			position: shell.panelAt,
			components: [{ type: 'uiPanel', width: 620, height: 470, worldWidth: 0.9, background: '#0a0f22' }, { type: 'codeBlock', code: shell.code }]
		}),
		ui(`${shell.p}-title`, id.panel, 'text', { text: shell.name.toUpperCase(), height: 54, fontSize: 40, fontWeight: 'bold', textAlign: 'center', color: shell.color }),
		ui(`${shell.p}-tagline`, id.panel, 'text', { text: shell.tagline, height: 28, fontSize: 18, textAlign: 'center', color: '#64748b' }),
		ui(`${shell.p}-card`, id.panel, 'container', { width: 560, height: 150, margin: 8, padding: 8, flexDirection: 'column', background: '#0f1830', cornerRadius: 18, borderColor: '#2a3a78', borderWidth: 3 }),
		ui(id.message, `${shell.p}-card`, 'text', { text: 'Press 1 PLAYER to play alone, or VERSUS to play with friends.', height: 130, fontSize: 25, fontWeight: 'bold', textAlign: 'center', color: '#f4f4f5' }),
		ui(`${shell.p}-row1`, id.panel, 'container', { width: 560, height: 60, flexDirection: 'row', gap: 12 }),
		button(id.one, `${shell.p}-row1`, '1 PLAYER', BTN.one, 274),
		button(id.versus, `${shell.p}-row1`, 'VERSUS', BTN.versus, 274),
		ui(`${shell.p}-row2`, id.panel, 'container', { width: 560, height: 60, flexDirection: 'row', gap: 10, margin: 4 }),
		button(id.join, `${shell.p}-row2`, 'JOIN', BTN.join, 180),
		button(id.start, `${shell.p}-row2`, 'START', BTN.start, 180),
		button(id.leave, `${shell.p}-row2`, 'LEAVE', BTN.leave, 180),
		box(`${shell.p}-board-frame`, 'Board Frame', [shell.boardAt[0], shell.boardAt[1], shell.boardAt[2] + 0.03], [1.12, 0.74, 0.04], '#1e293b', { parentId: id.root }),
		createSlot({
			id: id.board,
			parentId: id.root,
			name: `${shell.name} Scores`,
			position: shell.boardAt,
			scale: [1.04, 0.66, 1],
			components: [
				{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#081029' },
				{ type: 'scoreboard', title: shell.name, status: 'Waiting for a player', columns: ['Score'], rows: [] }
			]
		}),
		box(`${shell.p}-top-frame`, 'Best Scores Frame', [shell.topAt[0], shell.topAt[1], shell.topAt[2] + 0.03], [0.82, 0.66, 0.04], '#1e293b', { parentId: id.root }),
		createSlot({
			id: id.top,
			parentId: id.root,
			name: `${shell.name} Best Scores`,
			position: shell.topAt,
			scale: [0.76, 0.6, 1],
			components: [
				{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#081029' },
				{ type: 'scoreboard', title: 'Best scores', status: '', columns: ['Score'], rows: [] }
			]
		})
	];
}

/** A neon sign: a coloured bar of light with the machine's name over it. */
export function neonSign(p: string, name: string, parentId: string, at: Vec3, width: number, color: string): Slot[] {
	return [
		createSlot({
			id: `${p}-sign`,
			parentId,
			name: `${name} Sign`,
			position: at,
			scale: [width, width * 0.22, 1],
			components: [
				{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#05060f' },
				{ type: 'textDisplay', title: name, lines: [], color: '#05060f', scale: 1.4, verticalAlign: 'middle' }
			]
		}),
		box(`${p}-sign-glow`, 'Sign Glow', [at[0], at[1] - width * 0.13, at[2]], [width, 0.04, 0.05], color, { parentId }),
		createSlot({ id: `${p}-light`, parentId, name: 'Machine Light', position: [at[0], at[1] - 0.3, at[2] - 0.8], components: [{ type: 'pointLight', color, intensity: 1.6, range: 5 }] })
	];
}

/**
 * Small script for anything a player can pick up: it remembers who last held it, in the slot's `scriptState`, so the machine can
 * credit a throw or a hit to the right player. Only the host (or a solo player) writes.
 */
export const HOLDER_SCRIPT = `
let last = '';
return {
	tick() {
		if (!ctx.world.isHost()) return;
		const held = ctx.grab.heldBy();
		if (!held.length) return;
		const id = ctx.world.getPlayer(held[0]).id;
		if (id === last) return;
		last = id;
		ctx.world.setComponentField(ctx.self.id, 'scriptState', 'data', { holder: id }, false);
	}
};`;

/** A thing a player can pick up, with the script that remembers its holder. `components` is its shape: a mesh and collider, or a container whose children are the parts. */
export function grabbable(id: string, name: string, position: Vec3, extra: Partial<Slot> = {}, components: Slot['components'] = []): Slot {
	return createSlot({
		id,
		name,
		position,
		...extra,
		components: [{ type: 'grabbable', scalable: false, autoGrip: true }, { type: 'scriptState', data: {} }, { type: 'codeBlock', code: HOLDER_SCRIPT }, ...components]
	});
}
