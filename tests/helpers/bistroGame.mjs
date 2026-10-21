import { buildBistro } from '../../src/lib/content/templates/bistro.ts';
import { ID, ITEM_REST, PLATE_REST } from '../../src/lib/content/templates/bistroData.ts';
import { compose, invert, multiply, transformPoint } from '../../packages/engine/src/lighting/matrix.ts';

export const DT = 1 / 20;
const find = (slot, type) => slot.components.find((c) => c.type === type);

const qmul = (a, b) => [
	a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
	a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
	a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
	a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qrot = (q, v) => {
	const [x, y, z, w] = q;
	const cx = y * v[2] - z * v[1], cy = z * v[0] - x * v[2], cz = x * v[1] - y * v[0];
	return [v[0] + 2 * (w * cx + y * cz - z * cy), v[1] + 2 * (w * cy + z * cx - x * cz), v[2] + 2 * (w * cz + x * cy - y * cx)];
};
export const yawOf = (q) => { const f = qrot(q, [0, 0, 1]); return Math.atan2(f[0], f[2]); };

/**
 * Bistro Rush's scripts running against a stand-in for the engine that keeps a real scene graph: every slot has its place in
 * its parent, a slot in a hand follows the hand, and letting go leaves it where it was let go, as the engine does. So the tests
 * see where things really end up, and the world can be drawn from the result. Positions are world positions.
 */
export function runBistro({ storage = false, store = undefined } = {}) {
	const tree = buildBistro();
	const slots = new Map(tree.map((slot) => [slot.id, structuredClone(slot)]));
	/** What a hand holds: the slot's pose in the world while it is held. */
	const held = new Map();
	const spawned = [];
	const people = new Map();
	const submitted = [];
	const saved = [];
	const teleports = [];
	const writes = { fields: 0, flushes: 0 };
	const state = { slots, held, spawned, people, submitted, saved, teleports, writes, tree, store: store ? structuredClone(store) : undefined };

	const slot = (id, what) => {
		const found = slots.get(id);
		if (!found) throw new Error(`The script touched a slot that does not exist (${what}): ${id}`);
		return found;
	};
	/** The rotation and the place of a slot in the world (scale aside), through its parents and the hand that may hold one of them. */
	const worldOf = (id) => {
		const s = slots.get(id);
		if (held.has(id)) return held.get(id);
		if (!s.parentId) return { position: s.position, rotation: s.rotation };
		const parent = worldOf(s.parentId);
		const p = slots.get(s.parentId);
		// A child's place is scaled by its parent's own scale (parents here are unscaled groups, but a handle's parent may not be).
		const scaled = [s.position[0] * p.scale[0], s.position[1] * p.scale[1], s.position[2] * p.scale[2]];
		const at = qrot(parent.rotation, scaled);
		return { position: [parent.position[0] + at[0], parent.position[1] + at[1], parent.position[2] + at[2]], rotation: qmul(parent.rotation, s.rotation) };
	};
	const toLocal = (id, world) => {
		const s = slots.get(id);
		if (!s.parentId) return world;
		const parent = worldOf(s.parentId);
		const p = slots.get(s.parentId);
		const d = qrot(qinv(parent.rotation), [world.position[0] - parent.position[0], world.position[1] - parent.position[1], world.position[2] - parent.position[2]]);
		return { position: [d[0] / p.scale[0], d[1] / p.scale[1], d[2] / p.scale[2]], rotation: qmul(qinv(parent.rotation), world.rotation) };
	};
	const view = (w) => ({ position: [...w.position], rotation: [...w.rotation], forward: qrot(w.rotation, [0, 0, 1]), up: qrot(w.rotation, [0, 1, 0]), right: qrot(w.rotation, [1, 0, 0]) });
	const isHeld = (id) => held.has(id);
	const enabled = (id) => { for (let s = slots.get(id); s; s = s.parentId ? slots.get(s.parentId) : null) if (s.disabled) return false; return true; };

	const makeCtx = (selfId) => ({
		self: {
			id: selfId,
			getSlot: () => slots.get(selfId),
			getComponent: (type) => find(slots.get(selfId), type),
			getWorldPosition: () => [...worldOf(selfId).position]
		},
		hierarchy: {
			getSlot: (id) => slots.get(id),
			getChildren: (parentId) => [...slots.values()].filter((s) => s.parentId === parentId),
			getWorldPose: (id) => (slots.has(id) ? view(worldOf(id)) : undefined)
		},
		grab: { isSlotHeld: isHeld, isHeld: () => isHeld(selfId), heldBy: () => [] },
		world: {
			isHost: () => true,
			spawn: (partial, options) => { spawned.push({ ...structuredClone(partial), ephemeral: Boolean(options?.ephemeral) }); },
			setSlotEnabled(id, on) { const s = slot(id, 'setSlotEnabled'); if (!!s.disabled === !on) return false; if (on) delete s.disabled; else s.disabled = true; return true; },
			setWorldPose(id, pose) {
				const s = slot(id, 'setWorldPose');
				if (isHeld(id)) return false;
				const now = worldOf(id);
				const local = toLocal(id, { position: pose.position ?? now.position, rotation: pose.rotation ?? now.rotation });
				s.position = [...local.position];
				s.rotation = [...local.rotation];
				if (pose.scale) s.scale = [...pose.scale];
				return true;
			},
			setLocalPose(id, pose) {
				const s = slot(id, 'setLocalPose');
				if (isHeld(id)) return false;
				for (const v of [pose.position, pose.rotation, pose.scale]) if (v && !v.every(Number.isFinite)) throw new Error(`A pose with a number that is not one, for ${id}`);
				if (pose.scale && !pose.scale.every((v) => v > 0)) throw new Error(`A scale that is not positive, for ${id}`);
				if (pose.position) s.position = [...pose.position];
				if (pose.rotation) s.rotation = [...pose.rotation];
				if (pose.scale) s.scale = [...pose.scale];
				return true;
			},
			setParent(id, parentId) {
				const s = slot(id, 'setParent');
				if (parentId) slot(parentId, 'setParent to');
				if (isHeld(id)) return false;
				const world = worldOf(id);
				s.parentId = parentId;
				const local = toLocal(id, world);
				s.position = [...local.position];
				s.rotation = [...local.rotation];
				return true;
			},
			setComponent(id, component) {
				const s = slot(id, 'setComponent');
				const at = s.components.findIndex((c) => c.type === component.type);
				if (at < 0) s.components.push(structuredClone(component)); else s.components[at] = structuredClone(component);
				return true;
			},
			removeComponent(id, type) {
				const s = slot(id, 'removeComponent');
				const before = s.components.length;
				s.components = s.components.filter((c) => c.type !== type);
				return s.components.length !== before;
			},
			setComponentField(id, type, field, value, broadcast) {
				const component = find(slot(id, 'setComponentField'), type);
				if (!component) throw new Error(`${id} has no ${type}`);
				component[field] = structuredClone(value);
				writes.fields++;
				if (id === ID.flush && broadcast) writes.flushes++;
				else if (broadcast !== false) throw new Error(`A write to ${id}.${type}.${field} that sends a whole snapshot by itself`);
			},
			getPlayer(grabberId) {
				const id = grabberId.includes(':') ? grabberId.split(':')[0] : 'host';
				return { id, name: people.get(id)?.name ?? id };
			},
			getPlayers: () => [...people.values()].map((p) => ({ id: p.id, name: p.name, role: p.id === 'host' ? 'host' : 'guest' })),
			getPlayerPose: (id) => (people.has(id) ? { head: view({ position: people.get(id).head, rotation: [0, 0, 0, 1] }) } : null),
			teleportPlayer(id, target) {
				const p = people.get(id);
				if (!p) return false;
				teleports.push({ id, ...structuredClone(target) });
				p.head = [target.position[0], target.position[1] + 1.6, target.position[2]];
				return true;
			}
		},
		math: {},
		storage: storage
			? {
					available: true,
					player: (who) => {
						const id = typeof who === 'string' ? who : who.id;
						return {
							get: async (key, fallback) => state.store?.[id]?.[key] ?? fallback,
							set: async (key, value) => { (state.store ??= {})[id] ??= {}; state.store[id][key] = structuredClone(value); saved.push([id, key]); }
						};
					}
				}
			: { available: false, player: () => ({ get: async (_k, fallback) => fallback, set: async () => {} }) },
		leaderboards: {
			available: storage,
			submit: async (name, who, score) => { submitted.push({ name, who, score }); return null; },
			showOn: async () => []
		},
		log: () => {}
	});

	const realNow = Date.now;
	Date.now = () => 1700000000000;
	const scripts = new Map();
	try {
		for (const s of slots.values()) {
			const code = find(s, 'codeBlock');
			if (code) scripts.set(s.id, new Function('ctx', code.code)(makeCtx(s.id)));
		}
	} finally { Date.now = realNow; }
	const handlers = scripts.get(ID.root);
	const game = handlers.__debug;
	handlers.onSpawn?.();

	Object.assign(state, {
		handlers, game, scripts, DT,
		async addPlayer(id, name = id, head = [0, 1.6, -6]) {
			people.set(id, { id, name, head: [...head] });
			await handlers.onPlayerReady({ id, name });
		},
		async removePlayer(id) { const p = people.get(id); people.delete(id); handlers.onPlayerLeft?.({ id, name: p?.name ?? id }); },
		/** Puts a player's head somewhere (y is their eyes). */
		stand(id, x, z) { people.get(id).head = [x, 1.6, z]; },
		async tick(seconds = DT) {
			const steps = Math.max(1, Math.round(seconds / DT));
			for (let i = 0; i < steps; i++) { handlers.tick(DT); await Promise.resolve(); }
		},
		press(button, who = 'host') {
			if (!slots.has(button)) throw new Error(`No button ${button}`);
			handlers.onUIEvent({ type: 'press', slotId: button, ...(who === 'host' ? {} : { remoteGuestId: who }) });
		},
		text: (id) => find(slots.get(id), 'uiElement').text,
		ui: (id) => find(slots.get(id), 'uiElement'),
		field: (id, type, name) => find(slots.get(id), type)[name],
		/** Where a slot is in the world. */
		pos: (id) => [...worldOf(id).position],
		yaw: (id) => yawOf(worldOf(id).rotation),
		enabled,
		isGrabbable: (id) => { for (let s = slots.get(id); s; s = s.parentId ? slots.get(s.parentId) : null) if (find(s, 'grabbable')) return s.id; return null; },
		/** A hand takes hold of a slot (as the engine would allow: it, or a parent of it, has to be grabbable) and holds it where it is. */
		grab(id) {
			const target = state.isGrabbable(id);
			if (!target || !enabled(target)) throw new Error(`${id} cannot be picked up`);
			if (held.has(target)) throw new Error(`${target} is already in a hand`);
			held.set(target, worldOf(target));
			return target;
		},
		/** Moves what a hand holds. */
		carryTo(id, position, yaw = undefined) {
			const w = held.get(id);
			if (!w) throw new Error(`${id} is not in a hand`);
			held.set(id, { position: [...position], rotation: yaw === undefined ? w.rotation : [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] });
		},
		/** The hand opens: the slot stays where it is, as the engine leaves it. */
		release(id) {
			const w = held.get(id);
			if (!w) throw new Error(`${id} is not in a hand`);
			held.delete(id);
			const local = toLocal(id, w);
			const s = slots.get(id);
			s.position = [...local.position];
			s.rotation = [...local.rotation];
		},
		/** Picks a thing up, carries it to a place and lets go, with the game running in between. */
		async carry(id, to, yaw) {
			const target = state.grab(id);
			await state.tick(DT * 2);
			state.carryTo(target, to, yaw);
			await state.tick(DT * 2);
			state.release(target);
			await state.tick(DT * 2);
			return target;
		},
		/** Pulls the trigger of a held knife. */
		pull(knifeId) { scripts.get(knifeId).onTrigger({ phase: 'press', hand: 'right', playerId: 'host', playerName: 'Host', value: 1 }); },
		station: (model, n = 0) => game.stations.filter((st) => st.model === model)[n],
		/** A point over a spot of an appliance: where a hand would hold something to put it there. */
		over: (st, k = 0) => { const p = game.spotAt(st, k); return [p[0], p[1] + 0.25, p[2]]; },
		sounds: () => spawned.filter((entry) => entry.components[0].type === 'impactSound'),
		/** The world as it is now, as a tree that can be drawn. */
		snapshot() {
			return [...slots.values()].map((s) => {
				if (!held.has(s.id)) return s;
				const w = held.get(s.id);
				return { ...s, parentId: null, position: w.position, rotation: w.rotation };
			});
		}
	});
	void ITEM_REST; void PLATE_REST; void compose; void invert; void multiply; void transformPoint;
	return state;
}
