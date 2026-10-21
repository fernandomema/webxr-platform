import { PUSH_RANGE } from '../pushPull.ts';

/** Pitch is kept just short of straight up/down, where the view would flip. */
export const MAX_PITCH = Math.PI / 2 - 0.05;
/** Radians of turn per pixel of mouse travel at a sensitivity of 1. */
export const RADIANS_PER_PIXEL = 0.0022;

export interface LookAngles {
	yaw: number;
	pitch: number;
}

/** A mouse movement (pixels) applied to the view. Pitch is clamped; moving the mouse up looks up unless `invertY`. */
export function lookedAt(angles: LookAngles, dx: number, dy: number, sensitivity: number, invertY: boolean): LookAngles {
	const scale = RADIANS_PER_PIXEL * sensitivity;
	const pitch = angles.pitch + dy * scale * (invertY ? -1 : 1);
	return { yaw: angles.yaw + dx * scale, pitch: Math.min(MAX_PITCH, Math.max(-MAX_PITCH, pitch)) };
}

/** The largest size (in the same unit as the view) a panel of `aspect` (width / height) takes while staying inside the view, with a margin. */
export function fitPanel(viewWidth: number, viewHeight: number, aspect: number, margin = 0.94): { width: number; height: number } {
	const height = Math.min(viewHeight * margin, (viewWidth * margin) / aspect);
	return { width: height * aspect, height };
}

/** The size of what a camera sees at `distance`, for a vertical field of view in radians. */
export function viewSizeAt(distance: number, verticalFov: number, aspectRatio: number): { width: number; height: number } {
	const height = 2 * distance * Math.tan(verticalFov / 2);
	return { width: height * aspectRatio, height };
}

/** Wheel notches (a notch is a `deltaY` of 100). Scrolling away from you (negative) is positive here. */
export const wheelNotches = (deltaY: number): number => -deltaY / 100;

/**
 * Where a laser-held object goes after the wheel turns: `distance` is how far it is from the eye (metres), `notches` as
 * from `wheelNotches`. Each notch moves it by a share of its distance, so it is fine near you and quick far away. It stays
 * between the hand and the far limit (the same range the controller's stick has).
 */
export function wheelPushedDistance(distance: number, notches: number): number {
	const step = 0.12 + Math.max(0, distance) * 0.18;
	return Math.min(PUSH_RANGE.max, Math.max(PUSH_RANGE.min, distance + notches * step));
}

export const SCALE_RANGE = { min: 0.05, max: 40 };

/** The scale after the wheel turns while holding Ctrl: 10% per notch, never past the range (`current` is the object's largest axis). */
export function wheelScaledBy(current: number, notches: number): number {
	const target = Math.min(SCALE_RANGE.max, Math.max(SCALE_RANGE.min, current * Math.pow(1.1, notches)));
	return target / current;
}

/** Degrees an object held with Shift turns per wheel notch. */
export const WHEEL_TURN_DEGREES = 15;

/**
 * Which slice of a radial menu a mouse offset points at, or -1 when it is still near the centre. The first slice is at
 * the top and the rest follow clockwise (the offset is in screen space: x right, y down), the same layout the controller's
 * stick picks from.
 */
export function pieIndexAt(x: number, y: number, count: number, deadzone: number): number {
	if (count <= 0 || Math.hypot(x, y) < deadzone) return -1;
	const step = (2 * Math.PI) / count;
	const angle = Math.atan2(y, x) + Math.PI / 2; // 0 at the top, growing clockwise
	return ((Math.round(angle / step) % count) + count) % count;
}

/** The offset the mouse has pushed a radial menu's pointer to, kept inside the ring (units of ring radius). */
export function pieOffset(offset: { x: number; y: number }, dx: number, dy: number, pixelsPerRadius: number, limit = 1.25): { x: number; y: number } {
	const x = offset.x + dx / pixelsPerRadius;
	const y = offset.y + dy / pixelsPerRadius;
	const length = Math.hypot(x, y);
	return length > limit ? { x: (x / length) * limit, y: (y / length) * limit } : { x, y };
}
