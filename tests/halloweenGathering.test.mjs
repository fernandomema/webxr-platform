import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBuiltinMeshId } from '../packages/engine/src/assets/ref.ts';
import { createSlot } from '../packages/engine/src/ecs/types.ts';
import { createTestWorld } from '../packages/engine/src/testing.ts';
import { WorldStorageService } from '../packages/engine/src/xr/worldStorageService.ts';
import { toWorld, yawQuat } from '../src/lib/content/templates/arcadeKit.ts';
import { buildHalloweenGathering } from '../src/lib/content/templates/halloweenGathering.ts';
import { DOOR, HALLOWEEN } from '../src/lib/content/templates/halloweenGatheringConfig.ts';
import { CRANK, MUSIC_BOX_TUNE } from '../src/lib/content/templates/halloweenGatheringToys.ts';
import { readFile } from 'node:fs/promises';

const tree = buildHalloweenGathering();
const find = (slot, type) => slot.components.find((c) => c.type === type);
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

function storage() {
  return new WorldStorageService({
    getLocalPlayerId: () => 'ana', getPlayerName: (id) => id, getPublication: () => null, getRoomCode: () => null,
    getRole: () => 'solo', isSignedIn: () => false, relay: async () => ({ ok: true })
  });
}

/** A square with people in it. `extra` are objects lying about (the ones people carry). */
function square({ extra = [], keep = storage(), players = ['ana'] } = {}) {
  const world = createTestWorld([...buildHalloweenGathering(), ...extra], { storage: keep });
  for (const id of players) world.addPlayer({ id, name: id[0].toUpperCase() + id.slice(1), head: [0, 1.6, 3] });
  const run = world.run(HALLOWEEN.director);
  const state = () => world.component(HALLOWEEN.director, 'scriptState').data;
  const at = (house, l) => toWorld(HALLOWEEN.houses[house].frame, l);
  /** Lets `seconds` of game time pass, letting what is asynchronous answer. */
  const wait = async (seconds) => { for (let i = 0; i < Math.ceil(seconds / 0.1); i++) { world.tick(0.1); await settle(); } };
  /** The pose of a hand held out towards the door of `house`: pointing at it, as a fist does when it knocks. */
  const fistAt = (house, z, x = 0.1) => ({ position: at(house, [x, 1.2, z]), rotation: yawQuat(HALLOWEEN.houses[house].frame.yaw) });
  /** One knock: the fist goes in to the door at speed and back out again. */
  const strike = (house, player, hand) => {
    for (let z = -1.9; z < -1.0; z += 0.03) { player.hands[hand] = fistAt(house, z - 0.09); world.tick(1 / 60); }
    for (let z = -1.0; z > -1.9; z -= 0.03) { player.hands[hand] = fistAt(house, z - 0.09); world.tick(1 / 60); }
    world.tick(0.1);
  };
  /** A fist striking the door of `house`, as fast as a real knock, twice. */
  const knock = async (house, playerId = 'ana', hand = 'right') => {
    const player = world.player(playerId);
    strike(house, player, hand); strike(house, player, hand);
    delete player.hands[hand];
    await settle();
  };
  const palm = (house) => at(house, [DOOR.handX, DOOR.handY + 0.1, DOOR.rest - DOOR.reach]);
  const door = (house) => world.slot(`${HALLOWEEN.houses[house].id}-door`);
  return { world, run, state, at, wait, knock, strike, fistAt, palm, door };
}

const toy = (id, name = 'Toy') => createSlot({ id, name, position: [0, -20, 0], components: [{ type: 'container' }, { type: 'grabbable', scalable: false }] });
const toyParts = (id) => [createSlot({ id: id + '-body', parentId: id, name: 'Toy Body', scale: [0.1, 0.1, 0.1], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' }, color: '#22c55e' }, { type: 'collider', shape: 'sphere' }] })];
const gifts = (world) => [...world.slots.values()].filter((slot) => slot.id.startsWith('hg-g-') && !slot.parentId);

test('Lantern Night is a valid scene: unique ids, known parents, built-in meshes, a size a headset can take', () => {
  const ids = new Set(tree.map((slot) => slot.id));
  assert.equal(ids.size, tree.length, 'ids are unique');
  assert.ok(tree.length < 500, `${tree.length} slots`);
  for (const slot of tree) {
    assert.ok(slot.position.every(Number.isFinite) && slot.scale.every((v) => Number.isFinite(v) && v > 0), `${slot.id} has real numbers`);
    if (slot.parentId !== null) assert.ok(ids.has(slot.parentId), `${slot.id} has its parent`);
    const mesh = find(slot, 'meshRenderer');
    if (mesh) assert.ok(mesh.meshRef.kind === 'builtin' && isBuiltinMeshId(mesh.meshRef.id), `${slot.id} uses a built-in mesh`);
  }
  assert.equal(tree.filter((slot) => find(slot, 'skybox')).length, 1);
  assert.equal(tree.filter((slot) => find(slot, 'spawnPoint')).length, 1);
  const lights = tree.filter((slot) => find(slot, 'pointLight')).length;
  assert.ok(lights <= 24, `${lights} lights`);
});

test('there is no menu: not a panel, not a button; everything is done with the hands', () => {
  assert.equal(tree.filter((slot) => find(slot, 'uiPanel') || find(slot, 'uiElement')).length, 0);
});

test('it is a built-in world, every script compiles, and the ids they name exist', async () => {
  const registry = await readFile(new URL('../src/lib/content/templates/builtinWorlds.ts', import.meta.url), 'utf8');
  assert.match(registry, /id: 'lantern-night'[\s\S]*buildHalloweenGathering\(\)/);
  const byId = new Map(tree.map((slot) => [slot.id, slot]));
  for (const slot of tree.filter((s) => find(s, 'codeBlock'))) assert.doesNotThrow(() => new Function('ctx', find(slot, 'codeBlock').code), slot.id);
  const code = find(byId.get(HALLOWEEN.director), 'codeBlock').code;
  for (const match of code.matchAll(/'(hg-[a-z0-9-]+)'/g)) {
    const id = match[1];
    assert.ok(byId.has(id) || ['hg-g-', 'hg-keepsake', 'hg-seed', 'hg-awakening-', 'hg-ghost-'].some((prefix) => id.startsWith(prefix)), `the director names ${id}`);
  }
  for (const house of HALLOWEEN.houses) {
    for (const part of ['door', 'door-panel', 'hand', 'hand-palm', 'hand-want', 'hand-thumb', 'glow', 'f0', 'f1', 'f2', 'f3'].map((suffix) => (suffix.startsWith('f') ? `${house.id}-hand-${suffix}` : `${house.id}-${suffix}`))) assert.ok(byId.has(part), `${part} exists`);
    assert.ok(byId.has(HALLOWEEN.seeds[house.seed].id), `${house.name} has its gift`);
  }
});

test('behind the doors: the gifts, the wished-for outline, and the ring all start switched off', () => {
  const byId = new Map(tree.map((slot) => [slot.id, slot]));
  for (const seed of Object.values(HALLOWEEN.seeds)) assert.equal(byId.get(seed.id).disabled, true);
  for (const house of HALLOWEEN.houses) assert.equal(byId.get(`${house.id}-hand-want`).disabled, true);
  for (let i = 0; i < HALLOWEEN.goal; i++) assert.equal(byId.get(`hg-awakening-${i}`).disabled, true);
  assert.equal(byId.get('hg-celebration').disabled, true);
});

test('a hand that only passes by the door, or knocks once, does not open it', async () => {
  const { world, at, wait, door } = square();
  const player = world.player('ana');
  for (let z = -1.9; z < -0.9; z += 0.03) { player.hands.right = { position: at(0, [0.1, 1.2, z]), rotation: [0, 0, 0, 1] }; world.tick(1 / 60); }
  await wait(1);
  assert.equal(door(0).rotation[1], 0, 'a single knock leaves the door shut');
  for (let z = -1.9; z < -0.9; z += 0.004) { player.hands.right = { position: at(0, [0.1, 1.2, z]), rotation: [0, 0, 0, 1] }; world.tick(1 / 60); }
  await wait(1);
  assert.equal(door(0).rotation[1], 0, 'a slow hand is not a knock');
  world.dispose();
});

test('two knocks open the door a little and a hand comes out with the house’s gift, palm up', async () => {
  const { world, knock, wait, door, palm } = square();
  await knock(0);
  await wait(3);
  assert.ok(door(0).rotation[1] > 0.3 && door(0).rotation[1] < 0.5, 'ajar, not wide open');
  const hand = world.slot('hg-h0-hand');
  assert.ok(hand.position[2] < -1.5, 'the hand is out of the doorway');
  const [gift] = gifts(world);
  assert.ok(gift, 'it holds a gift');
  assert.equal(gift.name, 'Spirit Jar');
  assert.ok(world.slots.has(`${gift.id}-light`), 'with all its parts, so it works');
  const here = world.position(gift.id), rest = palm(0);
  assert.ok(Math.hypot(here[0] - rest[0], here[2] - rest[2]) < 0.15, 'lying on the palm');
  world.dispose();
});

test('once the gift is taken the hand stays open and asks for another, then withdraws if nothing comes', async () => {
  const { world, knock, wait, door } = square();
  await knock(1);
  await wait(3);
  assert.ok(world.slot('hg-h1-hand-want').disabled, 'while it offers, it does not ask');
  world.setPosition(gifts(world)[0].id, [0, 1.2, 3]);
  await wait(1.5);
  assert.ok(!world.slot('hg-h1-hand-want').disabled, 'the outline of a gift floats over the open palm');
  assert.ok(world.slot('hg-h1-hand').position[2] < -1.5, 'and the hand stays out');
  await wait(80);
  assert.ok(world.slot('hg-h1-hand-want').disabled);
  assert.ok(Math.abs(door(1).rotation[1]) < 0.05, 'the door shut again');
  assert.ok(world.slot('hg-h1-hand').position[2] > -0.7, 'and the hand went back in');
  world.dispose();
});

test('what is put in the hand is kept for the world: the next visitor, in another session, is the one who gets it', async () => {
  const keep = storage();
  const ids = ['toy', 'toy-body'];
  const first = square({ keep, extra: [toy('toy', 'Green Ball'), ...toyParts('toy')] });
  await first.knock(2);
  await first.wait(3);
  first.world.setPosition(gifts(first.world)[0].id, [0, 1.2, 3]);
  await first.wait(1);
  first.world.setPosition('toy', first.palm(2));
  await first.wait(1);
  for (const id of ids) assert.ok(!first.world.slots.has(id), `${id} went into the house`);
  assert.equal(first.state().shared, 1);
  const stored = await keep.world.get('gifts-2');
  assert.equal(stored.items.length, 1);
  assert.equal(stored.items[0].name, 'Green Ball');
  assert.equal(stored.items[0].by, 'Ana');
  first.world.dispose();

  // Another session of the same world, another person: the house holds out Ana's ball, not its own gift.
  const second = square({ keep, players: ['bo'] });
  await second.knock(2, 'bo');
  await second.wait(3);
  const [ball] = gifts(second.world);
  assert.equal(ball.name, 'Green Ball');
  assert.ok([...second.world.slots.values()].some((slot) => slot.name === 'Toy Body' && slot.parentId === ball.id), 'with its parts');
  assert.equal((await keep.world.get('gifts-2')).items.length, 0, 'it is theirs now, no longer in the house');
  second.world.dispose();
});

test('nobody is given back what they left themselves', async () => {
  const keep = storage();
  await keep.world.set('gifts-0', { items: [{ tree: [{ p: -1, n: 'Own Toy', pos: [0, 0, 0], rot: [0, 0, 0, 1], sc: [1, 1, 1], c: [{ type: 'grabbable', scalable: false }] }], name: 'Own Toy', by: 'Ana', byId: 'ana', at: 1 }] });
  const { world, knock, wait } = square({ keep });
  await knock(0, 'ana');
  await wait(3);
  assert.equal(gifts(world)[0].name, 'Spirit Jar');
  assert.equal((await keep.world.get('gifts-0')).items.length, 1, 'and what they left is still there for the others');
  world.dispose();
});

test('what a door gave is refused by every door, its own included', async () => {
  const keep = storage();
  const { world, state, knock, wait, palm } = square({ keep });
  await knock(0);
  await wait(3);
  const lantern = gifts(world)[0].id;
  world.setPosition(lantern, [0, 1.2, 3]);
  await wait(1);
  await knock(1);
  await wait(3);
  world.setPosition(gifts(world).find((slot) => slot.name === 'Witchlight Brush').id, [0, 1.2, 3]);
  await wait(1);
  world.setPosition(lantern, palm(1));
  await wait(2);
  assert.ok(world.slots.has(lantern), 'the other door does not take the lantern');
  assert.equal(state().shared, 0);
  assert.equal((await keep.world.get('gifts-1'))?.items?.length ?? 0, 0, 'and nothing is kept');
  world.dispose();
});

test('the crank of a music box is part of the gift, never a gift of its own', async () => {
  const { world, state, knock, wait, palm } = square();
  await knock(2);
  await wait(3);
  const box = gifts(world)[0];
  assert.equal(box.name, 'Pumpkin Music Box');
  world.setPosition(box.id, [0, 1.2, 3]);
  await wait(1);
  world.setPosition(box.id, palm(2));
  await wait(3);
  assert.ok(world.slots.has(box.id) && world.slots.has(`${box.id}-crank`), 'the box and its crank are still there');
  assert.equal(state().shared, 0);
  world.dispose();
});

test('a knock needs one hand twice: a knock with each hand is not a double knock', async () => {
  const { world, strike, wait, door } = square();
  const player = world.player('ana');
  strike(0, player, 'right');
  strike(0, player, 'left');
  delete player.hands.right; delete player.hands.left;
  await wait(1);
  assert.equal(door(0).rotation[1], 0, 'one knock from each hand leaves the door shut');
  strike(0, player, 'left');
  strike(0, player, 'left');
  await wait(1);
  assert.ok(door(0).rotation[1] > 0.05, 'two from the same hand open it');
  world.dispose();
});

test('the mystery door gives a random gift out of everything visitors left at the other doors', async () => {
  const keep = storage();
  const left = (name, byId) => ({ seed: 'brush', name, by: byId, byId, at: 1 });
  await keep.world.set('gifts-0', { items: [left('Left At Door Zero', 'bo')] });
  await keep.world.set('gifts-1', { items: [left('Left At Door One', 'bo')] });
  const { world, knock, wait } = square({ keep });
  await knock(3);
  await wait(3);
  const [gift] = gifts(world);
  assert.ok(gift, 'it holds a gift');
  assert.equal(gift.name, 'Witchlight Brush', 'one of the stored gifts, rebuilt');
  const remaining = (await keep.world.get('gifts-0')).items.length + (await keep.world.get('gifts-1')).items.length;
  assert.equal(remaining, 1, 'and it was taken out of the pool it came from');
  world.dispose();
});

test('the mystery door with nothing in the pool gives one of the house gifts instead', async () => {
  const { world, knock, wait } = square();
  await knock(3);
  await wait(3);
  const [gift] = gifts(world);
  assert.ok(['Spirit Jar', 'Witchlight Brush', 'Pumpkin Music Box'].includes(gift.name));
  world.dispose();
});

test('the Great Pumpkin wakes after six gifts shared in a session, and the group gets a keepsake each', async () => {
  const extra = Array.from({ length: 6 }, (_, i) => [toy(`t${i}`, `Toy ${i}`), ...toyParts(`t${i}`)]).flat();
  const { world, state, knock, wait, palm, at } = square({ extra, players: ['ana', 'bo'] });
  const taken = new Set();
  for (let n = 0; n < 6; n++) {
    const house = n % 3, who = n % 2 ? 'bo' : 'ana';
    await knock(house, who);
    await wait(3);
    const offered = gifts(world).find((slot) => !taken.has(slot.id));
    taken.add(offered.id);
    world.setPosition(offered.id, [0, 1.2, 3 + n]);
    await wait(1);
    world.player(who).head = at(house, [0, 1.6, -2.6]);
    world.setPosition(`t${n}`, palm(house));
    await wait(1.5);
    await wait(5);
    if (n === 2) assert.ok(!world.slot('hg-pumpkin-face').disabled, 'it opens its eyes at three');
  }
  assert.equal(state().shared, 6);
  assert.equal(state().phase, 'celebration');
  assert.ok(!world.slot('hg-celebration').disabled);
  assert.ok([...world.slots.values()].filter((slot) => slot.id.startsWith('hg-keepsake') && !slot.parentId).length >= 2);
  world.dispose();
});

test('a guest’s peer does not change the world', async () => {
  const world = createTestWorld(buildHalloweenGathering(), { isHost: false });
  world.addPlayer({ id: 'guest', name: 'Bo', role: 'guest' });
  world.run(HALLOWEEN.director);
  world.tick(1);
  assert.equal(world.slot('hg-h0-door').rotation[1], 0);
  world.dispose();
});

test('a hand that stops short of the door does not knock; the knock lands when the hand stops at it', async () => {
  const { world, at, wait } = square();
  const player = world.player('ana');
  const knocks = () => world.spawned.filter((s) => s.name === 'Knock').length;
  for (let z = -1.9; z < -1.45; z += 0.03) { player.hands.right = { position: at(0, [0.1, 1.2, z]), rotation: [0, 0, 0, 1] }; world.tick(1 / 60); }
  await wait(0.5);
  assert.equal(knocks(), 0, 'a fast hand that is still 25 cm away has not touched the door');
  for (let z = -1.45; z < -1.1; z += 0.03) { player.hands.right = { position: at(0, [0.1, 1.2, z]), rotation: [0, 0, 0, 1] }; world.tick(1 / 60); }
  assert.equal(knocks(), 0, 'nothing while the hand is still moving in');
  world.tick(1 / 60);
  assert.equal(knocks(), 1, 'it knocks once, when the hand stops at the door');
  for (let k = 0; k < 30; k++) world.tick(1 / 60);
  assert.equal(knocks(), 1, 'and only once while it rests there');
  world.dispose();
});

test('the music box is not worn: its crank knob is what is grabbed, and winding it round plays the tune', async () => {
  const seed = HALLOWEEN.seeds.music.id;
  const root = tree.find((slot) => slot.id === seed);
  assert.ok(!find(root, 'equippable'), 'the box itself cannot be equipped');
  const knobSlot = tree.find((slot) => slot.id === `${seed}-crank`);
  assert.ok(find(knobSlot, 'grabbable'), 'the crank knob can be grabbed');

  const world = createTestWorld(tree);
  world.run(seed);
  const notes = () => world.spawned.filter((s) => s.name === 'Pumpkin Note').length;
  const box = world.position(seed);
  const axle = [box[0] + CRANK.axle[0], box[1] + CRANK.axle[1], box[2] + CRANK.axle[2]];
  world.tick(0.1);
  assert.equal(notes(), 0, 'it is silent while nobody holds the crank');

  world.grabbers.set(`${seed}-crank`, ['ana:right']);
  const turns = 2, steps = 120;
  for (let i = 0; i <= steps * turns; i++) {
    const a = (i / steps) * Math.PI * 2;
    world.setPosition(`${seed}-crank`, [axle[0] + 0.025, axle[1] + Math.cos(a) * 0.08, axle[2] + Math.sin(a) * 0.08]);
    world.tick(1 / 60);
  }
  assert.ok(notes() >= 6 && notes() <= 10, `two turns are four beats of the tune: its first eight notes, got ${notes()}`);

  const before = notes();
  // Any circle of the hand works, wherever its centre is: here one off to the side of the axle.
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    world.setPosition(`${seed}-crank`, [axle[0] + 0.03, axle[1] + 0.15 + Math.cos(a) * 0.06, axle[2] - 0.1 + Math.sin(a) * 0.06]);
    world.tick(1 / 60);
  }
  assert.ok(notes() - before >= 1, `an off-centre circle also winds it, got ${notes() - before} notes`);

  world.grabbers.delete(`${seed}-crank`);
  world.tick(0.1);
  const rest = world.slot(`${seed}-crank`).position;
  assert.deepEqual(rest.map((n) => Math.round(n * 1000) / 1000), [...CRANK.rest], 'the knob goes back to its place when let go');
  world.dispose();
});

test('the music box tune is long and in tune', () => {
  assert.ok(MUSIC_BOX_TUNE.length > 150, `${MUSIC_BOX_TUNE.length} notes`);
  const beats = MUSIC_BOX_TUNE.reduce((sum, [, length]) => sum + length, 0);
  assert.ok(beats > 100, `${beats} beats: over fifty turns of the crank`);
  assert.equal(MUSIC_BOX_TUNE[0][0], 880, 'it opens on A5');
  for (const [frequency] of MUSIC_BOX_TUNE) assert.ok(frequency === 0 || (frequency > 200 && frequency < 1300));
});

test('shaking the spirit jar lets little ghosts out; holding it still does not', async () => {
  const seed = HALLOWEEN.seeds.jar.id;
  const world = createTestWorld(tree);
  world.run(seed);
  const ghosts = () => world.spawned.filter((s) => s.name === 'Little Ghost').length;
  const start = world.position(seed);
  world.grabbers.set(seed, ['ana:right']);
  for (let k = 0; k < 120; k++) { world.setPosition(seed, [start[0], start[1] + 0.001 * (k % 2), start[2]]); world.tick(1 / 60); }
  assert.equal(ghosts(), 0, 'carried or held still, it stays quiet');
  for (let k = 0; k < 120; k++) { world.setPosition(seed, [start[0] + Math.sin(k / 60 * Math.PI * 2 * 4) * 0.08, start[1], start[2]]); world.tick(1 / 60); }
  assert.ok(ghosts() >= 2 && ghosts() <= 5, `two seconds of shaking release a few ghosts, got ${ghosts()}`);
  world.dispose();
});
