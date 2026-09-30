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
	ScrollViewer,
	Image
} from '@babylonjs/gui';
import { createSlot, type SlotTree } from '$lib/ecs/types';
import type { SceneGraph } from '../sceneGraph';
import { authClient } from '$lib/auth-client';
import { availableInventoryFolders, getInventoryAdapter } from '$lib/inventory/registry';
import type { InventoryAdapter, InventoryAdapterId, InventoryStorageAdapterId, InventoryFolder, InventoryItem } from '$lib/inventory/types';
import { validateWorldScene } from '$lib/worlds/package';
import { ensureCloudAssets } from '$lib/assets/cloudSync';
import { getLocalAssetStore } from '$lib/assets/store';
import type { WorldPackage } from '$lib/worlds/types';
import { gameState, getInventoryContext } from '../gameState';
import { xrSettings, saveSettings, type MovementMode, type RotationMode } from '../settings';
import { dashboardEditorOrder, dashboardItemLabel, moveDashboardItem, toggleDashboardItem, type DashboardItemId } from '../dashboardLayout';
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
	/** Makes an avatar item the one worn from now on, here and in every world joined later. Rejects with a readable message if it cannot be worn. */
	onSetDefaultAvatar(item: InventoryItem): Promise<void>;
	onLocomotionSettingsChanged(): void;
	onExitVr(): Promise<void>;
	onToggleInspector(): void;
	/** Seated mode was switched on or off (`xrSettings.seatedMode` already holds the new value). */
	onSeatedModeChanged(): void;
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
			const snapshot = sceneGraph.serialize({ withoutAvatars: true });
			validateWorldScene(snapshot);
			const lineage = loaded && loaded.adapterId === adapter.id ? loaded.worldLineageId : undefined;
			if (!adapter.saveItem || adapter.id === 'purchased') throw new Error('This inventory is read-only');
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
	const marketplaceTitle = new TextBlock('marketplace-title', 'Marketplace');
	marketplaceTitle.color = '#d1d5db'; marketplaceTitle.fontSize = 18; marketplaceTitle.height = '38px'; marketplaceTitle.top = '14px';
	const marketplaceList = new StackPanel('marketplace-list'); marketplaceList.width = 1;
	worldsList.addControl(marketplaceTitle); worldsList.addControl(marketplaceList);

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
		for (const child of [...marketplaceList.children]) marketplaceList.removeControl(child);
		void refreshPublishedWorlds();
		void refreshMarketplaceCatalog();
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
							const snapshot = sceneGraph.serialize({ withoutAvatars: true }); validateWorldScene(snapshot);
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

	async function refreshMarketplaceCatalog() {
		try {
			const [catalogResponse, purchasesResponse] = await Promise.all([
			fetch('/api/marketplace/items'),
			gameState.userId ? fetch('/api/marketplace/purchases') : Promise.resolve(null)
		]);
		if (!catalogResponse.ok) return;
		const items = await catalogResponse.json() as Array<{ id: string; name: string; description: string; latestRevision: number; containsCode: boolean; thumbnailUrl: string | null }>;
		const purchases = purchasesResponse?.ok ? await purchasesResponse.json() as Array<{ marketplaceItemId?: string }> : [];
		const acquired = new Set(purchases.map((item) => item.marketplaceItemId).filter(Boolean));
		if (!items.length) {
			const empty = new TextBlock('marketplace-empty', 'No objects listed yet.'); empty.height = '34px'; empty.color = '#9ca3af'; marketplaceList.addControl(empty); return;
		}
		for (const item of items) {
			const row = new StackPanel(`marketplace-row-${item.id}`); row.isVertical = true; row.height = item.containsCode ? '104px' : '64px'; row.width = 1;
			const line = new StackPanel(`marketplace-line-${item.id}`); line.isVertical = false; line.height = '56px'; line.width = 1;
			if (item.thumbnailUrl) { const thumbnail = new Image(`marketplace-thumbnail-${item.id}`, item.thumbnailUrl); thumbnail.width = '54px'; thumbnail.height = '48px'; thumbnail.stretch = Image.STRETCH_UNIFORM; line.addControl(thumbnail); }
			const info = new TextBlock(`marketplace-info-${item.id}`, `${item.name} · v${item.latestRevision}${item.description ? `\n${item.description.slice(0, 100)}` : ''}`);
			info.width = '560px'; info.height = '54px'; info.color = '#e2e8f0'; info.fontSize = 15; info.textWrapping = true; info.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT; line.addControl(info);
			const button = Button.CreateSimpleButton(`marketplace-acquire-${item.id}`, acquired.has(item.id) ? 'Acquired' : 'Acquire');
			button.width = '140px'; button.height = '48px'; button.color = 'white'; button.background = acquired.has(item.id) ? '#334155' : '#7c3aed'; button.cornerRadius = 8; button.isEnabled = !acquired.has(item.id);
			button.onPointerClickObservable.add(async () => {
				try { const response = await fetch(`/api/marketplace/items/${item.id}/purchase`, { method: 'POST' }); if (!response.ok) throw new Error(response.status === 401 ? 'Sign in to acquire this object.' : 'Could not acquire this object.'); button.textBlock!.text = 'Acquired'; button.background = '#334155'; button.isEnabled = false; browseStatus.text = 'Added to Purchased Objects inventory.'; }
				catch (err) { browseStatus.text = err instanceof Error ? err.message : 'Could not acquire this object'; }
			});
			line.addControl(button); row.addControl(line);
			if (item.containsCode) { const warning = new TextBlock(`marketplace-code-warning-${item.id}`, 'Warning: This product may execute potentially dangerous code.'); warning.height = '36px'; warning.color = '#fbbf24'; warning.fontSize = 15; warning.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT; row.addControl(warning); }
			marketplaceList.addControl(row);
		}
		} catch { /* keep the rest of the Worlds tab usable while offline */ }
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
			if (adapter.id === 'purchased') return;
			callbacks.onSpawnWorldOrb(entry.item, adapter.id);
			showMessage(`Placed “${entry.name}” as a world orb`, 'ok');
		} else if (entry.item.kind === 'avatar') {
			void setDefaultAvatar(entry.item);
		} else {
			callbacks.onSpawnItem(entry.item.slotData);
		}
	}

	async function setDefaultAvatar(item: InventoryItem) {
		try {
			await callbacks.onSetDefaultAvatar(item);
			showMessage(`Now wearing “${item.name}”`, 'ok');
		} catch (error) { showMessage(error instanceof Error ? error.message : 'Could not use this avatar', 'error'); }
	}

	function refreshToolbar() {
		for (const child of [...inventoryToolbar.children]) inventoryToolbar.removeControl(child);
		const adapter = activeAdapter;
		const entry = selected;
		if (!adapter) return;
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
			if (isAvatar) inventoryToolbar.addControl(actionButton('tb-set-avatar', 'Set as default', INV.accent, 150, () => activate(entry)));
			else inventoryToolbar.addControl(actionButton('tb-spawn', isWorld ? 'Place orb' : 'Spawn', INV.accent, isWorld ? 116 : 94, () => activate(entry)));
			if (!isWorld && gameState.userId && (adapter.id !== 'world' || gameState.role === 'host')) {
				inventoryToolbar.addControl(actionButton('tb-marketplace', item.marketplaceItemId ? 'Update Marketplace' : 'Publish', '#7c3aed', 160, async () => {
					try {
						await ensureCloudAssets(item.slotData, getLocalAssetStore());
						const body: Record<string, unknown> = { name: item.name, description: '', thumbnailUrl: null, slotData: item.slotData };
						const response = item.marketplaceItemId
							? await fetch(`/api/marketplace/items/${item.marketplaceItemId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slotData: item.slotData }) })
							: await fetch('/api/marketplace/items', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, source: adapter.id === 'local' ? undefined : { adapterId: adapter.id, itemId: item.id, worldId: gameState.worldId } }) });
						if (!response.ok) throw new Error(response.status === 401 ? 'Sign in to publish objects.' : 'Could not publish marketplace object.');
						const result = await response.json() as { id: string; latestRevision: number };
						if (adapter.id === 'local') await adapter.setMarketplaceItemId?.(getInventoryContext(), item.id, result.id);
						item.marketplaceItemId = result.id;
						showMessage(`Marketplace revision ${result.latestRevision} published.`, 'ok');
					} catch (error) { showMessage(error instanceof Error ? error.message : 'Could not publish marketplace object', 'error'); }
				}));
			}
			if (isWorld) {
				inventoryToolbar.addControl(actionButton('tb-load', 'Load', '#0f766e', 84, async () => {
					if (adapter.id === 'purchased') return;
					try { await callbacks.onLaunchWorldItem(item, adapter.id); }
					catch (error) { showMessage(error instanceof Error ? error.message : 'Could not load world', 'error'); }
				}));
				if (gameState.userId) {
					inventoryToolbar.addControl(actionButton('tb-publish', 'Publish', '#7c3aed', 100, async () => {
						try {
							validateWorldScene(item.slotData);
							const res = await fetch('/api/published-worlds', {
								method: 'POST', headers: { 'content-type': 'application/json' },
								body: JSON.stringify({ name: item.name, scene: item.slotData })
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

		if (entry.type === 'item' && entry.item.thumbnailUrl) { const thumbnail = new Image(`cell-thumbnail-${key}`, entry.item.thumbnailUrl); thumbnail.width = '58px'; thumbnail.height = '58px'; thumbnail.stretch = Image.STRETCH_UNIFORM; thumbnail.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT; thumbnail.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP; thumbnail.left = '10px'; thumbnail.top = '10px'; thumbnail.isHitTestVisible = false; cell.addControl(thumbnail); }

		const tag = new TextBlock(`cell-meta-${key}`, meta);
		tag.fontSize = 13; tag.color = INV.muted;
		tag.width = `${CELL_W - 64}px`; tag.height = '20px';
		tag.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		tag.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		tag.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		tag.left = '56px'; tag.top = '10px';
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
	const seatedRow = settingsSection('Seated mode');

	function refreshSettingsTab() {
		for (const child of [...movementRow.children]) movementRow.removeControl(child);
		for (const child of [...rotationRow.children]) rotationRow.removeControl(child);
		for (const child of [...seatedRow.children]) seatedRow.removeControl(child);

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

		for (const [enabled, label] of [[false, 'Standing'], [true, 'Seated (head at 1.7 m)']] as const) {
			optionButton(seatedRow, `seated-${enabled}`, label, () => xrSettings.seatedMode === enabled, () => setSeatedMode(enabled));
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

	showTab('Home');

	return {
		root: node,
		refreshWorldsTab
	};
}
