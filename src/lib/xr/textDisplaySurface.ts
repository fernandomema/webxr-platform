import type { AbstractMesh, Scene } from '@babylonjs/core';
import { AdvancedDynamicTexture, Control, Rectangle, StackPanel, TextBlock } from '@babylonjs/gui';
import { findComponent, type Slot, type TextDisplayComponent } from '$lib/ecs/types';

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
		stack.top = `${Math.round(24 * unit)}px`;
		return unit * (component.scale ?? 1);
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
		background.background = component.color ?? '#0f172a';
		for (const child of [...stack.children]) stack.removeControl(child);
		if (component.title) stack.addControl(textRow(component.title, '#facc15', 40 * k));
		for (const line of component.lines) stack.addControl(textRow(line, 'white', 30 * k));
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
