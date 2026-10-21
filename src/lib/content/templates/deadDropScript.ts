import { makeFrame } from './arcadeKit.ts';
import { preludeSource } from './arcadeSession.ts';
import { ARMOR, DROPS, ENEMIES, GRID, HUB, ITEMS, LOOT_TABLES, MEDKIT_HEAL, POOLS, TUNING, WEAPONS } from './deadDropData.ts';
import { GEN_SOURCE } from './deadDropGen.ts';
import { GATE, ID, nonSolidIds } from './deadDropKit.ts';
import { BAR, DOG_SHELL, GUN_MODELS, HIT_SHELL, MUZZLE_AT } from './deadDropActors.ts';
import { ECONOMY_SOURCE } from './deadDropEconomy.ts';
import { GEAR_SOURCE } from './deadDropGear.ts';
import { WALL_SPOTS } from './deadDropRaid.ts';

/** The game runs in world coordinates: the frame of its script is the identity. */
const FRAME = makeFrame(0, 0, 0);

/** The tables of the game and the names of the slots the script reaches, as code. */
function dataSource(): string {
	return `
const ITEMS = ${JSON.stringify(ITEMS)};
const WEAPONS = ${JSON.stringify(WEAPONS)};
const ARMOR = ${JSON.stringify(ARMOR)};
const LOOT_TABLES = ${JSON.stringify(LOOT_TABLES)};
const ENEMIES = ${JSON.stringify(ENEMIES)};
const TUNING = ${JSON.stringify(TUNING)};
const GRID = ${JSON.stringify(GRID)};
const HUB = ${JSON.stringify(HUB)};
const POOLS = ${JSON.stringify(POOLS)};
const BAR = ${JSON.stringify(BAR)};
const GUN_MODELS = ${JSON.stringify(GUN_MODELS)};
const HIT_SHELL = ${JSON.stringify(HIT_SHELL)};
const DOG_SHELL = ${JSON.stringify(DOG_SHELL)};
const DROPS = ${JSON.stringify(DROPS)};
const MUZZLE_AT = ${JSON.stringify(MUZZLE_AT)};
const WALL_SPOTS = ${JSON.stringify(WALL_SPOTS)};
const GATE = ${JSON.stringify(GATE)};
const HIDDEN = [0.001, 0.001, 0.001];
const MEDKIT_HEAL = ${MEDKIT_HEAL};
const NONSOLID = ${JSON.stringify(nonSolidIds())};
const IDS = ${JSON.stringify({ message: ID.message, commands: ID.commands, flush: ID.flush, join: ID.join, leave: ID.leave, start: ID.start, entryPad: ID.entryPad })};
const PARKED = [0, -200, 0];
const generateLayout = ${GEN_SOURCE};
const CELL = GRID.cell, OX = GRID.origin[0], OZ = GRID.origin[2];
const CORNER = 3.4, PROP_TOP = 1.1;
const cellCenter = (cx, cz) => [OX + (cx - 1) * CELL, 0, OZ + (cz - 1) * CELL];
const cornerOffset = (spot) => [spot % 2 === 0 ? -CORNER : CORNER, spot < 2 ? -CORNER : CORNER];
const idEdge = (kind, x, z) => 'dd-e-' + kind + x + z;
const idProp = (cx, cz, variant, corner) => 'dd-p-' + cx + cz + '-' + variant + corner;
const idExit = (i) => 'dd-x-' + i;
const idBeacon = (i) => 'dd-x-' + i + '-beacon';
const idSoldier = (i) => 'dd-s-' + i;
const idTurret = (i) => 'dd-t-' + i;
const idDog = (i) => 'dd-d-' + i;
const idLoot = (i) => 'dd-l-' + i;
const idBag = (i) => 'dd-b-' + i;
const idTracer = (i) => 'dd-tr-' + i;
const idFx = (i) => 'dd-fx-' + i;
const idArrow = (i) => 'dd-x-' + i + '-arrow';
const FURNITURE_OF = { storage: ['dd-f-shelf-', POOLS.shelves, 2], barracks: ['dd-f-bunk-', POOLS.bunks, 2], control: ['dd-f-desk-', POOLS.desks, 2], hall: ['dd-f-pillar-', POOLS.pillars, 1], vault: ['dd-f-safe-', POOLS.safes, 1] };
const PILLAR_SPOTS = [{ x: -2.2, z: -2.2, yaw: 0 }, { x: 2.2, z: 2.2, yaw: 0 }, { x: 2.2, z: -2.2, yaw: 0 }, { x: -2.2, z: 2.2, yaw: 0 }];
const gunId = (i, part) => 'dd-gun-' + i + (part ? '-' + part : '');
`;
}

/** Small vector maths and the ray tests the combat needs. */
const MATH_SOURCE = `
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
soundVar.v = 0.06;
const lerp = (a, b, t) => a + (b - a) * t;
const lerpRange = (range) => range[0] + rand() * (range[1] - range[0]);
/** Where along the unit ray (o, d) it first comes within r of the sphere at c, or -1. */
function raySphere(o, d, c, r, maxT) {
	const oc = sub3(c, o), t = dot3(oc, d);
	if (t < 0 || t > maxT) return -1;
	const miss2 = dot3(oc, oc) - t * t;
	if (miss2 > r * r) return -1;
	return Math.max(0, t - Math.sqrt(r * r - miss2));
}
/** Where along the unit ray (o, d) it passes closest to the segment a-b, if that is within r; or -1. */
function raySegment(o, d, a, b, r, maxT) {
	const v = sub3(b, a), w = sub3(o, a);
	const B = dot3(d, v), C = dot3(v, v), D = dot3(d, w), E = dot3(v, w);
	const den = C - B * B;
	let t = den > 1e-9 ? clamp((E - B * D) / den, 0, 1) : 0;
	let s = B * t - D;
	if (s < 0) { s = 0; t = C > 1e-9 ? clamp(E / C, 0, 1) : 0; }
	if (s > maxT) return -1;
	const p = add3(o, mul3(d, s)), q = add3(a, mul3(v, t));
	return dist3(p, q) <= r ? s : -1;
}
/** Whether nothing solid stands between two points. */
function visible(from, to) {
	const way = sub3(to, from), l = len(way);
	if (l < 0.05) return true;
	return !ctx.world.raycast(from, mul3(way, 1 / l), l - 0.05, { ignore: NONSOLID });
}
`;

/** Profiles, the stash, and the raid pack. */
const PROFILE_SOURCE = `
const profiles = new Map();
const newProfile = () => normalizeProfile({ credits: 3000, stash: [{ id: 'pistol', n: 1 }, { id: 'smg', n: 1 }, { id: 'ammo9', n: 150 }, { id: 'medkit', n: 3 }], extracted: 0, raids: 0, deaths: 0, best: 0 });
function profileOf(id) {
	let profile = profiles.get(id);
	if (!profile) { profile = newProfile(); profiles.set(id, profile); }
	return profile;
}
const countIn = (list, id) => { const entry = list.find((e) => e.id === id); return entry ? entry.n : 0; };
function addTo(list, id, n) {
	const entry = list.find((e) => e.id === id);
	if (entry) entry.n += n; else list.push({ id, n });
}
function takeFrom(list, id, n) {
	const entry = list.find((e) => e.id === id);
	if (!entry) return 0;
	const taken = Math.min(n, entry.n);
	entry.n -= taken;
	if (entry.n <= 0) list.splice(list.indexOf(entry), 1);
	return taken;
}
const setTextOf = (id, value) => ctx.world.setComponentField(id, 'uiElement', 'text', value, false) || markFlush();
const slotsOf = (id, n) => (n > 0 ? Math.ceil(n / ITEMS[id].stack) * ITEMS[id].size : 0);
const slotsUsed = (pack) => pack.reduce((sum, e) => sum + slotsOf(e.id, e.n), 0);
/** Puts up to n of an item in the pack as far as the slots go; returns how many went in. */
function packAdd(pack, id, n, cap) {
	const item = ITEMS[id], have = countIn(pack, id);
	const free = (cap === undefined ? TUNING.packSlots : cap) - slotsUsed(pack) + slotsOf(id, have);
	const room = Math.floor(free / item.size) * item.stack - have;
	const added = Math.max(0, Math.min(n, room));
	if (added > 0) addTo(pack, id, added);
	return added;
}
const valueOf = (list) => list.reduce((sum, e) => sum + ITEMS[e.id].value * e.n, 0);
async function loadProfile(player) {
	try {
		if (!ctx.storage || !ctx.storage.available) return;
		const saved = await ctx.storage.player(player.id).get('profile', null);
		if (saved && Array.isArray(saved.stash)) profiles.set(player.id, normalizeProfile(Object.assign(newProfile(), saved)));
	} catch (error) { /* a profile that cannot be read is a fresh one */ }
}
function saveProfile(id) {
	try {
		if (ctx.storage && ctx.storage.available) Promise.resolve(ctx.storage.player(id).set('profile', profiles.get(id))).catch(() => {});
	} catch (error) { /* nothing to do: the profile lives on for this session */ }
}
function summary(profile) {
	const names = profile.stash.map((e) => (e.n > 1 ? e.n + ' ' : '') + ITEMS[e.id].name).join(', ');
	return 'Credits ' + profile.credits + '. Stash: ' + (names || 'empty') + '.';
}
`;

/** Switching things on and off, the pools, and building a raid from a layout. */
const WORLD_SOURCE = `
let clock = 0, flushN = 0, flushDirty = false, lastFlush = -9;
const rand = makeRand((Date.now() & 0xffffff) + 1);
const markFlush = () => { flushDirty = true; };
function maybeFlush() {
	if (!flushDirty || clock - lastFlush < 0.12) return;
	flushDirty = false; lastFlush = clock;
	ctx.world.setComponentField(IDS.flush, 'scriptState', 'data', { n: ++flushN }, true);
}
const enable = (id, on) => { ctx.world.setSlotEnabled(id, on, false); markFlush(); };
const field = (id, type, name, value) => { ctx.world.setComponentField(id, type, name, value, false); markFlush(); };
const park = (id) => ctx.world.setWorldPose(id, { position: PARKED }, false);
const say = (text) => ctx.world.setComponentField(IDS.message, 'uiElement', 'text', text, true);

const R = { boxes: [], on: false, t: 0, layout: null, enemies: [], loot: [], bags: [], exits: [], frame: 0, alarm: false, raids: 0, over: 0, report: [], heads: [], creakT: 8 };
let nextSeed = null;

function parkAll() {
	for (let i = 0; i < POOLS.soldiers; i++) park(idSoldier(i));
	for (let i = 0; i < POOLS.turrets; i++) park(idTurret(i));
	for (let i = 0; i < POOLS.dogs; i++) park(idDog(i));
	for (let i = 0; i < POOLS.loot; i++) park(idLoot(i));
	for (let i = 0; i < POOLS.bags; i++) park(idBag(i));
	for (let i = 0; i < POOLS.tracers; i++) park(idTracer(i));
	for (let i = 0; i < POOLS.guns; i++) park(idFx(i));
	for (let i = 0; i < 3; i++) { park(idExit(i)); park(idBeacon(i)); park(idArrow(i)); }
	park(IDS.entryPad);
	for (const kind of Object.keys(FURNITURE_OF)) for (let i = 0; i < FURNITURE_OF[kind][1]; i++) park(FURNITURE_OF[kind][0] + i);
}

/** The walls, doorways and props of a layout. */
function applyStructure(L) {
	for (let z = 0; z < 3; z++) {
		for (let x = 0; x < 2; x++) {
			const open = L.east[z][x], id = idEdge('e', x, z);
			enable(id, !open); enable(id + '-l', open); enable(id + '-r', open); enable(id + '-top', open); enable(id + '-mark', open);
		}
	}
	for (let z = 0; z < 2; z++) {
		for (let x = 0; x < 3; x++) {
			const open = L.north[z][x], id = idEdge('n', x, z);
			enable(id, !open); enable(id + '-l', open); enable(id + '-r', open); enable(id + '-top', open); enable(id + '-mark', open);
		}
	}
	for (let cz = 0; cz < 3; cz++) {
		for (let cx = 0; cx < 3; cx++) {
			const variant = L.variants[cx + cz * 3];
			for (let v = 0; v < 2; v++) for (let c = 0; c < 4; c++) enable(idProp(cx, cz, v, c), v === variant);
		}
	}
}

/** Everything a soldier cannot walk through, as boxes [x, z, half width, half depth]: the walls between rooms, the cover, the furniture. */
function buildObstacles(L) {
	const boxes = [], side = (CELL - GRID.doorWidth) / 2, off = GRID.doorWidth / 2 + side / 2;
	for (let z = 0; z < 3; z++) {
		for (let x = 0; x < 2; x++) {
			const X = OX + (x - 1) * CELL + CELL / 2, Z = OZ + (z - 1) * CELL;
			if (!L.east[z][x]) boxes.push([X, Z, 0.15, CELL / 2]);
			else { boxes.push([X, Z - off, 0.15, side / 2]); boxes.push([X, Z + off, 0.15, side / 2]); }
		}
	}
	for (let z = 0; z < 2; z++) {
		for (let x = 0; x < 3; x++) {
			const X = OX + (x - 1) * CELL, Z = OZ + (z - 1) * CELL + CELL / 2;
			if (!L.north[z][x]) boxes.push([X, Z, CELL / 2, 0.15]);
			else { boxes.push([X - off, Z, side / 2, 0.15]); boxes.push([X + off, Z, side / 2, 0.15]); }
		}
	}
	for (let cz = 0; cz < 3; cz++) {
		for (let cx = 0; cx < 3; cx++) {
			const centre = cellCenter(cx, cz), variant = L.variants[cx + cz * 3];
			for (let c = 0; c < 4; c++) {
				const o = cornerOffset(c);
				if (variant === 0) boxes.push([centre[0] + o[0], centre[2] + o[1], 0.7, 0.7]);
				else if (c % 2) boxes.push([centre[0] + o[0], centre[2] + o[1], 1.2, 0.25]);
				else boxes.push([centre[0] + o[0], centre[2] + o[1], 0.45, 0.45]);
			}
		}
	}
	return boxes;
}
/** Whether a soldier (a circle) can stand at a place. */
function walkable(x, z) {
	if (Math.abs(x - OX) > CELL * 1.5 - 0.5 || Math.abs(z - OZ) > CELL * 1.5 - 0.5) return false;
	for (const b of R.boxes) if (Math.abs(x - b[0]) < b[2] + 0.32 && Math.abs(z - b[1]) < b[3] + 0.32) return false;
	return true;
}

/** Puts the furniture of each kind of room along its walls, as far as the pools go. */
function placeFurniture(L) {
	const used = {};
	for (let cz = 0; cz < 3; cz++) {
		for (let cx = 0; cx < 3; cx++) {
			const kind = FURNITURE_OF[L.roles[cx + cz * 3]];
			if (!kind) continue;
			const centre = cellCenter(cx, cz);
			const spots = (L.roles[cx + cz * 3] === 'hall' ? PILLAR_SPOTS : WALL_SPOTS).slice();
			for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const keep = spots[i]; spots[i] = spots[j]; spots[j] = keep; }
			for (let n = 0; n < kind[2]; n++) {
				const index = used[kind[0]] || 0;
				if (index >= kind[1]) break;
				used[kind[0]] = index + 1;
				const spot = spots[n];
				R.boxes.push(L.roles[cx + cz * 3] === 'hall' ? [centre[0] + spot.x, centre[2] + spot.z, 0.45, 0.45] : Math.abs(Math.sin(spot.yaw)) > 0.5 ? [centre[0] + spot.x, centre[2] + spot.z, 0.3, 0.6] : [centre[0] + spot.x, centre[2] + spot.z, 0.6, 0.3]);
				ctx.world.setWorldPose(kind[0] + index, { position: [centre[0] + spot.x, 0, centre[2] + spot.z], rotation: [0, Math.sin(spot.yaw / 2), 0, Math.cos(spot.yaw / 2)] }, false);
			}
		}
	}
}

function pickLoot(tier) {
	const table = LOOT_TABLES[tier];
	let total = 0;
	for (const entry of table) total += entry[1];
	let roll = rand() * total;
	for (const entry of table) { roll -= entry[1]; if (roll <= 0) return { id: entry[0], n: entry[2] }; }
	return { id: table[0][0], n: table[0][2] };
}

function routePoints(route) {
	const points = [];
	for (let k = 0; k < route.length; k++) {
		const centre = cellCenter(route[k][0], route[k][1]);
		if (k > 0) { const before = cellCenter(route[k - 1][0], route[k - 1][1]); points.push([(before[0] + centre[0]) / 2, 0, (before[2] + centre[2]) / 2]); }
		points.push(centre);
	}
	return points;
}

function makeEnemy(kind, index, id, position, yaw, route) {
	const def = ENEMIES[kind];
	return {
		kind, def, id, i: index, scale: def.scale || 1, pos: position.slice(), yaw, home: yaw, hp: def.hp, dead: false, state: 'patrol', route, wp: 0, dirn: 1, wait: 0,
		target: '', sees: false, lastSeen: null, lastSeenT: 0, alert: null, alertT: 0, look: rand() * 0.2, react: 0, tele: 0, burstLeft: 0, gap: 0,
		cool: 1 + rand(), aim: null, strafe: rand() < 0.5 ? 1 : -1, strafeT: 1 + rand() * 2, laser: -1, sweep: rand() * 6, flash: 0,
		stagger: 0, fall: 1, moved: false, speedNow: 0, phase: rand() * 6, legAngle: 0, shell: 0, stepT: rand(),
		aware: 0, awareRate: 0, awareP: null, watch: null, sus: false, flinch: 0, kick: 0, alertFlash: 0, pose: { r: 0.9, l: 1.45, ly: 0, u: 0, h: 0, tail: 0, hp: 0 }, marks: { y: 0, r: 0 }, deadPosed: false
	};
}

/** Builds the raid for a layout: what is switched on, where everything stands. Returns nothing; fills R. */
function buildRaid(L) {
	applyStructure(L);
	R.layout = L; R.enemies = []; R.loot = []; R.bags = []; R.exits = []; R.boxes = buildObstacles(L);
	const entry = cellCenter(L.entry[0], L.entry[1]);
	ctx.world.setWorldPose(IDS.entryPad, { position: [entry[0], 0.03, entry[2]] }, false);
	L.exits.forEach((exit, i) => {
		if (!exit.active) return;
		const centre = cellCenter(exit.cell[0], exit.cell[1]);
		R.exits.push({ i, pos: centre, progress: {} });
		ctx.world.setWorldPose(idExit(i), { position: [centre[0], 0.04, centre[2]] }, false);
		ctx.world.setWorldPose(idBeacon(i), { position: [centre[0], 1.5, centre[2]] }, false);
		// The sign is read from the middle of the map, where the squad comes from.
		const looks = Math.atan2(OX - centre[0], OZ - centre[2]) + Math.PI;
		ctx.world.setWorldPose(idArrow(i), { position: [centre[0], 2.5, centre[2]], rotation: [0, Math.sin(looks / 2), 0, Math.cos(looks / 2)] }, false);
	});
	placeFurniture(L);
	L.loot.forEach((spot, i) => {
		const item = pickLoot(spot.tier), centre = cellCenter(spot.cell[0], spot.cell[1]), off = cornerOffset(spot.spot);
		const pos = [centre[0] + off[0], PROP_TOP + 0.11, centre[2] + off[1]];
		R.loot.push({ i, id: item.id, n: item.n, pos, on: true, take: {} });
		field(idLoot(i), 'meshRenderer', 'color', ITEMS[item.id].color);
		field(idLoot(i) + '-label', 'textDisplay', 'lines', [ITEMS[item.id].name + (item.n > 1 ? ' x' + item.n : ''), '$' + ITEMS[item.id].value * item.n]);
		ctx.world.setWorldPose(idLoot(i), { position: pos }, false);
	});
	let heavy = false;
	L.soldiers.forEach((soldier, i) => {
		const route = routePoints(soldier.route), first = route[0];
		const spawn = route.length > 1 ? first : [first[0] + (rand() - 0.5) * 2.4, 0, first[2] + (rand() - 0.5) * 2.4];
		// The vault has a heavy among its guards.
		const start = soldier.route[0], inVault = L.roles[start[0] + start[1] * 3] === 'vault';
		const kind = inVault && !heavy && rand() < 0.85 ? 'heavy' : 'soldier';
		if (kind === 'heavy') heavy = true;
		R.enemies.push(makeEnemy(kind, i, idSoldier(i), spawn, rand() * 6.28, route));
	});
	// Dogs are kept in the barracks.
	let dogs = 0;
	for (let cz = 0; cz < 3 && dogs < POOLS.dogs; cz++) {
		for (let cx = 0; cx < 3 && dogs < POOLS.dogs; cx++) {
			if (L.roles[cx + cz * 3] !== 'barracks' || L.dist[cx + cz * 3] < 2 || rand() > 0.7) continue;
			const centre = cellCenter(cx, cz), at = [centre[0] + (rand() - 0.5) * 2, 0, centre[2] + (rand() - 0.5) * 2];
			const dog = makeEnemy('dog', dogs, idDog(dogs), at, rand() * 6.28, []);
			dog.state = 'rest';
			R.enemies.push(dog);
			dogs += 1;
		}
	}
	L.turrets.forEach((turret, i) => {
		const centre = cellCenter(turret.cell[0], turret.cell[1]), off = cornerOffset(turret.spot);
		const pos = [centre[0] + off[0] * 1.1, PROP_TOP, centre[2] + off[1] * 1.1];
		const yaw = Math.atan2(centre[0] - pos[0], centre[2] - pos[2]);
		R.enemies.push(makeEnemy('turret', i, idTurret(i), pos, yaw, []));
	});
	for (const e of R.enemies) placeEnemy(e);
}

const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qx = (angle) => [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];

const qy = (angle) => [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
const qz = (angle) => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];

function placeEnemy(e) {
	const yaw = [0, Math.sin(e.yaw / 2), 0, Math.cos(e.yaw / 2)], size = e.scale > 1 ? [e.scale, e.scale, e.scale] : undefined;
	// Whatever has been shot dead tips over, a soldier backwards and a dog on its side, and stays where it fell.
	if (e.dead) {
		ctx.world.setWorldPose(e.id, { position: [e.pos[0], e.pos[1] + 0.12 * e.fall, e.pos[2]], rotation: qmul(yaw, e.kind === 'dog' ? qz(1.5 * e.fall) : qx(-1.5 * e.fall)), ...(size ? { scale: size } : {}) }, false);
		return;
	}
	ctx.world.setWorldPose(e.id, { position: e.pos, rotation: yaw, ...(size ? { scale: size } : {}) }, false);
}

/** The legs swing while a soldier walks, a footstep can be heard when somebody is near, and the white shell of a hit goes away. */
function walkAnimation(e, dt) {
	if (e.moved) e.phase += dt * (3 + e.speedNow * 2.2);
	const swing = e.moved ? Math.sin(e.phase) * 0.55 : 0;
	if (Math.abs(swing - e.legAngle) > 0.03 || (!e.moved && e.legAngle !== 0)) {
		e.legAngle = e.moved ? swing : 0;
		const front = e.kind === 'dog' ? '-legF' : '-legL', back = e.kind === 'dog' ? '-legB' : '-legR';
		ctx.world.setLocalPose(e.id + front, { rotation: qx(e.legAngle) }, false);
		ctx.world.setLocalPose(e.id + back, { rotation: qx(-e.legAngle) }, false);
	}
	if (e.moved) {
		e.stepT -= dt;
		if (e.stepT <= 0) {
			e.stepT = e.speedNow > 2 ? 0.42 : 0.7;
			// Steps are only heard close by (a thud through a wall at 18 m was taken for gunfire), and soft.
			if ((R.heads || []).some((head) => dist3(head, e.pos) < 8)) soundAt([e.pos[0], 0.1, e.pos[2]], 110, e.speedNow > 2 ? 0.1 : 0.06, 45, 0, 0.9);
		}
	}
	e.moved = false;
	if (e.shell > 0) { e.shell -= dt; if (e.shell <= 0) ctx.world.setLocalPose(e.id + '-flash', { scale: HIDDEN }, false); }
}

function animateDeath(e, dt) {
	if (!e.deadPosed) {
		e.deadPosed = true;
		// Limp: the arms hang, the body bends, the marks go.
		if (humanoid(e)) {
			ctx.world.setLocalPose(e.id + '-armR', { rotation: qx(1.2) }, false);
			ctx.world.setLocalPose(e.id + '-armL', { rotation: qmul(qy(-0.3), qx(1.4)) }, false);
			ctx.world.setLocalPose(e.id + '-upper', { rotation: qx(0.35) }, false);
			ctx.world.setLocalPose(e.id + '-head', { rotation: qy(0.5) }, false);
		} else if (e.kind === 'dog') {
			ctx.world.setLocalPose(e.id + '-head', { rotation: qx(0.6) }, false);
		}
		for (const key of ['-mY', '-mBar', '-mDot']) ctx.world.setLocalPose(e.id + key, { scale: HIDDEN }, false);
	}
	e.fall = Math.min(1, e.fall + dt * 2.2);
	placeEnemy(e);
}
`;

/** What the enemies do. */
const AI_SOURCE = `
const humanoid = (e) => e.kind === 'soldier' || e.kind === 'heavy';
const eyeOf = (e) => [e.pos[0], e.pos[1] + (e.kind === 'turret' ? 0.9 : e.kind === 'dog' ? 0.6 : 1.6 * e.scale), e.pos[2]];
const chestOf = (head) => [head[0], head[1] - 0.4, head[2]];
const forwardOf = (e) => [Math.sin(e.yaw), 0, Math.cos(e.yaw)];
const turnToward = (e, target, dt, rate) => {
	let diff = target - e.yaw;
	while (diff > Math.PI) diff -= 2 * Math.PI;
	while (diff < -Math.PI) diff += 2 * Math.PI;
	e.yaw += clamp(diff, -rate * dt, rate * dt);
};

function poseOf(p) { return ctx.world.getPlayerPose(p.id); }
function livePlayers() {
	const list = [];
	for (const p of players.values()) if (p.state === 'raid' && p.hp > 0) list.push(p);
	return list;
}

/** Moves on the ground towards a point, sliding round what is in the way; returns whether it got there. */
function stepToward(e, goal, speed, dt) {
	const dx = goal[0] - e.pos[0], dz = goal[2] - e.pos[2], d = Math.hypot(dx, dz);
	if (d < 0.05) return true;
	const step = Math.min(d, speed * dt);
	let ux = dx / d, uz = dz / d;
	if ((R.frame + e.i) % 3 === 0) {
		const from = [e.pos[0], 0.9, e.pos[2]];
		const clear = (x, z) => !ctx.world.raycast(from, [x, 0, z], step * 2 + 0.45, { ignore: NONSOLID });
		if (!clear(ux, uz)) {
			if (clear(-uz, ux)) { const keep = ux; ux = -uz; uz = keep; }
			else if (clear(uz, -ux)) { const keep = ux; ux = uz; uz = -keep; }
			else return false;
		}
		e.slide = [ux, uz];
	} else if (e.slide) { ux = e.slide[0]; uz = e.slide[1]; }
	let nx = e.pos[0] + ux * step, nz = e.pos[2] + uz * step;
	// Whatever the rays said, a soldier never ends up inside a wall: it slides along it, or stays.
	if (!walkable(nx, nz)) {
		if (walkable(nx, e.pos[2])) nz = e.pos[2];
		else if (walkable(e.pos[0], nz)) nx = e.pos[0];
		else return false;
	}
	e.pos[0] = nx; e.pos[2] = nz;
	e.moved = true; e.speedNow = speed;
	return d - step < 0.05;
}

/**
 * What an enemy sees, a few times a second: how fast it is noticing somebody (awareRate, per second, negative while nobody is in
 * its view) and who. Nobody is noticed in the first seconds of a raid. The notice is a meter, aware: it fills faster the closer
 * the player is, and drains while they are out of sight.
 */
function perceive(e, dt, live) {
	e.look -= dt;
	if (e.look > 0) return;
	e.look = 0.2;
	e.awareRate = -TUNING.noticeDecay; e.awareP = null;
	if (R.t < TUNING.grace) return;
	const eye = eyeOf(e), fwd = forwardOf(e);
	let best = 0;
	for (const p of live) {
		const pose = poseOf(p);
		if (!pose) continue;
		const head = pose.head.position, to = sub3(head, eye), d = len(to);
		if (d > e.def.sight) continue;
		const flat = Math.hypot(to[0], to[2]) || 1;
		const angle = Math.acos(clamp((fwd[0] * to[0] + fwd[2] * to[2]) / flat, -1, 1));
		if (angle > e.def.fov / 2 && d > 3) continue;
		if (!visible(eye, head)) continue;
		const fill = 1 / lerp(TUNING.noticeClose, TUNING.noticeFar, clamp(d / e.def.sight, 0, 1)) * (e.kind === 'turret' ? 1.6 : e.state === 'rest' ? 0.6 : 1);
		if (fill > best) { best = fill; e.awareP = p; e.watch = head.slice(); }
	}
	if (best > 0) e.awareRate = best;
}

function engage(e, p) {
	const pose = poseOf(p);
	if (e.state !== 'combat') {
		e.state = 'combat'; e.react = e.kind === 'turret' ? 0.2 : e.kind === 'dog' ? 0.9 : 0.55; e.cool = 0.4 + rand() * 0.6; e.tele = 0; e.burstLeft = 0; e.aware = 0; e.alertFlash = 1.3;
		if (e.kind === 'dog') { soundAt([e.pos[0], 0.6, e.pos[2]], 150, 0.6, 320, 60, 0.8); later(0.35, () => soundAt([e.pos[0], 0.6, e.pos[2]], 190, 0.6, 200, 90, 0.8)); }
		soundAt([e.pos[0], 1.5, e.pos[2]], 780, 0.4, 110, 0, 0.12);
		later(0.12, () => soundAt([e.pos[0], 1.5, e.pos[2]], 1040, 0.4, 150, 0, 0.12));
		// A shout: the ones close by come to look.
		for (const other of R.enemies) {
			if (other === e || other.dead || other.kind === 'turret' || other.state === 'combat') continue;
			if (dist3(other.pos, e.pos) < 10) { other.state = 'investigate'; other.alert = pose ? [pose.head.position[0], 0, pose.head.position[2]] : e.pos.slice(); other.alertT = 10; }
		}
	}
	e.target = p.id; e.sees = true; e.lastSeenT = 0;
	if (pose) e.lastSeen = pose.head.position.slice();
}

/** A noise at a place: the soldiers within hearing go to see, less far through walls. */
function noise(pos, radius) {
	for (const e of R.enemies) {
		if (e.dead || e.kind === 'turret' || e.state === 'combat') continue;
		const walled = !visible([pos[0], 1.2, pos[2]], [e.pos[0], 1.2, e.pos[2]]);
		if (dist3(e.pos, pos) <= radius * (walled ? 0.55 : 1) * (e.kind === 'dog' ? 0.6 : 1)) { e.state = 'investigate'; e.alert = [pos[0], 0, pos[2]]; e.alertT = 14; e.aware = Math.max(e.aware, 0.2); }
	}
}

function acquireLaser(e) {
	for (let i = POOLS.tracers - 4; i < POOLS.tracers; i++) {
		if (!R.enemies.some((other) => other.laser === i)) { e.laser = i; return; }
	}
}
function releaseLaser(e) {
	if (e.laser >= 0) park(idTracer(e.laser));
	e.laser = -1;
}
/** Where an enemy's weapon ends, in the world. */
function muzzleOf(e) {
	const m = MUZZLE_AT[e.kind], k = e.scale, s = Math.sin(e.yaw), c = Math.cos(e.yaw);
	return [e.pos[0] + (m[0] * c + m[2] * s) * k, e.pos[1] + m[1] * k, e.pos[2] + (-m[0] * s + m[2] * c) * k];
}
/** A bright puff at the end of a barrel for a moment: a slot that goes by itself, so it costs the guests almost nothing. */
function flashAt(pos, size) {
	ctx.world.spawn({ name: 'Muzzle Flash', position: pos, scale: [size, size, size], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' }, color: '#ffd27a', unlit: true, opacity: 0.9 }, { type: 'expires', expiresAt: Date.now() + 55 }] }, { ephemeral: true });
}
function laneBetween(id, from, to, width) {
	const way = sub3(to, from), l = len(way);
	if (l < 0.05) return;
	const dir = mul3(way, 1 / l);
	ctx.world.setWorldPose(id, { position: add3(from, mul3(dir, l / 2)), rotation: aimQ(dir), scale: [width, width, l] }, false);
}

function enemyShoot(e) {
	const p = players.get(e.target);
	if (!p || p.state !== 'raid' || !e.aim) return;
	const origin = muzzleOf(e), spreadTo = dist3(origin, e.aim);
	const spread = 0.012 + spreadTo * 0.0016;
	const dir = norm3(add3(norm3(sub3(e.aim, origin)), [(rand() - 0.5) * 2 * spread, (rand() - 0.5) * 2 * spread, (rand() - 0.5) * 2 * spread]));
	const wall = ctx.world.raycast(origin, dir, e.def.sight * 1.5, { ignore: NONSOLID });
	let reach = wall ? dist3(origin, wall.point) : e.def.sight * 1.5;
	let victim = null;
	for (const q of livePlayers()) {
		const pose = poseOf(q);
		if (!pose) continue;
		const head = pose.head.position, feet = [head[0], head[1] - TUNING.playerHeight + 0.2, head[2]];
		const t = raySegment(origin, dir, feet, head, TUNING.playerRadius, reach);
		if (t >= 0 && t < reach) { reach = t; victim = q; }
	}
	for (let i = 0; i < POOLS.tracers; i++) {
		if (R.enemies.some((other) => other.laser === i) || i < POOLS.tracers - 4) continue;
		laneBetween(idTracer(i), origin, add3(origin, mul3(dir, reach)), 0.03);
		later(0.08, () => park(idTracer(i)));
		break;
	}
	e.kick = 1;
	flashAt(origin, e.kind === 'turret' ? 0.22 : 0.16);
	soundAt(origin, e.kind === 'turret' ? 210 : 300, 0.55, 110, 160, 0.45);
	soundAt(origin, 1500, 0.2, 35, 1100, 0.6);
	if (victim) hurt(victim, e.def.damage, origin);
	else if (wall) burstAt(wall.point, '#a8a29e', 3);
}

function updateEnemy(e, dt, live) {
	if (e.dead) return;
	e.frameT = (e.frameT || 0) + dt;
	if (e.state !== 'combat') {
		perceive(e, dt, live);
		e.aware = clamp(e.aware + e.awareRate * dt, 0, 1);
		if (e.awareP && e.aware >= 1) engage(e, e.awareP);
		else if (e.aware > 0.25 && !e.sus) { e.sus = true; if (e.kind !== 'dog' && e.kind !== 'turret') soundAt([e.pos[0], 1.5, e.pos[2]], 240, 0.3, 140, 120, 0.3); }
		else if (e.aware < 0.1) e.sus = false;
	}
	const noticing = e.state !== 'combat' && e.aware > 0.25 && e.watch;
	if (e.state === 'combat') combat(e, dt);
	else if (noticing) {
		// It has seen something: it stops, and looks at the place.
		turnToward(e, Math.atan2(e.watch[0] - e.pos[0], e.watch[2] - e.pos[2]), dt, e.kind === 'turret' ? 4 : 5);
	} else if (e.kind === 'turret') idleTurret(e, dt);
	else if (e.state === 'rest') { /* a dog asleep on its feet: it only wakes to what it hears or sees */ }
	else if (e.state === 'investigate') {
		// It goes to look, quicker than a patrol and slower than a charge, and stops every few steps to listen.
		e.listenT = (e.listenT || 0) - dt;
		if (e.listenT < -3) e.listenT = 0.7;
		const arrived = e.listenT > 0 ? false : stepToward(e, e.alert, e.kind === 'dog' ? e.def.run * 0.7 : Math.min(e.def.run, e.def.walk * 1.9), dt);
		e.alertT -= dt;
		if (arrived || e.alertT <= 0) { e.state = 'search'; e.alertT = 5; }
		else if (e.listenT <= 0) turnToward(e, Math.atan2(e.alert[0] - e.pos[0], e.alert[2] - e.pos[2]), dt, 6);
	} else if (e.state === 'search') {
		e.alertT -= dt; e.yaw += 1.4 * dt;
		if (e.alertT <= 0) {
			e.state = e.kind === 'dog' ? 'rest' : 'patrol';
			let best = 0, bestD = 1e9;
			e.route.forEach((point, i) => { const d = dist3(point, e.pos); if (d < bestD) { bestD = d; best = i; } });
			e.wp = best;
		}
	} else patrol(e, dt);
	if (e.kind !== 'turret') walkAnimation(e, dt);
	animateEnemy(e, dt);
	placeEnemy(e);
}

/**
 * The body language of an enemy: a soldier carries its rifle low on patrol, raises it when it hears or sees something and holds it
 * to its shoulder in a fight; it kicks with every shot and rocks back when it is hit. A dog sleeps with its head down, creeps with
 * it low and wags its tail when it is in a fight. Over the head, a ball fills as the enemy notices somebody, and a "!" shows when it has.
 */
function animateEnemy(e, dt) {
	const k = Math.min(1, dt * 9), P = e.pose, set = (key, value) => { if (Math.abs(P[key] - value) > 0) P[key] += (value - P[key]) * k; };
	const moving = e.moved;
	if (humanoid(e)) {
		let r = 0.9, l = 1.45, ly = 0, u = 0, h = 0;
		if (e.state === 'combat') { r = e.tele > 0 || e.burstLeft > 0 ? 0 : 0.18; l = 0.2; ly = 0.55; u = 0.06; }
		else if (e.aware > 0.25 || e.state === 'investigate') { r = 0.3; l = 0.55; ly = 0.5; u = 0.1; }
		else if (e.state === 'search') { r = 0.7; l = 1.1; h = Math.sin(clock * 1.7 + e.i) * 0.9; }
		else if (e.wait > 0) h = Math.sin(clock * 0.9 + e.i * 2) * 0.6;
		if (moving && e.state !== 'combat') { const sw = Math.sin(e.phase) * 0.14; r += sw; l -= sw; }
		u -= 0.55 * e.flinch; h += 0.3 * e.flinch; r -= 0.22 * e.kick;
		set('r', r); set('l', l); set('ly', ly); set('u', u); set('h', h);
		e.flinch = Math.max(0, e.flinch - dt * 3); e.kick = Math.max(0, e.kick - dt * 9);
		if (!e.posed || Math.abs(P.r - e.posed.r) > 0.012) ctx.world.setLocalPose(e.id + '-armR', { rotation: qx(P.r) }, false);
		if (!e.posed || Math.abs(P.l - e.posed.l) + Math.abs(P.ly - e.posed.ly) > 0.012) ctx.world.setLocalPose(e.id + '-armL', { rotation: qmul(qy(P.ly), qx(P.l)) }, false);
		if (!e.posed || Math.abs(P.u - e.posed.u) > 0.012) ctx.world.setLocalPose(e.id + '-upper', { rotation: qx(P.u) }, false);
		if (!e.posed || Math.abs(P.h - e.posed.h) > 0.012) ctx.world.setLocalPose(e.id + '-head', { rotation: qy(P.h) }, false);
		e.posed = { r: P.r, l: P.l, ly: P.ly, u: P.u, h: P.h };
	} else if (e.kind === 'dog') {
		let head = 0.15, tail = 0;
		if (e.state === 'rest') head = 0.75;
		else if (e.state === 'combat') { head = e.react > 0 ? 0.55 : -0.1; tail = Math.sin(clock * 16) * 0.5; }
		else if (e.aware > 0.25) head = 0.5;
		else head = 0.15 + Math.sin(clock * 3 + e.i) * 0.2;
		head += 0.4 * e.flinch;
		set('hp', head); set('tail', tail);
		e.flinch = Math.max(0, e.flinch - dt * 3);
		if (!e.posed || Math.abs(P.hp - e.posed.hp) > 0.012) ctx.world.setLocalPose(e.id + '-head', { rotation: qx(P.hp) }, false);
		if (!e.posed || Math.abs(P.tail - e.posed.tail) > 0.02) ctx.world.setLocalPose(e.id + '-tail', { rotation: qy(P.tail) }, false);
		e.posed = { hp: P.hp, tail: P.tail };
	}
	// The marks over the head.
	e.alertFlash = Math.max(0, e.alertFlash - dt);
	const yellow = e.state !== 'combat' && e.aware > 0.04 ? 0.08 + 0.22 * e.aware : 0, red = e.alertFlash > 0 ? 1 : 0;
	if (Math.abs(yellow - e.marks.y) > 0.01) { e.marks.y = yellow; ctx.world.setLocalPose(e.id + '-mY', { scale: yellow > 0 ? [yellow, yellow, yellow] : HIDDEN }, false); }
	if (red !== e.marks.r) { e.marks.r = red; ctx.world.setLocalPose(e.id + '-mBar', { scale: red ? [0.07, 0.26, 0.07] : HIDDEN }, false); ctx.world.setLocalPose(e.id + '-mDot', { scale: red ? [0.08, 0.08, 0.08] : HIDDEN }, false); }
}

function patrol(e, dt) {
	if (e.route.length < 2) { e.sweep += dt; e.yaw = e.home + Math.sin(e.sweep * 0.6) * 1.3; return; }
	if (e.wait > 0) { e.wait -= dt; e.yaw += 0.6 * dt; return; }
	const goal = e.route[e.wp];
	const arrived = stepToward(e, goal, e.def.walk, dt);
	e.yaw = Math.atan2(goal[0] - e.pos[0], goal[2] - e.pos[2]);
	if (arrived) {
		let next = e.wp + e.dirn;
		if (next < 0 || next >= e.route.length) { e.dirn = -e.dirn; next = e.wp + e.dirn; e.wait = 1.5 + rand() * 2; }
		e.wp = next;
	}
}

function idleTurret(e, dt) {
	e.sweep += dt;
	e.yaw = e.home + Math.sin(e.sweep * 0.7) * 0.6;
}

/** A dog runs straight at its target and bites when it gets there. */
function dogBite(e, p, head, d, dt) {
	if (e.react > 0) { e.react -= dt; return; }
	e.cool -= dt;
	if (d > e.def.melee) { stepToward(e, [head[0], 0, head[2]], e.def.run, dt); return; }
	if (e.cool <= 0) {
		e.cool = e.def.cooldown[0];
		soundAt([e.pos[0], 0.5, e.pos[2]], 170, 0.5, 170, 80, 0.7);
		hurt(p, e.def.damage, e.pos);
	}
}

function combat(e, dt) {
	const p = players.get(e.target);
	if (!p || p.state !== 'raid') { e.state = e.kind === 'turret' ? 'patrol' : 'search'; e.alertT = 5; releaseLaser(e); return; }
	const pose = poseOf(p);
	if (!pose) return;
	const head = pose.head.position, eye = eyeOf(e);
	e.look -= dt;
	if (e.look <= 0) { e.look = 0.15; e.sees = dist3(eye, head) <= e.def.sight * 1.2 && visible(eye, head); }
	if (e.sees) { e.lastSeen = head.slice(); e.lastSeenT = 0; } else e.lastSeenT += dt;
	if (e.lastSeenT > (e.kind === 'turret' ? 3 : 4)) {
		releaseLaser(e);
		e.tele = 0; e.burstLeft = 0;
		if (e.kind === 'turret') { e.state = 'patrol'; return; }
		e.state = 'investigate'; e.alert = [e.lastSeen[0], 0, e.lastSeen[2]]; e.alertT = 8;
		return;
	}
	const to = [head[0] - e.pos[0], 0, head[2] - e.pos[2]], d = Math.hypot(to[0], to[2]) || 0.01;
	turnToward(e, Math.atan2(to[0], to[2]), dt, e.kind === 'turret' ? 3 : e.kind === 'dog' ? 12 : 7);
	if (e.stagger > 0) { e.stagger -= dt; return; }
	if (e.kind === 'dog') return dogBite(e, p, head, d, dt);
	if (e.def.run > 0 && e.burstLeft === 0) {
		e.strafeT -= dt;
		if (e.strafeT <= 0) { e.strafe = -e.strafe; e.strafeT = 1 + rand() * 2; }
		const side = [-to[2] / d * e.strafe, 0, to[0] / d * e.strafe];
		let forward = 0;
		if (d > e.def.keep + 2) forward = 1; else if (d < e.def.keep - 3) forward = -1;
		const move = [to[0] / d * forward + side[0] * 0.6, 0, to[2] / d * forward + side[2] * 0.6];
		if (Math.hypot(move[0], move[2]) > 0.05) stepToward(e, [e.pos[0] + move[0] * 2, 0, e.pos[2] + move[2] * 2], e.def.run * (forward === 0 ? 0.6 : 1), dt);
	}
	if (e.react > 0) { e.react -= dt; return; }
	if (e.burstLeft > 0) {
		e.gap -= dt;
		if (e.gap <= 0) {
			enemyShoot(e);
			e.burstLeft -= 1; e.gap = e.def.burstGap;
			if (e.burstLeft === 0) e.cool = lerpRange(e.def.cooldown);
		}
		return;
	}
	if (e.tele > 0) {
		e.tele -= dt;
		// It follows the player with its aim until the last instant: a step to the side then makes it miss.
		if (e.sees && e.tele > 0.12) e.aim = chestOf(head);
		if (e.laser >= 0 && e.aim) laneBetween(idTracer(e.laser), muzzleOf(e), e.aim, 0.012);
		if (e.tele <= 0) { releaseLaser(e); e.burstLeft = e.def.burst; e.gap = 0; }
		return;
	}
	e.cool -= dt;
	if (e.cool <= 0 && e.sees && d <= e.def.sight) { e.tele = e.def.telegraph; e.aim = chestOf(head); acquireLaser(e); soundAt(muzzleOf(e), 520, 0.2, 260, -320, 0.25); }
}
`;

/** What the players' weapons do, and what happens to a player who is hit. */
const COMBAT_SOURCE = `
const players = new Map();
function playerRec(id, name) {
	let p = players.get(id);
	if (!p) {
		p = { id, name: name || 'Player', state: 'hub', gun: -1, hp: TUNING.maxHp, maxHp: TUNING.maxHp, packCap: TUNING.packSlots, case: [], suppressed: false, armor: null, weapons: [], active: 0, mags: [0, 0], pack: [], lootValue: 0, kills: 0,
			reload: 0, medkit: 0, nextShot: 0, bloom: 0, recoil: 0, recoilShown: 0, shownKind: '', shownArrow: 9, shownPack: -1, beatT: 0, lastSeq: 0, extract: 0, deadAt: 0, noiseT: -9, toastT: 0, cleared: 0, shownHp: -1, shownMag: -1, shownText: '', textT: -9, bagTake: 0 };
		players.set(id, p);
	}
	if (name) p.name = name;
	return p;
}

const gunStates = [];
function readGuns() {
	for (let i = 0; i < POOLS.guns; i++) {
		const slot = ctx.hierarchy.getSlot(gunId(i, 'brain')), state = slot && slot.components.find((c) => c.type === 'scriptState');
		gunStates[i] = (state && state.data) || {};
	}
}
/** The gun a player has equipped, or -1. */
function gunOf(id) {
	for (let i = 0; i < POOLS.guns; i++) if (gunStates[i] && gunStates[i].equipped && gunStates[i].playerId === id) return i;
	return -1;
}

const weaponOf = (p) => WEAPONS[p.weapons[p.active]];
const reserveOf = (p) => countIn(p.pack, 'ammo9');

/** Shows the model of the weapon in the hand (the other one is shrunk away) and moves the muzzle to the end of its barrel. */
function showWeapon(p) { showKind(p, p.weapons[p.active]); }
function showKind(p, kind) {
	if (p.gun < 0 || !GUN_MODELS[kind] || p.shownKind === kind) return;
	p.shownKind = kind;
	for (const name of Object.keys(GUN_MODELS)) {
		for (const part of GUN_MODELS[name].parts) ctx.world.setLocalPose(gunId(p.gun, name + '-' + part.key), { position: part.position, scale: name === kind ? part.scale : HIDDEN }, false);
	}
	ctx.world.setLocalPose(gunId(p.gun, 'muzzle'), { position: GUN_MODELS[kind].muzzle }, false);
	markFlush();
}
/** A gun kicks back and up when it fires and settles again. */
function recoilGun(p, dt) {
	if (p.gun < 0) return;
	if (p.recoil > 0.002) p.recoil = Math.max(0, p.recoil - dt * 3.5);
	else if (p.recoilShown === 0) return;
	const r = p.recoil > 0.002 ? p.recoil : 0;
	if (r === p.recoilShown) return;
	p.recoilShown = r;
	ctx.world.setLocalPose(gunId(p.gun, 'model'), { position: [0, 0.006 * r, -0.03 * r || 0], rotation: qx(-0.16 * r) }, false);
}

function startReload(p) {
	const w = weaponOf(p);
	if (!w || p.reload > 0 || p.medkit > 0) return;
	if (p.mags[p.active] >= w.mag) return toast(p, 'Magazine full');
	if (reserveOf(p) <= 0) return toast(p, 'No ammo');
	p.reload = w.reload;
	soundAt(posOfGun(p), 200, 0.4, 120, 0, 0.5);
}
function finishReload(p) {
	const w = weaponOf(p);
	const taken = takeFrom(p.pack, w.caliber, w.mag - p.mags[p.active]);
	p.mags[p.active] += taken;
	soundAt(posOfGun(p), 360, 0.4, 90, 0, 0.3);
}
/**
 * Where a player's shots come from and which way they go. In a headset that is the muzzle of the gun in the hand. On the desktop
 * (no hands) it is the eye along the crosshair, like any shooter: a guest on the desktop sends no hand, so for the host their
 * gun is not where they hold it. The tracer starts from beside the gun either way.
 */
function aimOf(p) {
	const pose = poseOf(p);
	if (pose && !pose.left && !pose.right) {
		const h = pose.head;
		return { position: h.position, forward: h.forward, right: h.right, up: h.up, visual: add3(h.position, add3(mul3(h.forward, 0.35), add3(mul3(h.right, 0.14), mul3(h.up, -0.12)))) };
	}
	const muzzle = p.gun >= 0 ? ctx.hierarchy.getWorldPose(gunId(p.gun, 'muzzle')) : null;
	return muzzle ? { position: muzzle.position, forward: muzzle.forward, right: muzzle.right, up: muzzle.up, visual: muzzle.position } : null;
}
function posOfGun(p) {
	const aim = aimOf(p);
	return aim ? aim.visual : [0, 1.4, 0];
}
function startMedkit(p) {
	if (p.medkit > 0 || p.reload > 0) return;
	if (p.hp >= p.maxHp) return toast(p, 'Health is full');
	if (countIn(p.pack, 'medkit') <= 0) return toast(p, 'No medkit');
	p.medkit = TUNING.medkitSeconds;
}
function switchWeapon(p) {
	if (p.weapons.length < 2) return;
	p.reload = 0;
	p.active = (p.active + 1) % p.weapons.length;
	p.nextShot = 0.3; p.bloom = 0;
	showWeapon(p);
	toast(p, ITEMS[p.weapons[p.active]].name);
}

function toast(p, text, soft) {
	if (p.gun < 0) return;
	field(gunId(p.gun, 'readout'), 'textDisplay', 'title', text);
	if (!soft) p.toastT = clock + 3;
}

function hurt(p, amount, from) {
	if (p.state !== 'raid' || p.hp <= 0) return;
	const stopped = ARMOR[p.armor] || 0;
	p.hp = Math.max(0, p.hp - amount * (1 - stopped));
	p.medkit = 0;
	const pose = poseOf(p);
	if (pose) {
		// A red veil over the eyes of whoever is hit: everyone sees the slot, the one wearing the head sees it close.
		ctx.world.spawn({ name: 'Hit Flash', position: add3(pose.head.position, mul3(pose.head.forward, 0.3)), rotation: pose.head.rotation, scale: [1.4, 1.4, 1],
			components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#dc2626', unlit: true, opacity: 0.35 }, { type: 'expires', expiresAt: Date.now() + 220 }] }, { ephemeral: true });
		thudAt(pose.head.position, 0.8);
		soundAt(pose.head.position, 190, 0.6, 200, 110, 0.55);
		// And a red mark at the side the shot came from, a little way out from the face.
		if (from) {
			const way = norm3([from[0] - pose.head.position[0], 0, from[2] - pose.head.position[2]]);
			const looks = Math.atan2(-way[0], -way[2]) + Math.PI;
			ctx.world.spawn({ name: 'Hit Direction', position: add3(pose.head.position, add3(mul3(way, 0.5), [0, -0.05, 0])), rotation: [0, Math.sin(looks / 2), 0, Math.cos(looks / 2)], scale: [0.5, 0.1, 1],
				components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#ef4444', unlit: true, opacity: 0.85 }, { type: 'expires', expiresAt: Date.now() + 650 }] }, { ephemeral: true });
		}
	}
	if (p.hp <= 0) killPlayer(p, 'killed');
}

/** Some of what an enemy carried falls where it did: a soldier may leave a clip, a heavy always leaves something worth taking. */
function dropFrom(e) {
	const drop = DROPS[e.kind];
	if (!drop || rand() > drop.chance || R.loot.length >= POOLS.loot) return;
	const i = R.loot.length, pos = [e.pos[0] + 0.5, 0.14, e.pos[2]];
	R.loot.push({ i, id: drop.item, n: drop.n, pos, on: true, take: {} });
	field(idLoot(i), 'meshRenderer', 'color', ITEMS[drop.item].color);
	field(idLoot(i) + '-label', 'textDisplay', 'lines', [ITEMS[drop.item].name + (drop.n > 1 ? ' x' + drop.n : ''), '$' + ITEMS[drop.item].value * drop.n]);
	ctx.world.setWorldPose(idLoot(i), { position: pos }, false);
}

/** A hit pushes the enemy back a little and staggers it: its aim and its bite wait a moment, more for a shot to the head. A heavy shrugs it off. */
function knock(e, p, headshot) {
	if (e.kind === 'turret') return;
	const from = posOfGun(p), dx = e.pos[0] - from[0], dz = e.pos[2] - from[2], d = Math.hypot(dx, dz) || 1;
	const push = (headshot ? 0.24 : 0.1) / e.scale;
	const nx = e.pos[0] + dx / d * push, nz = e.pos[2] + dz / d * push;
	if (walkable(nx, nz)) { e.pos[0] = nx; e.pos[2] = nz; }
	e.stagger = (headshot ? 0.34 : 0.14) / e.scale;
}

function damageEnemy(e, amount, p, headshot, spot) {
	// A heavy’s armour stops half of what hits its body, none of what hits its head.
	e.hp -= amount * (headshot ? TUNING.headshot : 1 - (e.def.armorBody || 0));
	if (e.state !== 'combat') engage(e, p);
	e.flinch = 1;
	knock(e, p, headshot);
	const ear = posOfGun(p);
	if (e.kind !== 'turret') { e.shell = 0.07; ctx.world.setLocalPose(e.id + '-flash', { scale: e.kind === 'dog' ? DOG_SHELL : HIT_SHELL }, false); }
	if (e.hp <= 0) {
		e.dead = true; e.fall = 0; p.kills += 1;
		releaseLaser(e);
		dropFrom(e);
		burstAt(spot, '#b91c1c', 18);
		soundAt(spot, 150, 0.6, 220, 100, 0.5);
		soundAt(ear, 520, 0.3, 180, 380, 0.05);
		hitmark(p, 'kill');
		return;
	}
	hitmark(p, headshot ? 'head' : 'hit');
	burstAt(spot, headshot ? '#fde047' : '#b91c1c', headshot ? 8 : 5);
	soundAt(spot, 280, 0.4, 70, 0, 0.4);
	// What the shooter hears of a hit: a tick, and a higher, longer ring for the head.
	soundAt(ear, headshot ? 3100 : 2200, headshot ? 0.32 : 0.22, headshot ? 160 : 45, 0, 0);
}

function fire(p, w) {
	const muzzle = aimOf(p);
	if (!muzzle) return;
	p.mags[p.active] -= 1; p.nextShot = w.interval;
	const spread = w.spread + p.bloom;
	p.bloom += w.bloom;
	const origin = muzzle.position;
	const dir = norm3(add3(add3(muzzle.forward, mul3(muzzle.right, (rand() - 0.5) * 2 * spread)), mul3(muzzle.up, (rand() - 0.5) * 2 * spread)));
	const wall = ctx.world.raycast(origin, dir, w.range, { ignore: NONSOLID });
	let reach = wall ? dist3(origin, wall.point) : w.range;
	let target = null;
	for (const e of R.enemies) {
		if (e.dead) continue;
		const k = e.scale, at = e.pos;
		if (humanoid(e)) {
			const head = [at[0], at[1] + 1.62 * k, at[2]];
			const th = raySphere(origin, dir, head, 0.17 * k, reach);
			if (th >= 0 && th < reach) { reach = th; target = { e, head: true }; }
			const tb = raySegment(origin, dir, [at[0], at[1] + 0.15 * k, at[2]], [at[0], at[1] + 1.45 * k, at[2]], 0.3 * k, reach);
			if (tb >= 0 && tb < reach) { reach = tb; target = { e, head: false }; }
		} else {
			const tb = raySegment(origin, dir, [at[0], at[1] + 0.1, at[2]], [at[0], at[1] + e.def.height, at[2]], e.def.radius + 0.08, reach);
			if (tb >= 0 && tb < reach) { reach = tb; target = { e, head: false }; }
		}
	}
	const spot = add3(origin, mul3(dir, reach));
	const tracer = idTracer(p.gun % (POOLS.tracers - 4));
	laneBetween(tracer, muzzle.visual, spot, 0.016);
	later(0.07, () => park(tracer));
	const pistol = p.weapons[p.active] === 'pistol';
	// A suppressor takes most of the flash and the bang off, and most of the noise that carries.
	flashAt(muzzle.visual, (pistol ? 0.13 : 0.1) * (p.suppressed ? 0.4 : 1));
	soundAt(origin, pistol ? 150 : 190, p.suppressed ? 0.22 : 0.7, pistol ? 140 : 100, pistol ? 100 : 130, 0.35);
	if (!p.suppressed) soundAt(origin, 1900, 0.28, 35, 1500, 0.65);
	p.recoil = pistol ? 1 : Math.min(1, p.recoil + 0.45);
	if (clock - p.noiseT > TUNING.noiseGap) { p.noiseT = clock; noise(origin, p.suppressed ? w.noise * 0.25 : w.noise); }
	if (target) damageEnemy(target.e, w.damage, p, target.head, spot);
	else if (wall) burstAt(wall.point, '#d6d3d1', 4);
}

function updateWeapon(p, dt) {
	const gun = gunStates[p.gun] || {}, w = weaponOf(p);
	if (!w) return;
	p.nextShot -= dt; p.bloom = Math.max(0, p.bloom - dt * 0.03);
	if (p.reload > 0) { p.reload -= dt; if (p.reload <= 0) finishReload(p); }
	if (p.medkit > 0) {
		p.medkit -= dt;
		if (p.medkit <= 0 && takeFrom(p.pack, 'medkit', 1) > 0) { p.hp = Math.min(p.maxHp, p.hp + MEDKIT_HEAL); soundAt(posOfGun(p), 660, 0.4, 200, 0, 0); }
	}
	const pressed = gun.seq !== p.lastSeq;
	p.lastSeq = gun.seq;
	if (!(w.auto ? gun.down : pressed) || p.reload > 0 || p.medkit > 0 || p.nextShot > 0) return;
	if (p.mags[p.active] > 0) fire(p, w);
	else { soundAt(posOfGun(p), 120, 0.3, 40, 0, 0.8); startReload(p); }
}
`;

/** Squads, the raid from start to end, pickups, extraction, death, the gun's display and the console. */
const FLOW_SOURCE = `
const squad = [];
let screenT = 0;
const seenCommands = new Set();

/** How bright each kind of room is left, so that the raid has dark corners and a vault that glows red. */
const ROOM_LIGHT = { hall: [0.85, '#ffffff'], storage: [0.5, '#ffffff'], barracks: [0.35, '#ffffff'], control: [0.9, '#d8f0ff'], vault: [0.8, '#ff7a64'] };
const roomVolume = (cx, cz) => 'dd-lv-room-' + cx + cz;
/** The baked light of a room (when the world has it) is dimmed, tinted, or flickered by the script. */
function setRoomLight(cx, cz, intensity, tint) {
	try { field(roomVolume(cx, cz), 'lightVolume', 'intensity', intensity); field(roomVolume(cx, cz), 'lightVolume', 'tint', tint); } catch (e) { /* a world that was not baked has no volumes */ }
}
function lightRooms(L) {
	const dark = new Set();
	while (dark.size < 2) { const i = Math.floor(rand() * 9); if (i !== L.entry[0] + L.entry[1] * 3) dark.add(i); }
	for (let i = 0; i < 9; i++) {
		const cx = i % 3, cz = Math.floor(i / 3);
		const base = ROOM_LIGHT[L.roles[i]] || [1, '#ffffff'];
		const entry = i === L.entry[0] + L.entry[1] * 3;
		setRoomLight(cx, cz, entry ? 1 : dark.has(i) ? 0.08 : base[0], entry ? '#ffffff' : base[1]);
	}
}
/** In the lockdown the whole place goes red and pulses. */
function alarmLight(dt) {
	R.pulseT = (R.pulseT || 0) - dt;
	if (R.pulseT > 0) return;
	R.pulseT = 0.45; R.pulse = !R.pulse;
	for (let i = 0; i < 9; i++) setRoomLight(i % 3, Math.floor(i / 3), R.pulse ? 0.9 : 0.25, '#ff3a2a');
}

function startRaid() {
	const members = squad.map((id) => players.get(id)).filter((p) => p && p.state === 'hub' && gunOf(p.id) >= 0);
	if (!members.length) return say('Nobody in the squad has a weapon equipped. Take one from the rack, equip it, and press JOIN.');
	R.on = true; R.t = 0; R.frame = 0; R.alarm = false; R.report = []; R.raids += 1; R.creakT = 6;
	enable(GATE.open, false); enable(GATE.closed, true);
	const seed = nextSeed !== null ? nextSeed : Math.floor(rand() * 4294967296);
	nextSeed = null;
	parkAll();
	buildRaid(generateLayout(seed));
	lightRooms(R.layout);
	const entry = cellCenter(R.layout.entry[0], R.layout.entry[1]);
	const spots = [[-1.2, -2.5], [1.2, -2.5], [-1.2, -0.8], [1.2, -0.8]];
	members.forEach((p, i) => {
		const profile = profileOf(p.id);
		p.gun = gunOf(p.id);
		// What is taken out of the stash for the raid is lost with the player if they do not make it back (the case excepted).
		applyKit(p, profile);
		p.active = 0; p.mags = p.weapons.map((id) => WEAPONS[id].mag);
		p.hp = p.maxHp; p.reload = 0; p.medkit = 0; p.nextShot = 0.5; p.bloom = 0; p.extract = 0; p.lootValue = 0; p.kills = 0;
		p.lastSeq = (gunStates[p.gun] || {}).seq; p.shownHp = -1; p.shownMag = -1; p.shownText = ''; p.state = 'raid';
		p.shownKind = ''; p.recoil = 0; p.recoilShown = 0; p.shownArrow = 9; p.shownPack = -1;
		showWeapon(p);
		saveProfile(p.id);
		ctx.world.teleportPlayer(p.id, { position: [entry[0] + spots[i % 4][0], 0, entry[2] + spots[i % 4][1]], yaw: 0 });
		toast(p, 'INSERTION', true);
		later(3.5, () => { if (R.on && p.state === 'raid') toast(p, 'Quiet for now. Look, then move.', true); });
		later(TUNING.grace, () => { if (R.on && p.state === 'raid' && p.hp > 0) toast(p, 'They are awake', true); });
	});
	soundAt([entry[0], 1.5, entry[2] - 5], 70, 0.7, 700, 40, 0.9);
	renderStash(); renderTrader(); // the kit taken for the raid is no longer in the stash
	say('Raid ' + R.raids + ' under way. Find loot, avoid noise, reach a green exit zone and stay for ' + TUNING.extractSeconds + ' s.');
	markFlush();
}

function sendHome(p) {
	ctx.world.teleportPlayer(p.id, { position: HUB.spawn, yaw: HUB.yaw });
	p.state = 'hub';
	if (p.fx >= 0) { park(idFx(p.fx)); p.fx = -1; }
	// What was lost or brought back changes what the wall, the lockers and the trader show.
	renderStash(); renderTrader();
}

function extractPlayer(p) {
	const profile = profileOf(p.id);
	for (const id of p.weapons) addTo(profile.stash, id, 1);
	if (p.armor) addTo(profile.stash, p.armor, 1);
	for (const e of p.pack) addTo(profile.stash, e.id, e.n);
	if (p.suppressed) addTo(profile.stash, 'suppressor', 1);
	returnCase(p, profile);
	profile.extracted += p.lootValue; profile.raids += 1; profile.best = Math.max(profile.best, p.lootValue);
	R.report.push(p.name + ' got out with $' + p.lootValue + ' of loot.');
	if (ctx.leaderboards && ctx.leaderboards.available && p.lootValue > 0) Promise.resolve(ctx.leaderboards.submit('dead-drop-loot', { id: p.id, name: p.name }, p.lootValue, { order: 'high' })).catch(() => {});
	saveProfile(p.id);
	soundAt(posOfGun(p), 523, 0.5, 300, 0, 0);
	sendHome(p);
}

function killPlayer(p, why) {
	if (p.state !== 'raid') return;
	const pose = poseOf(p), profile = profileOf(p.id);
	profile.deaths += 1;
	const items = p.pack.map((e) => ({ id: e.id, n: e.n }));
	for (const id of p.weapons) items.push({ id, n: 1 });
	if (p.armor) items.push({ id: p.armor, n: 1 });
	const spot = pose ? [pose.head.position[0], 0, pose.head.position[2]] : [OX, 0, OZ];
	const index = R.bags.length < POOLS.bags ? R.bags.length : -1;
	if (index >= 0 && items.length && why !== 'left') {
		R.bags.push({ i: index, items, pos: spot, on: true, owner: p.id, take: {} });
		ctx.world.setWorldPose(idBag(index), { position: spot }, false);
	}
	returnCase(p, profile);
	R.report.push(p.name + (why === 'mia' ? ' did not get out in time.' : why === 'left' ? ' left the raid.' : ' was killed.'));
	p.state = 'dead'; p.deadAt = clock; p.pack = []; p.weapons = []; p.armor = null; p.hp = 0; p.suppressed = false;
	saveProfile(p.id);
	if (why !== 'left') startDeath(p);
}

/** Dying has to be felt: a flash that settles into a dark red veil with a banner, a low boom and a ringing, until the way back to the bunker. */
function startDeath(p) {
	toast(p, 'YOU DIED');
	p.fx = p.gun; p.fxLeft = -1;
	const pose = poseOf(p);
	if (!pose || p.fx < 0) return;
	const veil = idFx(p.fx) + '-veil', head = pose.head.position;
	field(veil, 'meshRenderer', 'color', '#ef4444'); field(veil, 'meshRenderer', 'opacity', 0.95);
	later(0.3, () => { if (p.state === 'dead') { field(veil, 'meshRenderer', 'color', '#2a0707'); field(veil, 'meshRenderer', 'opacity', 0.72); } });
	thudAt(head, 1);
	soundAt(head, 85, 0.9, 700, -50, 0.4);
	soundAt(head, 3300, 0.07, 1600, 0, 0);
	later(0.25, () => soundAt(head, 55, 0.7, 500, -20, 0.2));
	deathFx(p);
}
/** Keeps the veil in front of a dead player's eyes and counts the seconds to the way back. */
function deathFx(p) {
	if (!(p.fx >= 0)) return;
	const pose = poseOf(p);
	if (!pose) return;
	ctx.world.setWorldPose(idFx(p.fx), { position: add3(pose.head.position, mul3(pose.head.forward, 0.4)), rotation: pose.head.rotation }, false);
	const left = Math.max(1, Math.ceil(TUNING.respawnSeconds - (clock - p.deadAt)));
	if (left !== p.fxLeft) { p.fxLeft = left; field(idFx(p.fx) + '-text', 'textDisplay', 'lines', ['Back in the bunker in ' + left + ' s']); }
}

/** A cross at the crosshair for a moment when a shot lands: white for the body, yellow for the head, a bigger red one for a kill. */
function hitmark(p, kind) {
	const pose = poseOf(p);
	if (!pose) return;
	const h = pose.head, at = add3(h.position, mul3(h.forward, 0.8)), big = kind === 'kill';
	const color = big ? '#ef4444' : kind === 'head' ? '#fde047' : '#ffffff';
	for (const side of [1, -1]) {
		ctx.world.spawn({ name: 'Hit Marker', position: at, rotation: qmul(h.rotation, qz(side * Math.PI / 4)), scale: [big ? 0.008 : 0.005, big ? 0.06 : 0.036, 1],
			components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color, unlit: true, opacity: 0.95 }, { type: 'expires', expiresAt: Date.now() + (big ? 320 : 130) }] }, { ephemeral: true });
	}
}

function takeFromWorld(p, list) {
	let took = 0;
	for (const item of list.slice()) {
		const added = packAdd(p.pack, item.id, item.n, p.packCap);
		took += added; item.n -= added;
		if (item.n <= 0) list.splice(list.indexOf(item), 1);
	}
	return took;
}

/**
 * Whether a player is reaching a point: with hands (a headset) a hand has to be on it; without (the desktop) looking at it from
 * close by is the same thing.
 */
function reaches(p, point) {
	const pose = poseOf(p);
	if (!pose) return false;
	if (pose.left || pose.right) return [pose.left, pose.right].some((hand) => hand && dist3(hand.position, point) <= 0.45);
	const head = pose.head.position, reach = 2.2, along = clamp(dot3(sub3(point, head), pose.head.forward), 0, reach);
	return dist3(point, add3(head, mul3(pose.head.forward, along))) <= 0.35 && dist3(head, point) <= reach + 0.3;
}

function pickups(dt, live) {
	for (const loot of R.loot) {
		if (!loot.on) continue;
		for (const p of live) {
			if (!reaches(p, loot.pos)) { loot.take[p.id] = 0; continue; }
			loot.take[p.id] = (loot.take[p.id] || 0) + dt;
			if (loot.take[p.id] < 0.3) continue;
			const added = packAdd(p.pack, loot.id, loot.n, p.packCap);
			if (added <= 0) { if (clock > p.toastT) toast(p, 'Pack full'); loot.take[p.id] = 0; continue; }
			p.lootValue += ITEMS[loot.id].value * added;
			loot.n -= added;
			toast(p, '+ ' + ITEMS[loot.id].name + (added > 1 ? ' x' + added : ''));
			chime(loot.pos, ITEMS[loot.id].value * added);
			if (loot.n <= 0) { loot.on = false; park(idLoot(loot.i)); break; }
		}
	}
	for (const bag of R.bags) {
		if (!bag.on) continue;
		for (const p of live) {
			if (!reaches(p, add3(bag.pos, [0, 0.2, 0]))) { bag.take[p.id] = 0; continue; }
			bag.take[p.id] = (bag.take[p.id] || 0) + dt;
			if (bag.take[p.id] < 0.6) continue;
			const took = takeFromWorld(p, bag.items);
			if (took > 0) { toast(p, 'Took ' + took + ' items from the bag'); soundAt(bag.pos, 700, 0.4, 150, 0, 0); }
			else if (clock > p.toastT) toast(p, 'Pack full');
			bag.take[p.id] = 0;
			if (!bag.items.length) { bag.on = false; park(idBag(bag.i)); break; }
		}
	}
}

function extraction(dt, live) {
	for (const p of live) {
		const pose = poseOf(p);
		if (!pose) continue;
		const inside = R.exits.some((x) => Math.hypot(pose.head.position[0] - x.pos[0], pose.head.position[2] - x.pos[2]) <= TUNING.extractRadius);
		const before = Math.floor(p.extract);
		p.extract = inside ? p.extract + dt : Math.max(0, p.extract - dt * 2);
		if (inside && Math.floor(p.extract) > before) soundAt(pose.head.position, 440 + p.extract * 40, 0.3, 90, 0, 0);
		if (p.extract >= TUNING.extractSeconds) extractPlayer(p);
	}
}

function nearestExit(p) {
	const pose = poseOf(p);
	if (!pose || !R.exits.length) return -1;
	let best = 1e9;
	for (const x of R.exits) best = Math.min(best, Math.hypot(pose.head.position[0] - x.pos[0], pose.head.position[2] - x.pos[2]));
	return Math.round(best);
}

function setBar(gun, part, z, fraction) {
	ctx.world.setLocalPose(gunId(gun, part), { position: [-BAR.width / 2 * (1 - fraction), BAR.y, z], scale: [Math.max(0.001, BAR.width * fraction), BAR.height, BAR.depth] }, false);
}

/** The sounds of the place: a heartbeat when a player is hurt badly, a siren once the lockdown has been called. */
function atmosphere(p, pose, dt) {
	if (!pose) return;
	const head = pose.head.position;
	if (p.hp <= 35 && p.hp > 0) {
		p.beatT -= dt;
		if (p.beatT <= 0) {
			p.beatT = 0.55 + p.hp / 100;
			soundAt(head, 58, 0.6, 110, 25, 0.1);
			later(0.17, () => soundAt(head, 52, 0.45, 100, 20, 0.1));
		}
	}
	if (R.alarm) {
		p.sirenT = (p.sirenT || 0) - dt;
		if (p.sirenT <= 0) {
			p.sirenT = 2.4;
			soundAt(head, 620, 0.32, 380, 0, 0.02);
			later(0.42, () => soundAt(head, 840, 0.32, 380, 0, 0.02));
		}
	}
}

/** A pickup rings, higher and longer the more it is worth. */
function chime(pos, value) {
	const tones = value >= 800 ? [660, 880, 1320] : value >= 250 ? [660, 990] : [660];
	tones.forEach((frequency, i) => later(i * 0.09, () => soundAt(pos, frequency, 0.32, 160, 0, 0)));
}

/** The arrow on the gun turns to the nearest open exit, seen from the way the gun points. */
function pointArrow(p) {
	const pose = poseOf(p), aim = aimOf(p);
	if (!pose || !aim || !R.exits.length) return;
	let best = null, bestD = 1e9;
	for (const x of R.exits) { const d = Math.hypot(pose.head.position[0] - x.pos[0], pose.head.position[2] - x.pos[2]); if (d < bestD) { bestD = d; best = x; } }
	let rel = Math.atan2(best.pos[0] - pose.head.position[0], best.pos[2] - pose.head.position[2]) - Math.atan2(aim.forward[0], aim.forward[2]);
	while (rel > Math.PI) rel -= 2 * Math.PI;
	while (rel < -Math.PI) rel += 2 * Math.PI;
	if (Math.abs(rel - p.shownArrow) < 0.05) return;
	p.shownArrow = rel;
	ctx.world.setLocalPose(gunId(p.gun, 'arrow'), { rotation: [0, Math.sin(rel / 2), 0, Math.cos(rel / 2)] }, false);
}

function showHud(p) {
	if (p.gun < 0) return;
	const w = weaponOf(p);
	const hp = p.hp / p.maxHp;
	if (Math.abs(hp - p.shownHp) > 0.004) { p.shownHp = hp; setBar(p.gun, 'hp', BAR.hpZ, hp); }
	const mag = w ? p.mags[p.active] / w.mag : 0;
	if (Math.abs(mag - p.shownMag) > 0.004) { p.shownMag = mag; setBar(p.gun, 'mag', BAR.magZ, mag); }
	const pack = slotsUsed(p.pack) / p.packCap;
	if (Math.abs(pack - p.shownPack) > 0.004) { p.shownPack = pack; setBar(p.gun, 'pack', BAR.packZ, pack); }
	pointArrow(p);
	if (clock > p.toastT && p.toastT > 0) { p.toastT = 0; field(gunId(p.gun, 'readout'), 'textDisplay', 'title', 'DEAD DROP'); }
	if (clock - p.textT < 1) return;
	const left = Math.max(0, TUNING.raidSeconds - R.t), seconds = Math.floor(left % 60);
	const exit = nearestExit(p);
	const lines = [
		(w ? ITEMS[p.weapons[p.active]].name + ' ' + p.mags[p.active] + '/' + w.mag + ' +' + reserveOf(p) : '') + (p.reload > 0 ? ' RELOAD' : ''),
		'HP ' + Math.ceil(p.hp) + (p.armor ? '  ARMOR ' + Math.round(ARMOR[p.armor] * 100) + '%' : '') + (countIn(p.pack, 'medkit') ? '  +' + countIn(p.pack, 'medkit') + ' med' : ''),
		'PACK ' + slotsUsed(p.pack) + '/' + p.packCap + '   $' + p.lootValue + (p.suppressed ? '   SUP' : ''),
		Math.floor(left / 60) + ':' + (seconds < 10 ? '0' : '') + seconds + (exit >= 0 ? '   EXIT ' + exit + ' m' : '') + (p.extract > 0 ? '   OUT ' + Math.ceil(TUNING.extractSeconds - p.extract) : '')
	];
	const key = lines.join('|');
	if (key === p.shownText) return;
	p.shownText = key; p.textT = clock;
	field(gunId(p.gun, 'readout'), 'textDisplay', 'lines', lines);
}

function processCommands() {
	const kids = ctx.hierarchy.getChildren(IDS.commands);
	for (const slot of kids) {
		if (seenCommands.has(slot.id)) continue;
		seenCommands.add(slot.id);
		const state = slot.components.find((c) => c.type === 'scriptState'), data = state && state.data;
		const p = data && players.get(data.player);
		if (!p || p.state !== 'raid' || p.gun !== data.gun) continue;
		if (data.cmd === 'reload') startReload(p);
		else if (data.cmd === 'medkit') startMedkit(p);
		else if (data.cmd === 'switch') switchWeapon(p);
	}
	if (seenCommands.size > 64) { const alive = new Set(kids.map((s) => s.id)); for (const id of [...seenCommands]) if (!alive.has(id)) seenCommands.delete(id); }
}

/** A gun back in the bunker: the pistol model, no bars, and the text it started with. */
function resetGun(p) {
	showKind(p, 'pistol');
	p.recoil = 0; p.recoilShown = 0; p.shownHp = -1; p.shownMag = -1; p.shownPack = -1; p.shownText = ''; p.toastT = 0;
	ctx.world.setLocalPose(gunId(p.gun, 'model'), { position: [0, 0, 0], rotation: [0, 0, 0, 1] }, false);
	setBar(p.gun, 'hp', BAR.hpZ, 1); setBar(p.gun, 'mag', BAR.magZ, 1); setBar(p.gun, 'pack', BAR.packZ, 0);
	field(gunId(p.gun, 'readout'), 'textDisplay', 'title', 'DEAD DROP');
	field(gunId(p.gun, 'readout'), 'textDisplay', 'lines', ['Equip me, then JOIN', 'at the console']);
}

function endRaid() {
	R.on = false;
	enable(GATE.open, true); enable(GATE.closed, false);
	for (const p of players.values()) if (p.gun >= 0) resetGun(p);
	parkAll();
	for (const e of R.enemies) e.dead = true;
	const lines = R.report.length ? R.report.join(' ') : 'The raid is over.';
	say('Raid over. ' + lines + ' Equip a weapon and press JOIN to go again.');
	squad.length = 0;
	markFlush();
}

function tickRaid(dt) {
	R.t += dt; R.frame += 1;
	if (!R.alarm && R.t >= TUNING.alarmAt) {
		R.alarm = true;
		for (const p of livePlayers()) toast(p, 'LOCKDOWN SOON');
		for (let k = 0; k < 3; k++) later(k * 0.4, () => soundAt([OX, 2, OZ], 300, 0.8, 300, 0, 0.1));
	}
	if (R.alarm) alarmLight(dt);
	if (R.t >= TUNING.raidSeconds) for (const p of livePlayers()) killPlayer(p, 'mia');
	const live = livePlayers();
	R.heads = [];
	for (const p of live) {
		p.gun = gunOf(p.id);
		const pose = poseOf(p);
		if (pose) R.heads.push(pose.head.position);
		if (p.gun < 0) continue;
		updateWeapon(p, dt);
		recoilGun(p, dt);
		showHud(p);
		atmosphere(p, pose, dt);
	}
	R.creakT -= dt;
	if (R.creakT <= 0 && R.heads.length) {
		R.creakT = 20 + rand() * 25;
		const near = R.heads[Math.floor(rand() * R.heads.length)], angle = rand() * 6.28;
		soundAt([near[0] + Math.sin(angle) * 9, 1.5, near[2] + Math.cos(angle) * 9], 90 + rand() * 40, 0.1, 500, -30, 0.85);
	}
	for (const e of R.enemies) {
		if (e.dead) { if (e.fall < 1) animateDeath(e, dt); continue; }
		updateEnemy(e, dt, live);
	}
	pickups(dt, live);
	extraction(dt, live);
	for (const p of players.values()) {
		if (p.state === 'dead' && clock - p.deadAt >= TUNING.respawnSeconds) sendHome(p);
		else if (p.state === 'dead') { deathFx(p); if (p.gun >= 0) showHud(p); }
	}
	if (!livePlayers().length && ![...players.values()].some((p) => p.state === 'dead' && clock - p.deadAt < TUNING.respawnSeconds)) endRaid();
}

const CON = { user: '' };
const isHostPlayer = (id) => (ctx.world.getPlayers().find((q) => q.id === id) || {}).role === 'host';
/** The people in the bunker who have not joined the squad yet. */
const notJoined = () => [...players.values()].filter((q) => q.state === 'hub' && squad.indexOf(q.id) < 0).map((q) => q.name);
const squadText = () => 'Squad: ' + squad.map((id) => players.get(id).name).join(', ') + '.';
/** One button for the one who is at the console: JOIN if they are not in the squad, LEAVE if they are. START RAID is green when the host can press it. */
function renderConsole() {
	const joined = !!CON.user && squad.indexOf(CON.user) >= 0;
	field(IDS.join, 'uiElement', 'visible', !joined);
	field(IDS.leave, 'uiElement', 'visible', joined);
	const ready = !R.on && squad.length > 0 && notJoined().length === 0;
	field(IDS.start, 'uiElement', 'background', CON.user && isHostPlayer(CON.user) && ready ? '#16a34a' : '#3f3f46');
}

function onPress(event) {
	readGuns();
	const who = ctx.world.getPlayer(event.remoteGuestId ? event.remoteGuestId + ':right' : 'right');
	const p = playerRec(who.id, who.name);
	if (economyPress(event, p)) return;
	if (event.slotId === IDS.join || event.slotId === IDS.leave || event.slotId === IDS.start) CON.user = p.id;
	if (event.slotId === IDS.join) {
		if (R.on) return say('A raid is under way. Wait for it to end.');
		const gun = gunOf(p.id);
		if (gun < 0) return say(p.name + ', take a weapon from the rack and equip it first.');
		if (squad.indexOf(p.id) < 0) { if (squad.length >= POOLS.guns) return say('The squad is full.'); squad.push(p.id); }
		p.gun = gun;
		const waiting = notJoined();
		say(squadText() + '\\nYour kit: ' + kitText(profileOf(p.id)) + '.\\nChange it at the stash. ' + (waiting.length ? 'Waiting for ' + waiting.join(', ') + ' to join.' : 'Everybody is in: the host can start the raid.'));
	} else if (event.slotId === IDS.leave) {
		const at = squad.indexOf(p.id);
		if (at >= 0 && !R.on) squad.splice(at, 1);
		say(squad.length ? squadText() : 'The squad is empty.');
	} else if (event.slotId === IDS.start) {
		if (R.on) return say('A raid is already under way.');
		if (!isHostPlayer(p.id)) return say('Only the host can start the raid.');
		if (!squad.length) return say('The squad is empty. Take a weapon, equip it and press JOIN.');
		const waiting = notJoined();
		if (waiting.length) return say('Waiting for ' + waiting.join(', ') + ' to join.');
		startRaid();
	}
	renderConsole();
}
`;

/** The handlers of the script. */
const RETURN_SOURCE = `
return {
	onPlayerReady(player) { playerRec(player.id, player.name); return loadProfile(player); },
	onSpawn() { renderTrader(); renderStash(); renderConsole(); },
	onPlayerLeft(player) {
		const p = players.get(player.id);
		if (!p) return;
		if (p.state === 'raid') killPlayer(p, 'left');
		const at = squad.indexOf(p.id);
		if (at >= 0) squad.splice(at, 1);
		players.delete(p.id);
		renderConsole();
	},
	onUIEvent(event) { if (event.type === 'press') onPress(event); },
	tick(dt) {
		if (!ctx.world.isHost()) return;
		clock += dt;
		runCues(dt);
		readGuns();
		processCommands();
		if ((screenT -= dt) <= 0) { screenT = 0.4; wakeScreens(); }
		if (R.on) tickRaid(dt);
		maybeFlush();
	},
	/** For the tests: what the game holds. */
	__debug: { damageEnemy, R, players, squad, profiles, profileOf, playerRec, setSeed(seed) { nextSeed = seed; }, clock: () => clock, hurt, killPlayer, packAdd, slotsUsed, takeFrom, countIn, noise, engage, extractPlayer }
};
`;

/** The body of the director's code block. */
export function directorScript(): string {
	return [preludeSource(FRAME), dataSource(), MATH_SOURCE, PROFILE_SOURCE, WORLD_SOURCE, AI_SOURCE, COMBAT_SOURCE, FLOW_SOURCE, ECONOMY_SOURCE, GEAR_SOURCE, RETURN_SOURCE].join('\n');
}
