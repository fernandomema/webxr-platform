/**
 * A record disc as plain slots: a vinyl cylinder (the root, which carries the grab, insert and audio components)
 * with concentric groove bands, a coloured rim and a coloured centre label whose title and author are a text
 * display. The root's `recordDisc` component (title, author, colours) is the one place to edit: `paintDisc` redraws
 * every part from it, and the doc ops call it whenever one of its fields changes, so a disc is customised in the
 * Studio or in the game's inspector with nothing but those fields. Pure: no Babylon, runs in Node.
 *
 * The parts are found as the root's direct children by name (`Disc Rim`, `Disc Plate`, `Disc Groove 1…5`, `Disc Label`,
 * `Disc Label Text`), not by id, so a duplicated or inventory-spawned disc (every id new) repaints just the same.
 */
import type { Quat, Slot, Vec3 } from '../../ecs/types';
import type { SourceRef } from '../../assets/ref';

export interface DiscParams {
	/** Id of the root slot; the other slots derive theirs from it. */
	id: string;
	title: string;
	author: string;
	/** Centre label and rim. */
	labelColor: string;
	/** The vinyl itself. Defaults to near-black. */
	vinylColor?: string;
	/** What it plays: an audio URL (or any audio source the audioPlayer takes). */
	source: SourceRef;
}

interface DiscPlacement {
	parentId?: string | null;
	position?: Vec3;
	rotation?: Quat;
	/** Plays as soon as it exists (a disc that starts inside a record player). */
	playing?: boolean;
}

const DISC_DIAMETER = 0.3;
const DISC_THICKNESS = 0.01;
const DEFAULT_VINYL_COLOR = '#0b0b10';
/** Label art: the label is inscribed with a square this wide (its diagonal fits the circle). */
const LABEL_DIAMETER = 0.13;
const LABEL_TEXT_SIDE = 0.092;
const RIM_DIAMETER = 0.292;
const PLATE_DIAMETER = 0.28;
const GROOVE_DIAMETERS = [0.262, 0.238, 0.214, 0.19, 0.166];

const round = (value: number) => Math.round(value * 10000) / 10000;

/** Mixes a `#rrggbb` colour towards white (positive `amount`, 0–1) or black (negative). */
function shade(hex: string, amount: number): string {
	const value = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? '000000';
	const target = amount >= 0 ? 255 : 0;
	const mix = Math.abs(amount);
	const channel = (offset: number) => {
		const base = parseInt(value.slice(offset, offset + 2), 16);
		return Math.round(base + (target - base) * mix).toString(16).padStart(2, '0');
	};
	return `#${channel(0)}${channel(2)}${channel(4)}`;
}

/** The two alternating tones of the groove bands: the vinyl, and a slightly lighter one. */
const grooveTones = (vinyl: string) => [shade(vinyl, 0.1), vinyl] as const;

const mesh = (shape: string, color: string) => ({ type: 'meshRenderer' as const, meshRef: { kind: 'builtin' as const, id: shape as 'cylinder' | 'plane' }, color });

export function buildDisc(params: DiscParams, placement: DiscPlacement = {}): Slot[] {
	const { id, title, author, labelColor, source } = params;
	const vinyl = params.vinylColor ?? DEFAULT_VINYL_COLOR;
	const [light, dark] = grooveTones(vinyl);
	const root: Slot = {
		id,
		parentId: placement.parentId ?? null,
		name: `Disc: ${title}`,
		position: placement.position ?? [0, 0, 0],
		rotation: placement.rotation ?? [0, 0, 0, 1],
		scale: [DISC_DIAMETER, DISC_THICKNESS, DISC_DIAMETER],
		components: [
			{ type: 'recordDisc', title, author, labelColor, vinylColor: vinyl },
			mesh('cylinder', vinyl),
			{ type: 'collider', shape: 'box' },
			{ type: 'grabbable', scalable: false },
			{ type: 'insertable', tag: 'disc' },
			{ type: 'audioPlayer', source, loop: true, volume: 0.8, ...(placement.playing ? { playing: true } : {}) }
		]
	};
	// The root is squashed flat, so a child's scale and height are given in the root's own (stretched) units.
	const band = (suffix: string, name: string, diameter: number, height: number, color: string): Slot => ({
		id: `${id}-${suffix}`,
		parentId: id,
		name,
		position: [0, round(0.5 + height / (2 * DISC_THICKNESS)), 0],
		rotation: [0, 0, 0, 1],
		scale: [round(diameter / DISC_DIAMETER), round(height / DISC_THICKNESS), round(diameter / DISC_DIAMETER)],
		components: [mesh('cylinder', color)]
	});
	const text = LABEL_TEXT_SIDE / DISC_DIAMETER;
	return [
		root,
		band('rim', 'Disc Rim', RIM_DIAMETER, 0.0004, labelColor),
		band('plate', 'Disc Plate', PLATE_DIAMETER, 0.0008, vinyl),
		...GROOVE_DIAMETERS.map((diameter, index) => band(`groove-${index + 1}`, `Disc Groove ${index + 1}`, diameter, 0.0011 + 0.0003 * index, index % 2 === 0 ? light : dark)),
		band('label', 'Disc Label', LABEL_DIAMETER, 0.003, labelColor),
		{
			id: `${id}-label-text`,
			parentId: id,
			name: 'Disc Label Text',
			position: [0, round(0.5 + 0.0033 / DISC_THICKNESS), 0],
			// Lies on the label, facing up, with the top of the text towards the disc's -Z.
			rotation: [0, 0.7071, -0.7071, 0],
			scale: [round(text), round(text), 1],
			components: [
				mesh('plane', labelColor),
				{ type: 'textDisplay', title, lines: [author], color: labelColor, scale: 1.2, verticalAlign: 'middle' }
			]
		}
	];
}

const byId = (slots: Slot[], id: string) => slots.find((slot) => slot.id === id);

/** What a disc is set to, read from its `recordDisc` component. `null` when `id` is not a disc. */
export function readDisc(slots: Slot[], id: string): Omit<DiscParams, 'source'> | null {
	const component = byId(slots, id)?.components.find((candidate) => candidate.type === 'recordDisc');
	if (!component || component.type !== 'recordDisc') return null;
	return { id, title: component.title, author: component.author, labelColor: component.labelColor, vinylColor: component.vinylColor ?? DEFAULT_VINYL_COLOR };
}

/**
 * Redraws the disc's parts from its `recordDisc` component: the label text, the label and rim colours, the vinyl and
 * its grooves, and the slot's name. Everything else (pose, parent, what it plays, other components) is left alone, so
 * it is safe on a disc that is placed, held or inserted. Returns `slots` itself when `id` is not a disc, and keeps the
 * very same objects for every slot that does not change.
 */
export function paintDisc(slots: Slot[], id: string): Slot[] {
	const disc = readDisc(slots, id);
	if (!disc) return slots;
	const vinyl = disc.vinylColor ?? DEFAULT_VINYL_COLOR;
	const [light, dark] = grooveTones(vinyl);
	const paint = (slot: Slot, color: string, extra?: (component: Slot['components'][number]) => Slot['components'][number]): Slot => {
		const components = slot.components.map((component) => {
			const painted = component.type === 'meshRenderer' ? { ...component, color } : component;
			return extra ? extra(painted) : painted;
		});
		const changed = components.some((component, index) => JSON.stringify(component) !== JSON.stringify(slot.components[index]));
		return changed ? { ...slot, components } : slot;
	};
	return slots.map((slot) => {
		if (slot.id === id) {
			const painted = paint(slot, vinyl);
			const name = `Disc: ${disc.title}`;
			return painted.name === name ? painted : { ...painted, name };
		}
		if (slot.parentId !== id) return slot;
		if (slot.name === 'Disc Rim' || slot.name === 'Disc Label') return paint(slot, disc.labelColor);
		if (slot.name === 'Disc Plate') return paint(slot, vinyl);
		const groove = /^Disc Groove (\d+)$/.exec(slot.name);
		if (groove) return paint(slot, Number(groove[1]) % 2 === 1 ? light : dark);
		if (slot.name === 'Disc Label Text') {
			return paint(slot, disc.labelColor, (component) => component.type === 'textDisplay' ? { ...component, title: disc.title, lines: [disc.author], color: disc.labelColor } : component);
		}
		return slot;
	});
}
