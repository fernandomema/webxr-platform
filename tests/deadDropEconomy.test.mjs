import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRID, ITEMS, MARKUP, TRADER_STOCK, TUNING, UPGRADES, WEAPONS } from '../src/lib/xr/templates/deadDropData.ts';
import { ID } from '../src/lib/xr/templates/deadDropKit.ts';
import { DT, runDeadDrop } from './helpers/deadDropGame.mjs';

const buy = (id) => Math.ceil(ITEMS[id].value * MARKUP);
const stashOf = (game, id = 'host') => game.game.profileOf(id).stash;
const count = (game, item, id = 'host') => stashOf(game, id).find((e) => e.id === item)?.n ?? 0;
const find = (slot, type) => slot.components.find((c) => c.type === type);

/** A world with `names` standing in the bunker, the first with a gun in hand. */
function bunker(names = ['host'], options = {}) {
  const game = runDeadDrop(options);
  for (const name of names) game.addPlayer(name, name, [0, 1.6, 0]);
  return game;
}
const trader = (game, id, who = 'host') => game.press(id, who);
const go = (game, row, who = 'host') => game.press(`dd-ts-go-${row}`, who);
const stashRow = (game, i) => `${game.ui(`dd-ss-label-${i}`)}: ${game.ui(`dd-ss-row-${i}`)}`;
const loadout = (game, row, dir, who = 'host') => game.press(`dd-ss-${dir}-${row}`, who);

test('the screens start by asking the player to step up, and fill in for whoever presses a button', () => {
  const game = bunker();
  game.handlers.onSpawn();
  assert.match(game.ui('dd-ts-user'), /Step up/);
  assert.match(game.ui('dd-ss-user'), /Step up/);
  assert.equal(game.ui('dd-ts-row-0'), '9mm Rounds x30', 'what is on sale shows before anyone has stepped up');
  trader(game, 'dd-ts-buy');
  assert.equal(game.ui('dd-ts-user'), 'host');
  assert.equal(game.ui('dd-ts-credits'), 'Credits $3000');
  const lines = Array.from({ length: 6 }, (_, i) => game.ui(`dd-ts-row-${i}`));
  assert.equal(lines[0], '9mm Rounds x30', 'the first thing on sale is rounds, in packs of thirty');
  assert.equal(game.ui('dd-ts-price-0'), '$90');
  assert.equal(lines[1], 'Medkit');
  assert.equal(game.ui('dd-ts-price-1'), '$450');
  assert.ok(lines.every((l) => l.length > 0));
  assert.equal(game.ui('dd-ts-go-0'), 'BUY');
  assert.match(game.ui('dd-ts-page'), /Page 1\/2/);
});

test('buying costs half as much again as the item is worth, takes the credits, and puts it in the stash', async () => {
  const game = bunker();
  trader(game, 'dd-ts-buy');
  const rounds = count(game, 'ammo9');
  go(game, 0);
  assert.equal(game.game.profileOf('host').credits, 3000 - buy('ammo9') * 30);
  assert.equal(count(game, 'ammo9'), rounds + 30);
  assert.match(game.ui('dd-ts-note'), /Bought 9mm Rounds x30 for \$90/);
  assert.equal(game.ui('dd-ts-credits'), 'Credits $2910');
  go(game, 2);                // a second pistol
  assert.equal(count(game, 'pistol'), 2);
  assert.equal(buy('pistol'), ITEMS.pistol.value * MARKUP);
});

test('with too little money nothing is bought, and the screen says so', async () => {
  const game = bunker();
  game.game.profileOf('host').credits = 100;
  trader(game, 'dd-ts-buy');
  go(game, 3);                // the submachine gun
  assert.equal(count(game, 'smg'), 1, 'still just the one they began with');
  assert.equal(game.game.profileOf('host').credits, 100);
  assert.match(game.ui('dd-ts-note'), /Not enough credits/);
});

test('the trader pays an item’s full value for what the stash holds, most valuable first; and buys all the loot at once', async () => {
  const game = bunker();
  const profile = game.game.profileOf('host');
  profile.stash.push({ id: 'gold', n: 2 }, { id: 'scrap', n: 3 }, { id: 'radio', n: 1 });
  trader(game, 'dd-ts-sell');
  assert.equal(game.ui('dd-ts-row-0'), 'Gold Bar x2');
  assert.equal(game.ui('dd-ts-price-0'), '$2400');
  assert.equal(game.ui('dd-ts-go-0'), 'SELL');
  go(game, 0);
  assert.equal(profile.credits, 3000 + 2400);
  assert.equal(count(game, 'gold'), 0);
  trader(game, 'dd-ts-sellall');
  assert.equal(profile.credits, 3000 + 2400 + 320 + 120);
  assert.equal(count(game, 'scrap') + count(game, 'radio'), 0);
  assert.ok(count(game, 'smg') === 1 && count(game, 'pistol') === 1, 'weapons are not loot');
  assert.match(game.ui('dd-ts-note'), /Sold 4 loot items for \$440/);
  trader(game, 'dd-ts-sellall');
  assert.match(game.ui('dd-ts-note'), /no loot to sell/);
});

test('the refuge: each improvement costs more than the one before, shows what level it is, and stops at the top', async () => {
  const game = bunker();
  const profile = game.game.profileOf('host');
  profile.credits = 100000;
  trader(game, 'dd-ts-up');
  assert.match(game.ui('dd-ts-row-0'), /^Bigger pack  0\/3/);
  assert.equal(game.ui('dd-ts-go-0'), '$1500');
  assert.match(game.ui('dd-ts-row-1'), /^Secure case  1\/3/);
  assert.match(game.ui('dd-ts-row-2'), /^Infirmary  0\/3/);
  go(game, 0); go(game, 0); go(game, 0);
  assert.equal(profile.upgrades.pack, 3);
  assert.equal(profile.credits, 100000 - 1500 - 3500 - 7000);
  assert.equal(game.ui('dd-ts-go-0'), 'MAX');
  go(game, 0);
  assert.equal(profile.upgrades.pack, 3, 'there is no fourth');
  assert.match(game.ui('dd-ts-note'), /as good as it gets/);
  go(game, 1);
  assert.equal(profile.upgrades.case, 2);
  go(game, 2);
  assert.equal(profile.upgrades.infirmary, 1);
  assert.equal(UPGRADES.pack.costs.length, 3);
});

test('the improvements show in a raid: a bigger pack, more health, and the bars measure against them', async () => {
  const game = bunker();
  const profile = game.game.profileOf('host');
  profile.upgrades = { pack: 2, case: 1, infirmary: 2 };
  game.equip('host');
  await game.startRaid(['host'], 4242);
  const p = game.player('host');
  assert.equal(p.packCap, TUNING.packSlots + 4);
  assert.equal(p.maxHp, TUNING.maxHp + 20);
  assert.equal(p.hp, 120);
  for (const e of game.enemies()) e.dead = true;
  game.game.hurt(p, 60);
  await game.tick(0.2);
  assert.ok(Math.abs(game.localPoses.get(`dd-gun-${p.gun}-hp`).scale[0] - 0.1 * (60 / 120)) < 1e-9);
  let added = 0;
  while (game.game.packAdd(p.pack, 'radio', 1, p.packCap)) added++;
  assert.ok(game.game.slotsUsed(p.pack) <= p.packCap && game.game.slotsUsed(p.pack) > TUNING.packSlots);
  p.hp = 50;
  game.command('host', 'medkit');
  await game.tick(TUNING.medkitSeconds + 0.5);
  assert.equal(p.hp, 95);
  p.hp = 118;
  game.command('host', 'medkit');
  await game.tick(TUNING.medkitSeconds + 0.5);
  assert.equal(p.hp, 120, 'a medkit cannot heal past the most this player has');
  void added;
});

test('the loadout is chosen with arrows, one row at a time, and the screen shows the kit that comes out of it', async () => {
  const game = bunker();
  loadout(game, 0, 'next');
  assert.equal(game.ui('dd-ss-user'), 'host’s stash');
  assert.equal(stashRow(game, 0), 'Primary: none', 'the next after the submachine gun wraps round to nothing');
  assert.equal(stashRow(game, 1), 'Sidearm: Pistol');
  assert.match(game.ui('dd-ss-kit'), /^Raid kit: Pistol, 90 rounds, 2 medkits\.$/);
  loadout(game, 0, 'next');
  assert.equal(stashRow(game, 0), 'Primary: Pistol');
  loadout(game, 0, 'next');
  assert.equal(stashRow(game, 0), 'Primary: Submachine Gun');
  loadout(game, 3, 'next'); loadout(game, 3, 'next');           // ammo: 120, then 180
  assert.equal(stashRow(game, 3), 'Ammo: 180 rounds');
  loadout(game, 4, 'prev');           // medkits
  assert.equal(stashRow(game, 4), 'Medkits: 1');
  assert.equal(stashRow(game, 2), 'Armour: best I own', 'the usual choice');
  loadout(game, 2, 'next');           // armour: with none in the stash there is only "none" and "best I own"
  assert.equal(stashRow(game, 2), 'Armour: none');
  loadout(game, 2, 'next');
  assert.equal(stashRow(game, 2), 'Armour: best I own');
  loadout(game, 5, 'next');
  assert.equal(stashRow(game, 5), 'Suppressor: take it');
  assert.match(game.ui('dd-ss-kit'), /Submachine Gun, Pistol, 150 rounds, 1 medkit\./, 'it cannot promise more rounds than the stash holds, and none of a suppressor it does not have');
});

test('what is chosen is what goes on the raid: the weapons, the ammo, the medkits and the armour, and nothing else leaves the stash', async () => {
  const game = bunker();
  const profile = game.game.profileOf('host');
  profile.stash.push({ id: 'armor1', n: 1 }, { id: 'armor2', n: 1 });
  Object.assign(profile.loadout, { primary: 'pistol', secondary: null, armor: 'armor1', ammo: 120, meds: 1 });
  game.equip('host');
  await game.startRaid(['host'], 4242);
  const p = game.player('host');
  assert.deepEqual(p.weapons, ['pistol']);
  assert.equal(p.armor, 'armor1');
  assert.equal(p.pack.find((e) => e.id === 'ammo9').n, 120);
  assert.equal(p.pack.find((e) => e.id === 'medkit').n, 1);
  assert.equal(count(game, 'smg'), 1, 'the submachine gun stayed in the stash');
  assert.equal(count(game, 'armor2'), 1);
  assert.equal(count(game, 'ammo9'), 30);
  assert.equal(count(game, 'medkit'), 2);
});

test('the case keeps what is put in it, whatever happens: out through an exit or dead', async () => {
  for (const outcome of ['dies', 'gets out']) {
    const game = bunker();
    const profile = game.game.profileOf('host');
    profile.upgrades.case = 2;
    profile.stash.push({ id: 'gold', n: 2 }, { id: 'intel', n: 1 });
    Object.assign(profile.loadout, { case: ['gold', 'intel', null] });
    game.equip('host');
    await game.startRaid(['host'], 4242);
    const p = game.player('host');
    assert.deepEqual(p.case, [{ id: 'gold', n: 1 }, { id: 'intel', n: 1 }], 'one stack of each: a gold bar does not stack');
    assert.equal(count(game, 'gold'), 1, 'one of the two bars went in the case; the other stayed behind');
    assert.equal(count(game, 'intel'), 0);
    for (const e of game.enemies()) { e.dead = true; }
    if (outcome === 'dies') game.game.hurt(p, 1000);
    else { const x = game.game.R.exits[0]; game.move('host', [x.pos[0], 1.6, x.pos[2]]); await game.tick(TUNING.extractSeconds + 1); }
    assert.equal(count(game, 'gold'), 2, `${outcome}: both bars are home`);
    assert.equal(count(game, 'intel'), 1);
    assert.equal(count(game, 'smg'), outcome === 'dies' ? 0 : 1, outcome === 'dies' ? 'and the rest of the kit is lost' : 'and the kit comes back too');
    assert.deepEqual(p.case, []);
  }
});

test('a case slot that has not been bought is locked, and arrows on it do nothing; a bought one offers what the stash holds', async () => {
  const game = bunker();
  game.game.profileOf('host').stash.find((e) => e.id === 'pistol').n = 2;       // one for the sidearm, one to keep safe
  loadout(game, 6, 'next');
  assert.equal(stashRow(game, 6), 'Case 1: Pistol', 'the first slot is there from the start');
  assert.match(stashRow(game, 7), /locked/);
  loadout(game, 7, 'next');
  assert.equal(game.game.profileOf('host').loadout.case[1], null);
  game.game.profileOf('host').upgrades.case = 2;
  loadout(game, 7, 'next');
  assert.equal(stashRow(game, 7), 'Case 2: Pistol');
  assert.match(game.ui('dd-ss-kit'), /Pistol \(case\)/);
  // With only the one pistol, it is the sidearm or it is in the case, never both.
  game.game.profileOf('host').stash.find((e) => e.id === 'pistol').n = 1;
  loadout(game, 6, 'prev'); loadout(game, 6, 'next');
  assert.doesNotMatch(game.ui('dd-ss-kit'), /\(case\)/);
});

test('a suppressor makes a shot carry a quarter as far and takes the flash and the bang off it; it is lost with the kit, or brought home', async () => {
  const shoot = async (suppressed) => {
    const game = bunker();
    const profile = game.game.profileOf('host');
    profile.stash.push({ id: 'suppressor', n: 1 });
    profile.loadout.suppressor = suppressed;
    game.equip('host');
    await game.startRaid(['host'], 777);
    const p = game.player('host');
    assert.equal(p.suppressed, suppressed);
    const e = game.live('soldier')[0];
    for (const other of game.enemies()) if (other !== e) other.dead = true;
    for (const s of game.slots.values()) if (/^dd-(e|p|r-wall)/.test(s.id)) s.disabled = true;
    e.pos = [GRID.origin[0], 0, GRID.origin[2] + 12]; e.yaw = e.home = 0; e.route = [];
    game.move('host', [GRID.origin[0], 1.6, GRID.origin[2]]);
    game.look('host', [GRID.origin[0], 1.6, GRID.origin[2] - 10]);
    await game.tick(TUNING.grace + 0.5);
    const sounds = game.sounds().length;
    p.nextShot = 0;
    await game.shoot('host', { hold: DT });
    return { state: e.state, loud: game.sounds().length - sounds, count: count(game, 'suppressor'), game, p };
  };
  const bare = await shoot(false), quiet = await shoot(true);
  assert.equal(bare.state, 'investigate', 'twelve metres is within the submachine gun’s range');
  assert.notEqual(quiet.state, 'investigate', 'but not within a quarter of it');
  assert.ok(quiet.loud < bare.loud, 'fewer sounds');
  assert.equal(quiet.count, 0, 'it is on the gun, not in the stash');
  quiet.game.game.hurt(quiet.p, 1000);
  assert.equal(count(quiet.game, 'suppressor'), 0, 'and it is lost with the kit');
  assert.equal(bare.count, 1, 'not taken when not wanted');
});

test('two players share the screens one after the other, and each keeps their own stash', async () => {
  const game = bunker(['host', 'ana']);
  trader(game, 'dd-ts-buy', 'host');
  go(game, 0, 'host');
  trader(game, 'dd-ts-buy', 'ana');
  assert.equal(game.ui('dd-ts-user'), 'ana');
  assert.equal(game.ui('dd-ts-credits'), 'Credits $3000', 'ana’s own money');
  go(game, 1, 'ana');
  assert.equal(count(game, 'medkit', 'ana'), 4);
  assert.equal(count(game, 'ammo9', 'ana'), 150);
  assert.equal(count(game, 'ammo9', 'host'), 180);
  assert.equal(count(game, 'medkit', 'host'), 3);
  trader(game, 'dd-ts-sell', 'host');
  assert.equal(game.ui('dd-ts-user'), 'host');
  loadout(game, 0, 'next', 'ana');
  assert.equal(game.ui('dd-ss-user'), 'ana’s stash');
  assert.equal(game.game.profileOf('host').loadout.primary, 'smg', 'ana’s arrows did not change the host’s loadout');
});

test('every purchase, sale and choice is saved, and a profile saved before the improvements existed is read with the defaults', async () => {
  const old = { credits: 500, stash: [{ id: 'pistol', n: 1 }], extracted: 3, raids: 1, deaths: 0, best: 3 };
  const game = bunker([], { storage: true, store: { host: { profile: old } } });
  game.addPlayer('host', 'host', [0, 1.6, 0]);
  await game.tick(0.1);
  const profile = game.game.profileOf('host');
  assert.equal(profile.credits, 500);
  assert.deepEqual(profile.upgrades, { pack: 0, case: 1, infirmary: 0 });
  assert.equal(profile.loadout.ammo, 90);
  assert.deepEqual(profile.loadout.case, [null, null, null]);
  const before = game.saved.length;
  trader(game, 'dd-ts-buy');
  go(game, 0);
  loadout(game, 3, 'next');
  assert.ok(game.saved.length >= before + 2);
  assert.equal(game.store.host.profile.credits, 500 - buy('ammo9') * 30 >= 0 ? 500 - buy('ammo9') * 30 : 500);
  assert.equal(game.store.host.profile.loadout.ammo, 120);
  assert.deepEqual(game.logs, []);
});

test('the screens only ever touch parts that exist', () => {
  const game = bunker();
  game.handlers.onSpawn();
  for (const mode of ['dd-ts-buy', 'dd-ts-sell', 'dd-ts-up']) {
    trader(game, mode);
    for (let i = 0; i < 6; i++) go(game, i);
    trader(game, 'dd-ts-next'); trader(game, 'dd-ts-prev'); trader(game, 'dd-ts-sellall');
  }
  for (let row = 0; row < 9; row++) { loadout(game, row, 'next'); loadout(game, row, 'prev'); }
  assert.deepEqual(game.unknown, []);
  assert.deepEqual(game.logs, []);
  assert.ok(TRADER_STOCK.length === 7 && WEAPONS.smg.mag === 30);
  void GRID;
});

test('a screen shows whoever is nearest to it, before anyone touches it', async () => {
  const game = bunker(['host', 'ana']);
  game.handlers.onSpawn();
  assert.match(game.ui('dd-ts-user'), /Step up/);
  game.people.get('host').head = [6.2, 1.6, 8];
  game.people.get('ana').head = [-7.8, 1.6, 8];
  await game.tick(0.6);
  assert.equal(game.ui('dd-ts-user'), 'host', 'the trader greets the one at his counter');
  assert.equal(game.ui('dd-ts-credits'), 'Credits $3000');
  assert.equal(game.ui('dd-ss-user'), 'ana’s stash', 'and the stash is the one by the lockers');
  assert.match(game.ui('dd-ss-kit'), /^Raid kit:/);
  assert.equal(stashRow(game, 0).startsWith('Primary'), true);
});

test('the gear wall shows what the stash of whoever stands before it holds: guns on pegs, cans of ammunition, medkits, vests and loot', async () => {
  const { GEAR, gearId } = await import('../src/lib/xr/templates/deadDropGear.ts');
  const game = bunker(['host']);
  game.handlers.onSpawn();
  game.people.get('host').head = [5, 1.6, -1];
  await game.tick(0.6);
  const shown = (kind, i) => game.poses.get(gearId(kind, i)) && game.poses.get(gearId(kind, i))[1] > -100;
  assert.equal(shown('pistol', 0), true, 'the pistol the stash starts with');
  assert.deepEqual(game.poses.get(gearId('pistol', 0)), [...GEAR.pistol[0]]);
  assert.equal(shown('pistol', 1), false, 'only one');
  assert.equal(shown('smg', 0), true);
  assert.equal(shown('vest', 0), false, 'no armour yet');
  assert.equal([0, 1, 2, 3].filter((i) => shown('ammo', i)).length, 4, '150 rounds are four cans');
  assert.equal([0, 1, 2].filter((i) => shown('med', i)).length, 3);
  assert.match(find(game.slots.get('dd-gw-sign'), 'textDisplay').lines[0], /host’s stash/, 'it says whose it is');
  const profile = game.game.profileOf('host');
  profile.stash.push({ id: 'armor1', n: 1 }, { id: 'gold', n: 1 }, { id: 'radio', n: 1 });
  trader(game, 'dd-ts-buy');          // any press re-renders the screens, and the wall with them
  assert.equal(shown('vest', 0), true, 'a light vest on its mannequin');
  assert.equal(shown('vest', 1), false);
  assert.equal([0, 1, 2, 3, 4, 5].filter((i) => shown('loot', i)).length, 2, 'the gold bar and the radio');
});
