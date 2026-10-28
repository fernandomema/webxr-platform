import { createTestWorld } from '../../packages/engine/src/testing.ts';
import { buildRounds } from '../../examples/rounds-vr/src/world/index.ts';
import { loadMapFragments, writeMapFragments } from '../../examples/rounds-vr/src/world/fragments.ts';
import { prepareScripts } from '../../examples/rounds-vr/src/world/script.ts';
import { ARENA, LOBBY, TUNING } from '../../examples/rounds-vr/src/world/data.ts';
import { ID } from '../../examples/rounds-vr/src/world/kit.ts';

// The maps are files of the game, and the world names them by hash: they exist before the world is built.
writeMapFragments();
await prepareScripts();
export const fragments = loadMapFragments();

export const DT = 1 / 60;
const find = (slot, type) => slot.components.find((c) => c.type === type);

/**
 * ROUNDS VR running against the engine's test world (`@kithin/engine/testing`): the real slots, the real scripts (the director, the guns' and
 * shields' brains), players with a head and hands that can be put anywhere, and a record of what the scripts asked of the world. Only what is
 * particular to this game is here: who holds which gun, and the muzzle of a gun following its player's hand.
 */
export function runRounds(options = {}) {
	const tree = buildRounds();
	const world = createTestWorld(tree, { fragments: options.fragments ?? fragments });
	const director = world.run('rd-hub', { now: 1700000000000 });
	// The guns' and shields' brains: what they hear of the hands is what the game reads.
	for (const side of [0, 1]) for (const kind of ['gun', 'shield']) world.run(ID[kind === 'gun' ? 'gunPart' : 'shieldPart'](side, 'brain'));
	const sides = new Map();
	const brainRun = (kind, side) => world.scriptOf(ID[kind === 'gun' ? 'gunPart' : 'shieldPart'](side, 'brain'));
	const brain = (kind, side) => find(world.slots.get(ID[kind === 'gun' ? 'gunPart' : 'shieldPart'](side, 'brain')), 'scriptState');

	/** A gun's muzzle is at the hand of the player who holds it, pointing where the head looks (what the engine does with equipped objects). */
	const syncMuzzles = () => {
		for (const [id, side] of sides) {
			const person = world.players.get(id);
			if (!person) continue;
			const pose = world.poseOf(person);
			const origin = pose.right ?? pose.head;
			const at = [origin.position[0] + pose.head.forward[0] * 0.3, origin.position[1] + pose.head.forward[1] * 0.3, origin.position[2] + pose.head.forward[2] * 0.3];
			world.setPosition(ID.gunPart(side, 'muzzle'), at, pose.head.rotation);
		}
	};

	const state = {
		world, tree, slots: world.slots, director, DT,
		get spawned() { return world.spawned; },
		get teleports() { return world.teleports; },
		get equips() { return world.equips; },
		get unequips() { return world.unequips; },
		get dashOpens() { return world.dashOpens; },
		get played() { return world.audio.played; },
		get unknown() { return world.unknown; },
		get flushes() { return world.flushes; },
		get handlers() { return director.handlers; },
		get ctx() { return director.ctx; }
	};
	const debug = director.handlers.__debug;

	Object.assign(state, {
		game: debug.game, fighters: debug.fighters, bullets: debug.bullets, debug,
		/** Someone arrives in the lobby. `side` is the side whose gun they will take. They hold nothing yet. */
		join(id, side = 0, name = id) {
			world.addPlayer({ id, name, role: world.players.size === 0 ? 'host' : 'guest', head: [LOBBY.spawn[0], LOBBY.spawn[1] + 1.6, LOBBY.spawn[2]] });
			sides.set(id, side);
			director.handlers.onPlayerReady?.({ id, name });
			return world.players.get(id);
		},
		/** The player takes their side's gun and shield themselves, from the radial menu. */
		equipByHand(id) {
			const side = sides.get(id);
			world.equip(id, ID.gun(side), 'right');
			world.equip(id, ID.shield(side), 'left');
		},
		/** A press on a button of the menu, by the player (the host when none is named). */
		press(button, from) {
			director.handlers.onUIEvent({ type: 'press', slotId: ID.ui(button), ...(from ? { remoteGuestId: from } : {}) });
		},
		ui: (name) => find(world.slots.get(ID.ui(name)), 'uiElement'),
		/** Runs the game for `seconds`. */
		tick(seconds = DT) {
			const steps = Math.max(1, Math.round(seconds / DT));
			for (let i = 0; i < steps; i++) { syncMuzzles(); world.tick(DT, DT); }
		},
		/** Runs until the phase is `phase` (or fails after `limit` seconds). */
		untilPhase(phase, limit = 60) {
			for (let t = 0; t < limit; t += DT) { if (debug.game.phase === phase) return true; syncMuzzles(); world.tick(DT, DT); }
			return debug.game.phase === phase;
		},
		person: (id) => world.players.get(id),
		look(id, target) { world.look(id, target); syncMuzzles(); },
		move(id, head) { world.player(id).head = [...head]; syncMuzzles(); },
		/** Aims the head of a player at a point, a little above it to make up for the fall of the bullet. */
		aimAt(id, target, lift = 0) {
			state.look(id, [target[0], target[1] + lift, target[2]]);
		},
		/** Aims so that a bullet of the game (it falls) lands on the point: the way a player has to aim. */
		aimBallistic(id, target) {
			const p = world.player(id);
			const from = [p.head[0], p.head[1] - 0.05, p.head[2]];
			const v = TUNING.bulletSpeed, g = TUNING.bulletGravity, lift = TUNING.bulletLift;
			let t = Math.hypot(target[0] - from[0], target[1] - from[1], target[2] - from[2]) / v, aim = target;
			for (let k = 0; k < 6; k++) {
				aim = [target[0], target[1] + 0.5 * g * t * t - lift * t, target[2]];
				t = Math.hypot(aim[0] - from[0], aim[1] - from[1], aim[2] - from[2]) / v;
			}
			state.look(id, aim);
		},
		/** The rival stands still where it is and does not react, so that a test can shoot it. */
		freezeRival() {
			debug.fighters[1].bot.reactT = 1e9;
		},
		/**
		 * Puts the player and the rival face to face in an open field (a floor and no blocks), the rival standing still. `human` is the head of the player,
		 * `rival` the middle of the rival's body.
		 */
		duel({ human = [-8, 1.6, 0], rival = [-3, 0.4, 0], blocks = false } = {}) {
			debug.setMap(0);
			// A floor with its top at y = 0 (a body's middle rests above it) and nothing else.
			if (!blocks) state.openField();
			state.freezeRival();
			debug.fighters[1].pos = [...rival];
			debug.fighters[1].vel = [0, 0, 0];
			for (const [id, side] of sides) if (side === 0) world.player(id).head = [...human];
			syncMuzzles();
			return state;
		},
		/** Takes the map's blocks away and puts a floor (top at y = 0) in their place. */
		openField() {
			state.ctx.world.setSlotEnabled(ID.map(debug.game.map), false);
			if (!world.slots.has('test-floor')) {
				state.ctx.world.spawn({ id: 'test-floor', name: 'Floor', position: [0, -1, 0], scale: [80, 2, 8], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' } }, { type: 'collider', shape: 'box' }] });
			}
		},
		/** The trigger of the gun of a player goes down or up. */
		trigger(id, down) {
			world.trigger(brainRun('gun', sides.get(id)), { playerId: id, hand: 'right', phase: down ? 'press' : 'release' });
		},
		/** The trigger of the shield of a player is pressed. */
		raiseShield(id) {
			world.trigger(brainRun('shield', sides.get(id)), { playerId: id, hand: 'left', phase: 'press' });
		},
		/** Where a slot is in the world, or its scale (`id:scale`). */
		pos(id) {
			if (id.endsWith(':scale')) return world.node(id.slice(0, -6)).scaling.asArray();
			return world.position(id);
		},
		/** What a player's HUD says in one of its parts (`score`, `ammo`, `shield`, `me-hp`…). */
		hud: (side, key) => find(world.slots.get(`rd-hud-${side}-${key}`), 'uiElement').text,
		hudWidth: (side, key) => find(world.slots.get(`rd-hud-${side}-${key}`), 'uiElement').width,
		brain,
		/** Someone arrives, presses START, and the game runs until the first point's countdown is over. */
		startFight(id = 'host', side = 0) {
			state.join(id, side);
			state.press('start');
			if (!state.untilPhase('fight', 30)) throw new Error(`The fight never began (${debug.game.phase})`);
			return state;
		}
	});
	return state;
}

export { TUNING, ARENA };
