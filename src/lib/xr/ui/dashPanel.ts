import type { Scene, TransformNode, Mesh } from '@babylonjs/core';
import {
	AdvancedDynamicTexture,
	Rectangle,
	StackPanel,
	TextBlock,
	Button,
	InputText,
	VirtualKeyboard,
	Control
} from '@babylonjs/gui';
import { createSlot, type SlotTree } from '$lib/ecs/types';
import type { SceneGraph } from '../sceneGraph';
import { authClient } from '$lib/auth-client';
import { availableInventoryFolders, getInventoryAdapter } from '$lib/inventory/registry';
import type { InventoryAdapter, InventoryFolder, InventoryItem } from '$lib/inventory/types';
import { gameState, getInventoryContext } from '../gameState';
import { xrSettings, saveSettings, type MovementMode, type RotationMode } from '../settings';

const TABS = ['Worlds', 'Inventory', 'Settings', 'Account'] as const;
type Tab = (typeof TABS)[number];

export interface DashPanelCallbacks {
	onHostWorld(): Promise<void>;
	onJoinWorld(roomCode: string): void;
	onSpawnItem(slotData: SlotTree): void;
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
			{ type: 'meshRenderer', meshRef: 'plane' },
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
	let activeTab: Tab = 'Worlds';

	function showTab(tab: Tab) {
		activeTab = tab;
		for (const t of TABS) contentByTab[t].isVisible = t === tab;
		if (tab === 'Worlds') refreshWorldsTab();
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

	// --- Worlds tab ---
	const worldsList = new StackPanel('worlds-list');
	worldsList.width = 0.9;
	worldsList.top = '10px';
	contentByTab.Worlds.addControl(worldsList);

	const hostBtn = Button.CreateSimpleButton('host-btn', 'Alojar este mundo');
	hostBtn.height = '56px';
	hostBtn.color = 'white';
	hostBtn.background = '#16a34a';
	hostBtn.cornerRadius = 8;
	hostBtn.paddingTop = '8px';
	hostBtn.onPointerClickObservable.add(() => {
		hostBtn.textBlock!.text = 'Alojando…';
		callbacks.onHostWorld().finally(() => {
			hostBtn.textBlock!.text = 'Alojar este mundo';
		});
	});
	worldsList.addControl(hostBtn);

	async function refreshWorldsTab() {
		for (const child of [...worldsList.children]) {
			if (child !== hostBtn) worldsList.removeControl(child);
		}
		hostBtn.isVisible = gameState.role === 'solo';

		try {
			const res = await fetch('/api/worlds');
			const sessions = (await res.json()) as Array<{
				roomCode: string;
				world: { name: string };
			}>;
			for (const session of sessions) {
				const row = Button.CreateSimpleButton(`world-${session.roomCode}`, `${session.world.name} — Unirse`);
				row.height = '56px';
				row.color = 'white';
				row.background = '#1f2937';
				row.cornerRadius = 8;
				row.paddingTop = '6px';
				row.onPointerClickObservable.add(() => callbacks.onJoinWorld(session.roomCode));
				worldsList.addControl(row);
			}
		} catch {
			// offline / not reachable — list just stays empty
		}
	}

	// --- Inventory tab: root picker, then folder browsing (breadcrumb + new
	// folder) within that root, then items (with delete) ---
	const inventoryRoots = new StackPanel('inventory-roots');
	inventoryRoots.isVertical = false;
	inventoryRoots.height = '52px';
	inventoryRoots.top = '10px';
	contentByTab.Inventory.addControl(inventoryRoots);

	const inventoryPath = new StackPanel('inventory-path');
	inventoryPath.isVertical = false;
	inventoryPath.height = '44px';
	inventoryPath.top = '68px';
	contentByTab.Inventory.addControl(inventoryPath);

	const inventoryActions = new StackPanel('inventory-actions');
	inventoryActions.isVertical = false;
	inventoryActions.height = '48px';
	inventoryActions.top = '116px';
	contentByTab.Inventory.addControl(inventoryActions);

	const inventoryList = new StackPanel('inventory-list');
	inventoryList.width = 0.9;
	inventoryList.top = '172px';
	contentByTab.Inventory.addControl(inventoryList);

	let activeAdapter: InventoryAdapter | null = null;
	// breadcrumb: [{id: null, name: adapter.label}, ...subfolders]
	let path: { id: string | null; name: string }[] = [];

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

	function refreshPath() {
		for (const child of [...inventoryPath.children]) inventoryPath.removeControl(child);
		path.forEach((crumb, i) => {
			const btn = Button.CreateSimpleButton(`crumb-${i}`, crumb.name);
			btn.height = '40px';
			btn.color = 'white';
			btn.background = i === path.length - 1 ? '#2563eb' : '#1f2937';
			btn.cornerRadius = 6;
			btn.paddingRight = '4px';
			btn.onPointerClickObservable.add(() => {
				path = path.slice(0, i + 1);
				gameState.currentInventoryFolderId = crumb.id;
				refreshPath();
				refreshList();
			});
			inventoryPath.addControl(btn);
		});
	}

	async function refreshList() {
		if (!activeAdapter) return;
		const adapter = activeAdapter;
		const folderId = currentFolderId();
		setStatus(inventoryList, 'Cargando…');

		let folders: InventoryFolder[] = [];
		let items: InventoryItem[] = [];
		try {
			[folders, items] = await Promise.all([
				adapter.listFolders(getInventoryContext(), folderId),
				adapter.listItems(getInventoryContext(), folderId)
			]);
		} catch (err) {
			console.error(`Failed to list inventory (${adapter.id})`, err);
			setStatus(inventoryList, 'Error al cargar el inventario (ver consola)', '#f87171');
			return;
		}

		for (const child of [...inventoryList.children]) inventoryList.removeControl(child);
		if (folders.length === 0 && items.length === 0) {
			setStatus(inventoryList, '(vacío)');
		}

		for (const folder of folders) {
			const row = new StackPanel(`folder-row-${folder.id}`);
			row.isVertical = false;
			row.height = '52px';
			row.paddingTop = '4px';

			const openBtn = Button.CreateSimpleButton(`folder-open-${folder.id}`, `📁 ${folder.name}`);
			openBtn.width = '340px';
			openBtn.height = '52px';
			openBtn.color = 'white';
			openBtn.background = '#1f2937';
			openBtn.cornerRadius = 8;
			openBtn.onPointerClickObservable.add(() => {
				path = [...path, { id: folder.id, name: folder.name }];
				gameState.currentInventoryFolderId = folder.id;
				refreshPath();
				refreshList();
			});
			row.addControl(openBtn);

			const deleteBtn = Button.CreateSimpleButton(`folder-del-${folder.id}`, '✕');
			deleteBtn.width = '52px';
			deleteBtn.height = '52px';
			deleteBtn.color = 'white';
			deleteBtn.background = '#7f1d1d';
			deleteBtn.cornerRadius = 8;
			deleteBtn.onPointerClickObservable.add(async () => {
				await adapter.deleteFolder(getInventoryContext(), folder.id);
				refreshList();
			});
			row.addControl(deleteBtn);

			inventoryList.addControl(row);
		}

		for (const item of items) {
			const row = new StackPanel(`item-row-${item.id}`);
			row.isVertical = false;
			row.height = '52px';
			row.paddingTop = '4px';

			const spawnBtn = Button.CreateSimpleButton(`item-spawn-${item.id}`, `${item.name} — Generar`);
			spawnBtn.width = '340px';
			spawnBtn.height = '52px';
			spawnBtn.color = 'white';
			spawnBtn.background = '#1f2937';
			spawnBtn.cornerRadius = 8;
			spawnBtn.onPointerClickObservable.add(() => callbacks.onSpawnItem(item.slotData));
			row.addControl(spawnBtn);

			const deleteBtn = Button.CreateSimpleButton(`item-del-${item.id}`, '✕');
			deleteBtn.width = '52px';
			deleteBtn.height = '52px';
			deleteBtn.color = 'white';
			deleteBtn.background = '#7f1d1d';
			deleteBtn.cornerRadius = 8;
			deleteBtn.onPointerClickObservable.add(async () => {
				await adapter.deleteItem(getInventoryContext(), item.id);
				refreshList();
			});
			row.addControl(deleteBtn);

			inventoryList.addControl(row);
		}
	}

	function selectAdapter(adapter: InventoryAdapter) {
		activeAdapter = adapter;
		gameState.currentInventoryAdapterId = adapter.id;
		gameState.currentInventoryFolderId = null;
		path = [{ id: null, name: adapter.label }];
		refreshRoots();
		refreshPath();
		refreshList();
	}

	function refreshRoots() {
		for (const child of [...inventoryRoots.children]) inventoryRoots.removeControl(child);
		for (const child of [...inventoryActions.children]) inventoryActions.removeControl(child);

		const folders = availableInventoryFolders(getInventoryContext());
		for (const folder of folders) {
			const btn = Button.CreateSimpleButton(`root-${folder.id}`, folder.label);
			btn.width = '180px';
			btn.height = '48px';
			btn.color = 'white';
			btn.background = folder === activeAdapter ? '#2563eb' : '#374151';
			btn.cornerRadius = 8;
			btn.onPointerClickObservable.add(() => selectAdapter(folder));
			inventoryRoots.addControl(btn);
		}

		if (activeAdapter) {
			const newFolderBtn = Button.CreateSimpleButton('new-folder-btn', '+ Carpeta');
			newFolderBtn.width = '140px';
			newFolderBtn.height = '44px';
			newFolderBtn.color = 'white';
			newFolderBtn.background = '#16a34a';
			newFolderBtn.cornerRadius = 8;
			newFolderBtn.onPointerClickObservable.add(async () => {
				if (!activeAdapter) return;
				const name = `Carpeta ${new Date().toLocaleTimeString()}`;
				await activeAdapter.createFolder(getInventoryContext(), currentFolderId(), name);
				refreshList();
			});
			inventoryActions.addControl(newFolderBtn);
		}

		if (!activeAdapter && folders[0]) selectAdapter(folders[0]);
	}

	function refreshInventoryTab() {
		refreshRoots();
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
	statusText.height = '40px';
	settingsStack.addControl(statusText);

	const emailInput = new InputText('email-input');
	emailInput.width = 1;
	emailInput.height = '48px';
	emailInput.color = 'white';
	emailInput.background = '#1f2937';
	emailInput.placeholderText = 'Email';
	settingsStack.addControl(emailInput);

	const usernameInput = new InputText('username-input');
	usernameInput.width = 1;
	usernameInput.height = '48px';
	usernameInput.color = 'white';
	usernameInput.background = '#1f2937';
	usernameInput.placeholderText = 'Usuario (para registrarte, o para entrar sin email)';
	usernameInput.margin = '4px';
	settingsStack.addControl(usernameInput);

	const passwordInput = new InputText('password-input');
	passwordInput.width = 1;
	passwordInput.height = '48px';
	passwordInput.color = 'white';
	passwordInput.background = '#1f2937';
	passwordInput.placeholderText = 'Contraseña';
	passwordInput.margin = '4px';
	settingsStack.addControl(passwordInput);

	const virtualKeyboard = VirtualKeyboard.CreateDefaultLayout('dash-keyboard');
	virtualKeyboard.top = '260px';
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

	authButton('login-btn', 'Entrar', async () => {
		statusText.text = 'Entrando…';
		// no email typed but a username was -> log in by username instead
		const { error } =
			!emailInput.text && usernameInput.text
				? await authClient.signIn.username({ username: usernameInput.text, password: passwordInput.text })
				: await authClient.signIn.email({ email: emailInput.text, password: passwordInput.text });
		statusText.text = error ? (error.message ?? 'Error al entrar') : '';
		await refreshSession();
	});

	authButton('register-btn', 'Registrarse', async () => {
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

	authButton('discord-btn', 'Discord', async () => {
		await authClient.signIn.social({ provider: 'discord', callbackURL: window.location.href });
	});

	const logoutBtn = authButton('logout-btn', 'Salir', async () => {
		await authClient.signOut();
		await refreshSession();
	});
	logoutBtn.isVisible = false;

	async function refreshSession() {
		const { data } = await authClient.getSession();
		gameState.userId = data?.user.id ?? null;
		gameState.userName = data?.user.name ?? null;
		statusText.text = data?.user ? `Sesión: ${data.user.name}` : 'Sin sesión';
		logoutBtn.isVisible = Boolean(data?.user);
		refreshInventoryTab();
	}
	void refreshSession();

	showTab('Worlds');

	return {
		root: node,
		refreshWorldsTab
	};
}
