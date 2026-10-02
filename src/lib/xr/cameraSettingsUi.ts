import { Color3, MeshBuilder, StandardMaterial, type AbstractMesh, type Scene } from '@babylonjs/core';
import { AdvancedDynamicTexture, Button, Control, Rectangle, StackPanel, TextBlock } from '@babylonjs/gui';

export type CameraQuality = 'low' | 'medium' | 'high';
export type CameraMode = 'photo' | 'video';
/** `2d`: one picture. `3d`: a stereo pair, left eye then right eye side by side, the form 3D viewers and the converters to spatial photos take. */
export type CameraFormat = '2d' | '3d';

export interface CameraSettings {
	quality: CameraQuality;
	format: CameraFormat;
	mode: CameraMode;
}

/** Pixels on the long side of the picture, per quality. */
export const QUALITY_LONG_SIDE: Record<CameraQuality, number> = { low: 640, medium: 960, high: 1280 };
export const QUALITY_LABEL: Record<CameraQuality, string> = { low: 'Low', medium: 'Medium', high: 'High' };

const STORAGE_KEY = 'kithin.camera.settings';

/** The quality whose size is nearest to a pixel count (the size a camera was built with). */
export function qualityFor(longSide: number): CameraQuality {
	return longSide <= 800 ? 'low' : longSide <= 1100 ? 'medium' : 'high';
}

/** What a device remembers between sessions; anything missing or odd falls back to the defaults. */
export function loadSettings(fallback: CameraQuality): CameraSettings {
	const settings: CameraSettings = { quality: fallback, format: '2d', mode: 'photo' };
	try {
		const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<CameraSettings>;
		if (parsed.quality === 'low' || parsed.quality === 'medium' || parsed.quality === 'high') settings.quality = parsed.quality;
		if (parsed.format === '2d' || parsed.format === '3d') settings.format = parsed.format;
	} catch {
		// private window or blocked storage: the defaults stand
	}
	return settings;
}

export function saveSettings(settings: CameraSettings): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ quality: settings.quality, format: settings.format }));
	} catch {
		// not remembered
	}
}

export interface CameraUiHooks {
	get(): CameraSettings;
	set(patch: Partial<CameraSettings>): void;
	/** Settings do not change under a video being recorded. */
	isRecording(): boolean;
}

export interface CameraUi {
	refresh(): void;
	dispose(): void;
}

const WIDTH = 960;

/**
 * The camera's controls, drawn over its screen: a small gear that opens a panel with the quality, the format and
 * the mode. They are pressed with the other hand's laser, as any panel in the world. The overlay is a child of the
 * screen, so it follows the camera and (as a part of it) is never in the picture.
 */
export function createCameraUi(scene: Scene, screen: AbstractMesh, aspect: number, hooks: CameraUiHooks): CameraUi {
	const height = Math.round(WIDTH / aspect);
	const plane = MeshBuilder.CreatePlane(`${screen.name}-controls`, { width: 1, height: 1 }, scene);
	plane.parent = screen;
	// In front of the screen, towards whoever looks at it (the screen's -Z side).
	plane.position.z = -0.002;
	plane.isPickable = true;
	plane.metadata = { interactive: true };
	const material = new StandardMaterial(`${screen.name}-controls-material`, scene);
	material.disableLighting = true;
	material.emissiveColor = Color3.White();
	material.backFaceCulling = false;
	plane.material = material;

	const texture = AdvancedDynamicTexture.CreateForMesh(plane, WIDTH, height, true);

	const style = (button: Button, selected: boolean, enabled = true) => {
		button.background = selected ? '#4f46e5' : '#1f2937';
		button.color = enabled ? 'white' : '#6b7280';
		button.alpha = enabled ? 1 : 0.6;
	};
	const makeButton = (name: string, label: string, onClick: () => void, buttonWidth: string, buttonHeight = '64px') => {
		const button = Button.CreateSimpleButton(name, label);
		button.width = buttonWidth;
		button.height = buttonHeight;
		button.fontSize = 28;
		button.cornerRadius = 12;
		button.thickness = 0;
		button.paddingLeft = '6px';
		button.paddingRight = '6px';
		button.onPointerClickObservable.add(onClick);
		return button;
	};

	const gear = makeButton('camera-gear', '⚙', () => {
		open = !open;
		refresh();
	}, '84px', '84px');
	gear.fontSize = 44;
	gear.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
	gear.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
	gear.top = '14px';
	gear.left = '-14px';
	gear.alpha = 0.7;

	const panel = new Rectangle('camera-panel');
	panel.width = 0.94;
	panel.height = 0.9;
	panel.thickness = 0;
	panel.cornerRadius = 20;
	panel.background = 'rgba(8, 11, 20, 0.9)';
	panel.isVisible = false;
	panel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
	texture.addControl(panel);
	const stack = new StackPanel('camera-panel-stack');
	stack.width = 0.94;
	panel.addControl(stack);

	const heading = (text: string) => {
		const block = new TextBlock(`camera-heading-${text}`, text);
		block.height = '44px';
		block.fontSize = 26;
		block.color = '#9ca3af';
		block.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		return block;
	};
	const row = (name: string) => {
		const holder = new StackPanel(name);
		holder.isVertical = false;
		holder.height = '76px';
		holder.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		return holder;
	};

	const qualityButtons = new Map<CameraQuality, Button>();
	const formatButtons = new Map<CameraFormat, Button>();
	const modeButtons = new Map<CameraMode, Button>();

	stack.addControl(heading('Quality'));
	const qualityRow = row('camera-quality-row');
	for (const quality of ['low', 'medium', 'high'] as const) {
		const button = makeButton(`camera-quality-${quality}`, QUALITY_LABEL[quality], () => {
			if (!hooks.isRecording()) hooks.set({ quality });
		}, '270px');
		qualityButtons.set(quality, button);
		qualityRow.addControl(button);
	}
	stack.addControl(qualityRow);

	stack.addControl(heading('Photo format'));
	const formatRow = row('camera-format-row');
	for (const [format, label] of [['2d', '2D'], ['3d', '3D side by side']] as const) {
		const button = makeButton(`camera-format-${format}`, label, () => hooks.set({ format }), format === '2d' ? '200px' : '420px');
		formatButtons.set(format, button);
		formatRow.addControl(button);
	}
	stack.addControl(formatRow);

	stack.addControl(heading('Trigger'));
	const modeRow = row('camera-mode-row');
	for (const [mode, label] of [['photo', 'Photo'], ['video', 'Video']] as const) {
		const button = makeButton(`camera-mode-${mode}`, label, () => {
			if (!hooks.isRecording()) hooks.set({ mode });
		}, '300px');
		modeButtons.set(mode, button);
		modeRow.addControl(button);
	}
	stack.addControl(modeRow);

	// Added last, so it stays above the panel and can close it.
	texture.addControl(gear);

	let open = false;
	const refresh = () => {
		const settings = hooks.get();
		const recording = hooks.isRecording();
		panel.isVisible = open;
		(gear.textBlock as TextBlock).text = open ? '✕' : '⚙';
		for (const [quality, button] of qualityButtons) style(button, settings.quality === quality, !recording);
		for (const [format, button] of formatButtons) style(button, settings.format === format);
		for (const [mode, button] of modeButtons) style(button, settings.mode === mode, !recording);
	};
	refresh();

	return {
		refresh,
		dispose: () => {
			texture.dispose();
			material.dispose();
			plane.dispose();
		}
	};
}
