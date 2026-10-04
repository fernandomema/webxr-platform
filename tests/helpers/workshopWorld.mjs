import { readFileSync } from 'node:fs';

// Runs the Workshop tools' scripts against a small stand-in for the codeBlock runtime (codeBlockRuntime.ts), built from the
// generated world itself. Quaternions follow Babylon's conventions: [x, y, z, w], a.multiply(b) applies b first.

export const workshop = JSON.parse(readFileSync(new URL('../../src/lib/xr/templates/workshop.json', import.meta.url), 'utf8'));

export const qMul = (a, b) => [
	a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
	a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
	a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
	a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
];
const qInv = (q) => [-q[0], -q[1], -q[2], q[3]];
export const rot = (q, v) => {
	const r = qMul(qMul(q, [v[0], v[1], v[2], 0]), qInv(q));
	return [r[0], r[1], r[2]];
};
export const axisAngle = (axis, angle) => {
	const l = Math.hypot(...axis) || 1;
	const s = Math.sin(angle / 2);
	return [(axis[0] / l) * s, (axis[1] / l) * s, (axis[2] / l) * s, Math.cos(angle / 2)];
};
export const math = {
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
export const near = (a, b, eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps);

/** A rotation that turns +Z to point along `direction` (yaw, then pitch), as a tool held towards something is. */
export function lookAlong(direction) {
	const [x, y, z] = math.vecNormalize(direction);
	return qMul(axisAngle([0, 1, 0], Math.atan2(x, z)), axisAngle([1, 0, 0], Math.asin(-y)));
}

/** A world holding the whole workshop, where one tool's script runs as the host would run it. */
export function world(toolName, { onBench = true } = {}) {
	const slots = new Map(workshop.map((slot) => [slot.id, structuredClone(slot)]));
	const spawned = [];
	const deleted = [];
	const moves = [];
	const held = new Set();
	let touching = [];
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
	const children = (id) => [...slots.values()].filter((slot) => slot.parentId === id);
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
			getChildren: children,
			getParent: (id) => { const parentId = slots.get(id)?.parentId; return parentId ? slots.get(parentId) : undefined; },
			getWorldPose: worldPose,
			findByName: (name) => [...slots.values()].find((slot) => slot.name === name)
		},
		equip: { isEquipped: () => inHand, holder: () => (inHand ? { playerId: 'p', hand: 'right' } : null) },
		grab: { isHeld: () => false, heldBy: () => [], isSlotHeld: (id) => held.has(id) },
		world: {
			isHost: () => true,
			spawn: (partial) => {
				const slot = { id: crypto.randomUUID(), parentId: null, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components: [], ...structuredClone(partial) };
				slots.set(slot.id, slot);
				spawned.push(slot);
			},
			deleteSlot: (id) => {
				deleted.push(id);
				const gone = [id];
				while (gone.length) {
					const next = gone.pop();
					slots.delete(next);
					gone.push(...children(next).map((slot) => slot.id));
				}
			},
			setComponentField: (id, type, field, value) => { const c = slots.get(id)?.components.find((x) => x.type === type); if (c) c[field] = structuredClone(value); },
			setComponent: (id, component) => {
				const slot = slots.get(id);
				if (!slot) return false;
				slot.components = [...slot.components.filter((c) => c.type !== component.type), structuredClone(component)];
				return true;
			},
			removeComponent: (id, type) => {
				const slot = slots.get(id);
				if (!slot?.components.some((c) => c.type === type)) return false;
				slot.components = slot.components.filter((c) => c.type !== type);
				return true;
			},
			setSlotEnabled: (id, enabled) => { const slot = slots.get(id); if (!slot) return false; slot.disabled = !enabled; return true; },
			setWorldPose: (id, pose) => {
				const slot = slots.get(id);
				if (!slot || held.has(id)) return false;
				moves.push({ id, ...pose });
				// Every slot moved here sits at the root or under a group at the origin, so world is local.
				if (pose.position) slot.position = pose.position;
				if (pose.rotation) slot.rotation = pose.rotation;
				if (pose.scale) slot.scale = pose.scale;
				return true;
			},
			// Keeps the slot where it is in the world (parents here are never scaled).
			setParent: (id, parentId) => {
				const slot = slots.get(id);
				if (!slot || held.has(id) || (parentId && !slots.has(parentId))) return false;
				const pose = worldPose(id);
				const parent = parentId ? worldPose(parentId) : { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
				slot.parentId = parentId;
				slot.position = rot(qInv(parent.rotation), math.vecSub(pose.position, parent.position));
				slot.rotation = qMul(qInv(parent.rotation), pose.rotation);
				return true;
			},
			raycast: () => hit,
			overlap: () => touching.filter((id) => slots.has(id)),
			findNear: () => []
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
	const part = (name) => [...slots.values()].find((s) => s.parentId === tool.id && s.name === name);
	return {
		handlers, slots, spawned, deleted, moves, add, worldPose, tool, children, part,
		aimAt: (slotId, point) => { hit = slotId ? { slotId, point, normal: [0, 1, 0], u: 0, v: 0 } : null; },
		/** What the tool's overlap test finds touching it, nearest first. */
		touch: (ids) => { touching = ids; },
		hold: (id) => held.add(id),
		setInHand: (value) => { inHand = value; },
		/** Holds the tool (at the root) at `from`, pointing at `target`. */
		pointAt: (target, from = [0, 1.5, 0]) => {
			tool.parentId = null;
			tool.position = from;
			tool.rotation = lookAlong(math.vecSub(target, from));
		},
		trigger: (phase) => handlers.onTrigger({ phase, value: phase === 'press' ? 1 : 0, hand: 'right', playerId: 'p', playerName: 'P' }),
		menu: (label) => handlers.getRadialItems().find((item) => item.label.startsWith(label)).onSelect()
	};
}

export const block = (id, extra = []) => ({
	id,
	name: 'Block',
	position: [0, 1, -5],
	components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color: '#3b82f6' }, { type: 'collider', shape: 'box' }, { type: 'grabbable', scalable: true }, ...extra]
});
