import type { Scene, TransformNode, Mesh } from '@babylonjs/core';
import {
	AdvancedDynamicTexture,
	Rectangle,
	StackPanel,
	TextBlock,
	Button,
	InputText,
	VirtualKeyboard,
	Control,
	ScrollViewer
} from '@babylonjs/gui';
import { createSlot, type SlotTree } from '$lib/ecs/types';
import type { SceneGraph } from '../sceneGraph';
import { authClient } from '$lib/auth-client';
import { availableInventoryFolders, getInventoryAdapter } from '$lib/inventory/registry';
import type { InventoryAdapter, InventoryAdapterId, InventoryFolder, InventoryItem } from '$lib/inventory/types';
import { validateWorldScene } from '$lib/worlds/package';
import type { WorldPackage } from '$lib/worlds/types';
import { gameState, getInventoryContext } from '../gameState';
import { xrSettings, saveSettings, type MovementMode, type RotationMode } from '../settings';
import { WORLD_VISIBILITY_INFO, type HostedWorldVisibility } from '$lib/worldVisibility';

const TABS = ['Session', 'Worlds', 'Inventory', 'Settings', 'Account'] as const;
type Tab = (typeof TABS)[number];

export interface DashPanelCallbacks {
	onHostWorld(visibility: HostedWorldVisibility): Promise<void>;
	onStopHosting(): Promise<void>;
	onJoinWorld(roomCode: string): Promise<void>;
	onSpawnItem(slotData: SlotTree): void;
	onSpawnWorldOrb(item: InventoryItem, adapterId: InventoryAdapterId): void;
	onSpawnPublishedWorld(world: WorldPackage): void;
	onLaunchWorldItem(item: InventoryItem, adapterId: InventoryAdapterId): Promise<void>;
	onLocomotionSettingsChanged(): void;
	onExitVr(): Promise<void>;
	onToggleInspector(): void;
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

	// Always-visible, regardless of active tab.
	const exitVrBtn = Button.CreateSimpleButton('exit-vr-btn', 'Salir de VR');
	exitVrBtn.width = '150px';
	exitVrBtn.height = '48px';
	exitVrBtn.color = 'white';
	exitVrBtn.background = '#991b1b';
	exitVrBtn.cornerRadius = 8;
	exitVrBtn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
	exitVrBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
	exitVrBtn.top = '16px';
	exitVrBtn.left = '-16px';
	exitVrBtn.onPointerClickObservable.add(() => {
		void callbacks.onExitVr();
	});
	background.addControl(exitVrBtn);

	const inspectorBtn = Button.CreateSimpleButton('inspector-btn', 'Inspector');
	inspectorBtn.width = '150px';
	inspectorBtn.height = '48px';
	inspectorBtn.color = 'white';
	inspectorBtn.background = '#374151';
	inspectorBtn.cornerRadius = 8;
	inspectorBtn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	inspectorBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
	inspectorBtn.top = '16px';
	inspectorBtn.left = '16px';
	inspectorBtn.onPointerClickObservable.add(() => callbacks.onToggleInspector());
	background.addControl(inspectorBtn);

	const contentByTab: Record<Tab, Rectangle> = {} as Record<Tab, Rectangle>;
	let activeTab: Tab = 'Session';

	function showTab(tab: Tab) {
		activeTab = tab;
		for (const t of TABS) contentByTab[t].isVisible = t === tab;
		if (tab === 'Session' || tab === 'Worlds') refreshWorldsTab();
		if (tab === 'Inventory') refreshInventoryTab();
	}

	for (const tab of TABS) {
		const btn = Button.CreateSimpleButton(`tab-${tab}`, tab);
		btn.width = '180px';
		btn.height = '60px';
		btn.color = 'white';
		btn.fontSize = 22;
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

	// --- Worlds tab (sessions and worlds to join) ---
	const worldsScroll = new ScrollViewer('worlds-scroll');
	worldsScroll.width = 0.94;
	worldsScroll.height = '490px';
	worldsScroll.top = '10px';
	worldsScroll.barColor = '#7c3aed';
	worldsScroll.thickness = 0;
	contentByTab.Worlds.addControl(worldsScroll);
	const worldsList = new StackPanel('worlds-list');
	worldsList.width = 0.94;
	worldsScroll.addControl(worldsList);

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
	const browseHeader = new StackPanel('browse-header');
	browseHeader.isVertical = false;
	browseHeader.height = '56px';
	const browseTitle = new TextBlock('browse-title', 'Sessions and worlds to join');
	browseTitle.width = '600px'; browseTitle.height = '48px'; browseTitle.color = 'white'; browseTitle.fontSize = 22;
	browseTitle.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	browseHeader.addControl(browseTitle);
	const refreshListBtn = Button.CreateSimpleButton('refresh-sessions-btn', 'Refresh');
	refreshListBtn.width = '180px'; refreshListBtn.height = '48px';
	refreshListBtn.color = 'white'; refreshListBtn.background = '#374151'; refreshListBtn.cornerRadius = 8;
	refreshListBtn.onPointerClickObservable.add(async () => {
		refreshListBtn.isEnabled = false;
		try { await refreshWorldsTab(); } finally { refreshListBtn.isEnabled = true; }
	});
	browseHeader.addControl(refreshListBtn);
	worldsList.addControl(browseHeader);
	const browseStatus = new TextBlock('browse-status', '');
	browseStatus.color = '#fbbf24'; browseStatus.fontSize = 16; browseStatus.height = '34px';
	worldsList.addControl(browseStatus);
	const joinCodeRow = new StackPanel('join-code-row');
	joinCodeRow.isVertical = false;
	joinCodeRow.height = '56px';
	const joinCodeInput = new InputText('join-code-input');
	joinCodeInput.width = '320px'; joinCodeInput.height = '48px';
	joinCodeInput.color = 'white'; joinCodeInput.background = '#1f2937';
	joinCodeInput.placeholderText = 'Private room code';
	joinCodeRow.addControl(joinCodeInput);
	const joinCodeButton = Button.CreateSimpleButton('join-code-button', 'Join room');
	joinCodeButton.width = '180px'; joinCodeButton.height = '48px';
	joinCodeButton.color = 'white'; joinCodeButton.background = '#2563eb'; joinCodeButton.cornerRadius = 8;
	joinCodeButton.onPointerClickObservable.add(async () => {
		const code = joinCodeInput.text.trim();
		if (!code) return;
		joinCodeButton.isEnabled = false;
		try { await callbacks.onJoinWorld(code); refreshWorldsTab(); }
		catch (error) { browseStatus.text = error instanceof Error ? error.message : 'Could not join room'; }
		finally { joinCodeButton.isEnabled = true; }
	});
	joinCodeRow.addControl(joinCodeButton);
	worldsList.addControl(joinCodeRow);


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
		if (button) button.text = loaded ? `Save as v${(loaded.revisionNumber ?? 0) + 1} of “${loaded.name}”`.slice(0, 40) : 'Save world';
	}

	async function saveWorld(asNew: boolean) {
		const loaded = asNew ? null : gameState.loadedWorld;
		const selected = getInventoryAdapter(loaded?.adapterId ?? gameState.currentInventoryAdapterId ?? 'local');
		const adapter = selected?.isAvailable(getInventoryContext()) ? selected : getInventoryAdapter('local');
		if (!adapter) { saveWorldStatus.color = '#f87171'; saveWorldStatus.text = 'No inventory is available'; return; }
		const folderId = loaded && loaded.adapterId === adapter.id ? loaded.folderId
			: adapter.id === gameState.currentInventoryAdapterId ? gameState.currentInventoryFolderId : null;
		const name = worldNameInput.text.trim() || 'My World';
		saveWorldBtn.isEnabled = saveAsNewBtn.isEnabled = false;
		try {
			const snapshot = sceneGraph.serialize();
			validateWorldScene(snapshot);
			const lineage = loaded && loaded.adapterId === adapter.id ? loaded.worldLineageId : undefined;
			const saved = await adapter.saveItem(getInventoryContext(), folderId, name, snapshot, 'world', lineage);
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

	const publicWorldsTitle = new TextBlock('public-worlds-title', 'Mundos públicos activos');
	publicWorldsTitle.color = '#d1d5db';
	publicWorldsTitle.fontSize = 18;
	publicWorldsTitle.height = '38px';
	publicWorldsTitle.top = '10px';
	worldsList.addControl(publicWorldsTitle);
	const publicSessionsList = new StackPanel('public-sessions-list');
	publicSessionsList.width = 1;
	worldsList.addControl(publicSessionsList);
	const publishedWorldsTitle = new TextBlock('published-worlds-title', 'Published worlds');
	publishedWorldsTitle.color = '#d1d5db';
	publishedWorldsTitle.fontSize = 18;
	publishedWorldsTitle.height = '38px';
	const publishedWorldsList = new StackPanel('published-worlds-list');
	publishedWorldsList.width = 1;
	worldsList.addControl(publishedWorldsTitle);
	worldsList.addControl(publishedWorldsList);

	async function refreshWorldsTab() {
		refreshSaveWorld();
		const isConnected = gameState.role === 'host' || gameState.role === 'guest';
		visibilityOptions.isVisible = !isConnected;
		joinCodeRow.isVisible = !isConnected;
		sessionPanel.isVisible = isConnected;
		publicWorldsTitle.isVisible = gameState.role !== 'guest';
		publishedWorldsTitle.isVisible = true;
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

		for (const child of [...publicSessionsList.children]) publicSessionsList.removeControl(child);
		for (const child of [...publishedWorldsList.children]) publishedWorldsList.removeControl(child);
		void refreshPublishedWorlds();
		if (gameState.role === 'guest') return;
		try {
			const res = await fetch('/api/worlds');
			if (!res.ok) return;
			const sessions = (await res.json()) as Array<{ roomCode: string; world: { name: string } }>;
			if (sessions.length === 0) {
				const empty = new TextBlock('public-worlds-empty', 'No hay sesiones públicas activas ahora.');
				empty.color = '#9ca3af';
				empty.height = '34px';
				publicSessionsList.addControl(empty);
			}
			for (const session of sessions) {
				const row = Button.CreateSimpleButton(`world-${session.roomCode}`, `${session.world.name} · Pública — Unirse`);
				row.height = '56px';
				row.color = 'white';
				row.background = '#1f2937';
				row.cornerRadius = 8;
				row.paddingTop = '6px';
				row.onPointerClickObservable.add(async () => {
					await callbacks.onJoinWorld(session.roomCode);
					refreshWorldsTab();
				});
				publicSessionsList.addControl(row);
			}
		} catch {
			// offline / not reachable — list just stays empty
		}
	}

	async function refreshPublishedWorlds() {
		try {
			const response = await fetch('/api/published-worlds');
			if (!response.ok) return;
			const publications = await response.json() as Array<{ id: string; name: string; ownerId: string; latestRevision: number }>;
			if (publications.length === 0) {
				const empty = new TextBlock('published-worlds-empty', 'No worlds published yet.');
				empty.height = '36px'; empty.color = '#9ca3af'; publishedWorldsList.addControl(empty);
			}
			for (const publication of publications) {
				const row = new StackPanel(`published-row-${publication.id}`);
				row.isVertical = false; row.height = '56px';
				const place = Button.CreateSimpleButton(`published-place-${publication.id}`, `${publication.name} · v${publication.latestRevision} — Place orb`);
				place.width = '440px'; place.height = '52px'; place.color = 'white'; place.background = '#1f2937'; place.cornerRadius = 8;
				place.onPointerClickObservable.add(async () => {
					try {
						const res = await fetch(`/api/published-worlds/${publication.id}`);
						if (!res.ok) throw new Error('Could not load published world');
						callbacks.onSpawnPublishedWorld(await res.json() as WorldPackage);
						browseStatus.text = 'World orb placed.';
					} catch (error) { browseStatus.text = error instanceof Error ? error.message : 'Could not place orb'; }
				});
				row.addControl(place);
				if (publication.ownerId === gameState.userId) {
					const update = Button.CreateSimpleButton(`published-update-${publication.id}`, 'Publish current revision');
					update.width = '250px'; update.height = '52px'; update.color = 'white'; update.background = '#7c3aed'; update.cornerRadius = 8;
					update.onPointerClickObservable.add(async () => {
						try {
							const snapshot = sceneGraph.serialize(); validateWorldScene(snapshot);
							const res = await fetch(`/api/published-worlds/${publication.id}/revisions`, {
								method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scene: snapshot })
							});
							if (!res.ok) throw new Error('Could not publish revision');
							browseStatus.text = 'Revision published.';
							refreshWorldsTab();
						} catch (error) { browseStatus.text = error instanceof Error ? error.message : 'Could not publish revision'; }
					});
					row.addControl(update);
				}
				publishedWorldsList.addControl(row);
			}
		} catch { /* offline */ }
	}

	// --- Inventory tab: root picker + quota bar, breadcrumb, a toolbar that
	// swaps to selection actions, and a scrollable grid of folders/items.
	// Single click selects, double click opens a folder or spawns an item. ---
	const CELL_W = 148;
	const CELL_H = 100;
	const GRID_COLUMNS = 6;
	const DOUBLE_CLICK_MS = 400;

	function topAligned<T extends Control>(control: T, top: number): T {
		control.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		control.top = `${top}px`;
		return control;
	}

	const inventoryRoots = topAligned(new StackPanel('inventory-roots'), 6);
	inventoryRoots.isVertical = false;
	inventoryRoots.height = '44px';
	inventoryRoots.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	inventoryRoots.left = '20px';
	inventoryRoots.adaptWidthToChildren = true;
	contentByTab.Inventory.addControl(inventoryRoots);

	// Usage bar (only for adapters that report it, e.g. cloud storage).
	const quotaTrack = topAligned(new Rectangle('inventory-quota'), 14);
	quotaTrack.width = '300px';
	quotaTrack.height = '28px';
	quotaTrack.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
	quotaTrack.left = '-20px';
	quotaTrack.background = '#1f2937';
	quotaTrack.color = '#374151';
	quotaTrack.thickness = 1;
	quotaTrack.cornerRadius = 6;
	quotaTrack.isVisible = false;
	contentByTab.Inventory.addControl(quotaTrack);
	const quotaFill = new Rectangle('inventory-quota-fill');
	quotaFill.height = 1;
	quotaFill.width = 0;
	quotaFill.thickness = 0;
	quotaFill.cornerRadius = 6;
	quotaFill.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	quotaTrack.addControl(quotaFill);
	const quotaLabel = new TextBlock('inventory-quota-label', '');
	quotaLabel.color = 'white';
	quotaLabel.fontSize = 15;
	quotaTrack.addControl(quotaLabel);

	const inventoryPath = topAligned(new StackPanel('inventory-path'), 56);
	inventoryPath.isVertical = false;
	inventoryPath.height = '36px';
	inventoryPath.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	inventoryPath.left = '20px';
	inventoryPath.adaptWidthToChildren = true;
	contentByTab.Inventory.addControl(inventoryPath);

	const inventoryToolbar = topAligned(new StackPanel('inventory-toolbar'), 98);
	inventoryToolbar.isVertical = false;
	inventoryToolbar.height = '48px';
	inventoryToolbar.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	inventoryToolbar.left = '20px';
	inventoryToolbar.adaptWidthToChildren = true;
	contentByTab.Inventory.addControl(inventoryToolbar);

	function toolbarButton(name: string, text: string, background: string, width: number, onClick: () => void): Button {
		const btn = Button.CreateSimpleButton(name, text);
		btn.width = `${width}px`;
		btn.height = '44px';
		btn.color = 'white';
		btn.background = background;
		btn.cornerRadius = 8;
		btn.paddingRight = '6px';
		btn.fontSize = 18;
		btn.onPointerClickObservable.add(onClick);
		return btn;
	}

	const newFolderBtn = toolbarButton('new-folder-btn', '+ Folder', '#16a34a', 130, async () => {
		if (!activeAdapter) return;
		await activeAdapter.createFolder(getInventoryContext(), currentFolderId(), `Folder ${new Date().toLocaleTimeString()}`);
		refreshList();
	});

	const inventoryScroll = topAligned(new ScrollViewer('inventory-scroll'), 152);
	inventoryScroll.width = 0.96;
	inventoryScroll.height = '360px';
	inventoryScroll.barColor = '#7c3aed';
	inventoryScroll.thickness = 0;
	contentByTab.Inventory.addControl(inventoryScroll);
	const inventoryList = new StackPanel('inventory-list');
	inventoryList.width = 1;
	inventoryScroll.addControl(inventoryList);

	let activeAdapter: InventoryAdapter | null = null;
	// breadcrumb: [{id: null, name: adapter.label}, ...subfolders]
	let path: { id: string | null; name: string }[] = [];

	type Entry =
		| { type: 'folder'; id: string; name: string; folder: InventoryFolder }
		| { type: 'item'; id: string; name: string; item: InventoryItem };
	let selected: Entry | null = null;
	const cellByKey = new Map<string, Rectangle>();
	let lastClick = { key: '', at: 0 };
	let message: { text: string; color: string } | null = null;

	function currentFolderId(): string | null {
		return path.length > 0 ? path[path.length - 1].id : null;
	}

	function setStatus(container: StackPanel, text: string, color = '#9ca3af') {
		for (const child of [...container.children]) container.removeControl(child);
		const t = new TextBlock('inventory-status', text);
		t.color = color;
		t.height = '32px';
		container.addControl(t);
	}

	function showMessage(text: string, color: string) {
		message = { text, color };
		refreshToolbar();
	}

	function entryKey(entry: Entry): string {
		return `${entry.type}:${entry.id}`;
	}

	function select(entry: Entry | null) {
		selected = entry;
		message = null;
		for (const [key, cell] of cellByKey) {
			const isSelected = entry !== null && key === entryKey(entry);
			cell.background = isSelected ? '#2563eb' : '#1f2937';
			cell.color = isSelected ? '#93c5fd' : '#374151';
		}
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
			callbacks.onSpawnWorldOrb(entry.item, adapter.id);
		} else {
			callbacks.onSpawnItem(entry.item.slotData);
		}
	}

	function refreshToolbar() {
		for (const child of [...inventoryToolbar.children]) inventoryToolbar.removeControl(child);
		const adapter = activeAdapter;
		const entry = selected;
		if (!adapter) return;
		if (!entry) {
			if (message) {
				const text = new TextBlock('inventory-message', message.text);
				text.width = '900px'; text.height = '44px'; text.color = message.color; text.fontSize = 17;
				text.textWrapping = true;
				inventoryToolbar.addControl(text);
				return;
			}
			inventoryToolbar.addControl(newFolderBtn);
			return;
		}

		const label = new TextBlock('inventory-selected', entry.name);
		label.width = '240px'; label.height = '44px'; label.color = '#e5e7eb'; label.fontSize = 18;
		label.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		inventoryToolbar.addControl(label);

		if (entry.type === 'folder') {
			inventoryToolbar.addControl(toolbarButton('tb-open', 'Open', '#2563eb', 100, () => activate(entry)));
			inventoryToolbar.addControl(toolbarButton('tb-delete', 'Delete', '#991b1b', 110, async () => {
				await adapter.deleteFolder(getInventoryContext(), entry.id);
				select(null);
				refreshList();
			}));
		} else {
			const item = entry.item;
			const isWorld = item.kind === 'world';
			inventoryToolbar.addControl(toolbarButton('tb-spawn', isWorld ? 'Place orb' : 'Spawn', '#2563eb', isWorld ? 130 : 100, () => activate(entry)));
			if (isWorld) {
				inventoryToolbar.addControl(toolbarButton('tb-load', 'Load', '#0f766e', 90, async () => {
					try { await callbacks.onLaunchWorldItem(item, adapter.id); }
					catch (error) { showMessage(error instanceof Error ? error.message : 'Could not load world', '#f87171'); }
				}));
				if (gameState.userId) {
					inventoryToolbar.addControl(toolbarButton('tb-publish', 'Publish', '#7c3aed', 110, async () => {
						try {
							validateWorldScene(item.slotData);
							const res = await fetch('/api/published-worlds', {
								method: 'POST', headers: { 'content-type': 'application/json' },
								body: JSON.stringify({ name: item.name, scene: item.slotData })
							});
							if (!res.ok) throw new Error('Could not publish world');
							showMessage('World published. Find it in the Worlds tab.', '#86efac');
						} catch (error) { showMessage(error instanceof Error ? error.message : 'Could not publish world', '#f87171'); }
					}));
				}
			}
			if (adapter.updateItem && path.length > 1) {
				const parentId = path[path.length - 2].id;
				inventoryToolbar.addControl(toolbarButton('tb-move', 'Move up', '#374151', 110, async () => {
					try {
						await adapter.updateItem!(getInventoryContext(), item.id, parentId, item.name, item.slotData);
						select(null);
						refreshList();
					} catch (error) { showMessage(error instanceof Error ? error.message : 'Could not move item', '#f87171'); }
				}));
			}
			inventoryToolbar.addControl(toolbarButton('tb-delete', 'Delete', '#991b1b', 110, async () => {
				await adapter.deleteItem(getInventoryContext(), item.id);
				select(null);
				refreshList();
			}));
		}
		inventoryToolbar.addControl(toolbarButton('tb-close', '✕', '#374151', 50, () => select(null)));
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
		quotaTrack.isVisible = false;
		if (!adapter?.usage) return;
		try {
			const usage = await adapter.usage(getInventoryContext());
			if (adapter !== activeAdapter || !usage) return;
			const format = usage.unit === 'bytes' ? formatBytes : (n: number) => String(n);
			const limited = usage.total > 0;
			const ratio = limited ? Math.min(1, usage.used / usage.total) : 0;
			quotaFill.width = ratio;
			quotaFill.background = ratio > 0.9 ? '#dc2626' : ratio > 0.75 ? '#d97706' : '#16a34a';
			quotaLabel.text = limited ? `${format(usage.used)} / ${format(usage.total)}` : `${format(usage.used)} used`;
			quotaTrack.isVisible = true;
		} catch {
			// usage is informational; keep the bar hidden
		}
	}

	function refreshPath() {
		for (const child of [...inventoryPath.children]) inventoryPath.removeControl(child);
		path.forEach((crumb, i) => {
			const btn = Button.CreateSimpleButton(`crumb-${i}`, crumb.name);
			btn.height = '34px';
			btn.width = `${Math.min(220, 40 + crumb.name.length * 11)}px`;
			btn.fontSize = 16;
			btn.color = 'white';
			btn.background = i === path.length - 1 ? '#2563eb' : '#1f2937';
			btn.cornerRadius = 6;
			btn.paddingRight = '4px';
			btn.onPointerClickObservable.add(() => {
				path = path.slice(0, i + 1);
				gameState.currentInventoryFolderId = crumb.id;
				selected = null;
				refreshPath();
				refreshList();
			});
			inventoryPath.addControl(btn);
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

	function createCell(entry: Entry, icon: string): Rectangle {
		const key = entryKey(entry);
		const cell = new Rectangle(`cell-${key}`);
		cell.width = `${CELL_W}px`;
		cell.height = `${CELL_H}px`;
		cell.background = '#1f2937';
		cell.color = '#374151';
		cell.thickness = 2;
		cell.cornerRadius = 8;
		cell.isPointerBlocker = true;
		cell.hoverCursor = 'pointer';

		const iconText = new TextBlock(`cell-icon-${key}`, icon);
		iconText.fontSize = 28;
		iconText.height = '36px';
		iconText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		iconText.top = '4px';
		iconText.color = 'white';
		cell.addControl(iconText);

		const nameW = CELL_W - 14;
		const nameH = CELL_H - 46;
		const name = new TextBlock(`cell-name-${key}`, entry.name);
		name.width = `${nameW}px`;
		name.height = `${nameH}px`;
		name.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
		name.top = '-4px';
		name.textWrapping = true;
		name.color = 'white';
		name.fontSize = fitFontSize(entry.name, nameW, nameH);
		cell.addControl(name);

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
		return cell;
	}

	async function refreshList() {
		if (!activeAdapter) return;
		const adapter = activeAdapter;
		const folderId = currentFolderId();
		setStatus(inventoryList, 'Loading…');
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
			setStatus(inventoryList, 'Could not load the inventory (see console)', '#f87171');
			return;
		}
		if (adapter !== activeAdapter) return;

		for (const child of [...inventoryList.children]) inventoryList.removeControl(child);
		const entries: Array<{ entry: Entry; icon: string }> = [
			...folders.map((folder) => ({ entry: { type: 'folder', id: folder.id, name: folder.name, folder } as Entry, icon: '📁' })),
			...items.map((item) => ({ entry: { type: 'item', id: item.id, name: item.name, item } as Entry, icon: item.kind === 'world' ? '🌍' : '📦' }))
		];
		if (entries.length === 0) {
			setStatus(inventoryList, '(empty)');
			select(null);
			return;
		}
		for (let start = 0; start < entries.length; start += GRID_COLUMNS) {
			const row = new StackPanel(`inventory-row-${start}`);
			row.isVertical = false;
			row.height = `${CELL_H + 8}px`;
			row.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
			for (const { entry, icon } of entries.slice(start, start + GRID_COLUMNS)) {
				const cell = createCell(entry, icon);
				cell.paddingRight = '6px';
				cell.paddingBottom = '6px';
				row.addControl(cell);
			}
			inventoryList.addControl(row);
		}
		// Keep the selection across a refresh if the entry still exists.
		const keep = selected && cellByKey.has(entryKey(selected)) ? selected : null;
		select(keep);
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
			const btn = Button.CreateSimpleButton(`root-${folder.id}`, folder.label);
			btn.width = '160px';
			btn.height = '42px';
			btn.fontSize = 18;
			btn.color = 'white';
			btn.background = folder === activeAdapter ? '#2563eb' : '#374151';
			btn.cornerRadius = 8;
			btn.paddingRight = '6px';
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

	// --- Settings tab: locomotion (movement + turn mode) ---
	const settingsPanel = new StackPanel('settings-panel');
	settingsPanel.width = 0.85;
	settingsPanel.top = '10px';
	contentByTab.Settings.addControl(settingsPanel);

	function settingsSection(title: string): StackPanel {
		const label = new TextBlock(`label-${title}`, title);
		label.color = '#9ca3af';
		label.fontSize = 18;
		label.height = '32px';
		label.top = '8px';
		settingsPanel.addControl(label);

		const row = new StackPanel(`row-${title}`);
		row.isVertical = false;
		row.height = '56px';
		settingsPanel.addControl(row);
		return row;
	}

	function optionButton(row: StackPanel, key: string, text: string, isActive: () => boolean, onClick: () => void): Button {
		const btn = Button.CreateSimpleButton(key, text);
		btn.width = '240px';
		btn.height = '52px';
		btn.color = 'white';
		btn.cornerRadius = 8;
		btn.paddingRight = '8px';
		btn.background = isActive() ? '#2563eb' : '#374151';
		btn.onPointerClickObservable.add(() => {
			onClick();
			refreshSettingsTab();
		});
		row.addControl(btn);
		return btn;
	}

	const movementRow = settingsSection('Movimiento');
	const rotationRow = settingsSection('Giro');

	function refreshSettingsTab() {
		for (const child of [...movementRow.children]) movementRow.removeControl(child);
		for (const child of [...rotationRow.children]) rotationRow.removeControl(child);

		const movementOptions: [MovementMode, string][] = [
			['teleport', 'Teleport'],
			['smooth', 'Fluido']
		];
		for (const [mode, label] of movementOptions) {
			optionButton(
				movementRow,
				`move-${mode}`,
				label,
				() => xrSettings.movementMode === mode,
				() => {
					xrSettings.movementMode = mode;
					saveSettings();
					callbacks.onLocomotionSettingsChanged();
				}
			);
		}

		const rotationOptions: [RotationMode, string][] = [
			['smooth', 'Fluido'],
			['snap-45', '45°'],
			['snap-90', '90°']
		];
		for (const [mode, label] of rotationOptions) {
			optionButton(
				rotationRow,
				`rotate-${mode}`,
				label,
				() => xrSettings.rotationMode === mode,
				() => {
					xrSettings.rotationMode = mode;
					saveSettings();
					callbacks.onLocomotionSettingsChanged();
				}
			);
		}
	}
	refreshSettingsTab();

	// --- Account tab (login/register/logout, in-VR via VirtualKeyboard) ---
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

	const virtualKeyboard = VirtualKeyboard.CreateDefaultLayout('dash-keyboard');
	virtualKeyboard.top = '260px';
	joinCodeInput.onFocusObservable.add(() => { virtualKeyboard.isVisible = true; virtualKeyboard.connect(joinCodeInput); });
	joinCodeInput.onBlurObservable.add(() => { virtualKeyboard.isVisible = false; virtualKeyboard.disconnect(joinCodeInput); });
	worldNameInput.onFocusObservable.add(() => { virtualKeyboard.isVisible = true; virtualKeyboard.connect(worldNameInput); });
	worldNameInput.onBlurObservable.add(() => { virtualKeyboard.isVisible = false; virtualKeyboard.disconnect(worldNameInput); });
	virtualKeyboard.isVisible = false;
	background.addControl(virtualKeyboard);
	emailInput.onFocusObservable.add(() => {
		virtualKeyboard.isVisible = true;
		virtualKeyboard.connect(emailInput);
	});
	usernameInput.onFocusObservable.add(() => {
		virtualKeyboard.isVisible = true;
		virtualKeyboard.connect(usernameInput);
	});
	passwordInput.onFocusObservable.add(() => {
		virtualKeyboard.isVisible = true;
		virtualKeyboard.connect(passwordInput);
	});
	for (const input of [emailInput, usernameInput, passwordInput]) {
		input.onBlurObservable.add(() => {
			virtualKeyboard.isVisible = false;
			virtualKeyboard.disconnect(input);
		});
	}

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

	showTab('Session');

	return {
		root: node,
		refreshWorldsTab
	};
}
