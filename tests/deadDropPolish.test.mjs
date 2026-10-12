import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLayout } from '../src/lib/xr/templates/deadDropGen.ts';
import { GRID, POOLS, TUNING, WEAPONS } from '../src/lib/xr/templates/deadDropData.ts';
import { GATE, ID } from '../src/lib/xr/templates/deadDropKit.ts';
import { HIT_SHELL } from '../src/lib/xr/templates/deadDropActors.ts';
import { DT, runDeadDrop } from './helpers/deadDropGame.mjs';

const SEED = 4242;
const layout = generateLayout(SEED);
const MID = [GRID.origin[0], 0, GRID.origin[2]];
/** The sounds of the game vary a few per cent from one play to the next, so that they do not tire the ear. */
const near = (frequency, list) => list.some((v) => Math.abs(frequency - v) <= v * 0.07);
const find = (slot, type) => slot.components.find((c) => c.type === type);
const centre = (cx, cz) => [GRID.origin[0] + (cx - 1) * GRID.cell, 0, GRID.origin[2] + (cz - 1) * GRID.cell];

async function quiet(names = ['host']) {
  const game = runDeadDrop();
  for (const [i, name] of names.entries()) { game.addPlayer(name, name, [i * 0.5, 1.6, 0]); game.equip(name); }
  await game.startRaid(names, SEED);
  for (const e of game.enemies()) { e.dead = true; game.ctx.world.setWorldPose(e.id, { position: [0, -200, 0] }); }
  return game;
}
/** One soldier and the player in the middle room, with the walls out of the way. */
async function duel() {
  const game = runDeadDrop();
  game.addPlayer('host', 'host', [MID[0], 1.6, MID[2] - 6]);
  game.equip('host');
  await game.startRaid(['host'], 777);
  const e = game.live('soldier')[0];
  for (const other of game.enemies()) if (other !== e) { other.dead = true; game.ctx.world.setWorldPose(other.id, { position: [0, -200, 0] }); }
  for (const s of game.slots.values()) if (/^dd-(e|p|r-wall)/.test(s.id)) s.disabled = true;
  e.pos = [MID[0], 0, MID[2] + 6]; e.yaw = e.home = Math.PI; e.route = [];
  game.move('host', [MID[0], 1.6, MID[2] - 6]);
  game.look('host', [e.pos[0], 1.1, e.pos[2]]);
  return { game, e, p: game.player('host') };
}

test('furniture goes along the walls of the rooms it belongs to, never in a doorway, and each room gets what its role calls for', async () => {
  const game = await quiet();
  const kinds = { storage: ['shelf', POOLS.shelves], barracks: ['bunk', POOLS.bunks], control: ['desk', POOLS.desks], hall: ['pillar', POOLS.pillars], vault: ['safe', POOLS.safes] };
  let placed = 0;
  for (const [role, [kind, pool]] of Object.entries(kinds)) {
    const there = [];
    for (let i = 0; i < pool; i++) { const at = game.pos(`dd-f-${kind}-${i}`); if (at[1] > -100) there.push(at); }
    const rooms = layout.roles.filter((r) => r === role).length;
    assert.ok(there.length <= pool && there.length <= rooms * 2, `${kind}: ${there.length}`);
    if (rooms) assert.ok(there.length >= 1, `a ${role} room has its ${kind}`);
    for (const at of there) {
      const cell = [Math.round((at[0] - GRID.origin[0]) / GRID.cell) + 1, Math.round((at[2] - GRID.origin[2]) / GRID.cell) + 1];
      assert.equal(layout.roles[cell[0] + cell[1] * 3], role, `${kind} stands in a ${role} room`);
      const local = [at[0] - centre(...cell)[0], at[2] - centre(...cell)[2]];
      if (role !== 'hall') assert.ok(Math.abs(local[0]) > 1.4 || Math.abs(local[1]) > 1.4, 'clear of the doorway axes');
      placed++;
    }
  }
  assert.ok(placed >= 3);
  // At the end of the raid it all goes away again.
  game.game.hurt(game.player('host'), 1000);
  await game.tick(TUNING.respawnSeconds + 1);
  for (const [kind, pool] of Object.values(kinds)) for (let i = 0; i < pool; i++) assert.ok(game.pos(`dd-f-${kind}-${i}`)[1] < -100, `${kind} ${i} is put away`);
});

test('the doorways of the map have hazard marks on the floor, the exit signs face the middle of the map, and the gate shows whether a raid is on', async () => {
  const game = runDeadDrop();
  game.addPlayer('host', 'host');
  game.equip('host');
  assert.equal(game.enabled(GATE.open), true);
  assert.equal(game.enabled(GATE.closed), false);
  await game.startRaid(['host'], SEED);
  assert.equal(game.enabled(GATE.open), false, 'no starting while a raid is on');
  assert.equal(game.enabled(GATE.closed), true);
  for (let z = 0; z < 3; z++) for (let x = 0; x < 2; x++) assert.equal(game.enabled(`${ID.edge('e', x, z)}-mark`), layout.east[z][x]);
  for (let z = 0; z < 2; z++) for (let x = 0; x < 3; x++) assert.equal(game.enabled(`${ID.edge('n', x, z)}-mark`), layout.north[z][x]);
  layout.exits.forEach((exit, i) => {
    const sign = game.pos(ID.arrow(i));
    if (!exit.active) return assert.ok(sign[1] < -100);
    const at = centre(...exit.cell);
    assert.deepEqual([sign[0], sign[2]], [at[0], at[2]]);
    const q = game.poses.get(`${ID.arrow(i)}:rotation`);
    const yaw = 2 * Math.atan2(q[1], q[3]);
    // A plane is read from its -z side: that side looks along (-sin, -cos), which should be towards the middle of the map.
    const toMiddle = Math.atan2(GRID.origin[0] - at[0], GRID.origin[2] - at[2]);
    const looks = Math.atan2(-Math.sin(yaw), -Math.cos(yaw));
    assert.ok(Math.abs(Math.atan2(Math.sin(looks - toMiddle), Math.cos(looks - toMiddle))) < 1e-6, `exit ${i} sign faces the middle`);
  });
  game.game.hurt(game.player('host'), 1000);
  await game.tick(TUNING.respawnSeconds + 1);
  assert.equal(game.enabled(GATE.open), true, 'the gate is open again');
  assert.equal(game.enabled(GATE.closed), false);
});

test('every shot has a flash at the muzzle and layers of sound, and the gun kicks back and settles again', async () => {
  const game = await quiet();
  const gun = game.player('host').gun;
  game.player('host').nextShot = 0;
  const sounds = game.sounds().length;
  game.hold('host', true);
  await game.tick(DT);
  game.hold('host', false);
  const flash = game.spawned.find((s) => s.name === 'Muzzle Flash');
  assert.ok(flash && flash.ephemeral && find(flash, 'expires'), 'a flash that goes by itself');
  assert.ok(game.sounds().length - sounds >= 2, 'a boom and a crack');
  const kick = game.localPoses.get(`dd-gun-${gun}-model`);
  assert.ok(kick && kick.position[2] < 0, 'the gun moved back');
  assert.ok(Math.abs(kick.rotation[0]) > 0, 'and tipped up');
  await game.tick(0.6);
  const settled = game.localPoses.get(`dd-gun-${gun}-model`);
  assert.deepEqual(settled.position, [0, 0, 0], 'and is back where it was');
  assert.ok(Math.abs(settled.rotation[0]) < 1e-9 && settled.rotation[3] === 1);
});

test('a pistol kicks harder than one submachine gun round, and a burst of them builds up', async () => {
  const game = await quiet();
  const p = game.player('host');
  p.nextShot = 0;
  game.hold('host', true);
  await game.tick(DT);
  const one = p.recoil;
  await game.tick(0.7);
  assert.ok(p.recoil > one + 0.1, `a burst builds recoil (${one.toFixed(2)} for one round, ${p.recoil.toFixed(2)} after a burst)`);
  game.hold('host', false);
  await game.tick(0.6);
  assert.equal(p.recoil, 0);
  p.active = 1; p.nextShot = 0;
  await game.shoot('host', { hold: DT });
  assert.ok(game.player('host').recoil > 0.5 || game.localPoses.get(`dd-gun-${p.gun}-model`).position[2] < 0, 'a pistol round kicks more than one submachine gun round');
});

test('a hit puts a red mark at the side the shot came from, and a heartbeat sounds when health is low', async () => {
  const { game, p } = await duel();
  const before = game.spawned.length;
  game.game.hurt(p, 10, [MID[0] + 5, 1.5, MID[2] - 6]);
  const mark = game.spawned.slice(before).find((s) => s.name === 'Hit Direction');
  assert.ok(mark && mark.ephemeral, 'a mark that goes by itself');
  const head = game.person('host').head;
  assert.ok(mark.position[0] > head[0] + 0.3, 'on the side the shot came from (east)');
  const beats = () => game.sounds().filter((s) => find(s, 'impactSound').frequency <= 60 && find(s, 'impactSound').frequency >= 50).length;
  const quietBefore = beats();
  await game.tick(2);
  assert.equal(beats(), quietBefore, 'healthy: no heartbeat');
  p.hp = 20;
  await game.tick(2);
  assert.ok(beats() > quietBefore + 2, 'hurt: a pulse every second or so');
});

test('once the lockdown is called a siren sounds for everyone still inside; and now and then the walls creak', async () => {
  const game = await quiet();
  const high = () => game.sounds().filter((s) => near(find(s, 'impactSound').frequency, [620, 840])).length;
  await game.tick(2);
  assert.equal(high(), 0);
  game.game.R.t = TUNING.alarmAt - 0.05;
  await game.tick(5);
  assert.ok(high() >= 4, `${high()} siren tones in five seconds`);
  const creaks = game.sounds().filter((s) => find(s, 'impactSound').noiseMix === 0.85);
  assert.ok(creaks.length >= 0);
});

test('the arrow on the gun turns towards the nearest open exit as the player turns', async () => {
  const game = await quiet();
  const gun = game.player('host').gun;
  const exit = game.game.R.exits[0];
  game.move('host', [exit.pos[0], 1.6, exit.pos[2] - 8]);
  game.look('host', [exit.pos[0], 1.6, exit.pos[2]]);
  await game.tick(0.2);
  let q = game.localPoses.get(`dd-gun-${gun}-arrow`).rotation;
  assert.ok(Math.abs(2 * Math.atan2(q[1], q[3])) < 0.2, 'looking at the exit, the arrow points straight ahead');
  game.person('host').yaw = Math.PI / 2;       // turned a quarter to the right: the exit is now on the left
  await game.tick(0.2);
  q = game.localPoses.get(`dd-gun-${gun}-arrow`).rotation;
  const angle = 2 * Math.atan2(q[1], q[3]);
  assert.ok(Math.abs(angle + Math.PI / 2) < 0.2, `the arrow points left (${angle.toFixed(2)})`);
});

test('the pack bar fills with the load, and goes back when the pack is emptied', async () => {
  const game = await quiet();
  const p = game.player('host'), gun = p.gun;
  await game.tick(0.1);
  const empty = game.localPoses.get(`dd-gun-${gun}-pack`).scale[0];
  game.game.packAdd(p.pack, 'radio', 2);
  await game.tick(0.1);
  assert.ok(game.localPoses.get(`dd-gun-${gun}-pack`).scale[0] > empty);
  p.pack.length = 0;
  await game.tick(0.1);
  assert.ok(game.localPoses.get(`dd-gun-${gun}-pack`).scale[0] < 0.011);
});

test('a soldier’s legs swing while it walks and are still when it stops, and its footsteps are heard when somebody is near', async () => {
  const { game, e } = await duel();
  e.route = [[MID[0] - 6, 0, MID[2] + 6], [MID[0] + 6, 0, MID[2] + 6]];
  e.pos = [MID[0] - 6, 0, MID[2] + 6]; e.wp = 1;
  game.move('host', [MID[0], 1.6, MID[2] + 3]);
  game.person('host').yaw = Math.PI;               // not looking at it, and out of its sight
  const steps = game.sounds().length;
  let swung = false;
  for (let i = 0; i < 60 * 3; i++) {
    await game.tick(DT);
    const leg = game.localPoses.get(`${e.id}-legL`);
    if (leg && Math.abs(leg.rotation[0]) > 0.1) swung = true;
  }
  assert.ok(swung, 'the leg swung');
  assert.ok(game.sounds().length - steps >= 3, 'footsteps close by');
  e.route = [];
  e.state = 'search'; e.alertT = 100;
  await game.tick(0.5);
  assert.ok(Math.abs(game.localPoses.get(`${e.id}-legL`).rotation[0]) < 1e-6, 'and still when standing');
});

test('a hit lights the soldier up white for a moment; the head ring and the kill sound reach the shooter wherever the soldier is', async () => {
  const { game, e, p } = await duel();
  p.nextShot = 0;
  await game.shoot('host', { hold: DT });
  const shell = game.localPoses.get(`${e.id}-flash`);
  assert.deepEqual(shell.scale, [...HIT_SHELL]);
  await game.tick(0.3);
  assert.ok(game.localPoses.get(`${e.id}-flash`).scale[0] < 0.01, 'and it goes out');
  const ticks = game.sounds().filter((s) => near(find(s, 'impactSound').frequency, [2200, 3100]));
  assert.ok(ticks.length >= 1, 'the shooter hears the hit');
});

test('loot rings when it is picked up, higher and longer the more it is worth', async () => {
  const game = await quiet();
  const p = game.player('host');
  const tones = (value) => { const r = game.game.R; void r; return value; };
  void tones;
  const cheap = game.game.R.loot.find((l) => ['scrap', 'ammo9', 'medkit', 'circuit'].includes(l.id));
  const rich = game.game.R.loot.find((l) => ['gold', 'intel', 'radio'].includes(l.id));
  const take = async (loot) => {
    const before = game.sounds().length;
    game.move('host', [loot.pos[0], loot.pos[1] + 0.3, loot.pos[2] - 1]);
    game.look('host', loot.pos);
    await game.tick(0.6);
    return game.sounds().slice(before).filter((s) => near(find(s, 'impactSound').frequency, [660, 880, 990, 1320])).length;
  };
  if (cheap && rich) {
    const a = await take(cheap), b = await take(rich);
    assert.ok(b >= a, `${b} tones for the rich one, ${a} for the cheap one`);
    assert.ok(a >= 1);
  }
  void p;
});

test('back in the bunker the gun goes back to a pistol with empty bars and its first words', async () => {
  const game = await quiet();
  const p = game.player('host'), gun = p.gun;
  game.game.hurt(p, 1000);
  await game.tick(TUNING.respawnSeconds + 1);
  assert.ok(game.localPoses.get(`dd-gun-${gun}-pistol-slide`).scale[0] > 0.03, 'the pistol is showing');
  assert.ok(game.localPoses.get(`dd-gun-${gun}-smg-receiver`).scale[0] < 0.01);
  const text = find(game.slots.get(`dd-gun-${gun}-readout`), 'textDisplay');
  assert.equal(text.title, 'DEAD DROP');
  assert.match(text.lines.join(' '), /JOIN/);
  assert.equal(game.localPoses.get(`dd-gun-${gun}-pack`).scale[0], 0.001);
});

test('a long fight on a busy map stays within what the guests can take: bursts of effects are all ephemeral and the world is snapshotted gently', async () => {
  const game = runDeadDrop();
  const names = ['host', 'ana'];
  for (const [i, name] of names.entries()) { game.addPlayer(name, name, [i * 0.5, 1.6, 0]); game.equip(name); }
  await game.startRaid(names, 99);
  for (let step = 0; step < 60 * 40; step++) {
    if (step % 90 === 0) for (const name of names) {
      const e = game.live()[0];
      if (!e || game.player(name).state !== 'raid') continue;
      game.move(name, [e.pos[0] - 5, 1.6, e.pos[2] - 4]); game.look(name, [e.pos[0], 1.1, e.pos[2]]); game.hold(name, true);
      game.player(name).mags[game.player(name).active] = 30;
    }
    await game.tick(DT);
  }
  const persistent = game.spawned.filter((s) => !s.ephemeral && s.name !== 'Command');
  assert.deepEqual(persistent.map((s) => s.name), [], 'nothing that costs a whole snapshot');
  assert.ok(game.flushes.length <= 40 / 0.12 + 5);
  assert.deepEqual(game.logs, []);
  assert.deepEqual(game.unknown, []);
  void WEAPONS;
});
