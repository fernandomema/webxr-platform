import type { AbstractMesh, Scene } from '@babylonjs/core';
import { AdvancedDynamicTexture, Control, Rectangle, StackPanel, TextBlock } from '@babylonjs/gui';
import { findComponent, type Slot, type TextDisplayComponent } from '$lib/ecs/types';

export interface TextDisplayBinding {
	dispose(): void;
	sync(slot: Slot): void;
}

/**
 * Renders a `textDisplay` component's title/lines onto a plane mesh — a
 * generic floating sign/scoreboard surface (see types.ts), driven purely by
 * component data. Re-renders whenever `sync(slot)` is called, which
 * SceneGraph does both on an incoming host->guest snapshot AND immediately
 * after a local `setComponentField` — so a script writing new `lines` (host
 * or solo) redraws instantly, not just on the next network reconcile.
 */
export function setupTextDisplay(scene: Scene, mesh: AbstractMesh, initial: TextDisplayComponent): TextDisplayBinding {
	const texture = AdvancedDynamicTexture.CreateForMesh(mesh, 512, 512, true);

	const background = new Rectangle('text-display-bg');
	background.width = 1;
	background.height = 1;
	background.thickness = 0;
	texture.addControl(background);

	const stack = new StackPanel('text-display-stack');
	stack.width = '90%';
	stack.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
	stack.top = '24px';
	background.addControl(stack);

	function render(component: TextDisplayComponent): void {
		background.background = component.color ?? '#0f172a';
		for (const child of [...stack.children]) stack.removeControl(child);

		if (component.title) {
			const title = new TextBlock('', component.title);
			title.color = '#facc15';
			title.fontSize = 40;
			title.height = '56px';
			title.textWrapping = true;
			title.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
			stack.addControl(title);
		}

		for (const line of component.lines) {
			const text = new TextBlock('', line);
			text.color = 'white';
			text.fontSize = 30;
			text.height = '40px';
			text.textWrapping = true;
			text.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
			stack.addControl(text);
		}
	}

	render(initial);

	return {
		dispose: () => texture.dispose(),
		sync: (slot) => {
			const component = findComponent(slot, 'textDisplay');
			if (component) render(component);
		}
	};
}
