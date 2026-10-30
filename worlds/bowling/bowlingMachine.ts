import type { Component, Slot } from '@kithin/engine/ecs/types';
import { createSlot } from '@kithin/engine/ecs/types';
import { asset } from './assets.ts';
import { HALL, CUSTOM_BALL_COUNT, MACHINE, customBallHome, customBallId } from './bowlingLayout.ts';
import { alignY, box, cylinder, group, makeSlot, sign, ui, yaw, type Vec3 } from './bowlingParts.ts';

/** What a ball can be made of: a picture drawn for a ball (assets/balls, see tools/makeBallMaterials.py), and the colour its button shows. */
export interface BallMaterial {
	id: string;
	name: string;
	chip: string;
	/** The default finish for it: 0 glossy, 1 satin, 2 metallic. */
	finish: number;
}

export const BALL_MATERIALS: BallMaterial[] = [
	{ id: 'midnight', name: 'Midnight', chip: '#1e3a8a', finish: 0 },
	{ id: 'lava', name: 'Lava', chip: '#c2410c', finish: 0 },
	{ id: 'ocean', name: 'Ocean', chip: '#0e7490', finish: 0 },
	{ id: 'galaxy', name: 'Galaxy', chip: '#6d28d9', finish: 0 },
	{ id: 'candy', name: 'Candy', chip: '#db2777', finish: 0 },
	{ id: 'emerald', name: 'Emerald', chip: '#059669', finish: 0 },
	{ id: 'gold', name: 'Gold', chip: '#ca8a04', finish: 2 },
	{ id: 'carbon', name: 'Carbon', chip: '#3f3f46', finish: 1 },
	{ id: 'neon', name: 'Neon Grid', chip: '#0891b2', finish: 1 },
	{ id: 'pearl', name: 'Pearl', chip: '#94a3b8', finish: 0 },
	{ id: 'camo', name: 'Camo', chip: '#4d7c0f', finish: 1 },
	{ id: 'checker', name: 'Checker', chip: '#71717a', finish: 1 }
];

/** How shiny it is: roughness and metallic (a map-less material takes them as they are). */
export const BALL_FINISHES = [
	{ name: 'Glossy', roughness: 0.12, metallic: 0 },
	{ name: 'Satin', roughness: 0.5, metallic: 0 },
	{ name: 'Metallic', roughness: 0.22, metallic: 1 }
] as const;

export const materialButtonId = (i: number) => `bw-mach-mat-${i}`;
export const MACHINE_BUTTONS = { finish: 'bw-mach-finish', make: 'bw-mach-make', name: 'bw-mach-name' } as const;

/** The `material` of a ball made of material `i` with finish `f`: the same component the script gives the finished ball. */
export function ballMaterial(i: number, f: number): Component {
	const material = BALL_MATERIALS[i];
	const finish = BALL_FINISHES[f];
	return { type: 'material', albedo: { kind: 'asset', assetId: asset(`balls/${material.id}.webp` as never) }, mapping: 'mesh', tiling: 1, roughness: finish.roughness, metallic: finish.metallic };
}

/**
 * The three holes of a ball (in the ball's own units, a sphere of radius 0.5): two for the fingers side by side and the thumb's further down, as dark
 * discs lying on the surface (a sphere cannot be drilled, but a dark disc flush with it reads as a hole, and nothing sticks out).
 */
function holes(parentId: string, id: string): Slot[] {
	// Where they are, as directions from the centre: the fingers about 21 degrees from the top towards the front, the thumb 47 degrees further.
	const spots: [Vec3, number][] = [[[-0.1, 0.93, 0.36], 0.11], [[0.1, 0.93, 0.36], 0.11], [[0, 0.37, 0.93], 0.125]];
	return spots.flatMap(([d, size], k) => {
		const length = Math.hypot(...d);
		const at = (radius: number) => d.map((c) => (c / length) * radius) as Vec3;
		const rotation = alignY(d);
		return [
			cylinder(`${id}-hole-${k}`, 'Finger Hole', at(0.5005), size, 0.004, '#17171d', { parentId, rotation }),
			cylinder(`${id}-hole-${k}-deep`, 'Finger Hole Depth', at(0.5015), size * 0.72, 0.004, '#020204', { parentId, rotation })
		];
	});
}

/** A ball the machine can hand out: a plain sphere with a material, hidden until it is made. */
function customBall(k: number): Slot[] {
	const id = customBallId(k);
	return [
		makeSlot({
			id,
			name: 'Custom Ball',
			position: customBallHome(k),
			scale: [0.216, 0.216, 0.216],
			disabled: true,
			components: [
				{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' }, color: '#ffffff' },
				ballMaterial(0, 0),
				{ type: 'collider', shape: 'sphere' },
				{ type: 'grabbable', scalable: false, autoGrip: true }
			]
		}),
		...holes(id, id)
	];
}

const BUTTON = { fontSize: 20, fontWeight: 'bold', textAlign: 'center', cornerRadius: 14, width: 138, height: 52 } as const;
const WIDE = { fontSize: 24, fontWeight: 'bold', textAlign: 'center', cornerRadius: 16, width: 288, height: 62 } as const;

/** The ball machine: body, window, panel with a button for every material, finish and make-it buttons, and the tray. `script` runs the panel. */
export function buildMachine(script: string): Slot[] {
	const { x, z } = MACHINE;
	const root = MACHINE.panelId;
	const face = HALL.maxX - 0.9;
	const row = (n: number) => `${root}-row-${n}`;
	const slots: Slot[] = [
		group('bw-mach', 'Ball Machine', [0, 0, 0]),
		// The body, with a window in it (x 9.1 to 9.7, height 1.2 to 1.9, along z from -3.9 to -3.2): the parts round the opening.
		box('bw-mach-lower', 'Machine Lower', [x, 0.6, z], [0.8, 1.2, 1.7], '#1a1530', { parentId: 'bw-mach', solid: true }),
		box('bw-mach-upper', 'Machine Upper', [x, 2.0, z], [0.8, 0.2, 1.7], '#1a1530', { parentId: 'bw-mach', solid: true }),
		box('bw-mach-back', 'Window Back', [x + 0.3, 1.55, z], [0.2, 0.7, 1.7], '#0b0a1a', { parentId: 'bw-mach', solid: true }),
		box('bw-mach-pillar-a', 'Window Pillar', [x, 1.55, -3.975], [0.8, 0.7, 0.15], '#1a1530', { parentId: 'bw-mach', solid: true }),
		box('bw-mach-pillar-b', 'Window Pillar', [x, 1.55, -2.775], [0.8, 0.7, 0.85], '#1a1530', { parentId: 'bw-mach', solid: true }),
		box('bw-mach-trim-a', 'Machine Trim', [face - 0.005, 0.12, z], [0.02, 0.04, 1.7], '#25e6ff', { parentId: 'bw-mach', unlit: true }),
		box('bw-mach-trim-b', 'Machine Trim', [face - 0.005, 2.02, z], [0.02, 0.04, 1.7], '#ff2fb3', { parentId: 'bw-mach', unlit: true }),
		sign('bw-mach-sign', 'Machine Sign', [face - 0.01, 1.88, z], [1.5, 0.3], { title: 'BALL WORKS', titleColor: '#25e6ff', lines: [], background: '#08051a' }, { parentId: 'bw-mach', rotation: yaw(Math.PI / 2) }),
		// The window: a dark back, the ball on show, glass in front.
		box('bw-mach-glass', 'Window Glass', [face, 1.55, MACHINE.preview[2]], [0.02, 0.7, 0.7], '#a5d8ff', { parentId: 'bw-mach', opacity: 0.16 }),
		box('bw-mach-glow', 'Window Glow', [x - 0.15, 1.21, MACHINE.preview[2]], [0.5, 0.02, 0.66], '#25e6ff', { parentId: 'bw-mach', unlit: true }),
		// The ball on show turns slowly (the script), made of what is picked.
		createSlot({
			id: MACHINE.previewId,
			parentId: 'bw-mach',
			name: 'Ball On Show',
			position: [...MACHINE.preview] as Vec3,
			scale: [0.3, 0.3, 0.3],
			components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' }, color: '#ffffff' }, ballMaterial(0, 0)]
		}),
		...holes('bw-mach-preview', 'bw-mach-preview'),
		// The tray: balls come out on it, under a hood.
		box('bw-mach-tray', 'Machine Tray', [MACHINE.trayX, 0.9, -2.75], [0.45, 0.05, 0.8], '#8d96a3', { parentId: 'bw-mach', solid: true }),
		box('bw-mach-lip', 'Tray Lip', [MACHINE.trayX - 0.22, 0.95, -2.75], [0.03, 0.1, 0.8], '#d4d8de', { parentId: 'bw-mach' }),
		box('bw-mach-hood', 'Tray Hood', [MACHINE.trayX + 0.02, 1.4, -2.75], [0.5, 0.05, 0.84], '#1a1530', { parentId: 'bw-mach' }),
		box('bw-mach-hood-glow', 'Tray Glow', [MACHINE.trayX, 1.36, -2.75], [0.42, 0.02, 0.76], '#ffb347', { parentId: 'bw-mach', unlit: true }),
		// The panel: the name of what is picked, a button for each material, the finish and the button that makes the ball.
		createSlot({
			id: root,
			parentId: 'bw-mach',
			name: 'Machine Panel',
			position: [...MACHINE.panel] as Vec3,
			rotation: yaw(Math.PI / 2),
			components: [{ type: 'uiPanel', width: 640, height: 500, worldWidth: 0.75, background: '#0a0b22' }, { type: 'codeBlock', code: script }]
		}),
		ui(MACHINE_BUTTONS.name, root, 'text', { text: 'Pick a material', width: 580, height: 48, fontSize: 32, fontWeight: 'bold', textAlign: 'center', color: '#facc15' })
	];
	for (let r = 0; r < 3; r++) {
		slots.push(ui(row(r), root, 'container', { width: 588, height: 56, flexDirection: 'row', gap: 10, margin: 3 }));
		for (let c = 0; c < 4; c++) {
			const i = r * 4 + c;
			slots.push(ui(materialButtonId(i), row(r), 'button', { ...BUTTON, text: BALL_MATERIALS[i].name, background: BALL_MATERIALS[i].chip }));
		}
	}
	slots.push(ui(row(3), root, 'container', { width: 588, height: 66, flexDirection: 'row', gap: 12, margin: 6 }));
	slots.push(ui(MACHINE_BUTTONS.finish, row(3), 'button', { ...WIDE, text: 'Finish: Glossy', background: '#1e293b' }));
	slots.push(ui(MACHINE_BUTTONS.make, row(3), 'button', { ...WIDE, text: 'MAKE BALL', background: '#16a34a' }));
	for (let k = 0; k < CUSTOM_BALL_COUNT; k++) slots.push(...customBall(k));
	return slots;
}
