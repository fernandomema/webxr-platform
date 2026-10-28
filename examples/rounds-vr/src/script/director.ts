// The director of ROUNDS VR: the whole match is this script (it runs on the host; guests see the slots it moves).
//
// Rules (read from the shipped game): two fighters, 2 points win a round, 5 rounds win the match. After a round the one who lost
// shoots a card out of three and gets stronger; both come back on a new map. The maps are the game's own (its colliders, turned and sized
// as the scenes have them, built from a fragment when the map is played), a side view with a little depth. What flies, hits or is blocked is asked
// of the engine's own solids (`ctx.physics`); the rival's body is the game's own integrator (see `MOVEMENT` in data.ts).
import { defineScript } from '@kithin/engine/script';
import { BAR, CARDS, CARD_LINES, DIFFICULTY, HUD_BAR, LENGTHS, LOBBY, MAPS, MOVEMENT, POOLS, RARITY_COLOR, RARITY_WEIGHT, SCALE, TEAM, TUNING, WAITING, ARENA, type CardDef } from '../world/data.ts';
import { CARD, HUD } from '../world/hud.ts';
import { ID } from '../world/kit.ts';
import { layoutOf } from '../world/layout.ts';
import { LOBBY_SKY, STYLE_DATA, type Sky } from '../world/style.ts';
import { add, angleBetween, clamp, cross, dot, flat, len, lookAlong, makeDice, mul, norm, qroll, qx, qyaw, rayBox3, segSeg, solveArc, sub, turnToward, type Q4, type V3 } from './math.ts';
import { computeStats } from './stats.ts';
import type { Bot, Bullet, CardSpot, Dot, Fighter, FloatingNumber, Game, HandState, Phase, Shot, TraceHit } from './types.ts';

/** The asset id of each sound of the game by name, written into the script when the world is built (the hash of the file in `static/content/audio`). */
declare const AUDIO: Record<string, string>;

const T = TUNING, A = ARENA, M = MOVEMENT, K = SCALE;
const PARKED: V3 = [0, -200, 0];
const COMMANDS = ID.commands;
const Z = A.depth / 2;

/**
 * What a query of the solids ignores: the walls of the arena (the script knows the arena's own edges), the pads under the fighters' feet and the
 * rival's body, which has colliders so that a hand can grab the model but is not a wall.
 */
const SHELL = ['rd-depth-n', 'rd-depth-s', 'rd-end-w', 'rd-end-e', 'rd-ceiling', ID.pad(0), ID.pad(1), ID.padRing(0), ID.padRing(1), ID.bot(0), ID.bot(1)];

export default defineScript((ctx) => {
	const rand = makeDice(Date.now());

	// ------------------------------------------------------------------------------------------------------------ ids of the parts
	const gunBrain = (i: number) => ID.gunPart(i, 'brain');
	const shieldBrain = (i: number) => ID.shieldPart(i, 'brain');

	// ------------------------------------------------------------------------------------------------------------------ state
	// What the menu has chosen.
	const menu = { rival: 1, length: 1 };
	const level = () => DIFFICULTY[menu.rival];
	const roundsToWin = () => LENGTHS[menu.length];

	const game: Game = {
		phase: 'menu',
		timer: 0,
		round: 1,
		map: 0,
		variant: 0,
		points: [0, 0],
		rounds: [0, 0],
		loser: -1,
		winner: -1,
		message: 'Choose how to play and press START',
		short: 'PRESS START',
		status: '',
		offer: [],
		pickAt: 0,
		lobbySecs: null,
		roomAt: 0,
		orange: null,
		giveAt: [-9, -9],
		gives: [0, 0],
		hold: 0,
		afterLoading: null
	};

	function makeFighter(i: number): Fighter {
		const bot: Bot = {
			yaw: i === 0 ? Math.PI / 2 : -Math.PI / 2, pitch: 0, aim: [i === 0 ? 1 : -1, 0, 0], estVel: [0, 0, 0], leadScale: 0.8, dropScale: 0, seen: false, moving: false, acquireT: 0,
			lastSeenAt: -99, lastSeenPos: [0, 0, 0], searchX: 0, searchT: 0, grounded: true, grab: false, sinceGround: 0, sinceWall: 9, sinceJump: 1, jumps: 1, wallNx: 0, strafe: 1,
			strafeT: 0, jumpT: 1, flipT: 0, flipSide: 1, stuckT: 0, lastJumpAt: -9, dodgeCd: 0, reactT: 0, dir: 0, progressT: 0, progressX: 0
		};
		return {
			i, human: false, playerId: null, name: TEAM[i].name, cards: [], stats: computeStats([]),
			hp: T.maxHp, maxHp: T.maxHp, ammo: T.ammo, ammoFrac: 0, reloading: false, reloadT: 0, cd: 0, burstLeft: 0, burstT: 0,
			blockT: 0, blockCd: 0, echoT: 0, graceT: 0, brawlT: 0, livesLeft: 0, dots: [], dead: false,
			pos: [0, 0, 0], head: [0, 1.6, 0], vel: [0, 0, 0],
			shieldSeq: 0, trigger: false, shown: {}, flashT: 0, hurtT: 0, holdT: 0, squashT: 0, lastHitAt: -9, emptyAt: -9, hudPos: null,
			gunState: {}, shieldState: {}, equipped: false, bot
		};
	}
	const fighters: [Fighter, Fighter] = [makeFighter(0), makeFighter(1)];
	const other = (f: Fighter): Fighter => fighters[1 - f.i];

	const bullets: Bullet[] = [];
	for (let n = 0; n < POOLS.bullets * 2; n++) {
		bullets.push({
			n, alive: false, owner: n < POOLS.bullets ? 0 : 1, pos: [0, 0, 0], vel: [0, 0, 0], life: 0, damage: 0, bounces: 0, bounceDamage: 1, bounceSpeed: 1, homing: 0, explode: 0, dot: 0, grow: 0,
			gravity: 0, sim: 1, radius: 0, travelled: 0, source: 0, drill: 0, targetBounce: 0, plan: null
		});
	}
	const numbers: FloatingNumber[] = [];
	for (let n = 0; n < POOLS.numbers; n++) numbers.push({ n, alive: false, t: 0, pos: [0, 0, 0] });

	let clock = 0;
	let boardsDirty = false;
	let lastFlush = -1;
	/** The world runs slower for a moment when someone falls: `ctx.time.setScale` slows what the script is given, the match's own timers run on the real time. */
	let slowT = 0;

	// ------------------------------------------------------------------------------------------------------------------- sound
	// Music and sounds play on every device, not only the host's: the host says what is going on in the hub's `scriptState` (the phase, and a
	// short queue of sounds with where they happened), and each device plays its own copy. Nothing here changes the game.
	interface Cue { n: number; name: string; pos?: V3; vol: number; rate: number }
	interface Shared { phase?: Phase; cues?: Cue[] }
	const shared = (): Shared => ((ctx.self.getComponent('scriptState') as { data?: Shared } | undefined)?.data) ?? {};
	const MUSIC: Partial<Record<Phase, string>> = { menu: 'lobby', ready: 'lobby', pick: 'lobby', loading: 'duel', countdown: 'duel', fight: 'duel', point: 'duel', between: 'duel' };
	const musicVolume: Record<string, number> = { lobby: 0.5, duel: 0.55 };
	const music: { name: string | null; handle: Promise<{ stop(): void; setVolume(v: number): void } | null> | null; asked: string | null } = { name: null, handle: null, asked: null };
	let heardCue = -1;
	/** Jingles are heard the same everywhere; the rest comes from where it happened. */
	const GLOBAL = new Set(['victory', 'defeat', 'point', 'down', 'card']);

	function play(name: string, options: Record<string, unknown>, pos?: V3): Promise<{ stop(): void; setVolume(v: number): void } | null> {
		const id = AUDIO[name];
		if (!id) return Promise.resolve(null);
		const source = { kind: 'asset' as const, assetId: id };
		const started = pos ? ctx.audio.playAt(source, pos, { refDistance: 4, maxDistance: 70, ...options }) : ctx.audio.playTrack(source, options);
		return started.catch((error: unknown) => { ctx.log('audio: ' + name + ': ' + (error instanceof Error ? error.message : String(error))); return null; });
	}

	/** Follows the phase with the right music, and plays each sound the host has called since the last frame. */
	function soundTick(): void {
		const state = shared();
		const wanted = (state.phase && MUSIC[state.phase]) || null;
		if (wanted !== music.asked) {
			music.asked = wanted;
			const old = music.handle;
			music.handle = null; music.name = null;
			if (old) void old.then((h) => h?.stop());
			if (wanted) { music.name = wanted; music.handle = play(wanted, { loop: true, volume: musicVolume[wanted] }); }
		}
		const queue = state.cues ?? [];
		const newest = queue.reduce((m, c) => Math.max(m, c.n), 0);
		if (heardCue < 0) { heardCue = newest; return; }
		for (const c of queue) {
			if (c.n <= heardCue) continue;
			if (c.name === 'victory' || c.name === 'defeat') { const old = music.handle; if (old) void old.then((h) => h?.setVolume(0.12)); }
			void play(c.name, { volume: c.vol, rate: c.rate }, GLOBAL.has(c.name) ? undefined : c.pos);
		}
		heardCue = Math.max(heardCue, newest);
	}

	const cues: Cue[] = [];
	let cueCount = 0;
	let cuesDirty = false;
	/** The host calls a sound for everyone: a jingle (no place), or an effect heard from `pos`. */
	function cue(name: string, pos?: V3, vol = 0.8, rate = 1): void {
		cueCount += 1;
		cues.push({ n: cueCount, name, vol, rate: Math.round(rate * 1000) / 1000, ...(pos ? { pos: [Math.round(pos[0] * 100) / 100, Math.round(pos[1] * 100) / 100, Math.round(pos[2] * 100) / 100] as V3 } : {}) });
		while (cues.length > 12) cues.shift();
		cuesDirty = true;
	}
	/** A little variety in how often-heard sounds are pitched. */
	const vary = (spread = 0.06) => 1 + (rand() * 2 - 1) * spread;

	// ---------------------------------------------------------------------------------------------------------------- world io
	// A parked slot is left alone until it is placed again: moving it costs a transform update.
	const parkedIds = new Set<string>();
	const park = (id: string): void => {
		if (parkedIds.has(id)) return;
		parkedIds.add(id);
		ctx.world.setWorldPose(id, { position: PARKED }, false);
	};
	const place = (id: string, pose: { position?: V3; rotation?: Q4; scale?: V3 }): void => {
		parkedIds.delete(id);
		ctx.world.setWorldPose(id, pose, false);
	};
	const slotData = (id: string): HandState => {
		const slot = ctx.hierarchy.getSlot(id);
		const state = slot?.components.find((c) => c.type === 'scriptState') as { data?: HandState } | undefined;
		return state?.data ?? {};
	};
	const setField = (id: string, type: string, field: string, value: unknown): void => { ctx.world.setComponentField(id, type, field, value, false); };

	/** Text and colour changes are made quietly and sent together, as one difference, at most every 0.12 s (0.05 s when there is a sound to hear). */
	function flush(): void {
		if (cuesDirty) {
			cuesDirty = false;
			ctx.world.setComponentField(ID.director, 'scriptState', 'data', { ...shared(), cues }, false);
			boardsDirty = true;
		}
		if (!boardsDirty || clock - lastFlush < 0.05) return;
		boardsDirty = false;
		lastFlush = clock;
		ctx.world.flush();
	}

	function burstFx(pos: V3, color: string, count: number, ms: number): void {
		ctx.world.spawn({ name: 'Spark', position: pos, components: [{ type: 'particleBurst', color, count, durationMs: ms }, { type: 'expires', expiresAt: Date.now() + ms }] }, { ephemeral: true });
	}

	/** Makes a controller of a player buzz: what a shot, a hit or a shield feels like in the hand. */
	function buzz(f: Fighter, hand: 'left' | 'right' | 'both', intensity: number, durationMs: number): void {
		if (f.human && f.playerId) ctx.haptics.pulse(f.playerId, { hand, intensity, durationMs });
	}

	// ------------------------------------------------------------------------------------------------------- geometry/world
	// The blocks of the map in play are the solids of the world (`ctx.physics`): they stop bullets, sight and bodies, and they are as deep as the
	// arena. The edges of the arena (the glass ends, the ceiling and the void below) are the script's own.
	const query = { ignore: SHELL };
	const BOUNDS_LO: V3 = [-A.halfX, A.minY - 6, -Z], BOUNDS_HI: V3 = [A.halfX, A.maxY, Z];

	/** Whether any block of the game is at this point (with `margin` to spare). */
	function obstacleAt(x: number, y: number, margin: number): boolean {
		return ctx.physics.overlapSphere([x, y, 0], Math.max(margin, 0.001), query).length > 0;
	}

	/** The first block, wall or ceiling along a ray (what stops a bullet or sight); null when nothing does within `dist`. */
	function traceWorld(p: V3, d: V3, dist: number, throughBlocks = false): TraceHit | null {
		let best: TraceHit | null = null;
		const take = (hit: TraceHit | null) => { if (hit && hit.t <= dist && (!best || hit.t < best.t)) best = hit; };
		// The inside of the arena: leave it by the nearest face.
		for (let a = 0; a < 3; a++) {
			if (Math.abs(d[a]) < 1e-9) continue;
			const wall = d[a] > 0 ? BOUNDS_HI[a] : BOUNDS_LO[a];
			const t = (wall - p[a]) / d[a];
			const normal: V3 = [0, 0, 0];
			normal[a] = d[a] > 0 ? -1 : 1;
			take({ t: Math.max(0, t), normal, bounds: true });
		}
		if (!throughBlocks) {
			const hit = ctx.physics.raycast(p, d, dist, query);
			if (hit) take({ t: hit.t, normal: hit.normal as V3 });
		}
		return best;
	}

	function clearSight(from: V3, to: V3): boolean {
		const d = sub(to, from), distance = len(d);
		if (distance < 1e-6) return true;
		const hit = traceWorld(from, mul(d, 1 / distance), distance);
		return !hit || hit.t >= distance - 0.05;
	}

	/** The body of a fighter as a sphere: a player's chest, the rival's blob. */
	const radiusOf = (f: Fighter) => (f.human ? T.playerRadius : T.botRadius);
	const centre = (f: Fighter): V3 => f.pos;

	// ------------------------------------------------------------------------------------------------------- the rival's body
	// The game's own integrator (PlayerVelocity, PlayerMovement, PlayerJump, Gravity, CharacterData), in metres: see `MOVEMENT` in data.ts.
	const GROUND_COS = Math.cos((M.groundAngle * Math.PI) / 180);

	/** Pushes a body of radius r out of every block it overlaps. Ground (a surface within 70° of flat) is stood on, not slid down; a wall holds the body off sideways. */
	function collideBody(f: Fighter): void {
		const b = f.bot, r = T.botRadius;
		let x = f.pos[0], y = f.pos[1], vx = f.vel[0], vy = f.vel[1];
		let ground = false;
		for (let pass = 0; pass < 4; pass++) {
			const [worst] = ctx.physics.overlapSphere([x, y, f.pos[2]], r, query);
			if (!worst) break;
			const nx = worst.normal[0], ny = worst.normal[1], pen = worst.depth;
			if (ny >= GROUND_COS) {
				y += Math.min(pen / ny, pen * 3 + 0.02);
				if (vy < 0) vy = 0;
				ground = true;
			} else {
				x += nx * pen; y += ny * pen;
				const vn = vx * nx + vy * ny;
				if (vn < 0) { vx -= vn * nx; vy -= vn * ny; }
			}
		}
		// The glass at the ends of the arena.
		if (x < -A.halfX + r) { x = -A.halfX + r; vx = Math.max(vx, 0); }
		if (x > A.halfX - r) { x = A.halfX - r; vx = Math.min(vx, 0); }
		if (y > A.maxY - r) { y = A.maxY - r; vy = Math.min(vy, 0); }
		f.pos = [x, y, f.pos[2]];
		f.vel = [vx, vy, 0];
		b.grounded = ground;
	}

	/** The wall beside the body, within reach: -1 (left), 1 (right) or 0, and the normal of it. */
	function wallBeside(f: Fighter): { side: number; nx: number } | null {
		const r = T.botRadius;
		for (const side of [-1, 1]) {
			for (const hit of ctx.physics.overlapSphere([f.pos[0] + side * M.wallReach, f.pos[1], f.pos[2]], r, query)) {
				if (Math.abs(hit.normal[1]) < GROUND_COS && hit.normal[0] * side < 0) return { side, nx: hit.normal[0] };
			}
		}
		return null;
	}

	/** One 0.02 s step of the body: the push along the input, the fall that gets faster the longer it is off the ground, the drag, and the blocks. */
	function bodyStep(f: Fighter): void {
		const b = f.bot, step = M.step;
		b.sinceJump += step;
		const wall = wallBeside(f);
		const grab = Boolean(wall) && !b.grounded && b.dir === wall!.side && f.holdT <= 0;
		if (grab) b.wallNx = wall!.nx;
		if (b.grounded) b.sinceGround = 0; else b.sinceGround += step * (grab ? 0.5 : 1);
		if (grab) b.sinceWall = 0; else b.sinceWall += step;
		b.grab = grab;
		const t = Math.min(b.sinceGround, b.sinceWall);
		let vx = f.vel[0], vy = f.vel[1];
		if (t > 0) vy -= M.fall * Math.pow(t, M.fallExponent);
		const air = b.grounded ? 1 : M.airControl;
		if (f.holdT <= 0) vx += b.dir * M.run * air;
		vx -= vx * M.drag * air;
		vy -= vy * M.drag * air;
		vy -= M.gravity;
		if (f.holdT > 0) { vx *= 0.3; vy *= 0.3; }
		f.vel = [vx, vy, 0];
		f.pos = [f.pos[0] + vx * step, f.pos[1] + vy * step, f.pos[2]];
		const wasGrounded = b.grounded, fall = -vy;
		collideBody(f);
		if (b.grounded && !wasGrounded && fall > 6 * K) landFx(f);
		if (b.grounded && b.sinceJump > 0.2) b.jumps = 1;
	}

	/** `PlayerJump.Jump`: from the ground or in the air once, or off a wall with a push away from it. */
	function botJump(f: Fighter): boolean {
		const b = f.bot;
		if (b.sinceJump < 0.1) return false;
		const wall = b.grab || b.sinceWall < 0.1;
		if (b.jumps <= 0 && !wall) return false;
		let vx = f.vel[0], vy = f.vel[1];
		if (vy < 0) vy = 0;
		if (wall && !b.grounded) {
			vy += M.jump * M.wallJumpUp;
			vx += M.jump * M.wallJumpOut * b.wallNx;
			b.jumps = 1;
		} else {
			vy += M.jump;
		}
		b.jumps -= 1;
		b.sinceGround = 0; b.sinceJump = 0; b.grounded = false; b.grab = false;
		f.vel = [vx, vy, 0];
		b.lastJumpAt = clock;
		jumpFx(f);
		return true;
	}

	/** Runs the body for `steps` of the game's fixed length (`ctx.time.fixed` says how many are due). */
	function moveBody(f: Fighter, steps: number): void {
		for (let n = 0; n < steps; n++) bodyStep(f);
	}

	// ------------------------------------------------------------------------------------------------------------ fighters
	function resetFighter(f: Fighter): void {
		f.stats = computeStats(f.cards);
		f.maxHp = f.stats.hp;
		f.hp = f.maxHp;
		f.ammo = f.stats.ammo;
		f.ammoFrac = 0;
		f.reloading = false; f.reloadT = 0; f.cd = 0.3; f.burstLeft = 0;
		f.blockT = 0; f.blockCd = 0; f.echoT = 0; f.graceT = 0; f.brawlT = 0; f.holdT = 0; f.squashT = 0;
		f.livesLeft = f.stats.lives;
		f.dots = [];
		f.dead = false;
		f.trigger = false;
	}

	function startReload(f: Fighter): void {
		if (f.reloading || f.ammo >= f.stats.ammo || f.dead) return;
		f.reloading = true;
		f.reloadT = f.stats.reloadTime;
		if (f.human) { cue('reload', centre(f), 0.5, vary()); buzz(f, 'both', 0.25, 60); }
	}

	function blockReady(f: Fighter): boolean { return !f.dead && f.blockT <= 0 && f.blockCd <= 0 && (game.phase === 'fight' || game.phase === 'pick'); }

	/** Raises the shield: nothing hurts for `blockTime`, then it takes `blockCooldown` to come back. Cards add what happens when it goes up. */
	function startBlock(f: Fighter): void {
		if (!blockReady(f)) return;
		const s = f.stats;
		f.blockT = s.blockTime;
		f.blockCd = s.blockCd;
		const c = centre(f);
		cue('block', c, 0.5, vary());
		burstFx(c, TEAM[f.i].color, 24, 400);
		buzz(f, f.shieldState.hand === 'left' ? 'left' : 'right', 0.6, 120);
		if (s.blockReload) { f.ammo = s.ammo; f.reloading = false; }
		if (s.blockHeal) f.hp = Math.min(f.maxHp, f.hp + s.blockHeal);
		if (s.blockBlast) {
			const foe = other(f);
			if (!foe.dead && len(sub(centre(foe), c)) <= T.blockBlastRadius) {
				burstFx(centre(foe), '#fb7185', 40, 600);
				damage(foe, f.maxHp * s.blockBlast, f, { ignoreBlock: true });
			}
		}
		if (s.blockTeleport) teleportForward(f, s.blockTeleport);
		if (s.echo) f.echoT = 0.7;
	}

	function teleportForward(f: Fighter, distance: number): void {
		// In a side view forward is left or right along the map: the way the fighter faces.
		const forward = f.human ? humanForward(f)[0] : Math.sin(f.bot.yaw);
		const dir = forward === 0 ? (f.i === 0 ? 1 : -1) : Math.sign(forward);
		const x = clamp(f.pos[0] + dir * distance, -A.halfX + 1, A.halfX - 1);
		if (obstacleAt(x, f.pos[1], radiusOf(f) + 0.05)) return;
		const to: V3 = [x, f.pos[1], f.pos[2]];
		if (f.human && f.playerId) ctx.world.teleportPlayer(f.playerId, { position: [x, f.pos[1] - T.playerChest - 1.25, f.pos[2]], yaw: Math.atan2(dir, 0) });
		else f.pos = to;
		burstFx(to, TEAM[f.i].color, 30, 500);
	}

	interface DamageOptions { ignoreBlock?: boolean; fromDot?: boolean; silent?: boolean; noNumber?: boolean }

	/**
	 * Hurts a fighter. A raised shield stops it, a Phoenix card brings the fighter back once, and what is dealt can heal, reload or
	 * recharge the one who dealt it (Leech, Scavenger, Refresh, Brawler). What a hit looks, sounds and feels like is `hitFeedback`.
	 */
	function damage(t: Fighter, amount: number, source: Fighter | null, options: DamageOptions = {}): boolean {
		if (t.dead || t.graceT > 0 || amount <= 0) return false;
		if (t.blockT > 0 && !options.ignoreBlock) return false;
		let d = amount;
		if (t.stats.pristine && t.hp > t.maxHp * 0.9) d *= 0.2;
		if (t.brawlT > 0) d /= 3;
		d = Math.min(d, t.hp);
		// Decay: what hurts is dealt over seconds, not at once.
		if (t.stats.decay > 0 && !options.fromDot && !options.silent) {
			t.dots.push({ left: t.stats.decay, rate: d / t.stats.decay, owner: source ? source.i : t.i });
			hitFeedback(t, d, source, options, false);
			return true;
		}
		t.hp -= d;
		if (source) {
			const s = source.stats;
			if (s.leech) source.hp = Math.min(source.maxHp, source.hp + d * s.leech);
			if (s.scavenger) { source.ammo = s.ammo; source.reloading = false; }
			if (s.refresh) source.blockCd = 0;
			if (s.brawler) source.brawlT = s.brawler;
		}
		const lethal = t.hp <= 0.0001;
		if (!options.silent) hitFeedback(t, d, source, options, lethal);
		if (lethal) {
			if (t.livesLeft > 0) {
				t.livesLeft -= 1;
				t.hp = t.maxHp * 0.5;
				t.graceT = T.reviveGrace;
				burstFx(centre(t), '#fde047', 80, 900);
				cue('bounce', centre(t), 0.7, 0.6);
			} else {
				t.dead = true;
				die(t);
			}
		}
		return true;
	}

	/**
	 * What the game does when a bullet lands: the hit stops the one it hits for a moment and throws them back a little, a number floats up, and
	 * everyone hears it from where it happened. A player feels it: a push away from the shot (`setPlayerVelocity`) and a buzz in both hands.
	 */
	function hitFeedback(t: Fighter, d: number, source: Fighter | null, options: DamageOptions, lethal: boolean): void {
		const c = centre(t);
		t.hurtT = 0.4;
		t.lastHitAt = clock;
		const away = source ? Math.sign(c[0] - source.pos[0]) || 1 : 1;
		if (t.human) {
			t.flashT = 0.22;
			if (t.playerId && !lethal) ctx.world.setPlayerVelocity(t.playerId, [away * T.knockback, T.knockback * 0.3, 0], { add: true });
			buzz(t, 'both', lethal ? 1 : 0.8, lethal ? 300 : 140);
		}
		if (!t.human && !lethal) {
			t.holdT = T.holdTime;
			t.squashT = 0.22;
			t.vel = [away * T.knockback, T.knockback * 0.3, 0];
		}
		burstFx(c, '#f87171', 30, 450);
		cue('hit', c, 0.6, vary(0.08));
		if (!options.noNumber) popNumber(c, '-' + Math.round(d), '#f87171');
		if (source && source.human) buzz(source, source.gunState.hand === 'left' ? 'left' : 'right', 0.35, 50);
	}

	function die(t: Fighter): void {
		const c = centre(t);
		burstFx(c, TEAM[t.i].color, 160, 1400);
		burstFx(c, '#ffffff', 60, 700);
		cue('kill', c, 0.9, 1);
		slowT = T.slowMo;
	}

	// ---------------------------------------------------------------------------------------------------------------- shooting
	/** Where a fighter's shot starts and which way it goes. A player fires from the muzzle of the gun in their hand (or from the eye on a desktop). */
	function muzzleOf(f: Fighter): Shot | null {
		if (f.human && f.playerId) {
			const pose = ctx.world.getPlayerPose(f.playerId);
			if (!pose) return null;
			const hand = slotData(gunBrain(f.i)).hand === 'left' ? pose.left : pose.right;
			const muzzle = ctx.hierarchy.getWorldPose(ID.gunPart(f.i, 'muzzle'));
			if (hand && muzzle) return { pos: muzzle.position as V3, dir: muzzle.forward as V3 };
			return { pos: add(pose.head.position, mul(pose.head.forward, 0.4)), dir: pose.head.forward as V3 };
		}
		return botAim(f);
	}

	function humanForward(f: Fighter): V3 {
		const pose = f.playerId ? ctx.world.getPlayerPose(f.playerId) : null;
		return pose ? (pose.head.forward as V3) : [f.i === 0 ? 1 : -1, 0, 0];
	}

	function tryFire(f: Fighter): boolean {
		if (f.dead || (game.phase !== 'fight' && game.phase !== 'pick')) return false;
		if (f.holdT > 0 && !f.human) return false;
		if (f.reloading || f.cd > 0 || f.burstLeft > 0) return false;
		if (f.ammo <= 0) {
			if (f.stats.noAutoReload && f.human) { if (clock - f.emptyAt > 0.4) { f.emptyAt = clock; cue('empty', centre(f), 0.5, 1); } return false; }
			startReload(f);
			return false;
		}
		const shot = muzzleOf(f);
		if (!shot) return false;
		f.ammo -= 1;
		f.cd = f.stats.interval;
		if (f.stats.pact) f.hp = Math.max(1, f.hp - f.stats.pact);
		volley(f, shot.pos, shot.dir);
		if (f.stats.burst > 0) { f.burstLeft = f.stats.burst; f.burstT = f.stats.burstGap; }
		if (f.ammo <= 0) {
			if (f.stats.shieldsUp) startBlock(f);
			if (!f.stats.noAutoReload) startReload(f);
		}
		return true;
	}

	/** A bullet leaves in a random direction within the card's spread of where the gun points (the game's own: the offset is across the line of fire, and it counts for less the faster the bullet). */
	function volley(f: Fighter, pos: V3, dir: V3): void {
		const s = f.stats;
		const right = norm(cross([0, 1, 0], dir)), up = cross(dir, right);
		const k = 2 / (1 + 0.5 * s.speed);
		for (let n = 0; n < s.bullets; n++) {
			const ox = (rand() * 2 - 1) * s.spread * k, oy = (rand() * 2 - 1) * s.spread * k;
			spawnBullet(f, pos, norm(add(dir, add(mul(right, ox), mul(up, oy)))));
		}
		burstFx(pos, TEAM[f.i].color, 8, 160);
		cue('shot', pos, 0.45, vary() * (1 - 0.04 * Math.min(s.bullets, 3)));
		if (f.human) buzz(f, f.gunState.hand === 'left' ? 'left' : 'right', 0.55, 45);
	}

	function spawnBullet(f: Fighter, pos: V3, dir: V3): void {
		const s = f.stats;
		const free = bullets.find((b) => !b.alive && b.owner === f.i);
		if (!free) return;
		Object.assign(free, {
			alive: true, pos: [...pos], vel: add(mul(dir, T.bulletSpeed * s.speed), [0, T.bulletLift * s.gravity, 0]), life: s.range > 0 ? s.range : T.bulletLife,
			damage: T.damage * s.damage, bounces: s.bounces, bounceDamage: s.bounceDamage, bounceSpeed: s.bounceSpeed, homing: s.homing, explode: s.explode, dot: s.dot, grow: s.grow,
			gravity: T.bulletGravity * s.gravity, sim: s.sim, radius: T.bulletRadius * (1 + s.size), travelled: 0, source: f.i, drill: s.drill, targetBounce: s.targetBounce, plan: null
		});
		drawBullet(free);
	}

	function drawBullet(b: Bullet): void {
		const d = b.radius * 2, speed = len(b.vel);
		place(ID.bullet(b.n), { position: b.pos, rotation: lookAlong(mul(b.vel, 1 / (speed || 1))), scale: [d, d, Math.max(d, Math.min(1.4, speed * 0.022))] });
	}

	function killBullet(b: Bullet): void {
		b.alive = false;
		park(ID.bullet(b.n));
	}

	/** One frame of a bullet: it falls, it may steer, and the stretch it flew is tested against the blocks and the other fighter. */
	function stepBullet(b: Bullet, dt: number): void {
		const dtE = dt * b.sim;
		b.life -= dtE;
		if (b.life <= 0) return killBullet(b);
		const owner = fighters[b.source], foe = other(owner);
		if (b.homing > 0 && !foe.dead && clearSight(b.pos, centre(foe))) {
			const want = norm(sub(centre(foe), b.pos)), have = norm(b.vel);
			const turn = Math.min(1, b.homing * dtE);
			b.vel = mul(norm(add(mul(have, 1 - turn), mul(want, turn))), len(b.vel));
		}
		b.vel[1] -= b.gravity * dtE;
		let remaining = dtE;
		for (let pass = 0; pass < 3 && remaining > 1e-6; pass++) {
			const speed = len(b.vel);
			const dir = mul(b.vel, 1 / speed);
			const dist = speed * remaining;
			const wall = traceWorld(b.pos, dir, dist, b.drill > 0);
			const reach = wall ? Math.min(wall.t, dist) : dist;
			const end = add(b.pos, mul(dir, reach));
			if (game.phase === 'pick' && pickCardHit(b, b.pos, end)) return killBullet(b);
			if (game.phase === 'fight' && fighterHit(b, owner, b.pos, end)) return;
			b.travelled += reach;
			b.drill = Math.max(0, b.drill - reach);
			b.pos = end;
			if (!wall || wall.t > dist) break;
			remaining -= reach / speed;
			if (b.pos[1] < A.minY - 5) return killBullet(b);
			if (b.bounces > 0) {
				b.bounces -= 1;
				b.vel = sub(b.vel, mul(wall.normal, 2 * dot(b.vel, wall.normal)));
				b.vel = mul(b.vel, b.bounceSpeed);
				b.damage *= b.bounceDamage;
				b.pos = add(b.pos, mul(wall.normal, 0.02));
				if (b.targetBounce && !foe.dead && clearSight(b.pos, centre(foe))) b.vel = mul(norm(sub(centre(foe), b.pos)), len(b.vel));
				burstFx(b.pos, '#fde68a', 8, 250);
				cue('bounce', b.pos, 0.25, vary(0.1));
				continue;
			}
			burstFx(b.pos, TEAM[b.source].color, 10, 300);
			cue('land', b.pos, 0.3, 1.5);
			if (b.explode > 0) explode(b, b.pos);
			return killBullet(b);
		}
		drawBullet(b);
	}

	/** Tests the stretch a bullet flew this frame against the other fighter; true when it hit or was blocked. */
	function fighterHit(b: Bullet, owner: Fighter, from: V3, to: V3): boolean {
		const target = other(owner);
		if (target.dead) return false;
		const c = centre(target);
		const raised = target.blockT > 0;
		const reach = (raised ? 0.95 : radiusOf(target)) + b.radius;
		const hit = segSeg(from, to, c, c);
		if (hit.d2 > reach * reach) return false;
		const point = add(from, mul(sub(to, from), hit.s));
		if (raised) {
			burstFx(point, '#67e8f9', 20, 350);
			cue('block', point, 0.45, 1.4);
			popNumber(point, 'BLOCK', '#67e8f9');
			buzz(target, target.shieldState.hand === 'left' ? 'left' : 'right', 0.9, 90);
			target.squashT = 0.15;
		} else {
			const total = b.damage * (1 + b.grow * b.travelled);
			if (b.dot > 0 && target.graceT <= 0) delayDamage(target, owner, total, b.dot);
			else damage(target, total, owner);
			if (b.explode > 0) explode(b, point);
		}
		killBullet(b);
		return true;
	}

	/** Poison and Parasite: the bullet's damage arrives over `seconds` instead of at once. */
	function delayDamage(target: Fighter, owner: Fighter, total: number, seconds: number): void {
		target.dots.push({ left: seconds, rate: total / seconds, owner: owner.i } satisfies Dot);
		hitFeedback(target, 0, owner, { noNumber: true }, false);
		popNumber(centre(target), '-' + Math.round(total), '#f87171');
	}

	function explode(b: Bullet, point: V3): void {
		const owner = fighters[b.source], foe = other(owner);
		burstFx(point, '#fb923c', 90, 700);
		cue('explosion', point, 0.8, vary(0.05));
		if (foe.dead) return;
		const d = len(sub(centre(foe), point));
		if (d <= b.explode) damage(foe, T.explosionDamage * (b.damage / T.damage), owner);
	}

	// ------------------------------------------------------------------------------------------------------------------ cards
	const weightOf = (card: CardDef): number => RARITY_WEIGHT[card.rarity];

	/** Three different cards, drawn by rarity; a card that only switches something on is not offered to a fighter who already has it. */
	function drawOffer(f: Fighter): CardDef[] {
		const pool = CARDS.filter((c) => !(c.once && f.cards.includes(c.id)));
		const offer: CardDef[] = [];
		while (offer.length < POOLS.cards && pool.length > 0) {
			let roll = rand() * pool.reduce((sum, c) => sum + weightOf(c), 0);
			let index = 0;
			for (; index < pool.length - 1; index++) { roll -= weightOf(pool[index]); if (roll <= 0) break; }
			offer.push(pool.splice(index, 1)[0]);
		}
		return offer;
	}

	const spawnOf = (i: number): V3 => { const s = MAPS[game.map].spawns[game.variant][i]; return [s[0], s[1], 0]; };
	const facingOf = (i: number): number => {
		const a = spawnOf(i), b = spawnOf(1 - i);
		return b[0] >= a[0] ? Math.PI / 2 : -Math.PI / 2;
	};

	/** Where the three cards hang: in front of the one who picks, high enough for a shot from the pad, where no block is. */
	function findCardSpots(loser: number): CardSpot[] {
		const spawn = spawnOf(loser), d = loser === 0 ? 1 : -1;
		const tries: [number, number][] = [[3.6, 0.9], [3.6, 2.2], [2.6, 1.2], [5, 1.4], [0, 3.2], [-3, 1.4]];
		let at: [number, number] = [spawn[0] + d * tries[0][0], spawn[1] + tries[0][1]];
		for (const [dx, dy] of tries) {
			const x = spawn[0] + d * dx, y = spawn[1] + dy;
			if (!obstacleAt(x, y, 1.1) && !obstacleAt(x, y + 0.8, 0.6) && !obstacleAt(x, y - 0.8, 0.6)) { at = [x, y]; break; }
		}
		return [0, 1, 2].map((n) => ({ p: [at[0], at[1], (n - 1) * 1.45] as V3, yaw: loser === 0 ? Math.PI / 2 : -Math.PI / 2 }));
	}
	const cardSpot = (loser: number, n: number): CardSpot => game.spots?.[n] ?? findCardSpots(loser)[n];

	const RARITY_LABEL = { common: 'COMMON', uncommon: 'UNCOMMON', rare: 'RARE' } as const;

	function placeCards(loser: number): void {
		game.spots = findCardSpots(loser);
		game.offer.forEach((card, n) => {
			const spot = game.spots![n];
			place(ID.card(n), { position: spot.p, rotation: qyaw(spot.yaw) });
			const color = RARITY_COLOR[card.rarity];
			setField(CARD(n, 'head'), 'uiElement', 'background', color);
			setField(CARD(n, 'name'), 'uiElement', 'text', card.name);
			setField(CARD(n, 'art'), 'uiElement', 'background', color);
			setField(CARD(n, 'letter'), 'uiElement', 'text', card.name.charAt(0));
			setField(CARD(n, 'rarity'), 'uiElement', 'text', RARITY_LABEL[card.rarity]);
			setField(CARD(n, 'rarity'), 'uiElement', 'color', color);
			setField(CARD(n, 'text'), 'uiElement', 'text', (card.text || '').slice(0, 110));
			for (let k = 0; k < CARD_LINES; k++) {
				const line = card.lines[k];
				setField(CARD(n, 'line' + k), 'uiElement', 'text', line ? line.amount + ' ' + line.stat : '');
				setField(CARD(n, 'line' + k), 'uiElement', 'color', line && !line.positive ? '#f87171' : '#4ade80');
			}
		});
		boardsDirty = true;
	}

	function parkCards(): void {
		for (let n = 0; n < POOLS.cards; n++) park(ID.card(n));
	}

	/** A bullet that crosses a card picks it. */
	function pickCardHit(b: Bullet, from: V3, to: V3): boolean {
		if (b.source !== game.loser) return false;
		const dir = sub(to, from), distance = len(dir);
		if (distance < 1e-6) return false;
		const unit = mul(dir, 1 / distance);
		for (let n = 0; n < game.offer.length; n++) {
			const spot = cardSpot(game.loser, n);
			if (rayBox3(from, unit, spot.p, [0.15, 1.8, 1.2], distance)) { pickCard(n); return true; }
		}
		return false;
	}

	function pickCard(n: number): void {
		if (game.phase !== 'pick' || !game.offer[n]) return;
		const f = fighters[game.loser];
		const card = game.offer[n];
		f.cards.push(card.id);
		f.stats = computeStats(f.cards);
		burstFx(cardSpot(game.loser, n).p, RARITY_COLOR[card.rarity], 80, 800);
		cue('click', cardSpot(game.loser, n).p, 0.6, 0.7);
		parkCards();
		game.offer = [];
		game.round += 1;
		say(TEAM[f.i].name + ' takes ' + card.name);
		announceAll(card.name, TEAM[f.i].name + ' takes it', 2.2, 'gold');
		cue('card');
		enter('between', T.roundPause);
	}

	// ------------------------------------------------------------------------------------------------------------------ the rival
	// The rival is a body like a player's (the game's own: it runs, falls, jumps and, jumping again against a wall, climbs it). It only knows what it
	// sees: the other fighter when nothing is in the way (and a few seconds after), a shot when it is in view. Its aim turns at a limited
	// speed and it fires only when it points close enough to the target; it decides once for each shot whether to shield or dodge, and
	// times it with a human's slack. It aims the way a player has to: above the target, because a bullet falls.

	/** Where the rival would aim if it could turn instantly: where the target will be when the bullet gets there, and above it by what the bullet falls on the way. Null when it is too far to reach. */
	function botIdeal(f: Fighter): V3 | null {
		const b = f.bot, foe = other(f), s = f.stats;
		const from = centre(f), target = centre(foe);
		const v = T.bulletSpeed * s.speed, g = T.bulletGravity * s.gravity, lift = T.bulletLift * s.gravity;
		let t = len(sub(target, from)) / v, dir: V3 | null = null;
		for (let k = 0; k < 3; k++) {
			// What it guesses of the target's speed comes from what it has watched, and it never trusts it fully.
			const lead = add(target, mul(b.estVel, (t / s.sim) * b.leadScale));
			const need = sub(lead, from);
			const r = Math.hypot(need[0], need[2]) || 1e-6;
			// It does not judge the drop perfectly.
			const solution = solveArc(r, need[1], v, g * (0.92 + 0.16 * b.dropScale), lift);
			if (!solution) return null;
			t = solution.t;
			const a = (solution.deg * Math.PI) / 180;
			dir = norm([(need[0] / r) * Math.cos(a), Math.sin(a), (need[2] / r) * Math.cos(a)]);
		}
		return dir;
	}

	/** The shot: where the aim points now, with the cone of error of the level (worse far away and against a target that moves). */
	function botAim(f: Fighter): Shot {
		const b = f.bot, foe = other(f);
		const c = centre(f);
		const dist = len(sub(centre(foe), c));
		// Worse far away, against a target that moves, and while it runs or is in the air itself.
		const error = (level().aimError + level().aimErrorPerMetre * dist + 0.004 * len(b.estVel) / K + (b.moving ? 0.012 : 0)) * (b.grounded ? 1 : 1.8) * (0.5 + rand());
		const dir = b.aim;
		const right = norm(cross([0, 1, 0], dir)), up = cross(dir, right);
		const shot = norm(add(dir, add(mul(right, (rand() * 2 - 1) * error), mul(up, (rand() * 2 - 1) * error))));
		return { pos: add(c, mul(dir, T.botRadius + 0.2)), dir: shot };
	}

	/** How far down is the first block below a point: Infinity when there is none (the void). */
	function dropBelow(x: number, y: number): number {
		const hit = ctx.physics.raycast([x, y, 0], [0, -1, 0], 60, query);
		return hit ? hit.t : Infinity;
	}

	/** Whether the next step along `dir` would leave the ground for the void or a drop too long to be worth it. */
	function ledgeAhead(f: Fighter, dir: number): boolean {
		const x = f.pos[0] + dir * (T.botRadius + 0.9);
		return dropBelow(x, f.pos[1]) > 7;
	}

	/** Moves the rival one frame: decides where it wants to go along x (-1, 0, 1) and whether to jump, then lets the game's body do the rest. */
	function updateBot(f: Fighter, dt: number): void {
		const b = f.bot, foe = other(f);
		b.reactT -= dt; b.strafeT -= dt; b.jumpT -= dt; b.flipT -= dt; b.dodgeCd -= dt; b.acquireT -= dt;
		const me = centre(f), target = centre(foe);
		const distance = len(sub(target, me));
		// What it sees: the other fighter, when nothing is in the way.
		const sees = !foe.dead && distance < 90 && clearSight(me, target);
		if (sees) {
			if (!b.seen) { b.acquireT = level().reaction * (0.7 + rand() * 0.6); b.estVel = [0, 0, 0]; }
			// A guess of its speed from what it watches, a little late.
			if (Math.abs(b.lastSeenAt - (clock - dt)) < 1e-6) b.estVel = add(mul(b.estVel, 0.85), mul(sub(target, b.lastSeenPos), 0.15 / dt));
			b.lastSeenPos = target;
			b.lastSeenAt = clock;
		} else if (clock - b.lastSeenAt > 0.4) b.estVel = [0, 0, 0];
		b.seen = sees;
		// Its aim turns toward the target at the speed of the level; when it sees nothing it looks where it walks.
		// Out of range it keeps the gun pointed along the arc as far as it goes (and walks closer).
		const ideal: V3 = (sees && (botIdeal(f) || norm([target[0] - me[0], Math.max(0.2, target[1] - me[1] + 3), target[2] - me[2]]))) || norm([Math.sin(b.yaw), 0, Math.cos(b.yaw)]);
		b.aim = turnToward(b.aim, ideal, level().turn * dt);
		b.yaw = Math.atan2(b.aim[0], b.aim[2]);
		b.pitch = Math.asin(clamp(b.aim[1], -1, 1));
		// Before it reacts, or while it is held, it only stands.
		if (b.reactT > 0 || f.holdT > 0) { b.dir = 0; b.moving = false; return; }
		// Where it goes: to the other fighter while it sees it, to where it saw it last for a few seconds, then looking about the map.
		const lost = clock - b.lastSeenAt;
		let goal: V3;
		if (sees) goal = target;
		else if (lost < 5 && b.lastSeenAt > 0) goal = b.lastSeenPos;
		else {
			if (Math.abs(me[0] - b.searchX) < 2 || b.searchT <= 0) { b.searchX = (rand() * 2 - 1) * (A.halfX - 3); b.searchT = 6 + rand() * 4; }
			b.searchT -= dt;
			goal = [b.searchX, me[1], 0];
		}
		const dx = goal[0] - me[0];
		let dir: number, wandering = false;
		if (sees && distance < T.botRangeMin) dir = -Math.sign(target[0] - me[0]) || 1;
		else if (!sees || distance > T.botRangeMax) dir = Math.abs(dx) < 0.4 ? 0 : Math.sign(dx);
		else {
			if (b.strafeT <= 0) { b.strafe = rand() < 0.5 ? -1 : 1; b.strafeT = 0.8 + rand() * 1.6; }
			dir = b.strafe;
			wandering = true;
		}
		if (b.flipT > 0) dir = -b.flipSide;
		// It does not walk off into the void, or off a long drop, to weave or to back away: it turns.
		if (b.grounded && dir !== 0 && ledgeAhead(f, dir) && (wandering || (sees && distance < T.botRangeMin) || dropBelow(me[0] + dir * 3, me[1]) === Infinity)) dir = wandering ? -dir : 0;
		b.dir = dir;
		b.moving = dir !== 0;
		// Jumping: over what is in the way, up to where it is going, across a gap, and now and then so as not to be a target that stands.
		const wantsUp = goal[1] > me[1] + 1.0 || !sees;
		const wall = wallBeside(f);
		const pressed = dir !== 0 && wall && wall.side === dir;
		if (pressed) {
			if (b.grounded) botJump(f);
			else if (wantsUp && clock - b.lastJumpAt > 0.3) botJump(f);
			b.stuckT += dt;
		} else b.stuckT = Math.max(0, b.stuckT - dt);
		// A gap ahead on the way to the goal: jump it while it is still on the ground.
		if (b.grounded && dir !== 0 && !pressed && !wandering && dropBelow(me[0] + dir * 1.6, me[1]) > 2.5 && dropBelow(me[0] + dir * 5, me[1]) < 7) botJump(f);
		// No progress toward the goal for a while: try the other way round, jumping.
		b.progressT += dt;
		if (b.progressT > 2.2) {
			const moved = Math.abs(me[0] - b.progressX);
			b.progressT = 0; b.progressX = me[0];
			if (moved < 1.2 && dir !== 0 && !wandering) { b.flipT = 1.1; b.flipSide = dir; if (b.grounded) botJump(f); }
		}
		if (b.stuckT > 1.6) { b.stuckT = 0; b.flipT = 1; b.flipSide = dir; if (b.grounded) botJump(f); }
		if (b.grounded && b.jumpT <= 0) { b.jumpT = 1.2 + rand() * 2.4; if (rand() < level().jump) botJump(f); }
	}

	/** What the rival does about the shots it can see coming and about its own: it dodges, shields and fires. Runs in the fight only. */
	function botFight(f: Fighter, _dt: number): void {
		const b = f.bot, foe = other(f);
		const me = centre(f), target = centre(foe);
		const sees = b.seen;
		if ((b.acquireT > 0 && sees) || b.reactT > 0 || f.holdT > 0) return;
		// Shots: it only knows of the ones it can see coming, decides once for each whether to try anything, and does it a little late or early.
		for (const bullet of bullets) {
			if (!bullet.alive || bullet.owner === f.i) continue;
			const rel = sub(bullet.pos, me), speed2 = dot(bullet.vel, bullet.vel);
			if (dot(rel, bullet.vel) >= 0 || len(rel) > 45 || !clearSight(me, bullet.pos)) continue;
			if (!bullet.plan) {
				bullet.plan = {
					at: clock + level().reaction * 0.5 + rand() * 0.15,
					block: rand() < level().block,
					dodge: rand() < level().dodge,
					lead: 0.1 + rand() * 0.5
				};
			}
			if (clock < bullet.plan.at) continue;
			const t = clamp(-dot(rel, bullet.vel) / speed2, 0, 0.8);
			if (len(add(rel, mul(bullet.vel, t))) > 0.8) continue;
			if (bullet.plan.block && blockReady(f) && t < bullet.plan.lead) { startBlock(f); bullet.plan.block = false; break; }
			if (bullet.plan.dodge && b.dodgeCd <= 0 && t < 0.45) {
				if (b.grounded && rand() < 0.7) botJump(f);
				else { b.flipT = 0.5; b.flipSide = Math.sign(rel[0]) || 1; }
				b.dodgeCd = 1.2;
				bullet.plan.dodge = false;
			}
		}
		// Fire when it sees the other fighter and its aim has come round to it.
		const ideal = sees ? botIdeal(f) : null;
		if (ideal && b.acquireT <= 0 && f.cd <= 0 && !f.reloading && f.burstLeft === 0 && angleBetween(b.aim, ideal) < level().tolerance) {
			const aimPoint = botAim(f);
			// It does not empty its gun in a burst: between shots it hesitates, more at the easier levels.
			if (clearSight(aimPoint.pos, target) && tryFire(f)) f.cd += rand() * level().pause;
		}
	}

	// -------------------------------------------------------------------------------------------------------------- the match
	function say(message: string, short?: string): void {
		game.message = message;
		game.short = short || message.slice(0, 26);
	}

	function enter(phase: Phase, timer = 0): void {
		game.phase = phase;
		game.timer = timer;
		ctx.world.setComponentField(ID.director, 'scriptState', 'data', { ...shared(), phase }, false);
	}

	function readBrains(): void {
		for (const f of fighters) {
			const gun = slotData(gunBrain(f.i)), shield = slotData(shieldBrain(f.i));
			f.gunState = gun;
			f.shieldState = shield;
			f.equipped = Boolean(gun.equipped);
		}
	}

	function readCommands(): void {
		for (const slot of ctx.hierarchy.getChildren(COMMANDS)) {
			const state = slot.components.find((c) => c.type === 'scriptState') as { data?: { side?: number; player?: string; cmd?: string } } | undefined;
			const data = state?.data ?? {};
			ctx.world.deleteSlot(slot.id);
			const f = fighters[data.side ?? -1];
			if (!f || !f.human || f.playerId !== data.player) continue;
			if (data.cmd === 'reload') startReload(f);
			else if (data.cmd === 'block') startBlock(f);
			else if (data.cmd === 'quit') returnToMenu('You left the match. Press START to play again');
		}
	}

	let mapShown = -1;

	/** The sky of a map (or of the lobby): written into the world's skybox, quietly, and sent with the next flush. */
	function setSky(sky: Sky): void {
		setField('rd-sky', 'skybox', 'topColor', sky.top);
		setField('rd-sky', 'skybox', 'horizonColor', sky.horizon);
		setField('rd-sky', 'skybox', 'bottomColor', sky.bottom);
		setField('rd-sky', 'skybox', 'stars', sky.stars);
		setField('rd-sky', 'skybox', 'ambientIntensity', sky.ambient);
		setField('rd-sky', 'skybox', 'exposure', sky.exposure);
		setField('rd-sky', 'skybox', 'contrast', sky.contrast);
		setField('rd-sky', 'skybox', 'saturation', sky.saturation);
		setField('rd-sky', 'skybox', 'bloom', sky.bloom);
		boardsDirty = true;
	}

	/** Puts a map in play: its fragment is built (the one that was on is taken down) and its sky is the world's. */
	function setMap(m: number): void {
		game.map = m;
		if (mapShown === m) return;
		const old = mapShown;
		mapShown = m;
		if (old >= 0) ctx.world.setSlotEnabled(ID.map(old), false, false);
		ctx.world.setSlotEnabled(ID.map(m), true, false);
		setSky(STYLE_DATA[m].sky);
	}

	/** Whether the blocks of a map are in the world (the fragment is built a moment after the map is switched on). */
	function mapReady(m: number): boolean {
		const first = layoutOf(m)[0];
		return !first || Boolean(ctx.hierarchy.getSlot(ID.mapPart(m, first.id)));
	}

	/** Waits for the map that was asked for, for up to a few seconds, and then goes on with `then`. */
	function whenMapReady(then: () => void): void {
		game.afterLoading = then;
		enter('loading', 8);
	}

	function nextMap(): void {
		let m = game.map;
		while (m === game.map) m = Math.floor(rand() * MAPS.length);
		setMap(m);
	}

	function clearBullets(): void {
		for (const b of bullets) if (b.alive) killBullet(b);
	}

	/** Puts a fighter on its pad, facing the other one. */
	function toSpawn(f: Fighter): void {
		const spawn = spawnOf(f.i), yaw = facingOf(f.i);
		f.pos = [...spawn];
		f.vel = [0, 0, 0];
		f.head = [spawn[0], spawn[1] + T.playerChest, spawn[2]];
		const b = f.bot;
		b.yaw = yaw; b.pitch = 0; b.aim = [Math.sin(yaw), 0, Math.cos(yaw)]; b.estVel = [0, 0, 0]; b.seen = false; b.lastSeenAt = -99; b.acquireT = 0; b.searchX = 0; b.searchT = 0; b.leadScale = 0.6 + rand() * 0.4; b.dropScale = rand();
		b.grounded = true; b.sinceGround = 0; b.sinceWall = 9; b.sinceJump = 1; b.jumps = 1; b.flipT = 0; b.stuckT = 0; b.dir = 0; b.progressT = 0; b.progressX = spawn[0];
		// The pad under the feet.
		const floor = spawn[1] - T.botRadius + 0.03;
		place(ID.pad(f.i), { position: [spawn[0], floor, 0] });
		place(ID.padRing(f.i), { position: [spawn[0], floor - 0.005, 0] });
		if (f.human && f.playerId) ctx.world.teleportPlayer(f.playerId, { position: [spawn[0], spawn[1] - T.botRadius, spawn[2]], yaw });
	}

	/** Sets both fighters on their pads, full of health and ammo, and starts the countdown. */
	function beginPoint(variant?: number): void {
		clearBullets();
		game.variant = variant === 0 || variant === 1 ? variant : rand() < 0.5 ? 0 : 1;
		for (const f of fighters) {
			const gun = f.gunState;
			f.human = Boolean(gun.equipped) && Boolean(gun.playerId && ctx.world.getPlayerPose(gun.playerId));
			f.playerId = f.human ? gun.playerId ?? null : null;
			f.name = f.human ? gun.name || 'Player' : 'RIVAL';
			resetFighter(f);
			toSpawn(f);
			f.bot.reactT = level().reaction + 0.5;
			f.shown = {};
		}
		game.lobbySecs = null;
		enter('countdown', T.countdown);
	}

	function startMatch(): void {
		game.points = [0, 0];
		game.rounds = [0, 0];
		game.round = 1;
		game.winner = -1;
		game.loser = -1;
		for (const f of fighters) f.cards = [];
		nextMap();
		whenMapReady(() => beginPoint());
	}

	function pointWon(winner: number): void {
		game.points[winner] += 1;
		game.winner = winner;
		const f = fighters[winner];
		say(TEAM[winner].name + ' scores');
		enter('point', T.pointPause);
		cue(fighters[1 - winner].human && !fighters[winner].human ? 'down' : 'point');
		announceEach((x) => (x.i === winner ? ['POINT!', game.points[0] + ' - ' + game.points[1], 'go'] : ['DOWN', game.points[0] + ' - ' + game.points[1], 'bad']), 1.8);
		cue('bounce', centre(f), 0.6, 1.3);
	}

	function roundWon(winner: number): void {
		game.rounds[winner] += 1;
		game.points = [0, 0];
		if (game.rounds[winner] >= roundsToWin()) return matchOver(winner);
		startPick(1 - winner);
	}

	function startPick(loser: number): void {
		clearBullets();
		game.loser = loser;
		for (const f of fighters) {
			f.dead = false;
			f.hp = f.maxHp;
			f.ammo = f.stats.ammo;
			f.reloading = false;
			toSpawn(f);
		}
		game.offer = drawOffer(fighters[loser]);
		placeCards(loser);
		game.pickAt = T.botPickDelay;
		enter('pick', T.pickTimeout);
		say(TEAM[loser].name + ' lost the round: ' + (fighters[loser].human ? 'shoot a card' : 'choosing a card'));
		announceEach((f) => (f.i === loser ? ['SHOOT A CARD', 'one of the three', 'gold'] : ['ROUND WON', 'the other side is picking', 'go']), 3);
	}

	function matchOver(winner: number): void {
		game.winner = winner;
		say(TEAM[winner].name + ' WINS THE MATCH');
		cue(fighters[winner].human || !fighters.some((f) => f.human) ? 'victory' : 'defeat');
		announceEach((f) => (f.i === winner ? ['VICTORY', game.rounds[0] + ' - ' + game.rounds[1], 'gold'] : ['DEFEAT', game.rounds[0] + ' - ' + game.rounds[1], 'bad']), 6);
		enter('over', T.overPause);
		const spot = add(spawnOf(winner), [0, 3, 0]);
		burstFx(spot, TEAM[winner].color, 300, 2500);
	}

	const roundBanner = (): [string, string, string] => (game.points[0] + game.points[1] === 0 ? ['ROUND ' + game.round, STYLE_DATA[game.map].name + ' · ' + STYLE_DATA[game.map].place, 'info'] : ['POINT ' + (game.points[0] + game.points[1] + 1), game.points[0] + ' - ' + game.points[1], 'info']);

	function updateMatch(dt: number): void {
		game.timer -= dt;
		switch (game.phase) {
			case 'menu':
				break;
			case 'ready':
				updateReady(dt);
				break;
			case 'loading':
				if (mapReady(game.map) || game.timer <= 0) {
					const then = game.afterLoading;
					game.afterLoading = null;
					then?.();
				}
				break;
			case 'countdown': {
				const secs = Math.ceil(game.timer);
				if (secs !== game.lobbySecs) {
					game.lobbySecs = secs;
					if (secs >= T.countdown) announceEach(roundBanner, 1.4);
					else { announceAll(String(Math.max(1, secs)), '', 0.9); for (const f of fighters) if (f.human) cue('click', centre(f), 0.5, 1.6); }
					say(secs >= T.countdown ? 'Get ready' : String(Math.max(1, secs)));
				}
				if (game.timer <= 0) { enter('fight'); say('FIGHT'); announceAll('FIGHT!', '', 0.8, 'fight'); for (const f of fighters) if (f.human) cue('click', centre(f), 0.7, 2.2); }
				break;
			}
			case 'fight': {
				const [a, b] = fighters;
				if (a.dead && b.dead) { say('Draw'); enter('point', T.pointPause); game.winner = -1; }
				else if (a.dead) pointWon(1);
				else if (b.dead) pointWon(0);
				break;
			}
			case 'point':
				if (game.timer <= 0) {
					if (game.winner < 0) beginPoint();
					else if (game.points[game.winner] >= T.pointsToWinRound) roundWon(game.winner);
					else beginPoint();
				}
				break;
			case 'pick': {
				const f = fighters[game.loser];
				game.pickAt -= dt;
				if (!f.human && game.pickAt <= 0 && game.offer.length > 0) pickCard(Math.floor(rand() * game.offer.length));
				else if (game.timer <= 0 && game.offer.length > 0) pickCard(Math.floor(rand() * game.offer.length));
				break;
			}
			case 'between':
				if (game.timer <= 0) { nextMap(); whenMapReady(() => beginPoint()); }
				break;
			case 'over':
				if (game.timer <= 0) returnToMenu('Press START to play again');
				break;
		}
	}

	// ------------------------------------------------------------------------------------------------------------------ the menu
	const CHOSEN = '#f97316', CHOSEN_TEXT = '#1a0b00', CHIP = '#1e1748', CHIP_TEXT = '#c4b5fd', GO = '#22c55e', GO_TEXT = '#04260f', WAIT = '#475569', WAIT_TEXT = '#cbd5e1';
	const DEFAULT_STATUS = 'Your gear is given when you press START';

	/** Who is in the room, host first: the match is for the first two, and the rival takes the orange side when there is no second. */
	const people = () => ctx.world.getPlayers().slice().sort((a, b) => (a.role === 'host' ? -1 : 0) - (b.role === 'host' ? -1 : 0));

	/** Paints the menu with what is chosen and who is in the room, and says `status` under it. */
	function refreshMenu(status?: string): void {
		const room = people();
		const names = room.map((p) => p.name || 'Player');
		const chips = (name: string, count: number, chosen: number) => {
			for (let n = 0; n < count; n++) {
				setField(ID.ui(name + '-' + n), 'uiElement', 'background', n === chosen ? CHOSEN : CHIP);
				setField(ID.ui(name + '-' + n), 'uiElement', 'color', n === chosen ? CHOSEN_TEXT : CHIP_TEXT);
			}
		};
		chips('rival', DIFFICULTY.length, menu.rival);
		chips('match', LENGTHS.length, menu.length);
		const open = game.phase === 'menu';
		setField(ID.ui('start'), 'uiElement', 'background', open ? GO : WAIT);
		setField(ID.ui('start'), 'uiElement', 'color', open ? GO_TEXT : WAIT_TEXT);
		setField(ID.ui('start'), 'uiElement', 'text', open ? 'START' : 'GETTING READY…');
		// The two sides: the host is blue; the next in the room is orange, or the rival is.
		setField(ID.ui('p0'), 'uiElement', 'text', names[0] || 'Player');
		setField(ID.ui('p0-role'), 'uiElement', 'text', room.length >= 2 ? 'HOST' : 'YOU · HOST');
		if (room.length >= 2) {
			setField(ID.ui('p1'), 'uiElement', 'text', names[1]);
			setField(ID.ui('p1-role'), 'uiElement', 'text', room.length > 2 ? 'PLAYER · +' + (room.length - 2) + ' WATCHING' : 'PLAYER');
		} else {
			setField(ID.ui('p1'), 'uiElement', 'text', 'RIVAL BOT');
			setField(ID.ui('p1-role'), 'uiElement', 'text', 'LEVEL: ' + DIFFICULTY[menu.rival].name);
		}
		setField(ID.ui('invite'), 'uiElement', 'visible', room.length < 2);
		game.roomSignature = names.join('|');
		if (status !== undefined) game.status = status;
		setField(ID.ui('status'), 'uiElement', 'text', game.status);
		boardsDirty = true;
	}

	function playerOf(event: { remoteGuestId?: string }): string {
		return ctx.world.getPlayer(event.remoteGuestId ? event.remoteGuestId + ':right' : 'right').id;
	}

	const MENU_AT: V3 = [0, 2.2, 38.6];
	function click(high: boolean): void { cue('click', MENU_AT, 0.5, high ? 1.3 : 0.9); }

	function onMenuPress(slotId: string, event: { remoteGuestId?: string }): void {
		click(slotId === ID.ui('start'));
		// The invitation can be asked for any time before the match: while START is still getting the gear, too.
		if (slotId === ID.ui('invite') && (game.phase === 'menu' || game.phase === 'ready')) return invite(event);
		if (game.phase !== 'menu') return;
		const choice = /^rd-ui-(rival|match)-(\d)$/.exec(slotId);
		if (choice) {
			menu[choice[1] === 'match' ? 'length' : 'rival'] = Number(choice[2]);
			refreshMenu(DEFAULT_STATUS);
		} else if (slotId === ID.ui('start')) startPressed(playerOf(event));
	}

	/** The invitation is the engine's own menu: it asks who can join, hosts the session and shows the room code. It opens for the host. */
	function invite(event: { remoteGuestId?: string }): void {
		if (event.remoteGuestId) return refreshMenu('You are in someone else\'s room: the host invites');
		if (people().length >= 2) return refreshMenu('The room is full: press START');
		ctx.log('invite: opening the session menu');
		// The words first, so that there is an answer even where the menu cannot open.
		refreshMenu('Choose who can join in the menu that opens. If nothing opens, use the menu (Tab, or the menu button) > Session');
		try {
			ctx.ui.openDash('session', { invite: true });
		} catch (error) {
			ctx.log('invite: could not open the menu: ' + (error instanceof Error ? error.message : String(error)));
		}
	}

	/** START: the one who pressed is blue and the next in the room orange (the rival when there is none); the match begins when the gear is in the hands. */
	function startPressed(playerId: string): void {
		const others = people().filter((p) => p.id !== playerId);
		game.starter = playerId;
		game.orange = others.length > 0 ? others[0].id : null;
		game.giveAt = [-9, -9];
		game.gives = [0, 0];
		game.hold = 0;
		enter('ready', 25);
		refreshMenu('Getting the gear…');
		say('Getting ready', 'GETTING READY');
	}

	/** Puts a side's gun in the right hand and its shield in the left of a player. */
	function giveGear(side: number, playerId: string): void {
		if (clock - game.giveAt[side] < 0.5) return;
		game.giveAt[side] = clock;
		game.gives[side] += 1;
		ctx.world.equipPlayer(playerId, ID.gun(side), 'right');
		ctx.world.equipPlayer(playerId, ID.shield(side), 'left');
		// If the engine could not equip it, it is put where the player can take it (and equip it from the radial menu).
		if (game.gives[side] > 3) {
			const pose = ctx.world.getPlayerPose(playerId);
			if (pose) {
				const at = add(pose.head.position, mul(flat(pose.head.forward), 0.6));
				ctx.world.setWorldPose(ID.gun(side), { position: add(at, [0, -0.5, 0]) }, false);
				ctx.world.setWorldPose(ID.shield(side), { position: add(at, [0.3, -0.5, 0]) }, false);
			}
		}
	}

	function updateReady(dt: number): void {
		const [blue, orange] = fighters;
		if (!blue.equipped && game.starter) giveGear(0, game.starter);
		if (game.orange && !orange.equipped) giveGear(1, game.orange);
		const secondReady = !game.orange || orange.equipped;
		if (blue.equipped && secondReady) {
			game.hold += dt;
			if (game.hold > 1) startMatch();
			return;
		}
		game.hold = 0;
		let status = 'Getting the gear…';
		if (!blue.equipped && game.gives[0] > 3) status = 'Take the blue gun in front of you and equip it from the radial menu';
		else if (blue.equipped && !orange.equipped) status = game.gives[1] > 3 ? 'The second player takes the orange gun in front of them and equips it (' + Math.ceil(game.timer) + ' s)' : 'Getting the second player ready…';
		if (status !== game.status) refreshMenu(status);
		if (game.timer <= 0) {
			if (blue.equipped) { game.orange = null; startMatch(); }
			else { enter('menu'); refreshMenu('Could not get the gear. Press START to try again'); }
		}
	}

	/** The match is over, or someone left it: the gear is taken off and put away and everyone is brought to the menu. */
	function returnToMenu(status?: string): void {
		clearBullets();
		parkCards();
		for (const f of fighters) {
			if (f.human && f.playerId) {
				ctx.world.unequipPlayer(f.playerId, 'right');
				ctx.world.unequipPlayer(f.playerId, 'left');
				ctx.world.teleportPlayer(f.playerId, { position: [LOBBY.spawn[0] + (f.i === 0 ? -0.6 : 0.6), LOBBY.spawn[1], LOBBY.spawn[2]], yaw: 0 });
			}
			f.human = false; f.playerId = null; f.dead = false; f.cards = []; f.stats = computeStats([]);
			park(ID.pad(f.i)); park(ID.padRing(f.i));
		}
		for (const side of [0, 1]) {
			ctx.world.setWorldPose(ID.gun(side), { position: WAITING[side], rotation: [0, 0, 0, 1] }, false);
			ctx.world.setWorldPose(ID.shield(side), { position: add(WAITING[side], [1, 0, 0]), rotation: [0, 0, 0, 1] }, false);
		}
		setMap(0);
		setSky(LOBBY_SKY);
		game.points = [0, 0];
		game.rounds = [0, 0];
		game.round = 1;
		enter('menu');
		refreshMenu(status || DEFAULT_STATUS);
		say('Choose how to play and press START', 'PRESS START');
	}

	// ----------------------------------------------------------------------------------------------------------- banners/flashes
	// Words that appear in front of a player for a moment, where they are looking when something happens.
	const banners = [{ t: 0 }, { t: 0 }];

	const TONE = { info: '#1e1b4b', fight: '#991b1b', go: '#14532d', bad: '#7f1d1d', gold: '#78350f' } as const;
	type Tone = keyof typeof TONE;

	function announce(f: Fighter, title: string, sub: string, seconds: number, tone?: string): void {
		if (!f.human || !f.playerId) return;
		const pose = ctx.world.getPlayerPose(f.playerId);
		if (!pose) return;
		const ahead = flat(pose.head.forward);
		place(ID.banner(f.i), { position: [pose.head.position[0] + ahead[0] * 2.6, pose.head.position[1] + 0.1, pose.head.position[2] + ahead[2] * 2.6], rotation: qyaw(Math.atan2(ahead[0], ahead[2])) });
		const color = TONE[(tone ?? 'info') as Tone];
		setField(ID.banner(f.i), 'meshRenderer', 'color', color);
		setField(ID.banner(f.i), 'textDisplay', 'background', color);
		setField(ID.banner(f.i), 'textDisplay', 'scale', title.length <= 7 ? 3.4 : 1.7);
		setField(ID.banner(f.i), 'textDisplay', 'title', title);
		setField(ID.banner(f.i), 'textDisplay', 'lines', [sub || '']);
		banners[f.i].t = seconds;
		boardsDirty = true;
	}
	const announceAll = (title: string, sub: string, seconds: number, tone?: string): void => { for (const f of fighters) announce(f, title, sub, seconds, tone); };
	const announceEach = (words: (f: Fighter) => [string, string, string] | null, seconds: number): void => { for (const f of fighters) { const line = words(f); if (line) announce(f, line[0], line[1], seconds, line[2]); } };

	// ------------------------------------------------------------------------------------------------------------------ frame
	function readHumans(dt: number): void {
		for (const f of fighters) {
			if (!f.human || !f.playerId) continue;
			const pose = ctx.world.getPlayerPose(f.playerId);
			if (!pose) { f.human = false; continue; }
			const previous = f.head;
			f.head = [...pose.head.position] as V3;
			f.pos = [f.head[0], f.head[1] - T.playerChest, f.head[2]];
			if (dt > 0) f.vel = add(mul(f.vel, 0.8), mul(sub(f.head, previous), 0.2 / dt));
		}
	}

	function updateInputs(): void {
		for (const f of fighters) {
			if (!f.human) continue;
			const gun = f.gunState, shield = f.shieldState;
			f.trigger = Boolean(gun.equipped && gun.down);
			const presses = shield.seq || 0;
			if (shield.equipped && presses !== f.shieldSeq) { f.shieldSeq = presses; startBlock(f); }
			if (f.trigger) tryFire(f);
		}
	}

	function updateFighter(f: Fighter, dt: number): void {
		const s = f.stats;
		f.cd = Math.max(0, f.cd - dt);
		f.graceT = Math.max(0, f.graceT - dt);
		f.brawlT = Math.max(0, f.brawlT - dt);
		f.hurtT = Math.max(0, f.hurtT - dt);
		f.holdT = Math.max(0, f.holdT - dt);
		f.squashT = Math.max(0, f.squashT - dt);
		f.blockCd = Math.max(0, f.blockCd - dt);
		if (f.blockT > 0) f.blockT -= dt;
		if (f.echoT > 0) {
			f.echoT -= dt;
			if (f.echoT <= 0 && !f.dead) { f.blockT = s.blockTime; cue('block', centre(f), 0.35, 1.2); }
		}
		if (f.reloading) {
			f.reloadT -= dt;
			if (f.reloadT <= 0) {
				f.reloading = false; f.ammo = s.ammo;
				if (f.human) cue('reload', centre(f), 0.3, 1.3);
			}
		} else if (s.ammoReg > 0 && f.ammo < s.ammo && !f.dead) {
			f.ammoFrac += s.ammoReg * dt;
			if (f.ammoFrac >= 1) { f.ammoFrac -= 1; f.ammo += 1; }
		}
		if (s.regen > 0 && !f.dead) f.hp = Math.min(f.maxHp, f.hp + s.regen * dt);
		if (f.burstLeft > 0) {
			f.burstT -= dt;
			if (f.burstT <= 0 && !f.dead) {
				const shot = muzzleOf(f);
				if (shot) volley(f, shot.pos, shot.dir);
				f.burstLeft -= 1;
				f.burstT = s.burstGap;
			}
		}
		for (const dotted of f.dots.slice()) {
			dotted.left -= dt;
			damage(f, dotted.rate * dt, fighters[dotted.owner], { silent: true, fromDot: true });
			if (dotted.left <= 0) f.dots.splice(f.dots.indexOf(dotted), 1);
		}
		if (f.dead) f.dots = [];
	}

	/** Falling off the screen: the game puts the fighter back and takes 51 HP for it. */
	function outOfBounds(f: Fighter): void {
		damage(f, T.outOfBoundsDamage, null, { ignoreBlock: true, noNumber: false });
		if (f.dead) return;
		const spawn = spawnOf(f.i);
		f.pos = [...spawn]; f.vel = [0, 0, 0];
		f.bot.grounded = true; f.bot.jumps = 1;
		if (f.human && f.playerId) {
			ctx.world.teleportPlayer(f.playerId, { position: [spawn[0], spawn[1] - T.botRadius, spawn[2]], yaw: facingOf(f.i) });
			ctx.world.setPlayerVelocity(f.playerId, [0, 0, 0]);
		}
		burstFx(spawn, TEAM[f.i].color, 40, 600);
	}

	// ------------------------------------------------------------------------------------------------------------------ effects
	function jumpFx(f: Fighter): void {
		if (f.human) return;
		const c = centre(f);
		burstFx([c[0], c[1] - T.botRadius, c[2]], '#e2e8f0', 8, 260);
		cue('jump', c, 0.3, vary());
	}

	function landFx(f: Fighter): void {
		const c = centre(f);
		burstFx([c[0], c[1] - T.botRadius, c[2]], '#e2e8f0', 6, 200);
		cue('land', c, 0.3, vary());
	}

	/** The words that float up from a hit, where the shot landed: a sign with no background that turns to whoever looks (`billboard`), in the colour of what it says. */
	function popNumber(pos: V3, text: string, color: string): void {
		const slot = numbers.find((x) => !x.alive);
		if (!slot) return;
		slot.alive = true; slot.t = 0; slot.pos = [pos[0], pos[1] + 0.5, pos[2] + 0.2];
		setField(ID.number(slot.n), 'textDisplay', 'title', text);
		setField(ID.number(slot.n), 'textDisplay', 'titleColor', color);
		boardsDirty = true;
		place(ID.number(slot.n), { position: slot.pos });
	}

	function updateNumbers(dt: number): void {
		for (const x of numbers) {
			if (!x.alive) continue;
			x.t += dt;
			if (x.t > 0.9) { x.alive = false; park(ID.number(x.n)); continue; }
			const rise = 1.1 * x.t - 0.6 * x.t * x.t;
			place(ID.number(x.n), { position: [x.pos[0], x.pos[1] + rise, x.pos[2]] });
		}
	}

	// ------------------------------------------------------------------------------------------------------------- visuals
	function setBar(id: string, shown: Fighter['shown'], key: string, base: [number, number, number, number, number], width: number, fraction: number): void {
		const q = Math.round(clamp(fraction, 0, 1) * 100);
		if (shown[key] === q) return;
		shown[key] = q;
		const frac = Math.max(0.001, q / 100);
		ctx.world.setLocalPose(id, { position: [base[0] - (width * (1 - frac)) / 2, base[1], base[2]], scale: [width * frac, base[3], base[4]] }, false);
	}

	const facePlayer = (c: V3): number => {
		const watcher = fighters.find((x) => x.human);
		return watcher ? Math.atan2(watcher.head[0] - c[0], watcher.head[2] - c[2]) + Math.PI : 0;
	};

	function updateVisuals(dt: number): void {
		const live = game.phase === 'fight' || game.phase === 'countdown' || game.phase === 'point' || game.phase === 'pick' || game.phase === 'between';
		for (const f of fighters) {
			const c = centre(f);
			const active = live && !f.dead;
			// Health over the head of the rival: a player reads their own on the HUD.
			if (active && !f.human) {
				place(ID.tag(f.i), { position: [c[0], c[1] + T.botRadius + 0.55, c[2]], rotation: qyaw(facePlayer(c) + Math.PI) });
				const frac = clamp(f.hp / f.maxHp, 0, 1);
				ctx.world.setLocalPose(ID.tagPart(f.i, 'fg'), { scale: [0.001 + 0.68 * frac, 0.07, 0.05] }, false);
			} else park(ID.tag(f.i));
			// The shield bubble: it swells when something lands on it.
			if (f.blockT > 0 && !f.dead) {
				const d = 2 * 0.95 * (1 + 0.08 * Math.sin(clock * 40) + (f.squashT > 0 ? 0.12 : 0));
				place(ID.bubble(f.i), { position: c, scale: [d, d, d] });
			} else park(ID.bubble(f.i));
			// The rival's body.
			if (!f.human) {
				if (live && !f.dead) {
					place(ID.bot(f.i), { position: f.pos, rotation: qyaw(f.bot.yaw) });
					ctx.world.setLocalPose(ID.botPart(f.i, 'aim'), { rotation: qx(-f.bot.pitch) }, false);
					squashBody(f);
					botFace(f);
				} else park(ID.bot(f.i));
			} else park(ID.bot(f.i));
			// What a player sees of themselves: bars and numbers on the gun and the shield, a veil when down.
			if (f.human && f.playerId) {
				const pose = ctx.world.getPlayerPose(f.playerId);
				if (f.dead && pose) {
					place(ID.veil(f.i), { position: add(pose.head.position, mul(pose.head.forward, 0.45)), rotation: pose.head.rotation as Q4 });
				} else park(ID.veil(f.i));
				const g = BAR.gun;
				setBar(ID.gunPart(f.i, 'hp'), f.shown, 'hp', [0, g.y, g.hpZ, g.height, g.depth], g.width, f.hp / f.maxHp);
				setBar(ID.gunPart(f.i, 'ammo'), f.shown, 'ammo', [0, g.y, g.ammoZ, g.height, g.depth], g.width, f.reloading ? 0 : f.ammo / f.stats.ammo);
				setBar(ID.gunPart(f.i, 'reload'), f.shown, 'reload', [0, g.y, g.reloadZ, g.height, g.depth], g.width, f.reloading ? 1 - f.reloadT / f.stats.reloadTime : 0);
				const sh = BAR.shield;
				setBar(ID.shieldPart(f.i, 'bar'), f.shown, 'shield', [0, sh.y, sh.z, sh.height, sh.depth + 0.004], sh.width, f.blockCd <= 0 ? 1 : 1 - f.blockCd / f.stats.blockCd);
			} else {
				park(ID.veil(f.i));
			}
			// A red flash over the eyes of a player who is hit.
			if (f.human && f.flashT > 0 && f.playerId) {
				f.flashT -= dt;
				const pose = ctx.world.getPlayerPose(f.playerId);
				if (pose) place(ID.flash(f.i), { position: add(pose.head.position, mul(pose.head.forward, 0.35)), rotation: pose.head.rotation as Q4 });
			} else park(ID.flash(f.i));
		}
	}

	/** A blob that is hit is squashed for a moment (it springs back): the model is scaled by the game's scale, and its middle stays where the body is. */
	function squashBody(f: Fighter): void {
		const q = f.squashT > 0 ? Math.sin((f.squashT / 0.22) * Math.PI) * 0.3 : 0;
		const key = Math.round(q * 100);
		if (f.shown.squash === key) return;
		f.shown.squash = key;
		const lift = 0.69 * K;
		ctx.world.setLocalPose(ID.botPart(f.i, 'vis'), { position: [0, -lift * (1 - q), 0], scale: [K * (1 + q * 0.6), K * (1 - q), K * (1 + q * 0.6)] }, false);
	}

	/** The blob's face: its eyes look where its gun points, it is surprised when hit and grins when it has scored. */
	function botFace(f: Fighter): void {
		const look = Math.round(clamp(f.bot.aim[1], -1, 1) * 8);
		const mood = f.hurtT > 0 ? 'hurt' : game.phase === 'point' && game.winner === f.i ? 'grin' : 'calm';
		if (f.shown.look !== look) {
			f.shown.look = look;
			for (const side of [-1, 1]) ctx.world.setLocalPose(ID.botPart(f.i, side < 0 ? 'pupil-l' : 'pupil-r'), { position: [side * 0.17, 0.95 + look * 0.012, 0.49] }, false);
		}
		if (f.shown.mood !== mood) {
			f.shown.mood = mood;
			const mouth = mood === 'hurt' ? { position: [0, 0.62, 0.5] as V3, scale: [0.14, 0.2, 0.05] as V3 } : mood === 'grin' ? { position: [0, 0.66, 0.5] as V3, scale: [0.4, 0.09, 0.05] as V3 } : { position: [0, 0.65, 0.5] as V3, scale: [0.2, 0.035, 0.05] as V3 };
			ctx.world.setLocalPose(ID.botPart(f.i, 'mouth'), mouth, false);
		}
	}

	function parkAll(): void {
		for (const side of [0, 1]) { park(ID.banner(side)); park(ID.flash(side)); park(ID.hud(side)); park(ID.pad(side)); park(ID.padRing(side)); }
		for (let n = 0; n < bullets.length; n++) park(ID.bullet(n));
		for (const x of numbers) park(ID.number(x.n));
		parkCards();
		for (const f of fighters) { park(ID.tag(f.i)); park(ID.bubble(f.i)); park(ID.bot(f.i)); park(ID.veil(f.i)); }
	}

	// ------------------------------------------------------------------------------------------------------------------- the HUD
	// A small panel that follows each player's head, above the line of sight: where a game puts its numbers, and not in the sky.
	function updateHud(dt: number): void {
		const playing = game.phase !== 'menu' && game.phase !== 'ready' && game.phase !== 'over';
		for (const f of fighters) {
			const id = ID.hud(f.i);
			if (!f.human || !playing || !f.playerId) { park(id); f.hudPos = null; continue; }
			const pose = ctx.world.getPlayerPose(f.playerId);
			if (!pose) { park(id); continue; }
			const ahead = flat(pose.head.forward);
			const want: V3 = [pose.head.position[0] + ahead[0] * 1.8, pose.head.position[1] + 0.42, pose.head.position[2] + ahead[2] * 1.8];
			// It lags a little behind the head, so that it is not glued to the eyes.
			f.hudPos = f.hudPos ? add(f.hudPos, mul(sub(want, f.hudPos), 1 - Math.exp(-dt * 7))) : want;
			const toHead = sub(pose.head.position, f.hudPos);
			place(id, { position: f.hudPos, rotation: qyaw(Math.atan2(-toHead[0], -toHead[2])) });
			writeHud(f);
		}
	}

	/** Writes what changed on a player's HUD: texts only when they are different, bars only when they move by a step. */
	function writeHud(f: Fighter): void {
		const foe = other(f), shown = f.shown;
		const put = (key: string, field: string, value: string | number) => {
			const k = 'h:' + key + ':' + field;
			if (shown[k] === value) return;
			shown[k] = value;
			setField(HUD(f.i, key), 'uiElement', field, value);
			boardsDirty = true;
		};
		const bar = (key: string, frac: number) => put(key, 'width', Math.max(2, Math.round(HUD_BAR * clamp(frac, 0, 1) / 4) * 4));
		put('me-name', 'text', TEAM[f.i].name + ' · ' + (f.name || 'PLAYER').toUpperCase().slice(0, 14));
		put('me-hp', 'text', Math.ceil(f.hp) + ' / ' + Math.ceil(f.maxHp));
		bar('me-bar', f.hp / f.maxHp);
		put('foe-name', 'text', (foe.human ? (foe.name || 'PLAYER').toUpperCase().slice(0, 14) : 'RIVAL') + ' · ' + TEAM[foe.i].name);
		put('foe-hp', 'text', Math.ceil(foe.hp) + ' / ' + Math.ceil(foe.maxHp));
		bar('foe-bar', foe.hp / foe.maxHp);
		put('score', 'text', game.points[f.i] + ' : ' + game.points[foe.i]);
		put('round', 'text', 'ROUND ' + game.round);
		put('place', 'text', STYLE_DATA[game.map].name);
		const max = f.stats.ammo;
		put('ammo', 'text', f.reloading ? 'RELOADING ' + Math.max(0, f.reloadT).toFixed(1) : max <= 9 ? '●'.repeat(Math.max(0, f.ammo)) + '○'.repeat(Math.max(0, max - f.ammo)) : f.ammo + ' / ' + max);
		put('ammo', 'color', f.reloading ? '#60a5fa' : f.ammo <= 0 ? '#f87171' : '#facc15');
		const ready = f.blockCd <= 0 && f.blockT <= 0;
		put('shield', 'text', f.blockT > 0 ? 'BLOCKING' : ready ? 'SHIELD READY' : 'SHIELD ' + f.blockCd.toFixed(1) + 's');
		put('shield', 'color', f.blockT > 0 ? '#ffffff' : ready ? '#22d3ee' : '#64748b');
	}

	/** What a test may look at and call. Not part of the game. */
	const DEBUG = {
		game, fighters, bullets, numbers, computeStats, drawOffer, traceWorld, startMatch, startPressed, onMenuPress, level, returnToMenu, menu, pickCard, startBlock, tryFire,
		damage, setMap, beginPoint, botJump, moveBody, bodyStep, spawnOf, volley, obstacleAt, clearSight, wallBeside, popNumber, outOfBounds,
		stepBullet, updateBot, botFight, cardSpot, findCardSpots, readHud: writeHud, mapReady, cues
	};

	return {
		onSpawn() {
			if (!ctx.world.isHost()) return;
			ctx.world.setComponentField(ID.director, 'scriptState', 'data', { ...shared(), phase: 'menu', cues: [] }, false);
			parkAll();
			setMap(0);
			setSky(LOBBY_SKY);
			for (const side of [0, 1]) {
				ctx.world.setWorldPose(ID.gun(side), { position: WAITING[side] }, false);
				ctx.world.setWorldPose(ID.shield(side), { position: add(WAITING[side], [1, 0, 0]) }, false);
			}
			refreshMenu(DEFAULT_STATUS);
		},
		onUIEvent(event) {
			if (ctx.world.isHost() && event.type === 'press') onMenuPress(event.slotId, event);
		},
		onPlayerReady() {
			if (game.phase === 'menu') refreshMenu();
		},
		onPlayerLeft(player) {
			for (const f of fighters) if (f.human && f.playerId === player.id) f.human = false;
		},
		/** `scaledDt` is the time of the world, slowed when someone falls (`ctx.time.setScale`); the match's own timers run on the real time. */
		tick(scaledDt: number) {
			soundTick();
			if (!ctx.world.isHost()) return;
			const dt = Math.min(ctx.time.unscaledDelta(), 0.05);
			const sd = Math.min(scaledDt, 0.05);
			clock += dt;
			// When someone falls the world slows for a moment: what is simulated (bullets, the rival, the cooldowns) runs on `sd`, the match's own timers on `dt`.
			if (slowT > 0) { slowT -= dt; if (ctx.time.getScale() !== T.slowMoScale) ctx.time.setScale(T.slowMoScale); }
			else if (ctx.time.getScale() !== 1) ctx.time.setScale(1);
			readBrains();
			readCommands();
			readHumans(dt);
			updateMatch(dt);
			if (game.phase === 'menu' && (game.roomAt -= dt) <= 0) {
				game.roomAt = 0.5;
				if (people().map((p) => p.name).join('|') !== game.roomSignature) refreshMenu();
			}
			const inPlay = game.phase === 'fight' || game.phase === 'countdown' || game.phase === 'point' || game.phase === 'pick' || game.phase === 'between';
			// The rival's body runs in steps of the game's own length: the engine says how many are due.
			const steps = ctx.time.fixed(M.step, 6);
			for (const f of fighters) {
				if (f.human || !inPlay) continue;
				if (game.phase === 'fight') { updateBot(f, sd); botFight(f, sd); }
				else { f.bot.dir = 0; f.bot.moving = false; }
				moveBody(f, steps);
			}
			if (game.phase === 'fight' || game.phase === 'pick') updateInputs();
			for (const f of fighters) updateFighter(f, sd);
			// Whoever falls out of the world takes the game's penalty and is put back.
			if (inPlay) for (const f of fighters) if (!f.dead && centre(f)[1] < A.minY - 1.2) outOfBounds(f);
			for (const b of bullets) if (b.alive) stepBullet(b, sd);
			updateVisuals(dt);
			updateNumbers(dt);
			updateHud(dt);
			for (const side of [0, 1]) if (banners[side].t > 0 && (banners[side].t -= dt) <= 0) park(ID.banner(side));
			flush();
		},
		__debug: DEBUG
	};
});
