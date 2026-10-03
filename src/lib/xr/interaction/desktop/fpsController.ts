import { KeyboardEventTypes, Observable, type Scene, type UniversalCamera } from '@babylonjs/core';
import { xrSettings } from '../../settings';
import type { PlayerBody } from '../playerBody';
import { lookedAt } from './desktopMath';
import { desktopHud } from './desktopHud.svelte';

/**
 * Babylon's camera speed. Each frame a held key adds this (scaled by frame time) to a movement that fades by 10% per
 * frame, so at 60 fps a speed of 1 ends up near 30 m/s. These give about 2 m/s walking and 3.5 m/s running (hold Shift),
 * like the headset's smooth movement.
 */
const WALK_SPEED = 0.065;
const RUN_SPEED = 0.115;
/** A single mouse move bigger than this is a glitch of the browser taking or giving back the pointer, not a hand. */
const MAX_LOOK_STEP = 250;

export interface FpsController {
	/** The mouse is captured: it turns the view and does not move a cursor. */
	readonly locked: boolean;
	/** Set while something else wants the mouse's movement (the radial menu): the view stays where it is. */
	lookSuspended: boolean;
	readonly onLockChange: Observable<boolean>;
	requestLock(): void;
	exitLock(): void;
	/** Turns walking, looking and jumping off (a panel fills the screen) or back on. */
	setEnabled(enabled: boolean): void;
	/** The field of view, from the settings. */
	applySettings(): void;
	dispose(): void;
}

/**
 * First-person control for a mouse and keyboard: the mouse is captured on click (Esc gives it back) and looks around, WASD
 * walks, Shift runs, Space jumps. Babylon's own drag-to-look is taken out: it needs the button held, and the pointer
 * lock replaces it.
 */
export function setupFpsController(scene: Scene, canvas: HTMLCanvasElement, camera: UniversalCamera, body: PlayerBody, options: { isXr(): boolean }): FpsController {
	camera.inputs.removeByType('FreeCameraMouseInput');
	camera.speed = WALK_SPEED;
	let enabled = true;
	let attached = true;
	let locked = false;
	const onLockChange = new Observable<boolean>();

	const setAttached = (value: boolean) => {
		if (value === attached) return;
		attached = value;
		if (value) camera.attachControl(canvas, true);
		else camera.detachControl();
	};

	function applySettings(): void {
		camera.fov = (xrSettings.desktopFov * Math.PI) / 180;
	}
	applySettings();

	function requestLock(): void {
		if (!enabled || options.isXr() || locked || !canvas.requestPointerLock) return;
		canvas.focus();
		try {
			// Raw movement, with no mouse acceleration: turning is the same distance for the same hand movement.
			const request = canvas.requestPointerLock({ unadjustedMovement: true }) as Promise<void> | undefined;
			request?.catch(() => {
				// Not every system can give raw input; fall back to the ordinary capture.
				try {
					void (canvas.requestPointerLock() as Promise<void> | undefined)?.catch(() => {});
				} catch {
					// a denied capture leaves the pause hint on screen
				}
			});
		} catch {
			// a denied capture leaves the pause hint on screen
		}
	}

	const controller: FpsController = {
		get locked() {
			return locked;
		},
		lookSuspended: false,
		onLockChange,
		requestLock,
		exitLock() {
			if (document.pointerLockElement === canvas) document.exitPointerLock();
		},
		setEnabled(value) {
			enabled = value;
			setAttached(value);
			if (!value) camera.speed = WALK_SPEED;
		},
		applySettings,
		dispose() {
			document.removeEventListener('pointerlockchange', onLockChanged);
			window.removeEventListener('mousemove', onMouseMove, true);
			window.removeEventListener('pointerdown', onPointerDown, true);
			window.removeEventListener('blur', onBlur);
			canvas.removeEventListener('contextmenu', onContextMenu);
			scene.onKeyboardObservable.remove(keyObserver);
			if (document.pointerLockElement === canvas) document.exitPointerLock();
		}
	};

	function onLockChanged(): void {
		const now = document.pointerLockElement === canvas;
		if (now === locked) return;
		locked = now;
		desktopHud.locked = now;
		onLockChange.notifyObservers(now);
	}

	function onMouseMove(event: MouseEvent): void {
		if (!locked || !enabled || controller.lookSuspended || options.isXr()) return;
		if (Math.abs(event.movementX) > MAX_LOOK_STEP || Math.abs(event.movementY) > MAX_LOOK_STEP) return;
		const next = lookedAt({ yaw: camera.rotation.y, pitch: camera.rotation.x }, event.movementX, event.movementY, xrSettings.mouseSensitivity, xrSettings.invertY);
		camera.rotation.y = next.yaw;
		camera.rotation.x = next.pitch;
	}

	/** A click on the game while the mouse is free captures it again. That click is only for that: nothing under it is pressed. */
	function onPointerDown(event: PointerEvent): void {
		if (locked || !enabled || options.isXr() || event.button !== 0 || event.target !== canvas) return;
		event.stopImmediatePropagation();
		requestLock();
	}

	function onBlur(): void {
		camera.speed = WALK_SPEED;
	}

	const onContextMenu = (event: Event) => event.preventDefault();

	const keyObserver = scene.onKeyboardObservable.add((info) => {
		const event = info.event;
		if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
			camera.speed = info.type === KeyboardEventTypes.KEYDOWN && enabled ? RUN_SPEED : WALK_SPEED;
		} else if (event.code === 'Space' && info.type === KeyboardEventTypes.KEYDOWN && enabled && !event.repeat) {
			body.jump();
		}
	});

	document.addEventListener('pointerlockchange', onLockChanged);
	window.addEventListener('mousemove', onMouseMove, true);
	window.addEventListener('pointerdown', onPointerDown, true);
	window.addEventListener('blur', onBlur);
	canvas.addEventListener('contextmenu', onContextMenu);
	return controller;
}
