import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLayout } from '../src/lib/content/templates/deadDropGen.ts';
import { DROPS, ENEMIES, GRID, ITEMS, POOLS, TUNING, WEAPONS } from '../src/lib/content/templates/deadDropData.ts';
import { DT, runDeadDrop } from './helpers/deadDropGame.mjs';

const MID = [GRID.origin[0], 0, GRID.origin[2]];
const at = (dx, y, dz) => [MID[0] + dx, y, MID[2] + dz];
const find = (slot, type) => slot.components.find((c) => c.type === type);

/** A raid on `seed`, for one player. */
async function raid(seed, name = 'host') {
  const game = runDeadDrop();
  game.addPlayer(name, name, [0, 1.6, 0]);
  game.equip(name);
  await game.startRaid([name], seed);
  return game;
}
/** The first seed (from `from`) whose raid has an enemy of a kind. */
async function seedWith(kind, from = 1) {
  for (let seed = from; seed < from + 200; seed++) {
    const game = await raid(seed);
    if (game.enemies().some((e) => e.kind === kind)) return seed;
  }
  throw new Error(`no seed makes a ${kind}`);
}
/** A raid with one enemy of `kind` in the middle room, six metres from the player, all walls and cover out of the way. */
async function duel(kind, { distance = 6 } = {}) {
  const seed = await seedWith(kind);
  const game = await raid(seed);
  const e = game.live(kind)[0];
  for (const other of game.enemies()) if (other !== e) { other.dead = true; game.ctx.world.setWorldPose(other.id, { position: [0, -200, 0] }); }
  for (const s of game.slots.values()) if (/^dd-(e|p|r-wall)/.test(s.id)) s.disabled = true;
  game.game.R.boxes.length = 0;
  e.pos = at(0, 0, distance); e.yaw = e.home = Math.PI; e.route = []; e.state = 'patrol';
  game.move('host', at(0, 1.6, 0));
  game.look('host', [e.pos[0], 1.1, e.pos[2]]);
  return { game, e, p: game.player('host') };
}

test('the vault has a heavy among its guards on most maps, and a barracks may keep dogs; never more than the pools hold', async () => {
  let heavies = 0, dogs = 0, vaults = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const game = await raid(seed);
    const layout = generateLayout(seed);
    const kinds = game.enemies().map((e) => e.kind);
    assert.ok(kinds.filter((k) => k === 'heavy').length <= 1, `seed ${seed}: at most one heavy`);
    assert.ok(kinds.filter((k) => k === 'dog').length <= POOLS.dogs);
    assert.ok(kinds.filter((k) => k === 'soldier' || k === 'heavy').length <= POOLS.soldiers);
    for (const e of game.enemies().filter((e) => e.kind === 'heavy')) {
      const cell = [Math.round((e.pos[0] - GRID.origin[0]) / GRID.cell) + 1, Math.round((e.pos[2] - GRID.origin[2]) / GRID.cell) + 1];
      assert.equal(layout.roles[cell[0] + cell[1] * 3], 'vault', `seed ${seed}: the heavy starts in the vault`);
      heavies++;
    }
    for (const e of game.enemies().filter((e) => e.kind === 'dog')) {
      const cell = [Math.round((e.pos[0] - GRID.origin[0]) / GRID.cell) + 1, Math.round((e.pos[2] - GRID.origin[2]) / GRID.cell) + 1];
      assert.equal(layout.roles[cell[0] + cell[1] * 3], 'barracks', `seed ${seed}: dogs are kept in barracks`);
      dogs++;
    }
    if (layout.soldiers.some((s) => layout.roles[s.route[0][0] + s.route[0][1] * 3] === 'vault')) vaults++;
  }
  assert.ok(heavies >= vaults * 0.6, `${heavies} heavies in ${vaults} vaults`);
  assert.ok(dogs >= 5, `${dogs} dogs in sixty raids`);
});

test('a heavy is big, takes half the damage on the body and full damage on the head, and needs a lot of both', async () => {
  const { game, e, p } = await duel('heavy');
  assert.equal(e.hp, ENEMIES.heavy.hp);
  assert.equal(e.scale, 1.3);
  await game.tick(0.1);
  assert.deepEqual(game.poses.get(`${e.id}:scale`), [1.3, 1.3, 1.3], 'drawn bigger');
  p.nextShot = 0;
  await game.shoot('host', { hold: DT });
  const body = ENEMIES.heavy.hp - e.hp;
  assert.equal(body, WEAPONS.smg.damage * 0.5, 'half of the submachine gun’s damage');
  // The head is higher than a soldier’s and takes everything.
  e.hp = ENEMIES.heavy.hp; p.active = 1; p.nextShot = 0;
  game.look('host', [e.pos[0], 1.62 * 1.3, e.pos[2]]);
  await game.shoot('host', { hold: DT });
  assert.equal(ENEMIES.heavy.hp - e.hp, WEAPONS.pistol.damage * TUNING.headshot);
  assert.ok(ENEMIES.heavy.hp / (WEAPONS.smg.damage * 0.5) > 25, 'more than twenty-five body shots with a submachine gun');
});

test('a heavy fires long bursts from a big gun, and drops something worth taking when it dies', async () => {
  const { game, e, p } = await duel('heavy', { distance: 9 });
  await game.tick(TUNING.grace + 0.5);
  e.state = 'combat'; e.target = 'host'; e.react = 0; e.cool = 0; e.sees = true;
  let most = 0;
  for (let i = 0; i < 60 * 6 && p.hp === TUNING.maxHp; i++) { await game.tick(DT); most = Math.max(most, e.burstLeft); }
  assert.equal(most, ENEMIES.heavy.burst, `a burst of ${ENEMIES.heavy.burst}`);
  assert.ok(p.hp < TUNING.maxHp);
  const before = game.game.R.loot.length;
  e.hp = 1;
  e.state = 'patrol'; e.burstLeft = 0; e.tele = 0;
  game.player('host').hp = TUNING.maxHp;
  game.look('host', [e.pos[0], 1.1, e.pos[2]]);
  game.player('host').nextShot = 0;
  await game.shoot('host', { hold: DT });
  assert.equal(e.dead, true);
  const drop = game.game.R.loot[before];
  assert.ok(drop, 'something fell');
  assert.equal(drop.id, DROPS.heavy.item);
  assert.ok(Math.hypot(drop.pos[0] - e.pos[0], drop.pos[2] - e.pos[2]) < 1);
  assert.equal(game.pos(`dd-l-${drop.i}`)[1] > 0, true);
  assert.equal(find(game.slots.get(`dd-l-${drop.i}-label`), 'textDisplay').lines[0], ITEMS[DROPS.heavy.item].name);
});

test('soldiers sometimes leave a clip, which can be picked up like anything else', async () => {
  let drops = 0, kills = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const game = await raid(seed);
    const e = game.live('soldier')[0];
    if (!e) continue;
    for (const other of game.enemies()) if (other !== e) other.dead = true;
    e.pos = at(0, 0, 5); e.state = 'patrol'; e.route = []; e.hp = 1;
    for (const s of game.slots.values()) if (/^dd-(e|p|r-wall)/.test(s.id)) s.disabled = true;
    game.move('host', at(0, 1.6, 0));
    game.look('host', [e.pos[0], 1.1, e.pos[2]]);
    game.player('host').nextShot = 0;
    const before = game.game.R.loot.length;
    await game.shoot('host', { hold: DT });
    kills++;
    if (game.game.R.loot.length > before) {
      drops++;
      const drop = game.game.R.loot[before];
      assert.deepEqual([drop.id, drop.n], [DROPS.soldier.item, DROPS.soldier.n]);
      const rounds = game.player('host').pack.find((x) => x.id === 'ammo9').n;
      game.move('host', [drop.pos[0], 1.6, drop.pos[2] - 1]);
      game.look('host', drop.pos);
      await game.tick(0.6);
      assert.equal(game.player('host').pack.find((x) => x.id === 'ammo9').n, rounds + DROPS.soldier.n);
    }
  }
  assert.ok(drops >= kills * 0.15 && drops <= kills * 0.6, `${drops} drops in ${kills} kills`);
});

test('a dog runs at what it has seen, much faster than a man, and bites from close range, no further and not faster than it can', async () => {
  const { game, e, p } = await duel('dog', { distance: 14 });
  await game.tick(TUNING.grace + 0.1);
  e.state = 'combat'; e.target = 'host'; e.react = 0; e.sees = true;
  const start = e.pos[2];
  await game.tick(1);
  assert.ok(start - e.pos[2] > 5, `${(start - e.pos[2]).toFixed(1)} m in a second: a man could not`);
  assert.ok(start - e.pos[2] < ENEMIES.dog.run + 0.5);
  let bites = [];
  for (let i = 0; i < 60 * 3; i++) {
    const hp = p.hp;
    await game.tick(DT);
    if (p.hp < hp) bites.push(Math.round((hp - p.hp) * 10) / 10);
  }
  assert.ok(bites.length >= 2 && bites.length <= 4, `${bites.length} bites in three seconds`);
  assert.ok(bites.every((b) => b === ENEMIES.dog.damage));
  const close = Math.hypot(e.pos[0] - game.person('host').head[0], e.pos[2] - game.person('host').head[2]);
  assert.ok(close <= ENEMIES.dog.melee + 0.1, `it stopped at ${close.toFixed(2)} m`);
  assert.equal(e.laser, -1, 'a dog does not aim');
});

test('a dog cannot bite across the room, and a step back out of its reach saves a bite', async () => {
  const { game, e, p } = await duel('dog', { distance: 3 });
  await game.tick(TUNING.grace + 0.1);
  e.state = 'combat'; e.target = 'host'; e.react = 0; e.sees = true; e.cool = 0;
  game.move('host', at(0, 1.6, -30));
  game.look('host', e.pos);
  e.pos = at(0, 0, 0);
  await game.tick(0.3);
  assert.equal(p.hp, TUNING.maxHp, 'thirty metres away');
});

test('a dog is small and falls in two or three shots; it rolls onto its side and stays there', async () => {
  const { game, e, p } = await duel('dog', { distance: 5 });
  e.pos[1] = 0;
  game.look('host', [e.pos[0], 0.55, e.pos[2]]);
  let shots = 0;
  for (; shots < 8 && !e.dead; shots++) {
    p.nextShot = 0;
    p.active = 1;                 // the pistol
    game.look('host', [e.pos[0], 0.55, e.pos[2]]);
    await game.shoot('host', { hold: DT });
  }
  assert.ok(e.dead, 'dead');
  assert.ok(shots <= 3, `${shots} pistol shots for ${ENEMIES.dog.hp} points`);
  await game.tick(0.6);
  const q = game.poses.get(`${e.id}:rotation`);
  const upY = 1 - 2 * (q[0] * q[0] + q[2] * q[2]);          // the height of the dog’s back direction: 1 on its feet, 0 on its side
  assert.ok(upY < 0.2, `on its side (${upY.toFixed(2)})`);
  const where = [...game.pos(e.id)];
  await game.tick(1);
  assert.deepEqual(game.pos(e.id), where, 'and stays');
});

test('a noise wakes the dogs as it wakes the soldiers, and a turret ignores it', async () => {
  const { game, e } = await duel('dog', { distance: 10 });
  game.game.noise(at(0, 0, -5), 30);
  assert.equal(e.state, 'investigate');
  const turret = await duel('turret', { distance: 10 });
  turret.game.game.noise(at(0, 0, 0), 60);
  assert.equal(turret.e.state, 'patrol', 'a turret only watches');
});

test('the dog’s legs swing as it runs, and the heavy walks like a soldier, only slower', async () => {
  const { game, e } = await duel('dog', { distance: 10 });
  e.state = 'investigate'; e.alert = at(0, 0, 0); e.alertT = 5;
  game.move('host', at(80, 1.6, 0));
  let swung = false;
  for (let i = 0; i < 40; i++) { await game.tick(DT); const leg = game.localPoses.get(`${e.id}-legF`); if (leg && Math.abs(leg.rotation[0]) > 0.1) swung = true; }
  assert.ok(swung, 'the dog’s front legs swing');
  const heavy = await duel('heavy');
  heavy.e.state = 'investigate'; heavy.e.alert = at(0, 0, -2); heavy.e.alertT = 10;
  heavy.game.move('host', at(80, 1.6, 0));
  const z0 = heavy.e.pos[2];
  await heavy.game.tick(2);
  const moved = z0 - heavy.e.pos[2];
  assert.ok(moved > 2 && moved < ENEMIES.heavy.run * 2 + 0.2, `${moved.toFixed(1)} m in two seconds`);
});

test('the soldier pool is shared by soldiers and heavies and nothing else touches a part that is not there', async () => {
  for (const seed of [3, 7, 21, 42]) {
    const game = await raid(seed);
    const e = game.live()[0];
    void e;
    for (let i = 0; i < 60 * 20; i++) await game.tick(DT);
    assert.deepEqual(game.unknown, []);
    assert.deepEqual(game.logs, []);
  }
});
