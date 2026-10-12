import { buildDeadDrop } from '../../src/lib/xr/templates/deadDrop.ts';
import { ID } from '../../src/lib/xr/templates/deadDropKit.ts';
import { POOLS, TUNING } from '../../src/lib/xr/templates/deadDropData.ts';

export const DT = 1 / 60;
const find = (slot, type) => slot.components.find((c) => c.type === type);
const rotateBy = (q, v) => {
	const [x, y, z, w] = q;
	const cx = y * v[2] - z * v[1], cy = z * v[0] - x * v[2], cz = x * v[1] - y * v[0];
	return [v[0] + 2 * (w * cx + y * cz - z * cy), v[1] + 2 * (w * cy + z * cx - x * cz), v[2] + 2 * (w * cz + x * cy - y * cx)];
};
const yawPitch = (yaw, pitch = 0) => {
	const a = [Math.sin(pitch / 2), 0, 0, Math.cos(pitch / 2)], b = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
	// yaw applied after pitch
	return [b[3] * a[0] + b[0] * a[3] + b[1] * a[2] - b[2] * a[1], b[3] * a[1] - b[0] * a[2] + b[1] * a[3] + b[2] * a[0], b[3] * a[2] + b[0] * a[1] - b[1] * a[0] + b[2] * a[3], b[3] * a[3] - b[0] * a[0] - b[1] * a[1] - b[2] * a[2]];
};
const view = (position, rotation) => ({ position: [...position], rotation, forward: rotateBy(rotation, [0, 0, 1]), up: rotateBy(rotation, [0, 1, 0]), right: rotateBy(rotation, [1, 0, 0]) });

/**
 * Dead Drop's director running against a stand-in for the engine: the real walls (so sight and shots are blocked as in the game),
 * players with a head that can be put anywhere, guns that can be equipped and fired, teleporting, and a record of what the
 * script asked of the world. Positions are world positions.
 */
export function runDeadDrop({ storage = false, store = undefined } = {}) {
	const tree = buildDeadDrop();
	const slots = new Map(tree.map((slot) => [slot.id, structuredClone(slot)]));
	const poses = new Map();
	const localPoses = new Map();
	const spawned = [];
	const teleports = [];
	const logs = [];
	const flushes = [];
	const people = new Map();
	const unknown = [];
	const submitted = [];
	const saved = [];
	const initialStore = store ? structuredClone(store) : undefined;

	const slot = (id, what) => {
		const found = slots.get(id);
		if (!found) { unknown.push(`${what}: ${id}`); throw new Error(`The script touched a slot that does not exist (${what}): ${id}`); }
		return found;
	};
	const enabled = (id) => {
		for (let s = slots.get(id); s; s = s.parentId ? slots.get(s.parentId) : null) if (s.disabled) return false;
		return true;
	};
	const worldPos = (id) => poses.get(id) ?? slots.get(id)?.position ?? [0, 0, 0];

	// An axis-aligned box for every solid slot that stands in the world (walls, props): enough to tell what blocks sight and shots.
	const solids = () => [...slots.values()].filter((s) => s.parentId === null && find(s, 'collider') && find(s, 'meshRenderer') && enabled(s.id) && s.id !== 'dd-floor' && s.id !== 'dd-r-floor');
	const rayBox = (o, d, s) => {
		const half = [s.scale[0] / 2, s.scale[1] / 2, s.scale[2] / 2];
		let tmin = 0, tmax = Infinity;
		for (let i = 0; i < 3; i++) {
			const lo = s.position[i] - half[i], hi = s.position[i] + half[i];
			if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo || o[i] > hi) return -1; continue; }
			let t1 = (lo - o[i]) / d[i], t2 = (hi - o[i]) / d[i];
			if (t1 > t2) [t1, t2] = [t2, t1];
			tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
			if (tmin > tmax) return -1;
		}
		return tmin;
	};
	const ignored = (id, ignore) => {
		for (let s = slots.get(id); s; s = s.parentId ? slots.get(s.parentId) : null) if (ignore.includes(s.id)) return true;
		return false;
	};

	const state = {
		slots, poses, localPoses, spawned, teleports, logs, flushes, people, submitted, saved, unknown, tree, store: initialStore,
		/** The fake ctx's idea of where a player is: head position and where they look (yaw, pitch). */
		addPlayer(id, name = id, head = [0, 1.6, 0], yaw = 0) {
			people.set(id, { id, name, head: [...head], yaw, pitch: 0, hands: null });
			state.handlers.onPlayerReady?.({ id, name });
			return people.get(id);
		}
	};
	const personPose = (p) => {
		const rotation = yawPitch(p.yaw, p.pitch);
		return { head: view(p.head, rotation), ...(p.hands ? { left: view(p.hands.left, rotation), right: view(p.hands.right, rotation) } : {}) };
	};
	// The gun of a player is where their right hand is: a little in front of and below the head, pointing where they look.
	const gunOwner = (gunIndex) => [...people.values()].find((p) => p.gun === gunIndex);

	const ctx = {
		self: { id: ID.director },
		hierarchy: {
			getSlot: (id) => slots.get(id),
			getChildren: (parentId) => [...slots.values()].filter((s) => s.parentId === parentId),
			getWorldPose: (id) => {
				const muzzle = /^dd-gun-(\d)-muzzle$/.exec(id);
				if (muzzle) {
					const owner = gunOwner(Number(muzzle[1]));
					if (!owner) return view(worldPos(id), [0, 0, 0, 1]);
					const pose = personPose(owner).head;
					// In the line of sight, as a player who is aiming holds it, so that looking at a point is aiming at it; in a headset, in the right hand.
					const base = owner.hands ? owner.hands.right : pose.position;
					const at = [base[0] + pose.forward[0] * 0.5, base[1] + pose.forward[1] * 0.5, base[2] + pose.forward[2] * 0.5];
					return view(at, pose.rotation);
				}
				return slots.has(id) ? view(worldPos(id), [0, 0, 0, 1]) : undefined;
			}
		},
		grab: { isSlotHeld: () => false, isHeld: () => false, heldBy: () => [] },
		equip: { isEquipped: () => false, holder: () => null },
		world: {
			isHost: () => true,
			spawn(partial, options) {
				const entry = { id: partial.id ?? `spawned-${spawned.length}`, parentId: null, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components: [], ...structuredClone(partial) };
				spawned.push({ ...entry, ephemeral: Boolean(options?.ephemeral) });
				if (!options?.ephemeral) slots.set(entry.id, entry);
			},
			deleteSlot: (id) => slots.delete(id),
			setSlotEnabled(id, on) { const s = slot(id, 'setSlotEnabled'); if (on) delete s.disabled; else s.disabled = true; return true; },
			setWorldPose(id, pose) {
				slot(id, 'setWorldPose');
				if (pose.position) poses.set(id, [...pose.position]);
				if (pose.rotation) poses.set(`${id}:rotation`, [...pose.rotation]);
				if (pose.scale) poses.set(`${id}:scale`, [...pose.scale]);
				return true;
			},
			setLocalPose(id, pose) { slot(id, 'setLocalPose'); localPoses.set(id, structuredClone(pose)); return true; },
			setComponentField(id, type, field, value, broadcast) {
				const component = find(slot(id, 'setComponentField'), type);
				if (!component) { unknown.push(`no ${type} on ${id}`); throw new Error(`${id} has no ${type}`); }
				component[field] = structuredClone(value);
				if (id === ID.flush && broadcast) flushes.push(value.n);
			},
			raycast(origin, direction, maxDistance, options = {}) {
				const ignore = options.ignore ?? [];
				let best = null;
				for (const s of solids()) {
					if (ignored(s.id, ignore)) continue;
					const t = rayBox(origin, direction, s);
					if (t >= 0 && t <= maxDistance && (!best || t < best.t)) best = { t, slotId: s.id };
				}
				return best ? { slotId: best.slotId, point: [origin[0] + direction[0] * best.t, origin[1] + direction[1] * best.t, origin[2] + direction[2] * best.t], normal: [0, 1, 0], u: 0, v: 0 } : null;
			},
			getPlayer(grabberId) {
				const id = grabberId.includes(':') ? grabberId.split(':')[0] : 'host';
				return { id, name: people.get(id)?.name ?? id };
			},
			getPlayers: () => [...people.values()].map((p) => ({ id: p.id, name: p.name, role: p.id === 'host' ? 'host' : 'guest' })),
			getPlayerPose: (id) => (people.has(id) ? personPose(people.get(id)) : null),
			teleportPlayer(id, target) {
				const p = people.get(id);
				if (!p) return false;
				teleports.push({ id, ...structuredClone(target) });
				p.head = [target.position[0], target.position[1] + 1.6, target.position[2]];
				if (target.yaw !== undefined) p.yaw = target.yaw;
				return true;
			}
		},
		math: {},
		storage: storage
			? { available: true, player: (id) => ({ get: async (key, fallback) => (state.store?.[id]?.[key] ?? fallback), set: async (key, value) => { (state.store ??= {})[id] ??= {}; state.store[id][key] = structuredClone(value); saved.push([id, key]); } }) }
			: { available: false, player: () => ({ get: async (_k, fallback) => fallback, set: async () => {} }) },
		leaderboards: { available: true, submit: async (name, who, score) => { submitted.push({ name, who, score }); return null; } },
		log: (message) => logs.push(message)
	};
	const code = find(slots.get(ID.director), 'codeBlock').code;
	// The script seeds its dice from the clock when it starts; a fixed clock then makes every run of a test the same.
	const realNow = Date.now;
	Date.now = () => 1700000000000;
	let handlers;
	try { handlers = new Function('ctx', code)(ctx); } finally { Date.now = realNow; }
	state.handlers = handlers;
	state.ctx = ctx;
	state.game = handlers.__debug;
	Object.assign(state, {
		DT,
		/** Runs the game for `seconds`. */
		async tick(seconds = DT) {
			const steps = Math.max(1, Math.round(seconds / DT));
			for (let i = 0; i < steps; i++) { handlers.tick(DT); await Promise.resolve(); }
		},
		/** The player takes a gun from the rack, equipped. */
		equip(id) {
			const p = people.get(id);
			const index = [0, 1, 2, 3].find((i) => !gunOwner(i));
			p.gun = index;
			const brain = find(slots.get(`dd-gun-${index}-brain`), 'scriptState');
			brain.data = { ...brain.data, equipped: true, playerId: id, name: p.name, hand: 'right', seq: brain.data.seq ?? 0, down: false };
			return index;
		},
		brain: (id) => find(slots.get(`dd-gun-${people.get(id).gun}-brain`), 'scriptState'),
		press(button, id = 'host') {
			handlers.onUIEvent({ type: 'press', slotId: button, ...(id === 'host' ? {} : { remoteGuestId: id }) });
		},
		message: () => find(slots.get(ID.message), 'uiElement').text,
		ui: (id) => find(slots.get(id), 'uiElement').text,
		/** Looks at a point (or along yaw and pitch). */
		look(id, target) {
			const p = people.get(id);
			const d = [target[0] - p.head[0], target[1] - p.head[1], target[2] - p.head[2]];
			p.yaw = Math.atan2(d[0], d[2]);
			p.pitch = -Math.atan2(d[1], Math.hypot(d[0], d[2]));
		},
		move(id, head) { people.get(id).head = [...head]; },
		/** Pulls the trigger once (a press and a release). */
		async shoot(id, { hold = 0.05 } = {}) {
			const brain = state.brain(id);
			brain.data = { ...brain.data, seq: brain.data.seq + 1, down: true };
			await state.tick(hold);
			brain.data = { ...brain.data, down: false };
			await state.tick(DT);
		},
		hold(id, down) { const brain = state.brain(id); brain.data = { ...brain.data, down, seq: down ? brain.data.seq + 1 : brain.data.seq }; },
		/** Sends a radial-menu command as the gun's script does. */
		command(id, cmd, gun) {
			const p = people.get(id);
			const entry = { id: `cmd-${slots.size}`, parentId: ID.commands, name: 'Command', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components: [{ type: 'scriptState', data: { cmd, gun: gun ?? p.gun, player: id } }] };
			slots.set(entry.id, entry);
		},
		/** Joins and starts a raid on `seed`, for the players given (all must have a gun equipped). */
		async startRaid(ids, seed = 1234) {
			handlers.__debug.setSeed(seed);
			for (const id of ids) state.press(ID.join, id);
			state.press(ID.start, ids[0]);
			await state.tick(DT);
		},
		enabled,
		pos: (id) => poses.get(id) ?? slots.get(id)?.position,
		enemies: () => state.game.R.enemies,
		live: (kind) => state.game.R.enemies.filter((e) => !e.dead && (!kind || e.kind === kind)),
		player: (id) => state.game.players.get(id),
		person: (id) => people.get(id),
		pips: () => null,
		sounds: () => spawned.filter((s) => find(s, 'impactSound')),
		bursts: () => spawned.filter((s) => find(s, 'particleBurst')),
		/** Puts a player in a cell of the raid, standing. */
		stand(id, cx, cz, dx = 0, dz = 0) {
			const centre = [400 + (cx - 1) * 10, 0, (cz - 1) * 10];
			state.move(id, [centre[0] + dx, 1.6, centre[2] + dz]);
		}
	});
	void POOLS; void TUNING;
	return state;
}
