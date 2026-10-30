import { TransformNode, type AbstractMesh, type Scene } from '@babylonjs/core';
import { AdvancedDynamicTexture, Control, Rectangle, StackPanel, TextBlock } from '@babylonjs/gui';
import { findComponent, type Slot, type TextDisplayComponent } from '../ecs/types.ts';
import { setSurfaceLit } from './surfaceLighting.ts';

/** What a text display draws, without drawing it: the background, and each row's text, colour and size (times `unit`, the pixels of the standard size). */
export function textDisplayRows(component: TextDisplayComponent, unit = 1): { background: string; rows: { text: string; color: string; size: number }[] } {
	const k = unit * (component.scale ?? 1);
	const rows: { text: string; color: string; size: number }[] = [];
	if (component.title) rows.push({ text: component.title, color: component.titleColor ?? '#facc15', size: 40 * k });
	component.lines.forEach((line, n) => {
		const size = component.lineSizes?.[n];
		rows.push({ text: line, color: component.lineColors?.[n] ?? component.lineColor ?? 'white', size: 30 * k * (typeof size === 'number' && size > 0 ? size : 1) });
	});
	return { background: component.background ?? component.color ?? '#0f172a', rows };
}

/** What a glyph takes of its font size across, on average, and what a row of text takes down (line height and the gap under it), both as the sign draws them. */
const GLYPH_WIDTH = 0.55;
const ROW_HEIGHT = 1.25;
const ROW_GAP = 0.3;
/** How much of the sign's room text may fill when it is sized to the sign, and the largest it is made (times the standard size). */
const FILL = 0.85;
const MAX_AUTO_SCALE = 4;

/**
 * How big the text of a sign is when the sign does not say (`scale` unset): the standard size, or larger when the sign has room to spare, so a short title
 * on a big board is not a speck in the middle of it. The text grows until it fills `FILL` of the room it has (the design box: the sign's texture with its shorter side
 * taken as 512, its content 90% as wide, with 24 clear above and below), up to `MAX_AUTO_SCALE` times; it is never made smaller than the standard size, which is what
 * a sign full of lines was designed with.
 */
export function autoTextScale(component: TextDisplayComponent, width: number, height: number): number {
	// The texture is what text is drawn on, and its sides are capped, so a very long sign has less room than its proportions say.
	const [textureWidth, textureHeight] = textDisplayTextureSize(width, height);
	const toDesign = DESIGN_SHORT_SIDE / Math.min(textureWidth, textureHeight);
	const designWidth = textureWidth * toDesign, designHeight = textureHeight * toDesign;
	const room = { width: designWidth * 0.9, height: (designHeight - 48) * FILL };
	const rows = textDisplayRows({ ...component, scale: 1 }).rows;
	const heightAt = (k: number): number => rows.reduce((sum, row) => {
		const size = row.size * k;
		const lines = row.text.split('\n').reduce((count, part) => count + Math.max(1, Math.ceil((part.length * GLYPH_WIDTH * size) / room.width)), 0);
		return sum + lines * size * ROW_HEIGHT + size * ROW_GAP;
	}, 0);
	if (rows.length === 0 || heightAt(1) >= room.height) return 1;
	let best = 1;
	for (let k = 1.05; k <= MAX_AUTO_SCALE + 1e-9; k += 0.05) { if (heightAt(k) > room.height) break; best = k; }
	return Math.round(best * 100) / 100;
}

export interface TextDisplayBinding {
	dispose(): void;
	sync(slot: Slot): void;
}

/**
 * Pixels along the sign's shorter side: about 1200 per metre of it, between 128 (a price tag) and 512 (a large sign).
 * The longer side gets as many more as the sign is long, so text keeps its shape. The layout is designed for 512.
 */
const DESIGN_SHORT_SIDE = 512;
const MIN_SHORT_SIDE = 128;
const PIXELS_PER_METRE = 1200;
const MAX_SIDE = 2048;

/** The texture size for a plane scaled `width` by `height` (metres): its own proportions, its shorter side by its size. */
export function textDisplayTextureSize(width: number, height: number): [number, number] {
	const w = Math.abs(width) || 1, h = Math.abs(height) || 1;
	const short = Math.round(Math.min(DESIGN_SHORT_SIDE, Math.max(MIN_SHORT_SIDE, Math.min(w, h) * PIXELS_PER_METRE)));
	const size = (ratio: number) => Math.round(Math.min(MAX_SIDE, short * ratio));
	return w >= h ? [size(w / h), short] : [short, size(h / w)];
}

/**
 * Renders a `textDisplay` component's title/lines onto a plane mesh — a
 * generic floating sign/scoreboard surface (see types.ts), driven purely by
 * component data. Re-renders whenever `sync(slot)` is called, which
 * SceneGraph does both on an incoming host->guest snapshot AND immediately
 * after a local `setComponentField` — so a script writing new `lines` (host
 * or solo) redraws instantly, not just on the next network reconcile.
 *
 * The texture follows the plane's proportions (and is resized if the plane is rescaled), so a wide sign is not drawn
 * squashed; a title or line too long for one row wraps onto as many as it needs instead of spilling over the next.
 */
export function setupTextDisplay(scene: Scene, mesh: AbstractMesh, initial: TextDisplayComponent): TextDisplayBinding {
	let size = textDisplayTextureSize(mesh.scaling.x, mesh.scaling.y);
	// Display only: it need not follow the pointers moving over it (in a headset, every controller's, every frame).
	const texture = AdvancedDynamicTexture.CreateForMesh(mesh, size[0], size[1], false);

	const background = new Rectangle('text-display-bg');
	background.width = 1;
	background.height = 1;
	background.thickness = 0;
	texture.addControl(background);

	const stack = new StackPanel('text-display-stack');
	stack.width = '90%';
	stack.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
	background.addControl(stack);

	/** Design pixels (for a 512 px short side) to this texture's pixels, times the component's text scale. */
	let unit = 1;
	const fit = (component: TextDisplayComponent) => {
		unit = Math.min(size[0], size[1]) / DESIGN_SHORT_SIDE;
		const middle = component.verticalAlign === 'middle';
		stack.verticalAlignment = middle ? Control.VERTICAL_ALIGNMENT_CENTER : Control.VERTICAL_ALIGNMENT_TOP;
		stack.top = middle ? '0px' : `${Math.round(24 * unit)}px`;
		return unit * (component.scale ?? autoTextScale(component, mesh.scaling.x, mesh.scaling.y));
	};

	function textRow(text: string, color: string, fontSize: number): TextBlock {
		const block = new TextBlock('', text);
		block.color = color;
		block.fontSize = fontSize;
		block.textWrapping = true;
		block.resizeToFit = true; // with wrapping on, the row grows as tall as its wrapped lines
		block.paddingBottom = `${Math.round(fontSize * 0.3)}px`;
		block.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
		return block;
	}

	let current = initial;
	function render(component: TextDisplayComponent): void {
		current = component;
		const k = fit(component);
		// `k` already has the sign's own scale in it (or the one worked out for it), which the rows would apply again.
		const drawn = textDisplayRows({ ...component, scale: 1 }, k);
		background.background = drawn.background;
		setSurfaceLit(mesh, texture, component.lit === true);
		for (const child of [...stack.children]) stack.removeControl(child);
		for (const row of drawn.rows) stack.addControl(textRow(row.text, row.color, row.size));
		mesh.billboardMode = component.billboard === 'full' ? TransformNode.BILLBOARDMODE_ALL : component.billboard === 'y' ? TransformNode.BILLBOARDMODE_Y : TransformNode.BILLBOARDMODE_NONE;
	}

	render(initial);

	const resize = scene.onBeforeRenderObservable.add(() => {
		const wanted = textDisplayTextureSize(mesh.scaling.x, mesh.scaling.y);
		if (wanted[0] === size[0] && wanted[1] === size[1]) return;
		size = wanted;
		texture.scaleTo(size[0], size[1]);
		render(current);
	});

	return {
		dispose: () => {
			scene.onBeforeRenderObservable.remove(resize);
			texture.dispose();
		},
		sync: (slot) => {
			const component = findComponent(slot, 'textDisplay');
			if (component) render(component);
		}
	};
}
