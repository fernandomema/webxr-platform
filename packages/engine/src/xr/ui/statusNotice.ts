import { MeshBuilder, Quaternion, StandardMaterial, Color3, type Camera, type Scene } from '@babylonjs/core';
import { AdvancedDynamicTexture, Rectangle, TextBlock } from '@babylonjs/gui';
import { THEME } from './theme.ts';

export type NoticeTone = 'info' | 'warn' | 'error';

/**
 * One short message held in front of the view, a little above its centre, in a headset and on the desktop alike: what the
 * player must know even with every menu closed (the link to the host dropped and is being made again, a player was lost…).
 * A new message replaces the one shown. Without `durationMs` it stays until it is replaced or hidden.
 */
export interface StatusNotice {
	show(message: string, options?: { tone?: NoticeTone; durationMs?: number }): void;
	hide(): void;
	dispose(): void;
}

const TONES: Record<NoticeTone, string> = { info: '#14532dee', warn: '#78350fee', error: '#7f1d1dee' };

export function createStatusNotice(scene: Scene, getCamera: () => Camera): StatusNotice {
	const plane = MeshBuilder.CreatePlane('status-notice', { width: 0.44, height: 0.066 }, scene);
	plane.isPickable = false;
	// Over everything, like the radial menu and the performance readout.
	plane.renderingGroupId = 1;
	const material = new StandardMaterial('status-notice', scene);
	material.disableLighting = true;
	material.emissiveColor = Color3.White();
	material.backFaceCulling = false;
	plane.material = material;
	plane.setEnabled(false);

	const texture = AdvancedDynamicTexture.CreateForMesh(plane, 1024, 154, false);
	const box = new Rectangle('status-notice-box');
	box.thickness = 0;
	box.cornerRadius = 40;
	box.background = TONES.info;
	texture.addControl(box);
	const text = new TextBlock('status-notice-text', '');
	text.color = THEME.text;
	text.fontSize = 44;
	text.textWrapping = true;
	text.paddingLeft = text.paddingRight = '36px';
	box.addControl(text);

	let hideTimer: ReturnType<typeof setTimeout> | null = null;

	const observer = scene.onBeforeRenderObservable.add(() => {
		if (!plane.isEnabled()) return;
		const camera = getCamera();
		const forward = camera.getForwardRay().direction;
		const up = camera.upVector;
		plane.position = camera.globalPosition.add(forward.scale(0.8)).add(up.scale(0.17));
		// Turned to face the viewer: its readable side towards them, not its back (which reads mirrored).
		plane.rotationQuaternion = Quaternion.FromLookDirectionLH(forward.scale(-1), up);
	});

	const hide = () => {
		if (hideTimer) clearTimeout(hideTimer);
		hideTimer = null;
		plane.setEnabled(false);
	};

	return {
		show(message, options = {}) {
			if (hideTimer) clearTimeout(hideTimer);
			hideTimer = null;
			text.text = message;
			box.background = TONES[options.tone ?? 'info'];
			plane.setEnabled(true);
			if (options.durationMs) hideTimer = setTimeout(hide, options.durationMs);
		},
		hide,
		dispose() {
			hide();
			scene.onBeforeRenderObservable.remove(observer);
			texture.dispose();
			material.dispose();
			plane.dispose();
		}
	};
}
