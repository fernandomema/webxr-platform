/**
 * ROUNDS VR: everything the game is made of that is data, not code. The director script gets these tables as JSON, so a number
 * changed here changes the game and the tests.
 *
 * Where the numbers come from. Everything is read from the shipped game (Rounds_Data of ROUNDS, Unity 2022.3 / Mono) by the tools in
 * `tools/`: the maps (`maps.json`: the colliders of the scenes level2…level71), the cards (`cards.json`: the prefabs' `Gun`, `Block` and
 * `CharacterStatModifiers`, the names and the texts) and the numbers of the body and the gun (below, each with where it was read).
 * 1 unit of the game is `SCALE` metres here: a blob (radius 0.636 units) is as wide as a person's torso, the maps are 71 × 40 units, and
 * every length, speed and acceleration is the game's times `SCALE`. Times are the game's own.
 */
import cardsFile from './cards.json' with { type: 'json' };
import mapsFile from './maps.json' with { type: 'json' };

export type Vec3 = [number, number, number];

/** Metres per unit of the game. */
export const SCALE = 0.6;
const S = SCALE;

export const TUNING = {
	/** Points to win a round and rounds to win the match (`GM_ArmsRace`'s own defaults). */
	pointsToWinRound: 2,
	roundsToWinGame: 5,
	/** `CharacterData.health`: 100. */
	maxHp: 100,
	/** `ProjectileHit.damage` of `Bullet_Base`: two hits kill. */
	damage: 55,
	/** `GunAmmo.maxAmmo` 3, `reloadTime` 2 s; `Gun.attackSpeed` 0.3 s between two shots. */
	ammo: 3,
	reload: 2,
	interval: 0.3,
	/** `Bullet_Base`: `MoveTransform.localForce.z` 50 units/s, gravity 100 units/s², and a push of 5 units/s up. */
	bulletSpeed: 50 * S,
	bulletGravity: 100 * S,
	bulletLift: 5 * S,
	/** How far from its path a bullet still counts as touching (a hit box has its own size). */
	bulletRadius: 0.1,
	bulletLife: 5,
	/** `Block.IsBlocking`: the shield holds for 0.3 s; `Block.cooldown`: 4 s until it can be raised again. */
	blockTime: 0.3,
	blockCooldown: 4,
	/** A player's hit box: a sphere around the torso (a hand's width bigger than the game's blob), centred a little below the eyes. */
	playerRadius: 0.45,
	playerChest: 0.3,
	/** The rival is the blob: `CircleCollider2D.radius` 0.53 × the prefab's scale 1.2. */
	botRadius: 0.636 * S,
	/** Hit by a bullet: held in place for `ProjectileHit.holdPlayerFor` 0.3 s, thrown back a little. */
	holdTime: 0.3,
	knockback: 14 * S,
	/** `OutOfBoundsHandler`: leaving the screen costs 51 HP and puts the fighter back. */
	outOfBoundsDamage: 51,
	/** The distances it likes to fight at. */
	botRangeMin: 4,
	botRangeMax: 12,
	/** Seconds. */
	countdown: 4,
	pointPause: 2.6,
	roundPause: 3.2,
	/** A player has this long to shoot a card before one is picked for them. */
	pickTimeout: 30,
	botPickDelay: 1.6,
	overPause: 10,
	/** Seconds a fighter that survives a lethal hit with Phoenix can not be hurt. */
	reviveGrace: 1.5,
	/** Blocking cards that hurt or heal. */
	blockBlastRadius: 4 * S,
	/** `Explosion` of `A_Explosion`: 30 damage in a radius of 4 units. */
	explosionDamage: 30,
	explosionRadius: 4 * S,
	/** How long the world slows down when someone dies (the game does the same with its `TimeHandler`). */
	slowMo: 0.5,
	slowMoScale: 0.25
} as const;

/**
 * How the rival's body moves: the game's own integrator, read from `PlayerVelocity`, `PlayerMovement`, `PlayerJump`, `Gravity` and
 * `CharacterData` (all lengths already in metres). Every 0.02 s: push 3.4 units/s along the input (0.8 of it in the air); fall faster the
 * longer since it touched ground, 20·t^1.5 units/s per step (t in seconds); a constant 0.4 units/s per step; and lose a fifth of the
 * speed (0.8 of it in the air). A jump is a push of 55 units/s up, 4.1 units high and 0.5 s long on the flat; against a wall, with the
 * input toward it, the body slides slowly and a jump throws it up and away.
 */
export const MOVEMENT = {
	step: 0.02,
	run: 3.4 * S,
	drag: 0.2,
	airControl: 0.8,
	fall: 20 * S,
	fallExponent: 1.5,
	gravity: 0.4 * S,
	jump: 55 * S,
	wallJumpUp: 0.8,
	wallJumpOut: 0.4,
	/** Surfaces within this angle of flat are ground; within 20° of vertical, walls. */
	groundAngle: 70,
	/** How close a wall is to be held. */
	wallReach: 0.12
} as const;

/**
 * The jump and the fall a human gets from the engine (`playerMovement`): the same height (4.1 units) and the same time up (0.22 s) as the
 * game's, with a constant gravity instead of the one that grows.
 */
export const HUMAN = {
	jumpHeight: 4.13 * S,
	timeUp: 0.22,
	/** The game's run speed (13.6 units/s) in metres per second. */
	runSpeed: 13.6 * S
};
export const HUMAN_JUMP_SPEED = (2 * HUMAN.jumpHeight) / HUMAN.timeUp;
export const HUMAN_GRAVITY = HUMAN_JUMP_SPEED / HUMAN.timeUp;

/** The arena is the screen of the game (`OutOfBoundsHandler`: x within ±35.56, y within ±20) with a little depth to move in z. */
export const ARENA = { halfX: 35.56 * S, minY: -20 * S, maxY: 20 * S, depth: 3 } as const;

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
	/** Degrees about z. */
	a: number;
}

export interface MapDef {
	/** The game's own scene: `Rounds_Data/level<N>`. */
	level: number;
	name: string;
	boxes: Box[];
	circles: { x: number; y: number; r: number }[];
	/** Two places to start from, for blue and for orange: the outer ones and the inner ones (SPAWN POINT 1 and 2, 3 and 4). Where the body's centre is. */
	spawns: [[number, number], [number, number]][];
}

interface MapFile {
	bounds: { x: number; y: number };
	maps: { level: number; boxes: number[][]; circles: number[][]; spawns: Record<string, number[]> }[];
}

/** The maps, as the game has them, in metres. */
export const MAPS: MapDef[] = (mapsFile as MapFile).maps.map((map, index) => {
	const at = (key: string): [number, number] => [map.spawns[key][0] * S, map.spawns[key][1] * S];
	return {
		level: map.level,
		name: `MAP ${String(index + 1).padStart(2, '0')}`,
		boxes: map.boxes.map(([x, y, w, h, a]) => ({ x: x * S, y: y * S, w: w * S, h: h * S, a })),
		circles: map.circles.map(([x, y, r]) => ({ x: x * S, y: y * S, r: r * S })),
		spawns: [
			[at('1'), at('2')],
			[at('3'), at('4')]
		]
	};
});

/**
 * The lobby is a room of its own, far from the arena along z: the menu panel in front of the arrival point. The match starts from the
 * menu and comes back to it.
 */
export const LOBBY = {
	/** Where a player arrives and stands to read the menu, facing +z. */
	spawn: [0, 0, 35] as Vec3,
	panel: { p: [0, 2.2, 39] as Vec3, width: 1280, height: 960, worldWidth: 3.8 },
	/** The two blob statues either side of the cabinet: they stand at ±x, on a pedestal whose top is at `top`, facing −z. */
	statues: { x: 3.9, z: 40.3, top: 0.62 }
};

/** Where the guns and shields wait, out of the way, until the match gives them to the players. */
export const WAITING: Vec3[] = [
	[0, -150, 0],
	[2, -150, 0]
];

/**
 * How hard the rival plays. It only knows what it sees: `reaction` is the time it needs after it sees the other fighter or a shot, `turn`
 * the speed its aim turns at (rad/s), `tolerance` how close to the target it must point before it fires and `pause` the most it waits (a random part
 * of it) between two shots; `block` and `dodge` are the
 * chance that it tries when a shot comes (it decides once for each shot, and times it badly now and then). Chosen in the menu.
 */
export const DIFFICULTY = [
	{ name: 'EASY', aimError: 0.11, aimErrorPerMetre: 0.004, reaction: 1.2, dodge: 0.1, block: 0.1, jump: 0.3, turn: 2.2, tolerance: 0.1, pause: 0.9 },
	{ name: 'NORMAL', aimError: 0.06, aimErrorPerMetre: 0.0022, reaction: 0.65, dodge: 0.25, block: 0.2, jump: 0.5, turn: 3.2, tolerance: 0.06, pause: 0.6 },
	{ name: 'HARD', aimError: 0.03, aimErrorPerMetre: 0.001, reaction: 0.4, dodge: 0.45, block: 0.35, jump: 0.65, turn: 6, tolerance: 0.04, pause: 0.25 }
] as const;

/** Rounds to win a match, chosen in the menu (the game's own is 5). */
export const LENGTHS = [3, 5] as const;

export type Rarity = 'common' | 'uncommon' | 'rare';

/**
 * A card changes a fighter's stats. `mul` multiplies, `add` adds and `set` switches something on; the stats of a fighter are
 * always worked out again from its list of cards (see `computeStats` in the script), so the order never matters.
 * `once` cards set a switch and make no sense twice.
 */
export interface CardDef {
	id: string;
	name: string;
	/** What the card says in words (the game's text), and the lines of numbers under it (`+70% DMG`, `-60% ATKSPD`…), green when good, red when not. */
	text: string;
	lines: { stat: string; amount: string; positive: boolean }[];
	rarity: Rarity;
	mul?: Record<string, number>;
	add?: Record<string, number>;
	set?: Record<string, number>;
	once?: boolean;
}

interface RealCard {
	name: string;
	text: string;
	rarity: Rarity;
	lines: { stat: string; amount: string; positive: boolean }[];
	gun?: Record<string, number>;
	block?: Record<string, number>;
	stats?: Record<string, number>;
}

/**
 * What each field of a card's `Gun` does to the stats of a fighter, the way `ApplyCardStats` applies it: `mul` the ones that are
 * multiplied, `add` the ones that are added.
 */
const GUN_MUL: Record<string, string> = { damage: 'damage', reloadTime: 'reload', attackSpeed: 'interval', projectileSpeed: 'speed', gravity: 'gravity', dmgMOnBounce: 'bounceDamage', speedMOnBounce: 'bounceSpeed', projectielSimulatonSpeed: 'sim' };
const GUN_ADD: Record<string, string> = { reloadTimeAdd: 'reloadAdd', ammo: 'ammo', numberOfProjectiles: 'bullets', bursts: 'burst', spread: 'spread', reflects: 'bounces', size: 'size', ammoReg: 'ammoReg', timeBetweenBullets: 'burstGap' };

/** What a card does that is not a number in a component (the game spawns an object for it): the effect, as the stat it sets. */
const EXTRA: Record<string, { set?: Record<string, number>; add?: Record<string, number>; once?: boolean }> = {
	'EXPLOSIVE BULLET': { set: { explode: 1 } },
	'TIMED DETONATION': { set: { explode: 1 } },
	HOMING: { set: { homing: 3 } },
	POISON: { set: { dot: 3 }, once: true },
	PARASITE: { set: { dot: 5 }, once: true },
	GROW: { add: { grow: 0.08 } },
	'TARGET BOUNCE': { set: { targetBounce: 1 }, once: true },
	'DRILL AMMO': { set: { drill: 7 * S } },
	'SHIELDS UP': { set: { shieldsUp: 1 }, once: true },
	TELEPORT: { set: { blockTeleport: 8 * S }, once: true },
	DECAY: { set: { decay: 4 }, once: true },
	BRAWLER: { set: { brawler: 3 }, once: true },
	'PRISTINE PERSEVERENCE': { set: { pristine: 1 }, once: true },
	SCAVENGER: { set: { scavenger: 1 }, once: true },
	REFRESH: { set: { refresh: 1 }, once: true },
	'TACTICAL RELOAD': { set: { blockReload: 1 }, once: true },
	'HEALING FIELD': { add: { blockHeal: 30 } },
	OVERPOWER: { add: { blockBlast: 0.15 } },
	'DEMONIC PACT': { set: { pact: 10 }, once: true },
	PHOENIX: { once: false }
};

/** The cards that can be played here. The rest need something this duel does not have (a body that can be slowed or pushed, a map object, a stun). */
const PLAYABLE = new Set([
	'AMMO REG', 'BARRAGE', 'BIG BULLET', 'BOUNCY', 'BRAWLER', 'BUCKSHOT', 'BURST', 'CAREFUL PLANNING', 'COMBINE', 'DECAY', 'DEFENDER', 'DEMONIC PACT', 'DRILL AMMO', 'ECHO',
	'EXPLOSIVE BULLET', 'FAST FORWARD', 'FASTBALL', 'FRENZY', 'GLASS CANNON', 'GROW', 'HEALING FIELD', 'HOMING', 'HUGE', 'LEECH', 'MAYHEM', 'MORE AMMO', 'MULTISHOT',
	'OVERCHARGE', 'OVERPOWER', 'PARASITE', 'PHOENIX', 'POISON', 'PRISTINE PERSEVERENCE', 'QUICK RELOAD', 'QUICK SHOT', 'REFRESH', 'RICCOCHET', 'SCAVENGER', 'SHIELDS UP',
	'SPRAY', 'STEADY SHOT', 'STRENGTH', 'TACTICAL RELOAD', 'TANK', 'TARGET BOUNCE', 'TELEPORT', 'TIMED DETONATION', 'TRICKSTER', 'WIND UP'
]);

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function convert(card: RealCard): CardDef {
	const mul: Record<string, number> = {};
	const add: Record<string, number> = {};
	const set: Record<string, number> = {};
	for (const [key, value] of Object.entries(card.gun ?? {})) {
		if (GUN_MUL[key]) mul[GUN_MUL[key]] = value;
		else if (GUN_ADD[key]) add[GUN_ADD[key]] = value;
		else if (key === 'destroyBulletAfter') set.range = value;
	}
	const stats = card.stats ?? {};
	if (stats.health) mul.hp = stats.health;
	if (stats.lifeSteal) add.leech = stats.lifeSteal;
	if (stats.respawns) add.lives = stats.respawns;
	if (stats.regen) add.regen = stats.regen;
	if (stats.automaticReload === 0) set.noAutoReload = 1;
	const block = card.block ?? {};
	if (block.cdMultiplier) mul.blockCooldown = block.cdMultiplier;
	if (block.cdAdd) add.blockCdAdd = block.cdAdd;
	if (block.additionalBlocks) set.echo = 1;
	const extra = EXTRA[card.name.toUpperCase()] ?? {};
	Object.assign(set, extra.set);
	for (const [key, value] of Object.entries(extra.add ?? {})) add[key] = (add[key] ?? 0) + value;
	// The explosion's size and damage are the game's `A_Explosion`.
	if (set.explode) set.explode = TUNING.explosionRadius;
	const once = extra.once ?? Boolean(set.echo);
	return {
		id: slug(card.name),
		name: card.name.toUpperCase(),
		text: card.text,
		lines: card.lines,
		rarity: card.rarity,
		...(Object.keys(mul).length ? { mul } : {}),
		...(Object.keys(add).length ? { add } : {}),
		...(Object.keys(set).length ? { set } : {}),
		...(once ? { once: true } : {})
	};
}

/** The cards of the game that can be played here, with the game's own numbers. */
export const CARDS: CardDef[] = (cardsFile as RealCard[]).filter((card) => PLAYABLE.has(card.name.toUpperCase())).map(convert);

/** How likely a rarity is to be offered. */
export const RARITY_WEIGHT: Record<Rarity, number> = { common: 10, uncommon: 4, rare: 1.5 };
export const RARITY_COLOR: Record<Rarity, string> = { common: '#cbd5e1', uncommon: '#38bdf8', rare: '#f0abfc' };
/** The background of a card of each rarity. */
export const RARITY_BG: Record<Rarity, string> = { common: '#1f2937', uncommon: '#0c4a6e', rare: '#581c87' };

export const TEAM = [
	{ name: 'BLUE', color: '#38bdf8', dark: '#0c4a6e' },
	{ name: 'ORANGE', color: '#fb923c', dark: '#7c2d12' }
] as const;

/** Slots the game pools: they are made once and moved, never created while playing. */
/** `bullets` is for each side. */
export const POOLS = { bullets: 40, cards: 3, numbers: 8 } as const;

/** What the HUD and the guns are drawn at, in the units their scripts write: the HUD's bars are this many pixels wide when full, and the bars on a gun and a shield are this big in metres. */
export const HUD_BAR = 340;
/** How many lines of numbers a card shows (`+70% DMG`…): the most any card has. */
export const CARD_LINES = 5;
export const BAR = {
	gun: { width: 0.06, height: 0.006, depth: 0.02, y: 0.0605, hpZ: 0.045, ammoZ: 0.075, reloadZ: 0.105 },
	shield: { width: 0.3, height: 0.014, depth: 0.014, y: 0.27, z: 0.05 }
} as const;
