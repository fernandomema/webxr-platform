import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARENA, CARDS, DIFFICULTY, HUMAN, HUMAN_GRAVITY, HUMAN_JUMP_SPEED, LOBBY, MAPS, MOVEMENT, SCALE, TUNING, WAITING } from '../examples/rounds-vr/src/world/data.ts';
import { buildRounds } from '../examples/rounds-vr/src/world/index.ts';
import { layoutOf } from '../examples/rounds-vr/src/world/layout.ts';
import { mapFragmentSlots } from '../examples/rounds-vr/src/world/fragments.ts';
import { parseFragment, serializeFragment } from '../packages/engine/src/assets/fragment.ts';
import { ID } from '../examples/rounds-vr/src/world/kit.ts';
import { validateWorldScene } from '@kithin/engine/worlds/package';
import { lintUiPanels } from '../packages/engine/src/xr/uiLayout.ts';
import { DT, fragments, runRounds } from './helpers/roundsGame.mjs';

const rival = (game) => game.fighters[1];
/** A solid box in the plane of the fight (as deep as the arena), for a test to stand on, hide behind or shoot at. */
function solid(game, id, [x, y], [w, h]) {
	game.ctx.world.spawn({ id, name: id, position: [x, y, 0], scale: [w, h, 8], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' } }, { type: 'collider', shape: 'box' }] });
}
const aliveBullets = (game) => game.bullets.filter((b) => b.alive);
const centre = (f) => f.pos;

/** Gives a fighter cards, as if it had picked them, and fills it up. */
function give(game, side, ids) {
	const f = game.fighters[side];
	f.cards = ids;
	f.stats = game.debug.computeStats(ids);
	f.maxHp = f.stats.hp; f.hp = f.maxHp; f.ammo = f.stats.ammo; f.livesLeft = f.stats.lives; f.cd = 0;
	return f;
}
/** The player fires once at the given point and the bullets are left to fly for `seconds`. */
function shootAt(game, target, seconds = 0.05) {
	game.aimBallistic('host', target);
	game.trigger('host', true);
	game.tick(0.03);
	game.trigger('host', false);
	game.tick(seconds);
}
/** Where the player stands to shoot into the air: every block is out of the way (open field). */
const SKY = [-8, 14, 0];

/** A fight with the player and the rival face to face in an open field, the rival standing still. */
function duel(options) {
	const game = runRounds();
	game.startFight();
	return game.duel(options);
}
/** Kills a fighter outright and runs until the game has moved on from the point. */
function score(game, winner, until = 'countdown') {
	const [a, b] = game.fighters;
	game.debug.damage(winner === 0 ? b : a, 9999, winner === 0 ? a : b);
	game.tick(DT);
	return game.untilPhase(until, 30);
}

// ---------------------------------------------------------------------------------------------------------------- the world
test('the world is a valid scene and the director compiles', () => {
	const scene = buildRounds();
	validateWorldScene(scene);
	const ids = scene.map((slot) => slot.id);
	assert.equal(new Set(ids).size, ids.length, 'ids are unique');
	for (const slot of scene) for (const component of slot.components) {
		if (component.type === 'codeBlock') assert.doesNotThrow(() => new Function('ctx', component.code), slot.id);
	}
	assert.ok(scene.length < 600, `a headset world stays small (${scene.length} slots): the maps are fragments, built only while they are played`);
	assert.ok(scene.filter((slot) => slot.components.some((c) => c.type === 'pointLight' && !c.baked)).length <= 10, 'live lights are few: the rest are baked');
	assert.equal(scene.flatMap((slot) => slot.components).filter((c) => c.type === 'playerMovement').length, 0, 'the older movement component is not used');
	const body = scene.flatMap((slot) => slot.components).filter((c) => c.type === 'characterController');
	assert.equal(body.length, 1, 'the world sets how players move, once');
	assert.deepEqual([body[0].vrJump, body[0].wallJump, body[0].jumpSpeed, body[0].gravity, body[0].runSpeed, body[0].laneAxis, body[0].laneWidth], [true, true, HUMAN_JUMP_SPEED, HUMAN_GRAVITY, HUMAN.runSpeed, 'z', ARENA.depth], 'the game\'s own jump and run, kept in the plane of the fight');
});

test('every panel of the game fits: nothing asks for more room than the panel has', () => {
	assert.deepEqual(lintUiPanels(buildRounds()), []);
});

test('the maps are the game\'s own: the scenes\' colliders, in metres', () => {
	assert.equal(MAPS.length, 24);
	const first = MAPS[0];
	assert.equal(first.level, 2);
	assert.equal(first.boxes.length, 83, 'level2 has 83 colliders');
	for (const map of MAPS) {
		assert.ok(map.boxes.length >= 14 && map.spawns.length === 2 && map.spawns[0].length === 2, map.name);
		for (const box of map.boxes) assert.ok(box.w > 0 && box.h > 0 && Math.abs(box.a) <= 180);
	}
	assert.ok(Math.abs(MOVEMENT.run - 3.4 * SCALE) < 1e-9 && TUNING.damage === 55 && TUNING.ammo === 3 && TUNING.reload === 2 && TUNING.interval === 0.3, 'the numbers are the game\'s');
});

test('every map is a fragment: its blocks and lights in a file, built only while the map is played, standable and valid', () => {
	const scene = buildRounds();
	const byId = new Map(scene.map((slot) => [slot.id, slot]));
	MAPS.forEach((map, m) => {
		const slots = mapFragmentSlots(m);
		const placed = layoutOf(m);
		assert.equal(placed.length, map.boxes.length + map.circles.length);
		const blocks = slots.filter((slot) => slot.components.some((c) => c.type === 'collider'));
		assert.equal(blocks.length, placed.length, `${map.name}: a solid for every block`);
		for (const slot of blocks) assert.equal(slot.components.find((c) => c.type === 'collider').standable, true, 'a block can be stood on');
		assert.ok(slots.some((slot) => slot.components.some((c) => c.type === 'pointLight' && c.baked)), 'baked lights come with the map');
		assert.equal(parseFragment(serializeFragment(slots)).slots.length, slots.length, 'the file is a valid fragment');
		const owner = byId.get(`rd-map-${m}`);
		assert.equal(owner.components.find((c) => c.type === 'fragment').source.kind, 'asset');
		assert.equal(owner.disabled, m === 0 ? undefined : true, 'only the first is on at the start');
	});
	assert.equal(scene.some((slot) => slot.id.startsWith('rd-blk-') || slot.id.startsWith('rd-pil-')), false, 'no pooled blocks are left in the world');
});

test('every spawn stands on a block, and the director lays out the same blocks as the world says', () => {
	const game = runRounds();
	MAPS.forEach((map, m) => {
		game.debug.setMap(m);
		assert.equal(game.debug.mapReady(m), true, 'the map is built as soon as it is switched on');
		assert.equal([...game.slots.keys()].filter((id) => id.startsWith(`rd-map-${m}::`) && /::(blk|pil)-/.test(id)).length, map.boxes.length + map.circles.length, 'with every one of its blocks');
		for (const variant of [0, 1]) for (const side of [0, 1]) {
			const [x, y] = map.spawns[variant][side];
			const down = game.debug.traceWorld([x, y, 0], [0, -1, 0], 4);
			assert.ok(down && !down.bounds && down.t < 8, `${map.name}: nothing under the spawn ${variant}/${side} (${x.toFixed(1)}, ${y.toFixed(1)})`);
		}
	});
	// The blocks are where the map says, and only the map in play is built.
	game.debug.setMap(5);
	const [x, y, w, h] = [MAPS[5].boxes[0].x, MAPS[5].boxes[0].y, MAPS[5].boxes[0].w, MAPS[5].boxes[0].h];
	const first = ID.mapPart(5, layoutOf(5)[0].id);
	assert.deepEqual(game.pos(first).map((n) => Math.round(n * 1000) / 1000), [x, y, 0].map((n) => Math.round(n * 1000) / 1000));
	assert.deepEqual(game.pos(`${first}:scale`).slice(0, 2).map((n) => Math.round(n * 1000) / 1000), [w, h].map((n) => Math.round(n * 1000) / 1000));
	assert.equal(game.slots.has(ID.mapPart(0, layoutOf(0)[0].id)), false, 'the map that was on is taken down');
});

// --------------------------------------------------------------------------------------------------------- the body of the rival
test('the rival\'s body has the game\'s jump: 4.1 units high and half a second in the air, and runs at 13.6 units a second', () => {
	const game = runRounds();
	game.debug.setMap(0);
	game.openField();
	const f = game.fighters[1];
	const b = f.bot;
	f.pos = [0, T().botRadius + 0.001, 0]; f.vel = [0, 0, 0];
	for (let i = 0; i < 20; i++) game.debug.moveBody(f, 1);
	assert.equal(b.grounded, true, 'it stands');
	const floor = f.pos[1];
	game.debug.botJump(f);
	let top = floor, air = 0;
	for (let i = 0; i < 100; i++) {
		game.debug.moveBody(f, 1);
		top = Math.max(top, f.pos[1]);
		air += M().step;
		if (b.grounded) break;
	}
	assert.ok(Math.abs(top - floor - 4.13 * SCALE) < 4.13 * SCALE * 0.12, `it rose ${(top - floor).toFixed(2)} m`);
	assert.ok(Math.abs(air - 0.5) < 0.08, `it was in the air for ${air.toFixed(2)} s`);
	b.dir = 1;
	for (let i = 0; i < 100; i++) game.debug.moveBody(f, 1);
	assert.ok(Math.abs(f.vel[0] - 13.6 * SCALE) < 13.6 * SCALE * 0.04, `it runs at ${f.vel[0].toFixed(2)} m/s`);
});

test('the rival holds on to a wall it presses against, slides slowly, and a jump throws it up and away', () => {
	const game = runRounds();
	game.debug.setMap(0);
	game.openField();
	solid(game, 'test-wall', [3, 10], [2, 20]);
	const f = game.fighters[1], b = f.bot;
	f.pos = [2 - T().botRadius - 0.02, 8, 0]; f.vel = [0, 0, 0];
	b.dir = 1; b.grounded = false; b.sinceGround = 0.1;
	for (let i = 0; i < 60; i++) game.debug.moveBody(f, 1);
	assert.equal(b.grab, true, 'it holds on');
	assert.ok(f.vel[1] > -3 * SCALE && f.vel[1] < 0, `it slides at ${f.vel[1].toFixed(2)} m/s`);
	const before = f.pos[1];
	assert.equal(game.debug.botJump(f), true);
	for (let i = 0; i < 6; i++) game.debug.moveBody(f, 1);
	assert.ok(f.pos[1] > before + 0.5 && f.vel[0] < 0 || f.pos[0] < 2 - T().botRadius - 0.02, 'up, and away from the wall');
});

test('nothing the rival does puts it inside a block, on any map', () => {
	for (const m of [0, 3, 7, 12, 19]) {
		const game = runRounds();
		game.startFight();
		game.debug.setMap(m);
		game.debug.beginPoint(0);
		game.untilPhase('fight', 20);
		const f = rival(game);
		f.bot.reactT = 0;
		for (let t = 0; t < 20; t += DT) {
			game.tick(DT);
			game.fighters[0].hp = 100;
			const hit = game.ctx.physics.overlapSphere(f.pos, T().botRadius * 0.8, { ignore: ['rd-bot-0', 'rd-bot-1', 'rd-pad-0', 'rd-pad-1', 'rd-pad-ring-0', 'rd-pad-ring-1', 'rd-depth-n', 'rd-depth-s', 'rd-end-w', 'rd-end-e', 'rd-ceiling'] }).some((c) => c.depth > 0.15);
			assert.equal(hit, false, `${MAPS[m].name}: inside a block at ${f.pos.map((n) => n.toFixed(2))}`);
		}
	}
});

// Maps the rival can find its way across (the others have places only a player can reach).
const NAVIGABLE = MAPS.map((_, m) => m).filter((m) => ![17, 20, 22].includes(m));
for (const m of [0, 1, 2, 4, 6, 9, 13, 19]) {
	test(`the rival finds the player on ${MAPS[m].name}: it climbs and jumps to get a clear line`, () => {
		assert.ok(NAVIGABLE.includes(m));
		const game = runRounds();
		game.join('host', 0); game.press('start'); game.untilPhase('fight', 30);
		game.debug.setMap(m);
		game.debug.beginPoint(0);
		game.untilPhase('fight', 20);
		const f = rival(game);
		f.bot.reactT = 0.2;
		let seen = -1;
		for (let t = 0; t < 60 && seen < 0; t += 1 / 30) {
			game.handlers.tick(1 / 30);
			game.fighters[0].hp = 100;
			if (f.bot.seen) seen = t;
		}
		assert.ok(seen >= 0, `${MAPS[m].name}: the rival never saw the player in 60 s (it was at ${f.pos.map((n) => n.toFixed(1))})`);
	});
}

// ------------------------------------------------------------------------------------------------------------------------ menu
test('the game starts in a menu: nothing is equipped, the rival waits, and choosing does not start anything', () => {
	const game = runRounds();
	game.join('host');
	game.tick(5);
	assert.equal(game.game.phase, 'menu');
	assert.equal(game.fighters.some((f) => f.human), false);
	assert.deepEqual(game.pos('rd-bot-1'), [0, -200, 0], 'the rival is not in the arena');
	assert.equal(game.equips.length, 0, 'no gear is given before START');
	assert.deepEqual(game.pos('rd-gun-0'), WAITING[0], 'the gear waits out of the way: there is no rack to take it from');
	assert.equal(game.ui('start').background, '#22c55e');
	game.press('rival-2');
	game.press('match-0');
	game.tick(0.2);
	assert.equal(game.game.phase, 'menu');
	assert.equal(game.ui('rival-2').background, '#f97316', 'the choice is painted');
	assert.equal(game.ui('rival-1').background, '#1e1748');
	assert.equal(game.ui('match-0').background, '#f97316');
});

test('the menu says who plays from who is in the room, and the button invites when there is nobody else', () => {
	const game = runRounds();
	game.join('host', 0, 'Ana');
	game.tick(1);
	assert.equal(game.ui('p0').text, 'Ana');
	assert.equal(game.ui('p1').text, 'RIVAL BOT');
	assert.equal(game.ui('invite').visible, true);
	game.press('invite');
	assert.deepEqual(game.dashOpens, [{ tab: 'session', options: { invite: true } }], 'the invitation of the engine opens');
	game.join('bea', 1, 'Bea');
	game.tick(1);
	assert.equal(game.ui('p1').text, 'Bea', 'the room decides, with no choice to make');
	assert.equal(game.ui('invite').visible, false, 'nobody left to invite');
	game.press('invite');
	assert.equal(game.dashOpens.length, 1, 'with the room full there is nothing to invite');
});

test('START gives the gear by itself, waits a moment, counts down, and only then does the rival act', () => {
	const game = runRounds();
	game.join('host');
	game.press('start');
	game.tick(0.1);
	assert.equal(game.game.phase, 'ready');
	assert.deepEqual(game.equips.map((e) => [e.slotId, e.hand]), [['rd-gun-0', 'right'], ['rd-shield-0', 'left']], 'the gun in the right hand and the shield in the left');
	assert.equal(game.ui('start').background, '#475569', 'START is greyed while it starts');
	assert.ok(game.untilPhase('countdown', 5));
	assert.equal(game.fighters[0].human, true);
	assert.equal(game.fighters[1].human, false, 'the other side is the rival');
	const spawn = game.debug.spawnOf(0);
	assert.ok(Math.abs(game.teleports.at(-1).position[0] - spawn[0]) < 1e-9, 'the player is put on their pad');
	game.tick(TUNING.countdown - 0.5);
	assert.equal(game.game.phase, 'countdown');
	assert.equal(aliveBullets(game).length, 0);
	assert.ok(game.pos('rd-banner-0')[1] > -100, 'a number hangs in front of the player');
	assert.ok(game.untilPhase('fight', 2));
	assert.equal(game.fighters[1].bot.reactT > 0, true, 'and the rival still takes a moment to react');
});

test('if the gear cannot be given, START puts it in front of the player and waits for them to equip it', () => {
	const game = runRounds();
	game.join('host');
	game.person('host').desktop = true; // no left hand: the shield cannot be given, but the gun can
	game.press('start');
	assert.ok(game.untilPhase('countdown', 5), 'a desktop player gets the gun and plays');
	const stuck = runRounds();
	stuck.join('ghost');
	stuck.ctx.world.equipPlayer = () => false;
	stuck.press('start', 'ghost');
	stuck.tick(5);
	assert.equal(stuck.game.phase, 'ready');
	assert.match(stuck.ui('status').text, /radial menu/);
	assert.ok(stuck.pos('rd-gun-0')[1] > 0 && Math.abs(stuck.pos('rd-gun-0')[2] - LOBBY.spawn[2]) < 2, 'the gun is where the player can take it');
	stuck.equipByHand('ghost');
	assert.ok(stuck.untilPhase('countdown', 5), 'and it goes on once they equip it');
});

test('the rival is slower and wilder at the levels you choose', () => {
	assert.ok(DIFFICULTY[0].aimError > DIFFICULTY[1].aimError && DIFFICULTY[1].aimError > DIFFICULTY[2].aimError);
	assert.ok(DIFFICULTY[0].reaction > DIFFICULTY[2].reaction && DIFFICULTY[0].turn < DIFFICULTY[2].turn);
	const wait = (button) => {
		const game = runRounds();
		game.join('host');
		game.press(button);
		game.press('start');
		game.untilPhase('fight', 10);
		return game.fighters[1].bot.reactT;
	};
	assert.ok(wait('rival-0') > wait('rival-2') + 0.5, 'it waits longer on easy than on hard');
});

test('the invitation answers even if the menu cannot open, and can be asked for while the gear is being given', () => {
	const game = runRounds();
	game.join('host', 0, 'Ana');
	game.ctx.ui.openDash = () => { throw new Error('no menu here'); };
	game.press('invite');
	assert.match(game.ui('status').text, /Tab|menu/, 'the words say where to find it');
	assert.equal(game.game.phase, 'menu');
	const second = runRounds();
	second.join('host', 0, 'Ana');
	second.ctx.world.equipPlayer = () => false;
	second.press('start');
	second.tick(2);
	assert.equal(second.game.phase, 'ready');
	second.press('invite');
	assert.deepEqual(second.dashOpens, [{ tab: 'session', options: { invite: true } }], 'also while START waits');
	const guest = runRounds();
	guest.join('host', 0, 'Ana');
	guest.join('bea', 1, 'Bea');
	guest.press('invite', 'bea');
	assert.deepEqual(guest.dashOpens, [], 'a guest does not open the host\'s invitation');
});

test('the music follows the game and a jingle plays for each cue, on every device', async () => {
	const game = runRounds();
	game.join('host');
	game.tick(0.1);
	assert.equal(game.played.length, 1, 'the lobby has its music');
	assert.equal(game.played[0].options.loop, true);
	game.press('start');
	assert.ok(game.untilPhase('fight', 10));
	game.tick(0.2);
	assert.ok(game.played.length >= 2, 'and the duel its own');
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(game.played[0].handle.stopped, true, 'the lobby music stops when the duel starts');
	const before = game.played.length;
	game.debug.damage(game.fighters[1], 9999, game.fighters[0]);
	game.tick(0.2);
	assert.ok(game.played.length > before, 'a sound for the kill and a jingle for the point');
});

// ------------------------------------------------------------------------------------------------------------------------ shooting
test('a bullet flies at the game\'s speed and falls as the game\'s does', () => {
	const game = duel({ human: [-8, 10, 0], rival: [-8, 11, 0] });
	game.look('host', [20, 10, 0]);
	game.trigger('host', true);
	game.tick(0.03);
	game.trigger('host', false);
	const b = aliveBullets(game)[0];
	assert.ok(b, 'a bullet');
	const start = [...b.pos], vy0 = b.vel[1];
	game.tick(0.4);
	const flown = b.pos[0] - start[0];
	assert.ok(Math.abs(flown - TUNING.bulletSpeed * 0.4) < TUNING.bulletSpeed * 0.04, `it flew ${flown.toFixed(2)} m in 0.4 s`);
	const fall = start[1] - b.pos[1];
	const expected = 0.5 * TUNING.bulletGravity * 0.16 - vy0 * 0.4;
	assert.ok(Math.abs(fall - expected) < 0.35, `it fell ${fall.toFixed(2)} m, the game's formula says ${expected.toFixed(2)}`);
});

test('two hits kill the rival and the point goes to the player: 55 damage each, 100 health', () => {
	const game = duel();
	const foe = rival(game);
	for (let shot = 0; shot < 2; shot++) {
		game.aimBallistic('host', centre(foe));
		game.trigger('host', true);
		game.tick(0.1);
		game.trigger('host', false);
		game.tick(TUNING.interval + 0.5);
	}
	assert.equal(foe.dead, true, `the rival took ${TUNING.maxHp - foe.hp} damage`);
	assert.equal(game.game.phase, 'point');
	assert.deepEqual(game.game.points, [1, 0]);
	assert.equal(game.hud(0, 'score'), '1 : 0');
});

test('a hit is felt: the rival is held for a moment and thrown back, a number floats up, and the world slows when someone dies', () => {
	const game = duel();
	const foe = rival(game);
	shootAt(game, centre(foe), 0.12);
	assert.equal(Math.round(foe.hp), TUNING.maxHp - TUNING.damage);
	assert.ok(foe.holdT > 0, 'held');
	assert.ok(Math.abs(foe.vel[0]) > 0 || foe.pos[0] !== -3, 'thrown back');
	const shown = game.debug.numbers.filter((n) => n.alive);
	assert.equal(shown.length, 1, 'a number');
	const text = game.slots.get(`rd-number-${shown[0].n}`).components.find((c) => c.type === 'textDisplay');
	assert.equal(text.title, '-55');
	assert.equal(text.titleColor, '#f87171', 'in the colour of damage, with no tricks: the sign has a transparent background and turns to the eye by itself');
	assert.equal(text.billboard, 'y');
	assert.equal(text.background, '#00000000');
	game.tick(0.04);
	assert.ok(game.world.node('rd-bot-1-vis').scaling.y < SCALE * 0.99, 'and the blob is squashed');
	game.tick(1.2);
	assert.equal(game.debug.numbers.some((n) => n.alive), false, 'the number is gone');
	game.debug.damage(foe, 9999, game.fighters[0]);
	game.tick(DT);
	game.tick(DT);
	assert.equal(game.ctx.time.getScale(), TUNING.slowMoScale, 'the kill slows the world (the engine\'s own clock of the script)');
	game.tick(TUNING.slowMo + 0.2);
	assert.equal(game.ctx.time.getScale(), 1, 'and it comes back');
});

test('the magazine is three shots, 0.3 s apart, then a two second reload; the HUD follows the numbers', () => {
	const game = duel();
	const me = game.fighters[0];
	game.aimBallistic('host', SKY);
	game.trigger('host', true);
	game.tick(0.5);
	assert.equal(me.ammo, 1, 'two shots in 0.5 s: the second after 0.3 s');
	game.tick(0.4);
	assert.equal(me.ammo, 0);
	assert.equal(me.reloading, true);
	assert.match(game.hud(0, 'ammo'), /RELOADING/);
	game.trigger('host', false);
	game.tick(TUNING.reload + 0.2);
	assert.equal(me.ammo, TUNING.ammo);
	assert.equal(game.hud(0, 'ammo'), '●●●');
	assert.equal(game.hud(0, 'shield'), 'SHIELD READY');
});

test('a raised shield holds for 0.3 s and stops a bullet, then takes four seconds to come back', () => {
	const blocked = duel();
	const me = blocked.fighters[0], foe = rival(blocked);
	blocked.raiseShield('host');
	blocked.tick(0.05);
	assert.ok(me.blockT > 0 && me.blockT <= TUNING.blockTime);
	blocked.debug.volley(foe, [-3.5, 1.2, 0], [-1, 0, 0]);
	blocked.tick(0.2);
	assert.equal(me.hp, TUNING.maxHp, 'the bullet was blocked');
	assert.ok(me.blockCd > 3.5, 'the shield is recharging');
	blocked.tick(0.5);
	blocked.raiseShield('host');
	blocked.tick(0.1);
	assert.equal(me.blockT <= 0, true, 'and cannot be raised again yet');
	blocked.tick(4);
	blocked.raiseShield('host');
	blocked.tick(0.05);
	assert.ok(me.blockT > 0, 'but can after the cooldown');

	const open = duel();
	open.debug.volley(rival(open), [-3.5, 1.2, 0], [-1, 0, 0]);
	open.tick(0.4);
	assert.ok(open.fighters[0].hp < TUNING.maxHp, 'without the shield it hits');
});

test('the radial menu can block and reload for a player without hands on a desktop', () => {
	const game = duel();
	game.person('host').desktop = true;
	game.ctx.world.spawn({ name: 'Command', parentId: 'rd-cmd', components: [{ type: 'scriptState', data: { cmd: 'block', side: 0, player: 'host' } }] });
	game.tick(0.1);
	assert.ok(game.fighters[0].blockT > 0);
	assert.equal(game.ctx.hierarchy.getChildren('rd-cmd').length, 0, 'the command is taken');
	game.aimBallistic('host', SKY);
	game.trigger('host', true);
	game.tick(0.1);
	assert.ok(aliveBullets(game)[0], 'a desktop player fires from the eye');
});

test('the rival aims above the player, because the bullet falls: it hits a player who stands still, at the far end of its reach', () => {
	const game = duel({ human: [-8, 1.6, 0], rival: [2.5, 0.4, 0] });
	game.debug.menu.rival = 2;
	const foe = rival(game);
	foe.bot.reactT = 0;
	foe.bot.aim = [1, 0, 0];
	let hit = false;
	for (let t = 0; t < 15 && !hit; t += DT) {
		game.tick(DT);
		foe.pos = [2.5, 0.4, 0];
		hit = game.fighters[0].hp < TUNING.maxHp;
	}
	assert.ok(hit, 'a long shot lands');
	assert.ok(foe.bot.aim[1] > 0.05, 'with the gun pointing above you');
});

// ---------------------------------------------------------------------------------------------------------------------- the HUD
test('the HUD follows the player\'s head above the line of sight, and shows both healths, the points, the round, the magazine and the shield', () => {
	const game = duel();
	game.tick(0.5);
	const at = game.pos('rd-hud-0');
	const head = game.person('host').head;
	assert.ok(Math.hypot(at[0] - head[0], at[2] - head[2]) < 2.5 && at[1] - head[1] > 0.2 && at[1] - head[1] < 0.8, `the HUD is at ${at.map((n) => n.toFixed(1))} for a head at ${head}: in front, a little above, not in the sky`);
	assert.equal(game.pos('rd-hud-1')[1], -200, 'nobody plays the other side: no HUD');
	assert.equal(game.hud(0, 'me-hp'), '100 / 100');
	assert.equal(game.hud(0, 'foe-hp'), '100 / 100');
	assert.equal(game.hud(0, 'score'), '0 : 0');
	assert.equal(game.hud(0, 'round'), 'ROUND 1');
	game.debug.damage(rival(game), 55, game.fighters[0]);
	game.tick(0.3);
	assert.equal(game.hud(0, 'foe-hp'), '45 / 100');
	assert.ok(game.hudWidth(0, 'foe-bar') < 0.5 * 340, 'the bar of the rival shrinks');
	game.move('host', [-8, 5, 3]);
	game.tick(3);
	const moved = game.pos('rd-hud-0');
	assert.ok(Math.abs(moved[1] - 5) < 1, 'and it goes with the head');
});

test('nothing hangs in the sky: no panel of the game is more than a few metres above where a fighter can be', () => {
	const scene = buildRounds();
	for (const slot of scene) {
		if (!slot.components.some((c) => c.type === 'uiPanel') || slot.id.startsWith('rd-ui') || slot.id.startsWith('rd-lobby')) continue;
		assert.ok(slot.position[1] < ARENA.maxY || slot.position[1] < 0, `${slot.id} is parked or low`);
	}
});

// ------------------------------------------------------------------------------------------------------------------------ rounds
test('two points win a round; the loser picks a card and the next round is on another map', () => {
	const game = runRounds();
	game.startFight();
	const firstMap = game.game.map;
	assert.ok(score(game, 0), 'the first point is followed by another');
	assert.deepEqual(game.game.points, [1, 0]);
	assert.equal(game.game.phase, 'countdown');
	assert.ok(game.untilPhase('fight'));
	assert.ok(score(game, 0, 'pick'));
	assert.deepEqual(game.game.rounds, [1, 0]);
	assert.deepEqual(game.game.points, [0, 0], 'points are counted again for the next round');
	assert.equal(game.game.loser, 1);
	assert.equal(game.game.offer.length, 3);
	assert.equal(new Set(game.game.offer.map((c) => c.id)).size, 3, 'three different cards');
	assert.ok(game.untilPhase('countdown', 20), 'the rival picks by itself');
	assert.equal(game.fighters[1].cards.length, 1);
	assert.equal(game.fighters[0].cards.length, 0, 'the winner picks nothing');
	assert.notEqual(game.game.map, firstMap);
	assert.equal(game.game.round, 2);
	assert.ok([0, 1, 2].every((n) => game.pos(`rd-card-${n}`)[1] < -100), 'the cards are put away');
	const shown = MAPS.map((_, m) => !game.slots.get(`rd-map-${m}`).disabled);
	assert.deepEqual(shown, MAPS.map((_, m) => m === game.game.map), 'only the map in play is on');
});

test('a player who loses a round shoots a card to take it; the card shows the game\'s own numbers', () => {
	const game = runRounds();
	game.startFight();
	score(game, 1);
	game.untilPhase('fight');
	assert.ok(score(game, 1, 'pick'));
	assert.equal(game.game.loser, 0);
	const spawn = game.debug.spawnOf(0);
	for (let n = 0; n < 3; n++) {
		const at = game.pos(`rd-card-${n}`);
		assert.ok(at[1] > spawn[1] - 1 && at[1] < spawn[1] + 4 && Math.hypot(at[0] - spawn[0], at[1] - spawn[1]) < 7, `the cards hang near the player: ${at.map((v) => v.toFixed(1))}`);
		assert.ok(!game.debug.obstacleAt(at[0], at[1], 0.5), 'and not inside a block');
	}
	const chosen = game.game.offer[1];
	const shown = (key) => game.slots.get(`rd-card-1-${key}`).components.find((c) => c.type === 'uiElement').text;
	assert.equal(shown('name'), chosen.name);
	assert.equal([0, 1, 2, 3, 4].map((k) => shown(`line${k}`)).filter(Boolean).join('|'), chosen.lines.map((l) => `${l.amount} ${l.stat}`).join('|'), 'the lines of numbers are the game\'s');
	game.openField();
	game.move('host', [spawn[0] - 4, spawn[1] + 1.2, 0]);
	game.look('host', game.pos('rd-card-1'));
	game.trigger('host', true);
	game.tick(0.5);
	game.trigger('host', false);
	assert.deepEqual(game.fighters[0].cards, [chosen.id]);
	assert.equal(game.game.phase, 'between');
	assert.ok(game.untilPhase('countdown', 10));
	assert.equal(game.fighters[0].stats.hp, game.debug.computeStats([chosen.id]).hp, 'the card is in the stats');
});

test('nobody picking is not stuck: a card is chosen after the time limit', () => {
	const game = runRounds();
	game.startFight();
	score(game, 1);
	game.untilPhase('fight');
	score(game, 1, 'pick');
	game.tick(TUNING.pickTimeout + 1);
	assert.equal(game.fighters[0].cards.length, 1);
});

test('the match is as long as the menu says', () => {
	const game = runRounds();
	game.join('host');
	game.press('match-0');
	game.press('start');
	assert.ok(game.untilPhase('fight', 10));
	for (let rounds = 0; rounds < 5 && game.game.phase !== 'over'; rounds++) {
		score(game, 0, 'countdown');
		game.untilPhase('fight', 30);
		game.debug.damage(game.fighters[1], 9999, game.fighters[0]);
		for (let t = 0; t < 40 && game.game.phase !== 'pick' && game.game.phase !== 'over'; t += DT) game.tick(DT);
		if (game.game.phase === 'pick') game.untilPhase('fight', 40);
	}
	assert.equal(game.game.phase, 'over');
	assert.deepEqual(game.game.rounds, [3, 0], 'three rounds, as chosen');
});

test('five rounds end the match, and the game goes back to the menu with the gear put away', () => {
	const game = runRounds();
	game.startFight();
	for (let round = 1; round <= TUNING.roundsToWinGame; round++) {
		assert.ok(score(game, 0, 'countdown') || game.game.phase === 'pick' || game.game.phase === 'over');
		if (game.game.phase === 'over') break;
		game.untilPhase('fight', 30);
		score(game, 0, round === TUNING.roundsToWinGame ? 'over' : 'pick');
		if (game.game.phase !== 'over') { game.untilPhase('fight', 40); }
	}
	assert.equal(game.game.phase, 'over');
	assert.deepEqual(game.game.rounds, [TUNING.roundsToWinGame, 0]);
	assert.ok(game.untilPhase('menu', TUNING.overPause + 2));
	assert.deepEqual(game.teleports.at(-1).position.slice(1), LOBBY.spawn.slice(1), 'the player is brought back to the menu');
	assert.deepEqual(game.unequips.map((u) => u.hand).sort(), ['left', 'right'], 'the gear is taken off');
	assert.deepEqual(game.pos('rd-gun-0'), WAITING[0], 'and put away');
	assert.equal(game.fighters.some((f) => f.human), false);
	assert.deepEqual(game.fighters[1].cards, []);
	assert.deepEqual(game.game.rounds, [0, 0]);
	assert.equal(game.ui('start').background, '#22c55e');
	game.press('start');
	assert.ok(game.untilPhase('fight', 10));
	assert.deepEqual(game.game.rounds, [0, 0]);
});

test('when another player is in the room START makes the match theirs: they get the orange gear, with no choice to make', () => {
	const game = runRounds();
	game.join('ana', 0, 'Ana');
	game.join('bea', 1, 'Bea');
	game.press('start', 'ana');
	game.tick(0.1);
	assert.deepEqual(game.equips.map((e) => [e.playerId, e.slotId, e.hand]), [
		['ana', 'rd-gun-0', 'right'], ['ana', 'rd-shield-0', 'left'], ['bea', 'rd-gun-1', 'right'], ['bea', 'rd-shield-1', 'left']
	]);
	assert.ok(game.untilPhase('fight', 10));
	assert.equal(game.fighters[1].human, true);
	assert.equal(game.fighters[1].playerId, 'bea');
	assert.match(game.hud(1, 'me-name'), /ORANGE · BEA/);
	assert.ok(game.pos('rd-hud-0')[1] > -100 && game.pos('rd-hud-1')[1] > -100, 'each has their own HUD');
	// Ana shoots Bea in an open field.
	game.openField();
	game.move('ana', [-8, 1.6, 0]);
	game.move('bea', [-3, 1.6, 0]);
	game.aimBallistic('ana', [-3, 1.3, 0]);
	game.trigger('ana', true);
	game.tick(0.1);
	game.trigger('ana', false);
	game.tick(1);
	assert.equal(Math.round(game.fighters[1].hp), TUNING.maxHp - TUNING.damage);
});

test('if the second player\'s gear cannot be given they are asked to take it, and if they do not the rival plays', () => {
	const game = runRounds();
	game.join('ana', 0, 'Ana');
	game.join('bea', 1, 'Bea');
	const give = game.ctx.world.equipPlayer;
	game.ctx.world.equipPlayer = (id, slot, hand) => (id === 'bea' ? false : give(id, slot, hand));
	game.press('start', 'ana');
	game.tick(6);
	assert.equal(game.game.phase, 'ready');
	assert.match(game.ui('status').text, /second player/);
	assert.ok(game.untilPhase('countdown', 40), 'it does not wait for ever');
	assert.equal(game.fighters[1].human, false, 'the rival plays');
});

test('leaving from the radial menu takes the player to the menu', () => {
	const game = runRounds();
	game.startFight();
	game.ctx.world.spawn({ name: 'Command', parentId: 'rd-cmd', components: [{ type: 'scriptState', data: { cmd: 'quit', side: 0, player: 'host' } }] });
	game.tick(0.1);
	assert.equal(game.game.phase, 'menu');
	assert.equal(game.fighters[0].human, false);
	assert.deepEqual(game.pos('rd-gun-0'), WAITING[0]);
	assert.equal(game.pos('rd-hud-0')[1], -200, 'and the HUD goes away');
});

test('a hit flashes red over the eyes, and a point is announced in front of the player', () => {
	const game = duel();
	game.debug.damage(game.fighters[0], 10, game.fighters[1]);
	game.tick(0.05);
	assert.ok(game.pos('rd-flash-0')[1] > -100, 'the flash is in front of the eyes');
	game.tick(0.4);
	assert.equal(game.pos('rd-flash-0')[1], -200, 'and gone a moment later');
	score(game, 0, 'countdown');
	const banner = game.slots.get('rd-banner-0').components.find((c) => c.type === 'textDisplay');
	assert.ok(['POINT!', 'ROUND 1', 'POINT 2'].includes(banner.title), banner.title);
});

test('a player who is hit down sees the veil and the point goes to the rival', () => {
	const game = duel();
	game.debug.damage(game.fighters[0], 9999, game.fighters[1]);
	game.tick(0.1);
	assert.equal(game.game.phase, 'point');
	assert.deepEqual(game.game.points, [0, 1]);
	assert.ok(game.pos('rd-veil-0')[1] > -100, 'the veil is in front of the eyes');
	game.trigger('host', true);
	game.tick(0.5);
	assert.equal(aliveBullets(game).length, 0, 'a downed player cannot shoot');
});

test('leaving the screen takes 51 health and puts the fighter back on the pad', () => {
	const game = duel();
	const me = game.fighters[0];
	game.move('host', [-8, ARENA.minY - 3, 0]);
	game.tick(0.1);
	assert.equal(me.hp, TUNING.maxHp - TUNING.outOfBoundsDamage);
	const spawn = game.debug.spawnOf(0);
	assert.ok(Math.abs(game.teleports.at(-1).position[0] - spawn[0]) < 1e-9, 'back on the pad');
	game.move('host', [-8, ARENA.minY - 3, 0]);
	game.tick(0.1);
	assert.equal(me.dead, true, 'twice is too much');
});

test('the rival does not see through blocks, and does when nothing is in the way', () => {
	const game = runRounds();
	game.startFight();
	game.debug.setMap(0);
	game.openField();
	solid(game, 'test-wall', [-4, 0], [1, 20]);
	game.freezeRival();
	rival(game).pos = [0, 0.4, 0]; rival(game).vel = [0, 0, 0];
	game.move('host', [-9, 1.6, 0]);
	rival(game).bot.reactT = 0;
	game.tick(1);
	assert.equal(rival(game).bot.seen, false, 'the wall is in the way');
	assert.equal(rival(game).bot.lastSeenAt < 0, true);
	assert.deepEqual(rival(game).bot.estVel, [0, 0, 0], 'it has no idea of your speed');
	game.ctx.world.deleteSlot('test-wall');
	game.tick(0.3);
	assert.equal(rival(game).bot.seen, true, 'and with nothing in the way it does');
});

// ------------------------------------------------------------------------------------------------------------------------ cards
test('the cards are the game\'s: its names, its texts and its numbers', () => {
	const byName = (name) => CARDS.find((c) => c.name === name);
	assert.ok(CARDS.length >= 45);
	assert.deepEqual(byName('STRENGTH').mul, { damage: 1.7 });
	assert.deepEqual(byName('STRENGTH').lines, [{ stat: 'DMG', amount: '+70%', positive: true }]);
	assert.deepEqual(byName('FRENZY').mul, { damage: 0.4, interval: 0.25 });
	assert.equal(byName('FRENZY').add.ammo, 6);
	assert.equal(byName('FRENZY').add.reloadAdd, 0.25, 'every card makes the reload a quarter of a second longer');
	assert.equal(byName('QUICK SHOT').mul.speed, 2.5);
	assert.equal(byName('PHOENIX').rarity, 'rare');
	assert.equal(byName('HUGE').mul.hp, 1.8);
	assert.equal(byName('TANK').mul.hp, 2);
});

test('card stats: multipliers, additions and switches combine whatever the order, and every card does something', () => {
	const game = runRounds();
	const { computeStats } = game.debug;
	const base = computeStats([]);
	assert.equal(base.hp, TUNING.maxHp);
	assert.equal(base.damage, 1);
	assert.equal(computeStats(['tank', 'tank']).hp, TUNING.maxHp * 4, 'multipliers stack');
	assert.equal(computeStats(['barrage', 'multishot']).bullets, 1 + 4 + 6, 'additions stack');
	assert.ok(Math.abs(computeStats(['strength']).reloadTime - base.reloadTime) < 1e-9, 'a card with no reload in it leaves the reload');
	assert.ok(Math.abs(computeStats(['frenzy']).reloadTime - (TUNING.reload + 0.25)) < 1e-9, 'and one with it adds the quarter second');
	assert.deepEqual(computeStats(['glass-cannon', 'bouncy', 'tank']), computeStats(['tank', 'glass-cannon', 'bouncy']));
	for (const card of CARDS) {
		const stats = computeStats([card.id]);
		assert.ok(Object.values(stats).every(Number.isFinite), card.id);
		assert.notDeepEqual(stats, base, `${card.id} changes the fighter`);
	}
	assert.equal(new Set(CARDS.map((c) => c.id)).size, CARDS.length);
});

test('a card that only switches something on is never offered twice', () => {
	const game = runRounds();
	const f = give(game, 0, ['poison', 'phoenix']);
	for (let i = 0; i < 200; i++) assert.ok(!game.debug.drawOffer(f).some((c) => c.id === 'poison'));
	const seen = new Set();
	for (let i = 0; i < 300; i++) for (const c of game.debug.drawOffer(f)) seen.add(c.id);
	assert.ok(seen.has('phoenix'), 'a card that stacks can come again');
});

test('Bouncy: a bullet is thrown back by a wall instead of dying; Trickster makes it hurt more each time', () => {
	const game = duel();
	give(game, 0, ['bouncy']);
	game.look('host', [-8, 1.6, 20]); // along the depth, into the invisible wall at z = +1.5
	game.trigger('host', true); game.tick(0.03); game.trigger('host', false); game.tick(0.02);
	const bullet = aliveBullets(game)[0];
	assert.ok(bullet, 'the bullet survived the wall');
	assert.ok(bullet.vel[2] < 0, 'and now flies back');
	assert.equal(bullet.bounces, 1);
	const plain = duel();
	plain.look('host', [-8, 1.6, 20]);
	plain.trigger('host', true); plain.tick(0.03); plain.trigger('host', false); plain.tick(0.02);
	assert.equal(aliveBullets(plain).length, 0, 'without the card it is spent');
	const trick = duel();
	give(trick, 0, ['trickster']);
	trick.look('host', [-8, 1.6, 20]);
	trick.trigger('host', true); trick.tick(0.03); trick.trigger('host', false); trick.tick(0.02);
	assert.ok(Math.abs(aliveBullets(trick)[0].damage - TUNING.damage * 0.8 * 1.8) < 1e-6);
});

test('Barrage fires several bullets at once, Burst fires them one after the other', () => {
	const game = duel();
	give(game, 0, ['barrage']);
	shootAt(game, SKY, 0.02);
	assert.equal(aliveBullets(game).length, 5);
	const burst = duel();
	give(burst, 0, ['burst']);
	shootAt(burst, SKY, 0.02);
	assert.equal(aliveBullets(burst).length, 1);
	burst.tick(0.3);
	assert.equal(aliveBullets(burst).length, 3, 'two more follow');
	assert.equal(burst.fighters[0].ammo, burst.fighters[0].stats.ammo - 1, 'a burst costs one shot');
});

test('Poison: the damage arrives over three seconds; Parasite heals the shooter', () => {
	const game = duel();
	const foe = rival(game);
	give(game, 0, ['poison']);
	game.aimBallistic('host', centre(foe));
	game.trigger('host', true);
	game.tick(0.03);
	game.trigger('host', false);
	for (let t = 0; t < 2 && foe.dots.length === 0; t += DT) game.tick(DT);
	assert.equal(foe.dots.length, 1, 'the bullet landed');
	assert.ok(foe.hp > TUNING.maxHp - 1, 'but nothing was dealt at the moment of impact');
	game.tick(1.5);
	assert.ok(foe.hp < TUNING.maxHp && foe.hp > TUNING.maxHp - TUNING.damage * 1.7, 'part of it so far');
	game.tick(2.5);
	assert.ok(Math.abs(foe.hp - Math.max(0, TUNING.maxHp - TUNING.damage * 1.7)) < 0.6 || foe.dead, 'and all of it after');
	assert.equal(foe.dots.length, 0);

	const leech = duel();
	const hurt = give(leech, 0, ['parasite']);
	hurt.hp = 30;
	shootAt(leech, centre(rival(leech)), 0.5);
	leech.tick(6);
	assert.ok(hurt.hp > 30, `the shooter heals: ${hurt.hp}`);
});

test('Phoenix brings a fighter back once; Leech, Scavenger and Refresh pay the shooter back', () => {
	const game = duel();
	const foe = rival(game);
	const f = give(game, 1, ['phoenix']);
	game.debug.damage(f, 9999, game.fighters[0]);
	assert.equal(f.dead, false);
	assert.equal(f.hp, f.maxHp / 2);
	assert.ok(f.graceT > 0, 'it cannot be hurt for a moment');
	assert.equal(game.debug.damage(f, 50, game.fighters[0]), false);
	game.tick(TUNING.reviveGrace + 0.1);
	game.debug.damage(f, 9999, game.fighters[0]);
	assert.equal(f.dead, true, 'and only once');

	const me = give(game, 0, ['leech', 'scavenger', 'refresh']);
	me.hp = 20; me.ammo = 0; me.blockCd = 3;
	foe.dead = false; foe.hp = foe.maxHp; foe.graceT = 0;
	game.debug.damage(foe, 40, me);
	assert.equal(me.hp, Math.min(me.maxHp, 20 + 40 * me.stats.leech), 'Leech');
	assert.equal(me.ammo, me.stats.ammo, 'Scavenger');
	assert.equal(me.blockCd, 0, 'Refresh');
});

test('HP cards, Brawler and Pristine Perseverence change how much hurts', () => {
	const game = duel();
	const foe = rival(game);
	assert.equal(give(game, 1, ['tank']).maxHp, 200);
	const glass = give(game, 0, ['glass-cannon']);
	assert.equal(glass.maxHp, 50);
	assert.equal(glass.stats.damage, 2);
	const proud = give(game, 1, ['pristine-perseverence']);
	game.debug.damage(proud, 50, game.fighters[0]);
	assert.equal(proud.hp, 90, 'a fifth of the damage while healthy');
	game.debug.damage(proud, 50, game.fighters[0]);
	assert.equal(proud.hp, 40, 'full damage once below 90%');
	const brawler = give(game, 0, ['brawler']);
	foe.hp = foe.maxHp; foe.dead = false; foe.graceT = 0;
	game.debug.damage(foe, 10, brawler);
	assert.ok(brawler.brawlT > 2.9);
	const before = brawler.hp;
	game.debug.damage(brawler, 30, foe);
	assert.equal(before - brawler.hp, 10, 'a third of it for a while');
});

test('block cards: Healing Field, Tactical Reload, Overpower and Teleport', () => {
	const game = duel();
	const me = give(game, 0, ['healing-field', 'tactical-reload']);
	me.hp = 40; me.ammo = 0; me.reloading = true;
	game.raiseShield('host');
	game.tick(0.05);
	assert.equal(me.hp, 70);
	assert.equal(me.ammo, me.stats.ammo);
	assert.equal(me.reloading, false);

	const near = duel({ rival: [-7, 1.2, 0] });
	const over = give(near, 0, ['overpower']);
	near.raiseShield('host');
	near.tick(0.05);
	assert.ok(Math.abs(near.fighters[1].hp - (TUNING.maxHp - over.maxHp * 0.15)) < 0.01);

	const far = duel({ rival: [3, 1.2, 0] });
	give(far, 0, ['overpower']);
	far.raiseShield('host');
	far.tick(0.05);
	assert.equal(far.fighters[1].hp, TUNING.maxHp, 'too far to feel it');

	const hop = duel();
	give(hop, 0, ['teleport']);
	hop.look('host', [10, 1.6, 0]);
	hop.raiseShield('host');
	hop.tick(0.05);
	const last = hop.teleports.at(-1);
	assert.ok(last.position[0] > -8 + 2 && last.yaw > 1.4, `forward, facing on: ${JSON.stringify(last)}`);
});

test('Demonic Pact: every shot costs health and nearly nothing to wait', () => {
	const game = duel();
	const me = give(game, 0, ['demonic-pact']);
	assert.ok(me.stats.interval < 0.02);
	shootAt(game, SKY, 0.02);
	assert.ok(me.hp <= TUNING.maxHp - 10 && me.hp % 10 === 0, `each shot costs 10: ${me.hp}`);
});

test('Explosive Bullet hurts the rival when it lands near; Homing bends towards it; Grow adds damage with distance', () => {
	const game = duel({ human: [-8, 1.6, 0], rival: [-4, 0.4, 0] });
	give(game, 0, ['explosive-bullet']);
	solid(game, 'test-shelf', [-5, -1.4], [12, 1]);
	game.aimBallistic('host', [-4.8, -0.88, 0]);
	game.trigger('host', true); game.tick(0.03); game.trigger('host', false); game.tick(0.7);
	assert.ok(rival(game).hp < TUNING.maxHp, 'the blast reached it');

	const seek = duel();
	give(seek, 0, ['homing']);
	shootAt(seek, [-3, 1.5, 0], 1.2);
	assert.ok(rival(seek).hp < TUNING.maxHp, 'a shot aimed high still found it');
	const plain = duel();
	shootAt(plain, [-3, 1.5, 0], 1.2);
	assert.equal(rival(plain).hp, TUNING.maxHp, 'and without the card it flies over');

	const grow = duel({ human: [-12, 1.6, 0], rival: [-1, 0.4, 0] });
	give(grow, 0, ['grow']);
	shootAt(grow, centre(rival(grow)), 1);
	assert.ok(rival(grow).hp < TUNING.maxHp - TUNING.damage - 3, 'farther means harder');
});

test('when the rival sees you it needs time: to notice, to turn its aim round, and only then does it fire', () => {
	const game = duel({ human: [-8, 1.6, 0], rival: [-2, 0.4, 0] });
	game.debug.menu.rival = 0; // easy
	const foe = rival(game);
	foe.bot.reactT = 0;
	foe.bot.aim = [1, 0, 0]; // looking away from you
	let firstShot = -1;
	for (let t = 0; t < 6 && firstShot < 0; t += DT) {
		game.tick(DT);
		if (game.bullets.some((b) => b.owner === 1 && b.alive)) firstShot = t;
	}
	assert.ok(firstShot > 1, `it fired after ${firstShot.toFixed(2)} s on easy, as if it knew where you were`);
});

function T() { return TUNING; }
function M() { return MOVEMENT; }

// ---------------------------------------------------------------------------------------------- what the engine does for the game
test('sounds are played from where they happen, with a little variety, and the host sends them as a short queue, not a world', async () => {
	const game = duel();
	const foe = rival(game);
	shootAt(game, centre(foe), 0.3);
	game.tick(0.2);
	await new Promise((resolve) => setTimeout(resolve, 0));
	const spatial = game.played.filter((p) => p.position);
	assert.ok(spatial.length >= 2, 'the shot and the hit are placed in the world');
	assert.ok(spatial.every((p) => p.position.every(Number.isFinite)));
	assert.ok(spatial.some((p) => Math.abs(p.position[0] - foe.pos[0]) < 1.5), 'the hit is heard from the one who was hit');
	assert.ok(spatial.every((p) => p.options.rate > 0.5 && p.options.rate < 2.5) && new Set(spatial.map((p) => p.options.rate)).size > 1, 'each at its own pitch');
	assert.ok(spatial.every((p) => p.options.refDistance > 0 && p.options.maxDistance > 0), 'and fades with distance');
	const queue = game.world.component('rd-hub', 'scriptState').data.cues;
	assert.ok(queue.length <= 12 && queue.every((c) => c.n > 0 && typeof c.name === 'string'), 'the queue is short');
	const before = game.flushes;
	game.tick(1);
	assert.ok(game.flushes >= before, 'what was written quietly goes out as one difference, with ctx.world.flush');
	assert.equal(game.world.writes.filter((w) => w.slotId === 'rd-flush').length, 0, 'there is no slot to write to make it go');
});

test('a player feels a shot and a hit: a buzz in the hand and a push away from the bullet', () => {
	const game = duel();
	shootAt(game, centre(rival(game)), 0.05);
	const shot = game.world.haptics.find((h) => h.playerId === 'host');
	assert.ok(shot && shot.hand === 'right' && shot.intensity > 0, 'the gun hand buzzes when it fires');
	const before = game.world.velocities.length;
	game.debug.damage(game.fighters[0], 20, game.fighters[1]);
	assert.ok(game.world.haptics.some((h) => h.hand === 'both' && h.intensity >= 0.8), 'both hands when hit');
	const push = game.world.velocities.slice(before).find((v) => v.playerId === 'host');
	assert.ok(push && push.add === true && push.velocity[0] < 0, 'and pushed away from the one who shot (the rival is to the right of the player)');
	game.debug.damage(game.fighters[0], 9999, game.fighters[1]);
	assert.equal(game.fighters[0].dead, true);
});

test('a map is waited for: the fight starts once its blocks are in the world, and not later than a few seconds if they never come', () => {
	let delivered = false;
	const game = runRounds({ fragments: (id) => (delivered ? fragments(id) : undefined) });
	game.join('host');
	game.press('start');
	assert.ok(game.untilPhase('loading', 10), 'the match asks for a map');
	const shown = game.game.map;
	game.tick(3);
	assert.equal(game.game.phase, 'loading', 'it waits while the map is not there');
	assert.equal(game.slots.has(ID.mapPart(shown, layoutOf(shown)[0].id)), false);
	delivered = true;
	assert.ok(game.untilPhase('countdown', 3), 'and goes on as soon as it is');
	assert.equal(game.debug.mapReady(shown), true);

	const never = runRounds({ fragments: () => undefined });
	never.join('host');
	never.press('start');
	assert.ok(never.untilPhase('countdown', 20), 'it does not wait for ever');
});

test('the world changes are sent as differences: the director writes quietly and flushes, and the first map is on from the start', () => {
	const game = runRounds();
	assert.equal(game.slots.has(ID.mapPart(0, layoutOf(0)[0].id)), true, 'the first map is built when the world starts');
	assert.equal(game.slots.has(ID.mapPart(1, layoutOf(1)[0].id)), false, 'and the others are not');
	game.join('host');
	game.tick(1);
	const writes = game.world.writes;
	assert.ok(writes.length > 0 && writes.every((w) => w.broadcast === false), 'the director never asks for a snapshot by writing: it writes quietly');
	assert.ok(game.flushes >= 1, 'and sends them together');
});
