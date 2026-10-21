/**
 * Furniture, lighting and decor for the Starter Kit: whole objects composed of primitives, each standing on its own origin
 * (the middle of its base, on the floor) and sized in metres like the real thing. Every one is a container root carrying
 * the grab, with its parts as children, so it is picked up and moved as one and edited part by part in the Studio.
 */
import type { Component, Quat, Slot, SlotTree, Vec3 } from '../../ecs/types';

type Shape = 'box' | 'sphere' | 'cylinder' | 'plane' | 'disc';

interface Part {
	name: string;
	shape: Shape;
	color: string;
	position?: Vec3;
	scale: Vec3;
	/** Euler degrees (x, y, z). */
	rotation?: Vec3;
	/** Whether it blocks hands and objects. On unless set to `false`. */
	solid?: boolean;
	extra?: Component[];
}

const EMPTY_ROTATION: Quat = [0, 0, 0, 1];

function quatFromEuler([x, y, z]: Vec3): Quat {
	const rad = Math.PI / 180;
	const [cx, cy, cz] = [Math.cos((x * rad) / 2), Math.cos((y * rad) / 2), Math.cos((z * rad) / 2)];
	const [sx, sy, sz] = [Math.sin((x * rad) / 2), Math.sin((y * rad) / 2), Math.sin((z * rad) / 2)];
	const round = (value: number) => Math.round(value * 1e5) / 1e5;
	return [
		round(sx * cy * cz + cx * sy * sz),
		round(cx * sy * cz - sx * cy * sz),
		round(cx * cy * sz + sx * sy * cz),
		round(cx * cy * cz - sx * sy * sz)
	];
}

/** A root with the given parts hanging from it. Ids derive from the root's, so every object is self-contained. */
function assemble(id: string, name: string, parts: Part[], rootComponents: Component[] = []): SlotTree {
	const root: Slot = {
		id, parentId: null, name, position: [0, 0, 0], rotation: EMPTY_ROTATION, scale: [1, 1, 1],
		components: [{ type: 'container' }, { type: 'grabbable', scalable: true }, ...rootComponents]
	};
	return [
		root,
		...parts.map((part, index): Slot => ({
			id: `${id}-${index}`,
			parentId: id,
			name: part.name,
			position: part.position ?? [0, 0, 0],
			rotation: part.rotation ? quatFromEuler(part.rotation) : EMPTY_ROTATION,
			scale: part.scale,
			components: [
				{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: part.shape }, color: part.color },
				...(part.solid === false ? [] : [{ type: 'collider' as const, shape: 'box' as const }]),
				...(part.extra ?? [])
			]
		}))
	];
}

/** A cylinder standing on its end, `diameter` wide and `height` tall, its base at `y`. */
const post = (name: string, color: string, x: number, y: number, z: number, diameter: number, height: number, solid = true): Part => ({
	name, shape: 'cylinder', color, position: [x, y + height / 2, z], scale: [diameter, height, diameter], solid
});
/** A box of the given size whose base is at `y`. */
const block = (name: string, color: string, x: number, y: number, z: number, w: number, h: number, d: number): Part => ({
	name, shape: 'box', color, position: [x, y + h / 2, z], scale: [w, h, d]
});

function chair(): SlotTree {
	const wood = '#a16207';
	const seatTop = 0.45;
	return assemble('chair', 'Chair', [
		block('Seat', wood, 0, seatTop - 0.04, 0, 0.42, 0.04, 0.42),
		block('Cushion', '#b91c1c', 0, seatTop, 0, 0.38, 0.05, 0.38),
		...[[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]].map(([x, z], i) => block(`Leg ${i + 1}`, wood, x, 0, z, 0.04, seatTop - 0.04, 0.04)),
		block('Back Post Left', wood, -0.19, seatTop, 0.19, 0.04, 0.45, 0.04),
		block('Back Post Right', wood, 0.19, seatTop, 0.19, 0.04, 0.45, 0.04),
		block('Back Rail Top', wood, 0, seatTop + 0.37, 0.19, 0.38, 0.08, 0.03),
		block('Back Rail Middle', wood, 0, seatTop + 0.22, 0.19, 0.38, 0.05, 0.03)
	]);
}

function stool(): SlotTree {
	const wood = '#92400e';
	return assemble('stool', 'Stool', [
		post('Seat', '#d97706', 0, 0.6, 0, 0.34, 0.05),
		...[0, 120, 240].map((angle, i) => post(`Leg ${i + 1}`, wood, Math.sin((angle * Math.PI) / 180) * 0.11, 0, Math.cos((angle * Math.PI) / 180) * 0.11, 0.04, 0.6)),
		post('Foot Ring', wood, 0, 0.22, 0, 0.26, 0.02, false)
	]);
}

function table(): SlotTree {
	const wood = '#b45309';
	return assemble('table', 'Table', [
		block('Top', wood, 0, 0.72, 0, 1.2, 0.05, 0.7),
		block('Apron Front', '#92400e', 0, 0.66, -0.3, 1.08, 0.06, 0.03),
		block('Apron Back', '#92400e', 0, 0.66, 0.3, 1.08, 0.06, 0.03),
		...[[-0.55, -0.3], [0.55, -0.3], [-0.55, 0.3], [0.55, 0.3]].map(([x, z], i) => block(`Leg ${i + 1}`, '#92400e', x, 0, z, 0.06, 0.72, 0.06))
	]);
}

function coffeeTable(): SlotTree {
	return assemble('coffee-table', 'Coffee Table', [
		post('Top', '#f1f5f9', 0, 0.38, 0, 0.8, 0.04),
		post('Pedestal', '#475569', 0, 0.04, 0, 0.14, 0.34),
		post('Base', '#334155', 0, 0, 0, 0.5, 0.04)
	]);
}

function sofa(): SlotTree {
	const fabric = '#4f46e5';
	const dark = '#3730a3';
	return assemble('sofa', 'Sofa', [
		block('Base', dark, 0, 0.1, 0, 1.9, 0.22, 0.85),
		block('Seat Cushion Left', fabric, -0.46, 0.32, -0.04, 0.9, 0.14, 0.7),
		block('Seat Cushion Right', fabric, 0.46, 0.32, -0.04, 0.9, 0.14, 0.7),
		block('Back', fabric, 0, 0.32, 0.34, 1.9, 0.5, 0.2),
		block('Back Cushion Left', '#6366f1', -0.46, 0.46, 0.22, 0.86, 0.38, 0.14),
		block('Back Cushion Right', '#6366f1', 0.46, 0.46, 0.22, 0.86, 0.38, 0.14),
		block('Arm Left', dark, -0.97, 0.1, 0, 0.18, 0.55, 0.85),
		block('Arm Right', dark, 0.97, 0.1, 0, 0.18, 0.55, 0.85),
		...[[-0.85, -0.34], [0.85, -0.34], [-0.85, 0.34], [0.85, 0.34]].map(([x, z], i) => post(`Foot ${i + 1}`, '#1e1b4b', x, 0, z, 0.06, 0.1))
	]);
}

function bookshelf(): SlotTree {
	const wood = '#78350f';
	const bookColors = ['#dc2626', '#2563eb', '#16a34a', '#eab308', '#9333ea', '#0891b2', '#ea580c', '#db2777'];
	const books: Part[] = [];
	[0.04, 0.42, 0.8].forEach((shelfTop, shelf) => {
		let x = -0.36;
		for (let i = 0; i < 6 - shelf; i++) {
			const height = 0.24 + ((i * 7 + shelf * 3) % 5) * 0.025;
			const width = 0.04 + ((i + shelf) % 3) * 0.01;
			books.push(block(`Book ${shelf + 1}.${i + 1}`, bookColors[(i + shelf * 3) % bookColors.length], x + width / 2, shelfTop, 0, width, height, 0.2));
			x += width + 0.006;
		}
	});
	return assemble('bookshelf', 'Bookshelf', [
		block('Side Left', wood, -0.43, 0, 0, 0.04, 1.2, 0.3),
		block('Side Right', wood, 0.43, 0, 0, 0.04, 1.2, 0.3),
		block('Back Panel', '#92400e', 0, 0, 0.14, 0.82, 1.2, 0.02),
		block('Shelf Bottom', wood, 0, 0, 0, 0.82, 0.04, 0.3),
		block('Shelf Low', wood, 0, 0.38, 0, 0.82, 0.04, 0.3),
		block('Shelf High', wood, 0, 0.76, 0, 0.82, 0.04, 0.3),
		block('Top', wood, 0, 1.16, 0, 0.9, 0.04, 0.32),
		...books
	]);
}

function floorLamp(): SlotTree {
	return assemble('floor-lamp', 'Floor Lamp', [
		post('Base', '#27272a', 0, 0, 0, 0.28, 0.03),
		post('Pole', '#a1a1aa', 0, 0.03, 0, 0.025, 1.45),
		{ name: 'Shade', shape: 'cylinder', color: '#fde68a', position: [0, 1.62, 0], scale: [0.36, 0.26, 0.36] },
		{ name: 'Bulb', shape: 'sphere', color: '#fffbeb', position: [0, 1.58, 0], scale: [0.1, 0.1, 0.1], solid: false, extra: [{ type: 'pointLight', color: '#ffd9a0', intensity: 0.8, range: 6 }] }
	]);
}

function tableLamp(): SlotTree {
	return assemble('table-lamp', 'Table Lamp', [
		post('Base', '#1e293b', 0, 0, 0, 0.16, 0.03),
		{ name: 'Body', shape: 'sphere', color: '#0ea5e9', position: [0, 0.14, 0], scale: [0.18, 0.2, 0.18] },
		post('Neck', '#1e293b', 0, 0.2, 0, 0.03, 0.1),
		{ name: 'Shade', shape: 'cylinder', color: '#fef3c7', position: [0, 0.38, 0], scale: [0.26, 0.2, 0.26] },
		{ name: 'Bulb', shape: 'sphere', color: '#fffbeb', position: [0, 0.34, 0], scale: [0.07, 0.07, 0.07], solid: false, extra: [{ type: 'pointLight', color: '#ffe0b2', intensity: 0.6, range: 4 }] }
	]);
}

function lantern(): SlotTree {
	return assemble('lantern', 'Lantern', [
		post('Base', '#1f2937', 0, 0, 0, 0.14, 0.03),
		post('Glass', '#fcd34d', 0, 0.03, 0, 0.11, 0.18),
		{ name: 'Flame', shape: 'sphere', color: '#fb923c', position: [0, 0.12, 0], scale: [0.05, 0.07, 0.05], solid: false, extra: [{ type: 'pointLight', color: '#ffb347', intensity: 0.7, range: 5 }] },
		post('Cap', '#1f2937', 0, 0.21, 0, 0.15, 0.03),
		{ name: 'Handle', shape: 'cylinder', color: '#374151', position: [0, 0.27, 0], scale: [0.012, 0.1, 0.012], rotation: [0, 0, 90], solid: false },
		block('Handle Post Left', '#374151', -0.045, 0.24, 0, 0.012, 0.06, 0.012),
		block('Handle Post Right', '#374151', 0.045, 0.24, 0, 0.012, 0.06, 0.012)
	]);
}

function neonSign(): SlotTree {
	return assemble('neon-sign', 'Neon Sign', [
		{ name: 'Backing', shape: 'box', color: '#09090b', position: [0, 0.2, 0.012], scale: [0.9, 0.4, 0.02] },
		{
			name: 'Neon Text', shape: 'plane', color: '#09090b', position: [0, 0.2, -0.002], scale: [0.84, 0.34, 1], solid: false,
			extra: [{ type: 'textDisplay', title: 'OPEN', lines: ['all night long'], color: '#f0abfc', verticalAlign: 'middle' }]
		},
		{ name: 'Glow', shape: 'sphere', color: '#f0abfc', position: [0, 0.2, -0.1], scale: [0.02, 0.02, 0.02], solid: false, extra: [{ type: 'pointLight', color: '#f0abfc', intensity: 0.6, range: 4 }] }
	]);
}

function pottedPlant(): SlotTree {
	const leaf = (name: string, x: number, y: number, z: number, size: number, color: string): Part => ({
		name, shape: 'sphere', color, position: [x, y, z], scale: [size, size * 0.8, size], solid: false
	});
	return assemble('potted-plant', 'Potted Plant', [
		post('Pot', '#c2410c', 0, 0, 0, 0.26, 0.24),
		post('Pot Rim', '#9a3412', 0, 0.22, 0, 0.3, 0.04),
		post('Soil', '#422006', 0, 0.255, 0, 0.24, 0.01, false),
		post('Stem', '#15803d', 0, 0.26, 0, 0.025, 0.34, false),
		leaf('Leaf Centre', 0, 0.68, 0, 0.26, '#22c55e'),
		leaf('Leaf Left', -0.13, 0.56, 0.02, 0.2, '#16a34a'),
		leaf('Leaf Right', 0.13, 0.58, -0.03, 0.22, '#4ade80'),
		leaf('Leaf Front', 0.02, 0.5, -0.12, 0.18, '#15803d'),
		leaf('Leaf Back', -0.02, 0.52, 0.12, 0.2, '#22c55e')
	], [{ type: 'collider', shape: 'box' }]);
}

function pictureFrame(): SlotTree {
	return assemble('picture-frame', 'Picture Frame', [
		block('Frame', '#292524', 0, 0, 0.012, 0.64, 0.84, 0.03),
		{ name: 'Mat', shape: 'plane', color: '#fafaf9', position: [0, 0.42, -0.004], scale: [0.56, 0.76, 1], solid: false },
		{ name: 'Picture Sky', shape: 'plane', color: '#7dd3fc', position: [0, 0.5, -0.006], scale: [0.44, 0.4, 1], solid: false },
		{ name: 'Picture Hills', shape: 'plane', color: '#4ade80', position: [0, 0.3, -0.006], scale: [0.44, 0.2, 1], solid: false },
		{ name: 'Picture Sun', shape: 'disc', color: '#fde047', position: [0.1, 0.55, -0.008], scale: [0.1, 0.1, 0.1], rotation: [-90, 0, 0], solid: false }
	]);
}

function roundRug(): SlotTree {
	const ring = (name: string, color: string, diameter: number, lift: number): Part => ({
		name, shape: 'disc', color, position: [0, lift, 0], scale: [diameter, 1, diameter], solid: false
	});
	return assemble('round-rug', 'Round Rug', [
		ring('Border', '#7c2d12', 1.6, 0.004),
		ring('Band', '#fbbf24', 1.34, 0.008),
		ring('Field', '#be123c', 1.14, 0.012),
		ring('Medallion', '#fde68a', 0.6, 0.016),
		ring('Centre', '#7c2d12', 0.24, 0.02)
	], [{ type: 'dropZone', align: 'upright' }]);
}

function trophy(): SlotTree {
	const gold = '#eab308';
	return assemble('trophy', 'Trophy', [
		block('Plinth', '#1c1917', 0, 0, 0, 0.14, 0.04, 0.14),
		block('Plinth Step', '#292524', 0, 0.04, 0, 0.1, 0.03, 0.1),
		post('Stem', gold, 0, 0.07, 0, 0.03, 0.1),
		post('Knop', '#ca8a04', 0, 0.12, 0, 0.055, 0.02),
		{ name: 'Cup', shape: 'sphere', color: gold, position: [0, 0.23, 0], scale: [0.14, 0.15, 0.14] },
		post('Cup Rim', '#facc15', 0, 0.285, 0, 0.14, 0.012),
		{ name: 'Handle Left', shape: 'sphere', color: gold, position: [-0.085, 0.24, 0], scale: [0.04, 0.07, 0.015], solid: false },
		{ name: 'Handle Right', shape: 'sphere', color: gold, position: [0.085, 0.24, 0], scale: [0.04, 0.07, 0.015], solid: false },
		{
			name: 'Plaque', shape: 'plane', color: '#fde68a', position: [0, 0.055, -0.0505], scale: [0.09, 0.025, 1], solid: false,
			extra: [{ type: 'textDisplay', title: '', lines: ['#1 Player'], color: '#1c1917', scale: 0.4, verticalAlign: 'middle' }]
		}
	]);
}

function balloon(): SlotTree {
	return assemble('balloon', 'Balloon', [
		{ name: 'Envelope', shape: 'sphere', color: '#ef4444', position: [0, 0.6, 0], scale: [0.34, 0.4, 0.34] },
		{ name: 'Highlight', shape: 'sphere', color: '#fca5a5', position: [-0.08, 0.7, -0.1], scale: [0.07, 0.1, 0.03], solid: false },
		{ name: 'Knot', shape: 'sphere', color: '#b91c1c', position: [0, 0.39, 0], scale: [0.03, 0.04, 0.03], solid: false },
		{ name: 'String', shape: 'cylinder', color: '#e5e7eb', position: [0, 0.2, 0], scale: [0.004, 0.4, 0.004], solid: false }
	]);
}

export const PROP_FOLDERS = [
	{ id: 'furniture', name: 'Furniture' },
	{ id: 'lighting', name: 'Lighting' },
	{ id: 'decor', name: 'Decor' }
];

export const PROP_ENTRIES: { id: string; folderId: string; name: string; build: () => SlotTree }[] = [
	{ id: 'chair', folderId: 'furniture', name: 'Chair', build: chair },
	{ id: 'stool', folderId: 'furniture', name: 'Stool', build: stool },
	{ id: 'table', folderId: 'furniture', name: 'Table', build: table },
	{ id: 'coffee-table', folderId: 'furniture', name: 'Coffee Table', build: coffeeTable },
	{ id: 'sofa', folderId: 'furniture', name: 'Sofa', build: sofa },
	{ id: 'bookshelf', folderId: 'furniture', name: 'Bookshelf', build: bookshelf },
	{ id: 'floor-lamp', folderId: 'lighting', name: 'Floor Lamp', build: floorLamp },
	{ id: 'table-lamp', folderId: 'lighting', name: 'Table Lamp', build: tableLamp },
	{ id: 'lantern', folderId: 'lighting', name: 'Lantern', build: lantern },
	{ id: 'neon-sign', folderId: 'lighting', name: 'Neon Sign', build: neonSign },
	{ id: 'potted-plant', folderId: 'decor', name: 'Potted Plant', build: pottedPlant },
	{ id: 'picture-frame', folderId: 'decor', name: 'Picture Frame', build: pictureFrame },
	{ id: 'round-rug', folderId: 'decor', name: 'Round Rug', build: roundRug },
	{ id: 'trophy', folderId: 'decor', name: 'Trophy', build: trophy },
	{ id: 'balloon', folderId: 'decor', name: 'Balloon', build: balloon }
];
