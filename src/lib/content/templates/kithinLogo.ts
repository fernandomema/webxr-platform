import type { Component, Quat, Slot, SlotTree } from '@kithin/engine/ecs/types';

/**
 * The Kithin mark as a wall piece, in relief, built from the disc of `static/assets/kithin-logo.svg`: a domed disc that goes from warm yellow at the top left to
 * orange at the bottom right, with a dark hole in it. Nothing else (no name, no frame, no plaque). The disc is a stack of flattened spheres, each smaller, higher
 * and a little lower right than the one under it, so it is a medallion that the light shades (it is lit, not flat). It is read from the -Z side looking
 * +Z, like any sign: turn the slot that loads it to face the room, with its origin on the wall. 2.4 m across and 0.6 m deep. Everything is shapes: it needs no
 * asset, so any world can load it (`loader`, adapter `builtin`, id `kithin-logo`) at no cost to its own size.
 */
export const KITHIN_LOGO_ID = 'kithin-logo';

const ID = KITHIN_LOGO_ID;

/** A dome: a sphere squashed along the view, `r` metres in radius, `height` metres standing out from the wall, at (x, y). */
const dome = (suffix: string, name: string, color: string, r: number, height: number, x: number, y: number): Slot => ({
	id: `${ID}-${suffix}`,
	parentId: ID,
	name,
	position: [x, y, 0],
	rotation: [0, 0, 0, 1],
	// The sphere is centred on the wall, so half of it is inside: its front stands out by half its depth.
	scale: [r * 2, r * 2, height * 2],
	components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' }, color }]
});

export function buildKithinLogo(): SlotTree {
	return [
		{ id: ID, parentId: null, name: 'Kithin Logo', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components: [{ type: 'container' }] },
		// Each dome is smaller than the one under it and stands out further, and sits lower right: light at the top left, orange at the bottom right.
		dome('disc-0', 'Logo Disc', '#ffd98a', 1.2, 0.16, 0, 0),
		dome('disc-1', 'Logo Disc', '#ffb868', 0.97, 0.26, 0.1, -0.1),
		dome('disc-2', 'Logo Disc', '#ff8f4f', 0.72, 0.36, 0.2, -0.2),
		// The hole: a dark button in the middle, with its own rim.
		dome('rim', 'Logo Hole Rim', '#d9531f', 0.55, 0.4, 0, 0),
		dome('hole', 'Logo Hole', '#07070c', 0.5, 0.42, 0, 0)
	];
}
