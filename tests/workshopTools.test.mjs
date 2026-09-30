import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Runs the Workshop tools' scripts against a small stand-in for the codeBlock runtime (codeBlockRuntime.ts), built from the
// generated world itself. Quaternions follow Babylon's conventions: [x, y, z, w], a.multiply(b) applies b first.

const workshop = JSON.parse(readFileSync(new URL('../src/lib/xr/templates/workshop.json', import.meta.url), 'utf8'));

const qMul = (a, b) => [
	a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
	a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
	a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
	a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
];
const rot = (q, v) => {
	const r = qMul(qMul(q, [v[0], v[1], v[2], 0]), [-q[0], -q[1], -q[2], q[3]]);
	return [r[0], r[1], r[2]];
};
const axisAngle = (axis, angle) => {
	const l = Math.hypot(...axis) || 1;
	const s = Math.sin(angle / 2);
	return [(axis[0] / l) * s, (axis[1] / l) * s, (axis[2] / l) * s, Math.cos(angle / 2)];
};
const math = {
	quatFromAxisAngle: axisAngle,
	vecAdd: (a, b) => a.map((v, i) => v + b[i]),
	vecSub: (a, b) => a.map((v, i) => v - b[i]),
	vecScale: (a, k) => a.map((v) => v * k),
	vecDot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
	vecCross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
	vecLength: (a) => Math.hypot(...a),
	vecNormalize: (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); },
	quatMultiply: qMul,
	rotateVec: rot
};
const near = (a, b, eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps);

/** A world holding the whole workshop, where one tool's script runs as the host would run it. */
function world(toolName, { onBench = true } = {}) {
	const slots = new Map(workshop.map((slot) => [slot.id, structuredClone(slot)]));
	const spawned = [];
	const deleted = [];
	const moves = [];
	let hit = null;
	let inHand = true;
	const worldPose = (id) => {
		const slot = slots.get(id);
		if (!slot) return undefined;
		const parent = slot.parentId ? worldPose(slot.parentId) : { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
		const position = math.vecAdd(parent.position, rot(parent.rotation, slot.position));
		const rotation = qMul(parent.rotation, slot.rotation);
		return { position, rotation, forward: rot(rotation, [0, 0, 1]), up: rot(rotation, [0, 1, 0]), right: rot(rotation, [1, 0, 0]) };
	};
	const tool = slots.get(workshop.find((slot) => slot.name === toolName && slot.components.some((c) => c.type === 'codeBlock')).id);
	// As if spawned from an inventory in another world: at the root, where its bench stood.
	if (!onBench) tool.parentId = null;
	const ctx = {
		self: {
			id: tool.id,
			getWorldPosition: () => worldPose(tool.id).position,
			getWorldRotation: () => worldPose(tool.id).rotation
		},
		hierarchy: {
			getSlot: (id) => slots.get(id),
			getChildren: (id) => [...slots.values()].filter((slot) => slot.parentId === id),
			getParent: (id) => { const parentId = slots.get(id)?.parentId; return parentId ? slots.get(parentId) : undefined; },
			getWorldPose: worldPose,
			findByName: (name) => [...slots.values()].find((slot) => slot.name === name)
		},
		equip: { isEquipped: () => inHand, holder: () => (inHand ? { playerId: 'p', hand: 'right' } : null) },
		grab: { isHeld: () => false, heldBy: () => [] },
		world: {
			isHost: () => true,
			spawn: (partial) => {
				const slot = { id: crypto.randomUUID(), parentId: null, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components: [], ...partial };
				slots.set(slot.id, slot);
				spawned.push(slot);
			},
			deleteSlot: (id) => { deleted.push(id); slots.delete(id); },
			setComponentField: (id, type, field, value) => { const c = slots.get(id)?.components.find((x) => x.type === type); if (c) c[field] = value; },
			setWorldPose: (id, pose) => {
				const slot = slots.get(id);
				if (!slot) return false;
				moves.push({ id, ...pose });
				// Every slot moved here sits at the root or under a group at the origin, so world is local.
				if (pose.position) slot.position = pose.position;
				if (pose.rotation) slot.rotation = pose.rotation;
				return true;
			},
			raycast: () => hit
		},
		audio: { play: () => {} },
		particles: { burst: () => {} },
		math,
		log: () => {}
	};
	const code = tool.components.find((c) => c.type === 'codeBlock').code;
	const handlers = new Function('ctx', code)(ctx);
	handlers.onSpawn?.();
	const add = (slot) => { const full = { parentId: null, rotation: [0, 0, 0, 1], scale: [1, 1, 1], ...slot }; slots.set(full.id, full); return full; };
	return {
		handlers, slots, spawned, deleted, moves, add, worldPose, tool,
		aimAt: (slotId, point) => { hit = slotId ? { slotId, point, normal: [0, 1, 0], u: 0, v: 0 } : null; },
		setInHand: (value) => { inHand = value; },
		trigger: (phase) => handlers.onTrigger({ phase, value: phase === 'press' ? 1 : 0, hand: 'right', playerId: 'p', playerName: 'P' }),
		menu: (label) => handlers.getRadialItems().find((item) => item.label.startsWith(label)).onSelect()
	};
}

const block = (id, extra = []) => ({
	id,
	name: 'Block',
	position: [0, 1, -5],
	components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color: '#3b82f6' }, { type: 'collider', shape: 'box' }, { type: 'grabbable', scalable: true }, ...extra]
});
const TOOL_NAMES = ['Shape Maker', 'Copier', 'Eraser', 'Paint Brush', 'Color Sprayer', 'Tape Measure', 'Aligner'];

test('every workshop tool is a grabbable, equippable object whose script runs', () => {
	for (const name of TOOL_NAMES) {
		const w = world(name);
		const types = w.tool.components.map((c) => c.type);
		for (const type of ['grabbable', 'equippable', 'codeBlock']) assert.ok(types.includes(type), `${name} has ${type}`);
		assert.equal(w.tool.components.find((c) => c.type === 'equippable').autoGrip, true, `${name} is gripped by the fingers`);
		assert.equal(typeof w.handlers.onTrigger, 'function', `${name} responds to the trigger`);
		assert.ok(!(w.handlers.getRadialItems?.() ?? []).some((item) => /bench/i.test(item.label)), `${name} has no bench option: it may be carried to other worlds`);
	}
});

test('each tool has a tip card on the pegboard of its bay', () => {
	for (const name of TOOL_NAMES) {
		const tip = workshop.find((slot) => slot.components.some((c) => c.type === 'textDisplay' && c.title === name) && slot.name === `${name} Sign`);
		assert.ok(tip, `${name} has a tip card`);
		assert.ok(tip.components.find((c) => c.type === 'textDisplay').lines.length > 0);
	}
});

test('the Shape Maker makes a grabbable, scalable shape just ahead of itself, in the chosen shape', () => {
	const w = world('Shape Maker');
	w.menu('Shape:'); // Box -> Sphere
	w.trigger('press');
	const shape = w.spawned.find((slot) => slot.components.some((c) => c.type === 'grabbable'));
	assert.ok(shape);
	assert.equal(shape.components.find((c) => c.type === 'meshRenderer').meshRef.id, 'sphere');
	assert.equal(shape.components.find((c) => c.type === 'grabbable').scalable, true);
	const muzzle = w.worldPose(w.slots.get([...w.slots.values()].find((s) => s.parentId === w.tool.id && s.name === 'Muzzle').id).id);
	const gap = math.vecLength(math.vecSub(shape.position, muzzle.position)) - Math.max(...shape.scale) / 2;
	assert.ok(gap > 0.02, `the shape starts clear of the tool (${gap})`);
});

test('the Copier copies a whole object, with fresh ids, and leaves structure and tools alone', () => {
	const w = world('Copier');
	w.add(block('box-1'));
	w.add({ id: 'box-1-knob', parentId: 'box-1', name: 'Knob', position: [0, 0.6, 0], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' } }] });
	w.aimAt('box-1-knob', [0, 1.6, -5]);
	w.trigger('press');
	w.handlers.tick(0.016);
	w.trigger('release');
	const root = w.spawned.find((slot) => slot.name === 'Block');
	const knob = w.spawned.find((slot) => slot.name === 'Knob');
	assert.ok(root && knob, 'both slots are copied');
	assert.notEqual(root.id, 'box-1');
	assert.equal(root.parentId, null);
	assert.equal(knob.parentId, root.id, 'the child hangs from the copy, not the original');
	assert.ok(!w.slots.has(w.spawned.find((slot) => slot.name === 'Tool Beam')?.id), 'the aiming beam is gone');

	const copies = () => w.spawned.filter((slot) => slot.name !== 'Tool Beam' && slot.name !== 'Tool Flash').length;
	const before = copies();
	w.aimAt('workshop-wall-left', [15.8, 2, -5]);
	w.trigger('press');
	w.trigger('release');
	w.aimAt('workshop-tool-eraser-part-0', [0, 0, 0]);
	w.trigger('press');
	w.trigger('release');
	assert.equal(copies(), before, 'nothing copied from the building or a tool');
});

test('the Eraser deletes what it is aimed at, but not the building, and rubs out drawn lines it touches', () => {
	const w = world('Eraser');
	w.add(block('box-1'));
	w.aimAt('box-1', [0, 1, -5]);
	w.trigger('press');
	w.trigger('release');
	assert.ok(w.deleted.includes('box-1'));
	w.aimAt('workshop-wall-left', [15.8, 2, -5]);
	w.trigger('press');
	w.trigger('release');
	assert.ok(!w.deleted.includes('workshop-wall-left'));

	w.menu('Erase:'); // Objects -> Drawings
	const tip = w.worldPose([...w.slots.values()].find((s) => s.parentId === w.tool.id && s.name === 'Tip').id).position;
	w.add({ id: 'line-near', name: 'Brush Stroke', position: [0, 0, 0], components: [{ type: 'stroke', points: [tip[0] + 1, tip[1], tip[2], tip[0] + 0.02, tip[1], tip[2]], color: '#fff', width: 0.01 }] });
	w.add({ id: 'line-far', name: 'Brush Stroke', position: [0, 0, 0], components: [{ type: 'stroke', points: [tip[0] + 1, tip[1], tip[2]], color: '#fff', width: 0.01 }] });
	w.trigger('press');
	w.handlers.tick(0.2);
	w.trigger('release');
	assert.ok(w.deleted.includes('line-near'));
	assert.ok(!w.deleted.includes('line-far'));
});

test('the Color Sprayer paints the part it is aimed at, and can pick a colour up', () => {
	const w = world('Color Sprayer');
	w.add(block('box-1'));
	w.aimAt('box-1', [0, 1, -5]);
	w.trigger('press');
	w.trigger('release');
	assert.equal(w.slots.get('box-1').components[0].color, '#ef4444');
	w.aimAt('workshop-wall-left', [15.8, 2, -5]);
	w.trigger('press');
	w.trigger('release');
	assert.equal(w.slots.get('workshop-wall-left').components[0].color, '#cfc8b8', 'the building keeps its colour');

	w.add({ ...block('box-2'), components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color: '#123456' }, { type: 'grabbable', scalable: true }] });
	w.menu('Mode:'); // Paint -> Pick color
	w.aimAt('box-2', [0, 1, -5]);
	w.trigger('press');
	w.trigger('release');
	w.menu('Mode:'); // back to Paint
	w.aimAt('box-1', [0, 1, -5]);
	w.trigger('press');
	w.trigger('release');
	assert.equal(w.slots.get('box-1').components[0].color, '#123456');
});

test('the Tape Measure leaves a line and a label with the distance between where it was pressed and released', () => {
	const w = world('Tape Measure');
	w.aimAt('floor', [0, 0, -2]);
	w.trigger('press');
	w.aimAt('floor', [1.5, 0, -2]);
	w.handlers.tick(0.016);
	w.trigger('release');
	const label = w.spawned.find((slot) => slot.name === 'Measure Label');
	assert.ok(label);
	assert.equal(label.components.find((c) => c.type === 'textDisplay').title, '1.50 m');
	const line = w.spawned.find((slot) => slot.name === 'Measure Line');
	assert.deepEqual(line.components[0].points, [0, 0, -2, 1.5, 0, -2]);
	w.menu('Clear');
	assert.ok(!w.slots.has(label.id) && !w.slots.has(line.id));
});

test('the Aligner stands a tilted object upright, squares its turn and can snap it to a grid', () => {
	const w = world('Aligner');
	// Tipped 30° over and turned 50°.
	const tilted = qMul(axisAngle([0, 1, 0], (50 * Math.PI) / 180), axisAngle([1, 0, 0], (30 * Math.PI) / 180));
	w.add({ ...block('box-1'), position: [0.33, 1.04, -4.97], rotation: tilted });
	w.menu('Grid:'); // Off -> 5 cm
	w.menu('Grid:'); // -> 10 cm
	w.aimAt('box-1', [0.33, 1.04, -4.97]);
	w.trigger('press');
	w.trigger('release');
	const move = w.moves.find((m) => m.id === 'box-1');
	assert.ok(move);
	assert.ok(near(rot(move.rotation, [0, 1, 0]), [0, 1, 0], 1e-6), 'its up axis points straight up');
	const forward = rot(move.rotation, [0, 0, 1]);
	const yaw = (Math.atan2(forward[0], forward[2]) * 180) / Math.PI;
	assert.ok(Math.abs(yaw - Math.round(yaw / 90) * 90) < 1e-6, `turned to a multiple of 90° (${yaw})`);
	assert.ok(near(move.position, [0.3, 1, -5], 1e-9), 'snapped to the 10 cm grid');
});

test('a tool left lying away from its bench goes back after a while, and not while someone holds it', () => {
	const w = world('Copier');
	const home = w.worldPose(w.tool.id).position;
	w.slots.get(w.tool.id).position = math.vecAdd(w.slots.get(w.tool.id).position, [0, 0, 3]);
	w.handlers.tick(60);
	assert.equal(w.moves.length, 0, 'not while in hand');
	w.setInHand(false);
	w.handlers.tick(20);
	assert.equal(w.moves.length, 0, 'not straight away');
	w.handlers.tick(30);
	assert.ok(near(w.moves.at(-1).position, home), 'back where it started');
});

test('a tool taken into another world has no bench, and stays wherever it is put down', () => {
	const w = world('Copier', { onBench: false });
	w.setInHand(false);
	w.slots.get(w.tool.id).position = [5, 1, 5];
	w.handlers.tick(120);
	assert.equal(w.moves.length, 0);
});
