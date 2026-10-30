import { getPlatformConfig, platformFetch } from '../platform/config.ts';
import { PointerEventTypes, type Scene, type TransformNode, type Mesh } from '@babylonjs/core';
import {
	AdvancedDynamicTexture,
	Rectangle,
	StackPanel,
	TextBlock,
	Button,
	InputText,
	Control,
	ScrollViewer,
	Image
} from '@babylonjs/gui';
import { createSlot, type SlotTree } from '../../ecs/types.ts';
import type { SceneGraph } from '../sceneGraph.ts';
import { currentUser, isAdminUser, platformAuth } from '../platform/auth.ts';
import { startDeviceSignIn, type DeviceSignIn } from '../platform/deviceSignIn.ts';
import { getFeatures } from '../features.ts';
import { availableInventoryFolders, canHoldWorlds, getInventoryAdapter, isReadOnlyAdapter } from '../../inventory/registry.ts';
import type { InventoryAdapter, InventoryAdapterId, InventoryStorageAdapterId, InventoryFolder, InventoryItem } from '../../inventory/types.ts';
import { validateWorldScene } from '../../worlds/package.ts';
import { ensureCloudAssets } from '../../assets/cloudSync.ts';
import { getLocalAssetStore } from '../../assets/store.ts';
import type { WorldPackage } from '../../worlds/types.ts';
import { gameState, getInventoryContext } from '../gameState.ts';
import { EXPERIMENTS, visibleExperiments } from '../experiments.ts';
import { xrSettings, saveSettings, DASH_DISTANCES, DESKTOP_FOVS, MOUSE_SENSITIVITIES, type FoveationLevel, type MovementMode, type ScriptRate, type RotationMode } from '../settings.ts';
import { saveWithPreview } from '../inventorySave.ts';
import { captureItemThumbnail } from '../thumbnail/capture.ts';
import { typeWithKeyboard } from '../keyboard/guiInput.ts';
import { requestTextInput } from '../keyboard/service.ts';
import { getLayout, layoutIds } from '../keyboard/layouts/index.ts';
import type { BuiltinWorld } from '../content/registry.ts';
import { createWorldsBrowser } from './worldsBrowser.ts';
import { thumbnailUrl } from '../../assets/thumbnails.ts';
import type { AssetId } from '../../assets/ref.ts';
import { WORLD_VISIBILITY_INFO, type HostedWorldVisibility } from '../../worldVisibility.ts';
import { THEME } from './theme.ts';
import { DASH_CURVES, curvePanelMesh } from './curvedPanel.ts';
import { TabRegistry, tabBarLayout, tabBarPaging, type TabSpec } from './dashTabs.ts';
import { loadTabOrder, mergeShownOrder, moveTab, orderToKeep, saveTabOrder } from './tabOrder.ts';
import { iconUri } from './icons.ts';
import { createScrollColumn, createCard, placeText, PAGE_HEIGHT, PAGE_WIDTH } from './layout.ts';
import { createGridView } from './gridView.ts';
import { setGridService } from './gridService.ts';
import { setPanelSurfaceInfo } from './panelSurface.ts';
import { createWidgetRuntime } from './dashWidgetHost.ts';
import { createScriptSystem } from './scriptSystem.ts';
import type { PlayerSummary } from '../playerPoses.ts';
import type { UiContext } from '../uiLocale.ts';
import { createFriendsTab } from './friendsTab.ts';

/** A tab of the dash. Built-in ones are registered the same way, so anything can add its own with `DashPanelHandle.addTab`. */
export interface DashTab extends TabSpec {
	/** Fills the tab's page. Called once, when the tab is added. */
	build(content: Rectangle): void;
	/** The tab was opened (also each time it is opened again): refresh what it shows. */
	onShow?(): void;
	/** Another tab was opened in its place. */
	onHide?(): void;
}

export interface DashPanelCallbacks {
	onHostWorld(visibility: HostedWorldVisibility): Promise<void>;
	onStopHosting(): Promise<void>;
	onJoinWorld(roomCode: string): Promise<void>;
	onSpawnItem(slotData: SlotTree): void;
	onSpawnWorldOrb(item: InventoryItem, adapterId: InventoryStorageAdapterId): void;
	onSpawnPublishedWorld(world: WorldPackage): void;
	onLaunchPublishedWorld(world: WorldPackage): Promise<void>;
	onLaunchWorldItem(item: InventoryItem, adapterId: InventoryStorageAdapterId): Promise<void>;
	/** Goes to one of the worlds that ship with the app, on your own. */
	onLaunchBuiltinWorld(world: BuiltinWorld): Promise<void>;
	/** Starts a new world from scratch, on your own. */
	onCreateWorld(): Promise<void>;
	/** Makes an avatar item the one worn from now on, here and in every world joined later. Rejects with a readable message if it cannot be worn. */
	onWearAvatar(item: InventoryItem): Promise<void>;
	onSetDefaultAvatar(item: InventoryItem, adapterId: InventoryAdapterId): Promise<void>;
	/** Goes back to the avatar that ships with the app. */
	onUnsetDefaultAvatar(): Promise<void>;
	onLocomotionSettingsChanged(): void;
	onExitVr(): Promise<void>;
	/** Opens or closes the in-game inspector; null when the app has none (see `EngineFeatures.inspector`). */
	onToggleInspector: (() => void) | null;
	/** Seated mode was switched on or off (`xrSettings.seatedMode` already holds the new value). */
	onSeatedModeChanged(): void;
	/** Foveated rendering, the script rate or the performance readout was changed (`xrSettings` already holds the new values). */
	onPerformanceSettingsChanged(): void;
	/** A dev performance experiment was switched (`xrSettings.experiments` already holds the new state; see experiments.ts). */
	onExperimentChanged(id: string, on: boolean): void;
	/** Mouse speed, inverted look or field of view (the desktop controls) was changed (`xrSettings` already holds the new values). */
	onDesktopSettingsChanged(): void;
	/** The master audio volume changed (`xrSettings.masterVolume` already holds the new value). */
	onAudioSettingsChanged(): void;
	/** The language and device a piece of UI pinned to the Home reads for (see `SceneGraphOptions.getUiContext`). */
	getUiContext?(): UiContext;
	/** Everyone in the world, for the scripts of the pieces of UI pinned to the Home. */
	getPlayers?(): PlayerSummary[];
	/** The display refresh rates the headset offers (empty until a headset session has started). */
	frameRates(): number[];
}

export interface DashPanelHandle {
	root: TransformNode;
	refreshWorldsTab(): void;
	/** Adds a tab to the dash (or replaces the one with its id). Returns a function that removes it again. */
	addTab(tab: DashTab): () => void;
	removeTab(id: string): void;
	/** Opens a tab by its id. */
	showTab(id: string): void;
	/** The size (px) of a tab's page, which is what `DashTab.build` fills. */
	readonly pageSize: { width: number; height: number };
	/** Shows the choices of who can join (the Session tab's invitation), when the player is not in a session yet. */
	openInvite(): void;
}

/** The dash's texture (px): the pages' panel, a gap, and the tabs' own bar below it. */
const MAIN_HEIGHT = PAGE_HEIGHT + 40;
const TABS_HEIGHT = 124;
const DASH_WIDTH = PAGE_WIDTH;
const DASH_HEIGHT = MAIN_HEIGHT + 16 + TABS_HEIGHT;
const TAB_HEIGHT = 104;
const TAB_ICON_SIZE = 56;

export function createDashPanel(scene: Scene, sceneGraph: SceneGraph, callbacks: DashPanelCallbacks): DashPanelHandle {
	const features = getFeatures();
	const slot = createSlot({
		id: 'dash-panel',
		name: 'Dash',
		position: [0, 1.4, -1],
		components: [
			{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' } },
			{ type: 'grabbable', scalable: true }
		]
	});
	const node = sceneGraph.addSlot(slot, { system: true });
	const mesh = node as Mesh;
	// The texture is DASH_WIDTH x DASH_HEIGHT px, drawn at the same pixel size the dash always had (1.2 m for 1024 px).
	mesh.scaling.set((DASH_WIDTH * 1.2) / 1024, (DASH_HEIGHT * 1.2) / 1024, 1);
	mesh.metadata = { ...(mesh.metadata ?? {}), interactive: true };
	mesh.setEnabled(false);

	const applyCurve = () => curvePanelMesh(mesh, xrSettings.dashCurve);
	applyCurve();

	const texture = AdvancedDynamicTexture.CreateForMesh(mesh, DASH_WIDTH, DASH_HEIGHT, true);

	// Two separate panels in one texture: the pages on top, the tabs in a bar of their own below (the rest is see-through).
	const background = new Rectangle('dash-bg');
	background.width = 1;
	background.height = `${MAIN_HEIGHT}px`;
	background.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
	background.background = THEME.panel;
	background.cornerRadius = 24;
	background.thickness = 0;
	texture.addControl(background);

	const tabsPanel = new Rectangle('dash-tabs-panel');
	tabsPanel.width = 1;
	tabsPanel.height = `${TABS_HEIGHT}px`;
	tabsPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
	tabsPanel.background = THEME.panel;
	tabsPanel.cornerRadius = 24;
	tabsPanel.thickness = 0;
	texture.addControl(tabsPanel);

	const tabsBar = new StackPanel('dash-tabs');
	tabsBar.isVertical = false;
	tabsBar.height = `${TAB_HEIGHT}px`;
	tabsPanel.addControl(tabsBar);

	// --- The tabs: a registry the bar and the pages follow, so tabs can be added or removed at any time ---
	const tabs = new TabRegistry<DashTab>();
	// The order the player put the tabs in (see the drag below); applied as they are added.
	tabs.setUserOrder(loadTabOrder());
	const contentByTab: Record<string, Rectangle> = {};
	const tabButtons = new Map<string, Button>();
	let activeTab = '';
	let ready = false;
	/** The page of tabs the bar shows, when there are more tabs than fit. */
	let tabPage = 0;
	const TAB_GAP = 10;
	const ARROW_WIDTH = 56;
	const TAB_BAR_WIDTH = DASH_WIDTH - 60;

	function showTab(id: string) {
		const tab = tabs.get(id);
		if (!tab) return;
		if (activeTab && activeTab !== id) tabs.get(activeTab)?.onHide?.();
		activeTab = id;
		// A tab opened from elsewhere (a shortcut, the code) is brought into view on the bar.
		const paging = tabBarPaging(tabs.list().length, TAB_BAR_WIDTH, { gap: TAB_GAP, arrowWidth: ARROW_WIDTH });
		const wanted = Math.floor(tabs.list().findIndex((other) => other.id === id) / paging.perPage);
		if (paging.paged && wanted !== tabPage) {
			tabPage = wanted;
			rebuildTabBar();
		}
		for (const other of tabs.list()) contentByTab[other.id].isVisible = other.id === id;
		for (const other of tabs.list()) styleTabButton(other.id);
		tab.onShow?.();
	}

	const tabParts = new Map<string, { icon: string | undefined; image: Image | null; label: TextBlock }>();

	function styleTabButton(id: string) {
		const button = tabButtons.get(id);
		const parts = tabParts.get(id);
		if (!button || !parts) return;
		const on = id === activeTab;
		const color = on ? THEME.text : THEME.muted;
		button.background = on ? THEME.accent : THEME.surface;
		parts.label.color = color;
		if (parts.image && parts.icon) parts.image.source = iconUri(parts.icon, color, TAB_ICON_SIZE * 2) ?? '';
	}

	/** Lays the buttons out again: all of them share the bar, narrowing (and at last keeping only their icons) as tabs are added. */
	function rebuildTabBar() {
		for (const child of [...tabsBar.children]) {
			tabsBar.removeControl(child);
			child.dispose();
		}
		tabButtons.clear();
		tabParts.clear();
		const all = tabs.list();
		const paging = tabBarPaging(all.length, TAB_BAR_WIDTH, { gap: TAB_GAP, arrowWidth: ARROW_WIDTH });
		tabPage = Math.min(Math.max(0, tabPage), paging.pages - 1);
		const list = paging.paged ? all.slice(tabPage * paging.perPage, (tabPage + 1) * paging.perPage) : all;
		const room = paging.paged ? TAB_BAR_WIDTH - 2 * (ARROW_WIDTH + TAB_GAP) : TAB_BAR_WIDTH;
		const { width, showLabels } = tabBarLayout(list.length, room, { gap: TAB_GAP, maxWidth: 150, minWidth: 64, labelWidth: 96 });
		const arrow = (name: string, text: string, step: number) => {
			const btn = Button.CreateSimpleButton(name, text);
			btn.width = `${ARROW_WIDTH}px`;
			btn.height = `${TAB_HEIGHT}px`;
			btn.cornerRadius = 16;
			btn.thickness = 0;
			btn.fontSize = 34;
			btn.color = THEME.text;
			btn.background = THEME.raised;
			btn.paddingLeft = btn.paddingRight = '4px';
			btn.onPointerClickObservable.add(() => {
				tabPage = (tabPage + step + paging.pages) % paging.pages;
				rebuildTabBar();
			});
			tabsBar.addControl(btn);
		};
		if (paging.paged) arrow('tabs-previous', '‹', -1);
		for (const tab of list) {
			const btn = new Button(`tab-${tab.id}`);
			btn.width = `${width}px`;
			btn.height = `${TAB_HEIGHT}px`;
			btn.cornerRadius = 16;
			btn.thickness = 0;
			btn.paddingLeft = '4px';
			btn.paddingRight = '4px';
			btn.onPointerClickObservable.add(() => {
				// A tab let go of after being dragged to a new place is not also opened.
				if (tabDrag?.moved) return;
				showTab(tab.id);
			});
			btn.onPointerDownObservable.add((at) => {
				tabDrag = { id: tab.id, startX: at.x, pointerId: null, moved: false, to: 0 };
			});

			// A big icon with the label under it; with no room for labels, the icon alone (or the label's start, for a tab without one).
			const hasIcon = tab.icon !== undefined && iconUri(tab.icon, '#000') !== undefined;
			const column = new StackPanel(`tab-${tab.id}-column`);
			column.isVertical = true;
			column.adaptHeightToChildren = true;
			column.isHitTestVisible = false;
			let image: Image | null = null;
			if (hasIcon) {
				image = new Image(`tab-${tab.id}-icon`, '');
				image.width = `${TAB_ICON_SIZE}px`; image.height = `${TAB_ICON_SIZE}px`;
				image.stretch = Image.STRETCH_UNIFORM;
				image.isHitTestVisible = false;
				column.addControl(image);
			}
			const text = showLabels || !hasIcon ? (showLabels ? tab.label : tab.label.slice(0, 2)) : '';
			const label = new TextBlock(`tab-${tab.id}-label`, text);
			label.fontSize = 20;
			label.height = text ? '28px' : '0px';
			label.textWrapping = false;
			label.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
			label.isHitTestVisible = false;
			column.addControl(label);
			btn.addControl(column);

			tabsBar.addControl(btn);
			tabButtons.set(tab.id, btn);
			tabParts.set(tab.id, { icon: tab.icon, image, label });
			styleTabButton(tab.id);
		}
		if (paging.paged) arrow('tabs-next', '›', 1);
	}

	function addTab(tab: DashTab): () => void {
		// A tab replacing one with its id gets a fresh page.
		if (contentByTab[tab.id]) {
			background.removeControl(contentByTab[tab.id]);
			contentByTab[tab.id].dispose();
		}
		const page = new Rectangle(`panel-${tab.id}`);
		page.width = 1;
		page.height = `${PAGE_HEIGHT}px`;
		page.thickness = 0;
		page.isVisible = false;
		background.addControl(page);
		contentByTab[tab.id] = page;
		tab.build(page);
		tabs.add(tab);
		if (activeTab === tab.id) page.isVisible = true;
		// The built-in tabs are opened once the whole panel is built, since opening one refreshes what is built after it.
		else if (!activeTab && ready) showTab(tab.id);
		return () => {
			if (tabs.get(tab.id) === tab) removeTab(tab.id);
		};
	}

	function removeTab(id: string) {
		if (!tabs.remove(id)) return;
		const page = contentByTab[id];
		if (page) {
			background.removeControl(page);
			page.dispose();
			delete contentByTab[id];
		}
		if (activeTab === id) {
			activeTab = '';
			const next = tabs.list()[0];
			if (next) showTab(next.id);
		}
	}

	tabs.onChange(rebuildTabBar);

	// --- Putting the tabs in the order wanted: press a tab and drag it along the bar ---
	interface TabDrag { id: string; startX: number; pointerId: number | null; moved: boolean; to: number }
	let tabDrag: TabDrag | null = null;
	const TAB_DRAG_THRESHOLD = 28;
	/** Where the dragged tab would be put: a thin bar between the tabs. */
	const tabMarker = new Rectangle('dash-tab-marker');
	tabMarker.width = '6px';
	tabMarker.height = `${TAB_HEIGHT}px`;
	tabMarker.background = THEME.glow;
	tabMarker.thickness = 0;
	tabMarker.cornerRadius = 3;
	tabMarker.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	tabMarker.isHitTestVisible = false;
	tabMarker.isVisible = false;
	tabsPanel.addControl(tabMarker);

	function finishTabDrag(commit: boolean): void {
		const done = tabDrag;
		tabDrag = null;
		tabMarker.isVisible = false;
		if (!done) return;
		const button = tabButtons.get(done.id);
		if (button) button.left = '0px';
		if (!done.moved || !commit) return;
		const shown = [...tabButtons.keys()];
		const all = tabs.list().map((tab) => tab.id);
		const merged = mergeShownOrder(all, shown, moveTab(shown, done.id, done.to));
		const order = orderToKeep(merged, tabs.getUserOrder());
		saveTabOrder(order);
		tabs.setUserOrder(order);
	}
	scene.onPointerObservable.add((info) => {
		if (!tabDrag) return;
		const pointerId = (info.event as PointerEvent).pointerId;
		if (info.type === PointerEventTypes.POINTERDOWN) {
			if (tabDrag.pointerId === null) tabDrag.pointerId = pointerId;
			return;
		}
		if (tabDrag.pointerId !== null && pointerId !== tabDrag.pointerId) return;
		if (info.type === PointerEventTypes.POINTERUP) {
			// The menu has already seen the release (and ignored the click on a tab that was dragged); this is the end of the drag.
			finishTabDrag(true);
			return;
		}
		if (info.type !== PointerEventTypes.POINTERMOVE || !info.pickInfo?.hit || info.pickInfo.pickedMesh !== mesh) return;
		const uv = info.pickInfo.getTextureCoordinates();
		if (!uv) return;
		const x = uv.x * DASH_WIDTH;
		if (!tabDrag.moved && Math.abs(x - tabDrag.startX) < TAB_DRAG_THRESHOLD) return;
		tabDrag.moved = true;
		const dragged = tabButtons.get(tabDrag.id);
		if (!dragged) return;
		dragged.left = `${x - tabDrag.startX}px`;
		// Among the other tabs, where it would go: after as many of them as are left of the pointer.
		const others = [...tabButtons].filter(([id]) => id !== tabDrag!.id).map(([, button]) => button);
		const before = others.filter((button) => button.centerX < x).length;
		tabDrag.to = before;
		const edge = before === 0 ? (others[0]?.centerX ?? x) - (others[0]?._currentMeasure.width ?? 0) / 2 - 4 : others[before - 1].centerX + others[before - 1]._currentMeasure.width / 2 + 4;
		tabMarker.left = `${edge - 3}px`;
		tabMarker.isVisible = true;
	});

	// The built-in tabs. Each builds its page below, where the rest of its code lives; `onShow` refreshes it.
	const BUILTIN_TABS: Array<Omit<DashTab, 'build'>> = [
		{ id: 'home', label: 'Home', icon: 'house', order: 0, onShow: () => refreshHomeTab() },
		{ id: 'session', label: 'Session', icon: 'users', order: 10, onShow: () => void refreshWorldsTab() },
		{ id: 'worlds', label: 'Worlds', icon: 'globe', order: 20, onShow: () => void refreshWorldsTab() },
		{ id: 'inventory', label: 'Inventory', icon: 'backpack', order: 30, onShow: () => refreshInventoryTab() },
		// The keyboard's own layout key changes a setting too: show what is chosen now.
		{ id: 'settings', label: 'Settings', icon: 'settings', order: 40, onShow: () => refreshSettingsTab() },
		{ id: 'account', label: 'Account', icon: 'user', order: 50 }
	];
	// An app can turn tabs off (see `EngineFeatures`). A tab that is off still gets its page, so the code below that fills it
	// needs no special cases, but the page is never shown and the tab is not on the bar.
	const enabledTabs: Record<string, boolean> = {
		home: features.homeTab, session: features.sessionTab, worlds: features.worldsTab,
		inventory: features.inventoryTab, settings: features.settingsTab, account: features.accountTab
	};
	for (const tab of BUILTIN_TABS) {
		if (enabledTabs[tab.id]) addTab({ ...tab, build: () => {} });
		else contentByTab[tab.id] = new Rectangle(`panel-${tab.id}-off`);
	}

	// --- Home tab: a grid of shortcuts and pieces of UI the player took out of worlds ---
	function setSeatedMode(enabled: boolean) {
		xrSettings.seatedMode = enabled;
		saveSettings();
		callbacks.onSeatedModeChanged();
		refreshHomeTab();
		refreshSettingsTab();
	}

	const scriptSystem = createScriptSystem(scene, () => ({ role: gameState.role, roomCode: gameState.roomCode, worldName: gameState.worldName }));
	// The pieces of UI run in a scene graph of their own and are drawn in the dash's picture (see dashWidgetHost.ts).
	const widgets = createWidgetRuntime(scene, {
		graph: { getUiContext: callbacks.getUiContext, getPlayers: callbacks.getPlayers, openDash: (tab) => showTab(tab) },
		system: scriptSystem,
		settings: {
			get: (key) => (key === 'masterVolume' ? xrSettings.masterVolume : null),
			set(key, value) {
				if (key !== 'masterVolume') return false;
				xrSettings.masterVolume = Math.min(1, Math.max(0, value));
				saveSettings();
				callbacks.onAudioSettingsChanged();
				refreshSettingsTab();
				return true;
			}
		},
		tabs: {
			add: (id, spec) => {
				const remove = addTab({ id, label: spec.label, icon: spec.icon, order: spec.order ?? 100, build: () => {} });
				return { page: contentByTab[id], remove };
			},
			show: (id) => showTab(id)
		},
		pageSize: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
		pageNear: () => mesh
	});
	// Any UI panel may hold a grid (a `grid` element): the same machinery, wherever it is.
	setGridService({ mount: (options) => { const view = createGridView({ ...options, runtime: widgets }); return { dispose: () => view.dispose() }; } });
	// Home is the first of them: its grid is the game's shortcuts and whatever the player has put there.
	const homeGrid = createGridView({
		container: contentByTab.home,
		size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
		gridId: 'home',
		title: 'Home',
		runtime: widgets,
		actions: {
			seatedOn: () => xrSettings.seatedMode,
			toggleSeated: () => setSeatedMode(!xrSettings.seatedMode),
			toggleInspector: callbacks.onToggleInspector ? () => callbacks.onToggleInspector?.() : undefined,
			exitVr: () => void callbacks.onExitVr()
		}
	});
	function refreshHomeTab() {
		homeGrid.refresh();
	}
	// The menu is a unit plane scaled to size that may be bent: how its picture is read from a point of the world.
	setPanelSurfaceInfo(mesh, { unit: true, curve: () => (xrSettings.dashCurve * Math.PI) / 180 });

	// --- Session tab (current session / hosting) ---
	const sessionColumn = createScrollColumn('session', { top: 10, height: 500 });
	contentByTab.session.addControl(sessionColumn.scroll);
	const sessionList = sessionColumn.list;

	// --- Worlds tab (official, active and published worlds to go to) ---
	const worldsBrowser = createWorldsBrowser(contentByTab.worlds, sceneGraph, {
		onJoinWorld: async (roomCode) => { await callbacks.onJoinWorld(roomCode); void refreshWorldsTab(); },
		onSpawnPublishedWorld: callbacks.onSpawnPublishedWorld,
		onLaunchPublishedWorld: callbacks.onLaunchPublishedWorld,
		onLaunchBuiltinWorld: callbacks.onLaunchBuiltinWorld,
		onCreateWorld: callbacks.onCreateWorld
	}, mesh);


	// Cards of one width, like the settings: where this session stands, how to share the world, and saving it.
	const SESSION_WIDTH = sessionColumn.width;

	function sessionHeading(title: string): TextBlock {
		const heading = new TextBlock(`session-heading-${title}`, title);
		heading.width = `${SESSION_WIDTH}px`;
		heading.height = '56px';
		heading.paddingTop = '18px';
		heading.fontSize = 22;
		heading.fontWeight = 'bold';
		heading.color = THEME.text;
		heading.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		return heading;
	}

	const sessionCard = (name: string, height: number) => createCard(name, SESSION_WIDTH, height);

	function cardText(card: Rectangle, name: string, text: string, left: number, top: number, width: number, height: number, size: number, color: string): TextBlock {
		const block = new TextBlock(name, text);
		block.fontSize = size; block.color = color;
		block.textWrapping = true;
		placeText(card, block, left, top, width, height);
		return block;
	}

	// Where this session stands: alone, hosting (with the room code to give out) or visiting.
	const statusCard = sessionCard('session-status', 140);
	sessionList.addControl(statusCard);
	const statusDot = new Rectangle('session-status-dot');
	statusDot.width = statusDot.height = '16px';
	statusDot.cornerRadius = 8; statusDot.thickness = 0;
	statusDot.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	statusDot.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
	statusDot.left = '24px'; statusDot.top = '26px';
	statusCard.addControl(statusDot);
	const statusTitle = cardText(statusCard, 'session-status-title', '', 54, 18, 560, 34, 24, THEME.text);
	statusTitle.fontWeight = 'bold';
	const statusDetail = cardText(statusCard, 'session-status-detail', '', 54, 58, 560, 60, 16, THEME.muted);

	const codeCaption = new TextBlock('session-code-caption', 'ROOM CODE');
	codeCaption.fontSize = 13; codeCaption.color = THEME.muted;
	codeCaption.width = '280px'; codeCaption.height = '20px'; codeCaption.top = '16px'; codeCaption.left = '-24px';
	codeCaption.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
	codeCaption.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
	codeCaption.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
	codeCaption.isHitTestVisible = false;
	statusCard.addControl(codeCaption);
	const codeText = new TextBlock('session-code', '');
	codeText.fontSize = 38; codeText.fontWeight = 'bold'; codeText.color = THEME.glow;
	codeText.width = '280px'; codeText.height = '48px'; codeText.top = '36px'; codeText.left = '-24px';
	codeText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
	codeText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
	codeText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
	codeText.isHitTestVisible = false;
	statusCard.addControl(codeText);

	const stopHostingBtn = Button.CreateSimpleButton('stop-hosting-btn', 'Stop hosting');
	stopHostingBtn.width = '180px'; stopHostingBtn.height = '40px';
	stopHostingBtn.fontSize = 17;
	stopHostingBtn.color = THEME.text; stopHostingBtn.background = THEME.danger;
	stopHostingBtn.cornerRadius = 10; stopHostingBtn.thickness = 0;
	stopHostingBtn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
	stopHostingBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
	stopHostingBtn.left = '-24px'; stopHostingBtn.top = '-16px';
	stopHostingBtn.onPointerClickObservable.add(async () => {
		stopHostingBtn.isEnabled = false;
		setSessionNotice('Closing the session…');
		try {
			await callbacks.onStopHosting();
			setSessionNotice('');
			refreshWorldsTab();
		} catch (err) {
			setSessionNotice(err instanceof Error ? err.message : 'Could not close the session', 'error');
			stopHostingBtn.isEnabled = true;
		}
	});
	statusCard.addControl(stopHostingBtn);

	// Playing alone, the way to open the world up is this button: the choices of who can join show only once it is pressed.
	let inviteOpen = false;
	const inviteBtn = Button.CreateSimpleButton('invite-btn', 'Invite people');
	inviteBtn.width = '200px'; inviteBtn.height = '44px';
	inviteBtn.fontSize = 19;
	inviteBtn.color = THEME.text; inviteBtn.background = THEME.accent;
	inviteBtn.cornerRadius = 10; inviteBtn.thickness = 0;
	inviteBtn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
	inviteBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
	inviteBtn.left = '-24px';
	inviteBtn.onPointerClickObservable.add(() => {
		inviteOpen = !inviteOpen;
		setSessionNotice('');
		void refreshWorldsTab();
	});
	statusCard.addControl(inviteBtn);

	// What went wrong (or is going on), under the status: takes no room while there is nothing to say.
	const sessionNotice = new TextBlock('session-notice', '');
	sessionNotice.width = `${SESSION_WIDTH}px`;
	sessionNotice.height = '0px';
	sessionNotice.fontSize = 17;
	sessionNotice.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	sessionNotice.paddingLeft = '8px';
	sessionList.addControl(sessionNotice);
	function setSessionNotice(text: string, tone: 'info' | 'error' = 'info') {
		sessionNotice.text = text;
		sessionNotice.color = tone === 'error' ? THEME.error : THEME.glow;
		sessionNotice.height = text ? '38px' : '0px';
	}

	// Inviting: how open the hosted session is. Each option is a card.
	const shareHeading = sessionHeading('Who can join?');
	sessionList.addControl(shareHeading);
	const shareCards: Rectangle[] = [];

	function addShareOption(visibility: HostedWorldVisibility) {
		const info = WORLD_VISIBILITY_INFO[visibility];
		const card = sessionCard(`world-visibility-${visibility}`, 86);
		card.height = '86px';
		card.isPointerBlocker = true;
		card.hoverCursor = 'pointer';
		cardText(card, `world-visibility-${visibility}-title`, info.label, 24, 14, 560, 30, 21, THEME.text);
		cardText(card, `world-visibility-${visibility}-about`, info.description, 24, 44, 640, 26, 16, THEME.muted);
		const action = new TextBlock(`world-visibility-${visibility}-action`, 'Host  ›');
		action.width = '160px'; action.height = '30px'; action.fontSize = 19;
		action.color = THEME.accentBorder;
		action.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
		action.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
		action.left = '-24px';
		action.isHitTestVisible = false;
		card.addControl(action);
		card.onPointerEnterObservable.add(() => { if (card.isEnabled) card.background = THEME.surfaceHover; });
		card.onPointerOutObservable.add(() => { card.background = THEME.surface; });
		card.onPointerClickObservable.add(async () => {
			if (!card.isEnabled) return;
			if (!gameState.userId && visibility !== 'private') {
				setSessionNotice('Sign in (Account tab) to host a friends or public session.', 'error');
				return;
			}
			for (const other of shareCards) other.isEnabled = false;
			action.text = 'Starting…';
			setSessionNotice('');
			try {
				await callbacks.onHostWorld(visibility);
				refreshWorldsTab();
			} catch (err) {
				setSessionNotice(err instanceof Error ? err.message : 'Could not host the world', 'error');
			} finally {
				for (const other of shareCards) other.isEnabled = true;
				action.text = 'Host  ›';
			}
		});
		shareCards.push(card);
		sessionList.addControl(card);
	}
	addShareOption('private');
	addShareOption('friends');
	addShareOption('friends-plus');
	addShareOption('public');

	// Saving the running scene as a world. A world loaded from the inventory gets a new revision in its own
	// lineage (revisions are immutable), not a new world.
	const saveHeading = sessionHeading('Save this world');
	sessionList.addControl(saveHeading);
	const saveCard = sessionCard('save-world-card', 156);
	sessionList.addControl(saveCard);
	const saveAbout = cardText(saveCard, 'save-world-about', 'Keeps a copy in your inventory.', 24, 14, 880, 26, 17, THEME.muted);
	const worldNameInput = new InputText('world-name-input');
	worldNameInput.width = '330px'; worldNameInput.height = '48px';
	worldNameInput.fontSize = 19;
	worldNameInput.color = THEME.text; worldNameInput.background = THEME.ink; worldNameInput.focusedBackground = THEME.accentSoft;
	worldNameInput.thickness = 1;
	worldNameInput.placeholderText = 'World name'; worldNameInput.text = 'My World';
	worldNameInput.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	worldNameInput.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
	worldNameInput.left = '24px'; worldNameInput.top = '52px';
	saveCard.addControl(worldNameInput);
	const saveWorldBtn = Button.CreateSimpleButton('save-world-btn', 'Save world');
	saveWorldBtn.width = '230px'; saveWorldBtn.height = '48px'; saveWorldBtn.fontSize = 19;
	saveWorldBtn.color = THEME.text; saveWorldBtn.background = THEME.accent; saveWorldBtn.cornerRadius = 10; saveWorldBtn.thickness = 0;
	saveWorldBtn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	saveWorldBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
	saveWorldBtn.left = '370px'; saveWorldBtn.top = '52px';
	saveCard.addControl(saveWorldBtn);
	const saveAsNewBtn = Button.CreateSimpleButton('save-world-new-btn', 'Save as new world');
	saveAsNewBtn.width = '250px'; saveAsNewBtn.height = '48px'; saveAsNewBtn.fontSize = 19;
	saveAsNewBtn.color = THEME.text; saveAsNewBtn.background = THEME.raised; saveAsNewBtn.cornerRadius = 10; saveAsNewBtn.thickness = 0;
	saveAsNewBtn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	saveAsNewBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
	saveAsNewBtn.left = '612px'; saveAsNewBtn.top = '52px';
	saveCard.addControl(saveAsNewBtn);
	const saveWorldStatus = cardText(saveCard, 'save-world-status', '', 24, 112, 880, 26, 16, THEME.mint);
	let shownLoadedKey: string | null = null;

	function refreshSaveWorld() {
		const loaded = gameState.loadedWorld;
		const canSave = gameState.role !== 'guest';
		saveHeading.isVisible = saveCard.isVisible = canSave;
		saveAsNewBtn.isVisible = loaded !== null;
		const key = loaded ? `${loaded.adapterId}:${loaded.worldLineageId}` : null;
		if (key !== shownLoadedKey) {
			shownLoadedKey = key;
			worldNameInput.text = loaded?.name ?? gameState.worldName ?? 'My World';
		}
		const revises = loaded !== null && getInventoryAdapter(loaded.adapterId)?.saveItem !== undefined;
		saveAbout.text = revises ? `Saves a new revision (v${(loaded.revisionNumber ?? 0) + 1}) of “${loaded.name}”.` : 'Keeps a copy in your inventory.';
		const button = saveWorldBtn.textBlock;
		if (button) button.text = revises ? `Save as v${(loaded.revisionNumber ?? 0) + 1}` : 'Save world';
	}

	async function saveWorld(asNew: boolean) {
		const loaded = asNew ? null : gameState.loadedWorld;
		const selected = getInventoryAdapter(loaded?.adapterId ?? gameState.currentInventoryAdapterId ?? 'local');
		const adapter = selected?.isAvailable(getInventoryContext()) && selected.saveItem && canHoldWorlds(selected.id) ? selected : getInventoryAdapter('local');
		if (!adapter) { saveWorldStatus.color = THEME.error; saveWorldStatus.text = 'No inventory is available'; return; }
		const folderId = loaded && loaded.adapterId === adapter.id ? loaded.folderId
			: adapter.id === gameState.currentInventoryAdapterId ? gameState.currentInventoryFolderId : null;
		const name = worldNameInput.text.trim() || 'My World';
		saveWorldBtn.isEnabled = saveAsNewBtn.isEnabled = false;
		try {
			const snapshot = sceneGraph.serialize({ withoutAvatars: true });
			validateWorldScene(snapshot);
			const lineage = loaded && loaded.adapterId === adapter.id ? loaded.worldLineageId : undefined;
			if (!adapter.saveItem || !canHoldWorlds(adapter.id)) throw new Error('Worlds cannot be saved in this inventory');
			saveWorldStatus.color = THEME.muted;
			saveWorldStatus.text = 'Saving…';
			const saved = await saveWithPreview(adapter, getInventoryContext(), folderId, name, snapshot, 'world', lineage);
			if (saved.worldLineageId) {
				gameState.loadedWorld = { adapterId: adapter.id, worldLineageId: saved.worldLineageId, folderId: saved.folderId, name: saved.name, revisionNumber: saved.revisionNumber ?? null };
			}
			saveWorldStatus.color = THEME.mint;
			saveWorldStatus.text = lineage ? `Saved revision v${saved.revisionNumber ?? '?'} in ${adapter.label}.` : `Saved to ${adapter.label}.`;
		} catch (error) {
			saveWorldStatus.color = THEME.error;
			saveWorldStatus.text = error instanceof Error ? error.message : 'Could not save world';
		} finally {
			saveWorldBtn.isEnabled = saveAsNewBtn.isEnabled = true;
			refreshSaveWorld();
			if (activeTab === 'inventory') refreshInventoryTab();
		}
	}
	saveWorldBtn.onPointerClickObservable.add(() => void saveWorld(false));
	saveAsNewBtn.onPointerClickObservable.add(() => void saveWorld(true));

	async function refreshWorldsTab() {
		// Nothing shows the sessions or the worlds, so there is nothing to ask the platform for.
		if (!tabs.has('session') && !tabs.has('worlds')) return;
		refreshSaveWorld();
		const hosting = gameState.role === 'host';
		const visiting = gameState.role === 'guest';
		const connected = hosting || visiting;
		if (connected) inviteOpen = false;
		const showOptions = !connected && inviteOpen;
		shareHeading.isVisible = showOptions;
		for (const card of shareCards) card.isVisible = showOptions;
		stopHostingBtn.isVisible = hosting;
		inviteBtn.isVisible = !connected;
		inviteBtn.textBlock!.text = inviteOpen ? 'Hide options' : 'Invite people';
		inviteBtn.background = inviteOpen ? THEME.raised : THEME.accent;
		codeCaption.isVisible = codeText.isVisible = connected;
		statusDot.background = connected ? THEME.mint : THEME.dim;
		const worldName = gameState.worldName ?? 'This world';
		if (hosting) {
			const visibility = gameState.worldVisibility ? WORLD_VISIBILITY_INFO[gameState.worldVisibility].label : 'Hosted';
			const startedAt = gameState.sessionStartedAt
				? new Date(gameState.sessionStartedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
				: null;
			statusTitle.text = `Hosting · ${visibility}`;
			statusDetail.text = `${worldName}${startedAt ? ` · since ${startedAt}` : ''}\nGive the room code to whoever should join.`;
		} else if (visiting) {
			statusTitle.text = 'Visiting a session';
			statusDetail.text = 'You are in someone else’s world. Its host decides how long it stays open.';
		} else {
			statusTitle.text = 'Playing solo';
			statusDetail.text = `${worldName} is only on your device. Invite people to let others join.`;
		}
		codeText.text = gameState.roomCode ?? '—';
		// The Worlds tab lists its own category; only reload it while it is the one on screen.
		if (activeTab === 'worlds') await worldsBrowser.refresh();
	}


	// --- Inventory tab -------------------------------------------------------
	// Two compact rows above the grid:
	//   1. source switcher (segmented control)            usage bar
	//   2. breadcrumb                       contextual actions (+ Folder / selection)
	// Single click selects a cell, double click opens a folder or spawns an item.
	const INV = {
		bg: THEME.ink, surface: THEME.surface, surfaceHover: THEME.surfaceHover, border: THEME.border,
		text: THEME.text, muted: THEME.muted, accent: THEME.accent, accentSoft: THEME.accentSoft, accentBorder: THEME.accentBorder,
		danger: THEME.danger, ok: THEME.mint, warn: THEME.glow, error: THEME.error
	};
	const KIND_STYLE = {
		folder: { icon: 'folder', tint: '#3a2615' },
		object: { icon: 'box', tint: '#1d2b3a' },
		world: { icon: 'globe', tint: '#2a2550' }
	} as const;
	const CELL_W = 156;
	const CELL_GAP = 6;
	/** The square picture of a cell (the cell's width less the gap that follows it), and the room for its name below. */
	const TILE = CELL_W - CELL_GAP;
	const LABEL_H = 38;
	const CELL_H = TILE + 6 + LABEL_H;
	const SIDE_MARGIN_PX = 20;
	/** As many columns as the page holds, so the grid fills the page it is on. */
	const GRID_COLUMNS = Math.max(1, Math.floor((PAGE_WIDTH - 2 * SIDE_MARGIN_PX - 16) / (CELL_W + CELL_GAP)));
	const DOUBLE_CLICK_MS = 400;
	const SIDE_MARGIN = SIDE_MARGIN_PX;

	function place<T extends Control>(control: T, top: number, side: 'left' | 'right'): T {
		control.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		control.top = `${top}px`;
		control.horizontalAlignment = side === 'left' ? Control.HORIZONTAL_ALIGNMENT_LEFT : Control.HORIZONTAL_ALIGNMENT_RIGHT;
		control.left = side === 'left' ? `${SIDE_MARGIN}px` : `${-SIDE_MARGIN}px`;
		return control;
	}

	// Row 1: source switcher + usage bar.
	const inventoryRootsFrame = place(new Rectangle('inventory-roots-frame'), 8, 'left');
	inventoryRootsFrame.height = '44px';
	inventoryRootsFrame.adaptWidthToChildren = true;
	inventoryRootsFrame.background = INV.bg;
	inventoryRootsFrame.thickness = 1;
	inventoryRootsFrame.color = INV.border;
	inventoryRootsFrame.cornerRadius = 12;
	contentByTab.inventory.addControl(inventoryRootsFrame);
	const inventoryRoots = new StackPanel('inventory-roots');
	inventoryRoots.isVertical = false;
	inventoryRoots.height = '44px';
	inventoryRoots.adaptWidthToChildren = true;
	inventoryRootsFrame.addControl(inventoryRoots);

	const quotaGroup = place(new StackPanel('inventory-quota-group'), 8, 'right');
	quotaGroup.isVertical = true;
	quotaGroup.width = '300px';
	quotaGroup.height = '44px';
	quotaGroup.isVisible = false;
	contentByTab.inventory.addControl(quotaGroup);
	const quotaCaption = new TextBlock('inventory-quota-caption', 'Storage');
	quotaCaption.height = '20px';
	quotaCaption.fontSize = 14;
	quotaCaption.color = INV.muted;
	quotaCaption.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
	quotaGroup.addControl(quotaCaption);
	const quotaTrack = new Rectangle('inventory-quota-track');
	quotaTrack.height = '10px';
	quotaTrack.width = 1;
	quotaTrack.paddingTop = '4px';
	quotaTrack.thickness = 0;
	quotaTrack.background = INV.surface;
	quotaTrack.cornerRadius = 5;
	quotaGroup.addControl(quotaTrack);
	const quotaFill = new Rectangle('inventory-quota-fill');
	quotaFill.height = 1;
	quotaFill.width = 0;
	quotaFill.thickness = 0;
	quotaFill.cornerRadius = 5;
	quotaFill.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	quotaTrack.addControl(quotaFill);

	// Row 2: breadcrumb (left) and contextual actions (right).
	const inventoryPath = place(new StackPanel('inventory-path'), 60, 'left');
	inventoryPath.isVertical = false;
	inventoryPath.height = '40px';
	inventoryPath.adaptWidthToChildren = true;
	contentByTab.inventory.addControl(inventoryPath);

	const inventoryToolbar = place(new StackPanel('inventory-toolbar'), 60, 'right');
	inventoryToolbar.isVertical = false;
	inventoryToolbar.height = '40px';
	inventoryToolbar.adaptWidthToChildren = true;
	contentByTab.inventory.addControl(inventoryToolbar);

	function actionButton(name: string, text: string, background: string, width: number, onClick: () => void): Button {
		const btn = Button.CreateSimpleButton(name, text);
		btn.width = `${width}px`;
		btn.height = '36px';
		btn.color = INV.text;
		btn.background = background;
		btn.thickness = 0;
		btn.cornerRadius = 10;
		btn.paddingLeft = '4px';
		btn.fontSize = 16;
		btn.onPointerClickObservable.add(onClick);
		return btn;
	}

	const newFolderBtn = actionButton('new-folder-btn', '＋ Folder', INV.surface, 110, async () => {
		if (!activeAdapter?.createFolder) return;
		await activeAdapter.createFolder(getInventoryContext(), currentFolderId(), `Folder ${new Date().toLocaleTimeString()}`);
		refreshList();
	});

	// The grid, with a toast pinned over its bottom edge for feedback.
	const inventoryScroll = place(new ScrollViewer('inventory-scroll'), 108, 'left');
	inventoryScroll.width = `${GRID_COLUMNS * (CELL_W + CELL_GAP) + 16}px`;
	inventoryScroll.height = '404px';
	inventoryScroll.barColor = INV.accent;
	inventoryScroll.barBackground = INV.bg;
	inventoryScroll.barSize = 8;
	inventoryScroll.thickness = 0;
	contentByTab.inventory.addControl(inventoryScroll);
	const inventoryList = new StackPanel('inventory-list');
	inventoryList.width = 1;
	inventoryScroll.addControl(inventoryList);

	const toast = new Rectangle('inventory-toast');
	toast.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
	toast.top = '-14px';
	toast.width = '560px';
	toast.height = '40px';
	toast.background = '#020617';
	toast.thickness = 1;
	toast.cornerRadius = 20;
	toast.isVisible = false;
	toast.isPointerBlocker = false;
	contentByTab.inventory.addControl(toast);
	const toastText = new TextBlock('inventory-toast-text', '');
	toastText.fontSize = 16;
	toastText.color = INV.text;
	toast.addControl(toastText);
	let toastTimer: ReturnType<typeof setTimeout> | undefined;

	function showMessage(text: string, tone: 'ok' | 'error' | 'info' = 'info') {
		toastText.text = text;
		toast.color = tone === 'ok' ? INV.ok : tone === 'error' ? INV.error : INV.border;
		toast.isVisible = true;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => { toast.isVisible = false; }, 3500);
	}

	let activeAdapter: InventoryAdapter | null = null;
	// breadcrumb: [{id: null, name: adapter.label}, ...subfolders]
	let path: { id: string | null; name: string }[] = [];

	type Entry =
		| { type: 'folder'; id: string; name: string; folder: InventoryFolder }
		| { type: 'item'; id: string; name: string; item: InventoryItem };
	let selected: Entry | null = null;
	/** The entry being moved: the player browses to the destination folder and presses "Move here". */
	let moving: { entry: Entry; fromFolderId: string | null } | null = null;
	const cellByKey = new Map<string, Rectangle>();
	let lastClick = { key: '', at: 0 };

	function currentFolderId(): string | null {
		return path.length > 0 ? path[path.length - 1].id : null;
	}

	function entryKey(entry: Entry): string {
		return `${entry.type}:${entry.id}`;
	}

	function paintCell(key: string, cell: Rectangle, hovered = false) {
		const isSelected = selected !== null && key === entryKey(selected);
		cell.background = isSelected ? INV.accentSoft : hovered ? INV.surfaceHover : INV.surface;
		cell.color = isSelected ? INV.accentBorder : INV.border;
		cell.thickness = isSelected ? 2 : 1;
	}

	function select(entry: Entry | null) {
		selected = entry;
		for (const [key, cell] of cellByKey) paintCell(key, cell);
		refreshToolbar();
	}

	function activate(entry: Entry) {
		const adapter = activeAdapter;
		if (!adapter) return;
		if (entry.type === 'folder') {
			path = [...path, { id: entry.id, name: entry.name }];
			gameState.currentInventoryFolderId = entry.id;
			selected = null;
			refreshPath();
			refreshToolbar();
			refreshList();
		} else if (entry.item.kind === 'world') {
			if (!canHoldWorlds(adapter.id)) return;
			callbacks.onSpawnWorldOrb(entry.item, adapter.id);
			showMessage(`Placed “${entry.name}” as a world orb`, 'ok');
		} else if (entry.item.kind === 'avatar') {
			void wearAvatar(entry.item);
		} else {
			callbacks.onSpawnItem(entry.item.slotData);
		}
	}

	function isWornAvatar(item: InventoryItem): boolean {
		return !!activeAdapter && xrSettings.defaultAvatarSource === `${activeAdapter.id}:${item.id}`;
	}

	async function wearAvatar(item: InventoryItem) {
		try {
			await callbacks.onWearAvatar(item);
			showMessage(`Wearing “${item.name}” for this session`, 'ok');
		} catch (error) { showMessage(error instanceof Error ? error.message : 'Could not use this avatar', 'error'); }
	}

	async function setDefaultAvatar(item: InventoryItem) {
		if (!activeAdapter) return;
		try {
			await callbacks.onSetDefaultAvatar(item, activeAdapter.id);
			showMessage(`Now wearing “${item.name}”`, 'ok');
		} catch (error) { showMessage(error instanceof Error ? error.message : 'Could not use this avatar', 'error'); }
		refreshToolbar();
	}

	async function unsetDefaultAvatar() {
		try {
			await callbacks.onUnsetDefaultAvatar();
			showMessage('Back to the original avatar', 'ok');
		} catch (error) { showMessage(error instanceof Error ? error.message : 'Could not change the avatar', 'error'); }
		refreshToolbar();
	}

	/** Asks for a new name with the in-world keyboard (the browser's own prompt outside a headset). */
	function askName(current: string): Promise<string | null> {
		return new Promise((resolve) => {
			let answered = false;
			const finish = (text: string | null) => {
				if (answered) return;
				answered = true;
				resolve(text !== null && text.trim() && text.trim() !== current ? text.trim() : null);
			};
			const session = requestTextInput(
				{ title: 'Name', initial: current, near: mesh },
				{ onSubmit: (text) => finish(text), onClose: () => finish(null) }
			);
			if (!session) askNameOnPage(current).then(finish);
		});
	}

	/** Outside a headset session there is no in-world keyboard: a small field over the page takes the name (`prompt()` is missing in some browsers). */
	function askNameOnPage(current: string): Promise<string | null> {
		return new Promise((resolve) => {
			if (typeof document === 'undefined') { resolve(null); return; }
			const form = document.createElement('form');
			form.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#0008;z-index:2147483647';
			const input = document.createElement('input');
			input.value = current;
			input.maxLength = 120;
			input.style.cssText = `width:min(420px,80vw);padding:12px 14px;font:20px sans-serif;border-radius:10px;border:2px solid ${INV.accentBorder};background:${INV.bg};color:${INV.text}`;
			form.append(input);
			const done = (value: string | null) => { form.remove(); resolve(value); };
			form.addEventListener('submit', (event) => { event.preventDefault(); done(input.value); });
			form.addEventListener('keydown', (event) => { if (event.key === 'Escape') done(null); });
			form.addEventListener('pointerdown', (event) => { if (event.target === form) done(null); });
			document.body.append(form);
			input.focus();
			input.select();
		});
	}

	async function renameEntry(entry: Entry) {
		const adapter = activeAdapter;
		if (!adapter) return;
		const name = await askName(entry.name);
		if (!name || adapter !== activeAdapter) return;
		try {
			if (entry.type === 'folder') await adapter.updateFolder!(getInventoryContext(), entry.id, { name });
			else await adapter.updateItemInfo!(getInventoryContext(), entry.id, { name });
			select(null);
			void refreshList();
		} catch (error) { showMessage(error instanceof Error ? error.message : 'Could not rename', 'error'); }
	}

	/** Cloud only: flips whether anyone with the link may read the entry (a public folder covers everything inside it). */
	async function toggleVisibility(entry: Entry) {
		const adapter = activeAdapter;
		if (!adapter) return;
		const visibility = (entry.type === 'folder' ? entry.folder.visibility : entry.item.visibility) === 'public' ? 'private' : 'public';
		try {
			if (entry.type === 'folder') await adapter.updateFolder!(getInventoryContext(), entry.id, { visibility });
			else await adapter.updateItemInfo!(getInventoryContext(), entry.id, { visibility });
			showMessage(visibility === 'public' ? `“${entry.name}” is public: anyone with its link can load it` : `“${entry.name}” is private again`, 'ok');
			select(null);
			void refreshList();
		} catch (error) { showMessage(error instanceof Error ? error.message : 'Could not change visibility', 'error'); }
	}

	function startMove(entry: Entry) {
		moving = { entry, fromFolderId: currentFolderId() };
		select(null);
		showMessage(`Open the destination folder, then press Move here`, 'info');
	}

	/** Why the entry being moved cannot go to the folder on screen, or null when it can. */
	function moveBlocked(): string | null {
		if (!moving) return null;
		const target = currentFolderId();
		if (target === moving.fromFolderId) return 'Already here';
		if (moving.entry.type === 'folder' && path.some((crumb) => crumb.id === moving!.entry.id)) return 'Cannot go inside itself';
		return null;
	}

	async function finishMove() {
		const adapter = activeAdapter;
		const current = moving;
		if (!adapter || !current || moveBlocked()) return;
		const target = currentFolderId();
		try {
			if (current.entry.type === 'folder') await adapter.updateFolder!(getInventoryContext(), current.entry.id, { parentId: target });
			else await adapter.updateItemInfo!(getInventoryContext(), current.entry.id, { folderId: target });
			moving = null;
			showMessage(`Moved “${current.entry.name}”`, 'ok');
			select(null);
			void refreshList();
		} catch (error) { showMessage(error instanceof Error ? error.message : 'Could not move', 'error'); }
	}

	function refreshToolbar() {
		for (const child of [...inventoryToolbar.children]) inventoryToolbar.removeControl(child);
		const adapter = activeAdapter;
		const entry = selected;
		if (!adapter) return;
		if (adapter.connect) inventoryToolbar.addControl(actionButton('tb-connect', 'Choose folder', INV.surface, 160, async () => {
			try { await adapter.connect!(true); path = [{ id: null, name: adapter.label }]; select(null); refreshPath(); await refreshList(); }
			catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) showMessage(error instanceof Error ? error.message : 'Could not open folder', 'error'); }
		}));
		if (moving) {
			const blocked = moveBlocked();
			const hint = new TextBlock('tb-move-hint', blocked ?? `Move “${moving.entry.name.length > 14 ? `${moving.entry.name.slice(0, 13)}…` : moving.entry.name}” here`);
			hint.width = '300px'; hint.height = '36px'; hint.fontSize = 16; hint.color = INV.muted;
			inventoryToolbar.addControl(hint);
			if (!blocked) inventoryToolbar.addControl(actionButton('tb-move-here', 'Move here', INV.accent, 130, () => void finishMove()));
			inventoryToolbar.addControl(actionButton('tb-move-cancel', 'Cancel', INV.surface, 100, () => { moving = null; refreshToolbar(); }));
			return;
		}
		if (!entry) {
			if (adapter.createFolder) inventoryToolbar.addControl(newFolderBtn);
			return;
		}

		if (entry.type === 'folder') {
			inventoryToolbar.addControl(actionButton('tb-open', 'Open', INV.accent, 90, () => activate(entry)));
			if (adapter.updateFolder) {
				inventoryToolbar.addControl(actionButton('tb-rename', 'Rename', INV.surface, 100, () => void renameEntry(entry)));
				inventoryToolbar.addControl(actionButton('tb-move', 'Move', INV.surface, 84, () => startMove(entry)));
				if (adapter.id === 'cloud') inventoryToolbar.addControl(actionButton('tb-visibility', entry.folder.visibility === 'public' ? 'Make private' : 'Make public', INV.surface, 130, () => void toggleVisibility(entry)));
			}
			if (adapter.deleteFolder) inventoryToolbar.addControl(actionButton('tb-delete', 'Delete', INV.danger, 100, async () => {
				await adapter.deleteFolder!(getInventoryContext(), entry.id);
				select(null);
				refreshList();
			}));
		} else {
			const item = entry.item;
			const isWorld = item.kind === 'world';
			const isAvatar = item.kind === 'avatar';
			if (isAvatar) inventoryToolbar.addControl(isWornAvatar(item)
				? actionButton('tb-unset-avatar', 'Unset', INV.surface, 110, () => void unsetDefaultAvatar())
				: actionButton('tb-set-avatar', 'Set as default', INV.accent, 150, () => void setDefaultAvatar(item)));
			else inventoryToolbar.addControl(actionButton('tb-spawn', isWorld ? 'Place orb' : 'Spawn', INV.accent, isWorld ? 116 : 94, () => activate(entry)));
			if (!isWorld && gameState.userId && !isReadOnlyAdapter(adapter.id) && adapter.id !== 'worldStorage' && (adapter.id !== 'world' || gameState.role === 'host')) {
				inventoryToolbar.addControl(actionButton('tb-marketplace', item.marketplaceItemId ? 'Update Marketplace' : 'Publish', THEME.accent, 160, async () => {
					try {
						// The listing shows the object's own preview, which goes up with its models.
						const preview = item.thumbnailAssetId ?? null;
						await ensureCloudAssets(item.slotData, getLocalAssetStore(), { extraIds: preview ? [preview] : [] });
						const body: Record<string, unknown> = { name: item.name, description: '', thumbnailAssetId: preview, slotData: item.slotData };
						const response = item.marketplaceItemId
							? await platformFetch(`/api/marketplace/items/${item.marketplaceItemId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slotData: item.slotData, thumbnailAssetId: preview }) })
							: await platformFetch('/api/marketplace/items', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, source: adapter.id === 'local' || adapter.id === 'filesystem' ? undefined : { adapterId: adapter.id, itemId: item.id, worldId: gameState.worldId } }) });
						if (!response.ok) throw new Error(response.status === 401 ? 'Sign in to publish objects.' : 'Could not publish marketplace object.');
						const result = await response.json() as { id: string; latestRevision: number };
						if (adapter.id === 'local' || adapter.id === 'filesystem') await adapter.setMarketplaceItemId?.(getInventoryContext(), item.id, result.id);
						item.marketplaceItemId = result.id;
						showMessage(`Marketplace revision ${result.latestRevision} published.`, 'ok');
					} catch (error) { showMessage(error instanceof Error ? error.message : 'Could not publish marketplace object', 'error'); }
				}));
			}
			if (isWorld) {
				inventoryToolbar.addControl(actionButton('tb-load', 'Load', THEME.go, 84, async () => {
					try {
						// The Starter Kit's Dev worlds are read-only: they launch as they are, with nothing to save back to.
						if (adapter.id === 'builtin') await callbacks.onLaunchBuiltinWorld({ id: item.id, name: item.name, description: '', scene: item.slotData });
						else if (canHoldWorlds(adapter.id)) await callbacks.onLaunchWorldItem(item, adapter.id);
						else throw new Error('Worlds cannot be loaded from this inventory');
					}
					catch (error) { showMessage(error instanceof Error ? error.message : 'Could not load world', 'error'); }
				}));
				if (gameState.userId) {
					inventoryToolbar.addControl(actionButton('tb-publish', 'Publish', THEME.accent, 100, async () => {
						try {
							validateWorldScene(item.slotData);
							// Items saved before previews existed have none: it is made now, once, and goes up with the world.
							const thumbnailAssetId = item.thumbnailAssetId ?? (await captureItemThumbnail(item.slotData, 'world', { name: item.name })) ?? undefined;
							if (thumbnailAssetId) await ensureCloudAssets([], getLocalAssetStore(), { extraIds: [thumbnailAssetId] }).catch(() => undefined);
							const res = await platformFetch('/api/published-worlds', {
								method: 'POST', headers: { 'content-type': 'application/json' },
								body: JSON.stringify({ name: item.name, scene: item.slotData, thumbnailAssetId })
							});
							if (!res.ok) throw new Error('Could not publish world');
							showMessage('World published. Find it in the Worlds tab.', 'ok');
						} catch (error) { showMessage(error instanceof Error ? error.message : 'Could not publish world', 'error'); }
					}));
				}
			}
			if (adapter.updateItemInfo) {
				inventoryToolbar.addControl(actionButton('tb-rename', 'Rename', INV.surface, 100, () => void renameEntry(entry)));
				inventoryToolbar.addControl(actionButton('tb-move', 'Move', INV.surface, 84, () => startMove(entry)));
				if (adapter.id === 'cloud' && !isWorld) inventoryToolbar.addControl(actionButton('tb-visibility', item.visibility === 'public' ? 'Make private' : 'Make public', INV.surface, 130, () => void toggleVisibility(entry)));
			}
			if (adapter.deleteItem) inventoryToolbar.addControl(actionButton('tb-delete', 'Delete', INV.danger, 90, async () => {
				await adapter.deleteItem!(getInventoryContext(), item.id);
				select(null);
				refreshList();
			}));
		}
		inventoryToolbar.addControl(actionButton('tb-close', '✕', INV.surface, 40, () => select(null)));
	}

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		const units = ['KB', 'MB', 'GB', 'TB'];
		let value = bytes / 1024;
		let unit = 0;
		while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
		return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
	}

	async function refreshUsage() {
		const adapter = activeAdapter;
		quotaGroup.isVisible = false;
		if (!adapter?.usage) return;
		try {
			const usage = await adapter.usage(getInventoryContext());
			if (adapter !== activeAdapter || !usage) return;
			const format = usage.unit === 'bytes' ? formatBytes : (n: number) => String(n);
			const limited = usage.total > 0;
			const ratio = limited ? Math.min(1, usage.used / usage.total) : 0;
			quotaFill.width = ratio;
			quotaFill.background = ratio > 0.9 ? INV.error : ratio > 0.75 ? INV.warn : INV.ok;
			quotaCaption.text = limited ? `${format(usage.used)} of ${format(usage.total)} · ${Math.round(ratio * 100)}%` : `${format(usage.used)} used`;
			quotaGroup.isVisible = true;
		} catch {
			// usage is informational; keep the bar hidden
		}
	}

	function refreshPath() {
		for (const child of [...inventoryPath.children]) inventoryPath.removeControl(child);
		// Long trails collapse to "… › parent › current" so the row never grows into the actions.
		const visible = path.length > 3 ? path.slice(-2) : path;
		const offset = path.length - visible.length;
		if (offset > 0) {
			const dots = new TextBlock('crumb-collapsed', '…  ›');
			dots.width = '44px'; dots.height = '36px'; dots.fontSize = 18; dots.color = INV.muted;
			inventoryPath.addControl(dots);
		}
		visible.forEach((crumb, index) => {
			const i = index + offset;
			const isLast = i === path.length - 1;
			const label = crumb.name.length > 22 ? `${crumb.name.slice(0, 21)}…` : crumb.name;
			const btn = Button.CreateSimpleButton(`crumb-${i}`, label);
			btn.height = '36px';
			btn.width = `${28 + label.length * 10}px`;
			btn.fontSize = 18;
			btn.color = isLast ? INV.text : INV.muted;
			btn.background = 'transparent';
			btn.thickness = 0;
			btn.cornerRadius = 8;
			if (!isLast) {
				btn.onPointerEnterObservable.add(() => { btn.color = INV.text; });
				btn.onPointerOutObservable.add(() => { btn.color = INV.muted; });
			}
			btn.onPointerClickObservable.add(() => {
				if (isLast) return;
				path = path.slice(0, i + 1);
				gameState.currentInventoryFolderId = crumb.id;
				selected = null;
				refreshPath();
				refreshToolbar();
				refreshList();
			});
			inventoryPath.addControl(btn);
			if (!isLast) {
				const sep = new TextBlock(`crumb-sep-${i}`, '›');
				sep.width = '20px'; sep.height = '36px'; sep.fontSize = 20; sep.color = INV.muted;
				inventoryPath.addControl(sep);
			}
		});
	}

	/** Largest font size at which the wrapped name still fits the box. */
	function fitFontSize(text: string, width: number, height: number): number {
		const longestWord = Math.max(1, ...text.split(/\s+/).map((word) => word.length));
		for (let size = 20; size > 9; size--) {
			const charWidth = size * 0.6;
			const perLine = Math.floor(width / charWidth);
			if (longestWord > perLine) continue;
			const lines = Math.ceil((text.length * charWidth) / width);
			if (lines * size * 1.2 <= height) return size;
		}
		return 9;
	}

	/**
	 * A square, rounded picture of an item's preview. It loads in the background; `onLoaded` runs once the picture is there.
	 * A 360° world preview is twice as wide as tall, so the middle square of it (looking straight ahead from the spawn) is shown.
	 */
	function previewFrame(name: string, assetId: string, size: number, background: string, onLoaded?: () => void): Rectangle {
		const frame = new Rectangle(name);
		frame.width = `${size}px`; frame.height = `${size}px`;
		frame.background = background; frame.thickness = 0; frame.cornerRadius = 10; frame.clipChildren = true;
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
				onLoaded?.();
			});
			frame.addControl(picture);
		});
		return frame;
	}

	function createCell(entry: Entry): Rectangle {
		const key = entryKey(entry);
		const kind = entry.type === 'folder' ? 'folder' : entry.item.kind === 'world' ? 'world' : 'object';
		const style = KIND_STYLE[kind];

		// The cell is a square tile with the name under it, so the name never covers the picture. The tile is what
		// is painted for hover and selection; the cell around it takes the clicks, name included.
		const cell = new Rectangle(`cell-${key}`);
		cell.width = `${CELL_W}px`;
		cell.height = `${CELL_H}px`;
		cell.thickness = 0;
		cell.isPointerBlocker = true;
		cell.hoverCursor = 'pointer';

		const tile = new Rectangle(`cell-tile-${key}`);
		tile.width = `${TILE}px`; tile.height = `${TILE}px`;
		tile.cornerRadius = 12;
		tile.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		tile.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		tile.isHitTestVisible = false;
		cell.addControl(tile);

		// The kind's icon, large, until the item's preview has loaded (or for good if it has none).
		const glyph = new Image(`cell-icon-${key}`, iconUri(style.icon, THEME.muted, 128) ?? '');
		glyph.width = '64px'; glyph.height = '64px';
		glyph.stretch = Image.STRETCH_UNIFORM;
		glyph.isHitTestVisible = false;
		tile.addControl(glyph);

		const previewId = entry.type === 'item' ? entry.item.thumbnailAssetId : null;
		if (previewId) {
			const frame = previewFrame(`cell-thumbnail-${key}`, previewId, TILE - 6, style.tint, () => { glyph.isVisible = false; });
			tile.addControl(frame);
			// A small mark, in the corner, tells a world's preview from an object's. Objects are the common case and carry none.
			if (kind === 'world') {
				const chip = new Rectangle(`cell-chip-${key}`);
				chip.width = '30px'; chip.height = '30px';
				chip.background = '#07070ccc'; chip.thickness = 0; chip.cornerRadius = 15;
				chip.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
				chip.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
				chip.left = '8px'; chip.top = '8px';
				chip.isHitTestVisible = false;
				const mark = new Image(`cell-chip-icon-${key}`, iconUri(style.icon, THEME.text, 48) ?? '');
				mark.width = '18px'; mark.height = '18px';
				mark.stretch = Image.STRETCH_UNIFORM;
				chip.addControl(mark);
				tile.addControl(chip);
			}
		}

		const nameW = TILE - 4;
		const name = new TextBlock(`cell-name-${key}`, entry.name);
		name.width = `${nameW}px`; name.height = `${LABEL_H}px`;
		name.textWrapping = true;
		name.color = INV.text;
		name.fontSize = fitFontSize(entry.name, nameW, LABEL_H);
		name.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
		name.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		name.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		name.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		name.top = `${TILE + 6}px`;
		name.isHitTestVisible = false;
		cell.addControl(name);

		cell.onPointerEnterObservable.add(() => paintCell(key, tile, true));
		cell.onPointerOutObservable.add(() => paintCell(key, tile));
		cell.onPointerClickObservable.add(() => {
			const now = Date.now();
			if (lastClick.key === key && now - lastClick.at <= DOUBLE_CLICK_MS) {
				lastClick = { key: '', at: 0 };
				activate(entry);
				return;
			}
			lastClick = { key, at: now };
			select(entry);
		});
		cellByKey.set(key, tile);
		paintCell(key, tile);
		return cell;
	}

	function showListNotice(title: string, hint = '', color = INV.muted) {
		for (const child of [...inventoryList.children]) inventoryList.removeControl(child);
		// A control's padding is part of its height, so the top gap is a spacer and the text gets the room it needs.
		const spacer = new Rectangle('inventory-notice-spacer');
		spacer.height = '70px'; spacer.thickness = 0;
		inventoryList.addControl(spacer);
		const heading = new TextBlock('inventory-notice', title);
		heading.height = '40px'; heading.fontSize = 24; heading.color = color;
		inventoryList.addControl(heading);
		if (hint) {
			const sub = new TextBlock('inventory-notice-hint', hint);
			sub.height = '30px'; sub.fontSize = 17; sub.color = INV.muted;
			inventoryList.addControl(sub);
		}
	}

	async function refreshList() {
		if (!activeAdapter) return;
		const adapter = activeAdapter;
		const folderId = currentFolderId();
		showListNotice('Loading…');
		cellByKey.clear();
		void refreshUsage();

		let folders: InventoryFolder[] = [];
		let items: InventoryItem[] = [];
		try {
			[folders, items] = await Promise.all([
				adapter.listFolders(getInventoryContext(), folderId),
				adapter.listItems(getInventoryContext(), folderId)
			]);
		} catch (err) {
			console.error(`Failed to list inventory (${adapter.id})`, err);
			showListNotice('Could not load the inventory', 'See the console for details.', INV.error);
			return;
		}
		if (adapter !== activeAdapter) return;

		const entries: Entry[] = [
			...folders.map((folder): Entry => ({ type: 'folder', id: folder.id, name: folder.name, folder })),
			...items.map((item): Entry => ({ type: 'item', id: item.id, name: item.name, item }))
		];
		if (entries.length === 0) {
			showListNotice('Nothing here yet', 'Add a folder, or save a world from the Session tab.');
			select(null);
			return;
		}
		for (const child of [...inventoryList.children]) inventoryList.removeControl(child);
		for (let start = 0; start < entries.length; start += GRID_COLUMNS) {
			const row = new StackPanel(`inventory-row-${start}`);
			row.isVertical = false;
			row.height = `${CELL_H + CELL_GAP}px`;
			row.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
			for (const entry of entries.slice(start, start + GRID_COLUMNS)) {
				const cell = createCell(entry);
				cell.paddingRight = `${CELL_GAP}px`;
				cell.paddingBottom = `${CELL_GAP}px`;
				row.addControl(cell);
			}
			inventoryList.addControl(row);
		}
		// Keep the selection across a refresh if the entry still exists.
		select(selected && cellByKey.has(entryKey(selected)) ? selected : null);
	}

	function selectAdapter(adapter: InventoryAdapter) {
		activeAdapter = adapter;
		gameState.currentInventoryAdapterId = adapter.id;
		gameState.currentInventoryFolderId = null;
		path = [{ id: null, name: adapter.label }];
		selected = null;
		moving = null;
		refreshRoots();
		refreshPath();
		refreshList();
	}

	function refreshRoots() {
		for (const child of [...inventoryRoots.children]) inventoryRoots.removeControl(child);

		const folders = availableInventoryFolders(getInventoryContext());
		for (const folder of folders) {
			const isActive = folder === activeAdapter;
			const btn = Button.CreateSimpleButton(`root-${folder.id}`, folder.label);
			btn.width = `${Math.max(100, 30 + folder.label.length * 10)}px`;
			btn.height = '36px';
			btn.fontSize = 18;
			btn.color = isActive ? INV.text : INV.muted;
			btn.background = isActive ? INV.accent : 'transparent';
			btn.thickness = 0;
			btn.cornerRadius = 9;
			btn.paddingLeft = '4px';
			btn.paddingRight = '4px';
			btn.onPointerClickObservable.add(() => selectAdapter(folder));
			inventoryRoots.addControl(btn);
		}

		refreshToolbar();
		if (!activeAdapter && folders[0]) selectAdapter(folders[0]);
	}

	function refreshInventoryTab() {
		if (!tabs.has('inventory')) return;
		refreshRoots();
		if (activeAdapter) void refreshUsage();
	}

	// --- Settings tab ----------------------------------------------------------
	// Sections of setting cards, all the same width: what the setting is and does on the left, and on the right a
	// segmented control of a fixed width whatever the number of options. The whole list scrolls.
	const CHOICE_WIDTH = 420;
	// A rail of the sections on the left, to jump to one; the settings scroll beside it.
	const SETTINGS_RAIL = 216;
	const settingsColumn = createScrollColumn('settings', { width: PAGE_WIDTH - 2 * 24 - SETTINGS_RAIL, align: 'right' });
	const SETTINGS_WIDTH = settingsColumn.width;
	const settingsScroll = settingsColumn.scroll;
	contentByTab.settings.addControl(settingsScroll);
	const settingsList = settingsColumn.list;
	settingsList.paddingBottom = '16px';
	const settingsRail = new StackPanel('settings-rail');
	settingsRail.width = `${SETTINGS_RAIL - 16}px`;
	settingsRail.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	settingsRail.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
	settingsRail.left = '24px';
	settingsRail.top = '8px';
	contentByTab.settings.addControl(settingsRail);

	/** Scrolls the settings so that `heading` is at the top (the list's rows have fixed heights, so their sum is where it is). */
	function scrollSettingsTo(heading: Control): void {
		let above = 0;
		let total = 0;
		let found = false;
		for (const child of settingsList.children) {
			if (child === heading) found = true;
			const height = parseFloat(String(child.height)) || 0;
			if (!found) above += height;
			total += height;
		}
		const range = total + 16 - settingsScroll.heightInPixels;
		if (range > 0) settingsScroll.verticalBar.value = Math.max(0, Math.min(1, above / range));
	}

	interface SettingOption {
		label: string;
		active(): boolean;
		select(): void;
	}
	const settingRows: Array<() => void> = [];

	function settingsSection(title: string): void {
		const heading = new TextBlock(`settings-section-${title}`, title);
		heading.width = `${SETTINGS_WIDTH}px`;
		heading.height = '56px';
		heading.paddingTop = '18px';
		heading.fontSize = 22;
		heading.fontWeight = 'bold';
		heading.color = INV.text;
		heading.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		settingsList.addControl(heading);

		const jump = Button.CreateSimpleButton(`settings-rail-${title}`, title);
		jump.width = `${SETTINGS_RAIL - 16}px`;
		jump.height = '46px';
		jump.paddingBottom = '6px';
		jump.cornerRadius = 10;
		jump.thickness = 0;
		jump.fontSize = 18;
		jump.color = INV.text;
		jump.background = INV.surface;
		jump.onPointerEnterObservable.add(() => { jump.background = INV.accent; });
		jump.onPointerOutObservable.add(() => { jump.background = INV.surface; });
		jump.onPointerClickObservable.add(() => scrollSettingsTo(heading));
		settingsRail.addControl(jump);
	}

	/** A setting's card: its name and what it does, and a segmented control choosing between `options()`. */
	function settingRow(key: string, title: string, description: string, options: () => SettingOption[]): void {
		const card = new Rectangle(`setting-${key}`);
		card.width = `${SETTINGS_WIDTH}px`;
		card.height = '112px';
		card.paddingBottom = '10px';
		card.thickness = 1;
		card.color = INV.border;
		card.background = INV.surface;
		card.cornerRadius = 12;
		settingsList.addControl(card);

		const name = new TextBlock(`setting-${key}-title`, title);
		name.fontSize = 20;
		name.color = INV.text;
		name.height = '30px';
		name.width = `${SETTINGS_WIDTH - CHOICE_WIDTH - 60}px`;
		name.top = '14px';
		name.left = '20px';
		name.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		name.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		name.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		card.addControl(name);

		const about = new TextBlock(`setting-${key}-about`, description);
		about.fontSize = 15;
		about.color = INV.muted;
		about.textWrapping = true;
		about.height = '50px';
		about.width = `${SETTINGS_WIDTH - CHOICE_WIDTH - 60}px`;
		about.top = '44px';
		about.left = '20px';
		about.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		about.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		about.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		about.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		card.addControl(about);

		const choice = new Rectangle(`setting-${key}-choice`);
		choice.width = `${CHOICE_WIDTH}px`;
		choice.height = '54px';
		choice.left = '-18px';
		choice.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
		choice.thickness = 1;
		choice.color = INV.border;
		choice.background = INV.bg;
		choice.cornerRadius = 12;
		card.addControl(choice);
		const segments = new StackPanel(`setting-${key}-segments`);
		segments.isVertical = false;
		segments.height = '54px';
		choice.addControl(segments);

		settingRows.push(() => {
			for (const child of [...segments.children]) {
				segments.removeControl(child);
				child.dispose();
			}
			const list = options();
			const width = Math.floor((CHOICE_WIDTH - 8) / list.length);
			list.forEach((option, i) => {
				const on = option.active();
				const button = Button.CreateSimpleButton(`setting-${key}-${i}`, option.label);
				button.width = `${width}px`;
				button.height = '46px';
				button.paddingLeft = button.paddingRight = '3px';
				button.cornerRadius = 9;
				button.thickness = 0;
				button.fontSize = 17;
				button.color = on ? INV.text : INV.muted;
				button.background = on ? INV.accent : 'transparent';
				button.onPointerClickObservable.add(() => {
					option.select();
					refreshSettingsTab();
				});
				segments.addControl(button);
			});
		});
	}

	/** One option of a setting held in `xrSettings`: chosen when the setting has `value`, and saving it on choice. */
	function pick<K extends keyof typeof xrSettings>(setting: K, value: (typeof xrSettings)[K], label: string, then?: () => void): SettingOption {
		return {
			label,
			active: () => xrSettings[setting] === value,
			select: () => {
				xrSettings[setting] = value;
				saveSettings();
				then?.();
			}
		};
	}

	settingsSection('Movement');
	settingRow('movement', 'Moving', 'How the left stick gets you around: jump to where you point, or walk.', () => [
		pick('movementMode', 'teleport' as MovementMode, 'Teleport', () => callbacks.onLocomotionSettingsChanged()),
		pick('movementMode', 'smooth' as MovementMode, 'Walk', () => callbacks.onLocomotionSettingsChanged())
	]);
	settingRow('turning', 'Turning', 'How the right stick turns you: smoothly, or in steps (steps are gentler on the stomach).', () =>
		([['smooth', 'Smooth'], ['snap-45', 'Steps of 45°'], ['snap-90', 'Steps of 90°']] as [RotationMode, string][]).map(([mode, label]) =>
			pick('rotationMode', mode, label, () => callbacks.onLocomotionSettingsChanged())
		)
	);
	settingRow('posture', 'Posture', 'Seated lifts your view to standing height (1.7 m), so you can play sitting down.', () => [
		{ label: 'Standing', active: () => !xrSettings.seatedMode, select: () => setSeatedMode(false) },
		{ label: 'Seated', active: () => xrSettings.seatedMode, select: () => setSeatedMode(true) }
	]);

	settingRow('tabOrder', 'Tab order', 'Press a tab and drag it along the bar to put the tabs in the order you want; it is kept. Default goes back to the order the tabs ask for.', () => [
		{ label: 'Default', active: () => tabs.getUserOrder().length === 0, select: () => { saveTabOrder([]); tabs.setUserOrder([]); } },
		{ label: 'Your order', active: () => tabs.getUserOrder().length > 0, select: () => {} }
	]);
	settingRow('dashCurve', 'Menu shape', 'How much this menu bends around you. Flat is a straight panel; the others wrap it round you, which keeps its edges within reach.', () =>
		DASH_CURVES.map(({ degrees, label }) => pick('dashCurve', degrees as number, label, applyCurve))
	);

	settingRow('dashDistance', 'Menu distance', 'How far in front of you this menu opens, in metres. Closer is easier to read; further keeps it out of the way. It opens at this distance the next time you open it.', () => {
		const names: Record<number, string> = { 0.6: 'Closest', 0.8: 'Close', 1: 'Normal', 1.3: 'Far', 1.7: 'Farthest' };
		return DASH_DISTANCES.map((value) => pick('dashDistance', value as number, names[value]));
	});

	settingsSection('Desktop');
	settingRow('mouse', 'Mouse speed', 'How fast the view turns with the mouse. Applies when playing with mouse and keyboard.', () => {
		const names: Record<number, string> = { 0.5: 'Slow', 1: 'Normal', 1.6: 'Fast', 2.5: 'Fastest' };
		return MOUSE_SENSITIVITIES.map((value) => pick('mouseSensitivity', value, names[value], () => callbacks.onDesktopSettingsChanged()));
	});
	settingRow('invertY', 'Look up and down', 'Normal: moving the mouse up looks up. Inverted: it looks down.', () => [
		pick('invertY', false, 'Normal', () => callbacks.onDesktopSettingsChanged()),
		pick('invertY', true, 'Inverted', () => callbacks.onDesktopSettingsChanged())
	]);
	settingRow('fov', 'Field of view', 'How much of the world fits on the screen. A wider view shows more around you, but stretches the edges.', () => {
		const names: Record<number, string> = { 46: 'Normal', 60: 'Wide', 75: 'Wider' };
		return DESKTOP_FOVS.map((value) => pick('desktopFov', value, names[value], () => callbacks.onDesktopSettingsChanged()));
	});

	settingsSection('Audio');
	settingRow('volume', 'Master volume', 'Controls the volume of music, sound effects and other world audio.', () =>
		([0, 0.25, 0.5, 0.75, 1] as const).map((value) => pick('masterVolume', value, `${Math.round(value * 100)}%`, () => callbacks.onAudioSettingsChanged()))
	);

	settingsSection('Privacy');
	settingRow('errorReports', 'Share error reports', 'Sends the errors this device runs into (the message and the page, never your chats, voice or what you do) so that they can be fixed.', () => [
		pick('shareErrorReports', true, 'On'),
		pick('shareErrorReports', false, 'Off')
	]);

	settingsSection('World storage');
	settingRow('worldStorage', 'Saved objects', 'Where the objects a published world saves for you when you host it (records on a shelf, things you build) are kept. On this device costs no cloud space and works without an account, but is lost if the browser\u2019s data is cleared and is not on your other devices. In the cloud they count in your storage. Objects saved in the other place are still found.', () => [
		pick('worldStorageLocation', 'local', 'This device', () => refreshList()),
		pick('worldStorageLocation', 'cloud', 'Cloud', () => refreshList())
	]);

	settingsSection('Keyboard');
	settingRow('keyboard', 'Keyboard layout', 'The keys of the in-world keyboard. Auto follows the language of the page.', () => {
		const layouts = layoutIds().map((id) => getLayout(id)!);
		const auto = pick('keyboardLayout', null, 'Auto');
		if (layouts.length <= 3) return [auto, ...layouts.map((layout) => pick('keyboardLayout', layout.id, layout.name))];
		// Too many to list: the second option shows the chosen one and steps to the next.
		const current = xrSettings.keyboardLayout ? getLayout(xrSettings.keyboardLayout) : undefined;
		const next = layouts[(layouts.findIndex((layout) => layout.id === current?.id) + 1) % layouts.length];
		return [auto, { label: `${current?.name ?? 'Choose'} ⇄`, active: () => Boolean(current), select: () => pick('keyboardLayout', next.id, '').select() }];
	});

	settingsSection('Performance');
	settingRow('refresh', 'Refresh rate', 'Frames per second the headset shows. Higher is smoother, but each frame must be drawn faster (8 ms at 120 Hz): if the world cannot keep up, it stutters.', () => {
		const rates = callbacks.frameRates().slice(-3);
		return [
			pick('frameRate', null, 'Stable', () => callbacks.onPerformanceSettingsChanged()),
			...rates.map((rate) => pick('frameRate', rate, `${rate} Hz`, () => callbacks.onPerformanceSettingsChanged()))
		];
	});
	settingRow('detail', 'Detail at the edges', 'Draws the edges of your view with less detail, which you barely notice, so the world runs faster. Fastest is recommended; Full detail if the edges look blurry.', () =>
		([['off', 'Full detail'], ['medium', 'Balanced'], ['high', 'Fastest']] as [FoveationLevel, string][]).map(([level, label]) =>
			pick('foveation', level, label, () => callbacks.onPerformanceSettingsChanged())
		)
	);
	settingRow('script-rate', 'Script rate', 'How often world scripts run. Lower is lighter for modest headsets, but games and moving things react a little later.', () =>
		([[1, 'Full'], [2, 'Half'], [3, 'Third'], [4, 'Quarter']] as [ScriptRate, string][]).map(([rate, label]) =>
			pick('scriptRate', rate, label, () => callbacks.onPerformanceSettingsChanged())
		)
	);
	settingRow('multiview', 'Multiview', 'Draws both eyes at once: much faster in busy worlds. Experimental: turn it off if anything looks wrong. Applies the next time you enter VR.', () => [
		pick('multiview', false, 'Off', () => callbacks.onPerformanceSettingsChanged()),
		pick('multiview', true, 'On', () => callbacks.onPerformanceSettingsChanged())
	]);
	settingRow('readout', 'Performance readout', 'Shows frames per second and how much is being drawn, low on the left of your view.', () => [
		pick('showPerformance', false, 'Hidden', () => callbacks.onPerformanceSettingsChanged()),
		pick('showPerformance', true, 'Shown', () => callbacks.onPerformanceSettingsChanged())
	]);

	const offeredExperiments = visibleExperiments();
	if (offeredExperiments.length) {
		// In a player build only the experiments listed for production show, and the section says it is unfinished work.
		settingsSection(import.meta.env?.DEV ? 'Experiments (dev)' : 'Experiments (beta, may misbehave)');
		for (const experiment of offeredExperiments) {
			const choose = (on: boolean): SettingOption => ({
				label: on ? 'On' : 'Off',
				active: () => (xrSettings.experiments[experiment.id] === true) === on,
				select: () => {
					xrSettings.experiments[experiment.id] = on;
					saveSettings();
					callbacks.onExperimentChanged(experiment.id, on);
				}
			});
			settingRow(`experiment-${experiment.id}`, experiment.label, experiment.description, () => [choose(false), choose(true)]);
		}
	}

	function refreshSettingsTab() {
		for (const refresh of settingRows) refresh();
	}
	refreshSettingsTab();

	// In a headset these fields are typed with the in-world keyboard, brought up in front of the dash.
	typeWithKeyboard(worldsBrowser.joinCodeInput, { near: () => mesh, title: 'Room code' });
	typeWithKeyboard(worldNameInput, { near: () => mesh, title: 'World name' });

	// --- Account tab (sign in / create account / sign out, typed in VR with the in-world keyboard) ---
	// One centred card with two views: the sign-in / create-account form, and the profile of whoever is signed in.
	const ACCOUNT_WIDTH = 560;
	type AuthMode = 'signin' | 'register';
	let authMode: AuthMode = 'signin';
	let authBusy = false;

	const accountCard = new Rectangle('account-card');
	accountCard.width = `${ACCOUNT_WIDTH}px`;
	accountCard.height = '490px';
	accountCard.thickness = 1;
	accountCard.color = INV.border;
	accountCard.background = INV.surface;
	accountCard.cornerRadius = 16;
	contentByTab.account.addControl(accountCard);

	function accountButton(name: string, text: string, background: string, width: string, onClick: () => void): Button {
		const btn = Button.CreateSimpleButton(name, text);
		btn.width = width;
		btn.height = '54px';
		btn.color = INV.text;
		btn.fontSize = 20;
		btn.background = background;
		btn.cornerRadius = 10;
		btn.thickness = 0;
		btn.onPointerClickObservable.add(onClick);
		return btn;
	}

	function accountField(name: string, placeholder: string, title: string, secret = false): InputText {
		const input = new InputText(name);
		input.width = `${ACCOUNT_WIDTH - 64}px`;
		input.height = '50px';
		input.fontSize = 20;
		input.color = INV.text;
		input.background = INV.bg;
		input.focusedBackground = INV.accentSoft;
		input.thickness = 1;
		input.placeholderText = placeholder;
		input.placeholderColor = INV.muted;
		input.paddingBottom = '8px';
		typeWithKeyboard(input, { near: () => mesh, title, secret, onSubmit: () => void submitAuth() });
		return input;
	}

	// Signed out: mode toggle, fields, status, primary action and Discord.
	const signedOutView = new StackPanel('account-signed-out');
	signedOutView.width = `${ACCOUNT_WIDTH - 64}px`;
	accountCard.addControl(signedOutView);

	const accountHeading = new TextBlock('account-heading', 'Welcome back');
	accountHeading.height = '52px';
	accountHeading.fontSize = 28;
	accountHeading.fontWeight = 'bold';
	accountHeading.color = INV.text;
	accountHeading.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	signedOutView.addControl(accountHeading);

	const modeToggle = new StackPanel('account-mode');
	modeToggle.isVertical = false;
	modeToggle.height = '62px';
	signedOutView.addControl(modeToggle);
	const modeButtons = {} as Record<AuthMode, Button>;
	for (const [mode, label] of [['signin', 'Sign in'], ['register', 'Create account']] as [AuthMode, string][]) {
		const btn = accountButton(`account-mode-${mode}`, label, 'transparent', `${(ACCOUNT_WIDTH - 64) / 2}px`, () => setAuthMode(mode));
		btn.height = '46px';
		btn.fontSize = 19;
		btn.paddingBottom = '8px';
		modeToggle.addControl(btn);
		modeButtons[mode] = btn;
	}

	const emailInput = accountField('email-input', 'Email', 'Email');
	const usernameInput = accountField('username-input', 'Username', 'Username');
	const passwordInput = accountField('password-input', 'Password', 'Password', true);
	signedOutView.addControl(emailInput);
	signedOutView.addControl(usernameInput);
	signedOutView.addControl(passwordInput);

	const statusText = new TextBlock('account-status', '');
	statusText.height = '52px';
	statusText.textWrapping = true;
	statusText.fontSize = 17;
	statusText.color = INV.muted;
	statusText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	signedOutView.addControl(statusText);

	function setStatus(text: string, tone: 'info' | 'error' | 'ok' = 'info') {
		statusText.text = text;
		statusText.color = tone === 'error' ? INV.error : tone === 'ok' ? INV.ok : INV.muted;
	}

	const submitBtn = accountButton('account-submit', 'Sign in', INV.accent, `${ACCOUNT_WIDTH - 64}px`, () => void submitAuth());
	submitBtn.paddingBottom = '8px';
	signedOutView.addControl(submitBtn);
	const discordBtn = accountButton('discord-btn', 'Continue with Discord', '#5865f2', `${ACCOUNT_WIDTH - 64}px`, async () => {
		await platformAuth().signIn.social({ provider: 'discord', callbackURL: window.location.href });
	});
	signedOutView.addControl(discordBtn);

	// A game that is not on the platform's site has no cookie to share: it signs in with a code typed on the platform's own page.
	let deviceSignIn: DeviceSignIn | null = null;
	const tokenMode = Boolean(getPlatformConfig().setToken);
	const deviceBtn = accountButton('device-btn', 'Sign in with a code', THEME.raised, `${ACCOUNT_WIDTH - 64}px`, async () => {
		if (deviceSignIn) {
			deviceSignIn.cancel();
			deviceSignIn = null;
			deviceBtn.textBlock!.text = 'Sign in with a code';
			setStatus('');
			return;
		}
		try {
			setStatus('Asking for a code…');
			const attempt = (deviceSignIn = await startDeviceSignIn());
			deviceBtn.textBlock!.text = 'Cancel';
			setStatus(`On any device, open ${attempt.verificationUri.replace(/^https?:\/\//, '')} and enter ${attempt.userCode}`);
			const outcome = await attempt.done;
			if (deviceSignIn === attempt) deviceSignIn = null;
			deviceBtn.textBlock!.text = 'Sign in with a code';
			if (outcome === 'approved') await refreshSession();
			else if (outcome === 'denied') setStatus('The sign-in was refused.', 'error');
			else if (outcome === 'expired') setStatus('The code ran out. Ask for a new one.', 'error');
			else setStatus('');
		} catch {
			deviceSignIn = null;
			deviceBtn.textBlock!.text = 'Sign in with a code';
			setStatus('Could not reach the server. Try again.', 'error');
		}
	});
	discordBtn.isVisible = !tokenMode;
	deviceBtn.isVisible = tokenMode;
	signedOutView.addControl(deviceBtn);

	function setAuthMode(mode: AuthMode) {
		authMode = mode;
		const register = mode === 'register';
		accountHeading.text = register ? 'Create your account' : 'Welcome back';
		// Signing in takes an email or a username, in the one field.
		emailInput.placeholderText = register ? 'Email' : 'Email or username';
		usernameInput.isVisible = register;
		submitBtn.textBlock!.text = register ? 'Create account' : 'Sign in';
		for (const m of ['signin', 'register'] as AuthMode[]) {
			const on = m === mode;
			modeButtons[m].background = on ? INV.accent : 'transparent';
			modeButtons[m].color = on ? INV.text : INV.muted;
		}
		setStatus('');
	}

	async function submitAuth() {
		if (authBusy) return;
		const identifier = emailInput.text.trim();
		const username = usernameInput.text.trim();
		const password = passwordInput.text;
		if (!identifier || !password || (authMode === 'register' && !username)) {
			setStatus(authMode === 'register' ? 'Fill in your email, a username and a password.' : 'Enter your email or username, and your password.', 'error');
			return;
		}
		authBusy = true;
		submitBtn.background = INV.border;
		setStatus(authMode === 'register' ? 'Creating your account…' : 'Signing in…');
		let signedIn = false;
		try {
			const { error } =
				authMode === 'register'
					? await platformAuth().signUp.email({ email: identifier, password, name: username, username })
					: identifier.includes('@')
						? await platformAuth().signIn.email({ email: identifier, password })
						: await platformAuth().signIn.username({ username: identifier, password });
			if (error) {
				setStatus(error.message ?? (authMode === 'register' ? 'Could not create the account.' : 'Could not sign in.'), 'error');
			} else {
				passwordInput.text = '';
				setStatus('');
				signedIn = true;
			}
		} catch {
			setStatus('Could not reach the server. Try again.', 'error');
		} finally {
			authBusy = false;
			submitBtn.background = INV.accent;
		}
		// Refreshing with nobody signed in clears the status line, which would wipe the reason the attempt failed.
		if (signedIn) await refreshSession();
	}

	// Signed in: who you are, and how to sign out.
	const signedInView = new StackPanel('account-signed-in');
	signedInView.width = `${ACCOUNT_WIDTH - 64}px`;
	signedInView.isVisible = false;
	accountCard.addControl(signedInView);

	const avatarBadge = new Rectangle('account-avatar');
	avatarBadge.width = avatarBadge.height = '110px';
	avatarBadge.cornerRadius = 55;
	avatarBadge.thickness = 3;
	avatarBadge.color = INV.accentBorder;
	avatarBadge.background = INV.accent;
	avatarBadge.paddingBottom = '14px';
	const avatarInitial = new TextBlock('account-avatar-initial', '?');
	avatarInitial.fontSize = 52;
	avatarInitial.fontWeight = 'bold';
	avatarInitial.color = INV.text;
	avatarBadge.addControl(avatarInitial);
	const avatarSlot = new StackPanel('account-avatar-slot');
	avatarSlot.height = '124px';
	avatarSlot.addControl(avatarBadge);
	signedInView.addControl(avatarSlot);

	const profileName = new TextBlock('account-name', '');
	profileName.height = '42px';
	profileName.fontSize = 30;
	profileName.fontWeight = 'bold';
	profileName.color = INV.text;
	signedInView.addControl(profileName);
	const profileEmail = new TextBlock('account-email', '');
	profileEmail.height = '32px';
	profileEmail.fontSize = 19;
	profileEmail.color = INV.muted;
	signedInView.addControl(profileEmail);
	const signedInTag = new TextBlock('account-signed-in-tag', '● Signed in');
	signedInTag.height = '56px';
	signedInTag.fontSize = 17;
	signedInTag.color = INV.ok;
	signedInView.addControl(signedInTag);
	const signOutBtn = accountButton('logout-btn', 'Sign out', INV.danger, `${ACCOUNT_WIDTH - 64}px`, async () => {
		await platformAuth().signOut();
		getPlatformConfig().setToken?.(null);
		await refreshSession();
	});
	signedInView.addControl(signOutBtn);

	setAuthMode('signin');
	setStatus('Checking your session…');

	async function refreshSession() {
		const user = await currentUser();
		gameState.userId = user?.id ?? null;
		gameState.userName = user?.name ?? null;
		gameState.isAdmin = isAdminUser(user);
		signedOutView.isVisible = !user;
		signedInView.isVisible = Boolean(user);
		if (user) {
			profileName.text = user.name;
			profileEmail.text = user.email;
			avatarInitial.text = (user.name.trim()[0] ?? '?').toUpperCase();
		} else {
			setStatus('');
		}
		refreshInventoryTab();
		refreshWorldsTab();
	}
	void refreshSession();

	// Friends: added last since it only needs the panel's mesh (for the keyboard) and the join callback.
	if (features.friendsTab) addTab(createFriendsTab({ near: () => mesh, onJoinWorld: callbacks.onJoinWorld }));

	ready = true;
	const firstTab = tabs.has('home') ? 'home' : tabs.list()[0]?.id;
	if (firstTab) showTab(firstTab);

	return {
		root: node,
		refreshWorldsTab,
		addTab,
		removeTab,
		showTab,
		pageSize: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
		openInvite() {
			inviteOpen = true;
			setSessionNotice('');
			void refreshWorldsTab();
		}
	};
}
