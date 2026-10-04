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
import { lookRotation } from '../thumbnail/cameraPose.ts';

export interface DiscParams {
	/** Id of the root slot; the other slots derive theirs from it. */
	id: string;
	title: string;
	author: string;
	/** Centre label and rim. */
	labelColor: string;
	/** The vinyl itself. Defaults to near-black. */
	vinylColor?: string;
	/** A picture for the centre label (a browser-loadable URL): it replaces the title text and sits over the label colour. */
	labelImage?: string;
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
/** The strip of text that goes on the vinyl when the label is a picture: its size, and how far it lies from the centre. */
const STRIP_WIDTH = 0.15;
const STRIP_HEIGHT = 0.045;
const STRIP_Z = 0.105;
const PLATE_DIAMETER = 0.28;
const GROOVE_DIAMETERS = [0.262, 0.238, 0.214, 0.19, 0.166];

/** Rounds to four decimals; `+ 0` turns a -0 into 0 so that what is saved and read back is the same. */
const round = (value: number) => Math.round(value * 10000) / 10000 + 0;

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
			{ type: 'recordDisc', title, author, labelColor, vinylColor: vinyl, ...(params.labelImage ? { labelImage: params.labelImage } : {}) },
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
	return [
		root,
		band('rim', 'Disc Rim', RIM_DIAMETER, 0.0004, labelColor),
		band('plate', 'Disc Plate', PLATE_DIAMETER, 0.0008, vinyl),
		...GROOVE_DIAMETERS.map((diameter, index) => band(`groove-${index + 1}`, `Disc Groove ${index + 1}`, diameter, 0.0011 + 0.0003 * index, index % 2 === 0 ? light : dark)),
		band('label', 'Disc Label', LABEL_DIAMETER, 0.003, labelColor),
		// With a picture the label is all picture, so the title and author move to a strip on the vinyl below it.
		...(params.labelImage ? labelImage(id, params.labelImage) : []),
		labelText(id, title, author, labelColor, params.labelImage ? 'strip' : 'label'),
		previewCamera(id)
	];
}

/** The picture is drawn in a circle this many pixels wide, inside a square panel (the panel lays its content out in 92% of its size). */
const ART_PIXELS = 256;
const ART_CONTENT = 0.92;

/**
 * The picture of a label: a small UI panel lying on the label, facing up, with a round container (its corners are cut by the
 * radius) holding one image. The panel is larger than the label by the margin it keeps, so the circle is exactly the label.
 */
function labelImage(id: string, url: string): Slot[] {
	const side = Math.floor(ART_PIXELS * ART_CONTENT);
	const panel = `${id}-label-image`;
	const circle = `${id}-label-circle`;
	const flat = { rotation: [0, 0, 0, 1] as Quat, scale: [1, 1, 1] as Vec3, position: [0, 0, 0] as Vec3 };
	return [
		{
			id: panel,
			parentId: id,
			name: 'Disc Label Image',
			position: [0, round(0.5 + 0.0036 / DISC_THICKNESS), 0],
			// Lies on the label, facing up, like the label text.
			rotation: [0, 0.7071, -0.7071, 0],
			scale: [round(LABEL_DIAMETER / ART_CONTENT / DISC_DIAMETER), round(LABEL_DIAMETER / ART_CONTENT / DISC_DIAMETER), 1],
			components: [{ type: 'uiPanel', width: ART_PIXELS, height: ART_PIXELS, worldWidth: 1, background: 'transparent' }]
		},
		{ ...flat, id: circle, parentId: panel, name: 'Disc Label Circle', components: [{ type: 'uiElement', kind: 'container', width: side, height: side, cornerRadius: side / 2 }] },
		{ ...flat, id: `${id}-label-picture`, parentId: circle, name: 'Disc Label Picture', components: [{ type: 'uiElement', kind: 'image', src: url, width: side, height: side }] }
	];
}

/** The title and author: on the label itself, or (`strip`) on a plate of the label colour lying on the vinyl, on the player's side of the label. */
function labelText(id: string, title: string, author: string, labelColor: string, place: 'label' | 'strip'): Slot {
	const side = LABEL_TEXT_SIDE / DISC_DIAMETER;
	return {
		id: `${id}-label-text`,
		parentId: id,
		name: 'Disc Label Text',
		// A plane's width runs along the disc's X and its height along Z (it is turned to lie flat), both in the root's stretched units.
		position: [0, round(0.5 + 0.0033 / DISC_THICKNESS), place === 'strip' ? round(STRIP_Z / DISC_DIAMETER) : 0],
		// Lies on the label, facing up, with the top of the text towards the disc's -Z.
		rotation: [0, 0.7071, -0.7071, 0],
		scale: place === 'strip' ? [round(STRIP_WIDTH / DISC_DIAMETER), round(STRIP_HEIGHT / DISC_DIAMETER), 1] : [round(side), round(side), 1],
		components: [
			mesh('plane', labelColor),
			{ type: 'textDisplay', title, lines: [author], color: labelColor, scale: place === 'strip' ? 0.8 : 1.2, verticalAlign: 'middle' }
		]
	};
}

/**
 * Where a picture of the disc is taken from (the inventory and the world's thumbnails use it): above and in front of it, looking
 * down at the label with its top away from the camera. The slot sits in the root's stretched units, so the metres are divided by the scale.
 */
function previewCamera(id: string): Slot {
	const position: Vec3 = [0, 0.4, 0.35];
	return {
		id: `${id}-preview-camera`,
		parentId: id,
		name: 'Disc Preview Camera',
		position: [round(position[0] / DISC_DIAMETER), round(position[1] / DISC_THICKNESS), round(position[2] / DISC_DIAMETER)],
		rotation: lookRotation([-position[0], -position[1], -position[2]]).map(round) as Quat,
		scale: [1, 1, 1],
		components: [{ type: 'previewCamera' }]
	};
}

const byId = (slots: Slot[], id: string) => slots.find((slot) => slot.id === id);

/** What a disc is set to, read from its `recordDisc` component. `null` when `id` is not a disc. */
export function readDisc(slots: Slot[], id: string): Omit<DiscParams, 'source'> | null {
	const component = byId(slots, id)?.components.find((candidate) => candidate.type === 'recordDisc');
	if (!component || component.type !== 'recordDisc') return null;
	return { id, title: component.title, author: component.author, labelColor: component.labelColor, vinylColor: component.vinylColor ?? DEFAULT_VINYL_COLOR, ...(component.labelImage ? { labelImage: component.labelImage } : {}) };
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
		// The picture of a label that has one follows its image address.
		if (slot.name === 'Disc Label Picture' && disc.labelImage) {
			const circle = slots.find((candidate) => candidate.id === slot.parentId);
			const panel = slots.find((candidate) => candidate.id === circle?.parentId);
			if (panel?.parentId === id && panel.name === 'Disc Label Image') {
				return { ...slot, components: slot.components.map((component) => (component.type === 'uiElement' && component.src !== disc.labelImage ? { ...component, src: disc.labelImage } : component)) };
			}
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
