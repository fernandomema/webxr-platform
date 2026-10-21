import { BOARDS, DISHES, DIVIDERS, DOOR, EXTRAS, HALL, ID, INGREDIENTS, ITEM_REST, KINDS, KNIFE, LEVEL_UNLOCKS, LEVEL_XP, LOOKS, MODELS, MODIFIERS, MUST_HAVE, PARKED, PARTS, PLATED, PLATED_IN, PLATE_REST, PROCESS, SEAT, SIZES, SIZE_LEVEL, SIZE_NAMES, STAPLES, STARTER_KIT, SURFACE, TUNING, UI, WORKERS } from './bistroData.ts';
import { GEN_SOURCE, PATH_SOURCE } from './bistroGen.ts';
import { LEAF, RAIL_Y } from './bistroHall.ts';

/** The tables of the game and the names of the slots the script reaches, as code. */
function dataSource(): string {
	const names = Object.fromEntries(Object.entries(UI).filter(([, value]) => typeof value === 'string'));
	const fixed = { root: ID.root, flush: ID.flush, tiles: ID.tiles, openSign: ID.openSign, rail: ID.rail };
	return `
const HALL = ${JSON.stringify(HALL)};
const DOOR = ${JSON.stringify(DOOR)};
const SIZES = ${JSON.stringify(SIZES)};
const SIZE_NAMES = ${JSON.stringify(SIZE_NAMES)};
const SIZE_LEVEL = ${JSON.stringify(SIZE_LEVEL)};
const INGREDIENTS = ${JSON.stringify(INGREDIENTS)};
const PARTS = ${JSON.stringify(PARTS)};
const LOOKS = ${JSON.stringify(LOOKS)};
const PLATED = ${JSON.stringify(PLATED)};
const PLATED_IN = ${JSON.stringify(PLATED_IN)};
const PROCESS = ${JSON.stringify(PROCESS)};
const DISHES = ${JSON.stringify(DISHES)};
const MODELS = ${JSON.stringify(MODELS)};
const KINDS = ${JSON.stringify(KINDS)};
const STARTER_KIT = ${JSON.stringify(STARTER_KIT)};
const MUST_HAVE = ${JSON.stringify(MUST_HAVE)};
const STAPLES = ${JSON.stringify(STAPLES)};
const EXTRAS = ${JSON.stringify(EXTRAS)};
const MODIFIERS = ${JSON.stringify(MODIFIERS)};
const LEVEL_XP = ${JSON.stringify(LEVEL_XP)};
const LEVEL_UNLOCKS = ${JSON.stringify(LEVEL_UNLOCKS)};
const TUNING = ${JSON.stringify(TUNING)};
const BOARDS = ${JSON.stringify(BOARDS)};
const SURFACE = ${JSON.stringify(SURFACE)};
const SEAT = ${JSON.stringify(SEAT)};
const KNIFE = ${JSON.stringify(KNIFE)};
const WORKERS = ${JSON.stringify(WORKERS)};
const UI = ${JSON.stringify(names)};
const IDS = ${JSON.stringify(fixed)};
const PARKED = ${JSON.stringify(PARKED)};
const DIVIDERS = ${DIVIDERS}, ITEM_REST = ${ITEM_REST}, PLATE_REST = ${PLATE_REST}, RAIL_Y = ${RAIL_Y}, LEAF = ${LEAF};
const TINY = [0.001, 0.001, 0.001];
const idStation = (model, n) => 'bi-st-' + model + '-' + n;
const idItem = (n) => 'bi-item-' + n;
const idPlate = (n) => 'bi-plate-' + n;
const idGuest = (n) => 'bi-guest-' + n;
const idKnife = (n) => 'bi-knife-' + n;
const idMarker = (n) => 'bi-mark-' + n;
const idDivider = (n) => 'bi-div-' + n;
const idHeart = (n) => 'bi-heart-' + n;
const uiCardLine = (i) => 'bi-card-l' + i;
const uiTrackLine = (i) => 'bi-track-l' + i;
const uiPlanCell = (gx, gz) => 'bi-plan-' + gx + '-' + gz;
const uiShopRow = (i) => 'bi-shop-row-' + i;
const uiShopName = (i) => 'bi-shop-name-' + i;
const uiShopBuy = (i) => 'bi-b-buy-' + i;
const generateLayout = ${GEN_SOURCE};
const findPath = ${PATH_SOURCE};
const DISH_IDS = Object.keys(DISHES);
const KIND_IDS = Object.keys(KINDS);
const MODEL_IDS = Object.keys(MODELS);
const SIZE_IDS = Object.keys(SIZES);
const STARTERS = DISH_IDS.filter((id) => DISHES[id].starter);
`;
}

/** Small things everything else uses: numbers, sounds, and writing to the world without telling the guests about every change at once. */
const BASE_SOURCE = `
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const yawQ = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const money = (n) => Math.round(n) + ' coins';
/** A stream of numbers from a seed (mulberry32). */
function dice(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const rand = dice((Date.now() ^ 0x51ed270b) >>> 0);
const pick = (list) => list[Math.floor(rand() * list.length)];
function shuffled(list) {
	const copy = list.slice();
	for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = copy[i]; copy[i] = copy[j]; copy[j] = t; }
	return copy;
}
let clock = 0;
const cues = [];
const later = (seconds, fn) => cues.push({ at: clock + seconds, fn });
function runCues() { for (let i = cues.length - 1; i >= 0; i--) if (cues[i].at <= clock) cues.splice(i, 1)[0].fn(); }

/** A short sound at a place, heard by everybody near it. */
function sound(at, frequency, volume, durationMs, pitchDrop, noiseMix) {
	ctx.world.spawn({ name: 'Impact Sound', position: [at[0], at[1], at[2]], components: [{ type: 'impactSound', frequency, pitchDrop: pitchDrop || 0, noiseMix: noiseMix === undefined ? 0.08 : noiseMix, durationMs: durationMs || 180, volume: volume === undefined ? 0.5 : volume }, { type: 'expires', expiresAt: Date.now() + (durationMs || 180) + 600 }] }, { ephemeral: true });
}
function burst(at, color, count) {
	ctx.world.spawn({ name: 'Particle Burst', position: [at[0], at[1], at[2]], components: [{ type: 'particleBurst', color, count: count || 12, durationMs: 650 }, { type: 'expires', expiresAt: Date.now() + 650 }] }, { ephemeral: true });
}
const chime = (at, notes, gap) => notes.forEach((frequency, i) => later(i * (gap || 0.11), () => sound(at, frequency, 0.45, 260)));
const SOUND = {
	chop: (at) => sound(at, 190, 0.5, 90, 70, 0.55),
	ding: (at) => chime(at, [1047, 1568], 0.09),
	coin: (at) => chime(at, [1319, 1760, 2093], 0.07),
	place: (at) => sound(at, 240, 0.3, 70, 60, 0.35),
	no: (at) => sound(at, 150, 0.35, 160, 30, 0.2),
	sizzle: (at) => sound(at, 2400, 0.12, 320, 0, 1),
	alarm: (at) => chime(at, [1480, 1480], 0.16),
	bell: (at) => chime(at, [1976, 1568], 0.16),
	angry: (at) => chime(at, [311, 233, 175], 0.13),
	win: (at) => chime(at, [523, 659, 784, 1047], 0.12),
	lose: (at) => chime(at, [392, 330, 262, 196], 0.2),
	wash: (at) => sound(at, 900, 0.14, 300, 0, 0.9),
	build: (at) => chime(at, [392, 523], 0.08)
};

// Colours, texts and what is switched on are told to the guests with a whole snapshot of the world, so they are written
// quietly and sent together, a few times a second at most. Poses are quiet too: they go out with the 20 Hz state updates.
const written = new Map();
let dirty = false, flushAt = 0, flushes = 0;
function field(id, type, name, value) {
	const k = id + '|' + type + '|' + name;
	const v = typeof value === 'object' ? JSON.stringify(value) : value;
	if (written.get(k) === v) return;
	written.set(k, v);
	ctx.world.setComponentField(id, type, name, value, false);
	dirty = true;
}
const paint = (id, color) => field(id, 'meshRenderer', 'color', color);
const label = (id, title, lines) => { field(id, 'textDisplay', 'title', title); field(id, 'textDisplay', 'lines', lines || []); };
const uiText = (id, value) => field(id, 'uiElement', 'text', value);
const uiShow = (id, on) => field(id, 'uiElement', 'visible', on);
const uiFill = (id, color) => field(id, 'uiElement', 'background', color);
const uiInk = (id, color) => field(id, 'uiElement', 'color', color);
const shown = new Map();
function show(id, on) {
	if (shown.get(id) === on) return;
	shown.set(id, on);
	ctx.world.setSlotEnabled(id, on, false);
	dirty = true;
}
const move = (id, position, rotation, scale) => ctx.world.setWorldPose(id, Object.assign({ position }, rotation ? { rotation } : {}, scale ? { scale } : {}), false);
// What should go out of sight while a hand still holds it goes when the hand opens.
const loose = new Set();
function park(id) {
	if (ctx.grab.isSlotHeld(id)) loose.add(id);
	else move(id, PARKED);
}
function parkLoose() { for (const id of loose) if (!ctx.grab.isSlotHeld(id)) { loose.delete(id); move(id, PARKED); } }
const pose = (id, p) => ctx.world.setLocalPose(id, p, false);
function flush() {
	if (!dirty || clock < flushAt) return;
	dirty = false;
	flushAt = clock + 0.12;
	ctx.world.setComponentField(IDS.flush, 'scriptState', 'data', { n: ++flushes }, true);
}
const cellAt = (gx, gz) => [HALL.minX + gx + 0.5, 0, HALL.minZ + gz + 0.5];
const cellOf = (p) => [Math.floor(p[0] - HALL.minX), Math.floor(p[2] - HALL.minZ)];
const cellKey = (gx, gz) => gx * 100 + gz;
/** A point given in an appliance's own space (x to its right, z to its back), in the world. */
function inCell(st, x, y, z) {
	const a = (st.turn * Math.PI) / 2, c = Math.cos(a), s = Math.sin(a);
	return [st.pos[0] + x * c + z * s, y, st.pos[2] - x * s + z * c];
}
`;

/** The chefs: what each has earned, kept in their account, and who is in the restaurant right now. */
const PROFILE_SOURCE = `
const profiles = new Map();
const players = new Map();
let heads = [];
const newProfile = () => ({ v: 1, xp: 0, stats: { runs: 0, days: 0, served: 0, bestDay: 0 }, run: null });
function normalizeProfile(saved) {
	const out = newProfile();
	if (!saved || typeof saved !== 'object') return out;
	out.xp = Math.max(0, Math.floor(Number(saved.xp)) || 0);
	for (const k of Object.keys(out.stats)) out.stats[k] = Math.max(0, Math.floor(Number(saved.stats && saved.stats[k])) || 0);
	const run = saved.run;
	if (run && typeof run === 'object' && Array.isArray(run.stations) && Array.isArray(run.menu) && SIZES[run.size] && run.layout && Array.isArray(run.layout.gaps)) {
		const menu = run.menu.filter((id) => DISHES[id]);
		const stations = run.stations.filter((s) => s && KINDS[s.kind] && Number.isInteger(s.gx) && Number.isInteger(s.gz)).map((s) => ({ kind: s.kind, gx: s.gx, gz: s.gz, turn: (Math.floor(Number(s.turn)) || 0) & 3 }));
		if (menu.length && stations.length) {
			out.run = {
				seed: Math.floor(Number(run.seed)) >>> 0, size: run.size, menu, stations,
				day: Math.max(1, Math.floor(Number(run.day)) || 1), coins: Math.max(0, Math.floor(Number(run.coins)) || 0),
				hearts: clamp(Math.floor(Number(run.hearts)) || 1, 1, TUNING.hearts), plates: clamp(Math.floor(Number(run.plates)) || TUNING.plates, 1, TUNING.platesMax),
				mods: (Array.isArray(run.mods) ? run.mods : []).filter((id) => MODIFIERS[id]), reroll: Math.max(TUNING.rerollCost, Math.floor(Number(run.reroll)) || TUNING.rerollCost),
				cards: Math.max(0, Math.floor(Number(run.cards)) || 0), served: Math.max(0, Math.floor(Number(run.served)) || 0),
				layout: { name: String(run.layout.name || 'The Bistro'), kitchen: clamp(Math.floor(Number(run.layout.kitchen)) || 3, 2, HALL.d - 3), gaps: run.layout.gaps.filter((g) => Number.isInteger(g)) }
			};
		}
	}
	return out;
}
function profileOf(id) {
	let profile = profiles.get(id);
	if (!profile) { profile = newProfile(); profiles.set(id, profile); }
	return profile;
}
const levelOf = (xp) => { let level = 1; for (let i = 1; i < LEVEL_XP.length; i++) if (xp >= LEVEL_XP[i]) level = i + 1; return level; };
const nameOf = (id) => (players.get(id) || { name: 'A chef' }).name;
async function loadProfile(player) {
	try {
		if (!ctx.storage || !ctx.storage.available) return;
		const saved = await ctx.storage.player(player.id).get('profile', null);
		if (saved) profiles.set(player.id, normalizeProfile(saved));
	} catch (error) { ctx.log('Could not read a profile: ' + error); }
}
function saveProfile(id) {
	try {
		if (ctx.storage && ctx.storage.available && profiles.has(id)) Promise.resolve(ctx.storage.player(id).set('profile', profiles.get(id))).catch(() => {});
	} catch (error) { ctx.log('Could not save a profile: ' + error); }
}
function refreshPlayers() {
	const list = [];
	for (const p of ctx.world.getPlayers()) {
		players.set(p.id, { id: p.id, name: p.name });
		const view = ctx.world.getPlayerPose(p.id);
		if (view && view.head) list.push({ id: p.id, pos: view.head.position });
	}
	heads = list;
}
const inHall = (p) => p[2] > -0.25 && p[2] < HALL.d + 0.3 && Math.abs(p[0]) < HALL.w / 2 + 0.3;
/** The cooks: everybody who is in the hall now, and during a service everybody who was when it opened. */
function party() {
	const ids = heads.filter((h) => inHall(h.pos)).map((h) => h.id);
	for (const id of G.crew) if (players.has(id) && !ids.includes(id)) ids.push(id);
	if (!ids.length && G.owner && players.has(G.owner)) ids.push(G.owner);
	return ids;
}
function nearest(x, z, range) {
	let best = null, bestD = range;
	for (const h of heads) { const d = Math.hypot(h.pos[0] - x, h.pos[2] - z); if (d < bestD) { best = h.id; bestD = d; } }
	return best;
}
`;

/** The hall as a restaurant uses it: its width, its kitchen floor, the half wall, and the appliances standing in its cells. */
const HALL_SOURCE = `
/** phase: idle (no restaurant), prep (closed: build and buy), service, over (the run is lost). */
const G = { phase: 'idle', owner: null, run: null, layout: null, crew: [], day: null, offers: [], card: null, note: {}, cfg: { seed: Math.floor(rand() * 9000) + 1, size: 0, dish: 0 }, confirm: {}, saveAt: 0, overAt: 0 };
const stations = [];
const pool = {};
for (const model of MODEL_IDS) pool[model] = Array.from({ length: MODELS[model] }, (_, n) => ({ id: idStation(model, n), n, on: false }));
const modelOf = (kind) => KINDS[kind].model;
const stationAt = (gx, gz) => stations.find((st) => st.gx === gx && st.gz === gz);
const stationById = (id) => stations.find((st) => st.id === id);
const hasModel = (model) => stations.some((st) => st.model === model);
const doorColumns = () => [HALL.w / 2 - 1, HALL.w / 2];
/** The cells nothing may stand in: the thresholds of the two doors. */
const isThreshold = (gx, gz) => doorColumns().includes(gx) && (gz === 0 || gz === HALL.d - 1);
function cellFree(gx, gz, except) {
	const L = G.layout;
	if (!L || gx < L.x0 || gx > L.x1 || gz < 0 || gz >= HALL.d || isThreshold(gx, gz)) return false;
	const there = stationAt(gx, gz);
	return !there || there === except;
}
const floorNow = () => ({ x0: G.layout.x0, x1: G.layout.x1, kitchen: G.layout.kitchen, gaps: G.layout.gaps, blocked: stations.map((st) => cellKey(st.gx, st.gz)) });
/** The floor as a guest walks it: the half wall has no way through for them, so they never cross the kitchen. */
const guestFloor = () => Object.assign(floorNow(), { gaps: [] });

function spotCount(model) { return model === 'table' ? 2 : model === 'rack' ? TUNING.platesMax : 1; }
/** Where the thing in spot k of an appliance rests, in the world: its surface, not the origin of what lies on it. */
function spotAt(st, k) {
	const surface = SURFACE[st.model];
	if (st.model === 'table') return inCell(st, 0, surface.top, k === 0 ? -SEAT.plate : SEAT.plate);
	if (st.model === 'rack') return inCell(st, 0, surface.top + k * 0.024, 0);
	return inCell(st, surface.at ? surface.at[0] : 0, surface.top, surface.at ? surface.at[1] : 0);
}
/** Where a guest sits at seat k of a table, and the cell they walk up to it from. */
const seatAt = (st, k) => inCell(st, 0, 0, k === 0 ? -SEAT.offset : SEAT.offset);
function seatCell(st, k) {
	const side = k === 0 ? -1 : 1;
	return st.turn % 2 ? [st.gx + (st.turn === 1 ? side : -side), st.gz] : [st.gx, st.gz + (st.turn === 0 ? side : -side)];
}

function standStation(st) {
	st.pos = cellAt(st.gx, st.gz);
	move(st.id, st.pos, yawQ((st.turn * Math.PI) / 2));
	for (let k = 0; k < st.spots.length; k++) { const t = st.spots[k] ? things.get(st.spots[k]) : null; if (t && !t.held) restPose(t, st, k); }
	if (st.model === 'board') knifeHome(st);
}
/** While the restaurant is closed an appliance can be carried (and walked through); during service it is furniture. */
function setCarried(st, on) {
	if (st.carried === on) return;
	st.carried = on;
	if (on) ctx.world.setComponent(st.id, { type: 'grabbable', scalable: false, autoGrip: true }, false);
	else ctx.world.removeComponent(st.id, 'grabbable', false);
	dirty = true;
	show(st.id + '-grab', on);
}
function placeStation(kind, gx, gz, turn) {
	const model = modelOf(kind);
	const entry = pool[model].find((e) => !e.on && !loose.has(e.id));
	if (!entry) return null;
	entry.on = true;
	const st = { id: entry.id, entry, kind, model, gx, gz, turn: turn || 0, pos: cellAt(gx, gz), spots: Array(spotCount(model)).fill(null), supplyAt: 0, held: false, carried: null, gauge: -1, working: null, number: 0 };
	stations.push(st);
	if (ctx.hierarchy.getSlot(st.id + '-trim')) {
		show(st.id + '-trim', !!KINDS[kind].trim);
		if (KINDS[kind].trim) paint(st.id + '-trim', KINDS[kind].trim);
	}
	if (WORKERS.includes(model)) { showGauge(st, 0, '#22c55e'); setWorking(st, false); }
	standStation(st);
	setCarried(st, G.phase === 'prep');
	numberTables();
	return st;
}
function removeStation(st) {
	for (const id of st.spots) if (id) freeThing(things.get(id));
	if (st.model === 'board') parkKnife(st.entry.n);
	if (st.carried) setCarried(st, false);
	st.entry.on = false;
	stations.splice(stations.indexOf(st), 1);
	park(st.id);
	numberTables();
}
function numberTables() {
	let n = 0;
	for (const st of stations) if (st.model === 'table') { st.number = ++n; label(st.id + '-number', String(n)); }
}
const layoutNow = () => stations.map((st) => ({ kind: st.kind, gx: st.gx, gz: st.gz, turn: st.turn }));

/** The parts of the hall that depend on the restaurant: how much of it is used, the kitchen's tiles, the half wall, the day board. */
function dressHall() {
	const L = G.layout;
	const half = L.w / 2;
	for (const side of ['w', 'e']) {
		const id = 'bi-part-' + side;
		if (L.w >= HALL.w) move(id, PARKED);
		else move(id, [side === 'w' ? -half : half, 0, HALL.d / 2]);
	}
	move(IDS.tiles, [0, 0.004, L.kitchen / 2], undefined, [L.w / 20, 1, L.kitchen / 20]);
	let n = 0;
	for (let gx = L.x0; gx <= L.x1 && n < DIVIDERS; gx++) if (!L.gaps.includes(gx)) move(idDivider(n++), [HALL.minX + gx + 0.5, 0, L.kitchen]);
	for (; n < DIVIDERS; n++) move(idDivider(n), PARKED);
	move(IDS.rail, [0, RAIL_Y, L.kitchen - 0.02]);
	setDoor(true);
}
function clearHall() {
	for (const side of ['w', 'e']) move('bi-part-' + side, PARKED);
	move(IDS.tiles, PARKED);
	for (let n = 0; n < DIVIDERS; n++) move(idDivider(n), PARKED);
	move(IDS.rail, PARKED);
	setDoor(false);
}
/** The door to the lobby: shut while there is no restaurant, swung back against its frames while there is one. */
function setDoor(open) {
	const z = -0.25;
	for (const side of ['l', 'r']) {
		const sign = side === 'l' ? -1 : 1;
		if (open) move('bi-door-' + side, [sign * (DOOR.half - 0.1), 0, z - LEAF / 2 + 0.06], yawQ(sign * Math.PI / 2));
		else move('bi-door-' + side, [sign * LEAF / 2, 0, z], yawQ(0));
	}
}
`;

/** Ingredients and plates: what they look like, where they rest, and where they go when a hand lets go of them. */
const THINGS_SOURCE = `
const things = new Map();
const items = Array.from({ length: TUNING.items }, (_, i) => ({ type: 'item', id: idItem(i), on: false, ing: 'lettuce', stage: 'raw', at: null, plate: null, home: null, pos: PARKED.slice(), held: false, ghost: false, prog: 0, over: 0, chops: 0, dressed: '' }));
const plates = Array.from({ length: TUNING.platesMax }, (_, i) => ({ type: 'plate', id: idPlate(i), on: false, dirty: false, items: [], at: null, home: null, pos: PARKED.slice(), held: false, ghost: false, prog: 0, servedTo: null }));
for (const t of items.concat(plates)) things.set(t.id, t);
const keyOf = (item) => item.ing + ':' + item.stage;
const lookOf = (item) => (item.stage === 'burnt' ? LOOKS.burnt : LOOKS[keyOf(item)]);

/** Arranges the five shapes of an ingredient into what it is now (and, on a plate, into how it is served). */
function dress(item, dish) {
	const k = keyOf(item);
	const signature = k + '|' + (item.plate ? dish || 'plate' : '');
	if (item.dressed === signature) return;
	item.dressed = signature;
	const look = (item.plate && PLATED[k] && PLATED[k].look) || lookOf(item) || LOOKS.burnt;
	for (const part of PARTS) {
		const d = look[part];
		if (d) { pose(item.id + '-' + part, { position: d.at, scale: d.scale }); paint(item.id + '-' + part, d.color); }
		else pose(item.id + '-' + part, { position: [0, 0, 0], scale: TINY });
	}
}
function dressPlate(plate) {
	for (const key of ['dirt-a', 'dirt-b']) pose(plate.id + '-' + key, { scale: plate.dirty ? [0.07, 0.006, 0.07] : TINY });
	paint(plate.id + '-well', plate.dirty ? '#cdbfa8' : '#e8e6e1');
}
const partsOn = (plate) => plate.items.map((id) => keyOf(things.get(id)));
/** Whether a list of parts is a dish of the menu, or the start of one. */
function fits(list) {
	return G.run.menu.some((id) => {
		const parts = DISHES[id].parts.slice();
		if (list.length > parts.length) return false;
		for (const entry of list) { const at = parts.indexOf(entry); if (at < 0) return false; parts.splice(at, 1); }
		return true;
	});
}
function dishOf(plate) {
	const sorted = partsOn(plate).sort().join(',');
	if (!sorted) return '';
	return G.run.menu.find((id) => DISHES[id].parts.slice().sort().join(',') === sorted) || '';
}
const plateTakes = (plate, item) => plate.on && !plate.dirty && !plate.servedTo && item.stage !== 'burnt' && fits(partsOn(plate).concat([keyOf(item)]));

function spawnItem(ing) {
	const t = items.find((e) => !e.on && !e.ghost);
	if (!t) return null;
	Object.assign(t, { on: true, ing, stage: 'raw', at: null, plate: null, home: null, held: false, prog: 0, over: 0, chops: 0 });
	dress(t);
	return t;
}
function spawnPlate() {
	const t = plates.find((e) => !e.on && !e.ghost);
	if (!t) return null;
	Object.assign(t, { on: true, dirty: false, items: [], at: null, home: null, held: false, prog: 0, servedTo: null });
	dressPlate(t);
	return t;
}
function leaveSpot(t) {
	if (!t.at) return;
	const st = stationById(t.at.st);
	if (st && st.spots[t.at.k] === t.id) st.spots[t.at.k] = null;
	t.at = null;
	// A stack of plates closes up over the one that was taken.
	if (st && st.model === 'rack') {
		const stack = st.spots.filter((id) => id);
		st.spots = st.spots.map((_, k) => stack[k] || null);
		stack.forEach((id, k) => { const plate = things.get(id); plate.at = { st: st.id, k }; if (!plate.held) restPose(plate, st, k); });
	}
}
/** Takes a thing out of the game: back to the pool, out of sight. A thing still in a hand goes when the hand opens. */
function freeThing(t) {
	if (!t || !t.on) return;
	if (t.type === 'plate') for (const id of t.items.slice()) freeThing(things.get(id));
	if (t.type === 'item' && t.plate) {
		const plate = things.get(t.plate);
		if (plate) plate.items = plate.items.filter((id) => id !== t.id);
		t.plate = null;
		ctx.world.setParent(t.id, null, false);
		ctx.world.setComponent(t.id, { type: 'grabbable', scalable: false, autoGrip: true }, false);
		dirty = true;
	}
	leaveSpot(t);
	t.on = false;
	t.home = null;
	if (t.type === 'plate') { t.items = []; t.servedTo = null; t.dirty = false; }
	if (ctx.grab.isSlotHeld(t.id)) t.ghost = true;
	else { t.held = false; move(t.id, PARKED); t.pos = PARKED.slice(); }
}
function clearThings() {
	for (const t of items) freeThing(t);
	for (const t of plates) freeThing(t);
	for (const st of stations) { st.spots = st.spots.map(() => null); st.supplyAt = 0; if (WORKERS.includes(st.model)) { showGauge(st, 0, '#22c55e'); setWorking(st, false); } }
	for (let n = 0; n < TUNING.markers; n++) move(idMarker(n), PARKED);
}
function restPose(t, st, k) {
	const p = spotAt(st, k);
	t.pos = [p[0], p[1] + (t.type === 'plate' ? PLATE_REST : ITEM_REST), p[2]];
	move(t.id, t.pos, yawQ(0));
}
function rest(t, st, k) {
	leaveSpot(t);
	st.spots[k] = t.id;
	t.at = { st: st.id, k };
	restPose(t, st, k);
}
function toFloor(t, p) {
	leaveSpot(t);
	t.pos = [p[0], (t.type === 'plate' ? PLATE_REST : ITEM_REST), p[2]];
	move(t.id, t.pos, yawQ(0));
}
/** Puts an ingredient on a plate: it becomes part of the plate, and is carried with it. */
function addToPlate(plate, item) {
	leaveSpot(item);
	item.plate = plate.id;
	item.held = false;
	plate.items.push(item.id);
	ctx.world.removeComponent(item.id, 'grabbable', false);
	ctx.world.setParent(item.id, plate.id, false);
	dirty = true;
	arrange(plate);
	SOUND.place(plate.pos);
	if (dishOf(plate)) { SOUND.ding(plate.pos); burst([plate.pos[0], plate.pos[1] + 0.15, plate.pos[2]], '#fde68a', 8); }
}
function arrange(plate) {
	const dish = dishOf(plate) || G.run.menu.find((id) => { const parts = DISHES[id].parts.slice(); return partsOn(plate).every((p) => { const at = parts.indexOf(p); if (at < 0) return false; parts.splice(at, 1); return true; }); }) || '';
	plate.items.forEach((id, index) => {
		const item = things.get(id);
		const k = keyOf(item);
		const at = (PLATED_IN[dish] && PLATED_IN[dish][k]) || (PLATED[k] && PLATED[k].at) || [0, 0.05 + index * 0.03, 0];
		pose(id, { position: at, rotation: [0, 0, 0, 1] });
		dress(item, dish);
	});
}
/** Throws away what is on a plate. */
function emptyPlate(plate) {
	for (const id of plate.items.slice()) freeThing(things.get(id));
	plate.items = [];
}

/** Whether spot k of an appliance takes the thing, and what happens there: 'rest', 'bin', 'back' (into its crate), 'swap' (a plate onto a loose ingredient) or 'serve'. */
function spotTakes(st, k, t) {
	const occupant = st.spots[k] ? things.get(st.spots[k]) : null;
	const model = st.model;
	if (model === 'bin') return k === 0 && (t.type === 'item' || t.items.length > 0) ? 'bin' : '';
	if (KINDS[st.kind].supply) return t.type === 'item' && t.stage === 'raw' && t.ing === KINDS[st.kind].supply ? 'back' : '';
	if (model === 'plant') return '';
	if (model === 'rack') return t.type === 'plate' && !t.dirty && !t.items.length && !occupant && (k === 0 || st.spots[k - 1]) ? 'rest' : '';
	if (model === 'sink') return t.type === 'plate' && t.dirty && !occupant ? 'rest' : '';
	if (model === 'table') {
		if (t.type !== 'plate' || occupant) return '';
		const guest = guests.find((g) => g.on && g.state === 'wait' && g.table === st.id && g.seat === k);
		if (guest && !t.dirty && dishOf(t) === guest.dish) return 'serve';
		return 'rest';
	}
	if (model === 'hob' || model === 'fryer' || model === 'pot') return t.type === 'item' && !occupant && PROCESS[model].rules[keyOf(t)] ? 'rest' : '';
	if (model === 'board') return t.type === 'item' && !occupant ? 'rest' : '';
	// A counter.
	if (!occupant) return 'rest';
	if (t.type === 'plate' && occupant.type === 'item' && plateTakes(t, occupant)) return 'swap';
	return '';
}
/** Where a thing at p would land if it were let go now: on a plate that takes it, or on the nearest place that does. */
function targetOf(t, p) {
	if (t.type === 'item') {
		let best = null, bestD = 0.3;
		for (const plate of plates) {
			if (!plate.on || Math.abs(plate.pos[1] - p[1]) > 0.6 || !plateTakes(plate, t)) continue;
			const d = flat(plate.pos, p);
			if (d < bestD) { best = plate; bestD = d; }
		}
		if (best) return { plate: best, at: best.pos };
	}
	let found = null, foundD = TUNING.reach, serving = false;
	for (const st of stations) {
		if (Math.abs(st.pos[0] - p[0]) > 1.4 || Math.abs(st.pos[2] - p[2]) > 1.4) continue;
		for (let k = 0; k < st.spots.length; k++) {
			const how = spotTakes(st, k, t);
			if (!how) continue;
			const at = spotAt(st, k);
			if (Math.abs(p[1] - at[1]) > 1.3) continue;
			const d = flat(at, p);
			// A guest who is waiting for this very dish comes before an empty place beside them.
			const better = how === 'serve' && !serving ? d < TUNING.reach : (how === 'serve') === serving && d < foundD;
			if (better) { found = { st, k, how, at }; foundD = d; serving = how === 'serve'; }
		}
	}
	return found;
}
function land(t, target) {
	if (target.plate) return addToPlate(target.plate, t);
	const st = target.st;
	if (target.how === 'bin') {
		SOUND.place(st.pos);
		burst([st.pos[0], 0.9, st.pos[2]], '#a8a29e', 6);
		if (t.type === 'item') return freeThing(t);
		emptyPlate(t);
		return goHome(t);
	}
	if (target.how === 'back') { SOUND.place(st.pos); return freeThing(t); }
	if (target.how === 'swap') {
		const loose = things.get(st.spots[target.k]);
		leaveSpot(loose);
		rest(t, st, target.k);
		return addToPlate(t, loose);
	}
	rest(t, st, target.k);
	SOUND.place(t.pos);
	if (target.how === 'serve') serve(st, target.k, t);
}
/** A thing nobody wanted goes back where it was taken from, or to the nearest free counter, or to the floor. */
function goHome(t) {
	const home = t.home && stationById(t.home.st);
	if (home && !KINDS[home.kind].supply && spotTakes(home, t.home.k, t) === 'rest') return rest(t, home, t.home.k);
	if (home && KINDS[home.kind].supply && t.type === 'item' && t.stage === 'raw') return freeThing(t);
	let best = null, bestD = Infinity;
	for (const st of stations) {
		if (st.model !== 'counter' && !(st.model === 'rack' && t.type === 'plate')) continue;
		for (let k = 0; k < st.spots.length; k++) {
			if (spotTakes(st, k, t) !== 'rest') continue;
			const d = flat(st.pos, t.pos);
			if (d < bestD) { best = { st, k }; bestD = d; }
			break;
		}
	}
	if (best) return rest(t, best.st, best.k);
	toFloor(t, t.pos);
}
function settle(t) {
	const target = targetOf(t, t.pos);
	if (target) return land(t, target);
	SOUND.no(t.pos);
	goHome(t);
}
/** Follows the hands: a thing that is picked up leaves its place, and one that is let go lands. */
function trackThing(t, marker) {
	const held = ctx.grab.isSlotHeld(t.id);
	if (!t.on) {
		if (t.ghost && !held) { t.ghost = false; t.held = false; move(t.id, PARKED); t.pos = PARKED.slice(); }
		return false;
	}
	if (t.type === 'item' && t.plate) return false;
	if (held) {
		if (!t.held) { t.held = true; t.home = t.at ? { st: t.at.st, k: t.at.k } : t.home; leaveSpot(t); }
		const view = ctx.hierarchy.getWorldPose(t.id);
		if (view) t.pos = view.position;
		const target = marker >= 0 ? targetOf(t, t.pos) : null;
		if (marker >= 0) move(idMarker(marker), target ? [target.at[0], target.at[1] + 0.012, target.at[2]] : PARKED, undefined, [0.34, 0.012, 0.34]);
		return true;
	}
	if (t.held) { t.held = false; settle(t); }
	return false;
}
`;

/** Chopping, cooking and washing: what the appliances do with what rests on them, and the knife. */
const WORK_SOURCE = `
function showGauge(st, amount, color) {
	const step = Math.round(clamp(amount, 0, 1) * 40);
	if (st.gauge === step && st.gaugeColor === color) return;
	st.gauge = step; st.gaugeColor = color;
	const top = SURFACE[st.model].top, h = 0.4 * (step / 40);
	show(st.id + '-gauge', step > 0);
	pose(st.id + '-fill', { position: [0.38, top + 0.16 + h / 2, 0.38], scale: step > 0 ? [0.07, h, 0.07] : TINY });
	paint(st.id + '-fill', color);
}
function setWorking(st, on) {
	if (st.working === on) return;
	st.working = on;
	field(st.id + '-fx', 'particleEmitter', 'active', on);
	if (st.model === 'hob' || st.model === 'pot') show(st.id + '-flame', on);
	if (st.model === 'pot') paint(st.id + '-soup', on ? '#ea580c' : '#6b7780');
}
const SECONDS = { hob: TUNING.cookSeconds, fryer: TUNING.frySeconds, pot: TUNING.simmerSeconds };
function tickStation(st, dt) {
	const kind = KINDS[st.kind];
	const t = st.spots[0] ? things.get(st.spots[0]) : null;
	if (kind.supply) {
		// A crate always has one to take.
		if (!t && clock >= st.supplyAt) {
			const fresh = spawnItem(kind.supply);
			if (fresh) { rest(fresh, st, 0); st.supplyAt = clock + 0.4; }
		} else if (t) st.supplyAt = clock + 0.4;
		return;
	}
	if (st.model === 'board') {
		const rule = t && t.type === 'item' && PROCESS.board.rules[keyOf(t)];
		showGauge(st, rule ? t.chops / (kind.chops || TUNING.chops) : 0, '#22c55e');
		return;
	}
	if (st.model === 'sink') {
		const busy = t && t.type === 'plate' && t.dirty;
		if (busy) {
			t.prog += dt / (TUNING.washSeconds * (kind.wash || 1));
			if ((st.washAt || 0) <= clock) { st.washAt = clock + 0.7; SOUND.wash(st.pos); }
			if (t.prog >= 1) { t.dirty = false; t.prog = 0; dressPlate(t); SOUND.ding(st.pos); burst([st.pos[0], 1.1, st.pos[2]], '#bae6fd', 10); }
		}
		showGauge(st, busy ? t.prog : 0, '#38bdf8');
		setWorking(st, !!(t && t.type === 'plate' && t.dirty));
		return;
	}
	if (!PROCESS[st.model]) return;
	if (!t || t.type !== 'item') { showGauge(st, 0, '#22c55e'); setWorking(st, false); return; }
	const next = PROCESS[st.model].rules[keyOf(t)];
	if (next) {
		t.prog += dt / (SECONDS[st.model] * (kind.cook || 1));
		showGauge(st, t.prog, '#22c55e');
		setWorking(st, true);
		if ((st.sizzleAt || 0) <= clock) { st.sizzleAt = clock + 0.9; SOUND.sizzle(st.pos); }
		if (t.prog >= 1) { t.stage = next; t.prog = 0; t.over = 0; dress(t); SOUND.ding(st.pos); burst([st.pos[0], 1.25, st.pos[2]], '#fde68a', 10); }
		return;
	}
	if (t.stage === 'burnt') { showGauge(st, 1, '#44403c'); setWorking(st, false); return; }
	if (kind.safe) { showGauge(st, 1, '#22c55e'); setWorking(st, false); return; }
	// Done, and still on the heat: it burns.
	t.over += dt;
	const f = t.over / TUNING.burnSeconds;
	showGauge(st, 1, f > 0.66 ? '#ef4444' : f > 0.33 ? '#f59e0b' : '#22c55e');
	setWorking(st, true);
	if (f > 0.5 && (st.alarmAt || 0) <= clock) { st.alarmAt = clock + (f > 0.75 ? 0.5 : 1); SOUND.alarm(st.pos); }
	if (f >= 1) { t.stage = 'burnt'; dress(t); SOUND.no(st.pos); burst([st.pos[0], 1.25, st.pos[2]], '#44403c', 16); }
}

// The knives: one to a chopping board. A cut is a pull of the trigger near a board, or the blade brought down on it.
const knives = Array.from({ length: MODELS.board }, (_, n) => ({ id: idKnife(n), n, on: false, held: false, pulls: 0, y: 0, cool: 0 }));
function knifeHome(st) {
	const knife = knives[st.entry.n];
	knife.on = true;
	if (knife.held) return;
	move(knife.id, inCell(st, KNIFE.at[0], KNIFE.at[1], KNIFE.at[2]), yawQ((st.turn * Math.PI) / 2));
}
function parkKnife(n) { knives[n].on = false; park(knives[n].id); }
function boardNear(p, range) {
	let best = null, bestD = range;
	for (const st of stations) {
		if (st.model !== 'board') continue;
		const t = st.spots[0] ? things.get(st.spots[0]) : null;
		if (!t || t.type !== 'item' || !PROCESS.board.rules[keyOf(t)]) continue;
		const d = flat(spotAt(st, 0), p);
		if (d < bestD) { best = st; bestD = d; }
	}
	return best;
}
function chop(st) {
	const t = things.get(st.spots[0]);
	const need = KINDS[st.kind].chops || TUNING.chops;
	t.chops += 1;
	SOUND.chop(t.pos);
	burst([t.pos[0], t.pos[1] + 0.06, t.pos[2]], (lookOf(t).ball || lookOf(t).discA || { color: '#ffffff' }).color, 6);
	if (t.chops >= need) { t.stage = PROCESS.board.rules[keyOf(t)]; t.chops = 0; dress(t); SOUND.ding(t.pos); }
}
function tickKnife(knife, dt) {
	const held = ctx.grab.isSlotHeld(knife.id);
	const state = ctx.hierarchy.getSlot(knife.id).components.find((c) => c.type === 'scriptState');
	const pulls = (state && state.data && state.data.n) || 0;
	knife.cool -= dt;
	if (held) {
		const view = ctx.hierarchy.getWorldPose(knife.id);
		if (!view) return;
		const blade = [view.position[0] + view.forward[0] * KNIFE.blade, view.position[1] + view.forward[1] * KNIFE.blade, view.position[2] + view.forward[2] * KNIFE.blade];
		if (G.phase === 'service') {
			if (pulls !== knife.pulls) { const st = boardNear(blade, 1.1); if (st) chop(st); else SOUND.no(blade); }
			else if (knife.held && knife.cool <= 0) {
				// Brought down through the food: from a hand's width above the board to the board.
				const st = boardNear(blade, 0.42);
				const line = st ? SURFACE.board.top + 0.17 : 0;
				if (st && knife.y > line && blade[1] <= line && (knife.y - blade[1]) / Math.max(dt, 0.001) > 0.35) { chop(st); knife.cool = 0.16; }
			}
		}
		knife.y = blade[1];
		knife.held = true;
	} else if (knife.held) {
		knife.held = false;
		const st = stations.find((s) => s.model === 'board' && s.entry.n === knife.n);
		if (st && knife.on) knifeHome(st);
	}
	knife.pulls = pulls;
}
`;

/** The guests: they come in from the street, sit, ask, wait, eat, pay and go; a guest who waits too long takes a heart with them. */
const GUESTS_SOURCE = `
const guests = Array.from({ length: TUNING.guests }, (_, i) => ({ id: idGuest(i), i, on: false, state: 'idle', path: [], pos: PARKED.slice(), yaw: 0, table: '', seat: 0, dish: '', patience: 0, max: 1, eat: 0, step: -1, bob: 0 }));
const seatTaken = (st, k) => guests.some((g) => g.on && g.table === st.id && g.seat === k);
const STREET = [1.5, 0, HALL.d + 1.25];
const entryCell = () => [HALL.w / 2 - 1 + (rand() < 0.5 ? 0 : 1), HALL.d - 1];
/** The seats a guest could take now: free, with a clean place, and a way to walk to them from the street door. */
function freeSeats() {
	const floor = guestFloor();
	const open = [];
	for (const st of stations) {
		if (st.model !== 'table') continue;
		for (let k = 0; k < 2; k++) {
			if (seatTaken(st, k) || st.spots[k]) continue;
			const cell = seatCell(st, k);
			if (!cellFree(cell[0], cell[1], null)) continue;
			const way = findPath(floor, [HALL.w / 2 - 1, HALL.d - 1], cell, HALL.d);
			if (way) open.push({ st, k, cell });
		}
	}
	return open;
}
function placeGuest(g, y) { move(g.id, [g.pos[0], y || 0, g.pos[2]], yawQ(g.yaw)); }
function showOrder(g) {
	const dish = DISHES[g.dish];
	show(g.id + '-bubble', true);
	// The card keeps facing the kitchen, whichever way the guest sits.
	pose(g.id + '-bubble', { rotation: yawQ(-g.yaw) });
	label(g.id + '-bubble-name', dish.name);
	for (let i = 0; i < 3; i++) {
		const part = dish.parts[i];
		const look = part ? LOOKS[part] : null;
		const shape = look ? look.ball || look.discA || look.stickA : null;
		if (shape) paint(g.id + '-bubble-chip-' + i, shape.color);
		const offset = (i - (dish.parts.length - 1) / 2) * 0.2;
		pose(g.id + '-bubble-chip-' + i, { position: [offset, -0.06, 0], scale: shape ? [0.13, look.ball ? 0.11 : 0.06, 0.1] : TINY });
	}
	g.step = -1;
}
const hideOrder = (g) => show(g.id + '-bubble', false);
function freeGuest(g) {
	g.on = false; g.state = 'idle'; g.table = ''; g.path = [];
	hideOrder(g);
	move(g.id, PARKED);
}
function patienceFor(st) {
	let seconds = Math.max(TUNING.patienceMin, TUNING.patience - TUNING.patiencePerDay * (G.run.day - 1));
	for (const id of G.run.mods) seconds *= MODIFIERS[id].patience;
	if (stations.some((s) => s.model === 'plant' && flat(s.pos, st.pos) <= TUNING.plantReach)) seconds *= TUNING.plantBonus;
	return seconds;
}
/** Brings in one guest, or two to the same table. Returns how many came. */
function spawnGuests(want) {
	const open = freeSeats();
	if (!open.length || !G.run.menu.length) return 0;
	const first = pick(open);
	const mate = open.find((o) => o.st === first.st && o.k !== first.k);
	const group = want >= 2 && mate && rand() < 0.4 ? [first, mate] : [first];
	const idle = guests.filter((g) => !g.on);
	if (idle.length < group.length) return 0;
	const floor = guestFloor();
	group.forEach((o, index) => {
		const g = idle[index];
		const from = entryCell();
		const way = findPath(floor, from, o.cell, HALL.d) || [];
		const seat = seatAt(o.st, o.k);
		const side = index ? -1 : 1;
		g.path = [[side * 0.35, 0, HALL.d + 1.2], [side * 0.3, 0, HALL.d + 0.1], cellAt(from[0], from[1])].concat(way.map((c) => cellAt(c[0], c[1])), [seat]);
		const patience = patienceFor(o.st);
		Object.assign(g, { on: true, state: 'in', table: o.st.id, seat: o.k, dish: pick(G.run.menu), patience, max: patience, eat: 0, pos: [side * STREET[0], 0, STREET[2]], yaw: Math.PI, bob: rand() * 6 });
		hideOrder(g);
		placeGuest(g);
	});
	SOUND.bell([0, 2.3, HALL.d - 0.2]);
	return group.length;
}
function walk(g, dt) {
	let step = TUNING.walkSpeed * dt;
	while (g.path.length && step > 0) {
		const goal = g.path[0];
		const dx = goal[0] - g.pos[0], dz = goal[2] - g.pos[2];
		const dist = Math.hypot(dx, dz);
		if (dist > 0.001) g.yaw = Math.atan2(dx, dz);
		if (dist <= step) { g.pos = [goal[0], 0, goal[2]]; g.path.shift(); step -= dist; }
		else { g.pos = [g.pos[0] + (dx / dist) * step, 0, g.pos[2] + (dz / dist) * step]; step = 0; }
	}
	g.bob += dt * 9;
	placeGuest(g, Math.abs(Math.sin(g.bob)) * 0.035);
	return g.path.length === 0;
}
function sendAway(g) {
	const st = stationById(g.table);
	hideOrder(g);
	const cell = st ? seatCell(st, g.seat) : cellOf(g.pos);
	const exit = [HALL.w / 2 - 1 + (g.i % 2), HALL.d - 1];
	const way = (G.layout && findPath(guestFloor(), cell, exit, HALL.d)) || [];
	g.path = [cellAt(cell[0], cell[1])].concat(way.map((c) => cellAt(c[0], c[1])), [[(g.i % 2 ? 0.3 : -0.3), 0, HALL.d + 0.1], [(g.i % 2 ? 1.6 : -1.6), 0, HALL.d + 1.3]]);
	g.state = 'out';
	g.table = '';
}
function tickGuest(g, dt) {
	if (g.state === 'in') {
		if (!walk(g, dt)) return;
		const st = stationById(g.table);
		if (!st) return sendAway(g);
		g.state = 'wait';
		g.pos = seatAt(st, g.seat);
		g.yaw = Math.atan2(st.pos[0] - g.pos[0], st.pos[2] - g.pos[2]);
		// Sitting: the body drops by the height of the chair, and the legs are under the table.
		placeGuest(g, -(0.8 - SEAT.height));
		showOrder(g);
		sound([g.pos[0], 1.5, g.pos[2]], 880, 0.25, 140);
		return;
	}
	if (g.state === 'wait') {
		g.patience -= dt;
		const f = clamp(g.patience / g.max, 0, 1);
		const step = Math.round(f * 28);
		if (step !== g.step) {
			g.step = step;
			pose(g.id + '-bubble-bar', { position: [-0.28 * (1 - f), -0.165, 0], scale: [Math.max(0.004, 0.56 * f), 0.036, 0.04] });
			paint(g.id + '-bubble-bar', f > 0.5 ? '#22c55e' : f > 0.25 ? '#f59e0b' : '#ef4444');
		}
		if (g.patience <= 0) {
			SOUND.angry([g.pos[0], 1.5, g.pos[2]]);
			burst([g.pos[0], 1.7, g.pos[2]], '#ef4444', 14);
			sendAway(g);
			loseHeart();
		}
		return;
	}
	if (g.state === 'eat') {
		g.eat -= dt;
		if (g.eat > 0) return;
		const plate = plates.find((p) => p.on && p.servedTo === g.id);
		if (plate) { emptyPlate(plate); plate.servedTo = null; plate.dirty = true; plate.prog = 0; dressPlate(plate); }
		sendAway(g);
		return;
	}
	if (g.state === 'out' && walk(g, dt)) freeGuest(g);
}
function priceOf(dish) {
	let price = DISHES[dish].price;
	for (const id of G.run.mods) price *= MODIFIERS[id].price;
	return price;
}
/** The plate has just been put in front of the guest who ordered it. */
function serve(st, k, plate) {
	const g = guests.find((x) => x.on && x.state === 'wait' && x.table === st.id && x.seat === k);
	if (!g) return;
	const price = priceOf(g.dish);
	const tip = price * TUNING.tipRate * clamp(g.patience / g.max, 0, 1);
	const paid = Math.round(price + tip);
	G.run.coins += paid;
	G.run.served += 1;
	G.day.served += 1;
	G.day.earned += paid;
	g.state = 'eat';
	g.eat = TUNING.eatSeconds;
	plate.servedTo = g.id;
	hideOrder(g);
	SOUND.coin([plate.pos[0], 1.2, plate.pos[2]]);
	burst([plate.pos[0], 1.15, plate.pos[2]], '#facc15', 16);
}
function showHearts() { for (let n = 0; n < TUNING.hearts; n++) paint(idHeart(n), G.run && n < G.run.hearts ? '#dc2626' : '#3f3f46'); }
function loseHeart() {
	G.day.lost += 1;
	G.run.hearts -= 1;
	showHearts();
	if (G.run.hearts <= 0) later(0.6, gameOver);
}
`;

/** A run: its days, the shop between them, the cards, and what is kept when it ends. */
const FLOW_SOURCE = `
const dishKinds = (dish) => DISHES[dish].needs.map((model) => KIND_IDS.find((kind) => KINDS[kind].model === model && !KINDS[kind].upgrade));
/** What a restaurant that starts with a dish is given, in the order its kitchen is laid out. */
const starterKinds = (dish) => dishKinds(dish).concat(STARTER_KIT);
const ownerLevel = () => (G.owner ? levelOf(profileOf(G.owner).xp) : 1);
const menuCan = (dish) => DISHES[dish].needs.every(hasModel);
const cookable = () => G.run.menu.filter(menuCan);
const missing = () => MUST_HAVE.filter((model) => !hasModel(model)).map((model) => KINDS[KIND_IDS.find((kind) => KINDS[kind].model === model)].name);
function note(screen, message, seconds) { G.note[screen] = { message, until: clock + (seconds || 7) }; renderAll(); }
const noted = (screen, fallback) => (G.note[screen] && clock < G.note[screen].until ? G.note[screen].message : fallback);

function saveRun() {
	if (!G.owner || !G.run) return;
	const run = G.run;
	profileOf(G.owner).run = { seed: run.seed, size: run.size, menu: run.menu.slice(), day: run.day, coins: run.coins, hearts: run.hearts, plates: run.plates, mods: run.mods.slice(), reroll: run.reroll, cards: run.cards, served: run.served, stations: layoutNow(), layout: { name: G.layout.name, kitchen: G.layout.kitchen, gaps: G.layout.gaps.slice() } };
	saveProfile(G.owner);
	G.saveAt = 0;
}
const saveSoon = () => { if (!G.saveAt) G.saveAt = clock + 2.5; };

function openHall(owner, run, layout, placements) {
	for (const st of stations.slice()) removeStation(st);
	G.owner = owner; G.run = run; G.layout = layout; G.crew = []; G.offers = []; G.card = null; G.note = {};
	G.phase = 'prep';
	dressHall();
	for (const s of placements) if (cellFree(s.gx, s.gz, null)) placeStation(s.kind, s.gx, s.gz, s.turn);
	label(IDS.openSign, 'CLOSED');
	paint(IDS.openSign, '#7f1d1d'); field(IDS.openSign, 'textDisplay', 'color', '#7f1d1d');
	showHearts();
	beginPrep();
	SOUND.win([0, 1.6, -1]);
}
/** A new restaurant for a player: the place, the size and the first dish they chose in the lobby. */
function startRun(owner, cfg) {
	const size = SIZE_IDS[cfg.size], dish = STARTERS[cfg.dish];
	const made = generateLayout(cfg.seed, SIZES[size], starterKinds(dish), HALL.w, HALL.d);
	const level = levelOf(profileOf(owner).xp);
	const run = { seed: cfg.seed, size, menu: [dish], day: 1, coins: TUNING.startCoins + (level >= LEVEL_XP.length ? TUNING.masterBonus : 0), hearts: TUNING.hearts, plates: TUNING.plates, mods: [], reroll: TUNING.rerollCost, cards: 0, served: 0 };
	profileOf(owner).stats.runs += 1;
	openHall(owner, run, made, made.stations);
	saveRun();
}
/** The restaurant a player left open, as they left it. */
function resumeRun(owner) {
	const saved = profileOf(owner).run;
	if (!saved) return false;
	const width = SIZES[saved.size];
	const x0 = Math.floor((HALL.w - width) / 2);
	const layout = { seed: saved.seed, name: saved.layout.name, w: width, x0, x1: x0 + width - 1, kitchen: saved.layout.kitchen, gaps: saved.layout.gaps.filter((g) => g > x0 && g < x0 + width - 1), stations: [] };
	if (!layout.gaps.length) layout.gaps = [x0 + 1];
	const run = { seed: saved.seed, size: saved.size, menu: saved.menu.slice(), day: saved.day, coins: saved.coins, hearts: saved.hearts, plates: saved.plates, mods: saved.mods.slice(), reroll: saved.reroll, cards: saved.cards, served: saved.served };
	openHall(owner, run, layout, saved.stations);
	return true;
}
/** Shuts the restaurant: everybody inside is put back in the lobby, and the hall is emptied. */
function closeHall() {
	for (const g of guests) if (g.on) freeGuest(g);
	clearThings();
	for (const st of stations.slice()) removeStation(st);
	for (const knife of knives) parkKnife(knife.n);
	clearHall();
	heads.filter((h) => inHall(h.pos)).forEach((h, i) => ctx.world.teleportPlayer(h.id, { position: [-1.5 + (i % 4), 0, -3.2 - Math.floor(i / 4)], yaw: Math.PI }));
	G.phase = 'idle'; G.owner = null; G.run = null; G.layout = null; G.crew = []; G.day = null; G.offers = []; G.card = null;
}

function beginPrep() {
	G.phase = 'prep';
	G.day = null;
	G.crew = [];
	for (const g of guests) if (g.on) freeGuest(g);
	clearThings();
	for (const st of stations) setCarried(st, true);
	label(IDS.openSign, 'CLOSED');
	field(IDS.openSign, 'textDisplay', 'color', '#7f1d1d'); paint(IDS.openSign, '#7f1d1d');
	// A card is due before the fourth day, the seventh, and so on.
	const due = Math.floor((G.run.day - 1) / TUNING.cardEvery);
	G.card = G.run.cards < due ? dealCards() : null;
	G.offers = rollOffers();
}
function guestsToday() {
	let n = TUNING.guestsBase + TUNING.guestsPerDay * (G.run.day - 1) + TUNING.guestsPerCook * (Math.max(1, G.crew.length) - 1);
	for (const id of G.run.mods) n *= MODIFIERS[id].guests;
	return Math.round(n);
}
function beginService() {
	refreshPlayers();
	G.crew = heads.filter((h) => inHall(h.pos)).map((h) => h.id);
	if (!G.crew.length && G.owner) G.crew = [G.owner];
	saveRun();
	clearThings();
	for (const st of stations) setCarried(st, false);
	// The plates wait in the racks.
	const racks = stations.filter((st) => st.model === 'rack');
	for (let i = 0; i < G.run.plates && racks.length; i++) {
		const plate = spawnPlate();
		const st = racks[i % racks.length];
		const k = st.spots.indexOf(null);
		if (plate && k >= 0) rest(plate, st, k);
	}
	G.phase = 'service';
	G.day = { left: guestsToday(), total: 0, nextAt: clock + 2.5, served: 0, lost: 0, earned: 0, t: 0 };
	G.day.total = G.day.left;
	label(IDS.openSign, 'OPEN');
	field(IDS.openSign, 'textDisplay', 'color', '#14532d'); paint(IDS.openSign, '#14532d');
	SOUND.bell([0, 2.3, HALL.d - 0.2]);
}
function tickService(dt) {
	const day = G.day;
	day.t += dt;
	if (day.left > 0 && clock >= day.nextAt) {
		const came = spawnGuests(day.left);
		day.left -= came;
		const gap = Math.max(TUNING.arrivalGapMin, TUNING.arrivalGap - 0.5 * (G.run.day - 1)) / (0.7 + 0.3 * Math.max(1, G.crew.length));
		day.nextAt = clock + (came ? gap * (0.75 + 0.5 * rand()) * came : 1.5);
	}
	if (day.left <= 0 && !guests.some((g) => g.on) && G.run.hearts > 0) endDay();
}
/** The last guest has gone: the cooks are paid in experience, and the restaurant closes until the next day. */
function endDay() {
	const day = G.day;
	const cooks = party();
	const gain = TUNING.xpPerDay + TUNING.xpPerDish * day.served;
	const lines = [];
	for (const id of cooks) {
		const profile = profileOf(id);
		const before = levelOf(profile.xp);
		profile.xp += gain;
		profile.stats.days += 1;
		profile.stats.served += day.served;
		profile.stats.bestDay = Math.max(profile.stats.bestDay, G.run.day);
		const after = levelOf(profile.xp);
		if (after > before) lines.push(nameOf(id) + ' is now level ' + after + ': ' + LEVEL_UNLOCKS[after - 1]);
		if (id !== G.owner) saveProfile(id);
		submitScores(id);
	}
	const summary = 'Day ' + G.run.day + ' done! ' + day.served + ' served, ' + day.lost + ' lost, ' + money(day.earned) + ' taken. Each cook: +' + gain + ' xp.' + (lines.length ? '\\n' + lines.join('\\n') : '');
	G.run.day += 1;
	beginPrep();
	saveRun();
	note('service', summary + '\\nBuy blueprints, move your kitchen, then open again.', 30);
	SOUND.win([0, 1.6, 2]);
}
function submitScores(id) {
	if (!ctx.leaderboards || !ctx.leaderboards.available) return;
	const profile = profileOf(id), who = { id, name: nameOf(id) };
	Promise.all([ctx.leaderboards.submit(BOARDS.bestDay, who, profile.stats.bestDay, { order: 'high' }), ctx.leaderboards.submit(BOARDS.served, who, profile.stats.served, { order: 'high' })]).then(showBoards).catch(() => {});
}
function showBoards() {
	if (!ctx.leaderboards || !ctx.leaderboards.available) return;
	Promise.resolve(ctx.leaderboards.showOn(UI.boardDay, BOARDS.bestDay, { limit: 5 })).catch(() => {});
	Promise.resolve(ctx.leaderboards.showOn(UI.boardServed, BOARDS.served, { limit: 5 })).catch(() => {});
}
/** The third guest has left unserved: the run is over. What the cooks earned on the days before is theirs. */
function gameOver() {
	if (G.phase !== 'service') return;
	const day = G.day;
	G.phase = 'over';
	G.overAt = clock + 45;
	for (const g of guests) if (g.on && g.state !== 'out') sendAway(g);
	for (const id of party()) {
		const profile = profileOf(id);
		profile.xp += TUNING.xpPerDish * day.served;
		profile.stats.served += day.served;
		profile.stats.bestDay = Math.max(profile.stats.bestDay, G.run.day);
		if (id !== G.owner) saveProfile(id);
		submitScores(id);
	}
	if (G.owner) { profileOf(G.owner).run = null; saveProfile(G.owner); }
	label(IDS.openSign, 'CLOSED');
	field(IDS.openSign, 'textDisplay', 'color', '#7f1d1d'); paint(IDS.openSign, '#7f1d1d');
	note('service', G.layout.name + ' closes its doors on day ' + G.run.day + '.\\n' + G.run.served + ' dishes served in all.\\nA new restaurant waits in the lobby.', 60);
	SOUND.lose([0, 1.6, 2]);
}

// --- the shop ------------------------------------------------------------------------------------------------------------------
const dishNeeds = (dish, model) => DISHES[dish].needs.includes(model);
/** Whether the shop can offer a kind: the owner's level allows it, a dish on the menu uses it (if any dish does), and one is left. */
const kindOffered = (kind) => {
	const k = KINDS[kind];
	if (k.level > ownerLevel()) return false;
	if (DISH_IDS.some((dish) => dishNeeds(dish, k.model)) && !G.run.menu.some((dish) => dishNeeds(dish, k.model))) return false;
	return pool[k.model].some((e) => !e.on);
};
function rollOffers() {
	const kinds = KIND_IDS.filter(kindOffered);
	const offers = [];
	const staple = STAPLES.filter((kind) => kinds.includes(kind));
	if (staple.length) offers.push({ kind: pick(staple) });
	const rest = shuffled(kinds.filter((kind) => !offers.some((o) => o.kind === kind)));
	const extras = [];
	if (G.run.plates < TUNING.platesMax) extras.push({ extra: 'plates' });
	if (G.run.hearts < TUNING.hearts) extras.push({ extra: 'heart' });
	const mixed = shuffled(rest.map((kind) => ({ kind })).concat(extras));
	while (offers.length < TUNING.offers && mixed.length) offers.push(mixed.shift());
	return offers.map((o) => Object.assign(o, { price: o.kind ? KINDS[o.kind].price : EXTRAS[o.extra].price, sold: false }));
}
/** The first free cell from the door to the lobby outwards: where a delivery is put down. */
function deliveryCell() {
	const L = G.layout;
	let best = null, bestD = Infinity;
	for (let gz = 0; gz < HALL.d - 1; gz++) for (let gx = L.x0; gx <= L.x1; gx++) {
		if (!cellFree(gx, gz, null) || stationAt(gx, gz) || (gz <= 1 && doorColumns().includes(gx))) continue;
		const d = Math.abs(gx + 0.5 - HALL.w / 2) + gz * 1.5;
		if (d < bestD) { best = [gx, gz]; bestD = d; }
	}
	return best;
}
function deliver(kind) {
	const cell = deliveryCell();
	if (!cell) return null;
	const st = placeStation(kind, cell[0], cell[1], 0);
	if (st) { SOUND.build(st.pos); burst([st.pos[0], 1.2, st.pos[2]], '#fde68a', 14); }
	return st;
}
function buy(index) {
	const offer = G.offers[index];
	if (G.phase !== 'prep' || !offer || offer.sold) return;
	if (G.run.coins < offer.price) return note('shop', 'Not enough coins: ' + money(offer.price - G.run.coins) + ' short.');
	if (offer.kind) {
		if (!deliver(offer.kind)) return note('shop', 'There is no room: sell something in the bin, or move things closer together.');
		note('shop', KINDS[offer.kind].name + ' delivered by the door. Carry it to its place.');
	} else if (offer.extra === 'plates') { G.run.plates = Math.min(TUNING.platesMax, G.run.plates + 2); note('shop', 'Two more plates in the rack.'); }
	else if (offer.extra === 'heart') { G.run.hearts = Math.min(TUNING.hearts, G.run.hearts + 1); showHearts(); note('shop', 'One more heart.'); }
	G.run.coins -= offer.price;
	offer.sold = true;
	saveSoon();
}
function reroll() {
	if (G.phase !== 'prep' || G.card) return;
	if (G.run.coins < G.run.reroll) return note('shop', 'A new set of blueprints costs ' + money(G.run.reroll) + '.');
	G.run.coins -= G.run.reroll;
	G.run.reroll += TUNING.rerollStep;
	G.offers = rollOffers();
	SOUND.build([-2, 1.6, 0.3]);
	saveSoon();
}
/** Two cards: a new dish when there is one to learn, and a change to the guests. */
function dealCards() {
	const level = ownerLevel();
	const dishes = shuffled(DISH_IDS.filter((id) => !G.run.menu.includes(id) && DISHES[id].level <= level && (!DISHES[id].after || G.run.menu.includes(DISHES[id].after))));
	const mods = shuffled(Object.keys(MODIFIERS).filter((id) => !G.run.mods.includes(id)));
	const cards = [];
	if (dishes.length) cards.push({ dish: dishes[0] });
	for (const id of mods) if (cards.length < 2) cards.push({ mod: id });
	if (cards.length < 2 && dishes.length > 1) cards.push({ dish: dishes[1] });
	return cards.length ? cards : null;
}
function takeCard(index) {
	const card = G.card && G.card[index];
	if (G.phase !== 'prep' || !card) return;
	if (card.dish) {
		G.run.menu.push(card.dish);
		// What the dish needs and the kitchen does not have comes with it.
		for (const kind of dishKinds(card.dish)) if (!hasModel(KINDS[kind].model)) deliver(kind);
		note('shop', DISHES[card.dish].name + ' is on the menu. What it needs is by the door.', 10);
	} else { G.run.mods.push(card.mod); note('shop', MODIFIERS[card.mod].name + ': ' + MODIFIERS[card.mod].info + '.', 10); }
	G.run.cards += 1;
	G.card = null;
	G.offers = rollOffers();
	SOUND.win([-2, 1.6, 0.3]);
	saveSoon();
}

// --- moving the kitchen about ----------------------------------------------------------------------------------------------------
/** An appliance was let go: it settles in the cell it is over if that is free, is sold if that is the bin, or goes back. */
function settleStation(st) {
	const cell = cellOf(st.pos);
	const there = stationAt(cell[0], cell[1]);
	if (there && there !== st && there.model === 'bin' && st.model !== 'bin') {
		const refund = Math.floor(KINDS[st.kind].price * TUNING.sellRefund);
		G.run.coins += refund;
		note('shop', KINDS[st.kind].name + ' sold for ' + money(refund) + '.');
		SOUND.coin(there.pos);
		removeStation(st);
		return saveSoon();
	}
	if (cellFree(cell[0], cell[1], st)) { st.gx = cell[0]; st.gz = cell[1]; st.turn = ((Math.round((st.heldYaw || 0) / (Math.PI / 2)) % 4) + 4) % 4; SOUND.place(st.pos); }
	else SOUND.no(st.pos);
	standStation(st);
	saveSoon();
}
function trackStation(st, marker) {
	const held = st.carried && ctx.grab.isSlotHeld(st.id);
	if (held) {
		st.held = true;
		const view = ctx.hierarchy.getWorldPose(st.id);
		if (view) { st.pos = view.position; st.heldYaw = Math.atan2(view.forward[0], view.forward[2]); }
		const cell = cellOf(st.pos);
		const ok = cellFree(cell[0], cell[1], st) || (stationAt(cell[0], cell[1]) || {}).model === 'bin';
		if (marker >= 0) move(idMarker(marker), ok ? [HALL.minX + cell[0] + 0.5, 0.02, cell[1] + 0.5] : PARKED, undefined, [0.92, 0.012, 0.92]);
		return true;
	}
	if (st.held) { st.held = false; settleStation(st); }
	return false;
}
`;

/** The screens: what each says to the player in front of it, and what its buttons do. */
const SCREENS_SOURCE = `
const playerOf = (event) => { const who = ctx.world.getPlayer(event.remoteGuestId ? event.remoteGuestId + ':right' : 'right'); return { id: who.id, name: who.name }; };
const seedName = (seed) => 'No. ' + String(seed % 10000).padStart(4, '0');
const PLAN = { off: '#0d0b09', kitchen: '#3d444b', dining: '#6b4a2b', door: '#f2c14e', counter: '#e9dfc8', table: '#b3261e', rack: '#f5f5f2', sink: '#38bdf8', bin: '#163a2b', board: '#e0bb85', hob: '#24262b', fryer: '#d9a521', pot: '#9aa1a9', crate_lettuce: '#4d9a2a', crate_tomato: '#dc2626', crate_potato: '#a16207', crate_patty: '#f4a7b3', crate_bun: '#d9a05b', plant: '#3f8f3a' };
let previewKey = '', preview = null;
function previewLayout() {
	const size = SIZE_IDS[G.cfg.size], dish = STARTERS[G.cfg.dish];
	const k = G.cfg.seed + '|' + size + '|' + dish;
	if (k !== previewKey) { previewKey = k; preview = generateLayout(G.cfg.seed, SIZES[size], starterKinds(dish), HALL.w, HALL.d); }
	return preview;
}
function renderPlan(layout, placed) {
	for (let gz = 0; gz < HALL.d; gz++) for (let gx = 0; gx < HALL.w; gx++) {
		let color = PLAN.off;
		if (gx >= layout.x0 && gx <= layout.x1) {
			const s = placed.find((p) => p.gx === gx && p.gz === gz);
			color = s ? PLAN[KINDS[s.kind].model] : isThreshold(gx, gz) ? PLAN.door : gz < layout.kitchen ? PLAN.kitchen : PLAN.dining;
		}
		uiFill(uiPlanCell(gx, gz), color);
	}
}
function renderSetup() {
	const viewer = nearest(-3.45, -0.6, 4.5);
	const level = viewer ? levelOf(profileOf(viewer).xp) : 1;
	const saved = viewer ? profileOf(viewer).run : null;
	const size = SIZE_IDS[G.cfg.size], dish = STARTERS[G.cfg.dish];
	if (G.phase === 'idle') {
		const layout = previewLayout();
		uiText(UI.setupStatus, noted('setup', 'Choose a place, how big it is and what it cooks.\\nEverybody who walks into the kitchen cooks with you.'));
		uiText(UI.setupSeed, layout.name + '  (' + seedName(G.cfg.seed) + ')');
		uiText(UI.setupSize, SIZE_NAMES[size] + ', ' + SIZES[size] + ' cells wide' + (level < SIZE_LEVEL[size] ? '  [level ' + SIZE_LEVEL[size] + ']' : ''));
		uiText(UI.setupDish, 'Starts with ' + DISHES[dish].name + (level < DISHES[dish].level ? '  [level ' + DISHES[dish].level + ']' : ''));
		renderPlan(layout, layout.stations);
		uiText(UI.start, saved && G.confirm[viewer] && clock < G.confirm[viewer] ? 'SURE? PRESS AGAIN' : 'NEW RESTAURANT');
		uiShow(UI.resume, !!saved);
		uiText(UI.resume, saved ? 'CONTINUE (DAY ' + saved.day + ')' : 'CONTINUE');
	} else {
		uiText(UI.setupStatus, noted('setup', nameOf(G.owner) + ' runs ' + G.layout.name + ', day ' + G.run.day + '.\\nWalk through the kitchen door to cook with them.'));
		uiText(UI.setupSeed, G.layout.name + '  (' + seedName(G.run.seed) + ')');
		uiText(UI.setupSize, SIZE_NAMES[G.run.size] + ', ' + G.layout.w + ' cells wide');
		uiText(UI.setupDish, 'Menu: ' + G.run.menu.map((id) => DISHES[id].name).join(', '));
		renderPlan(G.layout, stations);
		uiText(UI.start, 'RESTAURANT OPEN');
		uiShow(UI.resume, false);
	}
}
function renderCard() {
	const viewer = nearest(3.45, -0.6, 4.5);
	const lines = Array(8).fill('');
	if (!viewer) lines[0] = 'Step up to see your card';
	else {
		const p = profileOf(viewer), level = levelOf(p.xp), next = LEVEL_XP[level];
		lines[0] = nameOf(viewer);
		lines[1] = 'Chef level ' + level + (next === undefined ? '  (master)' : '   ' + p.xp + ' / ' + next + ' xp');
		lines[2] = next === undefined ? 'Nothing left to unlock.' : 'Next: ' + LEVEL_UNLOCKS[level];
		lines[3] = 'Restaurants opened: ' + p.stats.runs;
		lines[4] = 'Days of service: ' + p.stats.days;
		lines[5] = 'Dishes served: ' + p.stats.served;
		lines[6] = 'Longest run: day ' + p.stats.bestDay;
		lines[7] = p.run ? 'Open restaurant: ' + p.run.layout.name + ', day ' + p.run.day : ctx.storage && ctx.storage.available ? 'Saved to your account.' : 'Not signed in: kept for this visit only.';
	}
	lines.forEach((value, i) => uiText(uiCardLine(i), value));
}
function renderTrack() {
	const viewer = nearest(-5.9, -3.3, 4.5);
	const level = viewer ? levelOf(profileOf(viewer).xp) : 0;
	LEVEL_UNLOCKS.forEach((unlock, i) => {
		uiText(uiTrackLine(i), (i < level ? '[x] ' : '[  ] ') + 'Level ' + (i + 1) + (LEVEL_XP[i] ? ' (' + LEVEL_XP[i] + ' xp)' : '') + '\\n      ' + unlock);
		uiInk(uiTrackLine(i), i < level ? '#fde68a' : '#b5a995');
	});
}
function ordersLine() {
	const waiting = guests.filter((g) => g.on && g.state === 'wait').sort((a, b) => a.patience - b.patience).slice(0, 4);
	if (!waiting.length) return G.day && G.day.left > 0 ? 'Guests are on their way...' : 'Nobody is waiting.';
	// No seconds here: a text that changes sends the whole world to the guests, and the bars over the heads already count down.
	return waiting.map((g) => 'T' + (stationById(g.table) || { number: '?' }).number + ' ' + DISHES[g.dish].name + (g.patience < g.max * 0.3 ? ' !!' : '')).join('     ');
}
function renderHud() {
	if (!G.run) return;
	const run = G.run;
	if (G.phase === 'prep') {
		uiText(UI.hudTitle, G.layout.name.toUpperCase() + '   DAY ' + run.day + '   CLOSED');
		uiText(UI.hudStats, money(run.coins) + '      Menu: ' + run.menu.map((id) => DISHES[id].name + ' ' + Math.round(priceOf(id))).join(', '));
		const need = missing(), cannot = run.menu.filter((id) => !menuCan(id));
		uiText(UI.hudOrders, need.length ? 'Missing: ' + need.join(', ') : cannot.length ? DISHES[cannot[0]].name + ' needs: ' + DISHES[cannot[0]].needs.filter((m) => !hasModel(m)).map((m) => KINDS[KIND_IDS.find((kind) => KINDS[kind].model === m)].name).join(', ') : G.card ? 'Choose a card at the blueprint board.' : 'Carry appliances by their yellow knob. Open when you are ready.');
	} else if (G.phase === 'service') {
		uiText(UI.hudTitle, 'DAY ' + run.day + '   OPEN');
		uiText(UI.hudStats, money(run.coins) + '      Served ' + G.day.served + ' of ' + G.day.total + '      Still to come ' + G.day.left);
		uiText(UI.hudOrders, ordersLine());
	} else {
		uiText(UI.hudTitle, 'CLOSED FOR GOOD');
		uiText(UI.hudStats, 'Reached day ' + run.day + '      ' + run.served + ' dishes served');
		uiText(UI.hudOrders, 'Thank you for cooking.');
	}
}
function renderService() {
	if (G.phase === 'idle') {
		uiText(UI.serviceTitle, 'SERVICE');
		uiText(UI.serviceMessage, 'No restaurant is open.\\nChoose one in the lobby.');
		uiShow(UI.open, false); uiShow(UI.close, false);
		return;
	}
	const run = G.run;
	if (G.phase === 'prep') {
		const need = missing();
		const fallback = 'Day ' + run.day + ' of ' + G.layout.name + '.\\n' + (run.day === 1 ? 'Take a look at your kitchen, then open the doors. ' : '') + guestsHint() + (need.length ? '\\nYou cannot open without: ' + need.join(', ') + '.' : '') + (G.card ? '\\nA card is waiting at the blueprint board.' : '');
		uiText(UI.serviceTitle, 'DAY ' + run.day);
		uiText(UI.serviceMessage, noted('service', fallback));
		uiShow(UI.open, true); uiText(UI.open, 'OPEN FOR BUSINESS'); uiFill(UI.open, need.length || G.card || !cookable().length ? '#57534e' : '#15803d');
		uiShow(UI.close, true); uiText(UI.close, 'SAVE AND CLOSE');
	} else if (G.phase === 'service') {
		uiText(UI.serviceTitle, 'DAY ' + run.day + '  OPEN');
		uiText(UI.serviceMessage, noted('service', 'Take from the crates. Chop with the knife: pull its trigger over the board, or bring the blade down.\\nPut what the guest asked for on a plate, and the plate in front of them.\\nDirty plates go in the sink.'));
		uiShow(UI.open, false); uiShow(UI.close, false);
	} else {
		uiText(UI.serviceTitle, 'GAME OVER');
		uiText(UI.serviceMessage, noted('service', 'The restaurant is closed.'));
		uiShow(UI.open, true); uiText(UI.open, 'BACK TO THE LOBBY'); uiFill(UI.open, '#1d4ed8');
		uiShow(UI.close, false);
	}
}
function guestsHint() {
	const crew = Math.max(1, heads.filter((h) => inHall(h.pos)).length);
	let n = TUNING.guestsBase + TUNING.guestsPerDay * (G.run.day - 1) + TUNING.guestsPerCook * (crew - 1);
	for (const id of G.run.mods) n *= MODIFIERS[id].guests;
	return 'About ' + Math.round(n) + ' guests today, for ' + crew + (crew === 1 ? ' cook.' : ' cooks.');
}
function renderShop() {
	const rows = TUNING.offers;
	if (G.phase !== 'prep') {
		uiText(UI.shopTitle, 'BLUEPRINTS');
		uiText(UI.shopCoins, G.run ? money(G.run.coins) : '');
		for (let i = 0; i < rows; i++) uiShow(uiShopRow(i), false);
		uiShow(UI.reroll, false);
		uiText(UI.shopNote, G.phase === 'service' ? 'The shop opens when the restaurant closes.' : '');
		return;
	}
	uiText(UI.shopCoins, money(G.run.coins));
	if (G.card) {
		uiText(UI.shopTitle, 'CHOOSE A CARD');
		for (let i = 0; i < rows; i++) {
			const card = G.card[i];
			uiShow(uiShopRow(i), !!card);
			if (!card) continue;
			uiText(uiShopName(i), card.dish ? 'NEW DISH: ' + DISHES[card.dish].name + '\\nSells for ' + DISHES[card.dish].price + '. Its appliances come with it.' : MODIFIERS[card.mod].name.toUpperCase() + '\\n' + MODIFIERS[card.mod].info + '.');
			uiText(uiShopBuy(i), 'CHOOSE'); uiFill(uiShopBuy(i), '#7c3aed');
		}
		uiShow(UI.reroll, false);
		uiText(UI.shopNote, noted('shop', 'A card changes every day from now on.'));
		return;
	}
	uiText(UI.shopTitle, 'BLUEPRINTS');
	for (let i = 0; i < rows; i++) {
		const offer = G.offers[i];
		uiShow(uiShopRow(i), !!offer);
		if (!offer) continue;
		const what = offer.kind ? KINDS[offer.kind] : EXTRAS[offer.extra];
		uiText(uiShopName(i), what.name + (what.upgrade ? '  (upgrade)' : '') + '\\n' + what.info);
		uiText(uiShopBuy(i), offer.sold ? 'SOLD' : String(offer.price));
		uiFill(uiShopBuy(i), offer.sold ? '#44403c' : G.run.coins >= offer.price ? '#15803d' : '#78716c');
	}
	uiShow(UI.reroll, true);
	uiText(UI.reroll, 'NEW SET  ' + G.run.reroll);
	uiText(UI.shopNote, noted('shop', 'Drop an appliance on the bin to sell it for half.'));
}
function renderAll() { renderSetup(); renderCard(); renderTrack(); renderHud(); renderService(); renderShop(); }

function turn(value, by, count) { return ((value + by) % count + count) % count; }
function onPress(event) {
	const player = playerOf(event);
	players.set(player.id, player);
	const id = event.slotId;
	const idle = G.phase === 'idle';
	if (id === UI.seedPrev || id === UI.seedNext) { if (idle) G.cfg.seed = Math.max(1, G.cfg.seed + (id === UI.seedNext ? 1 : -1)); return renderSetup(); }
	if (id === UI.sizePrev || id === UI.sizeNext) { if (idle) G.cfg.size = turn(G.cfg.size, id === UI.sizeNext ? 1 : -1, SIZE_IDS.length); return renderSetup(); }
	if (id === UI.dishPrev || id === UI.dishNext) { if (idle) G.cfg.dish = turn(G.cfg.dish, id === UI.dishNext ? 1 : -1, STARTERS.length); return renderSetup(); }
	if (id === UI.start) {
		if (!idle) return note('setup', 'A restaurant is already open: walk through the kitchen door.');
		const level = levelOf(profileOf(player.id).xp);
		const size = SIZE_IDS[G.cfg.size], dish = STARTERS[G.cfg.dish];
		if (level < SIZE_LEVEL[size]) return note('setup', player.name + ' needs chef level ' + SIZE_LEVEL[size] + ' for the ' + SIZE_NAMES[size].toLowerCase() + '.');
		if (level < DISHES[dish].level) return note('setup', player.name + ' needs chef level ' + DISHES[dish].level + ' to start with ' + DISHES[dish].name + '.');
		if (profileOf(player.id).run && !(G.confirm[player.id] && clock < G.confirm[player.id])) {
			G.confirm[player.id] = clock + 8;
			return note('setup', 'A new restaurant replaces the one ' + player.name + ' left open on day ' + profileOf(player.id).run.day + '.\\nPress again to go ahead.', 8);
		}
		delete G.confirm[player.id];
		startRun(player.id, G.cfg);
		return renderAll();
	}
	if (id === UI.resume) {
		if (!idle) return note('setup', 'A restaurant is already open: walk through the kitchen door.');
		if (!resumeRun(player.id)) return note('setup', player.name + ' has no restaurant to go back to.');
		return renderAll();
	}
	if (id === UI.open) {
		if (G.phase === 'over') { closeHall(); return renderAll(); }
		if (G.phase !== 'prep') return;
		const need = missing();
		if (need.length) return note('service', 'You cannot open without: ' + need.join(', ') + '.');
		if (G.card) return note('service', 'Choose a card at the blueprint board first.');
		if (!cookable().length) return note('service', 'Nothing on the menu can be cooked: an appliance is missing.');
		if (!freeSeats().length) return note('service', 'No guest can reach a seat: clear the way from the street door to a table.');
		if (stations.some((st) => st.held)) return note('service', 'Somebody is still carrying an appliance: put it down first.');
		delete G.note.service;
		beginService();
		return renderAll();
	}
	if (id === UI.close) {
		if (G.phase !== 'prep') return;
		if (stations.some((st) => st.held)) return note('service', 'Somebody is still carrying an appliance: put it down first.');
		saveRun();
		closeHall();
		note('setup', 'The restaurant is saved. CONTINUE opens it again.');
		return renderAll();
	}
	if (id === UI.reroll) { reroll(); return renderAll(); }
	for (let i = 0; i < TUNING.offers; i++) if (id === uiShopBuy(i)) { if (G.card) takeCard(i); else buy(i); return renderAll(); }
}
`;

const RETURN_SOURCE = `
let slow = 0;
function start() {
	clearHall();
	for (const model of MODEL_IDS) for (const entry of pool[model]) show(entry.id + '-grab', false);
	for (const g of guests) hideOrder(g);
	showBoards();
	renderAll();
}
return {
	onSpawn() { if (ctx.world.isHost()) start(); },
	onPlayerReady(player) {
		players.set(player.id, { id: player.id, name: player.name });
		return loadProfile(player).then(() => { showBoards(); renderAll(); });
	},
	onPlayerLeft(player) {
		saveProfile(player.id);
		players.delete(player.id);
		G.crew = G.crew.filter((id) => id !== player.id);
	},
	onUIEvent(event) { if (event.type === 'press') onPress(event); },
	tick(dt) {
		if (!ctx.world.isHost()) return;
		dt = Math.min(dt, 0.1);
		clock += dt;
		runCues();
		if ((slow -= dt) <= 0) { slow = 0.2; refreshPlayers(); renderAll(); }
		if (G.phase !== 'idle') {
			// A ring on the floor or the worktop shows where each thing in a hand would land.
			let marker = 0;
			const mark = () => (marker < TUNING.markers ? marker : -1);
			if (G.phase === 'prep') for (const st of stations.slice()) if (trackStation(st, mark())) marker++;
			for (const t of items) if (trackThing(t, mark())) marker++;
			for (const t of plates) if (trackThing(t, mark())) marker++;
			for (; marker < TUNING.markers; marker++) move(idMarker(marker), PARKED);
			for (const knife of knives) tickKnife(knife, dt);
			if (G.phase === 'service') {
				for (const st of stations) tickStation(st, dt);
				tickService(dt);
			}
			for (const g of guests) if (g.on) tickGuest(g, dt);
			if (G.phase === 'over' && clock >= G.overAt) { closeHall(); renderAll(); }
			if (G.saveAt && clock >= G.saveAt && G.phase === 'prep') saveRun();
		} else {
			for (const t of items) trackThing(t, -1);
			for (const t of plates) trackThing(t, -1);
		}
		if (loose.size) parkLoose();
		flush();
	},
	/** For the tests: what the game holds. */
	__debug: { G, stations, items, plates, guests, knives, things, pool, profiles, players, profileOf, levelOf, startRun, resumeRun, closeHall, beginService, beginPrep, endDay, gameOver, spawnGuests, freeSeats, placeStation, removeStation, deliver, buy, reroll, takeCard, rollOffers, dealCards, targetOf, spotAt, seatAt, seatCell, cellAt, dishOf, fits, plateTakes, chop, loseHeart, refreshPlayers, renderAll, saveRun, party, clock: () => clock }
};
`;

/** The body of the director's code block. */
export function directorScript(): string {
	return [dataSource(), BASE_SOURCE, PROFILE_SOURCE, HALL_SOURCE, THINGS_SOURCE, WORK_SOURCE, GUESTS_SOURCE, FLOW_SOURCE, SCREENS_SOURCE, RETURN_SOURCE].join('\n');
}
