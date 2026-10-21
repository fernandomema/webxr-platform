/**
 * The tables of Bistro Rush: the building, what the kitchen cooks, the appliances, what a run offers and what a chef unlocks.
 * The world's script is given the same tables as source (see bistroScript.ts), and the tests read them.
 */

export type Vec3 = [number, number, number];

/** The hall of the restaurant: a grid of 1 m cells, `w` across (x) and `d` deep (z), its south-west corner at (minX, 0, minZ). */
export const HALL = { w: 10, d: 8, minX: -5, minZ: 0, height: 3.4 } as const;
/** The back room the players arrive in, south of the hall, and the doorway between them. */
export const LOBBY = { minX: -6, maxX: 6, minZ: -9.5, maxZ: -0.5, height: 3.2 } as const;
export const DOOR = { half: 0.9, height: 2.3 } as const;
/** Where the guests come in: a porch north of the hall, behind the street door. */
export const PORCH = { minX: -2.2, maxX: 2.2, minZ: 8.3, maxZ: 10.4, height: 2.9 } as const;
/** The height of a worktop. */
export const TOP = 0.9;

/** How wide the hall is for each size of restaurant, in cells (always centred on the doors). */
export const SIZES = { small: 6, medium: 8, large: 10 } as const;
export type SizeId = keyof typeof SIZES;
export const SIZE_IDS = Object.keys(SIZES) as SizeId[];
export const SIZE_NAMES: Record<SizeId, string> = { small: 'Corner bistro', medium: 'Brasserie', large: 'Grand hall' };

/** Where a pooled slot waits, out of sight, until the game moves it in. */
export const PARKED: Vec3 = [0, -200, 0];

export const cellCenter = (gx: number, gz: number): Vec3 => [HALL.minX + gx + 0.5, 0, HALL.minZ + gz + 0.5];

// --- food --------------------------------------------------------------------------------------------------------------------

export type Stage = 'raw' | 'chopped' | 'cooked' | 'fried' | 'soup' | 'burnt';

export const INGREDIENTS = {
	lettuce: { name: 'Lettuce' },
	tomato: { name: 'Tomato' },
	potato: { name: 'Potato' },
	patty: { name: 'Patty' },
	bun: { name: 'Bun' }
} as const;
export type Ingredient = keyof typeof INGREDIENTS;

/** An ingredient is drawn with the same five shapes whatever it is: a ball, two discs and two sticks. A look says where each goes. */
export const PARTS = ['ball', 'discA', 'discB', 'stickA', 'stickB'] as const;
export type PartKey = (typeof PARTS)[number];
export type Look = Partial<Record<PartKey, { at: Vec3; scale: Vec3; color: string }>>;

const BURNT: Look = { ball: { at: [0, 0, 0], scale: [0.13, 0.08, 0.13], color: '#1c1917' }, discA: { at: [0.03, 0.03, 0.02], scale: [0.07, 0.03, 0.07], color: '#292524' } };

/** How every ingredient looks at every stage. The origin is the middle of the thing; it rests with the origin `REST[...]` above a surface. */
export const LOOKS: Record<string, Look> = {
	'lettuce:raw': { ball: { at: [0, 0, 0], scale: [0.17, 0.15, 0.17], color: '#4d9a2a' }, discA: { at: [0, -0.06, 0], scale: [0.07, 0.03, 0.07], color: '#d9f99d' } },
	'lettuce:chopped': { ball: { at: [0, -0.02, 0], scale: [0.18, 0.05, 0.16], color: '#84cc16' }, discA: { at: [0.03, 0.005, 0.02], scale: [0.11, 0.03, 0.1], color: '#bef264' }, discB: { at: [-0.04, 0.0, -0.03], scale: [0.09, 0.03, 0.09], color: '#65a30d' } },
	'tomato:raw': { ball: { at: [0, 0, 0], scale: [0.13, 0.12, 0.13], color: '#dc2626' }, discA: { at: [0, 0.06, 0], scale: [0.045, 0.012, 0.045], color: '#166534' } },
	'tomato:chopped': { discA: { at: [-0.035, -0.03, 0], scale: [0.11, 0.022, 0.11], color: '#ef4444' }, discB: { at: [0.04, -0.012, 0.02], scale: [0.11, 0.022, 0.11], color: '#f87171' } },
	'tomato:soup': { discA: { at: [0, -0.03, 0], scale: [0.2, 0.035, 0.2], color: '#ea580c' }, discB: { at: [0.02, -0.01, 0.01], scale: [0.07, 0.012, 0.07], color: '#fdba74' } },
	'potato:raw': { ball: { at: [0, 0, 0], scale: [0.16, 0.11, 0.12], color: '#a16207' } },
	'potato:chopped': { stickA: { at: [-0.025, -0.03, 0], scale: [0.035, 0.035, 0.15], color: '#fde68a' }, stickB: { at: [0.025, -0.03, 0.01], scale: [0.035, 0.035, 0.15], color: '#fef3c7' } },
	'potato:fried': { stickA: { at: [-0.025, -0.02, 0], scale: [0.035, 0.035, 0.15], color: '#f59e0b' }, stickB: { at: [0.03, 0.005, 0.01], scale: [0.035, 0.035, 0.15], color: '#fbbf24' }, discA: { at: [0, -0.045, 0], scale: [0.14, 0.012, 0.14], color: '#fcd34d' } },
	'patty:raw': { discA: { at: [0, -0.02, 0], scale: [0.13, 0.035, 0.13], color: '#f4a7b3' } },
	'patty:cooked': { discA: { at: [0, -0.02, 0], scale: [0.125, 0.035, 0.125], color: '#6b3410' }, discB: { at: [0, -0.001, 0], scale: [0.09, 0.006, 0.09], color: '#8a4a1c' } },
	'bun:raw': { ball: { at: [0, 0.0, 0], scale: [0.15, 0.08, 0.15], color: '#d9a05b' }, discA: { at: [0, -0.03, 0], scale: [0.15, 0.03, 0.15], color: '#e7c08a' } },
	burnt: BURNT
};
/** How far above a surface the origin of a resting ingredient is. */
export const ITEM_REST = 0.065;
export const PLATE_REST = 0.012;

/** Where each part of a dish sits on its plate (the plate's own space), and the look it takes there when it differs. */
export const PLATED: Record<string, { at: Vec3; look?: Look }> = {
	'lettuce:chopped': { at: [-0.045, 0.045, 0.01] },
	'tomato:chopped': { at: [0.05, 0.055, -0.01] },
	'tomato:soup': { at: [0, 0.05, 0] },
	'potato:fried': { at: [0, 0.055, 0] },
	'patty:cooked': { at: [0, 0.07, 0] },
	'bun:raw': {
		at: [0, 0.045, 0],
		// On a plate the bun opens: the heel under the patty and the crown over it.
		look: { discA: { at: [0, -0.02, 0], scale: [0.15, 0.03, 0.15], color: '#e7c08a' }, ball: { at: [0, 0.075, 0], scale: [0.15, 0.08, 0.15], color: '#d9a05b' } }
	}
};
/** In a burger with lettuce, the leaf goes on the heel and the patty on the leaf. */
export const PLATED_IN: Record<string, Record<string, Vec3>> = { deluxe: { 'lettuce:chopped': [0.03, 0.062, 0.02], 'patty:cooked': [0, 0.088, 0] } };

/** What an appliance does to what is put on it, by "ingredient:stage". */
export const PROCESS = {
	board: { rules: { 'lettuce:raw': 'chopped', 'tomato:raw': 'chopped', 'potato:raw': 'chopped' } },
	hob: { rules: { 'patty:raw': 'cooked' } },
	fryer: { rules: { 'potato:chopped': 'fried' } },
	pot: { rules: { 'tomato:chopped': 'soup' } }
} as const;

export const DISHES = {
	salad: { name: 'Salad', price: 12, level: 1, parts: ['lettuce:chopped', 'tomato:chopped'], needs: ['board', 'crate_lettuce', 'crate_tomato'], starter: true },
	burger: { name: 'Burger', price: 15, level: 2, parts: ['bun:raw', 'patty:cooked'], needs: ['hob', 'crate_patty', 'crate_bun'], starter: true },
	fries: { name: 'Fries', price: 10, level: 4, parts: ['potato:fried'], needs: ['board', 'fryer', 'crate_potato'], starter: false },
	soup: { name: 'Tomato soup', price: 13, level: 5, parts: ['tomato:soup'], needs: ['board', 'pot', 'crate_tomato'], starter: false },
	deluxe: { name: 'Deluxe burger', price: 22, level: 7, parts: ['bun:raw', 'patty:cooked', 'lettuce:chopped'], needs: ['hob', 'board', 'crate_patty', 'crate_bun', 'crate_lettuce'], starter: false, after: 'burger' }
} as const;
export type DishId = keyof typeof DISHES;
export const DISH_IDS = Object.keys(DISHES) as DishId[];

// --- appliances --------------------------------------------------------------------------------------------------------------

/** The shapes of appliance there are in the world, and how many of each wait in the pool. */
export const MODELS = { counter: 12, table: 6, rack: 1, sink: 2, bin: 1, board: 2, hob: 3, fryer: 2, pot: 1, crate_lettuce: 1, crate_tomato: 1, crate_potato: 1, crate_patty: 1, crate_bun: 1, plant: 3 } as const;
export type ModelId = keyof typeof MODELS;
export const MODEL_IDS = Object.keys(MODELS) as ModelId[];

/**
 * What can stand in a cell. `model` is the shape it uses, `price` what its blueprint costs, `level` the chef level that puts it in
 * the shop, `dish` a dish that must be on the menu for it to be offered, and the rest is what makes an upgrade better.
 */
export const KINDS = {
	counter: { name: 'Counter', model: 'counter', price: 15, level: 1, info: 'A place to put things down' },
	table: { name: 'Table for two', model: 'table', price: 30, level: 1, info: 'Two more seats' },
	rack: { name: 'Plate rack', model: 'rack', price: 25, level: 1, info: 'Where clean plates wait' },
	sink: { name: 'Sink', model: 'sink', price: 35, level: 1, info: 'Washes a dirty plate' },
	sink2: { name: 'Power sink', model: 'sink', price: 70, level: 5, info: 'Washes twice as fast', upgrade: true, wash: 0.5, trim: '#38bdf8' },
	bin: { name: 'Bin', model: 'bin', price: 10, level: 1, info: 'Throws food away, sells appliances' },
	board: { name: 'Chopping board', model: 'board', price: 30, level: 1, info: 'Chop with the knife' },
	board2: { name: 'Sharp board', model: 'board', price: 60, level: 4, info: 'Three cuts instead of five', upgrade: true, chops: 3, trim: '#f59e0b' },
	hob: { name: 'Hob', model: 'hob', price: 45, level: 2, info: 'Cooks patties', dish: 'burger' },
	hob2: { name: 'Induction hob', model: 'hob', price: 80, level: 6, info: 'Cooks 40% faster', upgrade: true, dish: 'burger', cook: 0.6, trim: '#a78bfa' },
	hob3: { name: 'Safety hob', model: 'hob', price: 80, level: 7, info: 'Never burns the food', upgrade: true, dish: 'burger', safe: true, trim: '#34d399' },
	fryer: { name: 'Fryer', model: 'fryer', price: 50, level: 4, info: 'Fries chopped potato', dish: 'fries' },
	pot: { name: 'Soup pot', model: 'pot', price: 50, level: 5, info: 'Simmers chopped tomato', dish: 'soup' },
	crate_lettuce: { name: 'Lettuce crate', model: 'crate_lettuce', price: 20, level: 1, info: 'Lettuce, as much as you need', supply: 'lettuce' },
	crate_tomato: { name: 'Tomato crate', model: 'crate_tomato', price: 20, level: 1, info: 'Tomatoes, as many as you need', supply: 'tomato' },
	crate_potato: { name: 'Potato sack', model: 'crate_potato', price: 20, level: 4, info: 'Potatoes', supply: 'potato', dish: 'fries' },
	crate_patty: { name: 'Patty fridge', model: 'crate_patty', price: 20, level: 2, info: 'Raw patties', supply: 'patty', dish: 'burger' },
	crate_bun: { name: 'Bread basket', model: 'crate_bun', price: 20, level: 2, info: 'Buns', supply: 'bun', dish: 'burger' },
	plant: { name: 'Potted plant', model: 'plant', price: 35, level: 3, info: 'Guests nearby wait 25% longer', upgrade: true }
} as const;
export type KindId = keyof typeof KINDS;
export const KIND_IDS = Object.keys(KINDS) as KindId[];

/** What a new restaurant starts with, whatever it cooks; the appliances of its first dish are added to these. */
export const STARTER_KIT: KindId[] = ['counter', 'counter', 'rack', 'sink', 'bin', 'table', 'table'];
/** A restaurant cannot open without these. */
export const MUST_HAVE: ModelId[] = ['rack', 'table', 'sink'];
/** One of these is always in the shop, so that a restaurant can always grow. */
export const STAPLES: KindId[] = ['counter', 'table'];

/** Things the shop sells that are not appliances. */
export const EXTRAS = {
	plates: { name: 'Two more plates', price: 20, info: 'Fewer trips to the sink' },
	heart: { name: 'A second chance', price: 60, info: 'One more heart (up to three)' }
} as const;

/** A card is offered every third day: a new dish (with the appliances it needs) or a change to the guests. */
export const MODIFIERS = {
	rush: { name: 'Rush hour', info: 'A third more guests, and they pay a fifth more', guests: 1.33, price: 1.2, patience: 1 },
	gourmet: { name: 'Food critics', info: 'Dishes sell for a third more, but guests wait less', guests: 1, price: 1.33, patience: 0.85 },
	regulars: { name: 'Regulars', info: 'Guests wait a quarter longer', guests: 1, price: 1, patience: 1.25 }
} as const;
export type ModifierId = keyof typeof MODIFIERS;

// --- progress ----------------------------------------------------------------------------------------------------------------

/** Experience a chef needs for each level (the first is level 1), and what each level opens. */
export const LEVEL_XP = [0, 80, 200, 380, 620, 920, 1300, 1750];
export const LEVEL_UNLOCKS: string[] = [
	'Salad, and the corner bistro',
	'Burgers: the hob, the fridge and the bread basket',
	'The brasserie (8 cells wide) and potted plants',
	'Fries: the fryer, and the sharp board',
	'Tomato soup, and the power sink',
	'The grand hall (10 cells wide) and the induction hob',
	'Deluxe burgers and the safety hob',
	'Master chef: every run starts with 30 coins more'
];
export const SIZE_LEVEL: Record<SizeId, number> = { small: 1, medium: 3, large: 6 };

export const TUNING = {
	hearts: 3,
	startCoins: 30,
	masterBonus: 30,
	/** Guests on the first day, how many more every day, and how many more per extra cook. */
	guestsBase: 4,
	guestsPerDay: 1.5,
	guestsPerCook: 1.5,
	/** Seconds between two arrivals at the door, and the least a busy restaurant lets it fall to. */
	arrivalGap: 13,
	arrivalGapMin: 5,
	/** How long a guest waits for the food; it shortens a little every day down to the least. */
	patience: 75,
	patiencePerDay: 2.5,
	patienceMin: 45,
	eatSeconds: 7,
	walkSpeed: 1.5,
	tipRate: 0.5,
	chops: 5,
	cookSeconds: 8,
	frySeconds: 7,
	simmerSeconds: 9,
	/** Seconds a cooked thing may stay on the heat before it burns. */
	burnSeconds: 9,
	washSeconds: 4,
	plates: 4,
	platesMax: 8,
	sellRefund: 0.5,
	rerollCost: 8,
	rerollStep: 4,
	offers: 4,
	cardEvery: 3,
	/** How close (metres, on the floor) a thing let go has to be to a place to land on it. */
	reach: 0.62,
	plantReach: 2.6,
	plantBonus: 1.25,
	xpPerDay: 20,
	xpPerDish: 3,
	items: 24,
	guests: 10,
	markers: 4
} as const;

export const BOARDS = { bestDay: 'bistro-best-day', served: 'bistro-dishes' } as const;

// --- names of the slots ------------------------------------------------------------------------------------------------------

export const ID = {
	root: 'bi-root',
	flush: 'bi-flush',
	station: (model: string, n: number) => `bi-st-${model}-${n}`,
	item: (n: number) => `bi-item-${n}`,
	plate: (n: number) => `bi-plate-${n}`,
	guest: (n: number) => `bi-guest-${n}`,
	knife: (n: number) => `bi-knife-${n}`,
	marker: (n: number) => `bi-mark-${n}`,
	divider: (n: number) => `bi-div-${n}`,
	partition: (side: 'w' | 'e') => `bi-part-${side}`,
	heart: (n: number) => `bi-heart-${n}`,
	tiles: 'bi-tiles',
	doorLeaf: (side: 'l' | 'r') => `bi-door-${side}`,
	openSign: 'bi-open-sign',
	rail: 'bi-rail'
} as const;

/** How many half-wall pieces the divider between kitchen and dining room can be made of. */
export const DIVIDERS = 10;

/** The screens and their buttons. */
export const UI = {
	// Lobby.
	card: 'bi-card',
	cardLines: 8,
	cardLine: (i: number) => `bi-card-l${i}`,
	track: 'bi-track',
	trackLine: (i: number) => `bi-track-l${i}`,
	setup: 'bi-setup',
	setupStatus: 'bi-setup-status',
	setupSeed: 'bi-setup-seed',
	setupSize: 'bi-setup-size',
	setupDish: 'bi-setup-dish',
	seedPrev: 'bi-b-seed-prev',
	seedNext: 'bi-b-seed-next',
	sizePrev: 'bi-b-size-prev',
	sizeNext: 'bi-b-size-next',
	dishPrev: 'bi-b-dish-prev',
	dishNext: 'bi-b-dish-next',
	start: 'bi-b-start',
	resume: 'bi-b-resume',
	planCell: (gx: number, gz: number) => `bi-plan-${gx}-${gz}`,
	planRow: (gz: number) => `bi-plan-row-${gz}`,
	boardDay: 'bi-board-day',
	boardServed: 'bi-board-served',
	// Hall.
	hud: 'bi-hud',
	hudTitle: 'bi-hud-title',
	hudStats: 'bi-hud-stats',
	hudOrders: 'bi-hud-orders',
	service: 'bi-svc',
	serviceTitle: 'bi-svc-title',
	serviceMessage: 'bi-svc-msg',
	open: 'bi-b-open',
	close: 'bi-b-close',
	shop: 'bi-shop',
	shopTitle: 'bi-shop-title',
	shopCoins: 'bi-shop-coins',
	shopRow: (i: number) => `bi-shop-row-${i}`,
	shopName: (i: number) => `bi-shop-name-${i}`,
	shopBuy: (i: number) => `bi-b-buy-${i}`,
	reroll: 'bi-b-reroll',
	shopNote: 'bi-shop-note'
} as const;

/**
 * Where things rest on each shape of appliance: the height of the surface, and the offset of the resting place from the middle
 * of the cell (a chopping board is to one side, to leave room for the knife). A table has a place in front of each of its seats.
 */
export const SURFACE: Record<ModelId, { top: number; at?: [number, number] }> = {
	counter: { top: TOP },
	table: { top: 0.785 },
	rack: { top: 0.925 },
	sink: { top: 0.925 },
	bin: { top: 0.82 },
	board: { top: 0.937, at: [-0.1, 0] },
	hob: { top: 0.972 },
	fryer: { top: 1.0 },
	pot: { top: 1.245 },
	crate_lettuce: { top: 0.9 },
	crate_tomato: { top: 0.9 },
	crate_potato: { top: 0.9 },
	crate_patty: { top: 0.9 },
	crate_bun: { top: 0.9 },
	plant: { top: 0 }
};
/** How far from the middle of a table a guest sits, and how far the plate in front of them is. */
export const SEAT = { offset: 0.52, plate: 0.17, height: 0.47 } as const;
/** Where a knife lies on its chopping board (in the board's cell), and where the middle of its blade is from its handle. */
export const KNIFE = { at: [0.36, 0.955, -0.05] as Vec3, blade: 0.13 } as const;
/** The models that work on what is put on them, and so have a gauge. */
export const WORKERS: ModelId[] = ['board', 'hob', 'fryer', 'pot', 'sink'];
