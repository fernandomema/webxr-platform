import {
	Button,
	Control,
	Image,
	InputText,
	Rectangle,
	ScrollViewer,
	StackPanel,
	TextBlock
} from '@babylonjs/gui';
import { ensureCloudAssets } from '$lib/assets/cloudSync';
import type { AssetId } from '$lib/assets/ref';
import { getLocalAssetStore } from '$lib/assets/store';
import { thumbnailUrl } from '$lib/assets/thumbnails';
import { copyScene, validateWorldScene } from '$lib/worlds/package';
import type { WorldPackage } from '$lib/worlds/types';
import { gameState } from '../gameState';
import type { SceneGraph } from '../sceneGraph';
import { BUILTIN_WORLDS, type BuiltinWorld } from '../templates/builtinWorlds';
import { captureItemThumbnail } from '../thumbnail/capture';

/**
 * The Dash "Worlds" tab: a sidebar of categories, a grid of world cards with their 360° preview, and a detail page for the
 * chosen world where the preview can be looked around in with the laser.
 */

export interface WorldsBrowserCallbacks {
	onJoinWorld(roomCode: string): Promise<void>;
	onSpawnPublishedWorld(world: WorldPackage): void;
	onLaunchBuiltinWorld(world: BuiltinWorld): Promise<void>;
}

export interface WorldsBrowser {
	/** The room code field, so the headset keyboard can be attached to it. */
	joinCodeInput: InputText;
	/** Reloads what the current category lists. */
	refresh(): Promise<void>;
}

type Category = 'official' | 'active' | 'published' | 'marketplace' | 'join';

const CATEGORIES: ReadonlyArray<{ id: Category; label: string }> = [
	{ id: 'official', label: 'Official' },
	{ id: 'active', label: 'Active worlds' },
	{ id: 'published', label: 'Published' },
	{ id: 'marketplace', label: 'Marketplace' },
	{ id: 'join', label: 'Join by code' }
];

const C = {
	bg: '#111827', surface: '#1f2937', surfaceHover: '#273449', border: '#374151',
	text: '#e2e8f0', muted: '#94a3b8', accent: '#7c3aed', accentSoft: '#4c1d95', ok: '#86efac', warn: '#fbbf24', error: '#f87171'
};

const MAIN_WIDTH = 780;
const CARD_W = 252;
const CARD_H = 180;
const CARD_PREVIEW_H = 122;
const CARD_COLUMNS = 3;
const VIEWER_W = 470;
const VIEWER_H = 300;
/** How much of the 360° picture the viewer shows at once (about 108° across). */
const VIEWER_SPAN = 0.3;

/** A world that can be picked from a list. */
interface WorldEntry {
	key: string;
	name: string;
	subtitle: string;
	description: string;
	/** The 360° preview, if there is (or can be made) one. Resolves to null when there is none. */
	preview(): Promise<AssetId | null>;
	primary: { label: string; run(): Promise<string> };
	secondary?: { label: string; run(): Promise<string> };
}

interface ActiveSession {
	roomCode: string;
	startedAt: string;
	world: { name: string; thumbnailAssetId: string | null; hostUser?: { name: string } | null };
}

interface Publication {
	id: string;
	name: string;
	ownerId: string;
	latestRevision: number;
	thumbnailAssetId: string | null;
}

interface MarketplaceItem {
	id: string;
	name: string;
	description: string;
	latestRevision: number;
	containsCode: boolean;
	thumbnailAssetId: string | null;
}

// --- Previews of the official worlds -------------------------------------------------------------------------------
// They ship with the app, so nothing stored for them exists on a server: each is drawn once on this device, kept in the
// local asset store, and remembered by the content of its scene so it is drawn again only when the world changes.

const builtinPreviews = new Map<string, Promise<AssetId | null>>();
let builtinQueue: Promise<unknown> = Promise.resolve();

function sceneHash(scene: unknown): string {
	const text = JSON.stringify(scene);
	let hash = 5381;
	for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
	return `${(hash >>> 0).toString(36)}-${text.length.toString(36)}`;
}

function storageGet(key: string): string | null {
	try { return localStorage.getItem(key); } catch { return null; }
}

function storageSet(key: string, value: string): void {
	try { localStorage.setItem(key, value); } catch { /* the preview is simply drawn again next time */ }
}

function builtinPreview(world: BuiltinWorld): Promise<AssetId | null> {
	let job = builtinPreviews.get(world.id);
	if (!job) {
		job = (async () => {
			const key = `kithin.worldPreview.${world.id}.${sceneHash(world.scene)}`;
			const known = storageGet(key) as AssetId | null;
			if (known && (await thumbnailUrl(known))) return known;
			// One at a time: each picture is six renders of a whole world.
			const run = builtinQueue.then(() => captureItemThumbnail(copyScene(world.scene), 'world', { name: world.name }));
			builtinQueue = run.catch(() => undefined);
			const made = await run;
			if (made) storageSet(key, made);
			else builtinPreviews.delete(world.id); // try again the next time the tab is opened
			return made;
		})();
		builtinPreviews.set(world.id, job);
	}
	return job;
}

// --- Small GUI helpers ------------------------------------------------------------------------------------------------

function text(name: string, value: string, size: number, color: string, height: number): TextBlock {
	const block = new TextBlock(name, value);
	block.fontSize = size;
	block.color = color;
	block.height = `${height}px`;
	block.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	return block;
}

function pill(name: string, label: string, width: number, height: number, background: string): Button {
	const button = Button.CreateSimpleButton(name, label);
	button.width = `${width}px`;
	button.height = `${height}px`;
	button.color = 'white';
	button.fontSize = 18;
	button.background = background;
	button.cornerRadius = 8;
	button.thickness = 0;
	return button;
}

function topLeft<T extends Control>(control: T, left: number, top: number): T {
	control.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	control.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
	control.left = `${left}px`;
	control.top = `${top}px`;
	return control;
}

function clear(container: { children: Control[]; removeControl(control: Control): unknown }): void {
	for (const child of [...container.children]) {
		container.removeControl(child);
		child.dispose();
	}
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** A dark tint that is the same for the same name, so worlds without a picture are still told apart. */
function placeholderTint(name: string): string {
	let hash = 0;
	for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
	return `hsl(${Math.abs(hash) % 360}, 40%, 22%)`;
}

/** The middle part of a 360° picture (looking straight ahead from the spawn), cropped to the shape of `width` x `height`. */
function cardPicture(name: string, url: string, width: number, height: number): Image {
	const picture = new Image(name, url);
	picture.stretch = Image.STRETCH_FILL;
	picture.isHitTestVisible = false;
	picture.onImageLoadedObservable.addOnce(() => {
		const cropW = Math.floor(picture.imageWidth * 0.4);
		const cropH = Math.min(picture.imageHeight, Math.floor((cropW * height) / width));
		picture.sourceLeft = Math.floor((picture.imageWidth - cropW) / 2);
		picture.sourceTop = Math.floor((picture.imageHeight - cropH) / 2);
		picture.sourceWidth = cropW;
		picture.sourceHeight = cropH;
	});
	return picture;
}

/**
 * Looks around inside a 360° picture: where the laser is over the box picks the direction, left to right turning once around
 * (the picture wraps) and top to bottom from straight up to straight down. With the laser away it faces straight ahead.
 */
function panoramaViewer(name: string, url: string): Rectangle {
	const box = new Rectangle(name);
	box.width = `${VIEWER_W}px`;
	box.height = `${VIEWER_H}px`;
	box.cornerRadius = 12;
	box.thickness = 2;
	box.color = C.accentSoft;
	box.background = '#0b1020';
	box.isPointerBlocker = true;

	// The seam of the picture can be in view, so it is drawn as two pieces: the end of the picture and then its start.
	const pieces = [0, 1].map((index) => {
		const piece = new Image(`${name}-piece-${index}`, url);
		piece.stretch = Image.STRETCH_FILL;
		piece.isHitTestVisible = false;
		piece.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		piece.horizontalAlignment = index === 0 ? Control.HORIZONTAL_ALIGNMENT_LEFT : Control.HORIZONTAL_ALIGNMENT_RIGHT;
		piece.height = `${VIEWER_H}px`;
		box.addControl(piece);
		return piece;
	});
	const [first, second] = pieces;
	second.isVisible = false;

	const badge = new Rectangle(`${name}-badge`);
	badge.width = '54px'; badge.height = '24px'; badge.cornerRadius = 12; badge.thickness = 0; badge.background = '#000000aa';
	badge.isHitTestVisible = false;
	topLeft(badge, 10, 10);
	const label = new TextBlock(`${name}-badge-text`, '360°');
	label.color = 'white'; label.fontSize = 14;
	badge.addControl(label);
	box.addControl(badge);

	let u = 0.5;
	let v = 0.5;
	const draw = () => {
		const total = first.imageWidth;
		const tall = first.imageHeight;
		if (!total || !tall) return;
		const viewW = Math.round(total * VIEWER_SPAN);
		const viewH = Math.min(tall, Math.round((viewW * VIEWER_H) / VIEWER_W));
		const top = Math.round(v * (tall - viewH));
		const left = (((Math.round(u * total - viewW / 2)) % total) + total) % total;
		const head = Math.min(viewW, total - left);
		const tail = viewW - head;
		const headPx = Math.round((head / viewW) * VIEWER_W);
		first.sourceLeft = left; first.sourceTop = top; first.sourceWidth = head; first.sourceHeight = viewH;
		first.width = `${tail > 0 ? headPx : VIEWER_W}px`;
		second.isVisible = tail > 0;
		if (tail > 0) {
			second.sourceLeft = 0; second.sourceTop = top; second.sourceWidth = tail; second.sourceHeight = viewH;
			second.width = `${VIEWER_W - headPx}px`;
		}
	};
	first.onImageLoadedObservable.add(draw);
	box.onPointerMoveObservable.add((position) => {
		const local = box.getLocalCoordinates(position);
		const nextU = clamp01(local.x / VIEWER_W);
		const nextV = clamp01(local.y / VIEWER_H);
		if (Math.abs(nextU - u) < 0.002 && Math.abs(nextV - v) < 0.002) return;
		u = nextU; v = nextV;
		draw();
	});
	box.onPointerOutObservable.add(() => {
		u = 0.5; v = 0.5;
		draw();
	});
	return box;
}

export function createWorldsBrowser(parent: Rectangle, sceneGraph: SceneGraph, callbacks: WorldsBrowserCallbacks): WorldsBrowser {
	let category: Category = 'official';
	let selected: WorldEntry | null = null;
	let activeSessions: ActiveSession[] = [];
	let loadToken = 0;

	// --- Sidebar ---
	const sidebar = new StackPanel('worlds-sidebar');
	sidebar.width = '196px';
	topLeft(sidebar, 10, 10);
	sidebar.adaptHeightToChildren = true;
	parent.addControl(sidebar);
	const categoryButtons = new Map<Category, Button>();
	for (const entry of CATEGORIES) {
		const button = pill(`worlds-category-${entry.id}`, entry.label, 190, 50, C.surface);
		button.paddingBottom = '6px';
		button.height = '56px';
		if (button.textBlock) {
			button.textBlock.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
			button.textBlock.paddingLeft = '14px';
		}
		button.onPointerClickObservable.add(() => {
			category = entry.id;
			selected = null;
			status.text = '';
			void browser.refresh();
		});
		categoryButtons.set(entry.id, button);
		sidebar.addControl(button);
	}

	// --- Main area ---
	const main = new Rectangle('worlds-main');
	main.width = `${MAIN_WIDTH}px`;
	main.thickness = 0;
	main.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	main.left = '216px';
	parent.addControl(main);

	const title = topLeft(text('worlds-title', '', 22, 'white', 36), 4, 4);
	title.width = '560px';
	main.addControl(title);
	const refreshButton = topLeft(pill('worlds-refresh', 'Refresh', 130, 36, '#374151'), MAIN_WIDTH - 134, 4);
	refreshButton.fontSize = 16;
	refreshButton.onPointerClickObservable.add(async () => {
		refreshButton.isEnabled = false;
		try { await browser.refresh(); } finally { refreshButton.isEnabled = true; }
	});
	main.addControl(refreshButton);
	const status = topLeft(text('worlds-status', '', 15, C.warn, 24), 4, 42);
	status.width = `${MAIN_WIDTH - 8}px`;
	main.addControl(status);

	const body = new Rectangle('worlds-body');
	body.width = `${MAIN_WIDTH}px`;
	body.height = '440px';
	body.thickness = 0;
	topLeft(body, 0, 70);
	main.addControl(body);

	function scroller(name: string): { scroll: ScrollViewer; stack: StackPanel } {
		const scroll = new ScrollViewer(`${name}-scroll`);
		scroll.width = `${MAIN_WIDTH}px`;
		scroll.height = '440px';
		scroll.thickness = 0;
		scroll.barColor = C.accent;
		scroll.barSize = 10;
		scroll.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		const stack = new StackPanel(`${name}-stack`);
		stack.width = `${MAIN_WIDTH - 16}px`;
		scroll.addControl(stack);
		body.addControl(scroll);
		return { scroll, stack };
	}

	const grid = scroller('worlds-grid');
	const market = scroller('worlds-market');
	const detail = new Rectangle('worlds-detail');
	detail.width = `${MAIN_WIDTH}px`;
	detail.height = '440px';
	detail.thickness = 0;
	body.addControl(detail);

	const joinView = new Rectangle('worlds-join');
	joinView.width = `${MAIN_WIDTH}px`;
	joinView.height = '440px';
	joinView.thickness = 0;
	body.addControl(joinView);
	const joinHint = topLeft(text('worlds-join-hint', 'Enter the code of a private room to join it.', 18, C.muted, 30), 4, 10);
	joinHint.width = `${MAIN_WIDTH - 8}px`;
	joinView.addControl(joinHint);
	const joinInput = topLeft(new InputText('worlds-join-input'), 4, 52);
	joinInput.width = '360px'; joinInput.height = '52px';
	joinInput.color = 'white'; joinInput.background = C.surface; joinInput.placeholderText = 'Private room code';
	joinView.addControl(joinInput);
	const joinButton = topLeft(pill('worlds-join-button', 'Join room', 180, 52, '#2563eb'), 376, 52);
	joinButton.onPointerClickObservable.add(async () => {
		const code = joinInput.text.trim();
		if (!code) return;
		joinButton.isEnabled = false;
		try {
			await callbacks.onJoinWorld(code);
			status.color = C.ok;
			status.text = 'Joined the room.';
		} catch (error) {
			status.color = C.warn;
			status.text = error instanceof Error ? error.message : 'Could not join room';
		} finally {
			joinButton.isEnabled = true;
		}
	});
	joinView.addControl(joinButton);

	function say(message: string, color = C.warn): void {
		status.color = color;
		status.text = message;
	}

	// --- Cards ---
	function card(entry: WorldEntry): Rectangle {
		const cell = new Rectangle(`world-card-${entry.key}`);
		cell.width = `${CARD_W}px`;
		cell.height = `${CARD_H}px`;
		cell.paddingLeft = cell.paddingRight = '3px';
		cell.paddingTop = cell.paddingBottom = '4px';
		cell.cornerRadius = 10;
		cell.thickness = 1;
		cell.color = C.border;
		cell.background = C.surface;
		cell.isPointerBlocker = true;
		cell.hoverCursor = 'pointer';
		cell.onPointerEnterObservable.add(() => { cell.background = C.surfaceHover; cell.color = C.accent; });
		cell.onPointerOutObservable.add(() => { cell.background = C.surface; cell.color = C.border; });
		cell.onPointerClickObservable.add(() => { selected = entry; status.text = ''; showDetail(entry); });

		const frame = new Rectangle(`world-card-frame-${entry.key}`);
		frame.width = 1;
		frame.height = `${CARD_PREVIEW_H}px`;
		frame.thickness = 0;
		frame.background = placeholderTint(entry.name);
		frame.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		frame.isHitTestVisible = false;
		const waiting = new TextBlock(`world-card-waiting-${entry.key}`, 'Loading preview…');
		waiting.color = '#ffffff99'; waiting.fontSize = 14;
		frame.addControl(waiting);
		cell.addControl(frame);

		void entry.preview().then(async (assetId) => {
			const url = assetId ? await thumbnailUrl(assetId) : null;
			if (!url) { waiting.text = 'No preview'; return; }
			frame.removeControl(waiting);
			frame.addControl(cardPicture(`world-card-picture-${entry.key}`, url, CARD_W - 6, CARD_PREVIEW_H));
		}).catch(() => { waiting.text = 'No preview'; });

		const name = topLeft(text(`world-card-name-${entry.key}`, entry.name, 16, 'white', 22), 10, CARD_PREVIEW_H + 6);
		name.width = `${CARD_W - 26}px`;
		name.isHitTestVisible = false;
		cell.addControl(name);
		const subtitle = topLeft(text(`world-card-subtitle-${entry.key}`, entry.subtitle, 12, C.muted, 18), 10, CARD_PREVIEW_H + 28);
		subtitle.width = `${CARD_W - 26}px`;
		subtitle.isHitTestVisible = false;
		cell.addControl(subtitle);
		return cell;
	}

	function fillGrid(entries: WorldEntry[], emptyText: string): void {
		clear(grid.stack);
		if (entries.length === 0) {
			const empty = text('worlds-empty', emptyText, 18, C.muted, 60);
			empty.paddingLeft = '8px';
			grid.stack.addControl(empty);
			return;
		}
		for (let start = 0; start < entries.length; start += CARD_COLUMNS) {
			const row = new StackPanel(`worlds-row-${start}`);
			row.isVertical = false;
			row.height = `${CARD_H + 8}px`;
			row.width = `${MAIN_WIDTH - 16}px`;
			for (const entry of entries.slice(start, start + CARD_COLUMNS)) row.addControl(card(entry));
			grid.stack.addControl(row);
		}
	}

	// --- Detail page ---
	function showDetail(entry: WorldEntry): void {
		clear(detail);
		grid.scroll.isVisible = false;
		detail.isVisible = true;

		const viewerSlot = new Rectangle('world-viewer-slot');
		viewerSlot.width = `${VIEWER_W}px`; viewerSlot.height = `${VIEWER_H}px`;
		viewerSlot.cornerRadius = 12; viewerSlot.thickness = 0; viewerSlot.background = placeholderTint(entry.name);
		topLeft(viewerSlot, 4, 4);
		const waiting = new TextBlock('world-viewer-waiting', 'Loading preview…');
		waiting.color = '#ffffffaa'; waiting.fontSize = 18;
		viewerSlot.addControl(waiting);
		detail.addControl(viewerSlot);
		void entry.preview().then(async (assetId) => {
			const url = assetId ? await thumbnailUrl(assetId) : null;
			if (selected !== entry) return;
			if (!url) { waiting.text = 'This world has no preview yet'; return; }
			viewerSlot.dispose();
			const viewer = panoramaViewer('world-viewer', url);
			topLeft(viewer, 4, 4);
			detail.addControl(viewer);
			hint.text = 'Point the laser at the picture to look around.';
		}).catch(() => { waiting.text = 'This world has no preview yet'; });

		const hint = topLeft(text('world-viewer-hint', '', 14, C.muted, 22), 8, VIEWER_H + 12);
		hint.width = `${VIEWER_W}px`;
		detail.addControl(hint);

		const column = 4 + VIEWER_W + 18;
		const width = MAIN_WIDTH - column - 4;
		const name = topLeft(text('world-detail-name', entry.name, 24, 'white', 64), column, 4);
		name.width = `${width}px`; name.textWrapping = true;
		name.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		detail.addControl(name);
		const subtitle = topLeft(text('world-detail-subtitle', entry.subtitle, 15, C.muted, 24), column, 70);
		subtitle.width = `${width}px`;
		detail.addControl(subtitle);
		const description = topLeft(text('world-detail-description', entry.description, 16, C.text, 130), column, 102);
		description.width = `${width}px`; description.textWrapping = true;
		description.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		detail.addControl(description);

		const act = (button: Button, action: { run(): Promise<string> }) => button.onPointerClickObservable.add(async () => {
			button.isEnabled = false;
			try { say(await action.run(), C.ok); }
			catch (error) { say(error instanceof Error ? error.message : 'Something went wrong'); }
			finally { button.isEnabled = true; }
		});
		let top = 240;
		const primary = topLeft(pill('world-detail-primary', entry.primary.label, width, 52, C.accent), column, top);
		act(primary, entry.primary);
		detail.addControl(primary);
		top += 58;
		if (entry.secondary) {
			const secondary = topLeft(pill('world-detail-secondary', entry.secondary.label, width, 44, '#374151'), column, top);
			secondary.fontSize = 16;
			act(secondary, entry.secondary);
			detail.addControl(secondary);
		}
		const back = topLeft(pill('world-detail-back', '‹ Back', 120, 40, C.surface), column, 392);
		back.fontSize = 16;
		back.onPointerClickObservable.add(() => { selected = null; status.text = ''; void browser.refresh(); });
		detail.addControl(back);
	}

	// --- Lists of worlds ---
	function officialEntries(): WorldEntry[] {
		return BUILTIN_WORLDS.map((world) => ({
			key: `official-${world.id}`,
			name: world.name,
			subtitle: 'Official world',
			description: world.description,
			preview: () => builtinPreview(world),
			primary: {
				label: 'Go',
				run: async () => { await callbacks.onLaunchBuiltinWorld(world); return `Welcome to the ${world.name}.`; }
			}
		}));
	}

	function activeEntries(): WorldEntry[] {
		return activeSessions
			.filter((session) => session.roomCode !== gameState.roomCode)
			.map((session) => {
				const host = session.world.hostUser?.name;
				const since = new Date(session.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
				return {
					key: `active-${session.roomCode}`,
					name: session.world.name,
					subtitle: host ? `Host: ${host}` : 'Public session',
					description: `A public session${host ? ` hosted by ${host}` : ''}, open since ${since}.`,
					preview: async () => (session.world.thumbnailAssetId as AssetId | null) ?? null,
					primary: {
						label: 'Join',
						run: async () => { await callbacks.onJoinWorld(session.roomCode); return `Joined ${session.world.name}.`; }
					}
				};
			});
	}

	async function loadActiveSessions(): Promise<void> {
		try {
			const response = await fetch('/api/worlds');
			if (response.ok) activeSessions = (await response.json()) as ActiveSession[];
		} catch {
			// offline: the list keeps what it had
		}
		const count = activeEntries().length;
		const button = categoryButtons.get('active');
		if (button?.textBlock) button.textBlock.text = count > 0 ? `Active worlds (${count})` : 'Active worlds';
	}

	async function publishedEntries(): Promise<WorldEntry[]> {
		const response = await fetch('/api/published-worlds');
		if (!response.ok) return [];
		const publications = (await response.json()) as Publication[];
		return publications.map((publication) => {
			const owned = publication.ownerId === gameState.userId;
			return {
				key: `published-${publication.id}`,
				name: publication.name,
				subtitle: `Published · v${publication.latestRevision}${owned ? ' · yours' : ''}`,
				description: 'A published world. Place its orb in your world to look inside it and step through.',
				preview: async () => (publication.thumbnailAssetId as AssetId | null) ?? null,
				primary: {
					label: 'Place orb',
					run: async () => {
						const res = await fetch(`/api/published-worlds/${publication.id}`);
						if (!res.ok) throw new Error('Could not load the published world');
						callbacks.onSpawnPublishedWorld((await res.json()) as WorldPackage);
						return 'World orb placed.';
					}
				},
				secondary: owned ? {
					label: 'Publish current revision',
					run: async () => {
						const snapshot = sceneGraph.serialize({ withoutAvatars: true });
						validateWorldScene(snapshot);
						// A new preview goes with the revision when one can be made in time; the old one stays otherwise.
						const thumbnailAssetId = await captureItemThumbnail(snapshot, 'world');
						if (thumbnailAssetId) await ensureCloudAssets([], getLocalAssetStore(), { extraIds: [thumbnailAssetId] }).catch(() => undefined);
						const res = await fetch(`/api/published-worlds/${publication.id}/revisions`, {
							method: 'POST', headers: { 'content-type': 'application/json' },
							body: JSON.stringify({ scene: snapshot, thumbnailAssetId: thumbnailAssetId ?? undefined })
						});
						if (!res.ok) throw new Error('Could not publish the revision');
						return 'Revision published.';
					}
				} : undefined
			};
		});
	}

	// --- Marketplace (objects, not worlds: a plain list) ---
	function squareThumbnail(name: string, assetId: string, size: number): Rectangle {
		const frame = new Rectangle(name);
		frame.width = `${size}px`; frame.height = `${size}px`;
		frame.background = C.surface; frame.thickness = 0; frame.cornerRadius = 10; frame.clipChildren = true;
		frame.isHitTestVisible = false;
		void thumbnailUrl(assetId as AssetId).then((url) => {
			if (!url) return;
			const picture = new Image(`${name}-image`, url);
			picture.stretch = Image.STRETCH_FILL;
			picture.onImageLoadedObservable.addOnce(() => {
				const side = Math.min(picture.imageWidth, picture.imageHeight);
				picture.sourceLeft = Math.floor((picture.imageWidth - side) / 2);
				picture.sourceTop = Math.floor((picture.imageHeight - side) / 2);
				picture.sourceWidth = side;
				picture.sourceHeight = side;
			});
			frame.addControl(picture);
		});
		return frame;
	}

	async function refreshMarketplace(token: number): Promise<void> {
		clear(market.stack);
		try {
			const [catalogResponse, purchasesResponse] = await Promise.all([
				fetch('/api/marketplace/items'),
				gameState.userId ? fetch('/api/marketplace/purchases') : Promise.resolve(null)
			]);
			if (token !== loadToken || !catalogResponse.ok) return;
			const items = (await catalogResponse.json()) as MarketplaceItem[];
			const purchases = purchasesResponse?.ok ? ((await purchasesResponse.json()) as Array<{ marketplaceItemId?: string }>) : [];
			const acquired = new Set(purchases.map((item) => item.marketplaceItemId).filter(Boolean));
			if (!items.length) {
				const empty = text('marketplace-empty', 'No objects listed yet.', 18, C.muted, 60);
				empty.paddingLeft = '8px';
				market.stack.addControl(empty);
				return;
			}
			for (const item of items) {
				const row = new StackPanel(`marketplace-row-${item.id}`);
				row.isVertical = true;
				row.height = item.containsCode ? '104px' : '64px';
				row.width = 1;
				const line = new StackPanel(`marketplace-line-${item.id}`);
				line.isVertical = false;
				line.height = '56px';
				line.width = 1;
				if (item.thumbnailAssetId) line.addControl(squareThumbnail(`marketplace-thumbnail-${item.id}`, item.thumbnailAssetId, 48));
				const info = text(`marketplace-info-${item.id}`, `${item.name} · v${item.latestRevision}${item.description ? `\n${item.description.slice(0, 100)}` : ''}`, 15, C.text, 54);
				info.width = '520px'; info.textWrapping = true;
				line.addControl(info);
				const done = acquired.has(item.id);
				const button = pill(`marketplace-acquire-${item.id}`, done ? 'Acquired' : 'Acquire', 140, 48, done ? '#334155' : C.accent);
				button.isEnabled = !done;
				button.onPointerClickObservable.add(async () => {
					try {
						const response = await fetch(`/api/marketplace/items/${item.id}/purchase`, { method: 'POST' });
						if (!response.ok) throw new Error(response.status === 401 ? 'Sign in to acquire this object.' : 'Could not acquire this object.');
						button.textBlock!.text = 'Acquired';
						button.background = '#334155';
						button.isEnabled = false;
						say('Added to Purchased Objects inventory.', C.ok);
					} catch (error) {
						say(error instanceof Error ? error.message : 'Could not acquire this object');
					}
				});
				line.addControl(button);
				row.addControl(line);
				if (item.containsCode) {
					const warning = text(`marketplace-code-warning-${item.id}`, 'Warning: This product may execute potentially dangerous code.', 15, C.warn, 36);
					row.addControl(warning);
				}
				market.stack.addControl(row);
			}
		} catch {
			// offline: keep the rest of the tab usable
		}
	}

	const browser: WorldsBrowser = {
		joinCodeInput: joinInput,
		async refresh() {
			const token = ++loadToken;
			for (const [id, button] of categoryButtons) button.background = id === category ? C.accent : C.surface;
			title.text = CATEGORIES.find((entry) => entry.id === category)?.label ?? '';
			refreshButton.isVisible = category !== 'join';
			grid.scroll.isVisible = category === 'official' || category === 'active' || category === 'published';
			market.scroll.isVisible = category === 'marketplace';
			joinView.isVisible = category === 'join';
			detail.isVisible = false;

			void loadActiveSessions();
			if (category === 'official') {
				fillGrid(officialEntries(), '');
			} else if (category === 'active') {
				await loadActiveSessions();
				if (token !== loadToken) return;
				fillGrid(activeEntries(), 'Nobody is hosting a world you can join right now.');
			} else if (category === 'published') {
				try {
					const entries = await publishedEntries();
					if (token !== loadToken) return;
					fillGrid(entries, 'No worlds published yet.');
				} catch {
					if (token === loadToken) fillGrid([], 'Could not load the published worlds.');
				}
			} else if (category === 'marketplace') {
				await refreshMarketplace(token);
			}
			if (token === loadToken && selected && grid.scroll.isVisible) showDetail(selected);
		}
	};
	return browser;
}
