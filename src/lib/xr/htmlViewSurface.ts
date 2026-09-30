import {
	Color3,
	DynamicTexture,
	GetElementPixelFromUv,
	HtmlInteractionManager,
	HtmlTexture,
	IsHtmlInCanvasUploadSupported,
	PointerEventTypes,
	Vector3,
	StandardMaterial,
	type AbstractMesh,
	type BaseTexture,
	type PickingInfo,
	type Scene
} from '@babylonjs/core';
import { findComponent, type HtmlViewComponent, type Slot } from '$lib/ecs/types';
import { requestTextInput, type TextInputSession } from './keyboard/service';
import { forwardKeyTo, isEditable } from './keyForwarding';

export interface HtmlViewBinding {
	dispose(): void;
	sync(slot: Slot): void;
	/** The iframe the page lives in, for a host that talks to it (postMessage). Read only: do not move or restyle it. */
	readonly frame: HTMLIFrameElement;
}

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-presentation allow-popups allow-forms';
const IFRAME_ALLOW = 'autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write';
/** How often a fresh HTML-in-Canvas snapshot is requested while the screen is in use. */
const REFRESH_INTERVAL_MS = 66;
/** No `paint` event for this long while asking for them means the page is not being rendered (an immersive XR session pauses it). */
const PAINT_STALL_MS = 700;
/** Minimum time between DOM snapshots taken by the fallback rasterizer. A snapshot is only taken when the page changed. */
const SNAPSHOT_INTERVAL_MS = 125;
/** A snapshot may use at most this share of the time: a page that is slow to rasterize (a headset) is redrawn less often. */
const SNAPSHOT_BUDGET = 0.2;
const SNAPSHOT_MAX_INTERVAL_MS = 1000;
/** Scrolling is over when the container has not moved for this long: the page is then redrawn properly. */
const SCROLL_SETTLE_MS = 300;
/**
 * How far a held press on a scrollable area must turn the laser (degrees) before it becomes a scroll drag; below
 * that it is a click, wherever the shake took the pointer. Measured as an angle, not in page pixels: a hand shakes by
 * degrees, and the same shake covers many more pixels on a panel that is far away or scaled up.
 */
const DRAG_SCROLL_ANGLE = 8;
/** Right after the press the trigger's own jerk moves the laser most: the threshold is higher for this long. */
const PRESS_SETTLE_MS = 300;
const PRESS_SETTLE_ANGLE = 14;
/** For a pointer without a ray (touch on a flat screen): travel in page pixels. */
const DRAG_SCROLL_THRESHOLD = 80;
/** What hover is about: the element a style would highlight, not the text inside it that the laser happens to touch. */
const HOVER_ANCHOR = 'button, a, input, textarea, select, label, [data-row], [role]:not([role="presentation"]):not([role="none"])';
/** The most images kept as data URIs between snapshots, and the largest side they are drawn at. */
const IMAGE_CACHE_SIZE = 48;
const IMAGE_MAX_SIDE = 1024;
const BLANK_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'url', 'email', 'tel', 'password', 'number']);
const SCROLLABLE = new Set(['auto', 'scroll']);

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
	'color', 'opacity', 'box-shadow', 'text-shadow', 'outline', 'transform', 'transform-origin',
	'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align',
	'text-decoration', 'text-transform', 'white-space', 'word-break', 'vertical-align', 'visibility',
	'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'justify-content', 'align-items', 'align-self',
	'gap', 'row-gap', 'column-gap', 'grid-template-columns', 'grid-template-rows', 'list-style-type', 'cursor'
];

/** Extra properties for SVG content (the inline icons): what draws them is not in the list above. */
/**
 * Values that need not be written because they are what the property is anyway: its initial value, for properties that
 * are not inherited. Leaving them out makes the picture's markup several times smaller, which is most of what a snapshot
 * costs on a headset (serializing, parsing and decoding it).
 */
const INITIAL_VALUES: Record<string, string> = {
	position: 'static', top: 'auto', right: 'auto', bottom: 'auto', left: 'auto', 'z-index': 'auto', float: 'none',
	'min-width': 'auto', 'min-height': 'auto', 'max-width': 'none', 'max-height': 'none',
	'margin-top': '0px', 'margin-right': '0px', 'margin-bottom': '0px', 'margin-left': '0px',
	'padding-top': '0px', 'padding-right': '0px', 'padding-bottom': '0px', 'padding-left': '0px',
	'border-top-style': 'none', 'border-right-style': 'none', 'border-bottom-style': 'none', 'border-left-style': 'none',
	'border-top-left-radius': '0px', 'border-top-right-radius': '0px', 'border-bottom-right-radius': '0px', 'border-bottom-left-radius': '0px',
	'background-color': 'rgba(0, 0, 0, 0)', 'background-image': 'none', 'background-size': 'auto', 'background-position': '0% 0%', 'background-repeat': 'repeat',
	opacity: '1', 'box-shadow': 'none', transform: 'none', 'vertical-align': 'baseline',
	'flex-direction': 'row', 'flex-wrap': 'nowrap', 'flex-grow': '0', 'flex-shrink': '1', 'flex-basis': 'auto',
	'justify-content': 'normal', 'align-items': 'normal', 'align-self': 'auto', gap: 'normal', 'row-gap': 'normal', 'column-gap': 'normal',
	'grid-template-columns': 'none', 'grid-template-rows': 'none'
};
/**
 * Elements the browser gives no default box styles, so leaving a property at its initial value out is safe. Others
 * (buttons, inputs, headings, lists, fieldsets…) have defaults of their own, and get every value written out.
 */
const PLAIN_ELEMENTS = new Set(['DIV', 'SPAN', 'SECTION', 'ASIDE', 'HEADER', 'FOOTER', 'MAIN', 'NAV', 'ARTICLE', 'STRONG', 'EM', 'B', 'I', 'SMALL', 'LABEL', 'LI', 'IMG']);
/** Only meaningful together with another property: skipped when that one says they do not apply. */
const BORDER_SIDES = ['top', 'right', 'bottom', 'left'];

const SVG_STYLE_PROPERTIES = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'stroke-dasharray'];

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

type FrameWindow = Window & typeof globalThis;

/** What one snapshot needs besides the page: scaling, and images already turned into data URIs. */
interface SnapshotContext {
	view: FrameWindow;
	images: Map<Element, string>;
	/** An element drawn at its full height (a scroll layer): its own scroll offset is not applied. */
	unscrolled?: Element;
}

const clipOverflow = (value: string) => (SCROLLABLE.has(value) ? 'hidden' : value);

/** Moves `element`'s children by the scroll offset of the container they were scrolled in, which the clone (being a fixed-size box) cannot scroll itself. */
function shiftChildren(element: Element, left: number, top: number): void {
	for (const child of element.children) {
		const style = (child as HTMLElement).style;
		// A `display: contents` element has no box to move (a transform on it does nothing): its children are moved instead.
		if (style.getPropertyValue('display') === 'contents') {
			shiftChildren(child, left, top);
			continue;
		}
		const existing = style.getPropertyValue('transform');
		style.setProperty('transform', `translate(${-left}px,${-top}px) ${existing && existing !== 'none' ? existing : ''}`);
	}
}

function inlineStyles(source: Element, target: Element, context: SnapshotContext): void {
	const { view } = context;
	const computed = view.getComputedStyle(source);
	let css = '';
	const prune = PLAIN_ELEMENTS.has(source.tagName) || source instanceof view.SVGElement;
	const transformed = computed.transform !== 'none';
	const bordered = BORDER_SIDES.filter((side) => computed.getPropertyValue(`border-${side}-style`) !== 'none');
	for (const property of SNAPSHOT_STYLE_PROPERTIES) {
		const value = computed.getPropertyValue(property);
		if (!prune) {
			css += `${property}:${value};`;
			continue;
		}
		if (INITIAL_VALUES[property] === value) continue;
		if (property === 'transform-origin' && !transformed) continue;
		if (property === 'outline' && value.includes('none')) continue;
		if (property === 'text-decoration' && value.startsWith('none')) continue;
		// A side with no border style draws nothing, whatever its width and colour. (Its width's initial value is
		// `medium`, not 0, so a width is otherwise always written.)
		if (property.startsWith('border-') && (property.endsWith('-color') || property.endsWith('-width')) && !bordered.some((side) => property.startsWith(`border-${side}-`))) continue;
		css += `${property}:${value};`;
	}
	if (source instanceof view.SVGElement) for (const property of SVG_STYLE_PROPERTIES) css += `${property}:${computed.getPropertyValue(property)};`;
	// Scrolling is reproduced by moving the content, so a scrollable box is clipped instead (no scrollbars in the picture).
	if (!prune || computed.overflowX !== 'visible' || computed.overflowY !== 'visible') css += `overflow-x:${clipOverflow(computed.overflowX)};overflow-y:${clipOverflow(computed.overflowY)};`;

	// Form state lives in properties, not attributes, so the copy has to be told.
	if (source instanceof view.HTMLInputElement) {
		const type = source.type;
		if (type === 'checkbox' || type === 'radio') {
			if (source.checked) target.setAttribute('checked', '');
			else target.removeAttribute('checked');
		} else if (source.value === '' && source.placeholder) {
			target.setAttribute('value', source.placeholder);
			css += `color:${view.getComputedStyle(source, '::placeholder').color};`;
		} else target.setAttribute('value', source.value);
	} else if (source instanceof view.HTMLTextAreaElement) {
		target.textContent = source.value || source.placeholder;
		if (!source.value && source.placeholder) css += `color:${view.getComputedStyle(source, '::placeholder').color};`;
	} else if (source instanceof view.HTMLOptionElement) {
		if (source.selected) target.setAttribute('selected', '');
		else target.removeAttribute('selected');
	} else if (source instanceof view.HTMLImageElement) {
		target.setAttribute('src', context.images.get(source) ?? BLANK_PIXEL);
		target.removeAttribute('srcset');
	}
	target.setAttribute('style', css);

	for (let i = 0; i < source.children.length; i++) {
		if (target.children[i]) inlineStyles(source.children[i], target.children[i], context);
	}

	const { scrollLeft, scrollTop } = source;
	if ((scrollLeft || scrollTop) && source !== context.unscrolled) shiftChildren(target, scrollLeft, scrollTop);
}

/** Turns the page's same-origin images into data URIs (an SVG picture cannot load anything itself). Cached by source, so a stable image costs nothing after the first time. */
async function collectImages(doc: Document, cache: Map<string, string>): Promise<Map<Element, string>> {
	const result = new Map<Element, string>();
	for (const image of Array.from(doc.images)) {
		const src = image.currentSrc || image.src;
		if (!src) continue;
		if (src.startsWith('data:')) {
			result.set(image, src);
			continue;
		}
		const cached = cache.get(src);
		if (cached) {
			result.set(image, cached);
			continue;
		}
		if (!image.complete || !image.naturalWidth) continue;
		try {
			const url = new URL(src, doc.baseURI);
			if (url.protocol !== 'blob:' && url.origin !== doc.location.origin) continue;
			const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
			const canvas = doc.createElement('canvas');
			canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
			canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
			canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
			const uri = canvas.toDataURL('image/png');
			if (cache.size >= IMAGE_CACHE_SIZE) cache.delete(cache.keys().next().value!);
			cache.set(src, uri);
			result.set(image, uri);
		} catch {
			// A tainted or undecodable image is left out: its box stays, empty.
		}
	}
	return result;
}

/**
 * Rasterizes a same-origin page without HTML-in-Canvas: the body is cloned with its computed styles inlined,
 * wrapped in an SVG `<foreignObject>` and decoded as an image. It needs no document rendering update, so it keeps
 * working where `paint` events stop (an immersive XR session) or where the API does not exist. What the clone
 * reproduces on top of the styles: field values, scroll positions, same-origin images and inline SVG. Not drawn:
 * pseudo-elements, canvases, videos. Returns null for a page whose document is unreachable (cross-origin).
 */
async function snapshotFrame(frame: HTMLIFrameElement, width: number, height: number, pixelRatio: number, imageCache: Map<string, string>): Promise<HTMLImageElement | null> {
	const doc = frameDocument(frame);
	const view = doc?.defaultView;
	if (!doc || !view || !doc.body) return null;
	const images = await collectImages(doc, imageCache);
	const clone = doc.body.cloneNode(true) as HTMLElement;
	inlineStyles(doc.body, clone, { view, images });
	if (view.scrollX || view.scrollY) shiftChildren(clone, view.scrollX, view.scrollY);
	for (const node of clone.querySelectorAll('script,style,link,iframe,object,embed,video,canvas')) node.remove();
	const rootStyle = view.getComputedStyle(doc.documentElement);
	const background = rootStyle.getPropertyValue('background-image') !== 'none' ? `background-image:${rootStyle.getPropertyValue('background-image')};` : '';
	const markup =
		`<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;overflow:hidden;background-color:${rootStyle.getPropertyValue('background-color')};${background}">` +
		`${new XMLSerializer().serializeToString(clone)}</div>`;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width * pixelRatio}" height="${height * pixelRatio}" viewBox="0 0 ${width} ${height}"><foreignObject x="0" y="0" width="${width}" height="${height}">${markup}</foreignObject></svg>`;
	const image = new Image();
	image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
	await image.decode();
	return image;
}

/**
 * A scrolling container drawn once at (most of) its full height, so that while it scrolls the picture can be moved
 * instead of redrawn: redrawing the page takes a headset a good part of a second, moving a picture takes nothing.
 * `top` is where, in the container's content, the picture starts (a very long list is drawn around where it is).
 */
interface ScrollLayer {
	element: Element;
	image: HTMLImageElement;
	/** The container's box in the page, when the layer was drawn. */
	x: number;
	y: number;
	width: number;
	height: number;
	top: number;
	left: number;
	contentHeight: number;
	/** What is behind the container (its own background, or its nearest ancestor's): painted under the moved picture so the old content does not show through. */
	background: string;
}

function backgroundBehind(element: Element, view: FrameWindow): string {
	for (let current: Element | null = element; current; current = current.parentElement) {
		const color = view.getComputedStyle(current).backgroundColor;
		if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') return color;
	}
	return view.getComputedStyle(element.ownerDocument.documentElement).backgroundColor || '#000';
}

/** The tallest a scroll layer is drawn (CSS pixels): past that the list is drawn around the current position. */
const LAYER_MAX_HEIGHT = 4000;

async function snapshotScrollLayer(element: Element, pixelRatio: number, imageCache: Map<string, string>): Promise<ScrollLayer | null> {
	const doc = element.ownerDocument;
	const view = doc.defaultView as FrameWindow | null;
	if (!view || !element.isConnected) return null;
	const images = await collectImages(doc, imageCache);
	if (!element.isConnected) return null;
	const box = element.getBoundingClientRect();
	const extra = element.scrollHeight - element.clientHeight;
	const fullHeight = box.height + extra;
	const contentHeight = Math.min(fullHeight, LAYER_MAX_HEIGHT);
	const top = Math.max(0, Math.min(element.scrollTop - (contentHeight - box.height) / 2, fullHeight - contentHeight));
	const left = 0;
	const clone = element.cloneNode(true) as HTMLElement;
	inlineStyles(element, clone, { view, images, unscrolled: element });
	if (top) shiftChildren(clone, 0, top);
	clone.setAttribute('style', `${clone.getAttribute('style') ?? ''}position:static;margin:0;transform:none;width:${box.width}px;height:${contentHeight}px;min-height:0;max-height:none;overflow:hidden;`);
	for (const node of clone.querySelectorAll('script,style,link,iframe,object,embed,video,canvas')) node.remove();
	const markup = `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${box.width}px;height:${contentHeight}px;overflow:hidden;">${new XMLSerializer().serializeToString(clone)}</div>`;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(box.width * pixelRatio)}" height="${Math.ceil(contentHeight * pixelRatio)}" viewBox="0 0 ${box.width} ${contentHeight}"><foreignObject x="0" y="0" width="${box.width}" height="${contentHeight}">${markup}</foreignObject></svg>`;
	const image = new Image();
	image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
	await image.decode();
	return { element, image, x: box.x, y: box.y, width: box.width, height: box.height, top, left, contentHeight, background: backgroundBehind(element, view) };
}

/** The nearest ancestor (or the element) that can scroll in the direction of `dx`/`dy`, or the page itself. */
function scrollableAncestor(start: Element, view: FrameWindow, dx: number, dy: number): Element | null {
	for (let element: Element | null = start; element; element = element.parentElement) {
		const style = view.getComputedStyle(element);
		const vertical = dy !== 0 && SCROLLABLE.has(style.overflowY) && element.scrollHeight > element.clientHeight && (dy < 0 ? element.scrollTop > 0 : element.scrollTop + element.clientHeight < element.scrollHeight);
		const horizontal = dx !== 0 && SCROLLABLE.has(style.overflowX) && element.scrollWidth > element.clientWidth && (dx < 0 ? element.scrollLeft > 0 : element.scrollLeft + element.clientWidth < element.scrollWidth);
		if (vertical || horizontal) return element;
	}
	const root = start.ownerDocument.scrollingElement;
	return root && (root.scrollHeight > root.clientHeight || root.scrollWidth > root.clientWidth) ? root : null;
}

/** The nearest ancestor (or the element) whose content overflows and can be scrolled at all, in either direction. */
function scrollContainer(start: Element, view: FrameWindow): Element | null {
	for (let element: Element | null = start; element; element = element.parentElement) {
		const style = view.getComputedStyle(element);
		if ((SCROLLABLE.has(style.overflowY) && element.scrollHeight > element.clientHeight) || (SCROLLABLE.has(style.overflowX) && element.scrollWidth > element.clientWidth)) return element;
	}
	const root = start.ownerDocument.scrollingElement;
	return root && (root.scrollHeight > root.clientHeight || root.scrollWidth > root.clientWidth) ? root : null;
}

function handlesDrag(start: Element, view: FrameWindow): boolean {
	for (let element: Element | null = start; element; element = element.parentElement) {
		if (view.getComputedStyle(element).touchAction === 'none') return true;
	}
	return false;
}

/** A scroll done in code does not fire `scroll` until the page next renders, which an XR session may never do: say so directly. */
function notifyScrolled(element: Element, view: FrameWindow): void {
	const root = element.ownerDocument.scrollingElement;
	(element === root ? element.ownerDocument : element).dispatchEvent(new view.Event('scroll', { bubbles: element === root }));
}

function textFieldAt(target: Element | null): HTMLInputElement | HTMLTextAreaElement | null {
	const label = target?.closest('label');
	const candidate = target?.closest('input,textarea') ?? (label && 'control' in label ? (label as HTMLLabelElement).control : null);
	if (!candidate) return null;
	if (candidate instanceof candidate.ownerDocument.defaultView!.HTMLTextAreaElement) return candidate.disabled || candidate.readOnly ? null : candidate;
	if (candidate instanceof candidate.ownerDocument.defaultView!.HTMLInputElement && TEXT_INPUT_TYPES.has(candidate.type) && !candidate.disabled && !candidate.readOnly) return candidate;
	return null;
}

function fieldTitle(field: HTMLInputElement | HTMLTextAreaElement): string {
	const labelled = field.labels?.[0]?.textContent?.trim();
	return (field.getAttribute('aria-label') || labelled || field.placeholder || '').slice(0, 40);
}

interface Forwarding {
	stop(): void;
	/** True while a field of the page has the real keyboard (desktop): the page is then allowed to keep the focus. */
	isTyping(): boolean;
	/** True while a held press is scrolling the page (even if it stopped moving for a moment). */
	isScrolling(): boolean;
}

/**
 * Forwards laser/mouse hits on `mesh` into the page inside a same-origin iframe. Babylon's own
 * HtmlRaycastInteractionManager dispatches on the iframe element itself, which never reaches the page
 * inside it, so clicks and hovers would be lost. A cross-origin page has no reachable document: nothing is forwarded.
 *
 * Beyond press and release it gives the page what a real pointer would: hover (`pointerover`/`out`, plus a
 * `data-xr-hover` attribute on the element and its ancestors for styles, since `:hover` never matches), the mouse
 * wheel, drag-to-scroll for laser and touch pointers (the page gets `pointercancel`, as a browser does when a pan
 * takes over), and text entry: a click on a text field brings up the in-world keyboard, or, outside a headset, focuses
 * the field so a real keyboard types into it.
 */
function forwardPointerToFrame(
	scene: Scene,
	mesh: AbstractMesh,
	frame: HTMLIFrameElement,
	width: number,
	height: number,
	onActivity: () => void,
	onScroll: (element: Element) => void,
	/** A press is starting to move: it may become a scroll of `element`, so its layer can be drawn ahead of time. */
	onScrollIntent: (element: Element) => void
): Forwarding {
	interface Press {
		target: Element;
		x: number;
		y: number;
		dragX: number;
		dragY: number;
		scroller: Element | null;
		scrollStart: [number, number];
		dragging: boolean;
		announced: boolean;
		touch: boolean;
		pointerId: number;
		at: number;
		/** Where the press hit the panel and where the pointer came from (the laser's origin, or the eye), in the world. */
		point: Vector3 | null;
		origin: Vector3 | null;
	}
	let press: Press | null = null;
	let hoverChain: Element[] = [];
	let hoverPointer: number | null = null;
	let lastHit: { x: number; y: number } | null = null;
	let textSession: TextInputSession | null = null;
	let focused: { field: HTMLElement; onBlur: () => void; wasInert: boolean } | null = null;

	const hitOf = (pick: PickingInfo | null | undefined) => {
		if (!pick?.hit || pick.pickedMesh !== mesh) return null;
		const camera = scene.activeCamera;
		const normal = pick.getNormal(true, true);
		if (camera && normal && pick.pickedPoint && normal.dot(pick.pickedPoint.subtract(camera.globalPosition)) > 0) return null; // the back of the plane
		const uv = pick.getTextureCoordinates();
		return uv ? GetElementPixelFromUv(uv.x, uv.y, width, height) : null;
	};

	const setHover = (doc: Document, view: FrameWindow, target: Element | null, init: PointerEventInit) => {
		const chain: Element[] = [];
		for (let element = target?.closest(HOVER_ANCHOR) ?? target; element; element = element.parentElement) chain.push(element);
		const before = hoverChain;
		// A shaking laser moving between the parts of one button changes nothing: no events, no redraw.
		if (before[0] === chain[0]) return;
		const left = before.filter((element) => !chain.includes(element));
		const entered = chain.filter((element) => !before.includes(element));
		before[0]?.dispatchEvent(new view.PointerEvent('pointerout', { ...init, relatedTarget: chain[0] ?? null }));
		for (const element of left) {
			element.removeAttribute('data-xr-hover');
			element.dispatchEvent(new view.PointerEvent('pointerleave', { ...init, bubbles: false }));
		}
		chain[0]?.dispatchEvent(new view.PointerEvent('pointerover', { ...init, relatedTarget: before[0] ?? null }));
		for (const element of entered) {
			element.setAttribute('data-xr-hover', '');
			element.dispatchEvent(new view.PointerEvent('pointerenter', { ...init, bubbles: false }));
		}
		hoverChain = chain;
		void doc;
	};

	const clearHover = () => {
		const doc = frameDocument(frame);
		const view = doc?.defaultView;
		if (!doc || !view || !hoverChain.length) {
			hoverChain = [];
			return;
		}
		setHover(doc, view, null, { bubbles: true, view, pointerType: 'mouse' });
	};

	/** Puts the page's focus back on the game once a field is done, so keys reach the game again. */
	const releaseFocus = () => {
		if (focused) {
			focused.field.removeEventListener('blur', focused.onBlur);
			if (focused.wasInert) frame.setAttribute('inert', '');
			focused = null;
		}
		(scene.getEngine().getRenderingCanvas() as HTMLElement | null)?.focus?.({ preventScroll: true });
	};

	const setFieldValue = (field: HTMLInputElement | HTMLTextAreaElement, text: string, view: FrameWindow) => {
		if (field.value === text) return;
		field.value = text;
		field.dispatchEvent(new view.Event('input', { bubbles: true }));
	};

	const editField = (field: HTMLInputElement | HTMLTextAreaElement, view: FrameWindow) => {
		textSession?.close();
		const multiline = field instanceof view.HTMLTextAreaElement;
		const finish = (text: string) => {
			setFieldValue(field, text, view);
			field.dispatchEvent(new view.Event('change', { bubbles: true }));
			field.dispatchEvent(new view.FocusEvent('blur'));
			field.dispatchEvent(new view.FocusEvent('focusout', { bubbles: true }));
			textSession = null;
		};
		textSession = requestTextInput(
			{ title: fieldTitle(field), initial: field.value, placeholder: field.placeholder, multiline, secret: field.type === 'password', maxLength: field.maxLength > 0 ? field.maxLength : undefined, near: mesh },
			{ onChange: (text) => setFieldValue(field, text, view), onSubmit: finish, onClose: finish }
		);
		if (textSession) return;
		// No in-world keyboard (not in a headset): type on the real one. Focus moves into the page, so the game's own
		// key handlers (movement, the inspector toggle) do not see what is typed.
		// HTML-in-Canvas marks the frame inert (so it never takes the canvas's pointer), which also keeps it from taking
		// the keyboard: lifted while the field is being typed into, put back when it is left.
		const wasInert = frame.hasAttribute('inert');
		if (wasInert) frame.removeAttribute('inert');
		frame.contentWindow?.focus();
		field.focus({ preventScroll: true });
		const onBlur = () => releaseFocus();
		field.addEventListener('blur', onBlur);
		focused = { field, onBlur, wasInert };
	};

	const observer = scene.onPointerObservable.add((info) => {
		const doc = frameDocument(frame);
		const view = doc?.defaultView;
		if (!doc || !view) return;
		const source = info.event as PointerEvent & WheelEvent;
		const common = { bubbles: true, cancelable: true, view, button: source.button ?? 0, buttons: source.buttons ?? 0, pointerId: source.pointerId ?? 1, pointerType: source.pointerType ?? 'mouse' } as const;

		if (info.type === PointerEventTypes.POINTERWHEEL) {
			const hit = hitOf(info.pickInfo) ?? lastHit;
			if (!hit) return;
			const target = doc.elementFromPoint(hit.x, hit.y) ?? doc.body;
			const unit = source.deltaMode === 1 ? 32 : source.deltaMode === 2 ? height : 1;
			const scroller = scrollableAncestor(target, view, source.deltaX, source.deltaY);
			if (scroller) {
				scroller.scrollBy(source.deltaX * unit, source.deltaY * unit);
				notifyScrolled(scroller, view);
				onScroll(scroller);
				onActivity();
			}
			source.preventDefault?.();
			return;
		}

		const name = info.type === PointerEventTypes.POINTERDOWN ? 'pointerdown' : info.type === PointerEventTypes.POINTERUP ? 'pointerup' : info.type === PointerEventTypes.POINTERMOVE ? 'pointermove' : null;
		if (!name) return;
		// In a headset both hands have a laser, and both send moves. While one is pressing, the other is ignored: its moves
		// would otherwise count as the press moving (turning every click into a scroll), and its release would end it.
		const pointerId = common.pointerId;
		if (press && press.pointerId !== pointerId) return;
		const hit = hitOf(info.pickInfo);
		lastHit = name === 'pointermove' || hit ? hit : lastHit;

		if (!hit) {
			// Only the laser that is hovering can take the hover away (the other one pointing elsewhere does not).
			if (name === 'pointermove' && hoverPointer === pointerId) clearHover();
			// Releasing off the screen still ends a press, so a drag inside the page does not stick.
			if (name === 'pointerup' && press) {
				press.target.dispatchEvent(new view.PointerEvent('pointerup', { ...common, clientX: 0, clientY: 0 }));
				press = null;
			}
			return;
		}

		const { x, y } = hit;
		const target = doc.elementFromPoint(x, y) ?? doc.body;
		const init = { ...common, clientX: x, clientY: y };

		if (name === 'pointermove') {
			hoverPointer = pointerId;
			setHover(doc, view, target, init);
			// How far the press has moved, as a fraction of what makes it a scroll (1 = scroll).
			let travel = 0;
			if (press) {
				const settling = performance.now() - press.at < PRESS_SETTLE_MS;
				const point = info.pickInfo?.pickedPoint;
				if (press.point && press.origin && point) {
					// The angle the pointer turned through, seen from where it points from.
					const before = press.point.subtract(press.origin).normalize();
					const now = point.subtract(press.origin).normalize();
					const cos = Math.min(1, Math.max(-1, Vector3.Dot(before, now)));
					travel = ((Math.acos(cos) * 180) / Math.PI) / (settling ? PRESS_SETTLE_ANGLE : DRAG_SCROLL_ANGLE);
				} else {
					travel = (Math.abs(y - press.y) + Math.abs(x - press.x) * 0.5) / (settling ? DRAG_SCROLL_THRESHOLD * 1.75 : DRAG_SCROLL_THRESHOLD);
				}
			}
			if (press && !press.dragging && !press.announced && press.touch && press.scroller && travel > 0.5) {
				press.announced = true;
				onScrollIntent(press.scroller);
			}
			if (press && !press.dragging && press.touch && press.scroller && travel > 1) {
				press.dragging = true;
				press.dragX = x;
				press.dragY = y;
				press.target.dispatchEvent(new view.PointerEvent('pointercancel', { ...init, buttons: 0 }));
			}
			if (press?.dragging && press.scroller) {
				// Measured from where the drag took over, so the content does not jump by the threshold.
				press.scroller.scrollTo(press.scrollStart[0] - (x - press.dragX), press.scrollStart[1] - (y - press.dragY));
				notifyScrolled(press.scroller, view);
				onScroll(press.scroller);
				onActivity();
				return;
			}
		} else if (name === 'pointerdown') {
			const touch = init.pointerType !== 'mouse'; // a mouse has a wheel; a laser or a finger scrolls by dragging
			// An element that takes drags itself says so the way it would for a finger (`touch-action: none`): a colour
			// picker, a number's scrub handle. Anywhere else a laser drag scrolls.
			const scroller = touch && !handlesDrag(target, view) ? scrollContainer(target, view) : null;
			press = { target, x, y, dragX: x, dragY: y, scroller, scrollStart: scroller ? [scroller.scrollLeft, scroller.scrollTop] : [0, 0], dragging: false, announced: false, touch, pointerId, at: performance.now(), point: info.pickInfo?.pickedPoint?.clone() ?? null, origin: (info.pickInfo?.ray?.origin ?? scene.activeCamera?.globalPosition)?.clone() ?? null };
		}

		target.dispatchEvent(new view.PointerEvent(name, init));
		target.dispatchEvent(new view.MouseEvent(name === 'pointerdown' ? 'mousedown' : name === 'pointerup' ? 'mouseup' : 'mousemove', init));
		// A move is not news by itself: whatever it changes (hover, a drag in the page) shows up as a DOM change.
		if (name !== 'pointermove') onActivity();

		if (name === 'pointerup' && press) {
			const { target: downTarget, dragging, touch } = press;
			press = null;
			// A laser shakes between press and release: the click goes to what was pressed, not to what the shake ended on.
			const clicked = touch ? downTarget : target;
			if (!dragging && (touch || downTarget === target) && init.button === 0 && clicked.isConnected) {
				clicked.dispatchEvent(new view.MouseEvent('click', init));
				const field = textFieldAt(clicked);
				if (field) editField(field, view);
			}
		}
	});

	return {
		stop: () => {
			scene.onPointerObservable.remove(observer);
			textSession?.close();
			clearHover();
			releaseFocus();
		},
		isTyping: () => focused !== null,
		isScrolling: () => Boolean(press?.dragging)
	};
}

/**
 * Draws a live web page onto `mesh`. With the WICG HTML-in-Canvas API (Babylon's `HtmlTexture`) the page is an
 * `<iframe>` hosted under the engine canvas. When that API is missing, or its `paint` events stop (an immersive
 * XR session pauses the page's rendering), a same-origin page is rasterized by `snapshotFrame` instead, but only
 * when the page changed (a mutation, a scroll, a field edit, a forwarded pointer). A cross-origin page is only
 * ever drawn by the native API, and only as far as the specification allows.
 */
export function setupHtmlView(scene: Scene, mesh: AbstractMesh, initial: HtmlViewComponent): HtmlViewBinding {
	const width = Math.max(64, initial.width ?? DEFAULT_WIDTH);
	const height = Math.max(64, initial.height ?? DEFAULT_HEIGHT);
	const pixelRatio = Math.min(3, Math.max(1, initial.pixelRatio ?? 1));
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
	let snapshotInterval = SNAPSHOT_INTERVAL_MS;
	/** The last full picture of the page, drawn under a scroll layer. */
	let baseImage: HTMLImageElement | null = null;
	let layer: ScrollLayer | null = null;
	let layerDirty = false;
	let layerBusy = false;
	let layerAt = 0;
	/** The container being scrolled right now, and when it last moved. */
	let scrolling: Element | null = null;
	let scrolledAt = 0;
	let composedAt = '';
	let dirty = true;
	let wasShown = false;
	const imageCache = new Map<string, string>();
	const markDirty = () => {
		dirty = true;
		layerDirty = true;
	};

	// The page tells us when it changed, so a page that is sitting still costs nothing to keep on screen.
	let stopWatching: (() => void) | null = null;
	const watch = () => {
		stopWatching?.();
		stopWatching = null;
		const doc = frameDocument(frame);
		const view = doc?.defaultView;
		if (!doc?.documentElement || !view) return;
		const mutations = new view.MutationObserver(markDirty);
		mutations.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
		const events = ['input', 'change', 'scroll', 'load', 'focusin', 'focusout', 'transitionend'];
		for (const name of events) doc.addEventListener(name, markDirty, true);
		// Keys pressed while the page has the focus, and not typed into one of its fields, belong to the game.
		const passKey = (event: Event) => {
			const canvas = engine.getRenderingCanvas() as HTMLCanvasElement | null;
			if (canvas && !isEditable(event.target)) forwardKeyTo(canvas, event as KeyboardEvent);
		};
		doc.addEventListener('keydown', passKey, true);
		doc.addEventListener('keyup', passKey, true);
		stopWatching = () => {
			mutations.disconnect();
			for (const name of events) doc.removeEventListener(name, markDirty, true);
			doc.removeEventListener('keydown', passKey, true);
			doc.removeEventListener('keyup', passKey, true);
		};
		markDirty();
	};
	const onFrameLoad = () => watch();
	frame.addEventListener('load', onFrameLoad);

	const takeSnapshot = async () => {
		if (snapshotBusy) return;
		snapshotBusy = true;
		snapshotAt = performance.now();
		dirty = false;
		try {
			snapshotTexture ??= new DynamicTexture(`${mesh.name}-html-view-snapshot`, { width: width * pixelRatio, height: height * pixelRatio }, scene, false);
			const image = await snapshotFrame(frame, width, height, pixelRatio, imageCache).catch(() => null);
			if (!snapshotActive) return;
			const size = snapshotTexture.getSize();
			if (image) {
				baseImage = image;
				composedAt = '';
				const context = snapshotTexture.getContext() as unknown as CanvasRenderingContext2D;
				context.drawImage(image, 0, 0, size.width, size.height);
				snapshotTexture.update();
			} else if (frameDocument(frame)) {
				// Reachable but not drawable yet: the page is still loading (or between two documents).
				drawNotice(snapshotTexture, 'Loading…', '');
			} else {
				drawNotice(snapshotTexture, 'This page cannot be drawn here', native ? 'Only pages from this site can be shown while the browser pauses the page.' : 'Enable chrome://flags/#canvas-draw-element, or use a page from this site.');
			}
			show(snapshotTexture);
		} finally {
			snapshotBusy = false;
			const took = performance.now() - snapshotAt;
			snapshotInterval = Math.min(SNAPSHOT_MAX_INTERVAL_MS, Math.max(SNAPSHOT_INTERVAL_MS, took / SNAPSHOT_BUDGET));
		}
	};
	/** Draws the scroll layer for `element` (again, when the page changed under it). The old one is used meanwhile. */
	const buildLayer = async (element: Element) => {
		if (layerBusy) return;
		layerBusy = true;
		layerAt = performance.now();
		layerDirty = false;
		try {
			const next = await snapshotScrollLayer(element, pixelRatio, imageCache).catch(() => null);
			if (next) {
				layer = next;
				composedAt = '';
			}
		} finally {
			layerBusy = false;
			snapshotInterval = Math.min(SNAPSHOT_MAX_INTERVAL_MS, Math.max(snapshotInterval, (performance.now() - layerAt) / SNAPSHOT_BUDGET / 2));
		}
	};

	/** The last full picture with the scrolled container's layer moved to where the container is scrolled now. */
	const compose = () => {
		if (!snapshotTexture || !baseImage || !layer || !scrolling || layer.element !== scrolling) return;
		const element = layer.element;
		const key = `${element.scrollTop}:${element.scrollLeft}:${layer.top}:${layer.image.src.length}`;
		if (key === composedAt) return;
		composedAt = key;
		const size = snapshotTexture.getSize();
		const scale = size.width / width;
		const context = snapshotTexture.getContext() as unknown as CanvasRenderingContext2D;
		context.drawImage(baseImage, 0, 0, size.width, size.height);
		context.save();
		context.beginPath();
		context.rect(layer.x * scale, layer.y * scale, layer.width * scale, layer.height * scale);
		context.clip();
		context.fillStyle = layer.background;
		context.fillRect(layer.x * scale, layer.y * scale, layer.width * scale, layer.height * scale);
		const offsetY = element.scrollTop - layer.top;
		context.drawImage(layer.image, layer.x * scale, (layer.y - offsetY) * scale, layer.width * scale, layer.contentHeight * scale);
		context.restore();
		snapshotTexture.update();
		// Scrolled past what the layer holds: draw it again around the new position.
		if (offsetY < 0 || offsetY + layer.height > layer.contentHeight) layerDirty = true;
	};

	const onScroll = (element: Element) => {
		scrolledAt = performance.now();
		if (scrolling !== element) {
			scrolling = element;
			layer = layer?.element === element ? layer : null;
			layerDirty = true;
		}
	};

	const setSnapshotActive = (active: boolean) => {
		if (active === snapshotActive) return;
		snapshotActive = active;
		if (active) markDirty();
		else if (htmlTexture) show(htmlTexture);
	};

	// The canvas only reports a paint when it notices a change; iframe content is not always noticed, so ask for a
	// fresh snapshot a few times a second while the screen is in use.
	let sinceRefresh = 0;
	const refresh = scene.onBeforeRenderObservable.add(() => {
		// While a container is being scrolled its layer is moved every frame; the page is redrawn once scrolling stops.
		if (scrolling && snapshotActive) {
			if (performance.now() - scrolledAt > SCROLL_SETTLE_MS && !forwarding?.isScrolling()) {
				scrolling = null;
				dirty = true;
			} else {
				if (layerDirty && !layerBusy && performance.now() - layerAt >= snapshotInterval / 2) void buildLayer(scrolling);
				compose();
			}
		}
		sinceRefresh += engine.getDeltaTime();
		if (sinceRefresh < REFRESH_INTERVAL_MS) return;
		sinceRefresh = 0;
		const shown = mesh.isEnabled() && mesh.isVisible;
		if (!shown) {
			wasShown = false;
			return;
		}
		if (!wasShown) {
			wasShown = true;
			markDirty();
		}
		if (htmlTexture) {
			htmlTexture.requestUpdate();
			setSnapshotActive(performance.now() - lastPaintAt > PAINT_STALL_MS);
		}
		if (snapshotActive && dirty && !scrolling && performance.now() - snapshotAt >= snapshotInterval) void takeSnapshot();
	});

	const interaction = initial.interaction ?? 'raycast';
	let stopInput: (() => void) | null = null;
	let forwarding: Forwarding | null = null;
	if (interaction !== 'none') {
		mesh.isPickable = true;
		mesh.metadata = { ...(mesh.metadata ?? {}), interactive: true };
		if (interaction === 'overlay' && htmlTexture) {
			const manager = new HtmlInteractionManager(scene, htmlTexture, mesh);
			stopInput = () => manager.dispose();
		} else {
			forwarding = forwardPointerToFrame(scene, mesh, frame, width, height, markDirty, onScroll, (element) => {
				if (layer?.element !== element || layerDirty) void buildLayer(element);
			});
			stopInput = forwarding.stop;
		}
	}

	// The page must not keep the keyboard: a page that focuses itself (SvelteKit does, after navigating) would leave the
	// game deaf to movement and shortcuts. Only a field being typed into on purpose may hold it.
	// The canvas losing the keyboard to the page (the frame, or nothing at all: a page that failed to take the focus
	// still takes it from the canvas) gets it back. Focus moving to a real control of the game's own page is left alone.
	const canvas = engine.getRenderingCanvas() as HTMLCanvasElement | null;
	const onCanvasBlur = () =>
		setTimeout(() => {
			if (!canvas || forwarding?.isTyping() || !document.hasFocus()) return;
			const active = document.activeElement;
			const lost = !active || active === document.body || active === frame || (canvas.contains(active) && active !== canvas);
			if (lost && mesh.isEnabled()) canvas.focus({ preventScroll: true });
		});
	canvas?.addEventListener('blur', onCanvasBlur);
	const onWindowBlur = () => setTimeout(() => document.activeElement === frame && onCanvasBlur());
	window.addEventListener('blur', onWindowBlur);

	return {
		frame,
		dispose: () => {
			window.removeEventListener('blur', onWindowBlur);
			canvas?.removeEventListener('blur', onCanvasBlur);
			scene.onBeforeRenderObservable.remove(refresh);
			stopInput?.();
			stopWatching?.();
			frame.removeEventListener('load', onFrameLoad);
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
