// Draws the six faces of the reflection probe of the alley (worlds/bowling/assets/probe/*.png): a simple picture of the room as a glossy
// ball sees it (ceiling lamps, neon lines, the lit lane, the dark carpet). Run: node --experimental-transform-types worlds/bowling/makeProbe.mjs
// It is a picture made by hand and not a capture, so it looks the same in the Studio and in play whatever has loaded.
import { writeFileSync } from 'node:fs';
import { encodePng } from '../../packages/engine/src/lighting/nodePng.ts';

const SIZE = 256;
const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
const glow = (d, w) => Math.exp(-((d / w) ** 2));
const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * Math.min(1, Math.max(0, t)));

/** Draws a face: `paint(u, v)` with u across and v up, both -1 to 1, returns a colour. */
function face(name, paint) {
	const rgba = new Uint8Array(SIZE * SIZE * 4);
	for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
		const u = ((x + 0.5) / SIZE) * 2 - 1, v = 1 - ((y + 0.5) / SIZE) * 2;
		const c = paint(u, v);
		const i = (y * SIZE + x) * 4;
		rgba[i] = Math.min(255, c[0]); rgba[i + 1] = Math.min(255, c[1]); rgba[i + 2] = Math.min(255, c[2]); rgba[i + 3] = 255;
	}
	writeFileSync(new URL(`./assets/probe/${name}.png`, import.meta.url), encodePng(rgba, SIZE, SIZE));
}

const WALL = hex('#1c1634'), DARK = hex('#0b0a16'), CARPET = hex('#2a2820'), WOOD = hex('#d9a45f'), WHITE = hex('#e6f0ff'), WARM = hex('#ffd9a8'), MAGENTA = hex('#ff3fb8'), CYAN = hex('#35e8ff');
const add = (base, colour, k) => base.map((c, i) => c + colour[i] * k);

/** A wall seen from inside: dark paint, a lamp row near the top, a neon line low down, carpet below the horizon. */
function wall(neon, extras = () => [0, 0, 0]) {
	return (u, v) => {
		let c = v < -0.05 ? mix(CARPET, DARK, (-v - 0.05) * 1.2) : mix(WALL, DARK, Math.max(0, v - 0.2));
		c = add(c, WHITE, 0.9 * glow(v - 0.72, 0.05) * (0.6 + 0.4 * Math.cos(u * 9)));
		c = add(c, neon, 0.95 * glow(v + 0.18, 0.025));
		return add(c, extras(u, v), 1);
	};
}

// Up: the ceiling, with the long lamp strips over the lanes and the neon along both walls.
face('py', (u, v) => {
	let c = DARK;
	for (const x of [-0.55, -0.18, 0.18, 0.55]) c = add(c, WHITE, 1.0 * glow(u - x, 0.045));
	c = add(c, MAGENTA, 0.9 * glow(u + 0.92, 0.03));
	c = add(c, CYAN, 0.9 * glow(u - 0.92, 0.03));
	return add(c, WARM, 0.35 * glow(v + 0.6, 0.35) * glow(u, 0.6));
});
// Down: the floor, dark carpet with the lit wood of the lanes in the middle.
face('ny', (u, v) => {
	let c = CARPET;
	for (const x of [-0.5, -0.15, 0.15, 0.5]) c = mix(c, WOOD, 0.75 * glow(u - x, 0.1));
	return add(c, WARM, 0.25 * glow(v, 0.4));
});
// Along the lanes (+Z): the pin end, a bright wall with the magenta sign over a hot patch of light on the lane.
face('pz', wall(MAGENTA, (u, v) => {
	const sign = Math.abs(u) < 0.55 && v > 0.2 && v < 0.55 ? 1 : 0;
	return [...MAGENTA].map((c, i) => c * 0.8 * sign + WARM[i] * 0.9 * glow(u, 0.25) * glow(v + 0.25, 0.18) + WOOD[i] * 0.5 * (v < -0.05 ? glow(u, 0.5) : 0));
}));
// Behind the bowler (-Z): the lobby, amber lamps and the dark carpet.
face('nz', wall(hex('#ffb347'), (u, v) => WARM.map((c) => c * 0.8 * glow(v - 0.5, 0.08) * glow(Math.abs(u) - 0.45, 0.2))));
// East (+X): cyan neon. West (-X): magenta neon and the warm bar.
face('px', wall(CYAN));
face('nx', wall(MAGENTA, (u, v) => WARM.map((c) => c * 0.5 * glow(v - 0.15, 0.2) * glow(u, 0.35))));
console.log('probe faces written');
