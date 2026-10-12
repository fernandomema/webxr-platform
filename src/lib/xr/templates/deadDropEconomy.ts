import { AMMO_STEPS, DEFAULT_LOADOUT, MARKUP, TRADER_STOCK, UPGRADES } from './deadDropData.ts';

/** How many rows each screen shows. */
export const SCREEN = { traderRows: 6, loadoutRows: 9 } as const;

/** Where the two screens stand on the floor plan (x, z): a player who comes within `SCREEN_WAKE` metres of one is the one it shows. */
export const SCREEN_AT = { stash: [-8.6, 8.1], trader: [7.15, 8.0], console: [4, 3] } as const;
export const SCREEN_WAKE = 3.4;

/** Screen ids, by row. */
export const SCREEN_ID = {
	traderText: (row: number) => `dd-ts-row-${row}`,
	traderGo: (row: number) => `dd-ts-go-${row}`,
	stashText: (row: number) => `dd-ss-row-${row}`,
	stashPrev: (row: number) => `dd-ss-prev-${row}`,
	stashNext: (row: number) => `dd-ss-next-${row}`
} as const;

/**
 * The trader, the stash screen and the refuge's improvements, as code for the director's script. The trader sells a short list
 * of things for 50% above their value and pays the full value for anything; the stash screen is where a player chooses what
 * to take on a raid. Both are shared by whoever uses them: the last to press a button is the one they show.
 */
export const ECONOMY_SOURCE = `
const TRADER_STOCK = ${JSON.stringify(TRADER_STOCK)};
const MARKUP = ${MARKUP};
const UPGRADES = ${JSON.stringify(UPGRADES)};
const DEFAULT_LOADOUT = ${JSON.stringify(DEFAULT_LOADOUT)};
const AMMO_STEPS = ${JSON.stringify(AMMO_STEPS)};
const TRADER_ROWS = ${SCREEN.traderRows}, LOADOUT_ROWS = ${SCREEN.loadoutRows};
const SCREEN_AT = ${JSON.stringify(SCREEN_AT)}, SCREEN_WAKE = ${SCREEN_WAKE};
const buyPrice = (id) => Math.ceil(ITEMS[id].value * MARKUP);
const sellPrice = (id) => ITEMS[id].value;
const itemLabel = (id, n) => ITEMS[id].name + (n > 1 ? ' x' + n : '');

const packCap = (profile) => TUNING.packSlots + UPGRADES.pack.per * profile.upgrades.pack;
const caseSlots = (profile) => profile.upgrades.case;
const maxHpFor = (profile) => TUNING.maxHp + UPGRADES.infirmary.per * profile.upgrades.infirmary;
/** The level a player has of an improvement, counted from its first purchase. */
const upgradeIndex = (profile, key) => (key === 'case' ? profile.upgrades.case - 1 : profile.upgrades[key]);

function normalizeProfile(profile) {
	profile.upgrades = Object.assign({ pack: 0, case: 1, infirmary: 0 }, profile.upgrades);
	profile.loadout = Object.assign({}, DEFAULT_LOADOUT, profile.loadout);
	profile.loadout.case = [0, 1, 2].map((i) => (profile.loadout.case && profile.loadout.case[i]) || null);
	return profile;
}

// ---- What a player takes on a raid -------------------------------------------------------------------------------------

/** What the loadout comes to, given what the stash holds now: nothing is promised twice and nothing that is not there. */
function planKit(profile) {
	const L = profile.loadout, left = {};
	for (const e of profile.stash) left[e.id] = e.n;
	const have = (id) => left[id] || 0;
	const take = (id, n) => { const k = Math.min(n, have(id)); left[id] = have(id) - k; return k; };
	const weapons = [];
	for (const id of [L.primary, L.secondary]) if (id && ITEMS[id] && ITEMS[id].kind === 'weapon' && take(id, 1) > 0) weapons.push(id);
	let armor = null;
	if (L.armor === 'best') { for (const id of ['armor2', 'armor1']) if (!armor && take(id, 1) > 0) armor = id; }
	else if (L.armor && ITEMS[L.armor] && take(L.armor, 1) > 0) armor = L.armor;
	const suppressor = !!L.suppressor && take('suppressor', 1) > 0;
	const ammo = take('ammo9', L.ammo), meds = take('medkit', L.meds);
	const kase = [];
	for (let i = 0; i < caseSlots(profile); i++) {
		const id = L.case[i];
		if (!id || !ITEMS[id]) continue;
		const n = take(id, ITEMS[id].stack);
		if (n > 0) kase.push({ id, n });
	}
	return { weapons, armor, suppressor, ammo, meds, kase };
}

/** Takes the planned kit out of the stash and puts it on the player. */
function applyKit(p, profile) {
	const plan = planKit(profile);
	p.weapons = plan.weapons.slice();
	for (const id of p.weapons) takeFrom(profile.stash, id, 1);
	if (!p.weapons.length) p.weapons.push('pistol');
	p.armor = plan.armor;
	if (p.armor) takeFrom(profile.stash, p.armor, 1);
	p.suppressed = plan.suppressor;
	if (p.suppressed) takeFrom(profile.stash, 'suppressor', 1);
	p.maxHp = maxHpFor(profile); p.packCap = packCap(profile);
	p.pack = [];
	takeFrom(profile.stash, 'ammo9', plan.ammo);
	takeFrom(profile.stash, 'medkit', plan.meds);
	// Nobody goes in with less than a few magazines: the free ones are what a scavenger finds on the way.
	packAdd(p.pack, 'ammo9', Math.max(36, plan.ammo), p.packCap);
	packAdd(p.pack, 'medkit', plan.meds, p.packCap);
	p.case = plan.kase.map((e) => ({ id: e.id, n: e.n }));
	for (const e of p.case) takeFrom(profile.stash, e.id, e.n);
}

/** The case comes back whatever happens to the player: that is what it is for. */
function returnCase(p, profile) {
	for (const e of p.case || []) addTo(profile.stash, e.id, e.n);
	p.case = [];
}

function kitText(profile) {
	const plan = planKit(profile), parts = plan.weapons.map((id) => ITEMS[id].name);
	if (!parts.length) parts.push('free pistol');
	if (plan.armor) parts.push(ITEMS[plan.armor].name);
	if (plan.suppressor) parts.push('suppressor');
	parts.push(Math.max(36, plan.ammo) + ' rounds');
	if (plan.meds) parts.push(plan.meds + ' medkit' + (plan.meds > 1 ? 's' : ''));
	for (const e of plan.kase) parts.push(itemLabel(e.id, e.n) + ' (case)');
	return parts.join(', ');
}

// ---- The trader --------------------------------------------------------------------------------------------------------

function buyItem(profile, id, n) {
	const cost = buyPrice(id) * n;
	if (profile.credits < cost) return 'Not enough credits for ' + itemLabel(id, n) + '.';
	profile.credits -= cost;
	addTo(profile.stash, id, n);
	return 'Bought ' + itemLabel(id, n) + ' for $' + cost + '.';
}

function sellItem(profile, id, n) {
	const taken = takeFrom(profile.stash, id, n);
	if (taken <= 0) return 'Nothing to sell.';
	profile.credits += sellPrice(id) * taken;
	return 'Sold ' + itemLabel(id, taken) + ' for $' + sellPrice(id) * taken + '.';
}

function sellAllLoot(profile) {
	let total = 0, count = 0;
	for (const e of profile.stash.slice()) {
		if (ITEMS[e.id].kind !== 'loot') continue;
		total += sellPrice(e.id) * e.n; count += e.n;
		takeFrom(profile.stash, e.id, e.n);
	}
	profile.credits += total;
	return count ? 'Sold ' + count + ' loot items for $' + total + '.' : 'You have no loot to sell.';
}

function buyUpgrade(profile, key) {
	const u = UPGRADES[key], index = upgradeIndex(profile, key);
	if (index >= u.costs.length) return u.name + ' is as good as it gets.';
	if (profile.credits < u.costs[index]) return 'Not enough credits for ' + u.name + '.';
	profile.credits -= u.costs[index];
	profile.upgrades[key] += 1;
	return u.name + ' improved for $' + u.costs[index] + '.';
}

const TS = { user: '', mode: 'buy', page: 0, note: '' };
const TAB_COLOR = { buy: '#2563eb', sell: '#16a34a', up: '#7c3aed' }, TAB_OFF = '#292524';
/** What the trader's rows say: a name, a price and what the button does, in the colour of the tab. */
function traderList(profile) {
	const credits = profile ? profile.credits : 0;
	if (TS.mode === 'buy') return TRADER_STOCK.map((s) => ({ text: itemLabel(s.id, s.n), price: '$' + buyPrice(s.id) * s.n, label: 'BUY', color: credits >= buyPrice(s.id) * s.n || !profile ? '#16a34a' : '#7f1d1d', act: ['buy', s.id, s.n] }));
	if (TS.mode === 'sell') {
		return profile.stash.slice().sort((a, b) => sellPrice(b.id) * b.n - sellPrice(a.id) * a.n).map((e) => ({ text: itemLabel(e.id, e.n), price: '$' + sellPrice(e.id) * e.n, label: 'SELL', color: '#d97706', act: ['sell', e.id, e.n] }));
	}
	return Object.keys(UPGRADES).map((key) => {
		const u = UPGRADES[key], index = upgradeIndex(profile, key), cost = u.costs[index];
		const level = key === 'case' ? profile.upgrades.case : profile.upgrades[key];
		return { text: u.name + '  ' + level + '/' + (key === 'case' ? u.costs.length + 1 : u.costs.length) + '   ' + u.text, price: '', label: cost === undefined ? 'MAX' : '$' + cost, color: cost === undefined ? '#44403c' : credits >= cost ? '#7c3aed' : '#7f1d1d', act: cost === undefined ? null : ['up', key] };
	});
}
function renderTrader() {
	const profile = TS.user ? profileOf(TS.user) : null, who = TS.user && players.get(TS.user);
	setTextOf('dd-ts-user', who ? who.name : 'Step up to the counter');
	setTextOf('dd-ts-credits', profile ? 'Credits $' + profile.credits : '');
	// The things on sale are the same for everyone: they show before anyone has stepped up. Selling and improving need a stash.
	const list = profile || TS.mode === 'buy' ? traderList(profile) : [], pages = Math.max(1, Math.ceil(list.length / TRADER_ROWS));
	TS.page = clamp(TS.page, 0, pages - 1);
	for (let i = 0; i < TRADER_ROWS; i++) {
		const row = list[TS.page * TRADER_ROWS + i];
		setTextOf('dd-ts-row-' + i, row ? row.text : '');
		setTextOf('dd-ts-price-' + i, row ? row.price : '');
		setTextOf('dd-ts-go-' + i, row ? row.label : '');
		field('dd-ts-line-' + i, 'uiElement', 'visible', !!row);
		if (row) field('dd-ts-go-' + i, 'uiElement', 'background', row.color);
	}
	const hint = !profile ? 'Walk up to the counter to see your credits and your stash.' : TS.mode === 'sell' && !list.length ? 'Nothing in the stash to sell.' : TS.mode === 'buy' ? 'Press BUY next to something to buy it.' : TS.mode === 'sell' ? 'Press SELL next to something to sell it for its full value.' : 'Improvements are for good: press the price to buy one.';
	setTextOf('dd-ts-note', TS.note || hint);
	field('dd-ts-note', 'uiElement', 'color', TS.note ? (/^(Not enough|You have no|Fully|.* is as good)/.test(TS.note) ? '#f87171' : '#4ade80') : '#a8a29e');
	setTextOf('dd-ts-page', 'Page ' + (TS.page + 1) + '/' + pages);
	for (const mode of ['buy', 'sell', 'up']) field('dd-ts-' + mode, 'uiElement', 'background', TS.mode === mode ? TAB_COLOR[mode] : TAB_OFF);
	field('dd-ts-sellall', 'uiElement', 'visible', TS.mode === 'sell');
}
function traderPress(event, p) {
	const id = event.slotId;
	if (id.indexOf('dd-ts-') !== 0) return false;
	if (TS.user !== p.id) { TS.user = p.id; TS.page = 0; TS.note = ''; }
	const profile = profileOf(p.id);
	if (id === 'dd-ts-buy' || id === 'dd-ts-sell' || id === 'dd-ts-up') { TS.mode = id === 'dd-ts-buy' ? 'buy' : id === 'dd-ts-sell' ? 'sell' : 'up'; TS.page = 0; TS.note = ''; }
	else if (id === 'dd-ts-prev') { TS.page -= 1; TS.note = ''; }
	else if (id === 'dd-ts-next') { TS.page += 1; TS.note = ''; }
	else if (id === 'dd-ts-sellall') TS.note = sellAllLoot(profile);
	else if (id.indexOf('dd-ts-go-') === 0) {
		const row = traderList(profile)[TS.page * TRADER_ROWS + Number(id.slice(9))];
		if (row && !row.act) TS.note = 'Fully improved: it is as good as it gets.';
		else if (row && row.act) {
			if (row.act[0] === 'buy') TS.note = buyItem(profile, row.act[1], row.act[2]);
			else if (row.act[0] === 'sell') TS.note = sellItem(profile, row.act[1], row.act[2]);
			else TS.note = buyUpgrade(profile, row.act[1]);
		}
	}
	saveProfile(p.id);
	renderTrader(); renderStash();
	soundAt([8, 1.4, 8], 880, 0.25, 70, 0, 0);
	return true;
}

// ---- The stash screen --------------------------------------------------------------------------------------------------

const SS = { user: '' };
const weaponsOwned = (profile) => profile.stash.filter((e) => ITEMS[e.id].kind === 'weapon').map((e) => e.id);
/** The choices of one row of the loadout, and where its value is kept. */
function loadoutRow(profile, row) {
	const L = profile.loadout, owned = (kind) => profile.stash.filter((e) => ITEMS[e.id].kind === kind).map((e) => e.id);
	if (row === 0) return { name: 'Primary', key: 'primary', options: ['none'].concat(weaponsOwned(profile)) };
	if (row === 1) return { name: 'Sidearm', key: 'secondary', options: ['none'].concat(weaponsOwned(profile)) };
	if (row === 2) return { name: 'Armour', key: 'armor', options: ['none', 'best'].concat(owned('armor')) };
	if (row === 3) return { name: 'Ammo', key: 'ammo', options: AMMO_STEPS.slice() };
	if (row === 4) return { name: 'Medkits', key: 'meds', options: [0, 1, 2, 3] };
	if (row === 5) return { name: 'Suppressor', key: 'suppressor', options: [false, true] };
	const slot = row - 6;
	return { name: 'Case ' + (slot + 1), key: 'case', slot, locked: slot >= caseSlots(profile), options: ['none'].concat(profile.stash.map((e) => e.id)) };
}
function loadoutValue(profile, def) { return def.key === 'case' ? profile.loadout.case[def.slot] || 'none' : (profile.loadout[def.key] === null || profile.loadout[def.key] === undefined ? 'none' : profile.loadout[def.key]); }
function showValue(def, value) {
	if (def.key === 'suppressor') return value ? 'take it' : 'leave it';
	if (def.key === 'ammo') return value + ' rounds';
	if (def.key === 'meds') return String(value);
	if (value === 'none' || value === null) return 'none';
	if (value === 'best') return 'best I own';
	return ITEMS[value] ? ITEMS[value].name : String(value);
}
function renderStash() {
	renderGear();
	const profile = SS.user ? profileOf(SS.user) : null, who = SS.user && players.get(SS.user);
	setTextOf('dd-ss-user', who ? who.name + '’s stash' : 'Step up to the lockers');
	setTextOf('dd-ss-credits', profile ? 'Credits $' + profile.credits : '');
	for (let row = 0; row < LOADOUT_ROWS; row++) {
		const def = profile ? loadoutRow(profile, row) : null;
		const value = !def ? '' : def.locked ? 'locked: see the trader' : showValue(def, loadoutValue(profile, def));
		setTextOf('dd-ss-label-' + row, def ? def.name : '');
		setTextOf('dd-ss-row-' + row, value);
		field('dd-ss-row-' + row, 'uiElement', 'color', !def ? '#78716c' : def.locked ? '#f87171' : value === 'none' || value === 'leave it' || value === 0 || value === '0' ? '#78716c' : '#f5f5f4');
		field('dd-ss-line-' + row, 'uiElement', 'visible', !!def);
	}
	if (!profile) { setTextOf('dd-ss-list', ''); setTextOf('dd-ss-kit', 'Press any button to open your stash.'); return; }
	setTextOf('dd-ss-list', 'In the stash: ' + (profile.stash.map((e) => itemLabel(e.id, e.n)).join(', ') || 'nothing') + '.');
	setTextOf('dd-ss-kit', 'Raid kit: ' + kitText(profile) + '.');
}
/** A screen shows whoever is nearest to it, so that it is already theirs when they get there. */
function wakeScreens() {
	const near = (at, radius = SCREEN_WAKE) => {
		let best = null, bestD = radius;
		for (const p of players.values()) {
			if (p.state !== 'hub') continue;
			const pose = poseOf(p);
			if (!pose) continue;
			const d = Math.hypot(pose.head.position[0] - at[0], pose.head.position[2] - at[1]);
			if (d < bestD) { best = p; bestD = d; }
		}
		return best;
	};
	const trader = near(SCREEN_AT.trader), stash = near(SCREEN_AT.stash), console_ = near(SCREEN_AT.console);
	const gear = near(GEAR_AT, GEAR_WAKE);
	if (gear && GW.user !== gear.id) { GW.user = gear.id; profileOf(gear.id); renderGear(); }
	if (console_ && CON.user !== console_.id) { CON.user = console_.id; renderConsole(); }
	if (trader && TS.user !== trader.id) { TS.user = trader.id; TS.page = 0; TS.note = ''; profileOf(trader.id); renderTrader(); }
	if (stash && SS.user !== stash.id) { SS.user = stash.id; profileOf(stash.id); renderStash(); }
}
function stashPress(event, p) {
	const id = event.slotId;
	if (id.indexOf('dd-ss-') !== 0) return false;
	if (SS.user !== p.id) SS.user = p.id;
	const profile = profileOf(p.id);
	const m = /^dd-ss-(prev|next)-(\\d+)$/.exec(id);
	if (m) {
		const def = loadoutRow(profile, Number(m[2]));
		if (!def.locked) {
			const at = def.options.indexOf(loadoutValue(profile, def)), step = m[1] === 'next' ? 1 : -1;
			const value = def.options[(Math.max(at, 0) + step + def.options.length) % def.options.length];
			if (def.key === 'case') profile.loadout.case[def.slot] = value === 'none' ? null : value;
			else profile.loadout[def.key] = value === 'none' ? null : value;
		}
	}
	saveProfile(p.id);
	renderStash(); renderTrader();
	soundAt([-8, 1.4, 6], 760, 0.22, 60, 0, 0);
	return true;
}

function economyPress(event, p) { return traderPress(event, p) || stashPress(event, p); }
`;
