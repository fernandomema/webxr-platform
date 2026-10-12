import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLayout } from '../src/lib/xr/templates/deadDropGen.ts';
import { ENEMIES, GRID, ITEMS, MEDKIT_HEAL, POOLS, TUNING, WEAPONS } from '../src/lib/xr/templates/deadDropData.ts';
import { ID } from '../src/lib/xr/templates/deadDropKit.ts';
import { GUN_MODELS } from '../src/lib/xr/templates/deadDropActors.ts';
import { DT, runDeadDrop } from './helpers/deadDropGame.mjs';

const SEED = 4242;
const layout = generateLayout(SEED);
const find = (slot, type) => slot.components.find((c) => c.type === type);

/** A raid with `names`, and no enemies to get in the way unless a test brings one. */
async function quiet(names = ['host'], options = {}) {
  const game = runDeadDrop(options);
  for (const [i, name] of names.entries()) { game.addPlayer(name, name, [i * 0.5, 1.6, 0]); game.equip(name); }
  await game.startRaid(names, SEED);
  for (const e of game.enemies()) { e.dead = true; game.ctx.world.setWorldPose(e.id, { position: [0, -200, 0] }); }
  return game;
}
const readout = (game, id, field = 'lines') => find(game.slots.get(`dd-gun-${game.person(id).gun}-readout`), 'textDisplay')[field];
const bar = (game, id, part) => game.localPoses.get(`dd-gun-${game.person(id).gun}-${part}`);

test('the pack holds what fits: stacks share slots, big things take two, and what does not fit stays out', () => {
  const game = runDeadDrop();
  const { packAdd, slotsUsed, takeFrom, countIn } = game.game;
  const pack = [];
  assert.equal(packAdd(pack, 'ammo9', 90), 90);
  assert.equal(slotsUsed(pack), 2, 'ninety rounds are two stacks of sixty');
  assert.equal(packAdd(pack, 'ammo9', 10), 10);
  assert.equal(slotsUsed(pack), 2, 'a hundred still two');
  assert.equal(packAdd(pack, 'scrap', 10), 10);
  assert.equal(slotsUsed(pack), 2 + 3, 'ten scrap are three stacks of four');
  const room = TUNING.packSlots - slotsUsed(pack);
  assert.equal(packAdd(pack, 'radio', 99), Math.floor(room / ITEMS.radio.size), 'radios take two slots each');
  assert.ok(slotsUsed(pack) <= TUNING.packSlots);
  assert.equal(packAdd(pack, 'gold', 1), room % 2 === 1 ? 1 : 0);
  assert.equal(takeFrom(pack, 'ammo9', 30), 30);
  assert.equal(countIn(pack, 'ammo9'), 70);
  assert.equal(takeFrom(pack, 'ammo9', 999), 70, 'it takes only what there is');
  assert.equal(countIn(pack, 'ammo9'), 0);
  assert.ok(!pack.some((e) => e.id === 'ammo9'), 'an empty entry goes away');
});

test('looking at loot from close by, or holding a hand on it, picks it up: it goes in the pack, counts towards the loot value, and leaves the shelf', async () => {
  const game = await quiet();
  const loot = game.game.R.loot[0], p = game.player('host');
  const had = p.pack.find((e) => e.id === loot.id)?.n ?? 0, n = loot.n;
  const value = ITEMS[loot.id].value * n;
  game.move('host', [loot.pos[0], loot.pos[1] + 0.3, loot.pos[2] - 1]);
  game.look('host', loot.pos);
  await game.tick(0.2);
  assert.ok(loot.on, 'a moment is not enough');
  await game.tick(0.3);
  assert.equal(loot.on, false);
  assert.equal(p.pack.find((e) => e.id === loot.id).n, had + n);
  assert.equal(p.lootValue, value);
  assert.ok(game.pos(ID.loot(loot.i))[1] < -100, 'and it is gone from where it lay');
  assert.match(readout(game, 'host', 'title'), new RegExp(`^\\+ ${ITEMS[loot.id].name}`));
});

test('a headset player picks loot up with a hand, not by looking at it', async () => {
  const game = await quiet();
  const loot = game.game.R.loot[1], p = game.player('host');
  game.person('host').hands = { left: [0, 0, 0], right: [0, 0, 0] };
  game.move('host', [loot.pos[0], loot.pos[1] + 0.3, loot.pos[2] - 1]);
  game.look('host', loot.pos);
  game.person('host').hands = { left: [loot.pos[0] - 3, 1, loot.pos[2]], right: [loot.pos[0] + 3, 1, loot.pos[2]] };
  await game.tick(1);
  assert.equal(loot.on, true, 'looking is not enough in a headset');
  game.person('host').hands.right = [loot.pos[0] + 0.1, loot.pos[1], loot.pos[2]];
  await game.tick(0.5);
  assert.equal(loot.on, false, 'a hand on it is');
  assert.ok(p.lootValue > 0);
});

test('loot that does not fit stays where it is, and the gun says the pack is full', async () => {
  const game = await quiet();
  const p = game.player('host');
  while (game.game.packAdd(p.pack, 'radio', 1)) { /* fill it */ }
  while (game.game.packAdd(p.pack, 'gold', 1)) { /* and every gap */ }
  assert.equal(game.game.slotsUsed(p.pack), TUNING.packSlots);
  const loot = game.game.R.loot[0];
  loot.id = 'radio'; loot.n = 1;
  const before = JSON.stringify(p.pack);
  game.move('host', [loot.pos[0], loot.pos[1] + 0.3, loot.pos[2] - 1]);
  game.look('host', loot.pos);
  await game.tick(1);
  assert.equal(loot.on, true, 'it is still there');
  assert.equal(JSON.stringify(p.pack), before);
  assert.equal(p.lootValue, 0);
  assert.match(readout(game, 'host', 'title'), /Pack full/);
});

test('reloading takes time, fills the magazine from the pack, and only as much as there is', async () => {
  const game = await quiet();
  const p = game.player('host');
  p.mags[0] = 10;
  game.command('host', 'reload');
  await game.tick(0.1);
  assert.ok(p.reload > 0, 'it has begun');
  assert.equal(p.mags[0], 10, 'and the magazine is not full yet');
  await game.tick(WEAPONS.smg.reload + 0.2);
  assert.equal(p.mags[0], WEAPONS.smg.mag);
  assert.equal(p.pack.find((e) => e.id === 'ammo9').n, 90 - 20);
  // With only a few rounds left, the magazine gets those.
  p.mags[0] = 0;
  p.pack.find((e) => e.id === 'ammo9').n = 5;
  game.command('host', 'reload');
  await game.tick(WEAPONS.smg.reload + 0.3);
  assert.equal(p.mags[0], 5);
  assert.ok(!p.pack.some((e) => e.id === 'ammo9'));
  game.command('host', 'reload');
  await game.tick(0.2);
  assert.match(readout(game, 'host', 'title'), /No ammo/);
});

test('a full magazine is not reloaded, and an empty one is reloaded by pulling the trigger', async () => {
  const game = await quiet();
  const p = game.player('host');
  game.command('host', 'reload');
  await game.tick(0.1);
  assert.match(readout(game, 'host', 'title'), /Magazine full/);
  assert.equal(p.reload, 0);
  p.mags[0] = 0;
  await game.tick(0.6);
  await game.shoot('host');
  assert.ok(p.reload > 0, 'the click starts a reload');
  assert.ok(game.sounds().length > 0);
});

test('a medkit heals after a few seconds, uses one up, and a hit in the meantime cancels it', async () => {
  const game = await quiet();
  const p = game.player('host');
  p.hp = 40;
  game.command('host', 'medkit');
  await game.tick(TUNING.medkitSeconds - 0.5);
  assert.equal(p.hp, 40);
  await game.tick(1);
  assert.equal(p.hp, 40 + MEDKIT_HEAL);
  assert.equal(p.pack.find((e) => e.id === 'medkit').n, 1);
  game.command('host', 'medkit');
  await game.tick(1);
  game.game.hurt(p, 5);
  assert.equal(p.medkit, 0, 'the hit stopped it');
  await game.tick(4);
  assert.equal(p.pack.find((e) => e.id === 'medkit').n, 1, 'and the medkit was not wasted');
  p.hp = TUNING.maxHp;
  game.command('host', 'medkit');
  await game.tick(0.1);
  assert.match(readout(game, 'host', 'title'), /full/);
});

test('switching weapon shows the other model on the gun, moves the muzzle to the end of its barrel, and cancels a reload', async () => {
  const game = await quiet();
  const p = game.player('host');
  const gun = p.gun;
  const part = (kind, key) => game.localPoses.get(`dd-gun-${gun}-${kind}-${key}`);
  assert.ok(part('smg', 'receiver').scale[0] > 0.04 && part('pistol', 'slide').scale[0] < 0.01, 'the submachine gun is out');
  assert.deepEqual(game.localPoses.get(`dd-gun-${gun}-muzzle`).position, GUN_MODELS.smg.muzzle);
  game.command('host', 'switch');
  await game.tick(0.1);
  assert.equal(p.active, 1);
  assert.ok(part('pistol', 'slide').scale[0] > 0.03 && part('smg', 'receiver').scale[0] < 0.01, 'now the pistol');
  assert.deepEqual(game.localPoses.get(`dd-gun-${gun}-muzzle`).position, GUN_MODELS.pistol.muzzle);
  p.mags[1] = 0;
  game.command('host', 'reload');
  await game.tick(0.2);
  assert.ok(p.reload > 0);
  game.command('host', 'switch');
  await game.tick(0.1);
  assert.equal(p.active, 0);
  assert.equal(p.reload, 0, 'the reload was dropped');
});

test('a command from somebody else’s gun, or from somebody who is not in a raid, is ignored', async () => {
  const game = await quiet(['host', 'ana']);
  const host = game.player('host');
  host.mags[0] = 3;
  game.command('ana', 'reload', host.gun);
  await game.tick(0.2);
  assert.equal(host.reload, 0, 'ana cannot work the host’s gun');
  const lone = runDeadDrop();
  lone.addPlayer('host', 'Host');
  lone.equip('host');
  lone.command('host', 'switch');
  await lone.tick(0.2);
  assert.equal(lone.player('host').active, 0, 'in the bunker the radial menu does nothing');
});

test('the gun shows health and magazine as bars that follow them, and the rest as text that is not rewritten every frame', async () => {
  const game = await quiet();
  const p = game.player('host');
  await game.tick(1.5);
  assert.ok(bar(game, 'host', 'hp').scale[0] > 0.099);
  game.game.hurt(p, 30);
  await game.tick(DT);
  assert.ok(Math.abs(bar(game, 'host', 'hp').scale[0] - 0.1 * 0.7) < 1e-9);
  assert.ok(Math.abs(bar(game, 'host', 'hp').position[0] - -0.05 * 0.3) < 1e-9, 'the bar shrinks towards its left end');
  await game.shoot('host');
  assert.ok(bar(game, 'host', 'mag').scale[0] < 0.1);
  await game.tick(1.2);
  const lines = readout(game, 'host');
  assert.match(lines[0], /Submachine Gun 29\/30 \+90/);
  assert.match(lines[1], /HP 70/);
  assert.match(lines[2], /PACK \d+\/12/);
  assert.match(lines[3], /EXIT \d+ m/);
});

test('sustained fire does not flood the guests: world snapshots are asked for at a gentle pace', async () => {
  const game = await quiet();
  const p = game.player('host');
  p.mags[0] = 999;
  game.hold('host', true);
  const before = game.flushes.length;
  await game.tick(5);
  game.hold('host', false);
  const spawnedSlots = game.spawned.filter((s) => !s.ephemeral && s.name !== 'Command');
  assert.ok(game.flushes.length - before <= 45, `${game.flushes.length - before} flushes in five seconds of fire`);
  assert.deepEqual(spawnedSlots.map((s) => s.name), [], 'every spark and sound of the fight is an ephemeral slot, never a whole snapshot');
  assert.ok(game.spawned.filter((s) => s.ephemeral).length > 20);
});

test('dying costs everything carried: the weapons and the pack leave the stash for good, and are left in a bag where it happened', async () => {
  const game = await quiet();
  const p = game.player('host'), profile = game.game.profileOf('host');
  const spot = [game.person('host').head[0], game.person('host').head[2]];
  game.game.hurt(p, 1000);
  assert.equal(p.state, 'dead');
  assert.equal(profile.deaths, 1);
  assert.equal(profile.stash.find((e) => e.id === 'smg'), undefined);
  assert.equal(profile.stash.find((e) => e.id === 'pistol'), undefined);
  const bag = game.game.R.bags[0];
  assert.deepEqual([bag.pos[0], bag.pos[2]], spot);
  assert.deepEqual(bag.items.map((e) => e.id).sort(), ['ammo9', 'medkit', 'pistol', 'smg']);
  assert.deepEqual(game.pos(ID.bag(0)), bag.pos, 'the bag lies there');
  await game.tick(0.1);
  assert.match(readout(game, 'host', 'title'), /died/i);
  game.command('host', 'switch');
  await game.tick(0.1);
  assert.equal(p.active, 0, 'a dead player has no gun');
});

test('a death is felt: a veil and a banner follow the dead player’s eyes until they are sent back, and then are put away', async () => {
  const game = await quiet();
  const p = game.player('host');
  game.game.hurt(p, 1000);
  await game.tick(0.1);
  const head = game.person('host').head, veil = game.pos(`dd-fx-${p.fx}`);
  assert.ok(veil[1] > 0 && Math.hypot(veil[0] - head[0], veil[2] - head[2]) < 1, 'the veil is in front of the eyes');
  assert.match(find(game.slots.get(`dd-fx-${p.fx}-text`), 'textDisplay').lines[0], /Back in the bunker in \d s/);
  const fx = p.fx;
  await game.tick(TUNING.respawnSeconds + 0.5);
  assert.ok(game.pos(`dd-fx-${fx}`)[1] < -100, 'and it is put away when they are home');
});

test('after a few seconds the dead are back in the bunker; when nobody is left in the raid it ends, saying what happened', async () => {
  const game = await quiet();
  const p = game.player('host');
  game.game.hurt(p, 1000);
  await game.tick(TUNING.respawnSeconds - 1);
  assert.equal(p.state, 'dead');
  assert.equal(game.game.R.on, true);
  await game.tick(2);
  assert.equal(p.state, 'hub');
  assert.deepEqual(game.teleports.at(-1).position, [0, 0, 0]);
  assert.equal(game.game.R.on, false);
  assert.match(game.message(), /Raid over\. host was killed\./);
  assert.deepEqual(game.game.squad, []);
  for (let i = 0; i < POOLS.soldiers; i++) assert.ok(game.pos(ID.soldier(i))[1] < -100);
  // And they can go again, with what the stash still holds.
  game.equip && void 0;
  game.press(ID.join);
  game.press(ID.start);
  await game.tick(DT);
  assert.equal(game.game.R.on, true);
  assert.deepEqual(p.weapons, ['pistol'], 'the free pistol: everything else went with the last raid');
});

test('a teammate who reaches the bag takes what fits, and the rest stays in it', async () => {
  const game = await quiet(['host', 'ana']);
  const ana = game.player('ana'), host = game.player('host');
  game.move('ana', [GRID.origin[0] - 3, 1.6, GRID.origin[2] + 4]);
  game.game.hurt(ana, 1000);
  const bag = game.game.R.bags[0];
  game.move('host', [bag.pos[0], 1.6, bag.pos[2] - 1.2]);
  game.look('host', [bag.pos[0], 0.2, bag.pos[2]]);
  const own = host.pack.map((e) => `${e.id}${e.n}`).join();
  await game.tick(0.4);
  assert.equal(bag.on, true, 'taking takes a moment');
  await game.tick(0.6);
  assert.equal(host.pack.length > 2, true, 'the bag’s things are in the pack now');
  assert.notEqual(host.pack.map((e) => `${e.id}${e.n}`).join(), own);
  assert.ok(host.pack.some((e) => e.id === 'smg') || bag.items.some((e) => e.id === 'smg'), 'the submachine gun is carried out, or left for later');
  // A full pack leaves the rest.
  const crowded = await quiet(['host', 'ana']);
  const h2 = crowded.player('host');
  while (crowded.game.packAdd(h2.pack, 'radio', 1)) { /* fill it */ }
  crowded.game.hurt(crowded.player('ana'), 1000);
  const b2 = crowded.game.R.bags[0];
  const items = b2.items.reduce((sum, e) => sum + e.n, 0);
  crowded.move('host', [b2.pos[0], 1.6, b2.pos[2] - 1.2]);
  crowded.look('host', [b2.pos[0], 0.2, b2.pos[2]]);
  await crowded.tick(1.5);
  assert.equal(b2.items.reduce((sum, e) => sum + e.n, 0) <= items, true);
  void ana;
});

test('standing in an open exit for long enough gets a player out with everything: the stash gets the weapons and the loot back', async () => {
  const game = await quiet();
  const p = game.player('host'), profile = game.game.profileOf('host');
  game.game.packAdd(p.pack, 'gold', 1);
  p.lootValue += ITEMS.gold.value;
  const exit = game.game.R.exits[0];
  game.move('host', [exit.pos[0] + 1, 1.6, exit.pos[2]]);
  await game.tick(TUNING.extractSeconds - 1);
  assert.equal(p.state, 'raid');
  game.move('host', [exit.pos[0] + 3, 1.6, exit.pos[2]]);
  await game.tick(2);
  assert.ok(p.extract < TUNING.extractSeconds - 1, 'stepping out sets the clock back');
  game.move('host', [exit.pos[0], 1.6, exit.pos[2]]);
  await game.tick(TUNING.extractSeconds + 1);
  assert.equal(p.state, 'hub');
  assert.deepEqual(game.teleports.at(-1).position, [0, 0, 0]);
  for (const id of ['smg', 'pistol', 'gold', 'ammo9', 'medkit']) assert.ok(profile.stash.some((e) => e.id === id), `${id} came back`);
  assert.equal(profile.extracted, ITEMS.gold.value);
  assert.equal(profile.raids, 1);
  assert.equal(game.submitted.at(-1).score, ITEMS.gold.value);
  assert.match(game.message(), /host got out with \$1200/);
  assert.equal(game.game.R.on, false);
});

test('an exit that is not open does nothing', async () => {
  const game = await quiet();
  const shut = layout.exits.find((exit) => !exit.active);
  game.move('host', [GRID.origin[0] + (shut.cell[0] - 1) * GRID.cell, 1.6, GRID.origin[2] + (shut.cell[1] - 1) * GRID.cell]);
  await game.tick(TUNING.extractSeconds + 2);
  assert.equal(game.player('host').state, 'raid');
});

test('when the time is up, whoever is still inside is lost, bag and all; an alarm sounds before', async () => {
  const game = await quiet();
  const p = game.player('host');
  game.game.R.t = TUNING.alarmAt - 0.05;
  await game.tick(0.2);
  assert.match(readout(game, 'host', 'title'), /LOCKDOWN/);
  assert.equal(p.state, 'raid');
  game.game.R.t = TUNING.raidSeconds - 0.05;
  await game.tick(0.2);
  assert.equal(p.state, 'dead');
  assert.equal(game.game.profileOf('host').deaths, 1);
  await game.tick(TUNING.respawnSeconds + 1);
  assert.match(game.message(), /did not get out in time/);
});

test('a player who leaves the world in the middle of a raid loses what they carried, and the squad closes up', async () => {
  const game = await quiet(['host', 'ana']);
  game.handlers.onPlayerLeft({ id: 'ana', name: 'ana' });
  assert.equal(game.player('ana'), undefined);
  assert.deepEqual(game.game.squad, ['host']);
  assert.equal(game.game.profileOf('ana').deaths, 1);
  await game.tick(0.5);
  assert.equal(game.game.R.on, true, 'the others carry on');
  assert.deepEqual(game.logs, []);
});

test('the console lists the squad and will not join twice; only the host starts, and only once everybody in the bunker has joined', async () => {
  const game = runDeadDrop();
  game.addPlayer('host', 'Host');
  game.addPlayer('ana', 'Ana');
  game.equip('host');
  game.equip('ana');
  game.press(ID.join, 'host');
  game.press(ID.join, 'host');
  assert.deepEqual(game.game.squad, ['host']);
  assert.match(game.message(), /Waiting for Ana to join/);
  game.press(ID.start, 'host');
  assert.equal(game.game.R.on, false, 'Ana has not joined yet');
  assert.match(game.message(), /Waiting for Ana/);
  game.press(ID.join, 'ana');
  assert.deepEqual(game.game.squad, ['host', 'ana']);
  assert.match(game.message(), /Squad: Host, Ana\./);
  assert.match(game.message(), /host can start/);
  game.press(ID.start, 'ana');
  assert.equal(game.game.R.on, false, 'a guest cannot start the raid');
  assert.match(game.message(), /Only the host/);
  game.press(ID.leave, 'ana');
  assert.deepEqual(game.game.squad, ['host']);
  game.press(ID.leave, 'host');
  assert.match(game.message(), /empty/);
  game.press(ID.start, 'host');
  assert.match(game.message(), /empty/, 'nobody joined');
  game.press(ID.join, 'host');
  game.press(ID.join, 'ana');
  game.press(ID.start, 'host');
  await game.tick(DT);
  assert.equal(game.game.R.on, true);
  assert.equal(game.player('ana').state, 'raid');
  assert.equal(game.player('host').state, 'raid');
  game.press(ID.join, 'host');
  assert.match(game.message(), /under way/);
  game.press(ID.start, 'host');
  assert.match(game.message(), /already/);
});

test('the console shows JOIN or LEAVE for whoever is at it, never both, and START RAID is green only when the host can press it', async () => {
  const game = runDeadDrop();
  game.addPlayer('host', 'Host', [4, 1.6, 2]);
  game.addPlayer('ana', 'Ana', [-6, 1.6, 0]);
  game.equip('host');
  game.equip('ana');
  game.handlers.onSpawn();
  const shown = (id) => find(game.slots.get(id), 'uiElement').visible;
  await game.tick(0.6);
  assert.equal(shown(ID.join), true);
  assert.equal(shown(ID.leave), false);
  game.press(ID.join, 'host');
  assert.equal(shown(ID.join), false, 'the host is in the squad: no JOIN');
  assert.equal(shown(ID.leave), true);
  assert.equal(find(game.slots.get(ID.start), 'uiElement').background, '#3f3f46', 'Ana is not in yet');
  game.press(ID.join, 'ana');
  assert.equal(find(game.slots.get(ID.start), 'uiElement').background, '#3f3f46', 'the one at the console is the host, but the press was Ana’s');
  game.press(ID.join, 'host');
  game.press(ID.leave, 'host');
  game.press(ID.join, 'host');
  assert.equal(find(game.slots.get(ID.start), 'uiElement').background, '#16a34a', 'the host is at the console and everybody is in');
});

test('the profile is read when a player arrives and written when it changes, if the world can store it', async () => {
  const saved = { credits: 777, stash: [{ id: 'pistol', n: 1 }, { id: 'ammo9', n: 40 }], extracted: 5, raids: 2, deaths: 1, best: 5 };
  const game = runDeadDrop({ storage: true, store: { host: { profile: saved } } });
  game.addPlayer('host', 'Host');
  await game.tick(0.1);
  game.equip('host');
  assert.equal(game.game.profileOf('host').credits, 777, 'what was saved is what is played with');
  game.game.setSeed(SEED);
  game.press(ID.join);
  game.press(ID.start);
  await game.tick(DT);
  assert.deepEqual(game.player('host').weapons, ['pistol']);
  assert.ok(game.saved.some(([id, key]) => id === 'host' && key === 'profile'), 'taking the kit out of the stash is saved at once: leaving the tab cannot give it back');
  assert.equal(game.store.host.profile.stash.find((e) => e.id === 'pistol'), undefined);
});

test('the script never touches a slot that is not in the world, in a long raid with four players and a lot of fighting', async () => {
  const game = runDeadDrop();
  const names = ['host', 'ana', 'bo', 'cy'];
  for (const [i, name] of names.entries()) { game.addPlayer(name, name, [i * 0.5, 1.6, 0]); game.equip(name); }
  await game.startRaid(names, 99);
  for (let step = 0; step < 60 * 90; step++) {
    if (step % 90 === 0) for (const [i, name] of names.entries()) {
      const p = game.player(name);
      if (p.state !== 'raid') continue;
      const e = game.live()[0];
      if (e) { game.move(name, [e.pos[0] - 5 - i, 1.6, e.pos[2] - 4]); game.look(name, [e.pos[0], 1.1, e.pos[2]]); game.hold(name, true); }
      p.mags[p.active] = 30;
    }
    await game.tick(DT);
  }
  assert.deepEqual(game.unknown, []);
  assert.deepEqual(game.logs, []);
  assert.ok(game.spawned.length > 100, 'there was a fight');
});

test('in a headset a shot leaves the muzzle of the gun in the hand; on the desktop, which has no hands, it leaves the eye along the crosshair', async () => {
  const setup = async (hands) => {
    const game = runDeadDrop();
    game.addPlayer('host', 'host', [GRID.origin[0], 1.6, GRID.origin[2] - 6]);
    game.equip('host');
    await game.startRaid(['host'], 777);
    const e = game.live('soldier')[0];
    for (const other of game.enemies()) if (other !== e) { other.dead = true; game.ctx.world.setWorldPose(other.id, { position: [0, -200, 0] }); }
    for (const s of game.slots.values()) if (/^dd-(e|p|r-wall)/.test(s.id)) s.disabled = true;
    e.pos = [GRID.origin[0], 0, GRID.origin[2] + 2]; e.yaw = e.home = Math.PI; e.route = [];
    game.move('host', [GRID.origin[0], 1.6, GRID.origin[2] - 6]);
    game.person('host').yaw = 0; game.person('host').pitch = 0;
    // The head looks at the soldier's chest; where the hand is decides whether a shot along that line still hits it.
    game.look('host', [e.pos[0], 1.1, e.pos[2]]);
    if (hands) game.person('host').hands = hands;
    game.player('host').nextShot = 0;       // still in the grace period: the soldier has not noticed anybody and stands where it is
    return { game, e };
  };
  const side = [GRID.origin[0] + 2, 1.2, GRID.origin[2] - 6];
  const vr = await setup({ left: side, right: side });
  await vr.game.shoot('host');
  assert.equal(vr.e.hp, ENEMIES.soldier.hp, 'the hand is two metres to the side: the shot passes beside the soldier');
  const aligned = await setup({ left: [GRID.origin[0], 1.1, GRID.origin[2] - 6], right: [GRID.origin[0], 1.1, GRID.origin[2] - 6] });
  await aligned.game.shoot('host');
  assert.ok(aligned.e.hp < ENEMIES.soldier.hp, 'the hand in line with the target hits it');
  const desktop = await setup(null);
  await desktop.game.shoot('host');
  assert.ok(desktop.e.hp < ENEMIES.soldier.hp, 'on the desktop the crosshair is the aim');
});

test('the radial menu of the real gun script reaches the director: it sends a short-lived command under the commands slot, and the director acts on it', async () => {
  const game = runDeadDrop();
  game.addPlayer('host', 'host', [0, 1.6, 0]);
  game.addPlayer('ana', 'ana', [1, 1.6, 0]);
  game.equip('host');
  const anaGun = game.equip('ana');
  await game.startRaid(['host', 'ana'], SEED);
  for (const e of game.enemies()) { e.dead = true; game.ctx.world.setWorldPose(e.id, { position: [0, -200, 0] }); }
  // The gun's script, in a world where Ana's gun is the one in her hand.
  const code = find(game.slots.get(`dd-gun-${anaGun}-brain`), 'codeBlock').code;
  const written = [];
  const brainCtx = {
    hierarchy: { getWorldPose: () => ({ position: [0, 1, 0], forward: [0, 0, 1] }) },
    equip: { holder: () => ({ playerId: 'ana', hand: 'right' }) },
    world: { setComponentField: (id, type, field, value, broadcast) => written.push({ id, type, field, value, broadcast }), spawn: (partial, options) => game.ctx.world.spawn(partial, options) }
  };
  const brain = new Function('ctx', code)(brainCtx);
  brain.onEquip({ playerId: 'ana', playerName: 'ana', hand: 'right' });
  brain.onTrigger({ phase: 'press', value: 1, playerId: 'ana', playerName: 'ana', hand: 'right' });
  brain.onTrigger({ phase: 'value', value: 0.5, playerId: 'ana', playerName: 'ana', hand: 'right' });
  assert.deepEqual({ seq: written.at(-1).value.seq, down: written.at(-1).value.down, equipped: written.at(-1).value.equipped }, { seq: 1, down: true, equipped: true });
  assert.equal(written.at(-1).broadcast, false);
  brain.onTrigger({ phase: 'release', value: 0, playerId: 'ana', playerName: 'ana', hand: 'right' });
  assert.equal(written.at(-1).value.down, false);
  const items = brain.getRadialItems();
  assert.deepEqual(items.map((i) => i.label), ['Reload', 'Medkit', 'Switch weapon']);
  const ana = game.player('ana');
  ana.mags[0] = 5;
  items[0].onSelect();
  const command = game.spawned.at(-1);
  assert.equal(command.parentId, ID.commands);
  assert.deepEqual(find(command, 'scriptState').data, { cmd: 'reload', gun: anaGun, player: 'ana' });
  assert.ok(find(command, 'expires').expiresAt > Date.now(), 'it expires by itself');
  assert.equal(command.ephemeral, false, 'a guest’s spawn reaches the host, which keeps it so the director can read it');
  await game.tick(0.2);
  assert.ok(ana.reload > 0, 'the director started the reload');
  await game.tick(WEAPONS.smg.reload + 0.2);
  assert.equal(ana.mags[0], WEAPONS.smg.mag);
  // Nobody holds the gun: nothing is sent.
  brainCtx.equip.holder = () => null;
  const before = game.spawned.length;
  brain.getRadialItems()[1].onSelect();
  assert.equal(game.spawned.length, before);
  brain.onUnequip({ playerId: 'ana', playerName: 'ana', hand: 'right' });
  assert.equal(written.at(-1).value.equipped, false);
});
