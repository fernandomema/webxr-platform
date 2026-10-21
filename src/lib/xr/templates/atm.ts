import type { Component, Quat, Slot, SlotTree, Vec3 } from '../../ecs/types.ts';
import { createSlot } from '../../ecs/types.ts';

export interface AtmOptions {
	id?: string;
	position?: Vec3;
	rotation?: Quat;
	/** Whether it can be picked up and moved (the Starter Kit's copy can; the lobby's stands where it is). */
	grabbable?: boolean;
}

/** Facing the spawn pad from the left of the lobby, mirroring the billboard on the right. The machine's front is its -Z side. */
export const LOBBY_ATM = { position: [-4.2, 0, 3.2] as Vec3, rotation: [0, -0.4439, 0, 0.8961] as Quat };

const STEEL = '#2a2f3a';
const DARK = '#0b0d14';
const BODY_W = 0.62;
const BODY_D = 0.45;
const FRONT = -(BODY_D / 2);

/**
 * A cash machine, about 1.7 m tall, standing on its own origin (the middle of its base). Pressing any part of it opens the
 * game's credits window: the machine carries an `atm` component and nothing else, since what the window shows and does is the
 * game's own and not part of the world.
 */
export function buildAtm({ id = 'atm', position = [0, 0, 0], rotation = [0, 0, 0, 1], grabbable = false }: AtmOptions = {}): SlotTree {
	const atm: Component = { type: 'atm' };
	const box = { kind: 'builtin', id: 'box' } as const;
	const plane = { kind: 'builtin', id: 'plane' } as const;
	let index = 0;
	const part = (name: string, mesh: typeof box | typeof plane | { kind: 'builtin'; id: 'sphere' }, color: string, at: Vec3, scale: Vec3, extra: Component[] = [], opts: { solid?: boolean; press?: boolean } = {}): Slot =>
		createSlot({
			id: `${id}-${index++}`,
			parentId: id,
			name,
			position: at,
			scale,
			components: [
				{ type: 'meshRenderer', meshRef: mesh, color },
				...(opts.solid === false ? [] : [{ type: 'collider', shape: 'box' } as Component]),
				...(opts.press === false ? [] : [atm]),
				...extra
			]
		});

	const keys: Slot[] = [];
	for (let row = 0; row < 4; row++) {
		for (let column = 0; column < 3; column++) {
			keys.push(part(`Key ${row * 3 + column + 1}`, box, '#9aa3b5', [(column - 1) * 0.08, 0.9 + (3 - row) * 0.045, FRONT - 0.026], [0.06, 0.03, 0.012], [], { solid: false }));
		}
	}

	return [
		createSlot({
			id,
			name: 'ATM',
			position,
			rotation,
			components: [{ type: 'container' }, ...(grabbable ? [{ type: 'grabbable', scalable: false } as Component] : [])]
		}),
		part('Body', box, STEEL, [0, 0.72, 0], [BODY_W, 1.44, BODY_D]),
		part('Hood', box, '#1c2030', [0, 1.55, 0.01], [BODY_W + 0.06, 0.2, BODY_D + 0.04]),
		part('Sign', plane, '#14131f', [0, 1.55, FRONT - 0.016], [0.5, 0.13, 1], [{ type: 'textDisplay', title: 'ATM', lines: [], color: '#ffcf7a', verticalAlign: 'middle' }]),
		part('Screen Bezel', box, DARK, [0, 1.25, FRONT - 0.01], [0.5, 0.34, 0.03]),
		part('Screen', plane, '#07110e', [0, 1.25, FRONT - 0.03], [0.44, 0.28, 1], [{ type: 'textDisplay', title: 'CREDITS', lines: ['Press to use'], color: '#8ff0cf', verticalAlign: 'middle' }], { solid: false }),
		part('Keypad', box, '#3b4252', [0, 0.97, FRONT - 0.012], [0.3, 0.22, 0.03]),
		...keys,
		part('Card Slot', box, DARK, [0, 0.8, FRONT - 0.012], [0.18, 0.03, 0.03]),
		part('Card Light', box, '#ffcf7a', [0, 0.8, FRONT - 0.03], [0.14, 0.008, 0.004], [], { solid: false }),
		part('Cash Tray', box, DARK, [0, 0.55, FRONT - 0.012], [0.4, 0.13, 0.03]),
		part('Glow', { kind: 'builtin', id: 'sphere' }, '#8ff0cf', [0, 1.25, FRONT - 0.2], [0.02, 0.02, 0.02], [{ type: 'pointLight', color: '#8ff0cf', intensity: 0.5, range: 3 }], { solid: false, press: false })
	];
}
