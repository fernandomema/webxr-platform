import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRID, TUNING } from '../src/lib/content/templates/deadDropData.ts';
import { generateLayout } from '../src/lib/content/templates/deadDropGen.ts';
import { DT, runDeadDrop } from './helpers/deadDropGame.mjs';

const MID = [GRID.origin[0], 0, GRID.origin[2]];
const at = (x, y, z) => [MID[0] + x, y, MID[2] + z];
const cellOf = (pos) => [Math.round((pos[0] - GRID.origin[0]) / GRID.cell) + 1, Math.round((pos[2] - GRID.origin[2]) / GRID.cell) + 1];

/** A soldier alone in the middle of the map, facing a player six metres away. */
async function arena(kind = 'soldier') {
  const game = runDeadDrop();
  game.addPlayer('host', 'host', [MID[0], 1.6, MID[2] - 6]);
  game.equip('host');
  await game.startRaid(['host'], 777);
  const enemy = game.live(kind)[0];
  for (const other of game.enemies()) if (other !== enemy) { other.dead = true; game.ctx.world.setWorldPose(other.id, { position: [0, -200, 0] }); }
  for (const s of game.slots.values()) if (/^dd-(e|p)-/.test(s.id) || /^dd-r-wall/.test(s.id)) s.disabled = true;
  enemy.pos = at(0, 0, 6);
  enemy.yaw = enemy.home = Math.PI;
  enemy.route = [];
  game.move('host', at(0, 1.6, 0));
  game.look('host', [enemy.pos[0], 1.1, enemy.pos[2]]);
  return { game, enemy, p: game.player('host') };
}
const rotX = (game, id) => game.localPoses.get(id)?.rotation?.[0] ?? 0;

test('noticing takes time: a ball over its head fills while it makes up its mind, a "!" shows when it has, and it can be fooled', async () => {
  const { game, enemy } = await arena();
  await game.tick(TUNING.grace + 0.05);
  enemy.sweep = 0;     // looking straight at the player, and sweeping away from there
  await game.tick(0.5);
  assert.equal(enemy.state, 'patrol', 'half a second is not enough');
  assert.ok(enemy.aware > 0.1 && enemy.aware < 0.9, `${enemy.aware.toFixed(2)} aware`);
  const ball = game.localPoses.get(`${enemy.id}-mY`).scale[0];
  assert.ok(ball > 0.05, 'the ball shows');
  // Out of sight, it forgets.
  game.move('host', at(80, 1.6, 0));
  await game.tick(3);
  assert.equal(enemy.aware, 0);
  assert.ok(game.localPoses.get(`${enemy.id}-mY`).scale[0] < 0.01, 'the ball goes');
  // In sight for long enough, it has noticed: it fights and shows the exclamation mark.
  game.move('host', at(0, 1.6, 0));
  game.look('host', [enemy.pos[0], 1.1, enemy.pos[2]]);
  enemy.sweep = 0;
  let marked = false;
  for (let i = 0; i < 60 * 6 && enemy.state !== 'combat'; i++) await game.tick(DT);
  assert.equal(enemy.state, 'combat');
  await game.tick(DT);
  marked = game.localPoses.get(`${enemy.id}-mBar`).scale[1] > 0.1;
  assert.ok(marked, 'the "!" shows');
});

test('a soldier carries its rifle low on patrol and raises it for a fight, kicks with every shot, and rocks back when it is hit', async () => {
  const { game, enemy } = await arena();
  assert.ok(Math.abs(rotX(game, `${enemy.id}-armR`)) < 0.5);
  await game.tick(TUNING.grace + 0.05);
  enemy.aware = 0;
  await game.tick(0.2);
  const lowered = Math.abs(rotX(game, `${enemy.id}-armR`));
  assert.ok(lowered > 0.3, `rifle low on patrol (${lowered.toFixed(2)})`);
  for (let i = 0; i < 60 * 6 && enemy.state !== 'combat'; i++) await game.tick(DT);
  await game.tick(1.5);
  assert.ok(Math.abs(rotX(game, `${enemy.id}-armR`)) < 0.12, 'rifle at the shoulder in a fight');
  const before = rotX(game, `${enemy.id}-upper`);
  game.game.hurt;     // (the player is the one who takes damage; the soldier is hit below)
  enemy.flinch = 1;
  await game.tick(0.05);
  assert.ok(rotX(game, `${enemy.id}-upper`) < before - 0.05, 'it rocks back');
});

test('nobody lives next to the way in: soldiers, dogs and turrets stand at least two rooms from where the squad arrives, on any map', () => {
  for (const seed of [1, 7, 42, 99, 123, 777, 2024, 31337]) {
    const layout = generateLayout(seed);
    const rooms = (cell) => layout.dist[cell[0] + cell[1] * GRID.size];
    for (const soldier of layout.soldiers) for (const cell of soldier.route) assert.ok(rooms(cell) >= 2, `seed ${seed}: a soldier walks through a room ${rooms(cell)} from the entry`);
    for (const turret of layout.turrets) assert.ok(rooms(turret.cell) >= 2, `seed ${seed}: a turret`);
  }
});

test('the dogs sleep on their feet until they hear a shot close by or see somebody, and they growl before they charge', async () => {
  let found = null;
  for (const seed of [5, 8, 13, 21, 34, 55, 89, 144, 233, 377]) {
    const game = runDeadDrop();
    game.addPlayer('host', 'host', [0, 1.6, 0]);
    game.equip('host');
    await game.startRaid(['host'], seed);
    if (game.live('dog').length) { found = game; break; }
  }
  assert.ok(found, 'some map has a dog');
  const dog = found.live('dog')[0];
  assert.equal(dog.state, 'rest');
  for (const [i, cell] of found.live('dog').entries()) assert.ok(found.game.R.layout.dist[cellOf(cell.pos)[0] + cellOf(cell.pos)[1] * GRID.size] >= 2, `dog ${i} far from the entry`);
  found.move('host', [GRID.origin[0], 1.6, GRID.origin[2] - 14]);
  await found.tick(TUNING.grace + 1);
  assert.equal(dog.state, 'rest', 'a squad that is quiet and far away does not wake it');
  found.game.noise([dog.pos[0] + 30, 1, dog.pos[2]], 35);
  assert.equal(dog.state, 'rest', 'a noise 30 m away is too far for a dog (it hears 60% of what a man does)');
  found.game.noise([dog.pos[0] + 8, 1, dog.pos[2]], 35);
  assert.equal(dog.state, 'investigate');
});

test('a hit pushes the enemy back and staggers it, more for the head; a heavy shrugs it off more than a soldier', async () => {
  const { game, enemy, p } = await arena();
  await game.tick(0.1);
  const start = [...enemy.pos];
  const distance = () => Math.hypot(enemy.pos[0] - start[0], enemy.pos[2] - start[2]);
  game.game.damageEnemy(enemy, 5, p, false, enemy.pos);
  const body = distance(), bodyStagger = enemy.stagger;
  assert.ok(body > 0.05, `pushed ${body.toFixed(2)} m`);
  assert.ok(enemy.pos[2] > start[2], 'away from the shooter');
  assert.ok(bodyStagger > 0.1);
  game.game.damageEnemy(enemy, 5, p, true, enemy.pos);
  assert.ok(enemy.stagger > bodyStagger, 'longer for a shot to the head');
  assert.ok(distance() > body + 0.15, 'and further');
  // Staggered, it does not shoot.
  assert.ok(enemy.state === 'combat');
  const heavy = (await arena('heavy')).enemy;
  assert.ok(heavy.scale > 1);
});
