import type { Slot } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';
import { box, cylinder, sphere } from './beatTurntableParts.ts';
import { sign } from './archiveJukeboxDecor.ts';

/**
 * The look of the PolyHeaven materials world: a bright, plain shop room, so that a material shows as itself. Its walls and floor
 * are ordinary shapes, so the applicator can put a material on them; swatch shelves line the side walls and a few objects
 * stand around to try a material on. The signs credit Poly Haven.
 */

const ROOM = { halfWidth: 5, back: -2.5, front: 8.2, height: 3.4 } as const;
const WALL = '#cbd5e1';
const TRIM = '#64748b';
const ACCENT = '#38bdf8';

/** The colours of the swatch tiles: muted, like paint chips. */
const CHIPS = ['#b45309', '#a16207', '#65a30d', '#0f766e', '#0369a1', '#6d28d9', '#a21caf', '#be123c', '#57534e', '#78716c', '#a8a29e', '#d6d3d1'];

function buildShell(): Slot[] {
	const { halfWidth: w, back, front, height } = ROOM;
	const depth = front - back;
	const mid = (front + back) / 2;
	return [
		box('ph-wall-back', 'Back Wall', [0, height / 2, back], [w * 2, height, 0.2], WALL, {}, true),
		box('ph-wall-front', 'Front Wall', [0, height / 2, front], [w * 2, height, 0.2], WALL, {}, true),
		box('ph-wall-left', 'Left Wall', [-w, height / 2, mid], [0.2, height, depth], WALL, {}, true),
		box('ph-wall-right', 'Right Wall', [w, height / 2, mid], [0.2, height, depth], WALL, {}, true),
		box('ph-ceiling', 'Ceiling', [0, height + 0.05, mid], [w * 2 + 0.4, 0.1, depth + 0.4], '#f1f5f9'),
		// A skirting board and an accent stripe round the room.
		box('ph-skirt-front', 'Skirting', [0, 0.06, front - 0.12], [w * 2, 0.12, 0.04], TRIM),
		box('ph-skirt-back', 'Skirting', [0, 0.06, back + 0.12], [w * 2, 0.12, 0.04], TRIM),
		box('ph-skirt-left', 'Skirting', [-w + 0.12, 0.06, mid], [0.04, 0.12, depth], TRIM),
		box('ph-skirt-right', 'Skirting', [w - 0.12, 0.06, mid], [0.04, 0.12, depth], TRIM),
		box('ph-stripe-left', 'Stripe', [-w + 0.11, 1.1, mid], [0.02, 0.04, depth], ACCENT),
		box('ph-stripe-right', 'Stripe', [w - 0.11, 1.1, mid], [0.02, 0.04, depth], ACCENT),
		// Light panels in the ceiling, with a light under each: over the table, over the sample wall and over the plinths. Three, so that
		// with the sky's light a surface takes them all (a material takes four lights), and placed to rake across what is shown.
		...([[0, 3.2], [-2.6, 5.4], [2.6, 3.8]] as const).flatMap(([x, z], index) => [
			box(`ph-light-panel-${index}`, 'Light Panel', [x, height - 0.01, z], [1.6, 0.03, 0.6], '#ffffff'),
			createSlot({ id: `ph-light-${index}`, name: 'Ceiling Light', position: [x, height - 0.5, z], components: [{ type: 'pointLight', color: '#fff7ed', intensity: 0.9, range: 6 }] })
		])
	];
}

/** Shelves of swatch tiles on the two side walls: how a material shop looks, and something to look at while it loads. */
function buildSwatches(side: 'left' | 'right'): Slot[] {
	const x = side === 'left' ? -ROOM.halfWidth + 0.2 : ROOM.halfWidth - 0.2;
	const toRoom = side === 'left' ? 1 : -1;
	const slots: Slot[] = [];
	for (let row = 0; row < 3; row++) {
		const y = 1.5 + row * 0.5;
		slots.push(box(`ph-swatch-shelf-${side}-${row}`, 'Swatch Shelf', [x, y - 0.17, 5.4], [0.2, 0.03, 4.4], TRIM));
		for (let column = 0; column < 8; column++) {
			slots.push(box(`ph-swatch-${side}-${row}-${column}`, 'Swatch', [x + toRoom * 0.02, y, 3.4 + column * 0.5], [0.04, 0.3, 0.4], CHIPS[(row * 8 + column + (side === 'left' ? 0 : 5)) % CHIPS.length]));
		}
	}
	return slots;
}

/** Things to try a material on: a wall to the left, and three solids on plinths to the right. All of them take a material. */
function buildSamples(): Slot[] {
	const solid = (id: string, name: string, shape: 'box' | 'sphere' | 'cylinder', z: number): Slot => {
		const base = shape === 'box' ? box(id, name, [3.8, 1.1, z], [0.45, 0.45, 0.45], '#e2e8f0', {}, true) : shape === 'sphere' ? sphere(id, name, [3.8, 1.12, z], 0.5, '#e2e8f0') : cylinder(id, name, [3.8, 1.1, z], 0.45, 0.45, '#e2e8f0');
		return createSlot({
			...base,
			components: [...base.components, ...(base.components.some((c) => c.type === 'collider') ? [] : [{ type: 'collider' as const, shape: shape === 'sphere' ? 'sphere' as const : 'box' as const }]), { type: 'grabbable', scalable: true }]
		});
	};
	return [
		box('ph-sample-wall', 'Sample Wall', [-4.1, 1.2, 5.4], [0.15, 2.4, 2.8], '#e2e8f0', {}, true),
		...sign('ph-sample-wall-sign', 'Sample Wall Sign', [-3.9, 2.65, 5.4], 'left', 1.6, 0.2, 'Sample wall', ['Aim the applicator at it']),
		...[2.6, 3.8, 5].map((z, index) => box(`ph-plinth-${index}`, 'Plinth', [3.8, 0.45, z], [0.6, 0.9, 0.6], '#475569', {}, true)),
		solid('ph-sample-cube', 'Sample Cube', 'box', 2.6),
		solid('ph-sample-sphere', 'Sample Sphere', 'sphere', 3.8),
		solid('ph-sample-cylinder', 'Sample Cylinder', 'cylinder', 5)
	];
}

function buildSigns(): Slot[] {
	const wall = ROOM.front - 0.2;
	return [
		...sign('ph-sign', 'Shop Sign', [0, 3.0, wall], 'back', 3.4, 0.5, 'POLYHEAVEN MATERIALS', ['Free PBR textures from Poly Haven']),
		...sign('ph-credits', 'Credits Sign', [0, 2.66, wall], 'back', 3.4, 0.14, 'Textures and data courtesy of Poly Haven (polyhaven.com)', ['CC0: free for any use']),
		...sign('ph-howto', 'How To Sign', [-2.9, 1.6, wall], 'back', 1.8, 0.9, 'How it works', ['1. Pick a material on the panel', '2. Put the orb in the applicator', '3. Aim and pull the trigger'])
	];
}

/** The whole room: the shell, the swatch shelves, the things to try a material on, and the signs. */
export function buildShopDecor(): Slot[] {
	return [...buildShell(), ...buildSwatches('left'), ...buildSwatches('right'), ...buildSamples(), ...buildSigns()];
}
