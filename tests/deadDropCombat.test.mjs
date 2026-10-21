import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENEMIES, GRID, POOLS, TUNING, WEAPONS } from '../src/lib/content/templates/deadDropData.ts';
import { ID } from '../src/lib/content/templates/deadDropKit.ts';
import { DT, runDeadDrop } from './helpers/deadDropGame.mjs';

const MID = [GRID.origin[0], 0, GRID.origin[2]];
const at = (dx, y, dz) => [MID[0] + dx, y, MID[2] + dz];
const soldier = ENEMIES.soldier;

/**
 * A raid with one player and one soldier, in the middle room with every wall between rooms and every prop switched off, so
 * what a test shows does not depend on the map. Walls are put back by `wall`.
 */
async function arena({ names = ['host'], soldierAt = [0, 0, 6], faceAway = false, kind = 'soldier' } = {}) {
  const game = runDeadDrop();
  for (const [i, name] of names.entries()) { game.addPlayer(name, name, [MID[0] + i, 1.6, MID[2] - 6]); game.equip(name); }
  await game.startRaid(names, 777);
  const enemy = game.live(kind)[0];
  for (const other of game.enemies()) if (other !== enemy) { other.dead = true; game.ctx.world.setWorldPose(other.id, { position: [0, -200, 0] }); }
  for (const s of game.slots.values()) if (/^dd-(e|p)-/.test(s.id) && !/-(l|r|top)$/.test(s.id)) s.disabled = true;
  for (const s of game.slots.values()) if (/^dd-e-.*-(l|r|top)$/.test(s.id)) s.disabled = true;
  enemy.pos = at(soldierAt[0], 0, soldierAt[2]);
  if (kind === 'turret') enemy.pos[1] = 1.1;
  enemy.yaw = enemy.home = faceAway ? 0 : Math.PI;
  enemy.route = [];
  for (const s of game.slots.values()) if (/^dd-r-wall/.test(s.id)) s.disabled = true;
  for (const [i, name] of names.entries()) { game.move(name, [MID[0] + i, 1.6, MID[2] - 6]); game.look(name, [enemy.pos[0], 1.1, enemy.pos[2]]); }
  game.wall = (id, on) => { if (on) delete game.slots.get(id).disabled; else game.slots.get(id).disabled = true; };
  return { game, enemy, p: game.player(names[0]) };
}
const grace = (game) => game.tick(TUNING.grace + 0.1);

test('a soldier that faces a player in the open sees them once the grace period is over, and not before', async () => {
  const { game, enemy } = await arena();
  await game.tick(TUNING.grace - 1);
  assert.equal(enemy.state, 'patrol', 'nobody is noticed in the first seconds');
  await game.tick(2);
  await game.tick(2);
  assert.equal(enemy.state, 'combat');
  assert.equal(enemy.target, 'host');
  assert.ok(game.sounds().length > 0, 'it shouts');
});

test('a wall between them hides a player, and taking the wall away shows them', async () => {
  const { game, enemy } = await arena({ soldierAt: [8, 0, 0] });
  game.move('host', at(2, 1.6, 0));
  game.look('host', enemy.pos);
  enemy.yaw = enemy.home = -Math.PI / 2;
  game.wall('dd-e-e11', true);
  await grace(game);
  await game.tick(3);
  assert.notEqual(enemy.state, 'combat', 'a solid wall at x = 5 blocks the view');
  game.wall('dd-e-e11', false);
  await game.tick(3);
  assert.equal(enemy.state, 'combat');
});

test('a soldier does not see what is behind its back, unless it is right on top of it', async () => {
  const { game, enemy } = await arena({ soldierAt: [0, 0, 6], faceAway: true });
  await grace(game);
  await game.tick(4);
  assert.notEqual(enemy.state, 'combat', 'eight metres behind it');
  game.move('host', at(0, 1.6, 4));
  await game.tick(3);
  assert.equal(enemy.state, 'combat', 'two metres behind it is too close not to notice');
});

test('it will not see further than its sight allows', async () => {
  const { game, enemy } = await arena({ soldierAt: [0, 0, 12] });
  game.move('host', at(0, 1.6, 12 - soldier.sight - 4));
  game.look('host', enemy.pos);
  await grace(game);
  await game.tick(3);
  assert.notEqual(enemy.state, 'combat');
  game.move('host', at(0, 1.6, 12 - soldier.sight + 4));
  await game.tick(3);
  assert.equal(enemy.state, 'combat');
});

test('a shot is heard as far as the weapon carries: the submachine gun further than the pistol', async () => {
  const dist = (pistol) => async () => {
    const { game, enemy } = await arena({ soldierAt: [0, 0, 6] });
    enemy.yaw = enemy.home = 0;       // looking away: it can only hear
    return { game, enemy, pistol };
  };
  const results = [];
  for (const [weapon, metres] of [['pistol', 20], ['pistol', 30], ['smg', 30]]) {
    const { game, enemy } = await dist(weapon === 'pistol')();
    const p = game.player('host');
    p.active = weapon === 'pistol' ? 1 : 0;
    enemy.pos = at(0, 0, 0);
    game.move('host', at(0, 1.6, -metres));
    game.look('host', at(0, 1.6, -metres - 10));      // shoots away from the soldier: only the noise reaches it
    await game.tick(TUNING.grace + 0.5);
    await game.shoot('host');
    results.push([weapon, metres, enemy.state]);
  }
  assert.deepEqual(results, [['pistol', 20, 'investigate'], ['pistol', 30, 'patrol'], ['smg', 30, 'investigate']]);
});

test('through a wall a noise carries only about half as far', async () => {
  const outcome = async (metres, walled) => {
    const { game, enemy } = await arena({ soldierAt: [0, 0, 8] });
    enemy.yaw = enemy.home = 0;
    game.wall('dd-e-n11', walled);       // the wall between the middle room and the one to its north (at z = 5)
    game.move('host', at(0, 1.6, 8 - metres));
    game.look('host', at(0, 1.6, 8 - metres - 10));      // shoots away from the soldier: only the noise reaches it
    await game.tick(TUNING.grace + 0.5);
    await game.shoot('host');
    return enemy.state;
  };
  assert.equal(await outcome(WEAPONS.smg.noise - 6, false), 'investigate', 'in the open');
  assert.equal(await outcome(WEAPONS.smg.noise - 6, true), 'patrol', 'the same distance through a wall');
  assert.equal(await outcome(WEAPONS.smg.noise * 0.55 - 4, true), 'investigate', 'closer, the wall does not matter');
});

test('an enemy that hears a noise walks to where it came from, looks around, and goes back to its route', async () => {
  const { game, enemy } = await arena({ soldierAt: [0, 0, 6] });
  game.move('host', at(100, 1.6, 0));       // somewhere it will never see
  enemy.route = [at(0, 0, 6), at(-3, 0, 6)];
  enemy.wp = 1;
  game.game.noise(at(0, 0, -3), 30);
  assert.equal(enemy.state, 'investigate');
  const start = [...enemy.pos];
  await game.tick(2);
  assert.ok(enemy.pos[2] < start[2] - 3, 'it went towards the noise');
  await game.tick(4);
  assert.equal(enemy.state, 'search');
  await game.tick(6);
  assert.equal(enemy.state, 'patrol');
});

test('a soldier in a fight aims with a visible laser first, then fires a burst, and a player who stays put is hit', async () => {
  const { game, enemy, p } = await arena({ soldierAt: [0, 0, 8] });
  game.move('host', at(0, 1.6, 0));
  await grace(game);
  let sawLaser = false, hpAtLaser = null;
  for (let i = 0; i < 60 * 8 && p.hp === TUNING.maxHp; i++) {
    await game.tick(DT);
    if (enemy.tele > 0.2 && enemy.laser >= 0 && game.pos(ID.tracer(enemy.laser))[1] > -100) { sawLaser = true; hpAtLaser = p.hp; }
  }
  assert.ok(sawLaser, 'the laser shows before the shots');
  assert.equal(hpAtLaser, TUNING.maxHp, 'and nobody is hurt while it does');
  assert.ok(p.hp < TUNING.maxHp, 'then the burst lands');
  assert.ok(game.sounds().length >= 2, 'a shout and a shot');
});

test('a step to the side after the laser has locked makes the whole burst miss', async () => {
  const { game, enemy, p } = await arena({ soldierAt: [0, 0, 8] });
  game.move('host', at(0, 1.6, 0));
  await grace(game);
  let dodged = false;
  for (let i = 0; i < 60 * 10 && !(dodged && enemy.burstLeft === 0 && enemy.tele <= 0 && enemy.cool > 0); i++) {
    await game.tick(DT);
    if (!dodged && enemy.tele > 0 && enemy.tele <= 0.1) { game.move('host', at(1.5, 1.6, 0)); dodged = true; }
  }
  assert.ok(dodged, 'there was a burst to dodge');
  assert.equal(p.hp, TUNING.maxHp, 'all three rounds went where the player had been');
});

test('armour takes its share off every hit, and a hit tells everyone with a red veil in front of the face', async () => {
  const { game, p } = await arena();
  game.game.hurt(p, 20);
  assert.equal(p.hp, 80);
  p.armor = 'armor2';
  game.game.hurt(p, 20);
  assert.equal(p.hp, 80 - 12);
  const veil = game.spawned.find((s) => s.name === 'Hit Flash');
  assert.ok(veil && veil.ephemeral, 'cheap to send: it is not a whole new world');
  assert.ok(Math.abs(veil.position[2] - (game.person('host').head[2] + 0.3 * Math.cos(game.person('host').yaw))) < 0.5);
});

test('hitting a soldier with the submachine gun takes off its damage; the head takes double', async () => {
  const { game, enemy } = await arena({ soldierAt: [0, 0, 5] });
  const p = game.player('host');
  await grace(game);
  enemy.state = 'patrol';
  await game.shoot('host');
  await game.tick(0.3);
  assert.ok(enemy.hp < soldier.hp, 'a hit');
  assert.ok([soldier.hp - WEAPONS.smg.damage, soldier.hp - 2 * WEAPONS.smg.damage].includes(enemy.hp), `lost ${soldier.hp - enemy.hp}`);
  assert.equal(p.mags[0], WEAPONS.smg.mag - 1);
  // The head, with the pistol (a tight cone), is worth double.
  enemy.hp = soldier.hp; p.active = 1; p.nextShot = 0;
  game.look('host', [enemy.pos[0], 1.62, enemy.pos[2]]);       // no time to pass: it is fighting now and would move
  await game.shoot('host');
  assert.equal(enemy.hp, soldier.hp - WEAPONS.pistol.damage * TUNING.headshot);
});

test('a solid wall stops a bullet, and the soldier behind it is not hurt', async () => {
  const { game, enemy } = await arena({ soldierAt: [8, 0, 0] });
  game.move('host', at(2, 1.6, 0));
  game.look('host', [enemy.pos[0], 1.2, enemy.pos[2]]);
  game.wall('dd-e-e11', true);
  await grace(game);
  await game.shoot('host');
  assert.equal(enemy.hp, soldier.hp);
  game.wall('dd-e-e11', false);
  game.player('host').nextShot = 0;
  await game.shoot('host');
  assert.ok(enemy.hp < soldier.hp, 'the same shot, with nothing in the way');
});

test('a soldier that is shot at goes for the shooter, and one that is killed tips over and stays where it fell', async () => {
  const { game, enemy, p } = await arena({ soldierAt: [0, 0, 5] });
  await grace(game);
  enemy.yaw = enemy.home = 0;
  enemy.hp = 10;
  game.look('host', [enemy.pos[0], 1.2, enemy.pos[2]]);
  await game.shoot('host');
  assert.equal(enemy.dead, true);
  assert.equal(enemy.fall < 1 || enemy.fall === 1, true);
  await game.tick(0.6);
  assert.equal(enemy.fall, 1, 'it has fallen');
  const rotation = game.poses.get(`${enemy.id}:rotation`);
  const [qx, qy, qz, qw] = rotation;
  const upY = 1 - 2 * (qx * qx + qz * qz);        // the y of the body's up direction: 1 standing, 0 lying down
  assert.ok(upY < 0.2, `tipped over, no longer standing (up is ${upY.toFixed(2)})`);
  assert.ok(game.pos(enemy.id)[1] > -100, 'and it lies there, not parked');
  assert.equal(p.kills, 1);
  assert.ok(game.bursts().length > 0);
  const before = [...game.pos(enemy.id)];
  await game.tick(1);
  assert.deepEqual(game.pos(enemy.id), before, 'a corpse does not move');
  assert.deepEqual(game.logs, []);
});

test('a turret watches from its post, never moves, and fires on a player in its cone', async () => {
  const { game, enemy, p } = await arena({ kind: 'turret', soldierAt: [0, 0, 8] });
  game.move('host', at(0, 1.6, 0));
  await grace(game);
  const where = [...enemy.pos];
  for (let i = 0; i < 60 * 8 && p.hp === TUNING.maxHp; i++) await game.tick(DT);
  assert.deepEqual(enemy.pos, where);
  assert.equal(enemy.state, 'combat');
  assert.ok(p.hp < TUNING.maxHp);
});

test('enemies keep to the inside of the map: none ever stands in a wall, on any map', async () => {
  for (const seed of [11, 222, 3333]) {
    const game = runDeadDrop();
    game.addPlayer('host', 'Host', [0, 1.6, 0]);
    game.equip('host');
    await game.startRaid(['host'], seed);
    game.move('host', [GRID.origin[0], 1.6, GRID.origin[2] - 14]);     // far from every soldier's eyes, in the entry row
    const starts = new Map(game.live('soldier').map((e) => [e, [...e.pos]]));
    let travelled = 0;
    const boxes = [...game.slots.values()].filter((s) => s.parentId === null && s.components.some((c) => c.type === 'collider') && s.id.startsWith('dd-') && !s.disabled && !/floor/.test(s.id));
    for (let step = 0; step < 60 * 40; step++) {
      await game.tick(DT);
      if (step % 15) continue;
      for (const e of game.live('soldier')) {
        for (const b of boxes) {
          if (b.disabled) continue;
          const inside = Math.abs(e.pos[0] - b.position[0]) < b.scale[0] / 2 - 0.05 && Math.abs(e.pos[2] - b.position[2]) < b.scale[2] / 2 - 0.05 && b.position[1] - b.scale[1] / 2 < 1;
          assert.ok(!inside, `seed ${seed}: a soldier is inside ${b.id} at ${e.pos.map((v) => v.toFixed(1))}`);
        }
        assert.ok(Math.abs(e.pos[0] - GRID.origin[0]) < 15 && Math.abs(e.pos[2] - GRID.origin[2]) < 15);
        travelled = Math.max(travelled, Math.hypot(e.pos[0] - starts.get(e)[0], e.pos[2] - starts.get(e)[2]));
      }
    }
    assert.ok(travelled > 3, `seed ${seed}: the soldiers did patrol (the furthest got ${travelled.toFixed(1)} m from its post)`);
  }
});
void POOLS;
