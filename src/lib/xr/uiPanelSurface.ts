import { Texture, type AbstractMesh, type Observer, type Scene } from '@babylonjs/core';
import {
	AdvancedDynamicTexture,
	Button,
	Control,
	Image,
	InputText,
	Rectangle,
	ScrollViewer,
	Slider,
	StackPanel,
	TextBlock
} from '@babylonjs/gui';
import { findComponent, type Slot, type UIElementComponent, type UIEvent, type UIPanelComponent } from '$lib/ecs/types';
import { typeWithKeyboard } from './keyboard/guiInput';
import { hasInteractiveControls } from './uiPanelInteractivity';

/** Playback state of a `video` element on this peer, as read by `ctx.ui.getMedia`. */
export interface UIMediaState {
	currentTime: number;
	duration: number;
	paused: boolean;
	ended: boolean;
	ready: boolean;
	error: boolean;
}

export interface UIPanelBinding {
	dispose(): void;
	sync(): void;
	getMedia(slotId: string): UIMediaState | undefined;
	getInputText(slotId: string): string | undefined;
}

interface Entry {
	slot: Slot;
	component: UIElementComponent;
	control: Control;
	kind: UIElementComponent['kind'];
	/** The layout stack that holds this container's children. */
	stack?: StackPanel;
	/** `input`: the last `component.text` pushed into the field, so a script can reset it without a keystroke being overwritten. */
	appliedText?: string;
	dragging?: boolean;
}

interface MarginSpacers {
	stack: StackPanel;
	before: Rectangle;
	after: Rectangle;
}

/** The `<video>` behind a `video` element. It outlives a panel rebuild so adding a sibling never restarts playback. */
interface VideoRuntime {
	video: HTMLVideoElement;
	canvas: HTMLCanvasElement;
	image: Image | null;
	src: string;
	appliedSeek: number | undefined;
	dirty: boolean;
	lastDrawnFrame: number;
}

const VIDEO_CANVAS_WIDTH = 1280;
const VIDEO_CANVAS_HEIGHT = 720;
const INPUT_CHANGE_DEBOUNCE_MS = 250;

/** An InputText that reports Enter, which plain InputText only turns into a silent blur. */
class SubmitInputText extends InputText {
	onSubmit: (() => void) | null = null;
	override processKey(keyCode: number, key?: string, evt?: Parameters<InputText['processKey']>[2]): void {
		if (keyCode === 13) this.onSubmit?.();
		super.processKey(keyCode, key, evt);
	}
}

function resolveMediaUrl(url: string | undefined): string {
	if (!url) return '';
	try {
		const parsed = new URL(url, window.location.href);
		if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'blob:') return parsed.href;
	} catch {
		// An invalid URL is treated as no source.
	}
	return '';
}

function defaultHeight(component: UIElementComponent): string {
	if (component.height !== undefined) return `${component.height}px`;
	switch (component.kind) {
		case 'button':
			return '44px';
		case 'text':
			return '36px';
		case 'input':
			return '48px';
		case 'image':
			return '120px';
		case 'video':
			return '360px';
		case 'slider':
			return '24px';
		default:
			return '100%';
	}
}

function setSize(control: Control, component: UIElementComponent): void {
	control.width = component.width === undefined ? '100%' : `${component.width}px`;
	if (component.kind !== 'container' || component.height !== undefined) control.height = defaultHeight(component);
	if (component.padding !== undefined) control.setPaddingInPixels(component.padding);
	control.isVisible = component.visible !== false;
}

const TEXT_ALIGN: Record<NonNullable<UIElementComponent['textAlign']>, number> = {
	left: Control.HORIZONTAL_ALIGNMENT_LEFT,
	center: Control.HORIZONTAL_ALIGNMENT_CENTER,
	right: Control.HORIZONTAL_ALIGNMENT_RIGHT
};

/** The look of a container's box: its fill, rounded corners and outline. */
function styleBox(box: Rectangle, component: UIElementComponent): void {
	box.background = component.background ?? 'transparent';
	box.cornerRadius = Math.max(0, component.cornerRadius ?? 0);
	const outlined = !!component.borderColor && (component.borderWidth ?? 0) > 0;
	box.thickness = outlined ? component.borderWidth! : 0;
	if (outlined) box.color = component.borderColor!;
}

function isScrollable(component: UIElementComponent): boolean {
	return component.kind === 'container' && component.overflow === 'scroll' && component.height !== undefined;
}

function shapeOf(slots: Slot[]): string {
	return slots
		.map((slot) => {
			const component = findComponent(slot, 'uiElement');
			return `${slot.id}:${component?.kind}:${Number((component?.margin ?? 0) > 0)}:${Number(component ? isScrollable(component) : 0)}:${Number(component?.overlayBottom ?? false)}`;
		})
		.sort()
		.join('|');
}

/** Renders a normal Slot subtree as Babylon GUI controls on a mesh surface. */
export function setupUIPanel(
	scene: Scene,
	mesh: AbstractMesh,
	panel: UIPanelComponent,
	getSubtree: () => Slot[],
	onEvent: (event: UIEvent) => void
): UIPanelBinding {
	// The XR trigger handler uses this marker to distinguish a UI click from
	// an empty-space laser toggle (see interaction/pointerController.ts).
	mesh.metadata = { ...(mesh.metadata ?? {}), interactive: true, uiPanel: true };
	const texture = AdvancedDynamicTexture.CreateForMesh(mesh, panel.width, panel.height, true);
	if (panel.mirrorX) {
		// Babylon applies this texture matrix to GUI picking as well as rendering.
		texture.uScale = -1;
		texture.uOffset = 1;
		texture.wrapU = Texture.CLAMP_ADDRESSMODE;
	}
	const background = new Rectangle('ui-panel-background');
	background.width = 1;
	background.height = 1;
	background.thickness = 0;
	background.background = panel.background ?? '#111827';
	texture.addControl(background);


	const entries = new Map<string, Entry>();
	const margins = new Map<string, MarginSpacers>();
	const videos = new Map<string, VideoRuntime>();
	const inputTexts = new Map<string, string>();
	const changeTimers = new Map<string, ReturnType<typeof setTimeout>>();
	let rootStack: StackPanel | null = null;
	let knownShape = '';

	function getUiSlots(): Slot[] {
		return getSubtree().filter((slot) => findComponent(slot, 'uiElement'));
	}

	function getChildren(parentId: string): Slot[] {
		return getUiSlots().filter((slot) => slot.parentId === parentId);
	}

	// --- video ---------------------------------------------------------------

	function drawVideoFrame(runtime: VideoRuntime): void {
		const context = runtime.canvas.getContext('2d');
		if (!context) return;
		context.fillStyle = '#000000';
		context.fillRect(0, 0, VIDEO_CANVAS_WIDTH, VIDEO_CANVAS_HEIGHT);
		const { video } = runtime;
		if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
			const scale = Math.min(VIDEO_CANVAS_WIDTH / video.videoWidth, VIDEO_CANVAS_HEIGHT / video.videoHeight);
			const width = video.videoWidth * scale;
			const height = video.videoHeight * scale;
			context.drawImage(video, (VIDEO_CANVAS_WIDTH - width) / 2, (VIDEO_CANVAS_HEIGHT - height) / 2, width, height);
		}
		runtime.image?._markAsDirty();
	}

	function ensureVideo(slotId: string): VideoRuntime {
		let runtime = videos.get(slotId);
		if (runtime) return runtime;
		const video = document.createElement('video');
		video.crossOrigin = 'anonymous';
		video.playsInline = true;
		video.preload = 'auto';
		const canvas = document.createElement('canvas');
		canvas.width = VIDEO_CANVAS_WIDTH;
		canvas.height = VIDEO_CANVAS_HEIGHT;
		runtime = { video, canvas, image: null, src: '', appliedSeek: undefined, dirty: true, lastDrawnFrame: -1 };
		const created = runtime;
		for (const type of ['loadeddata', 'seeked', 'emptied']) video.addEventListener(type, () => (created.dirty = true));
		videos.set(slotId, runtime);
		return runtime;
	}

	function playVideo(runtime: VideoRuntime): void {
		void runtime.video.play().catch(() => {
			// Autoplay policy: retry on the next user gesture instead of failing for the whole session.
			const retry = () => {
				if (!runtime.video.paused) return;
				const wanted = [...entries.values()].some((entry) => videos.get(entry.slot.id) === runtime && entry.component.playing);
				if (wanted) void runtime.video.play().catch(() => {});
			};
			window.addEventListener('pointerdown', retry, { once: true });
			window.addEventListener('keydown', retry, { once: true });
		});
	}

	function applyVideo(slotId: string, component: UIElementComponent): void {
		const runtime = ensureVideo(slotId);
		const { video } = runtime;
		const src = resolveMediaUrl(component.src);
		if (src !== runtime.src) {
			runtime.src = src;
			runtime.appliedSeek = component.currentTime;
			runtime.lastDrawnFrame = -1;
			if (src) video.src = src;
			else video.removeAttribute('src');
			video.load();
			runtime.dirty = true;
		}
		video.loop = component.loop ?? false;
		video.muted = component.muted ?? false;
		video.volume = Math.min(1, Math.max(0, component.volume ?? 1));
		if (component.currentTime !== undefined && component.currentTime !== runtime.appliedSeek) {
			runtime.appliedSeek = component.currentTime;
			if (Number.isFinite(component.currentTime)) {
				try {
					video.currentTime = Math.max(0, component.currentTime);
				} catch {
					// Not seekable before metadata has loaded; the next write retries.
				}
			}
		}
		if (component.playing && src) playVideo(runtime);
		else video.pause();
	}

	// Copy video frames only after the current render has finished. The engine's guiUploads observer runs before rendering;
	// marking this panel dirty here lets it upload the new canvas before the next pass instead of during multiview drawing.
	const frameObserver: Observer<Scene> = scene.onAfterRenderObservable.add(() => {
		for (const runtime of videos.values()) {
			if (!runtime.image) continue;
			// A headset may render at 72–120 Hz while a video produces only about 24–30 new frames per second.
			// Repainting the GUI texture for duplicate video frames wastes uploads and can destabilize multiview.
			const frameTime = runtime.video.currentTime;
			const frameCount = runtime.video.getVideoPlaybackQuality?.().totalVideoFrames ?? frameTime;
			if (runtime.dirty || (!runtime.video.paused && frameCount !== runtime.lastDrawnFrame)) {
				runtime.dirty = false;
				drawVideoFrame(runtime);
				runtime.lastDrawnFrame = frameCount;
			}
		}
	});

	// --- input ---------------------------------------------------------------

	function createInput(slot: Slot, component: UIElementComponent): { control: InputText; appliedText: string } {
		const input = new SubmitInputText(`ui-${slot.id}`);
		const initial = inputTexts.get(slot.id) ?? component.text ?? '';
		inputTexts.set(slot.id, initial);
		input.text = initial;
		input.color = component.color ?? 'white';
		input.background = component.background ?? '#1f2937';
		input.focusedBackground = '#111827';
		input.thickness = 1;
		input.fontSize = component.fontSize ?? 24;
		input.placeholderText = component.placeholder ?? '';
		input.placeholderColor = '#9ca3af';
		input.disableMobilePrompt = true;
		// In a headset the field is typed with the in-world keyboard, brought up in front of this panel.
		typeWithKeyboard(input, { near: () => mesh, onSubmit: () => flush('submit') });

		const flush = (type: UIEvent['type']) => {
			const pending = changeTimers.get(slot.id);
			if (pending) clearTimeout(pending);
			changeTimers.delete(slot.id);
			onEvent({ type, slotId: slot.id, text: input.text });
		};
		input.onTextChangedObservable.add(() => {
			inputTexts.set(slot.id, input.text);
			const pending = changeTimers.get(slot.id);
			if (pending) clearTimeout(pending);
			changeTimers.set(slot.id, setTimeout(() => flush('change'), INPUT_CHANGE_DEBOUNCE_MS));
		});
		input.onSubmit = () => flush('submit');
		return { control: input, appliedText: component.text ?? '' };
	}

	// --- elements ------------------------------------------------------------

	/** Adds `slot`'s control to `stack`, wrapped in before/after spacers when it has a margin. */
	function addWithMargin(stack: StackPanel, slot: Slot): void {
		const component = findComponent(slot, 'uiElement');
		const child = createElement(slot);
		if (!child || !component) return;
		const margin = Math.max(0, component.margin ?? 0);
		const spacer = (side: 'before' | 'after') => {
			const rect = new Rectangle(`ui-${slot.id}-margin-${side}`);
			rect.thickness = 0;
			rect.width = stack.isVertical ? '100%' : `${margin}px`;
			rect.height = stack.isVertical ? `${margin}px` : '100%';
			stack.addControl(rect);
			return rect;
		};
		const before = margin ? spacer('before') : null;
		stack.addControl(child);
		const after = margin ? spacer('after') : null;
		if (before && after) margins.set(slot.id, { stack, before, after });
	}

	function createElement(slot: Slot): Control | null {
		const component = findComponent(slot, 'uiElement');
		if (!component) return null;

		let control: Control;
		let stack: StackPanel | undefined;
		let appliedText: string | undefined;
		if (component.kind === 'container') {
			const box = new Rectangle(`ui-${slot.id}`);
			// Keep the full rectangle as the background surface and inset only its children.
			box.descendantsOnlyPadding = true;
			styleBox(box, component);

			stack = new StackPanel(`ui-${slot.id}-layout`);
			stack.width = '100%';
			stack.adaptHeightToChildren = true;
			stack.isVertical = component.flexDirection !== 'row';
			stack.spacing = component.gap ?? 0;
			if (isScrollable(component)) {
				const viewer = new ScrollViewer(`ui-${slot.id}-scroll`);
				viewer.width = '100%';
				viewer.height = '100%';
				viewer.thickness = 0;
				viewer.barColor = '#6b7280';
				viewer.barBackground = 'transparent';
				viewer.barSize = 14;
				viewer.wheelPrecision = 40;
				stack.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
				viewer.addControl(stack);
				box.addControl(viewer);
			} else {
				box.adaptHeightToChildren = true;
				box.addControl(stack);
			}
			setSize(box, component);
			for (const childSlot of getChildren(slot.id)) {
				const childComponent = findComponent(childSlot, 'uiElement');
				if (!childComponent?.overlayBottom) {
					addWithMargin(stack, childSlot);
					continue;
				}
				const child = createElement(childSlot);
				if (!child) continue;
				child.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
				child.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
				child.zIndex = 10;
				box.addControl(child);
			}
			control = box;
		} else if (component.kind === 'button') {
			const button = Button.CreateSimpleButton(`ui-${slot.id}`, component.text ?? slot.name);
			button.color = component.color ?? 'white';
			button.background = component.background ?? '#2563eb';
			button.cornerRadius = component.cornerRadius ?? 6;
			button.thickness = 0;
			if (button.textBlock) {
				button.textBlock.fontSize = component.fontSize ?? 24;
				button.textBlock.fontWeight = component.fontWeight === 'bold' ? 'bold' : 'normal';
				button.textBlock.textWrapping = true;
				if (component.textAlign) button.textBlock.textHorizontalAlignment = TEXT_ALIGN[component.textAlign];
			}
			button.onPointerClickObservable.add(() => onEvent({ type: 'press', slotId: slot.id }));
			control = button;
			setSize(control, component);
		} else if (component.kind === 'input') {
			({ control, appliedText } = createInput(slot, component));
			setSize(control, component);
		} else if (component.kind === 'image') {
			const image = new Image(`ui-${slot.id}`, component.src || null);
			image.stretch = Image.STRETCH_UNIFORM;
			control = image;
			setSize(control, component);
		} else if (component.kind === 'video') {
			const runtime = ensureVideo(slot.id);
			const image = new Image(`ui-${slot.id}`, null);
			image.domImage = runtime.canvas as unknown as HTMLImageElement;
			image.stretch = Image.STRETCH_UNIFORM;
			runtime.image = image;
			runtime.dirty = true;
			control = image;
			setSize(control, component);
			applyVideo(slot.id, component);
		} else if (component.kind === 'slider') {
			const slider = new Slider(`ui-${slot.id}`);
			slider.minimum = component.minValue ?? 0;
			slider.maximum = Math.max(slider.minimum, component.maxValue ?? 100);
			slider.step = Math.max(0, component.step ?? 0);
			slider.value = Math.min(slider.maximum, Math.max(slider.minimum, component.value ?? slider.minimum));
			slider.color = component.color ?? '#7c3aed';
			slider.background = component.background ?? '#4b5563';
			slider.thumbColor = '#f8fafc';
			slider.onPointerDownObservable.add(() => {
				const entry = entries.get(slot.id);
				if (entry) entry.dragging = true;
			});
			slider.onPointerUpObservable.add(() => {
				const entry = entries.get(slot.id);
				if (entry) entry.dragging = false;
				onEvent({ type: 'submit', slotId: slot.id, value: slider.value });
			});
			control = slider;
			setSize(control, component);
		} else {
			const text = new TextBlock(`ui-${slot.id}`, component.text ?? slot.name);
			text.color = component.color ?? 'white';
			text.fontSize = component.fontSize ?? 24;
			text.fontWeight = component.fontWeight === 'bold' ? 'bold' : 'normal';
			text.textWrapping = true;
			text.textHorizontalAlignment = TEXT_ALIGN[component.textAlign ?? 'left'];
			control = text;
			setSize(control, component);
		}

		entries.set(slot.id, { slot, component, control, kind: component.kind, stack, appliedText });
		return control;
	}

	function build(): void {
		if (rootStack) {
			background.removeControl(rootStack);
			rootStack.dispose();
			rootStack = null;
		}
		for (const runtime of videos.values()) runtime.image = null;
		entries.clear();
		margins.clear();
		const rootSlot = getSubtree()[0];
		background.background = (rootSlot ? findComponent(rootSlot, 'uiPanel')?.background : undefined) ?? panel.background ?? '#111827';
		rootStack = new StackPanel('ui-panel-layout');
		rootStack.width = '92%';
		rootStack.height = '92%';
		rootStack.adaptHeightToChildren = true;
		rootStack.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		rootStack.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
		rootStack.paddingTop = '4%';
		rootStack.isVertical = true;
		background.addControl(rootStack);

		const slots = getUiSlots();
		const ids = new Set(slots.map((slot) => slot.id));
		for (const slot of slots.filter((candidate) => !candidate.parentId || !ids.has(candidate.parentId))) {
			addWithMargin(rootStack, slot);
		}
		knownShape = shapeOf(slots);
		// Only a panel with something to press takes the pointer; a picture or a label is part of what it is on (and is grabbed with it).
		mesh.metadata = { ...(mesh.metadata ?? {}), interactive: hasInteractiveControls(slots) };

		// Drop the state of elements that no longer exist.
		for (const [slotId, runtime] of videos) {
			if (ids.has(slotId)) continue;
			runtime.video.pause();
			runtime.video.removeAttribute('src');
			runtime.video.load();
			videos.delete(slotId);
		}
		for (const slotId of [...inputTexts.keys()]) if (!ids.has(slotId)) inputTexts.delete(slotId);
	}

	function sync(): void {
		const slots = getUiSlots();
		if (shapeOf(slots) !== knownShape) {
			build();
			return;
		}

		const rootSlot = getSubtree()[0];
		background.background = (rootSlot ? findComponent(rootSlot, 'uiPanel')?.background : undefined) ?? panel.background ?? '#111827';
		for (const slot of slots) {
			const component = findComponent(slot, 'uiElement');
			const entry = entries.get(slot.id);
			if (!component || !entry) continue;
			entry.slot = slot;
			entry.component = component;
			entry.control.isVisible = component.visible !== false;
			entry.control.width = component.width === undefined ? '100%' : `${component.width}px`;
			entry.control.height = defaultHeight(component);
			if (component.padding !== undefined) entry.control.setPaddingInPixels(component.padding);
			if (component.kind === 'container') {
				const box = entry.control as Rectangle;
				box.descendantsOnlyPadding = true;
				styleBox(box, component);
				if (entry.stack) {
					entry.stack.isVertical = component.flexDirection !== 'row';
					entry.stack.spacing = component.gap ?? 0;
				}
			} else if (component.kind === 'button') {
				const button = entry.control as Button;
				button.textBlock!.text = component.text ?? slot.name;
				button.textBlock!.fontSize = component.fontSize ?? 24;
				button.textBlock!.fontWeight = component.fontWeight === 'bold' ? 'bold' : 'normal';
				button.textBlock!.textHorizontalAlignment = TEXT_ALIGN[component.textAlign ?? 'center'];
				button.cornerRadius = component.cornerRadius ?? 6;
				button.color = component.color ?? 'white';
				button.background = component.background ?? '#2563eb';
			} else if (component.kind === 'input') {
				const input = entry.control as InputText;
				input.color = component.color ?? 'white';
				input.background = component.background ?? '#1f2937';
				input.fontSize = component.fontSize ?? 24;
				input.placeholderText = component.placeholder ?? '';
				if ((component.text ?? '') !== entry.appliedText) {
					entry.appliedText = component.text ?? '';
					input.text = entry.appliedText;
					inputTexts.set(slot.id, input.text);
				}
			} else if (component.kind === 'image') {
				const image = entry.control as Image;
				const src = component.src || null;
				if (image.source !== src) image.source = src;
			} else if (component.kind === 'video') {
				applyVideo(slot.id, component);
			} else if (component.kind === 'slider') {
				const slider = entry.control as Slider;
				slider.minimum = component.minValue ?? 0;
				slider.maximum = Math.max(slider.minimum, component.maxValue ?? 100);
				slider.step = Math.max(0, component.step ?? 0);
				if (!entry.dragging && component.value !== undefined) slider.value = Math.min(slider.maximum, Math.max(slider.minimum, component.value));
			} else {
				const text = entry.control as TextBlock;
				text.text = component.text ?? slot.name;
				text.color = component.color ?? 'white';
				text.fontSize = component.fontSize ?? 24;
				text.fontWeight = component.fontWeight === 'bold' ? 'bold' : 'normal';
				text.textHorizontalAlignment = TEXT_ALIGN[component.textAlign ?? 'left'];
			}
		}
		for (const [slotId, spacers] of margins) {
			const component = findComponent(slots.find((slot) => slot.id === slotId)!, 'uiElement');
			if (!component) continue;
			const margin = Math.max(0, component.margin ?? 0);
			const vertical = spacers.stack.isVertical;
			spacers.before.width = spacers.after.width = vertical ? '100%' : `${margin}px`;
			spacers.before.height = spacers.after.height = vertical ? `${margin}px` : '100%';
		}
	}

	build();
	return {
		dispose: () => {
			scene.onAfterRenderObservable.remove(frameObserver);
			for (const timer of changeTimers.values()) clearTimeout(timer);
			for (const runtime of videos.values()) {
				runtime.video.pause();
				runtime.video.removeAttribute('src');
				runtime.video.load();
			}
			videos.clear();
			texture.dispose();
		},
		sync,
		getMedia: (slotId) => {
			const runtime = videos.get(slotId);
			if (!runtime) return undefined;
			const { video } = runtime;
			return {
				currentTime: video.currentTime || 0,
				duration: Number.isFinite(video.duration) ? video.duration : 0,
				paused: video.paused,
				ended: video.ended,
				ready: video.readyState >= HTMLMediaElement.HAVE_METADATA,
				error: Boolean(video.error)
			};
		},
		getInputText: (slotId) => inputTexts.get(slotId)
	};
}
