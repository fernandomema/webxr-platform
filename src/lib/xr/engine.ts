// Registers the glTF/GLB loader. Babylon loads each controller's model as a .glb and only
// initialises the motion controller (trigger, thumbstick, laser) once that load succeeds.
import '@babylonjs/loaders/glTF';
import {
	Engine,
	Scene,
	HemisphericLight,
	Vector3,
	UniversalCamera,
	WebXRState,
	WebXRMotionControllerManager,
	PointerEventTypes,
	type AbstractMesh,
	type WebXRDefaultExperience
} from '@babylonjs/core';
import lobbyTemplate from './templates/lobby.json';
import type { SlotTree } from '$lib/ecs/types';
import { instantiate } from '$lib/ecs/serialize';
import { isBuiltinMesh, migrateSlotTree } from '$lib/assets/ref';
import type { AssetResolver } from '$lib/assets/resolve';
import { CloudResolver } from '$lib/assets/cloud';
import { getLocalAssetStore } from '$lib/assets/store';
import { ModelLibrary } from './modelLibrary';
import { SceneGraph } from './sceneGraph';
import { GrabSystem } from './interaction/grabSystem';
import { EquipmentSystem } from './interaction/equipmentSystem';
import { PressableButtonSystem } from './interaction/pressableButtonSystem';
import { setupPointerAndGrabControllers } from './interaction/pointerController';
import { setupPanelToggle } from './interaction/panelToggle';
import { setupRotationController } from './interaction/rotationController';
import { setupMovementController } from './interaction/movementController';
import { setupPlayerBody } from './interaction/playerBody';
import { setupLocomotion } from './locomotion';
import { setupHandControllerSwitch } from './interaction/handControllerSwitch';
import { createDashPanel } from './ui/dashPanel';
import { createInspectorPanel } from './ui/inspectorPanel';
import { setupRadialMenuForHand } from './ui/radialMenu';
import { loadSettings } from './settings';
import { HostAuthority } from './net/hostAuthority';
import { GuestSync } from './net/guestSync';
import { ProximityVoice } from './net/voice';
import { parseIceServers } from './net/peerConnection';
import { authClient } from '$lib/auth-client';
import { gameState, type LoadedWorld } from './gameState';
import type { HostedWorldVisibility } from '$lib/worldVisibility';
import type { PlayerInfo } from './net/protocol';
import { PUBLIC_STUN_URLS } from '$env/static/public';
import { createWorldOrb, copyScene, validateWorldPackage, validateWorldScene, worldFromInventory, MAX_SHARED_SCENE_BYTES } from '$lib/worlds/package';
import type { WorldPackage } from '$lib/worlds/types';
import type { InventoryAdapterId, InventoryItem } from '$lib/inventory/types';
import { createWorldPortalMenu } from './ui/worldPortalMenu';
import { getInventoryAdapter } from '$lib/inventory/registry';
import { getInventoryContext } from './gameState';

export interface MountedGame {
	xrSupported: boolean;
	enterVR(): Promise<void>;
	dispose(): void;
}

export interface MountGameOptions {
	onXRStateChange?: (state: 'in-xr' | 'not-in-xr') => void;
}

/** Boots the whole game (the "juego base" — works with zero login, zero network). */
export async function mountGame(
	canvas: HTMLCanvasElement,
	initialRoomCode?: string,
	options: MountGameOptions = {}
): Promise<MountedGame> {
	// Babylon 9 no longer creates its audio engine by default; without it every Sound (audio players,
	// generated impact sounds) has no backend and throws on use.
	const engine = new Engine(canvas, true, { audioEngine: true });
	const scene = new Scene(engine);

	new HemisphericLight('light', new Vector3(0, 1, 0), scene);

	const desktopCamera = new UniversalCamera('desktop-cam', new Vector3(0, 1.6, 2), scene);
	desktopCamera.setTarget(new Vector3(0, 1.4, 0));
	desktopCamera.attachControl(canvas, true);
	desktopCamera.keysUp.push(87); // W
	desktopCamera.keysDown.push(83); // S
	desktopCamera.keysLeft.push(65); // A
	desktopCamera.keysRight.push(68); // D
	scene.activeCamera = desktopCamera;

	let hostAuthority: HostAuthority | null = null;
	let guestSync: GuestSync | null = null;
	// Models are found on this device first; the cloud and the session host are added to this list as they become available.
	const assetResolvers: AssetResolver[] = [new CloudResolver()];
	const models = new ModelLibrary(scene, { store: getLocalAssetStore(), getResolvers: () => assetResolvers });
	let viewerCamera: () => { globalPosition: Vector3 } = () => desktopCamera;
	const sceneGraph = new SceneGraph(scene, {
		models,
		getViewerPosition: () => viewerCamera().globalPosition,
		onMediaControl: (slotId, action) => {
			// Apply immediately on the local client so a click also unlocks
			// browser audio/video policies; the host remains authoritative.
			sceneGraph.controlMedia(slotId, action);
			if (gameState.role === 'guest') guestSync?.requestMediaControl(slotId, action);
			else hostAuthority?.broadcastSnapshot();
		},
		onUIEvent: (event) => {
			if (gameState.role === 'guest') guestSync?.requestUIEvent(event);
			else if (sceneGraph.dispatchUIEvent(event) && event.type !== 'change') hostAuthority?.broadcastSnapshot();
		},
		isHost: () => gameState.role !== 'guest',
		// codeBlock's world.spawn()/deleteSelf()/deleteSlot() — same routing as
		// spawnFromInventory/radialNetwork.onDelete below, just reusable for scripts.
		onSpawnRequest: (slot) => {
			sceneGraph.addSlot(slot);
			if (gameState.role === 'guest') guestSync?.requestSpawn(slot);
			else hostAuthority?.broadcastSnapshot();
		},
		onDeleteRequest: (slotId) => {
			if (gameState.role === 'guest') guestSync?.requestDelete(slotId);
			else {
				sceneGraph.removeSlot(slotId);
				hostAuthority?.broadcastSnapshot();
			}
		},
		onSlotMutated: () => {
			if (gameState.role !== 'guest') hostAuthority?.broadcastSnapshot();
		},
		// codeBlock's world.getPlayer(grabberId) — resolves a GrabSystem grabberId
		// ("left"/"right" for this session's own hands, "<guestId>:hand" for a
		// guest hand mirrored on the host's own GrabSystem, see hostAuthority.ts)
		// to a stable id + display name, for attributing script-driven actions
		// (e.g. the bowling scoreboard) to whichever player triggered them.
		resolvePlayer: (grabberId) => {
			const colonIndex = grabberId.indexOf(':');
			if (colonIndex !== -1) {
				const guestId = grabberId.slice(0, colonIndex);
				return { id: guestId, name: hostAuthority?.getPlayerDisplayName(guestId) ?? 'Guest' };
			}
			return {
				id: localPlayerId,
				name: gameState.userName ?? (gameState.role === 'guest' ? 'Guest' : gameState.role === 'host' ? 'Host' : 'Player')
			};
		}
	});
	sceneGraph.load(lobbyTemplate as SlotTree);

	const floorMesh = sceneGraph.getLive('floor')?.node as AbstractMesh | undefined;
	// Controller profiles + models (Meta/Oculus Touch) are served from /static/xr-input-profiles instead of
	// Babylon's default of immersive-web.github.io: a headset on a LAN without a route to GitHub Pages
	// never gets an answer (the request hangs rather than fails), and no motion controller would ever
	// initialise. A controller not in the local set falls back to Babylon's built-in profiles.
	WebXRMotionControllerManager.BaseRepositoryUrl = '/xr-input-profiles';
	const xrSystem = (navigator as Navigator & { xr?: XRSystem }).xr;
	let xr: WebXRDefaultExperience | null = null;
	let xrSupported = false;
	if (xrSystem) {
		try {
			xrSupported = await xrSystem.isSessionSupported('immersive-vr');
		} catch (error) {
			console.warn('[engine] WebXR support check failed; using desktop mode', error);
		}
	}
	if (xrSupported) {
		try {
			xr = await scene.createDefaultXRExperienceAsync({
				floorMeshes: floorMesh ? [floorMesh] : [],
				// Babylon's pointer-selection feature defaults to ONE "attached"
				// controller at a time (switching between them), which made only one
				// laser actually pick/grab at once — enable both simultaneously.
				pointerSelectionOptions: { enablePointerSelectionOnAllControllers: true },
				// The launch button is rendered by the page overlay, not Babylon's UI.
				disableDefaultUI: true
			});
			if (!xr.baseExperience || !xr.input || !xr.renderTarget) xr = null;
		} catch (error) {
			console.warn('[engine] WebXR initialization failed; using desktop mode', error);
			xr = null;
		}
		xrSupported = xr !== null;
	}
	if (xr) xr.baseExperience.onStateChangedObservable.add((state) => {
		if (state === WebXRState.IN_XR) options.onXRStateChange?.('in-xr');
		else if (state === WebXRState.NOT_IN_XR) options.onXRStateChange?.('not-in-xr');
	});
	const getActiveCamera = () => (xr?.baseExperience.state === WebXRState.IN_XR ? xr.baseExperience.camera : desktopCamera);
	viewerCamera = getActiveCamera;

	loadSettings();
	const grabSystem = new GrabSystem(scene, sceneGraph);
	sceneGraph.setGrabQuery(grabSystem);
	// Objects held in a hand until unequipped. Registered right after GrabSystem so a
	// guest hand's proxy follows presence before equipped scripts read their pose.
	const equipment = new EquipmentSystem(
		scene,
		sceneGraph,
		grabSystem,
		() => localPlayerId,
		(playerId) =>
			hostAuthority?.getPlayerDisplayName(playerId) ??
			(playerId === localPlayerId ? (gameState.userName ?? 'Player') : 'Player')
	);
	// Same "grip if present, else pointer" node pointerController.ts already
	// uses as each hand/controller's interaction point — reused here so a
	// pressable button reacts identically to hand-tracking and controllers.
	let locomotion: ReturnType<typeof setupLocomotion> | null = null;
	const playerBody = setupPlayerBody(scene, sceneGraph, xr, desktopCamera, { x: desktopCamera.position.x, z: desktopCamera.position.z });
	let refreshTeleportFloors = () => {};
	if (xr) {
		new PressableButtonSystem(scene, sceneGraph, () => xr.input.controllers.map((c) => c.grip ?? c.pointer));
		locomotion = setupLocomotion(xr, floorMesh ? [floorMesh] : []);
		refreshTeleportFloors = () => {
			locomotion?.updateFloorMeshes(sceneGraph.allSlots()
				.filter((entry) => !entry.system && entry.slot.components.some((component) => component.type === 'meshRenderer' && (isBuiltinMesh(component.meshRef, 'ground') || isBuiltinMesh(component.meshRef, 'disc'))))
				.map((entry) => entry.node as AbstractMesh));
		};
		setupRotationController(scene, xr);
		setupMovementController(scene, xr, playerBody);
		setupHandControllerSwitch(xr);
	}
	// Registered after GrabSystem (so any two-point grab's per-frame transform
	// write, GrabSystem.update() — also on this observable — has already run
	// before a codeBlock's tick() reads/corrects the transform) but AFTER
	// movement/rotation too: those are load-bearing for basic controller
	// input, so they must never be at the mercy of an uncaught throw from
	// this scene-graph/codeBlock tick that happens to be registered earlier
	// in the same Observable's notification order. tick() itself is also
	// defensively try/caught internally (see sceneGraph.ts) — this is a
	// second, outer layer in case something here throws before even
	// reaching it.
	scene.onBeforeRenderObservable.add(() => {
		try {
			const dt = scene.getEngine().getDeltaTime() / 1000;
			playerBody.update(dt);
			const removed = sceneGraph.tick(dt);
			if (removed > 0 && gameState.role !== 'guest') hostAuthority?.broadcastSnapshot();
		} catch (err) {
			console.error('[engine] sceneGraph.tick threw', err);
		}
	});
	const iceServers = parseIceServers(PUBLIC_STUN_URLS);
	const voice = new ProximityVoice();
	let localAudio: { track: MediaStreamTrack; stream: MediaStream } | null = null;

	async function refreshUser(): Promise<void> {
		const { data } = await authClient.getSession();
		gameState.userId = data?.user.id ?? null;
		gameState.userName = data?.user.name ?? null;
	}
	await refreshUser();
	const localPlayerId = crypto.randomUUID();
	let refreshWorldsTab = () => {};

	async function ensureLocalAudio() {
		if (!localAudio) localAudio = await voice.getLocalMicTrack();
		return localAudio ?? undefined;
	}

	function resetSessionState(): void {
		gameState.worldId = null;
		gameState.worldName = null;
		gameState.roomCode = null;
		gameState.worldVisibility = null;
		gameState.sessionStartedAt = null;
		gameState.loadedWorld = null;
		gameState.role = 'solo';
	}

	async function leaveCurrentSession(): Promise<void> {
		equipment.releaseAll(); // nothing stays equipped across worlds
		if (hostAuthority && gameState.worldId) {
			const res = await fetch(`/api/worlds/${gameState.worldId}/host`, { method: 'DELETE' });
			if (!res.ok) throw new Error('Could not close the hosted session');
		}
		hostAuthority?.dispose();
		hostAuthority = null;
		guestSync?.dispose();
		guestSync = null;
		resetSessionState();
	}

	async function launchScene(name: string, snapshot: SlotTree, visibility: HostedWorldVisibility | 'solo', loaded: LoadedWorld | null = null): Promise<void> {
		validateWorldScene(snapshot);
		snapshot = migrateSlotTree(snapshot);
		if (visibility === 'friends' || visibility === 'friends-plus') throw new Error('Friend-only access is not available yet');
		if (visibility !== 'solo' && visibility !== 'private' && !gameState.userId) {
			throw new Error('Sign in to host a public session');
		}
		const previousScene = sceneGraph.serialize();
		const track = visibility === 'solo' ? undefined : await ensureLocalAudio();
		let roomCode = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
		let worldId: string | null = null;
		let startedAt = new Date().toISOString();
		if (visibility !== 'solo' && gameState.userId) {
			const res = await fetch('/api/worlds', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name, visibility, sceneSnapshot: snapshot })
			});
			if (!res.ok) throw new Error('Could not host the world');
			const result = await res.json() as { world: { id: string }; session: { roomCode: string; startedAt: string } };
			worldId = result.world.id;
			roomCode = result.session.roomCode;
			startedAt = result.session.startedAt;
		}
		let didLeave = false;
		try {
			await leaveCurrentSession();
			didLeave = true;
			gameState.loadedWorld = loaded;
			sceneGraph.reconcile(copyScene(snapshot));
			refreshTeleportFloors();
			if (visibility === 'solo') { refreshWorldsTab(); return; }
			gameState.worldId = worldId;
			gameState.worldName = name;
			gameState.worldVisibility = visibility;
			gameState.sessionStartedAt = startedAt;
			gameState.roomCode = roomCode;
			gameState.role = 'host';
			hostAuthority = new HostAuthority(
				scene, xr, desktopCamera, sceneGraph, grabSystem, equipment, roomCode, iceServers,
				{ playerId: localPlayerId, displayName: gameState.userName ?? 'Host', role: 'host' } satisfies PlayerInfo,
				{ localTrack: track, onRemoteStream: (guestId, stream, targetNode) => voice.addPeer(guestId, stream, targetNode) }
			);
			refreshWorldsTab();
		} catch (error) {
			if (didLeave) {
				hostAuthority?.dispose();
				hostAuthority = null;
				sceneGraph.reconcile(previousScene);
				refreshTeleportFloors();
				resetSessionState();
			}
			if (worldId) void fetch(`/api/worlds/${worldId}/host`, { method: 'DELETE' });
			throw error;
		}
	}

	async function hostCurrentWorld(visibility: HostedWorldVisibility): Promise<void> {
		await launchScene(gameState.worldName ?? 'My Lobby', sceneGraph.serialize(), visibility, gameState.loadedWorld);
	}

	async function stopHostingWorld(): Promise<void> {
		if (!hostAuthority) return;
		await leaveCurrentSession();
		refreshWorldsTab();
	}

	async function launchWorldPackage(world: WorldPackage, visibility: HostedWorldVisibility | 'solo'): Promise<void> {
		validateWorldPackage(world);
		for (const asset of world.assets ?? []) models.provideBounds(asset.assetId, asset.bounds);
		const source = world.source;
		const loaded: LoadedWorld | null = source?.kind === 'inventory' && source.worldLineageId
			? { adapterId: source.adapterId, worldLineageId: source.worldLineageId, folderId: source.folderId ?? null, name: world.name, revisionNumber: source.revisionNumber ?? null }
			: null;
		await launchScene(world.name, world.scene, visibility, loaded);
	}

	function spawnWorldOrbPackage(world: WorldPackage): void {
		validateWorldPackage(world);
		const camera = getActiveCamera();
		const position = camera.globalPosition.add(camera.getForwardRay().direction.scale(0.7));
		const orb = createWorldOrb(world, [position.x, position.y, position.z]);
		if (JSON.stringify([...sceneGraph.serialize(), orb]).length > MAX_SHARED_SCENE_BYTES) throw new Error('This scene is too large to share another world orb');
		sceneGraph.addSlot(orb);
		if (gameState.role === 'guest') guestSync?.requestSpawn(orb);
		else hostAuthority?.broadcastSnapshot();
	}

	async function joinWorld(roomCode: string): Promise<void> {
		await leaveCurrentSession();
		const track = await ensureLocalAudio();
		gameState.worldId = null;
		gameState.worldName = null;
		gameState.roomCode = roomCode;
		gameState.worldVisibility = null;
		gameState.sessionStartedAt = null;
		gameState.loadedWorld = null;
		gameState.role = 'guest';

		guestSync = new GuestSync(
			scene,
			xr,
			desktopCamera,
			sceneGraph,
			grabSystem,
			equipment,
			roomCode,
			iceServers,
			{ playerId: localPlayerId, displayName: gameState.userName ?? 'Guest', role: 'guest' } satisfies PlayerInfo,
			{
				localTrack: track,
				onRemoteStream: (stream, targetNode) => voice.addPeer('host', stream, targetNode)
			},
			() => {
				guestSync = null;
				resetSessionState();
				refreshWorldsTab();
			},
			refreshTeleportFloors
		);
	}

	function spawnFromInventory(slotData: SlotTree): void {
		if (slotData.length === 0) return;
		// Ignore the saved root position: it may have been captured while the
		// object was still held (parented to a hand), which is a meaningless
		// local offset as a world position — spawn in front of the player
		// instead. Descendants keep their saved LOCAL position/rotation/scale
		// relative to the root (instantiate() only repositions index 0), and
		// every slot gets a fresh id (with parentId remapped to match) so the
		// same inventory item can be spawned more than once without id
		// collisions — this is what actually respawns the whole subtree
		// (previously only the root was recreated, silently dropping every
		// child, e.g. an entire saved Bowling Alley coming back empty).
		const camera = getActiveCamera();
		const spawnPosition = camera.globalPosition.add(camera.getForwardRay().direction.scale(0.6));
		const tree = instantiate(slotData, [spawnPosition.x, spawnPosition.y, spawnPosition.z]);
		for (const slot of tree) {
			sceneGraph.addSlot(slot);
			if (gameState.role === 'guest') guestSync?.requestSpawn(slot);
		}
		if (gameState.role !== 'guest') hostAuthority?.broadcastSnapshot();
	}

	function spawnWorldOrb(item: InventoryItem, adapterId: InventoryAdapterId): void {
		spawnWorldOrbPackage(worldFromInventory(item, adapterId, gameState.userId));
	}

	const inspector = createInspectorPanel(scene, sceneGraph, {
		onSceneChanged: () => {
			if (gameState.role !== 'guest') hostAuthority?.broadcastSnapshot();
		}
	});

	const dash = createDashPanel(scene, sceneGraph, {
		onHostWorld: hostCurrentWorld,
		onStopHosting: stopHostingWorld,
		onJoinWorld: joinWorld,
		onSpawnItem: spawnFromInventory,
		onSpawnWorldOrb: spawnWorldOrb,
		onSpawnPublishedWorld: spawnWorldOrbPackage,
		onLaunchWorldItem: async (item, adapterId) => {
			const world = worldFromInventory(item, adapterId, gameState.userId);
			await launchWorldPackage(world, world.defaultVisibility);
		},
		onLocomotionSettingsChanged: async () => { await locomotion?.applySettings(); },
		onExitVr: async () => { await xr?.baseExperience.exitXRAsync(); },
		onToggleInspector: () => inspector.root.setEnabled(!inspector.root.isEnabled())
	});
	refreshWorldsTab = dash.refreshWorldsTab;

	const worldPortalMenu = createWorldPortalMenu(scene, sceneGraph, getActiveCamera, launchWorldPackage, async (world) => {
		validateWorldPackage(world);
		const selected = getInventoryAdapter(gameState.currentInventoryAdapterId ?? 'local');
		const adapter = selected?.isAvailable(getInventoryContext()) ? selected : getInventoryAdapter('local');
		if (!adapter) throw new Error('No inventory is available');
		const folderId = adapter.id === gameState.currentInventoryAdapterId ? gameState.currentInventoryFolderId : null;
		await adapter.saveItem(getInventoryContext(), folderId, world.name, copyScene(world.scene), 'world');
	});
	scene.onPointerObservable.add((event) => {
		if (event.type !== PointerEventTypes.POINTERPICK || xr?.baseExperience.state === WebXRState.IN_XR) return;
		const slotId = sceneGraph.getSlotIdForNode(event.pickInfo?.pickedMesh);
		if (slotId && sceneGraph.getLive(slotId)?.slot.components.some((component) => component.type === 'worldPortal')) worldPortalMenu.open(slotId);
	});
	if (xr) setupPointerAndGrabControllers(scene, xr, sceneGraph, grabSystem, equipment, () => localPlayerId, {
		onWorldPortal: (slotId) => worldPortalMenu.open(slotId),
		onUse: (slotId, hand, phase, value) => {
			// A guest asks the host, which runs the object's actions once; solo/host run them here.
			if (gameState.role === 'guest') guestSync?.requestUse(slotId, hand, phase, value);
			else equipment.dispatchTrigger(localPlayerId, hand, phase, value, slotId);
		},
		onUnequip: (hand, slotId) => {
			if (gameState.role === 'guest') guestSync?.requestUnequip(hand, slotId);
			else hostAuthority?.broadcastSnapshot();
		},
		onGrab: (grabberId, slotId) => {
			if (gameState.role === 'host') hostAuthority?.broadcastSnapshot();
			else guestSync?.requestGrab(grabberId, slotId);
		},
		onRelease: (grabberId, slotId) => {
			if (gameState.role === 'host') hostAuthority?.broadcastSnapshot();
			else guestSync?.requestRelease(grabberId, slotId);
		}
	});
	if (xr) setupPanelToggle(scene, xr, dash.root, getActiveCamera, { keyboardKey: 'm', buttonIdPattern: /x-button|menu/i });
	if (xr) setupPanelToggle(scene, xr, inspector.root, getActiveCamera, { keyboardKey: 'i', buttonIdPattern: /a-button/i });
	const radialNetwork = {
		onEquip: (hand: 'left' | 'right', slotId: string) => {
			if (gameState.role === 'guest') guestSync?.requestEquip(hand, slotId);
			else hostAuthority?.broadcastSnapshot();
		},
		onUnequip: (hand: 'left' | 'right', slotId: string) => {
			if (gameState.role === 'guest') guestSync?.requestUnequip(hand, slotId);
			else hostAuthority?.broadcastSnapshot();
		},
		onDelete: (slotId: string) => {
			if (gameState.role === 'guest') guestSync?.requestDelete(slotId);
			else {
				sceneGraph.removeSlot(slotId);
				hostAuthority?.broadcastSnapshot();
			}
		}
	};
	if (xr) {
		setupRadialMenuForHand(scene, xr, sceneGraph, grabSystem, equipment, () => localPlayerId, 'left', /y-button/i, radialNetwork);
		setupRadialMenuForHand(scene, xr, sceneGraph, grabSystem, equipment, () => localPlayerId, 'right', /b-button/i, radialNetwork);
	}

	scene.onBeforeRenderObservable.add(() => {
		const camera = getActiveCamera();
		voice.update({
			position: camera.position.asArray() as [number, number, number],
			forward: camera.getForwardRay().direction.asArray() as [number, number, number]
		});
	});

	if (initialRoomCode) void joinWorld(initialRoomCode);

	// "Play" in the Studio hands its scene over through localStorage and opens `/play?studioPlay=<key>`.
	const studioPlayKey = new URLSearchParams(window.location.search).get('studioPlay');
	if (studioPlayKey && !initialRoomCode) {
		void (async () => {
			const storageKey = `studio:play:${studioPlayKey}`;
			try {
				const raw = localStorage.getItem(storageKey);
				localStorage.removeItem(storageKey);
				if (!raw) return;
				const { name, scene: studioScene } = JSON.parse(raw) as { name: string; scene: SlotTree };
				await launchScene(name, studioScene, 'solo');
			} catch (error) {
				console.error('Could not play the Studio scene', error);
			}
		})();
	}

	engine.runRenderLoop(() => scene.render());
	const onResize = () => engine.resize();
	window.addEventListener('resize', onResize);

	return {
		xrSupported,
		enterVR: async () => {
			if (!xr) return;
			await xr.baseExperience.enterXRAsync('immersive-vr', 'local-floor', xr.renderTarget);
		},
		dispose() {
			window.removeEventListener('resize', onResize);
			hostAuthority?.dispose();
			guestSync?.dispose();
			worldPortalMenu.dispose();
			voice.dispose();
			sceneGraph.dispose();
			models.dispose();
			engine.dispose();
		}
	};
}
