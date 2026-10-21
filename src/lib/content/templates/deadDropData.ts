import type { Vec3 } from './arcadeKit.ts';

/**
 * Dead Drop: everything the game is made of that is data, not code. The scripts get these tables as JSON, so a number changed
 * here changes the game in the hub, in the raid and in the tests.
 */

/** The raid is a 3 x 3 grid of square cells. Its middle is far from the hub, so the two never share a view. */
export const GRID = { size: 3, cell: 10, origin: [400, 0, 0] as Vec3, wallHeight: 3.2, doorWidth: 2.6 } as const;

/** Where the squad stands to prepare, and the way it faces when it gets back. */
export const HUB = { spawn: [0, 0, 0] as Vec3, yaw: 0 } as const;

export const TUNING = {
	maxHp: 100,
	/** The raid ends this many seconds after it begins; an alarm sounds `alarmAt` seconds in. */
	raidSeconds: 720,
	alarmAt: 540,
	/** Standing this long inside an active exit gets a player out. */
	extractSeconds: 8,
	extractRadius: 2.2,
	/** Slots in a raid pack. */
	packSlots: 12,
	/** How far a hand can be from loot or a bag to take it. */
	reach: 1.6,
	/** A dead player is sent back to the hub after this long. */
	respawnSeconds: 5,
	/** Seconds between two noises the same shooter makes that alert enemies (so a burst is one noise). */
	noiseGap: 0.4,
	medkitSeconds: 3,
	headshot: 2,
	/** The whole squad gets this long at the start of a raid before enemies see anyone. */
	grace: 25,
	/** Seconds an enemy takes to notice a player in plain sight: from this close to the edge of its sight. The notice fills and drains, so a step back behind cover saves you. */
	noticeClose: 0.8,
	noticeFar: 2.8,
	noticeDecay: 0.45,
	playerRadius: 0.35,
	playerHeight: 1.8
} as const;

export type ItemKind = 'weapon' | 'ammo' | 'med' | 'armor' | 'mod' | 'loot';

export interface ItemDef {
	name: string;
	kind: ItemKind;
	/** What the trader pays for one. */
	value: number;
	/** Pack slots one stack takes. */
	size: number;
	/** How many fit in one stack. */
	stack: number;
	color: string;
}

export interface WeaponDef {
	damage: number;
	/** Seconds between two shots. */
	interval: number;
	mag: number;
	caliber: string;
	/** Hold the trigger to keep firing. */
	auto: boolean;
	/** Radians of random cone, and how much each shot widens it (it settles back with time). */
	spread: number;
	bloom: number;
	range: number;
	/** How far a shot is heard. */
	noise: number;
	reload: number;
	/** Muzzle length and body colour, for the model on the gun. */
	length: number;
}

export const ITEMS: Record<string, ItemDef> = {
	pistol: { name: 'Pistol', kind: 'weapon', value: 600, size: 1, stack: 1, color: '#94a3b8' },
	smg: { name: 'Submachine Gun', kind: 'weapon', value: 1800, size: 2, stack: 1, color: '#64748b' },
	ammo9: { name: '9mm Rounds', kind: 'ammo', value: 2, size: 1, stack: 60, color: '#facc15' },
	medkit: { name: 'Medkit', kind: 'med', value: 300, size: 1, stack: 3, color: '#ef4444' },
	armor1: { name: 'Light Vest', kind: 'armor', value: 900, size: 2, stack: 1, color: '#475569' },
	armor2: { name: 'Plate Carrier', kind: 'armor', value: 2600, size: 2, stack: 1, color: '#334155' },
	suppressor: { name: 'Suppressor', kind: 'mod', value: 700, size: 1, stack: 1, color: '#475569' },
	scrap: { name: 'Scrap Metal', kind: 'loot', value: 40, size: 1, stack: 4, color: '#a8a29e' },
	circuit: { name: 'Circuit Board', kind: 'loot', value: 140, size: 1, stack: 2, color: '#22c55e' },
	radio: { name: 'Field Radio', kind: 'loot', value: 320, size: 2, stack: 1, color: '#3b82f6' },
	intel: { name: 'Intel Folder', kind: 'loot', value: 450, size: 1, stack: 1, color: '#f59e0b' },
	gold: { name: 'Gold Bar', kind: 'loot', value: 1200, size: 1, stack: 1, color: '#fde047' }
};

export const WEAPONS: Record<string, WeaponDef> = {
	pistol: { damage: 24, interval: 0.22, mag: 12, caliber: 'ammo9', auto: false, spread: 0.01, bloom: 0.004, range: 70, noise: 25, reload: 1.4, length: 0.1 },
	smg: { damage: 14, interval: 0.085, mag: 30, caliber: 'ammo9', auto: true, spread: 0.018, bloom: 0.0025, range: 60, noise: 35, reload: 1.9, length: 0.17 }
};

/** Armour: the fraction of damage it stops. */
export const ARMOR: Record<string, number> = { armor1: 0.2, armor2: 0.4 };
export const MEDKIT_HEAL = 45;

/** What a loot spot holds, by tier: `[item, weight, count]`. */
export const LOOT_TABLES: Record<number, ReadonlyArray<readonly [string, number, number]>> = {
	1: [['scrap', 5, 2], ['ammo9', 4, 24], ['medkit', 2, 1], ['circuit', 2, 1]],
	2: [['circuit', 4, 1], ['radio', 2, 1], ['ammo9', 3, 30], ['medkit', 2, 1], ['armor1', 1, 1], ['intel', 1, 1]],
	3: [['intel', 4, 1], ['gold', 2, 1], ['armor2', 1, 1], ['smg', 1, 1], ['radio', 3, 1], ['ammo9', 2, 40]]
};

export interface EnemyDef {
	name: string;
	hp: number;
	/** Metres per second when walking a patrol and when closing on a target. */
	walk: number;
	run: number;
	/** How far and how wide (full angle, radians) it sees. */
	sight: number;
	fov: number;
	/** Seconds it takes to aim (a laser shows meanwhile), then the burst. */
	telegraph: number;
	burst: number;
	burstGap: number;
	damage: number;
	/** Seconds between bursts: a range, picked at random. */
	cooldown: readonly [number, number];
	/** The distance it tries to keep from its target in a fight. */
	keep: number;
	radius: number;
	height: number;
	color: string;
	/** Bigger than a soldier by this much (1 when absent). */
	scale?: number;
	/** The share of damage its body stops; the head is not covered. */
	armorBody?: number;
	/** Bites instead of shooting, from this close. */
	melee?: number;
}

export const ENEMIES: Record<string, EnemyDef> = {
	soldier: { name: 'Soldier', hp: 60, walk: 1.5, run: 3.2, sight: 26, fov: 2.4, telegraph: 0.7, burst: 3, burstGap: 0.12, damage: 9, cooldown: [1.1, 2.1], keep: 11, radius: 0.35, height: 1.8, color: '#78716c' },
	heavy: { name: 'Heavy', hp: 220, walk: 1.1, run: 1.9, sight: 24, fov: 2.2, telegraph: 0.8, burst: 8, burstGap: 0.09, damage: 8, cooldown: [1.4, 2.4], keep: 12, radius: 0.45, height: 2.3, color: '#7f1d1d', scale: 1.3, armorBody: 0.5 },
	dog: { name: 'Guard Dog', hp: 35, walk: 2.2, run: 5.4, sight: 14, fov: 3.2, telegraph: 0.9, burst: 0, burstGap: 0, damage: 9, cooldown: [1.1, 1.1], keep: 0, radius: 0.3, height: 0.8, color: '#7c5a3a', melee: 1.3 },
	turret: { name: 'Turret', hp: 80, walk: 0, run: 0, sight: 22, fov: 1.6, telegraph: 0.6, burst: 4, burstGap: 0.1, damage: 7, cooldown: [1.3, 1.9], keep: 0, radius: 0.4, height: 0.9, color: '#57534e' }
};

/** What enemies leave behind: a chance in one of dropping `[item, count]`. */
export const DROPS: Record<string, { chance: number; item: string; n: number }> = {
	soldier: { chance: 0.35, item: 'ammo9', n: 12 },
	heavy: { chance: 1, item: 'intel', n: 1 }
};

export const POOLS = { soldiers: 8, dogs: 3, turrets: 4, loot: 24, bags: 4, tracers: 10, guns: 4, shelves: 3, bunks: 3, desks: 3, pillars: 2, safes: 1 } as const;

/** What the trader sells, and how many of each come in one purchase. */
export const TRADER_STOCK: ReadonlyArray<{ id: string; n: number }> = [
	{ id: 'ammo9', n: 30 },
	{ id: 'medkit', n: 1 },
	{ id: 'pistol', n: 1 },
	{ id: 'smg', n: 1 },
	{ id: 'suppressor', n: 1 },
	{ id: 'armor1', n: 1 },
	{ id: 'armor2', n: 1 }
];
/** The trader sells for this much more than he pays; he pays an item's full value. */
export const MARKUP = 1.5;

/** Permanent improvements to the refuge, bought from the trader. `costs[level]` buys level + 1. */
export const UPGRADES: Record<string, { name: string; text: string; costs: readonly number[]; per: number }> = {
	pack: { name: 'Bigger pack', text: 'more pack slots', costs: [1500, 3500, 7000], per: 2 },
	case: { name: 'Secure case', text: 'more things kept when you die', costs: [3000, 7000], per: 1 },
	infirmary: { name: 'Infirmary', text: 'more health', costs: [2000, 4500, 9000], per: 10 }
};

/** What a new player starts with, and the loadout they will take into a raid until they choose another. */
export const DEFAULT_LOADOUT = { primary: 'smg', secondary: 'pistol', armor: 'best', ammo: 90, meds: 2, suppressor: false, case: [null, null, null] as (string | null)[] } as const;
export const AMMO_STEPS = [0, 30, 60, 90, 120, 180] as const;
