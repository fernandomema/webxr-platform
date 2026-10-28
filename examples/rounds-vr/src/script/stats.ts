import { CARDS, TUNING, type CardDef } from '../world/data.ts';

const T = TUNING;

/** What a fighter's gun and shield are before any card: every number a card can change. */
export const BASE = {
	damage: 1, hp: T.maxHp as number, ammo: T.ammo as number, reload: T.reload as number, reloadAdd: 0, interval: T.interval as number, speed: 1, gravity: 1, size: 0, spread: 0, bullets: 1, burst: 0, burstGap: 0.1,
	bounces: 0, bounceDamage: 1, bounceSpeed: 1, homing: 0, explode: 0, dot: 0, leech: 0, grow: 0, lives: 0, brawler: 0, pristine: 0, scavenger: 0, pact: 0, refresh: 0,
	blockReload: 0, blockHeal: 0, blockBlast: 0, echo: 0, blockTeleport: 0, blockCooldown: T.blockCooldown as number, blockCdAdd: 0, blockTime: T.blockTime as number,
	sim: 1, range: 0, drill: 0, ammoReg: 0, regen: 0, decay: 0, shieldsUp: 0, targetBounce: 0, noAutoReload: 0
};

export type Stats = typeof BASE & { reloadTime: number; blockCd: number };
type StatKey = keyof typeof BASE;

export const cardById = (id: string): CardDef | undefined => CARDS.find((c) => c.id === id);

/** The stats of a fighter that holds these cards: every multiplier, then every addition, then every switch, so the order never matters. */
export function computeStats(cardIds: readonly string[]): Stats {
	const s: Record<string, number> = { ...BASE };
	const cards = cardIds.map(cardById).filter((c): c is CardDef => Boolean(c));
	for (const c of cards) for (const k in c.mul ?? {}) s[k] *= c.mul![k];
	for (const c of cards) for (const k in c.add ?? {}) s[k] += c.add![k];
	for (const c of cards) for (const k in c.set ?? {}) s[k] = Math.max(s[k], c.set![k]);
	s.ammo = Math.max(1, Math.round(s.ammo));
	s.bullets = Math.max(1, Math.round(s.bullets));
	s.burst = Math.round(s.burst);
	s.bounces = Math.round(s.bounces);
	s.reloadTime = Math.max(0.2, s.reload + s.reloadAdd);
	s.blockCd = Math.max(0.4, s.blockCooldown + s.blockCdAdd);
	return s as Stats;
}

export type { StatKey };
