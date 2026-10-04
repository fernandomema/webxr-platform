import type { Slot, Vec3 } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';

export const WISH = {
	id: 'wish-engine',
	director: 'we-director',
	center: [0, 0, 6] as Vec3,
	lamps: [[-3.8, 1.45, 6], [0, 1.45, 10], [3.8, 1.45, 6]] as Vec3[],
	starSockets: [[-3.5, 1.45, 5.8], [-3.0, 1.8, 5.8], [-2.5, 1.45, 5.8]] as Vec3[],
	durations: { awakening: 16, lightReveal: 18, timeReveal: 18, skyReveal: 20, finale: 28 },
	gold: '#d9b46d',
	pale: '#ffe6b0',
	violet: '#a68be0',
	teal: '#72d6d3'
} as const;

export function wishObjects(): Slot[] {
	return [
		{ id: 'we-coin', name: 'Wish Coin', position: [0.85, 1.06, 4.1], scale: [0.23, 0.035, 0.23], mesh: 'cylinder', color: WISH.gold, tag: 'wish-coin' },
		{ id: 'we-spark', name: 'Borrowed Light', position: [0, 1.35, 5.1], scale: [0.16, 0.16, 0.16], mesh: 'sphere', color: WISH.pale, tag: 'wish-spark' },
		...[0, 1, 2].map((i) => ({ id: `we-fragment-${i}`, name: ['Dawn Fragment', 'Moon Fragment', 'Dusk Fragment'][i], position: [-3.5 + i * 0.5, 1.06, 4.6], scale: [0.16, 0.22, 0.16], mesh: 'sphere', color: [WISH.gold, WISH.teal, WISH.violet][i], tag: `wish-star-${i}` }))
	].map((object) => createSlot({
		id: object.id, name: object.name, position: object.position as Vec3, scale: object.scale as Vec3,
		components: [
			{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: object.mesh as 'cylinder' | 'sphere' }, color: object.color, unlit: object.id !== 'we-coin' },
			...(object.id === 'we-coin' ? [
				{ type: 'material' as const, metallic: 0.65, roughness: 0.28 },
				{ type: 'stroke' as const, color: '#624864', width: 0.025, points: Array.from({ length: 11 }, (_, i) => {
					const angle = i * Math.PI / 5, radius = i % 2 ? 0.16 : 0.37;
					return [Math.sin(angle) * radius, 0.58, Math.cos(angle) * radius];
				}).flat() }
			] : []),
			{ type: 'collider', shape: 'sphere' }, { type: 'grabbable', scalable: false },
			{ type: 'insertable', tag: object.tag }
		]
	}));
}

export const WISH_INITIAL = {
	run: 0, phase: 'idle', time: 0, lights: [false, false, false], rings: [1, 2, 3], stars: [false, false, false],
	gentle: false, muted: false
};
