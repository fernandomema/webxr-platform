import type { V3 } from './math.ts';
import type { CardDef } from '../world/data.ts';
import type { Stats } from './stats.ts';

/** Where a fighter's shot starts and which way it goes. */
export interface Shot {
	pos: V3;
	dir: V3;
}

/** Damage over time (Poison, Parasite, Decay): `rate` a second for `left` more seconds, dealt by fighter `owner`. */
export interface Dot {
	left: number;
	rate: number;
	owner: number;
}

/** What the rival thinks and does: the game's own body (see `MOVEMENT` in data.ts) steered by what it sees. */
export interface Bot {
	yaw: number;
	pitch: number;
	aim: V3;
	estVel: V3;
	leadScale: number;
	dropScale: number;
	seen: boolean;
	moving: boolean;
	acquireT: number;
	lastSeenAt: number;
	lastSeenPos: V3;
	searchX: number;
	searchT: number;
	grounded: boolean;
	grab: boolean;
	sinceGround: number;
	sinceWall: number;
	sinceJump: number;
	jumps: number;
	wallNx: number;
	strafe: number;
	strafeT: number;
	jumpT: number;
	flipT: number;
	flipSide: number;
	stuckT: number;
	lastJumpAt: number;
	dodgeCd: number;
	reactT: number;
	dir: number;
	progressT: number;
	progressX: number;
}

/** What the gun or the shield of a side tells (`scriptState` of its brain). */
export interface HandState {
	seq?: number;
	down?: boolean;
	equipped?: boolean;
	playerId?: string;
	name?: string;
	hand?: 'left' | 'right';
}

/** Everything a fighter is, a player or the rival: `pos` is the middle of the body (what a bullet aims at), `vel` the game's own velocity. */
export interface Fighter {
	i: number;
	human: boolean;
	playerId: string | null;
	name: string;
	cards: string[];
	stats: Stats;
	hp: number;
	maxHp: number;
	ammo: number;
	ammoFrac: number;
	reloading: boolean;
	reloadT: number;
	cd: number;
	burstLeft: number;
	burstT: number;
	blockT: number;
	blockCd: number;
	echoT: number;
	graceT: number;
	brawlT: number;
	livesLeft: number;
	dots: Dot[];
	dead: boolean;
	pos: V3;
	head: V3;
	vel: V3;
	shieldSeq: number;
	trigger: boolean;
	shown: Record<string, number | string>;
	flashT: number;
	hurtT: number;
	holdT: number;
	squashT: number;
	lastHitAt: number;
	emptyAt: number;
	hudPos: V3 | null;
	gunState: HandState;
	shieldState: HandState;
	equipped: boolean;
	bot: Bot;
}

export interface Plan {
	at: number;
	block: boolean;
	dodge: boolean;
	lead: number;
}

export interface Bullet {
	n: number;
	alive: boolean;
	owner: number;
	pos: V3;
	vel: V3;
	life: number;
	damage: number;
	bounces: number;
	bounceDamage: number;
	bounceSpeed: number;
	homing: number;
	explode: number;
	dot: number;
	grow: number;
	gravity: number;
	sim: number;
	radius: number;
	travelled: number;
	source: number;
	drill: number;
	targetBounce: number;
	plan: Plan | null;
}

export interface FloatingNumber {
	n: number;
	alive: boolean;
	t: number;
	pos: V3;
}

export type Phase = 'menu' | 'ready' | 'loading' | 'countdown' | 'fight' | 'point' | 'pick' | 'between' | 'over';

export interface Game {
	phase: Phase;
	timer: number;
	round: number;
	map: number;
	variant: number;
	points: [number, number];
	rounds: [number, number];
	loser: number;
	winner: number;
	message: string;
	short: string;
	status: string;
	offer: CardDef[];
	pickAt: number;
	spots?: CardSpot[];
	lobbySecs: number | null;
	roomSignature?: string;
	roomAt: number;
	starter?: string;
	orange: string | null;
	giveAt: [number, number];
	gives: [number, number];
	hold: number;
	/** What to do once the map that was asked for is built. */
	afterLoading: (() => void) | null;
}

export interface CardSpot {
	p: V3;
	yaw: number;
}

/** What a trace of the world finds: how far along the ray, and the way out of the surface. `bounds` when it is the edge of the arena. */
export interface TraceHit {
	t: number;
	normal: V3;
	bounds?: boolean;
}
