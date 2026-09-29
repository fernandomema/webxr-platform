import {
	Color3,
	DynamicTexture,
	GetElementPixelFromUv,
	HtmlInteractionManager,
	HtmlTexture,
	IsHtmlInCanvasUploadSupported,
	PointerEventTypes,
	StandardMaterial,
	type AbstractMesh,
	type BaseTexture,
	type Scene
} from '@babylonjs/core';
import { findComponent, type HtmlViewComponent, type Slot } from '$lib/ecs/types';

export interface HtmlViewBinding {
	dispose(): void;
	sync(slot: Slot): void;
}

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-presentation allow-popups allow-forms';
const IFRAME_ALLOW = 'autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write';
/** How often a fresh HTML-in-Canvas snapshot is requested while the screen is in use. */
const REFRESH_INTERVAL_MS = 66;
/** No `paint` event for this long while asking for them means the page is not being rendered (an immersive XR session pauses it). */
const PAINT_STALL_MS = 700;
/** Minimum time between DOM snapshots taken by the fallback rasterizer. */
const SNAPSHOT_INTERVAL_MS = 125;

/** The computed style properties copied when a page is rasterized without HTML-in-Canvas: enough for ordinary layouts and visuals. */
const SNAPSHOT_STYLE_PROPERTIES = [
	'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'float', 'box-sizing',
	'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
	'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
	'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
	'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
	'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
	'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
	'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
	'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
	'color', 'opacity', 'box-shadow', 'text-shadow', 'outline', 'overflow', 'transform', 'transform-origin',
	'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align',
	'text-decoration', 'text-transform', 'white-space', 'word-break', 'vertical-align', 'visibility',
	'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'justify-content', 'align-items', 'align-self',
	'gap', 'row-gap', 'column-gap', 'grid-template-columns', 'grid-template-rows', 'list-style-type', 'cursor'
];

function resolveHtmlViewUrl(url: string): string {
	if (!url) return 'about:blank';
	try {
		const parsed = new URL(url, window.location.href);
		if (parsed.protocol === 'https:' || parsed.origin === window.location.origin) return parsed.href;
	} catch {
		// An invalid URL is treated as an empty page.
	}
	return 'about:blank';
}

function frameDocument(frame: HTMLIFrameElement): Document | null {
	try {
		return frame.contentDocument; // null for a cross-origin page
	} catch {
		return null;
	}
}

function drawNotice(texture: DynamicTexture, title: string, detail: string): void {
	const { width, height } = texture.getSize();
	const context = texture.getContext() as unknown as CanvasRenderingContext2D;
	context.fillStyle = '#111827';
	context.fillRect(0, 0, width, height);
	context.textAlign = 'center';
	context.fillStyle = '#f9fafb';
	context.font = `bold ${Math.round(width / 26)}px sans-serif`;
	context.fillText(title, width / 2, height / 2 - width / 40);
	context.fillStyle = '#9ca3af';
	context.font = `${Math.round(width / 38)}px sans-serif`;
	context.fillText(detail, width / 2, height / 2 + width / 25);
	texture.update();
}

function inlineStyles(source: Element, target: Element, view: Window): void {
	const computed = view.getComputedStyle(source);
	let css = '';
	for (const property of SNAPSHOT_STYLE_PROPERTIES) css += `${property}:${computed.getPropertyValue(property)};`;
	target.setAttribute('style', css);
	for (let i = 0; i < source.children.length; i++) {
		if (target.children[i]) inlineStyles(source.children[i], target.children[i], view);
	}
}

/**
 * Rasterizes a same-origin page without HTML-in-Canvas: the body is cloned with its computed styles inlined,
 * wrapped in an SVG `<foreignObject>` and decoded as an image. It needs no document rendering update, so it keeps
 * working where `paint` events stop (an immersive XR session) or where the API does not exist. Only what inline
 * styles can express is drawn: no pseudo-elements, canvases, images or videos. Returns null for a page whose
 * document is unreachable (cross-origin).
 */
async function snapshotFrame(frame: HTMLIFrameElement, width: number, height: number): Promise<HTMLImageElement | null> {
	const doc = frameDocument(frame);
	const view = doc?.defaultView;
	if (!doc || !view || !doc.body) return null;
	const clone = doc.body.cloneNode(true) as HTMLElement;
	inlineStyles(doc.body, clone, view);
	for (const node of clone.querySelectorAll('script,style,link,iframe,object,embed,video,canvas,img')) node.remove();
	const rootStyle = view.getComputedStyle(doc.documentElement);
	const background = rootStyle.getPropertyValue('background-image') !== 'none' ? `background-image:${rootStyle.getPropertyValue('background-image')};` : '';
	const markup =
		`<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;overflow:hidden;background-color:${rootStyle.getPropertyValue('background-color')};${background}">` +
		`${new XMLSerializer().serializeToString(clone)}</div>`;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject x="0" y="0" width="100%" height="100%">${markup}</foreignObject></svg>`;
	const image = new Image();
	image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
	await image.decode();
	return image;
}

/**
 * Forwards laser/mouse hits on `mesh` into the page inside a same-origin iframe. Babylon's own
 * HtmlRaycastInteractionManager dispatches on the iframe element itself, which never reaches the page
 * inside it, so clicks and hovers would be lost. A cross-origin page has no reachable document: nothing is forwarded.
 */
function forwardPointerToFrame(scene: Scene, mesh: AbstractMesh, frame: HTMLIFrameElement, width: number, height: number): () => void {
	let downTarget: Element | null = null;
	const observer = scene.onPointerObservable.add((info) => {
		const name =
			info.type === PointerEventTypes.POINTERDOWN ? 'pointerdown' : info.type === PointerEventTypes.POINTERUP ? 'pointerup' : info.type === PointerEventTypes.POINTERMOVE ? 'pointermove' : null;
		const pick = info.pickInfo;
		if (!name || !pick?.hit || pick.pickedMesh !== mesh) return;
		const doc = frameDocument(frame);
		const view = doc?.defaultView;
		if (!doc || !view) return;
		const camera = scene.activeCamera;
		const normal = pick.getNormal(true, true);
		if (camera && normal && pick.pickedPoint && normal.dot(pick.pickedPoint.subtract(camera.globalPosition)) > 0) return; // the back of the plane
		const uv = pick.getTextureCoordinates();
		if (!uv) return;
		const { x, y } = GetElementPixelFromUv(uv.x, uv.y, width, height);
		const target = doc.elementFromPoint(x, y) ?? doc.body;
		const source = info.event as PointerEvent;
		const init = { bubbles: true, cancelable: true, view, clientX: x, clientY: y, button: source.button ?? 0, buttons: source.buttons ?? 0, pointerId: source.pointerId ?? 1, pointerType: source.pointerType ?? 'mouse' };
		target.dispatchEvent(new view.PointerEvent(name, init));
		target.dispatchEvent(new view.MouseEvent(name === 'pointerdown' ? 'mousedown' : name === 'pointerup' ? 'mouseup' : 'mousemove', init));
		if (name === 'pointerdown') {
			downTarget = target;
		} else if (name === 'pointerup') {
			if (downTarget === target && init.button === 0) target.dispatchEvent(new view.MouseEvent('click', init));
			downTarget = null;
		}
	});
	return () => scene.onPointerObservable.remove(observer);
}

/**
 * Draws a live web page onto `mesh`. With the WICG HTML-in-Canvas API (Babylon's `HtmlTexture`) the page is an
 * `<iframe>` hosted under the engine canvas. When that API is missing, or its `paint` events stop (an immersive
 * XR session pauses the page's rendering), a same-origin page is rasterized by `snapshotFrame` instead. A
 * cross-origin page is only ever drawn by the native API, and only as far as the specification allows.
 */
export function setupHtmlView(scene: Scene, mesh: AbstractMesh, initial: HtmlViewComponent): HtmlViewBinding {
	const width = Math.max(64, initial.width ?? DEFAULT_WIDTH);
	const height = Math.max(64, initial.height ?? DEFAULT_HEIGHT);
	const engine = scene.getEngine();
	mesh.metadata = { ...(mesh.metadata ?? {}), specialSurface: 'html-view' };

	const frame = document.createElement('iframe');
	frame.width = String(width);
	frame.height = String(height);
	frame.style.cssText = `width:${width}px;height:${height}px;border:0;background:#000;`;
	frame.setAttribute('sandbox', IFRAME_SANDBOX);
	frame.setAttribute('allow', IFRAME_ALLOW);
	frame.setAttribute('allowfullscreen', '');
	frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
	let sourceUrl = resolveHtmlViewUrl(initial.url);
	frame.src = sourceUrl;

	const material = new StandardMaterial(`${mesh.name}-html-view-material`, scene);
	// Same setup as Babylon's HtmlTexture playground demo: an emissive-only material with lighting disabled
	// renders this texture as a flat white slab, so it is bound as diffuse AND emissive.
	material.emissiveColor = new Color3(0.65, 0.65, 0.65);
	material.specularColor = Color3.Black(); // a scene light would otherwise paint a white glare over the page
	material.backFaceCulling = false;
	mesh.material = material;
	const show = (texture: BaseTexture) => {
		material.diffuseTexture = texture;
		material.emissiveTexture = texture;
	};

	const native = IsHtmlInCanvasUploadSupported(engine);
	let htmlTexture: HtmlTexture | null = null;
	let hiddenHost: HTMLDivElement | null = null;
	let lastPaintAt = performance.now();
	if (native) {
		htmlTexture = new HtmlTexture(`${mesh.name}-html-view`, frame, { width, height, scene, autoUpdate: true, useSvgFallback: false });
		htmlTexture.host?.addEventListener('paint', () => (lastPaintAt = performance.now()));
		show(htmlTexture);
	} else {
		// No HTML-in-Canvas: the page still has to load and lay out, so it lives off-screen.
		hiddenHost = document.createElement('div');
		hiddenHost.style.cssText = 'position:fixed;left:-99999px;top:0;pointer-events:none;';
		hiddenHost.setAttribute('aria-hidden', 'true');
		hiddenHost.appendChild(frame);
		document.body.appendChild(hiddenHost);
	}

	let snapshotTexture: DynamicTexture | null = null;
	let snapshotActive = !native;
	let snapshotBusy = false;
	let snapshotAt = 0;
	const takeSnapshot = async () => {
		if (snapshotBusy) return;
		snapshotBusy = true;
		snapshotAt = performance.now();
		try {
			snapshotTexture ??= new DynamicTexture(`${mesh.name}-html-view-snapshot`, { width, height }, scene, false);
			const image = await snapshotFrame(frame, width, height).catch(() => null);
			if (!snapshotActive) return;
			if (image) {
				const context = snapshotTexture.getContext() as unknown as CanvasRenderingContext2D;
				context.drawImage(image, 0, 0, width, height);
				snapshotTexture.update();
			} else {
				drawNotice(snapshotTexture, 'This page cannot be drawn here', native ? 'Only pages from this site can be shown while the browser pauses the page.' : 'Enable chrome://flags/#canvas-draw-element, or use a page from this site.');
			}
			show(snapshotTexture);
		} finally {
			snapshotBusy = false;
		}
	};
	const setSnapshotActive = (active: boolean) => {
		if (active === snapshotActive) return;
		snapshotActive = active;
		if (!active && htmlTexture) show(htmlTexture);
	};

	// The canvas only reports a paint when it notices a change; iframe content is not always noticed, so ask for a
	// fresh snapshot a few times a second while the screen is in use.
	let sinceRefresh = 0;
	const refresh = scene.onBeforeRenderObservable.add(() => {
		sinceRefresh += engine.getDeltaTime();
		if (sinceRefresh < REFRESH_INTERVAL_MS) return;
		sinceRefresh = 0;
		if (!mesh.isEnabled() || !mesh.isVisible) return;
		if (htmlTexture) {
			htmlTexture.requestUpdate();
			setSnapshotActive(performance.now() - lastPaintAt > PAINT_STALL_MS);
		}
		if (snapshotActive && performance.now() - snapshotAt >= SNAPSHOT_INTERVAL_MS) void takeSnapshot();
	});

	const interaction = initial.interaction ?? 'raycast';
	let stopInput: (() => void) | null = null;
	if (interaction !== 'none') {
		mesh.isPickable = true;
		mesh.metadata = { ...(mesh.metadata ?? {}), interactive: true };
		if (interaction === 'overlay' && htmlTexture) {
			const manager = new HtmlInteractionManager(scene, htmlTexture, mesh);
			stopInput = () => manager.dispose();
		} else {
			stopInput = forwardPointerToFrame(scene, mesh, frame, width, height);
		}
	}

	return {
		dispose: () => {
			scene.onBeforeRenderObservable.remove(refresh);
			stopInput?.();
			snapshotActive = false;
			htmlTexture?.dispose();
			snapshotTexture?.dispose();
			material.dispose();
			frame.remove();
			hiddenHost?.remove();
		},
		sync: (slot) => {
			const next = findComponent(slot, 'htmlView');
			if (!next) return;
			const nextUrl = resolveHtmlViewUrl(next.url);
			if (nextUrl === sourceUrl) return;
			sourceUrl = nextUrl;
			frame.src = nextUrl;
		}
	};
}
