import type { Scene, TransformNode, Mesh } from '@babylonjs/core';
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
import { createSlot, type SlotTree } from '$lib/ecs/types';
import type { SceneGraph } from '../sceneGraph';
import { authClient } from '$lib/auth-client';
import { availableInventoryFolders, getInventoryAdapter, isReadOnlyAdapter } from '$lib/inventory/registry';
import type { InventoryAdapter, InventoryAdapterId, InventoryStorageAdapterId, InventoryFolder, InventoryItem } from '$lib/inventory/types';
import { validateWorldScene } from '$lib/worlds/package';
import { ensureCloudAssets } from '$lib/assets/cloudSync';
import { getLocalAssetStore } from '$lib/assets/store';
import type { WorldPackage } from '$lib/worlds/types';
import { gameState, getInventoryContext } from '../gameState';
import { xrSettings, saveSettings, type FoveationLevel, type MovementMode, type RotationMode } from '../settings';
import { dashboardEditorOrder, dashboardItemLabel, moveDashboardItem, toggleDashboardItem, type DashboardItemId } from '../dashboardLayout';
import { saveWithPreview } from '../inventorySave';
import { typeWithKeyboard } from '../keyboard/guiInput';
import { getLayout, layoutIds } from '../keyboard/layouts';
import type { BuiltinWorld } from '../templates/builtinWorlds';
import { createWorldsBrowser } from './worldsBrowser';
import { thumbnailUrl } from '$lib/assets/thumbnails';
import type { AssetId } from '$lib/assets/ref';
import { WORLD_VISIBILITY_INFO, type HostedWorldVisibility } from '$lib/worldVisibility';

const TABS = ['Home', 'Session', 'Worlds', 'Inventory', 'Settings', 'Account'] as const;
type Tab = (typeof TABS)[number];

export interface DashPanelCallbacks {
	onHostWorld(visibility: HostedWorldVisibility): Promise<void>;
	onStopHosting(): Promise<void>;
	onJoinWorld(roomCode: string): Promise<void>;
	onSpawnItem(slotData: SlotTree): void;
	onSpawnWorldOrb(item: InventoryItem, adapterId: InventoryStorageAdapterId): void;
	onSpawnPublishedWorld(world: WorldPackage): void;
	onLaunchWorldItem(item: InventoryItem, adapterId: InventoryStorageAdapterId): Promise<void>;
	/** Goes to one of the worlds that ship with the app, on your own. */
	onLaunchBuiltinWorld(world: BuiltinWorld): Promise<void>;
	/** Makes an avatar item the one worn from now on, here and in every world joined later. Rejects with a readable message if it cannot be worn. */
	onSetDefaultAvatar(item: InventoryItem, adapterId: InventoryAdapterId): Promise<void>;
	/** Goes back to the avatar that ships with the app. */
	onUnsetDefaultAvatar(): Promise<void>;
	onLocomotionSettingsChanged(): void;
	onExitVr(): Promise<void>;
	onToggleInspector(): void;
	/** Seated mode was switched on or off (`xrSettings.seatedMode` already holds the new value). */
	onSeatedModeChanged(): void;
	/** Foveated rendering or the performance readout was changed (`xrSettings` already holds the new values). */
	onPerformanceSettingsChanged(): void;
	/** The display refresh rates the headset offers (empty until a headset session has started). */
	frameRates(): number[];
}

export interface DashPanelHandle {
	root: TransformNode;
	refreshWorldsTab(): void;
}

export function createDashPanel(scene: Scene, sceneGraph: SceneGraph, callbacks: DashPanelCallbacks): DashPanelHandle {
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
	mesh.scaling.set(1.2, 0.75, 1);
	mesh.metadata = { ...(mesh.metadata ?? {}), interactive: true };
	mesh.setEnabled(false);

	const texture = AdvancedDynamicTexture.CreateForMesh(mesh, 1024, 640, true);

	const background = new Rectangle('dash-bg');
	background.width = 1;
	background.height = 1;
	background.background = '#111827';
	background.thickness = 0;
	texture.addControl(background);

	const tabsBar = new StackPanel('dash-tabs');
	tabsBar.isVertical = false;
	tabsBar.height = '72px';
	tabsBar.top = '-284px';
	background.addControl(tabsBar);

	const contentByTab: Record<Tab, Rectangle> = {} as Record<Tab, Rectangle>;
	let activeTab: Tab = 'Home';

	function showTab(tab: Tab) {
		activeTab = tab;
		for (const t of TABS) contentByTab[t].isVisible = t === tab;
		if (tab === 'Home') refreshHomeTab();
		if (tab === 'Session' || tab === 'Worlds') refreshWorldsTab();
		if (tab === 'Inventory') refreshInventoryTab();
		// The keyboard's own layout key changes a setting too: show what is chosen now.
		if (tab === 'Settings') refreshSettingsTab();
	}

	for (const tab of TABS) {
		const btn = Button.CreateSimpleButton(`tab-${tab}`, tab);
		btn.width = '150px';
		btn.height = '60px';
		btn.color = 'white';
		btn.fontSize = 20;
		btn.background = '#374151';
		btn.cornerRadius = 8;
		btn.thickness = 0;
		btn.paddingLeft = '8px';
		btn.paddingRight = '8px';
		btn.onPointerClickObservable.add(() => showTab(tab));
		tabsBar.addControl(btn);

		const panel = new Rectangle(`panel-${tab}`);
		panel.width = 1;
		panel.height = '520px';
		panel.top = '40px';
		panel.thickness = 0;
		panel.isVisible = tab === activeTab;
		background.addControl(panel);
		contentByTab[tab] = panel;
	}

	// --- Home tab: the player's own shortcuts ---
	const homePanel = new StackPanel('home-panel');
	homePanel.width = 0.85;
	homePanel.top = '10px';
	contentByTab.Home.addControl(homePanel);
	let customisingHome = false;

	function setSeatedMode(enabled: boolean) {
		xrSettings.seatedMode = enabled;
		saveSettings();
		callbacks.onSeatedModeChanged();
		refreshHomeTab();
		refreshSettingsTab();
	}

	function homeText(text: string, color: string, fontSize: number, height: number): TextBlock {
		const block = new TextBlock(`home-${text.slice(0, 12)}`, text);
		block.color = color;
		block.fontSize = fontSize;
		block.height = `${height}px`;
		block.textWrapping = true;
		return block;
	}

	function homeButton(key: string, text: string, background: string, width: number, onClick: () => void): Button {
		const btn = Button.CreateSimpleButton(key, text);
		btn.width = `${width}px`;
		btn.height = '56px';
		btn.color = 'white';
		btn.fontSize = 22;
		btn.cornerRadius = 8;
		btn.background = background;
		btn.paddingBottom = '8px';
		btn.onPointerClickObservable.add(onClick);
		return btn;
	}

	/** What each shortcut looks like and does. Adding one is a new id in `dashboardLayout.ts` plus an entry here. */
	const HOME_ACTIONS: Record<DashboardItemId, () => { text: string; background: string; run: () => void }> = {
		seated: () => ({
			text: `Seated mode: ${xrSettings.seatedMode ? 'On' : 'Off'}`,
			background: xrSettings.seatedMode ? '#2563eb' : '#374151',
			run: () => setSeatedMode(!xrSettings.seatedMode)
		}),
		inspector: () => ({ text: 'Inspector', background: '#374151', run: () => callbacks.onToggleInspector() }),
		'exit-vr': () => ({ text: 'Exit VR', background: '#991b1b', run: () => void callbacks.onExitVr() })
	};

	function setHomeLayout(layout: DashboardItemId[]) {
		xrSettings.dashboardLayout = layout;
		saveSettings();
		refreshHomeTab();
	}

	function refreshHomeTab() {
		for (const child of [...homePanel.children]) homePanel.removeControl(child);
		homePanel.addControl(homeText('Home', 'white', 26, 44));

		if (!customisingHome) {
			const layout = xrSettings.dashboardLayout;
			if (layout.length === 0) homePanel.addControl(homeText('Nothing here yet. Use Customise to add your shortcuts.', '#9ca3af', 20, 60));
			for (const id of layout) {
				const action = HOME_ACTIONS[id]();
				homePanel.addControl(homeButton(`home-${id}`, action.text, action.background, 420, action.run));
			}
			homePanel.addControl(homeButton('home-customise', 'Customise', '#1f2937', 220, () => { customisingHome = true; refreshHomeTab(); }));
			if (import.meta.env.DEV) {
				homePanel.addControl(homeButton('home-reload', 'Reload', '#1f2937', 220, () => window.location.reload()));
			}
			return;
		}

		homePanel.addControl(homeText('Choose the shortcuts you want here, and their order.', '#9ca3af', 20, 40));
		const layout = xrSettings.dashboardLayout;
		for (const { id, shown } of dashboardEditorOrder(layout)) {
			const row = new StackPanel(`home-edit-${id}`);
			row.isVertical = false;
			row.height = '60px';
			const name = homeText(dashboardItemLabel(id), shown ? 'white' : '#6b7280', 22, 52);
			name.width = '260px';
			name.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
			row.addControl(name);
			row.addControl(homeButton(`home-toggle-${id}`, shown ? 'Shown' : 'Hidden', shown ? '#2563eb' : '#374151', 130, () => setHomeLayout(toggleDashboardItem(layout, id))));
			if (shown) {
				row.addControl(homeButton(`home-up-${id}`, '▲', '#374151', 60, () => setHomeLayout(moveDashboardItem(layout, id, -1))));
				row.addControl(homeButton(`home-down-${id}`, '▼', '#374151', 60, () => setHomeLayout(moveDashboardItem(layout, id, 1))));
			}
			homePanel.addControl(row);
		}
		homePanel.addControl(homeButton('home-done', 'Done', '#16a34a', 200, () => { customisingHome = false; refreshHomeTab(); }));
	}
	refreshHomeTab();

	// --- Session tab (current session / hosting) ---
	const sessionScroll = new ScrollViewer('session-scroll');
	sessionScroll.width = 0.94;
	sessionScroll.height = '490px';
	sessionScroll.top = '10px';
	sessionScroll.barColor = '#7c3aed';
	sessionScroll.thickness = 0;
	contentByTab.Session.addControl(sessionScroll);
	const sessionList = new StackPanel('session-list');
	sessionList.width = 0.94;
	sessionScroll.addControl(sessionList);

	// --- Worlds tab (official, active and published worlds to go to) ---
	const worldsBrowser = createWorldsBrowser(contentByTab.Worlds, sceneGraph, {
		onJoinWorld: async (roomCode) => { await callbacks.onJoinWorld(roomCode); void refreshWorldsTab(); },
		onSpawnPublishedWorld: callbacks.onSpawnPublishedWorld,
		onLaunchBuiltinWorld: callbacks.onLaunchBuiltinWorld
	});


	const worldsTitle = new TextBlock('worlds-title', '¿Cómo quieres compartir este mundo?');
	worldsTitle.color = 'white';
	worldsTitle.fontSize = 22;
	worldsTitle.height = '42px';
	sessionList.addControl(worldsTitle);

	const worldsHint = new TextBlock('worlds-hint', 'Solo necesitas alojarlo si quieres que entren otras personas.');
	worldsHint.color = '#9ca3af';
	worldsHint.fontSize = 16;
	worldsHint.height = '36px';
	sessionList.addControl(worldsHint);
	const visibilityOptions = new StackPanel('world-visibility-options');
	const visibilityButtons: Button[] = [];
	visibilityOptions.width = 1;
	sessionList.addControl(visibilityOptions);

	const worldActionStatus = new TextBlock('world-action-status', '');
	worldActionStatus.color = '#fbbf24';
	worldActionStatus.fontSize = 16;
	worldActionStatus.height = '34px';
	sessionList.addControl(worldActionStatus);

	const sessionPanel = new StackPanel('active-session-panel');
	sessionPanel.width = 1;
	sessionPanel.isVisible = false;
	sessionList.addControl(sessionPanel);

	const sessionInfo = new TextBlock('active-session-info', '');
	sessionInfo.color = '#86efac';
	sessionInfo.fontSize = 19;
	sessionInfo.height = '104px';
	sessionPanel.addControl(sessionInfo);

	const stopHostingBtn = Button.CreateSimpleButton('stop-hosting-btn', 'Dejar de alojar');
	stopHostingBtn.height = '52px';
	stopHostingBtn.color = 'white';
	stopHostingBtn.background = '#991b1b';
	stopHostingBtn.cornerRadius = 8;
	stopHostingBtn.onPointerClickObservable.add(async () => {
		stopHostingBtn.isEnabled = false;
		worldActionStatus.text = 'Cerrando la sesión…';
		try {
			await callbacks.onStopHosting();
			worldActionStatus.text = '';
			refreshWorldsTab();
		} catch (err) {
			worldActionStatus.text = err instanceof Error ? err.message : 'No se pudo cerrar la sesión';
			stopHostingBtn.isEnabled = true;
		}
	});
	sessionPanel.addControl(stopHostingBtn);

	// Save the running scene as a world. A world loaded from the inventory gets a
	// new revision in its own lineage (revisions are immutable), not a new world.
	const saveWorldTitle = new TextBlock('save-world-title', 'Save this world');
	saveWorldTitle.color = '#d1d5db'; saveWorldTitle.fontSize = 18; saveWorldTitle.height = '38px'; saveWorldTitle.top = '10px';
	sessionList.addControl(saveWorldTitle);
	const saveWorldRow = new StackPanel('save-world-row');
	saveWorldRow.isVertical = false; saveWorldRow.height = '56px';
	const worldNameInput = new InputText('world-name-input');
	worldNameInput.width = '300px'; worldNameInput.height = '48px';
	worldNameInput.color = 'white'; worldNameInput.background = '#1f2937';
	worldNameInput.placeholderText = 'World name'; worldNameInput.text = 'My World';
	worldNameInput.paddingRight = '6px';
	saveWorldRow.addControl(worldNameInput);
	const saveWorldBtn = Button.CreateSimpleButton('save-world-btn', 'Save world');
	saveWorldBtn.width = '330px'; saveWorldBtn.height = '48px'; saveWorldBtn.fontSize = 18;
	saveWorldBtn.color = 'white'; saveWorldBtn.background = '#7c3aed'; saveWorldBtn.cornerRadius = 8;
	saveWorldBtn.paddingRight = '6px';
	saveWorldRow.addControl(saveWorldBtn);
	const saveAsNewBtn = Button.CreateSimpleButton('save-world-new-btn', 'Save as new world');
	saveAsNewBtn.width = '230px'; saveAsNewBtn.height = '48px'; saveAsNewBtn.fontSize = 18;
	saveAsNewBtn.color = 'white'; saveAsNewBtn.background = '#374151'; saveAsNewBtn.cornerRadius = 8;
	saveWorldRow.addControl(saveAsNewBtn);
	sessionList.addControl(saveWorldRow);
	const saveWorldStatus = new TextBlock('save-world-status', '');
	saveWorldStatus.color = '#86efac'; saveWorldStatus.fontSize = 16; saveWorldStatus.height = '34px';
	sessionList.addControl(saveWorldStatus);
	let shownLoadedKey: string | null = null;

	function refreshSaveWorld() {
		const loaded = gameState.loadedWorld;
		saveWorldTitle.isVisible = saveWorldRow.isVisible = saveWorldStatus.isVisible = gameState.role !== 'guest';
		saveAsNewBtn.isVisible = loaded !== null;
		const key = loaded ? `${loaded.adapterId}:${loaded.worldLineageId}` : null;
		if (key !== shownLoadedKey) {
			shownLoadedKey = key;
			worldNameInput.text = loaded?.name ?? gameState.worldName ?? 'My World';
		}
		const button = saveWorldBtn.textBlock;
		if (button) button.text = loaded && getInventoryAdapter(loaded.adapterId)?.saveItem
			? `Save as v${(loaded.revisionNumber ?? 0) + 1} of “${loaded.name}”`.slice(0, 40)
			: 'Save world';
	}

	async function saveWorld(asNew: boolean) {
		const loaded = asNew ? null : gameState.loadedWorld;
		const selected = getInventoryAdapter(loaded?.adapterId ?? gameState.currentInventoryAdapterId ?? 'local');
		const adapter = selected?.isAvailable(getInventoryContext()) && selected.saveItem ? selected : getInventoryAdapter('local');
		if (!adapter) { saveWorldStatus.color = '#f87171'; saveWorldStatus.text = 'No inventory is available'; return; }
		const folderId = loaded && loaded.adapterId === adapter.id ? loaded.folderId
			: adapter.id === gameState.currentInventoryAdapterId ? gameState.currentInventoryFolderId : null;
		const name = worldNameInput.text.trim() || 'My World';
		saveWorldBtn.isEnabled = saveAsNewBtn.isEnabled = false;
		try {
			const snapshot = sceneGraph.serialize({ withoutAvatars: true });
			validateWorldScene(snapshot);
			const lineage = loaded && loaded.adapterId === adapter.id ? loaded.worldLineageId : undefined;
			if (!adapter.saveItem || isReadOnlyAdapter(adapter.id)) throw new Error('This inventory is read-only');
			saveWorldStatus.color = '#9ca3af';
			saveWorldStatus.text = 'Saving…';
			const saved = await saveWithPreview(adapter, getInventoryContext(), folderId, name, snapshot, 'world', lineage);
			if (saved.worldLineageId) {
				gameState.loadedWorld = { adapterId: adapter.id, worldLineageId: saved.worldLineageId, folderId: saved.folderId, name: saved.name, revisionNumber: saved.revisionNumber ?? null };
			}
			saveWorldStatus.color = '#86efac';
			saveWorldStatus.text = lineage ? `Saved revision v${saved.revisionNumber ?? '?'} in ${adapter.label}.` : `Saved to ${adapter.label}.`;
		} catch (error) {
			saveWorldStatus.color = '#f87171';
			saveWorldStatus.text = error instanceof Error ? error.message : 'Could not save world';
		} finally {
			saveWorldBtn.isEnabled = saveAsNewBtn.isEnabled = true;
			refreshSaveWorld();
			if (activeTab === 'Inventory') refreshInventoryTab();
		}
	}
	saveWorldBtn.onPointerClickObservable.add(() => void saveWorld(false));
	saveAsNewBtn.onPointerClickObservable.add(() => void saveWorld(true));

	function addVisibilityOption(visibility: HostedWorldVisibility | 'solo') {
		const info = WORLD_VISIBILITY_INFO[visibility];
		const btn = Button.CreateSimpleButton(
			`world-visibility-${visibility}`,
			`${info.label} — ${info.description}`
		);
		btn.height = '58px';
		btn.color = 'white';
		btn.background = visibility === 'solo' ? '#2563eb' : '#16a34a';
		btn.cornerRadius = 8;
		btn.paddingTop = '5px';
		if (visibility === 'friends' || visibility === 'friends-plus') btn.isEnabled = false;
		btn.onPointerClickObservable.add(async () => {
			if (visibility === 'solo') {
				worldActionStatus.text = 'Mundo local activo. Nadie puede entrar.';
				return;
			}
			if (!gameState.userId && visibility !== 'private') {
				worldActionStatus.text = 'Sign in to host a friends or public session.';
				return;
			}
			btn.isEnabled = false;
			worldActionStatus.text = `Alojando como ${info.label.toLowerCase()}…`;
			try {
				await callbacks.onHostWorld(visibility);
				worldActionStatus.text = '';
				refreshWorldsTab();
			} catch (err) {
				worldActionStatus.text = err instanceof Error ? err.message : 'No se pudo alojar el mundo';
				btn.isEnabled = true;
			}
		});
		visibilityButtons.push(btn);
		visibilityOptions.addControl(btn);
	}

	addVisibilityOption('solo');
	addVisibilityOption('private');
	addVisibilityOption('friends');
	addVisibilityOption('friends-plus');
	addVisibilityOption('public');

	async function refreshWorldsTab() {
		refreshSaveWorld();
		const isConnected = gameState.role === 'host' || gameState.role === 'guest';
		visibilityOptions.isVisible = !isConnected;
		sessionPanel.isVisible = isConnected;
		stopHostingBtn.isVisible = gameState.role === 'host';
		if (!isConnected) for (const btn of visibilityButtons) btn.isEnabled = !(btn.name ?? '').endsWith('-friends') && !(btn.name ?? '').endsWith('-friends-plus');
		if (gameState.role === 'host') {
			const visibility = gameState.worldVisibility ? WORLD_VISIBILITY_INFO[gameState.worldVisibility].label : 'Alojada';
			const startedAt = gameState.sessionStartedAt
				? new Date(gameState.sessionStartedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
				: '—';
			sessionInfo.text = `Sesión activa\n${gameState.worldName ?? 'Mi mundo'} · ${visibility}\nCódigo de sala: ${gameState.roomCode ?? '—'} · Desde ${startedAt}`;
		} else if (gameState.role === 'guest') {
			sessionInfo.text = `Conectado a una sesión\nCódigo de sala: ${gameState.roomCode ?? '—'}`;
		}
		// The Worlds tab lists its own category; only reload it while it is the one on screen.
		if (activeTab === 'Worlds') await worldsBrowser.refresh();
	}


	// --- Inventory tab -------------------------------------------------------
	// Two compact rows above the grid:
	//   1. source switcher (segmented control)            usage bar
	//   2. breadcrumb                       contextual actions (+ Folder / selection)
	// Single click selects a cell, double click opens a folder or spawns an item.
	const INV = {
		bg: '#0f172a', surface: '#1e293b', surfaceHover: '#273449', border: '#334155',
		text: '#f1f5f9', muted: '#94a3b8', accent: '#6366f1', accentSoft: '#312e81', accentBorder: '#818cf8',
		danger: '#b91c1c', ok: '#22c55e', warn: '#f59e0b', error: '#ef4444'
	};
	const KIND_STYLE = {
		folder: { icon: '📁', tint: '#78350f', label: 'Folder' },
		object: { icon: '📦', tint: '#1e3a8a', label: 'Object' },
		world: { icon: '🌍', tint: '#5b21b6', label: 'World' }
	} as const;
	const CELL_W = 156;
	const CELL_H = 108;
	const CELL_GAP = 6;
	const GRID_COLUMNS = 6;
	const DOUBLE_CLICK_MS = 400;
	const SIDE_MARGIN = 20;

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
	contentByTab.Inventory.addControl(inventoryRootsFrame);
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
	contentByTab.Inventory.addControl(quotaGroup);
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
	contentByTab.Inventory.addControl(inventoryPath);

	const inventoryToolbar = place(new StackPanel('inventory-toolbar'), 60, 'right');
	inventoryToolbar.isVertical = false;
	inventoryToolbar.height = '40px';
	inventoryToolbar.adaptWidthToChildren = true;
	contentByTab.Inventory.addControl(inventoryToolbar);

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
	contentByTab.Inventory.addControl(inventoryScroll);
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
	contentByTab.Inventory.addControl(toast);
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
			refreshList();
		} else if (entry.item.kind === 'world') {
			if (isReadOnlyAdapter(adapter.id)) return;
			callbacks.onSpawnWorldOrb(entry.item, adapter.id);
			showMessage(`Placed “${entry.name}” as a world orb`, 'ok');
		} else if (entry.item.kind === 'avatar') {
			if (isWornAvatar(entry.item)) void unsetDefaultAvatar();
			else void setDefaultAvatar(entry.item);
		} else {
			callbacks.onSpawnItem(entry.item.slotData);
		}
	}

	function isWornAvatar(item: InventoryItem): boolean {
		return !!activeAdapter && xrSettings.defaultAvatarSource === `${activeAdapter.id}:${item.id}`;
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

	function refreshToolbar() {
		for (const child of [...inventoryToolbar.children]) inventoryToolbar.removeControl(child);
		const adapter = activeAdapter;
		const entry = selected;
		if (!adapter) return;
		if (adapter.connect) inventoryToolbar.addControl(actionButton('tb-connect', 'Choose folder', INV.surface, 160, async () => {
			try { await adapter.connect!(true); path = [{ id: null, name: adapter.label }]; select(null); refreshPath(); await refreshList(); }
			catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) showMessage(error instanceof Error ? error.message : 'Could not open folder', 'error'); }
		}));
		if (!entry) {
			if (adapter.createFolder) inventoryToolbar.addControl(newFolderBtn);
			return;
		}

		if (entry.type === 'folder') {
			inventoryToolbar.addControl(actionButton('tb-open', 'Open', INV.accent, 90, () => activate(entry)));
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
				? actionButton('tb-unset-avatar', 'Unset', INV.surface, 110, () => activate(entry))
				: actionButton('tb-set-avatar', 'Set as default', INV.accent, 150, () => activate(entry)));
			else inventoryToolbar.addControl(actionButton('tb-spawn', isWorld ? 'Place orb' : 'Spawn', INV.accent, isWorld ? 116 : 94, () => activate(entry)));
			if (!isWorld && gameState.userId && !isReadOnlyAdapter(adapter.id) && (adapter.id !== 'world' || gameState.role === 'host')) {
				inventoryToolbar.addControl(actionButton('tb-marketplace', item.marketplaceItemId ? 'Update Marketplace' : 'Publish', '#7c3aed', 160, async () => {
					try {
						// The listing shows the object's own preview, which goes up with its models.
						const preview = item.thumbnailAssetId ?? null;
						await ensureCloudAssets(item.slotData, getLocalAssetStore(), { extraIds: preview ? [preview] : [] });
						const body: Record<string, unknown> = { name: item.name, description: '', thumbnailAssetId: preview, slotData: item.slotData };
						const response = item.marketplaceItemId
							? await fetch(`/api/marketplace/items/${item.marketplaceItemId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slotData: item.slotData, thumbnailAssetId: preview }) })
							: await fetch('/api/marketplace/items', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, source: adapter.id === 'local' || adapter.id === 'filesystem' ? undefined : { adapterId: adapter.id, itemId: item.id, worldId: gameState.worldId } }) });
						if (!response.ok) throw new Error(response.status === 401 ? 'Sign in to publish objects.' : 'Could not publish marketplace object.');
						const result = await response.json() as { id: string; latestRevision: number };
						if (adapter.id === 'local' || adapter.id === 'filesystem') await adapter.setMarketplaceItemId?.(getInventoryContext(), item.id, result.id);
						item.marketplaceItemId = result.id;
						showMessage(`Marketplace revision ${result.latestRevision} published.`, 'ok');
					} catch (error) { showMessage(error instanceof Error ? error.message : 'Could not publish marketplace object', 'error'); }
				}));
			}
			if (isWorld) {
				inventoryToolbar.addControl(actionButton('tb-load', 'Load', '#0f766e', 84, async () => {
					if (isReadOnlyAdapter(adapter.id)) return;
					try { await callbacks.onLaunchWorldItem(item, adapter.id); }
					catch (error) { showMessage(error instanceof Error ? error.message : 'Could not load world', 'error'); }
				}));
				if (gameState.userId) {
					inventoryToolbar.addControl(actionButton('tb-publish', 'Publish', '#7c3aed', 100, async () => {
						try {
							validateWorldScene(item.slotData);
							const thumbnailAssetId = item.thumbnailAssetId ?? undefined;
							if (thumbnailAssetId) await ensureCloudAssets([], getLocalAssetStore(), { extraIds: [thumbnailAssetId] }).catch(() => undefined);
							const res = await fetch('/api/published-worlds', {
								method: 'POST', headers: { 'content-type': 'application/json' },
								body: JSON.stringify({ name: item.name, scene: item.slotData, thumbnailAssetId })
							});
							if (!res.ok) throw new Error('Could not publish world');
							showMessage('World published. Find it in the Worlds tab.', 'ok');
						} catch (error) { showMessage(error instanceof Error ? error.message : 'Could not publish world', 'error'); }
					}));
				}
			}
			if (adapter.updateItem && path.length > 1 && !isWorld) {
				const parentId = path[path.length - 2].id;
				inventoryToolbar.addControl(actionButton('tb-move', 'Move up', INV.surface, 100, async () => {
					try {
						await adapter.updateItem!(getInventoryContext(), item.id, parentId, item.name, item.slotData);
						select(null);
						refreshList();
					} catch (error) { showMessage(error instanceof Error ? error.message : 'Could not move item', 'error'); }
				}));
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
			const label = crumb.name.length > 16 ? `${crumb.name.slice(0, 15)}…` : crumb.name;
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
		const meta = kind === 'world' && entry.type === 'item' ? `World · v${entry.item.revisionNumber ?? 1}` : style.label;

		const cell = new Rectangle(`cell-${key}`);
		cell.width = `${CELL_W}px`;
		cell.height = `${CELL_H}px`;
		cell.cornerRadius = 12;
		cell.isPointerBlocker = true;
		cell.hoverCursor = 'pointer';

		const badge = new Rectangle(`cell-badge-${key}`);
		badge.width = '38px'; badge.height = '38px';
		badge.background = style.tint; badge.thickness = 0; badge.cornerRadius = 10;
		badge.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		badge.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		badge.left = '10px'; badge.top = '10px';
		badge.isHitTestVisible = false;
		const glyph = new TextBlock(`cell-icon-${key}`, style.icon);
		glyph.fontSize = 22;
		badge.addControl(glyph);
		cell.addControl(badge);

		// An item with a preview shows it in place of the icon once it has loaded; until then (or if it never does) the icon stays.
		const previewId = entry.type === 'item' ? entry.item.thumbnailAssetId : null;
		if (previewId) {
			const frame = previewFrame(`cell-thumbnail-${key}`, previewId, 58, style.tint, () => { badge.isVisible = false; });
			frame.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT; frame.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
			frame.left = '10px'; frame.top = '10px';
			cell.addControl(frame);
		}

		const tag = new TextBlock(`cell-meta-${key}`, meta);
		tag.fontSize = 13; tag.color = INV.muted;
		tag.width = `${CELL_W - (previewId ? 86 : 64)}px`; tag.height = '20px';
		tag.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		tag.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		tag.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		tag.left = previewId ? '76px' : '56px'; tag.top = '10px';
		tag.isHitTestVisible = false;
		cell.addControl(tag);

		const nameW = CELL_W - 20;
		const nameH = CELL_H - 58;
		const name = new TextBlock(`cell-name-${key}`, entry.name);
		name.width = `${nameW}px`; name.height = `${nameH}px`;
		name.textWrapping = true;
		name.color = INV.text;
		name.fontSize = fitFontSize(entry.name, nameW, nameH);
		name.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		name.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		name.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
		name.top = '-8px';
		name.isHitTestVisible = false;
		cell.addControl(name);

		cell.onPointerEnterObservable.add(() => paintCell(key, cell, true));
		cell.onPointerOutObservable.add(() => paintCell(key, cell));
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
		cellByKey.set(key, cell);
		paintCell(key, cell);
		return cell;
	}

	function showListNotice(title: string, hint = '', color = INV.muted) {
		for (const child of [...inventoryList.children]) inventoryList.removeControl(child);
		const heading = new TextBlock('inventory-notice', title);
		heading.height = hint ? '44px' : '60px'; heading.fontSize = 22; heading.color = color; heading.paddingTop = '40px';
		inventoryList.addControl(heading);
		if (hint) {
			const sub = new TextBlock('inventory-notice-hint', hint);
			sub.height = '34px'; sub.fontSize = 16; sub.color = INV.muted; sub.paddingTop = '40px';
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
			btn.width = '120px';
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
		refreshRoots();
		if (activeAdapter) void refreshUsage();
	}

	// --- Settings tab ----------------------------------------------------------
	// Sections of setting cards, all the same width: what the setting is and does on the left, and on the right a
	// segmented control of a fixed width whatever the number of options. The whole list scrolls.
	const SETTINGS_WIDTH = 940;
	const CHOICE_WIDTH = 420;
	const settingsScroll = new ScrollViewer('settings-scroll');
	settingsScroll.width = 1;
	settingsScroll.height = '520px';
	settingsScroll.thickness = 0;
	settingsScroll.barColor = INV.accent;
	settingsScroll.barBackground = INV.bg;
	contentByTab.Settings.addControl(settingsScroll);
	// The list spans the scroll area and its cards keep their own width, centred in it.
	const settingsList = new StackPanel('settings-list');
	settingsList.width = 1;
	settingsList.paddingBottom = '16px';
	settingsScroll.addControl(settingsList);

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
			pick('frameRate', null, 'Default', () => callbacks.onPerformanceSettingsChanged()),
			...rates.map((rate) => pick('frameRate', rate, `${rate} Hz`, () => callbacks.onPerformanceSettingsChanged()))
		];
	});
	settingRow('detail', 'Detail at the edges', 'Draws the edges of your view with less detail, which you barely notice, so the world runs faster. Fastest is recommended; Full detail if the edges look blurry.', () =>
		([['off', 'Full detail'], ['medium', 'Balanced'], ['high', 'Fastest']] as [FoveationLevel, string][]).map(([level, label]) =>
			pick('foveation', level, label, () => callbacks.onPerformanceSettingsChanged())
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

	function refreshSettingsTab() {
		for (const refresh of settingRows) refresh();
	}
	refreshSettingsTab();

	// --- Account tab (login/register/logout, typed in VR with the in-world keyboard) ---
	const settingsStack = new StackPanel('settings-stack');
	settingsStack.width = 0.7;
	settingsStack.top = '10px';
	contentByTab.Account.addControl(settingsStack);

	const statusText = new TextBlock('settings-status', '');
	statusText.color = 'white';
	statusText.fontSize = 22;
	statusText.height = '72px';
	statusText.text = 'Comprobando sesión…';
	settingsStack.addControl(statusText);

	const emailInput = new InputText('email-input');
	emailInput.width = 1;
	emailInput.height = '48px';
	emailInput.color = 'white';
	emailInput.background = '#1f2937';
	emailInput.placeholderText = 'Email';
	emailInput.isVisible = false;
	settingsStack.addControl(emailInput);

	const usernameInput = new InputText('username-input');
	usernameInput.width = 1;
	usernameInput.height = '48px';
	usernameInput.color = 'white';
	usernameInput.background = '#1f2937';
	usernameInput.placeholderText = 'Usuario (para registrarte, o para entrar sin email)';
	usernameInput.margin = '4px';
	usernameInput.isVisible = false;
	settingsStack.addControl(usernameInput);

	const passwordInput = new InputText('password-input');
	passwordInput.width = 1;
	passwordInput.height = '48px';
	passwordInput.color = 'white';
	passwordInput.background = '#1f2937';
	passwordInput.placeholderText = 'Contraseña';
	passwordInput.margin = '4px';
	passwordInput.isVisible = false;
	settingsStack.addControl(passwordInput);

	// In a headset these fields are typed with the in-world keyboard, brought up in front of the dash.
	const nearDash = () => mesh;
	typeWithKeyboard(worldsBrowser.joinCodeInput, { near: nearDash, title: 'Room code' });
	typeWithKeyboard(worldNameInput, { near: nearDash, title: 'World name' });
	typeWithKeyboard(emailInput, { near: nearDash, title: 'Email' });
	typeWithKeyboard(usernameInput, { near: nearDash, title: 'Username' });
	typeWithKeyboard(passwordInput, { near: nearDash, title: 'Password', secret: true });

	const authButtons = new StackPanel('auth-buttons');
	authButtons.isVertical = false;
	authButtons.height = '56px';
	authButtons.top = '8px';
	settingsStack.addControl(authButtons);

	function authButton(name: string, text: string, onClick: () => void): Button {
		const btn = Button.CreateSimpleButton(name, text);
		btn.width = '160px';
		btn.height = '52px';
		btn.color = 'white';
		btn.background = '#374151';
		btn.cornerRadius = 8;
		btn.onPointerClickObservable.add(onClick);
		authButtons.addControl(btn);
		return btn;
	}

	const loginBtn = authButton('login-btn', 'Entrar', async () => {
		statusText.text = 'Entrando…';
		// no email typed but a username was -> log in by username instead
		const { error } =
			!emailInput.text && usernameInput.text
				? await authClient.signIn.username({ username: usernameInput.text, password: passwordInput.text })
				: await authClient.signIn.email({ email: emailInput.text, password: passwordInput.text });
		statusText.text = error ? (error.message ?? 'Error al entrar') : '';
		await refreshSession();
	});

	const registerBtn = authButton('register-btn', 'Registrarse', async () => {
		statusText.text = 'Creando cuenta…';
		const { error } = await authClient.signUp.email({
			email: emailInput.text,
			password: passwordInput.text,
			name: usernameInput.text || emailInput.text.split('@')[0] || 'Explorer',
			...(usernameInput.text ? { username: usernameInput.text } : {})
		});
		statusText.text = error ? (error.message ?? 'Error al registrarse') : '';
		await refreshSession();
	});

	const discordBtn = authButton('discord-btn', 'Discord', async () => {
		await authClient.signIn.social({ provider: 'discord', callbackURL: window.location.href });
	});

	const logoutBtn = authButton('logout-btn', 'Salir', async () => {
		await authClient.signOut();
		await refreshSession();
	});
	logoutBtn.isVisible = false;
	loginBtn.isVisible = false;
	registerBtn.isVisible = false;
	discordBtn.isVisible = false;

	async function refreshSession() {
		const { data } = await authClient.getSession();
		const user = data?.user ?? null;
		gameState.userId = user?.id ?? null;
		gameState.userName = user?.name ?? null;
		statusText.text = user ? `Sesión activa\n${user.name} · ${user.email}` : 'Sin sesión';
		for (const input of [emailInput, usernameInput, passwordInput]) input.isVisible = !user;
		loginBtn.isVisible = !user;
		registerBtn.isVisible = !user;
		discordBtn.isVisible = !user;
		logoutBtn.isVisible = Boolean(user);
		refreshInventoryTab();
		refreshWorldsTab();
	}
	void refreshSession();

	showTab('Home');

	return {
		root: node,
		refreshWorldsTab
	};
}
