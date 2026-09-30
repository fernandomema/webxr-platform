// Small helpers for the scripts that generate the built-in worlds as slot lists (see generate-pop-up-store.mjs).
// Babylon space: +Y up; the player arrives at the origin looking towards -Z, and (left-handed) +X is on their left.

export const IDENTITY = [0, 0, 0, 1];
export const round = (v) => Math.round(v * 10000) / 10000;

/** A turn about the vertical: yaw 0 keeps +Z, a positive yaw turns +Z towards +X. */
export const yaw = (radians) => [0, Math.sin(radians / 2), 0, Math.cos(radians / 2)];
/** A turn about the local X axis: a positive pitch turns +Z towards -Y (and -Z towards +Y). */
export const pitch = (radians) => [Math.sin(radians / 2), 0, 0, Math.cos(radians / 2)];
/** Rotates a vector about the vertical by `radians` (the same turn as `yaw`). */
export const turn = ([x, y, z], radians) => [x * Math.cos(radians) + z * Math.sin(radians), y, -x * Math.sin(radians) + z * Math.cos(radians)];

/** A plane (and so a sign) is seen from the side its -Z faces: these turn it to be read from the given direction. */
const s45 = Math.SQRT1_2;
export const FACING = { '+z': [0, 1, 0, 0], '-z': IDENTITY, '+x': [0, -s45, 0, s45], '-x': [0, s45, 0, s45] };
const NORMALS = { '+z': [0, 0, 1], '-z': [0, 0, -1], '+x': [1, 0, 0], '-x': [-1, 0, 0] };

export const mesh = (id, color) => ({ type: 'meshRenderer', meshRef: { kind: 'builtin', id }, ...(color ? { color } : {}) });
export const solid = { type: 'collider', shape: 'box' };

/** Collects slots; every builder returns the slot's id. */
export function createWorld() {
	const slots = [];

	function slot(id, name, parentId, { position = [0, 0, 0], rotation = IDENTITY, scale = [1, 1, 1], components = [] } = {}) {
		slots.push({ id, parentId, name, position: position.map(round), rotation: rotation.map(round), scale: scale.map(round), components });
		return id;
	}

	const group = (id, name, parentId = null) => slot(id, name, parentId, { components: [{ type: 'container' }] });

	/** A box given by its centre and size, solid (blocks the player) unless `walkThrough`. */
	const box = (id, name, parentId, center, size, color, walkThrough = false) =>
		slot(id, name, parentId, { position: center, scale: size, components: [mesh('box', color), ...(walkThrough ? [] : [solid])] });

	/** A walkable, teleportable surface at height `y`, spanning x0..x1 by z0..z1 (the ground mesh is 20 m square). */
	const floor = (id, name, parentId, [x0, x1], [z0, z1], y, color) =>
		slot(id, name, parentId, { position: [(x0 + x1) / 2, y, (z0 + z1) / 2], scale: [(x1 - x0) / 20, 1, (z1 - z0) / 20], components: [mesh('ground', color), solid] });

	/** A sign: a coloured frame with the text panel just in front of it, read from `facing`. */
	function sign(id, parentId, center, [width, height], facing, text, frameColor, background = '#1f2937') {
		const normal = NORMALS[facing];
		const across = facing.endsWith('x') ? [0.04, height + 0.12, width + 0.12] : [width + 0.12, height + 0.12, 0.04];
		box(`${id}-frame`, `${text.title} Sign Frame`, parentId, center, across, frameColor, true);
		return slot(id, `${text.title} Sign`, parentId, {
			position: center.map((v, i) => v + normal[i] * 0.03),
			rotation: FACING[facing],
			scale: [width, height, 1],
			components: [mesh('plane', background), { type: 'textDisplay', title: text.title, lines: text.lines ?? [], color: background, ...(text.scale ? { scale: text.scale } : {}) }]
		});
	}

	return { slots, slot, group, box, floor, sign };
}

/** A colour mixed towards a dark base: `amount` of the colour is kept. */
export function shade(hex, amount, base = 0x1a) {
	const n = parseInt(hex.slice(1), 16);
	const channel = (shift) => Math.round(((n >> shift) & 255) * amount + base * (1 - amount));
	return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, '0')).join('')}`;
}
