import { add, dot, length, normalize, scale, sub, type V3 } from './shapes.ts';
import type { CollisionWorld } from './world.ts';

/**
 * How a body moves, for any game: a platformer, a shooter, a walking sim. Every number has a default that is a person walking, so a
 * game only says what is different (`playerMovement` / `characterController` in a world carry these).
 */
export interface CharacterConfig {
	/** The body is a capsule: this wide (radius, in metres) and this tall (from the feet to the top of the head). */
	radius: number;
	height: number;
	/** The tallest ledge walked onto without jumping, and the steepest slope (degrees from flat) that is walked up and stood on. */
	stepHeight: number;
	slopeLimit: number;
	/** Fall: how fast it speeds up (m/s²) and the fastest it gets (m/s). */
	gravity: number;
	terminalSpeed: number;
	/** A jump leaves the ground at this speed (m/s): it reaches `v² / 2g`. */
	jumpSpeed: number;
	/** A jump still works this long (s) after leaving the ground, and one asked for this long before landing is not lost. */
	coyoteTime: number;
	jumpBuffer: number;
	/** Jumps allowed in the air before touching ground again. */
	airJumps: number;
	/** Jumping next to a wall jumps again off it: up by `wallJumpUp` times the jump speed, and away from it at `wallJumpOut` m/s. */
	wallJump: boolean;
	wallJumpUp: number;
	wallJumpOut: number;
	/** Holding against a wall slows a fall to this (m/s); 0 leaves it alone. And how close counts as touching it. */
	wallSlideSpeed: number;
	wallReach: number;
	/** How much of what the player steers is kept in the air (1 all of it, 0 none). */
	airControl: number;
	/** Slopes steeper than `slopeLimit` are slid down instead of stood on. */
	slideSteepSlopes: boolean;
	/** How fast a push (`addImpulse`) fades, per second. */
	impulseDrag: number;
	/** Keeps the body in a lane of the world (2.5D): along `axis`, within `halfWidth` of `center`. */
	lane?: { axis: 'x' | 'z'; center: number; halfWidth: number };
}

export const DEFAULT_CHARACTER: CharacterConfig = {
	radius: 0.3,
	height: 1.8,
	stepHeight: 0.4,
	slopeLimit: 50,
	gravity: 9.8,
	terminalSpeed: 25,
	jumpSpeed: 3.6,
	coyoteTime: 0,
	jumpBuffer: 0,
	airJumps: 0,
	wallJump: false,
	wallJumpUp: 1,
	wallJumpOut: 0,
	wallSlideSpeed: 0,
	wallReach: 0.2,
	airControl: 1,
	slideSteepSlopes: false,
	impulseDrag: 5
};

const SKIN = 0.002;
const UP: V3 = [0, 1, 0];
const DOWN: V3 = [0, -1, 0];

/**
 * A body that moves through a `CollisionWorld`: stands on flat ground and slopes, walks up steps, slides along walls, falls, jumps (off
 * the ground, in the air, off a wall), slides down what is too steep and is pushed. It knows nothing of how it is steered or drawn: the
 * caller says how far it wants to go each frame and reads where it ended up. Same code for the player in a headset, on a desktop and
 * for a test.
 */
export class CharacterBody {
	/** Where the feet are. */
	position: V3 = [0, 0, 0];
	/** Vertical speed and the push still fading (m/s). What the player steers is not in it. */
	velocity: V3 = [0, 0, 0];
	grounded = false;
	groundNormal: V3 = UP;
	groundId: string | null = null;
	/** The wall within reach: the way out of it. Null when there is none. */
	wall: { normal: V3; id: string } | null = null;
	/** Seconds since the body last stood on ground, touched a wall, or jumped. */
	sinceGrounded = Infinity;
	sinceWall = Infinity;
	sinceJump = Infinity;
	airJumpsLeft = 0;
	/** How long a jump that was asked for is still wanted (s). */
	private jumpWanted = 0;
	private justJumped = false;
	/** What the last jump was: 'ground', 'air' or 'wall', for sounds and effects. */
	lastJump: 'ground' | 'air' | 'wall' | null = null;

	constructor(
		public config: CharacterConfig,
		private readonly world: CollisionWorld,
		private readonly ignore?: (id: string) => boolean
	) {}

	private get cosSlope(): number {
		return Math.cos((this.config.slopeLimit * Math.PI) / 180);
	}

	/** The centres of the three spheres the capsule is made of: at the feet, the middle and the top. */
	private centres(p: V3 = this.position): V3[] {
		const { radius: r, height: h } = this.config;
		const top = Math.max(r, h - r);
		return [[p[0], p[1] + r, p[2]], [p[0], p[1] + (r + top) / 2, p[2]], [p[0], p[1] + top, p[2]]];
	}

	teleport(position: V3): void {
		this.position = [...position];
		this.velocity = [0, 0, 0];
		this.grounded = false;
		this.sinceGrounded = Infinity;
		this.wall = null;
		this.depenetrate();
	}

	/** Asks for a jump: it happens now if it can, or the next time it can within `jumpBuffer`. */
	jump(): void {
		this.jumpWanted = Math.max(this.config.jumpBuffer, 1e-6);
	}

	/** Pushes the body: its speed changes at once and the horizontal part fades by `impulseDrag`. */
	addImpulse(v: V3): void {
		this.velocity = add(this.velocity, v);
		if (v[1] > 0) { this.grounded = false; this.sinceGrounded = Math.max(this.sinceGrounded, this.config.coyoteTime + 1); }
	}

	setVelocity(v: V3): void {
		this.velocity = [...v];
		if (v[1] > 0) { this.grounded = false; this.sinceGrounded = Math.max(this.sinceGrounded, this.config.coyoteTime + 1); }
	}

	/** Moves every sphere of the body by `m` as far as it goes before touching something. Returns how far, as a fraction of `m`, and what it touched. */
	private sweep(m: V3, lowStep?: { found: boolean }): { moved: V3; hit: { normal: V3; id: string; t: number } | null } {
		const dist = length(m);
		if (dist < 1e-9) return { moved: [0, 0, 0], hit: null };
		const dir = scale(m, 1 / dist);
		let best: { normal: V3; id: string; t: number } | null = null;
		const feet = this.position[1];
		for (const [index, c] of this.centres().entries()) {
			// The feet pass what is low enough to step onto: the body is lifted over it afterwards (`stepOver`).
			const skip = lowStep && index === 0 ? (id: string) => Boolean(this.ignore?.(id)) : this.ignore;
			let hit = this.world.sphereCast(c, this.config.radius, dir, dist + SKIN, { ignore: skip });
			if (lowStep && index === 0 && hit && hit.point[1] - feet < this.config.stepHeight && hit.normal[1] < this.cosSlope) {
				lowStep.found = true;
				// Past it: the next thing in that direction, if any, is what the feet really meet.
				const rest = this.world.sphereCast(c, this.config.radius, dir, dist + SKIN, { ignore: (id) => id === hit!.id || Boolean(this.ignore?.(id)) });
				hit = rest && rest.point[1] - feet >= this.config.stepHeight ? rest : null;
			}
			if (hit && hit.t <= dist && (!best || hit.t < best.t)) best = { normal: hit.normal, id: hit.id, t: hit.t };
		}
		const travel = best ? Math.max(0, best.t - SKIN) : dist;
		const moved = scale(dir, travel);
		this.position = add(this.position, moved);
		return { moved, hit: best };
	}

	/** Moves by `m` sliding along what is in the way (up to four times round a corner). */
	private slide(m: V3, onHit?: (normal: V3) => void, lowStep?: { found: boolean }): V3 {
		let remaining = m;
		let total: V3 = [0, 0, 0];
		const planes: V3[] = [];
		for (let i = 0; i < 4 && length(remaining) > 1e-6; i++) {
			const { moved, hit } = this.sweep(remaining, lowStep);
			total = add(total, moved);
			if (!hit) break;
			onHit?.(hit.normal);
			remaining = sub(remaining, moved);
			// Along the surface; along the crease when there are two. Too steep to stand on counts as a wall: it is not climbed by pushing against it.
			const steep = hit.normal[1] < this.cosSlope && hit.normal[1] > -0.2;
			const along = steep ? normalize([hit.normal[0], 0, hit.normal[2]]) : hit.normal;
			let next = sub(remaining, scale(along, dot(remaining, along)));
			for (const plane of planes) {
				if (dot(next, plane) < -1e-6) {
					const crease = normalize([hit.normal[1] * plane[2] - hit.normal[2] * plane[1], hit.normal[2] * plane[0] - hit.normal[0] * plane[2], hit.normal[0] * plane[1] - hit.normal[1] * plane[0]]);
					next = scale(crease, dot(remaining, crease));
				}
			}
			planes.push(along);
			remaining = next;
		}
		return total;
	}

	/** Pushes the body out of anything it is inside of (a teleport, something that moved onto it). */
	private depenetrate(): void {
		for (let pass = 0; pass < 6; pass++) {
			let worst: { normal: V3; depth: number } | null = null;
			for (const c of this.centres()) {
				for (const contact of this.world.overlapSphere(c, this.config.radius - SKIN, { ignore: this.ignore })) {
					if (!worst || contact.depth > worst.depth) worst = { normal: contact.normal, depth: contact.depth };
				}
			}
			if (!worst || worst.depth < 1e-4) return;
			this.position = add(this.position, scale(worst.normal, worst.depth));
		}
	}

	/** What the feet stand on: a cast straight down from the feet sphere, up to `reach` below it. */
	private probeGround(reach: number): { normal: V3; id: string; gap: number } | null {
		const { radius: r } = this.config;
		const from: V3 = [this.position[0], this.position[1] + r, this.position[2]];
		const hit = this.world.sphereCast(from, r, DOWN, reach + SKIN, { ignore: this.ignore });
		return hit ? { normal: this.surfaceNormal(hit.point, hit.normal), id: hit.id, gap: hit.t } : null;
	}

	/**
	 * What a sphere touches is often the edge of a face (the lip of a step or a platform), whose normal points out sideways. The face itself
	 * is found with a short ray down just inside the edge, so that standing on an edge counts as standing.
	 */
	private surfaceNormal(point: V3, normal: V3): V3 {
		if (normal[1] >= this.cosSlope) return normal;
		const side = normalize([normal[0], 0, normal[2]]);
		if (length(side) < 1e-6) return normal;
		const origin: V3 = [point[0] - side[0] * 0.02, point[1] + 0.1, point[2] - side[2] * 0.02];
		const face = this.world.raycast(origin, DOWN, 0.3, { ignore: this.ignore });
		return face && Math.abs(face.point[1] - point[1]) < 0.12 ? face.normal : normal;
	}

	/**
	 * One frame. `want` is how far the player steers the body horizontally (a displacement; its y is ignored) and `dt` the time. Returns how
	 * far the feet really moved.
	 */
	step(want: V3, dt: number): V3 {
		const cfg = this.config;
		const start: V3 = [...this.position];
		this.sinceJump += dt;
		this.sinceWall += dt;
		this.justJumped = false;
		const wasGrounded = this.grounded;

		// Ground: standing on it, within a step below the feet.
		const ground = this.probeGround(wasGrounded && this.velocity[1] <= 0 ? cfg.stepHeight : 0.03);
		const walkable = Boolean(ground) && ground!.normal[1] >= this.cosSlope && ground!.gap <= (wasGrounded ? cfg.stepHeight : 0.03) + 1e-4;
		this.grounded = walkable;
		this.groundNormal = ground ? ground.normal : UP;
		this.groundId = ground ? ground.id : null;
		if (this.grounded) {
			this.sinceGrounded = 0;
			this.airJumpsLeft = cfg.airJumps;
			if (this.velocity[1] < 0) this.velocity[1] = 0;
		} else this.sinceGrounded += dt;

		// What was asked for, in the plane of the ground when on it, less in the air, plus a push still fading.
		let horizontal: V3 = [want[0], 0, want[2]];
		if (!this.grounded) horizontal = scale(horizontal, cfg.airControl);
		horizontal = add(horizontal, [this.velocity[0] * dt, 0, this.velocity[2] * dt]);
		const fade = Math.exp(-cfg.impulseDrag * dt);
		this.velocity[0] *= fade; this.velocity[2] *= fade;
		if (Math.abs(this.velocity[0]) < 1e-3) this.velocity[0] = 0;
		if (Math.abs(this.velocity[2]) < 1e-3) this.velocity[2] = 0;
		if (cfg.lane) horizontal = this.laneLimited(horizontal);

		// Wall: within reach on a side, for jumping off and sliding down.
		this.updateWall();

		// A jump, if one is asked for and possible.
		this.tryJump();

		// Move along the ground (up and down slopes), or through the air.
		if (length(horizontal) > 1e-9) this.walk(horizontal);

		// Fall or rise.
		if (!this.grounded || this.velocity[1] > 0) {
			this.velocity[1] = Math.max(this.velocity[1] - cfg.gravity * dt, -cfg.terminalSpeed);
			if (cfg.wallSlideSpeed > 0 && this.wall && this.velocity[1] < -cfg.wallSlideSpeed && this.pressingWall(horizontal)) this.velocity[1] = -cfg.wallSlideSpeed;
			const dy = this.velocity[1] * dt;
			const { hit } = this.sweep([0, dy, 0]);
			if (hit) {
				if (dy > 0) this.velocity[1] = 0;
				else {
					this.velocity[1] = 0;
					if (hit.normal[1] >= this.cosSlope) {
						this.grounded = true;
						this.sinceGrounded = 0;
						this.airJumpsLeft = cfg.airJumps;
						this.groundNormal = hit.normal;
						this.groundId = hit.id;
					}
				}
			}
		} else {
			// Standing: keep to the ground over steps and down slopes.
			this.snapToGround();
		}

		// Too steep to stand on: slide down it.
		if (!this.grounded && cfg.slideSteepSlopes) this.slideDownSteep(dt);

		this.jumpWanted = Math.max(0, this.jumpWanted - dt);
		this.depenetrate();
		if (!this.wall) this.updateWall();
		return sub(this.position, start);
	}

	private laneLimited(m: V3): V3 {
		const lane = this.config.lane!;
		const k = lane.axis === 'x' ? 0 : 2;
		const limit = lane.halfWidth - this.config.radius;
		const out: V3 = [...m];
		const next = this.position[k] + m[k];
		out[k] = Math.max(lane.center - limit, Math.min(lane.center + limit, next)) - this.position[k];
		return out;
	}

	private pressingWall(m: V3): boolean {
		if (!this.wall) return false;
		const into = -(m[0] * this.wall.normal[0] + m[2] * this.wall.normal[2]);
		return into > 1e-6;
	}

	/** Looks for a wall within reach (a nearly vertical face) with the middle sphere. */
	private updateWall(): void {
		const cfg = this.config;
		const mid = this.centres()[1];
		let found: { normal: V3; id: string } | null = null;
		let depth = -Infinity;
		for (const contact of this.world.overlapSphere(mid, cfg.radius + cfg.wallReach, { ignore: this.ignore })) {
			if (Math.abs(contact.normal[1]) > 0.35) continue;
			if (contact.depth > depth) { depth = contact.depth; found = { normal: normalize([contact.normal[0], 0, contact.normal[2]]), id: contact.id }; }
		}
		this.wall = found;
		if (found) this.sinceWall = 0;
	}

	private tryJump(): void {
		const cfg = this.config;
		if (this.jumpWanted <= 0 || this.sinceJump < 0.05) return;
		const coyote = this.sinceGrounded <= cfg.coyoteTime;
		if (this.grounded || coyote) {
			this.velocity[1] = cfg.jumpSpeed;
			this.lastJump = 'ground';
		} else if (cfg.wallJump && this.wall) {
			this.velocity[1] = cfg.jumpSpeed * cfg.wallJumpUp;
			this.velocity[0] += this.wall.normal[0] * cfg.wallJumpOut;
			this.velocity[2] += this.wall.normal[2] * cfg.wallJumpOut;
			this.lastJump = 'wall';
			this.airJumpsLeft = cfg.airJumps;
		} else if (this.airJumpsLeft > 0) {
			this.airJumpsLeft -= 1;
			this.velocity[1] = cfg.jumpSpeed;
			this.lastJump = 'air';
		} else return;
		this.grounded = false;
		this.sinceGrounded = Infinity;
		this.sinceJump = 0;
		this.jumpWanted = 0;
		this.justJumped = true;
	}

	/** Moves horizontally: up and down along the ground, over a low step, and round what is in the way. */
	private walk(horizontal: V3): void {
		const cfg = this.config;
		let m = horizontal;
		if (this.grounded) {
			const n = this.groundNormal;
			// Along the ground: the same distance across, up or down by what the slope asks.
			if (n[1] > 1e-3 && n[1] < 0.9999) m = [horizontal[0], -(n[0] * horizontal[0] + n[2] * horizontal[2]) / n[1], horizontal[2]];
		}
		const before: V3 = [...this.position];
		const low = { found: false };
		this.slide(m, undefined, this.grounded && !this.justJumped ? low : undefined);
		if (!this.grounded || this.justJumped) return;
		// The feet passed something low, or are on its edge: lift the body over it, or, if it will not clear, be stopped by it like by any wall.
		const feet = this.centres()[0];
		if (!low.found && this.world.overlapSphere(feet, this.config.radius - SKIN * 2, { ignore: this.ignore }).length === 0) return;
		if (!this.stepOver() && low.found) {
			this.position = before;
			this.slide(m);
		}
	}

	/** Raises the body, by up to a step, until its feet clear what they are overlapping. */
	private stepOver(): boolean {
		const cfg = this.config;
		const feet = this.centres()[0];
		for (let lift = 0; lift <= cfg.stepHeight + 1e-9; lift += 0.02) {
			const at: V3 = [feet[0], feet[1] + lift, feet[2]];
			if (this.world.overlapSphere(at, cfg.radius - SKIN * 2, { ignore: this.ignore }).length === 0) {
				// Also clear above: the rest of the body must not be inside anything at that height.
				const raised = this.centres([this.position[0], this.position[1] + lift, this.position[2]]);
				if (raised.slice(1).every((c) => this.world.overlapSphere(c, cfg.radius - SKIN * 2, { ignore: this.ignore }).length === 0)) {
					this.position = [this.position[0], this.position[1] + lift, this.position[2]];
					return true;
				}
			}
		}
		return false;
	}

	/** Stays on the ground over a step down or a slope down: a short cast down from the feet. */
	private snapToGround(): void {
		const probe = this.probeGround(this.config.stepHeight);
		if (!probe || probe.normal[1] < this.cosSlope) { this.grounded = false; return; }
		if (probe.gap > 1e-3) this.position = add(this.position, scale(DOWN, Math.max(0, probe.gap - SKIN)));
		this.groundNormal = probe.normal;
		this.groundId = probe.id;
	}

	/** Pushed along a slope too steep to stand on: gravity along the surface. */
	private slideDownSteep(dt: number): void {
		const probe = this.probeGround(0.05);
		if (!probe || probe.gap > 0.04 || probe.normal[1] >= this.cosSlope || probe.normal[1] < 0.05) return;
		const n = probe.normal;
		const g = this.config.gravity;
		// Down the slope: gravity minus the part the surface takes.
		const along: V3 = [n[0] * n[1] * g, -(1 - n[1] * n[1]) * g, n[2] * n[1] * g];
		this.velocity = add(this.velocity, scale(along, dt));
	}
}
