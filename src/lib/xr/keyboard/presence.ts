/**
 * What other players learn about someone's keyboard: only where it is and how big. Never the keys, the layout or the
 * text, and nothing moves on the stand-in they see (a key going down would show what is being typed, passwords too).
 * Pure; tested in Node.
 */

export interface KeyboardPresence {
	position: [number, number, number];
	rotation: [number, number, number, number];
	/** Size of the keyboard's body, in metres. */
	width: number;
	depth: number;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const vector = (v: unknown, n: number): boolean => Array.isArray(v) && v.length === n && v.every(finite);

/** Reads a keyboard off a presence packet from another player: a sane pose and size, or nothing. */
export function parseKeyboardPresence(raw: unknown): KeyboardPresence | undefined {
	if (!raw || typeof raw !== 'object') return undefined;
	const k = raw as Record<string, unknown>;
	if (!vector(k.position, 3) || !vector(k.rotation, 4) || !finite(k.width) || !finite(k.depth)) return undefined;
	const rotation = k.rotation as number[];
	const length = Math.hypot(...rotation);
	if (length < 1e-6) return undefined;
	const clamp = (v: number) => Math.min(1.5, Math.max(0.05, v));
	return {
		position: k.position as KeyboardPresence['position'],
		rotation: rotation.map((v) => v / length) as KeyboardPresence['rotation'],
		width: clamp(k.width as number),
		depth: clamp(k.depth as number)
	};
}
