import type { Vector3 } from '@babylonjs/core';
import type { CharacterControllerComponent } from '../../ecs/types.ts';
import { CharacterBody, DEFAULT_CHARACTER, type CharacterConfig } from '../../physics/character.ts';
import type { V3 } from '../../physics/shapes.ts';
import type { SceneColliders } from '../sceneColliders.ts';

/** The `characterController` of a world as the physics module's settings: what it leaves out is a person walking. */
export function characterConfigOf(component: CharacterControllerComponent | undefined): CharacterConfig {
	const c = component ?? ({ type: 'characterController' } as CharacterControllerComponent);
	const finite = (value: number | undefined, fallback: number, min = -Infinity, max = Infinity) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback);
	const d = DEFAULT_CHARACTER;
	return {
		radius: finite(c.radius, d.radius, 0.05, 2),
		height: finite(c.height, d.height, 0.2, 5),
		stepHeight: finite(c.stepHeight, d.stepHeight, 0, 2),
		slopeLimit: finite(c.slopeLimit, d.slopeLimit, 0, 89),
		gravity: finite(c.gravity, d.gravity, 0.1),
		terminalSpeed: finite(c.terminalSpeed, d.terminalSpeed, 1),
		jumpSpeed: finite(c.jumpSpeed, d.jumpSpeed, 0),
		coyoteTime: finite(c.coyoteTime, d.coyoteTime, 0, 1),
		jumpBuffer: finite(c.jumpBuffer, d.jumpBuffer, 0, 1),
		airJumps: Math.round(finite(c.airJumps, d.airJumps, 0, 10)),
		wallJump: c.wallJump === true,
		wallJumpUp: finite(c.wallJumpUp, d.wallJumpUp, 0, 5),
		wallJumpOut: finite(c.wallJumpOut, d.wallJumpOut, 0, 50),
		wallSlideSpeed: finite(c.wallSlideSpeed, d.wallSlideSpeed, 0),
		wallReach: d.wallReach,
		airControl: finite(c.airControl, d.airControl, 0, 1),
		slideSteepSlopes: c.slideSteepSlopes === true,
		impulseDrag: finite(c.impulseDrag, d.impulseDrag, 0, 100),
		...(c.laneAxis === 'x' || c.laneAxis === 'z' ? { lane: { axis: c.laneAxis, center: finite(c.laneCenter, 0), halfWidth: finite(c.laneWidth, 3, 0.1) / 2 } } : {})
	};
}

/** What the rig needs of the page: where the camera is and how it relates to the feet, both on a desktop and in a headset. */
export interface RigHost {
	inXr(): boolean;
	/** The camera that is the player's eye now. */
	camera(): { position: Vector3 };
	/** How far the feet are under that camera's position, m (1.6 on a desktop, the user's real height in a headset, plus any seated lift). */
	feetBelowCamera(): number;
}

/**
 * Drives the camera with a `CharacterBody`: what a desktop's keys or a headset's stick ask for is taken as how far the player wants to go,
 * and the camera is put where the body ends up. The body stands on, walks over and bumps into the colliders of the scene, so slopes, steps,
 * walls and jumps behave the same everywhere.
 */
export class CharacterRig {
	readonly body: CharacterBody;
	/** Whether the body has been put down yet (until then the next frame puts it at the camera's feet). */
	started = false;
	private pending: V3 = [0, 0, 0];
	/** Where the body was at the end of the last frame, to know how far the camera was moved since by something else. */
	private lastBody: V3 = [0, 0, 0];
	private lastEye: V3 = [0, 0, 0];

	constructor(private readonly host: RigHost, private readonly colliders: SceneColliders, config: CharacterConfig) {
		this.body = new CharacterBody(config, colliders.world);
	}

	configure(config: CharacterConfig): void {
		this.body.config = config;
	}

	/** Puts the body at the feet of the camera again (after the camera was moved on purpose: a teleport, a new session). */
	reset(): void {
		this.started = false;
	}

	/** Locomotion of a headset's stick: how far it wants to go this frame, taken and acted on by `update`. */
	push(delta: Vector3): void {
		this.pending = [this.pending[0] + delta.x, 0, this.pending[2] + delta.z];
	}

	jump(): void {
		this.body.jump();
	}

	addImpulse(v: V3): void {
		this.body.addImpulse(v);
	}

	setVelocity(v: V3): void {
		this.body.setVelocity(v);
	}

	/** The height of the first thing under a point, or null. */
	floorBelow(x: number, y: number, z: number): number | null {
		const hit = this.colliders.sync().raycast([x, y, z], [0, -1, 0], 200);
		return hit ? hit.point[1] : null;
	}

	/** One frame: the body moves by what the player asked for and the camera follows. */
	update(dt: number): void {
		this.colliders.sync();
		const camera = this.host.camera();
		const eye = this.host.feetBelowCamera();
		const feet: V3 = [camera.position.x, camera.position.y - eye, camera.position.z];
		const desktop = !this.host.inXr();
		if (!this.started) {
			this.body.teleport(feet);
			this.lastBody = [...this.body.position];
			this.started = true;
			this.pending = [0, 0, 0];
		}
		// How far the player wants to go: on a desktop, what the keys moved the camera since the body put it down; in a headset, the stick.
		let want: V3;
		if (desktop) want = [camera.position.x - this.lastBody[0], 0, camera.position.z - this.lastBody[2]];
		else want = this.pending;
		this.pending = [0, 0, 0];
		// Something else moved the camera far (a seat calibration, a teleport that skipped us): start again from there.
		if (Math.abs(camera.position.y - eye - this.lastBody[1]) > 0.75 && desktop) {
			this.body.teleport(feet);
			want = [0, 0, 0];
		}
		const before: V3 = [...this.body.position];
		this.body.step(want, Math.min(dt, 0.05));
		const moved: V3 = [this.body.position[0] - before[0], this.body.position[1] - before[1], this.body.position[2] - before[2]];
		if (desktop) camera.position.set(this.body.position[0], this.body.position[1] + eye, this.body.position[2]);
		else { camera.position.x += moved[0]; camera.position.y += moved[1]; camera.position.z += moved[2]; }
		this.lastBody = [...this.body.position];
		this.lastEye = [camera.position.x, camera.position.y, camera.position.z];
	}

	/** Puts the feet at a place. */
	teleport(feet: V3): void {
		const camera = this.host.camera();
		this.body.teleport(feet);
		camera.position.set(feet[0], feet[1] + this.host.feetBelowCamera(), feet[2]);
		this.lastBody = [...this.body.position];
		this.started = true;
	}
}
