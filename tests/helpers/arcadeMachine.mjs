import { toWorld } from '../../src/lib/xr/templates/arcadeKit.ts';

export const DT = 1 / 60;
const find = (slot, type) => slot.components.find((c) => c.type === type);

/**
 * Runs the script of one arcade machine against a stand-in for the engine: slots that can be written, poses that can be
 * set, hands that hold things, and a leaderboard. Positions given to the helpers are in the machine's own coordinates.
 */
export function runMachine({ tree, frame, panelId, leaderboards = true }) {
	const slots = new Map(tree.map((slot) => [slot.id, structuredClone(slot)]));
	const poses = new Map();
	const held = new Set();
	const spawned = [];
	const enabled = new Map();
	const submitted = [];
	const logs = [];
	const worldPos = (id) => poses.get(id) ?? slots.get(id)?.position ?? [0, 0, 0];
	const ctx = {
		self: { id: panelId },
		hierarchy: {
			getSlot: (id) => slots.get(id),
			getWorldPose: (id) => (slots.has(id) ? { position: [...worldPos(id)], rotation: [0, 0, 0, 1], forward: [0, 0, 1], up: [0, 1, 0], right: [1, 0, 0] } : undefined)
		},
		grab: { isSlotHeld: (id) => held.has(id), isHeld: () => false, heldBy: () => [] },
		world: {
			isHost: () => true,
			setComponentField(id, type, field, value) {
				const component = slots.get(id)?.components.find((c) => c.type === type);
				if (component) component[field] = structuredClone(value);
			},
			setWorldPose(id, pose) {
				if (held.has(id)) return false;
				if (pose.position) poses.set(id, [...pose.position]);
				return true;
			},
			setSlotEnabled: (id, value) => { enabled.set(id, value); return true; },
			spawn: (partial) => { spawned.push(structuredClone(partial)); },
			getPlayer: (grabberId) => {
				const id = grabberId.includes(':') ? grabberId.split(':')[0] : 'me';
				return { id, name: id === 'me' ? 'Me' : id[0].toUpperCase() + id.slice(1) };
			}
		},
		math: { quatFromAxisAngle: () => [0, 0, 0, 1], quatMultiply: (a) => a },
		leaderboards: {
			available: leaderboards,
			submit: async (name, who, score, options) => { submitted.push({ name, who, score, options }); return null; },
			best: async () => null,
			showOn: async () => []
		},
		log: (message) => logs.push(message)
	};
	const code = find(slots.get(panelId), 'codeBlock').code;
	const handlers = new Function('ctx', code)(ctx);
	const state = {
		slots, poses, held, spawned, enabled, submitted, logs, handlers, ctx, frame,
		text: (id) => find(slots.get(id), 'uiElement').text,
		board: (id) => find(slots.get(id), 'scoreboard'),
		rows: (id) => find(slots.get(id), 'scoreboard').rows,
		/** Sounds and sparks the machine has made. */
		sounds: () => spawned.filter((entry) => entry.components[0].type === 'impactSound'),
		bursts: () => spawned.filter((entry) => entry.components[0].type === 'particleBurst'),
		local: (id) => {
			const p = worldPos(id);
			const x = p[0] - frame.o[0], z = p[2] - frame.o[2];
			return [x * frame.r[0] + z * frame.r[2], p[1] - frame.o[1], x * frame.d[0] + z * frame.d[2]];
		},
		placeLocal: (id, local) => poses.set(id, toWorld(frame, local)),
		holderOf: (id, holder) => { const s = find(slots.get(id), 'scriptState'); if (s) s.data = { holder }; },
		async tick(seconds = DT, steps = Math.max(1, Math.round(seconds / DT))) {
			for (let i = 0; i < steps; i++) { handlers.tick(DT); await Promise.resolve(); }
		},
		/** A player presses one of the panel's buttons; a guest is given by id, the host by default. */
		press(slotId, guest) {
			handlers.onUIEvent({ type: 'press', slotId, ...(guest ? { remoteGuestId: guest } : {}) });
			handlers.tick(DT);
		},
		/** A player picks something up, moves it along a path (machine coordinates, positions per frame), and lets go. */
		async carry(id, holder, path) {
			state.holderOf(id, holder);
			held.add(id);
			for (const point of path) { poses.set(id, toWorld(frame, point)); handlers.tick(DT); await Promise.resolve(); }
		},
		async release(id) { held.delete(id); handlers.tick(DT); await Promise.resolve(); },
		/** Throws something from `from` at `velocity` (both in machine coordinates) as a hand would: a short run-up, then let go. */
		async throwFrom(id, holder, from, velocity, steps = 7) {
			const path = [];
			for (let i = 0; i < steps; i++) { const t = (i - (steps - 1)) * DT; path.push([from[0] + velocity[0] * t, from[1] + velocity[1] * t, from[2] + velocity[2] * t]); }
			await state.carry(id, holder, path);
			await state.release(id);
		}
	};
	handlers.onPlayerReady?.({ id: 'me', name: 'Me' });
	return state;
}

/** The velocity (machine coordinates) that takes a body launched from `from` under `gravity` through `target` after `time` seconds. */
export function aim(from, target, time, gravity) {
	return [(target[0] - from[0]) / time, (target[1] - from[1]) / time + 0.5 * gravity * time, (target[2] - from[2]) / time];
}
