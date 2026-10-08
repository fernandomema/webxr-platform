// Registers the glTF/GLB loader. Babylon loads each controller's model as a .glb and only
// initialises the motion controller (trigger, thumbstick, laser) once that load succeeds.
import '@babylonjs/loaders/glTF';
import {
	Engine,
	AbstractEngine,
	Scene,
	HemisphericLight,
	Vector3,
	UniversalCamera,
	WebXRState,
	WebXRFeatureName,
	WebXRMotionControllerManager,
	PointerEventTypes,
	type AbstractMesh,
	type WebXRDefaultExperience
} from '@babylonjs/core';
import lobbyTemplate from './templates/lobby.json';
import { buildLobbyBillboard } from './templates/lobbyBillboard';
import { getBuiltinWorld } from './templates/builtinWorlds';
import { createSlot, opensWorldMenu, type SlotTree } from '$lib/ecs/types';
import { atRest, instantiate } from '$lib/ecs/serialize';
import { isBuiltinMesh, migrateSlotTree } from '$lib/assets/ref';
import type { AssetResolver } from '$lib/assets/resolve';
import { CloudResolver } from '$lib/assets/cloud';
import { PeerResolver } from '$lib/assets/p2p';
import { getLocalAssetStore } from '$lib/assets/store';
import { importGlb } from '$lib/assets/importGlb';
import { BlobAssetLibrary } from './blobAssetLibrary';
import { createScriptAudio } from './scriptAudio';
import { ModelLibrary } from './modelLibrary';
import { SceneGraph } from './sceneGraph';
import { SocketSystem } from './interaction/socketSystem';
import { DropZoneSystem } from './interaction/dropZoneSystem';
import { GrabSystem } from './interaction/grabSystem';
import { EquipmentSystem } from './interaction/equipmentSystem';
import { PressableButtonSystem } from './interaction/pressableButtonSystem';
import { setupPointerAndGrabControllers, type PointerControllerNetworkHooks } from './interaction/pointerController';
import { setupPanelToggle } from './interaction/panelToggle';
import { setupRotationController } from './interaction/rotationController';
import { setupMovementController } from './interaction/movementController';
import { setupPlayerBody } from './interaction/playerBody';
import { setupFpsController } from './interaction/desktop/fpsController';
import { setupDesktopPanels } from './interaction/desktop/desktopPanels';
import { setupDesktopHand } from './interaction/desktop/desktopHand';
import { desktopHud, hudActions, resetDesktopHud } from './interaction/desktop/desktopHud.svelte';
import type { RadialItem } from './ui/radialView';
import { setupLocomotion } from './locomotion';
import { setupHandControllerSwitch } from './interaction/handControllerSwitch';
import { createDashPanel } from './ui/dashPanel';
import { createInspectorHost } from './ui/inspectorHost';
import { createDropZoneOutline } from './ui/dropZoneOutline';
import { forwardKeyTo } from './keyForwarding';
import { setupRadialMenuForHand } from './ui/radialMenu';
import { KeyboardSystem } from './keyboard/keyboardSystem';
import { setTextInputProvider } from './keyboard/service';
import { createPerformanceOverlay } from './ui/performanceOverlay';
import { uploadGuiBeforeDrawing } from './guiUploads';
import { FOVEATION, loadSettings, saveSettings, xrSettings } from './settings';
import { selectTargetFrameRate, XR_FRAMEBUFFER_SCALE } from './performance';
import { sanitizeAvatarTree } from './avatar/sanitize';
import { saveWithPreview } from './inventorySave';
import { captureItemThumbnail, configureThumbnails } from './thumbnail/capture';
import { ensureCloudAssets } from '$lib/assets/cloudSync';
import { configureThumbnailSources } from '$lib/assets/thumbnails';
import { AvatarSystem } from './avatar/avatarSystem';
import { PlayerAvatars } from './avatar/playerAvatars';
import { loadBaseAvatar } from './avatar/baseAvatar';
import type { AvatarHooks } from './avatar/avatarHooks';
import { HostAuthority } from './net/hostAuthority';
import { GuestSync } from './net/guestSync';
import { WorldStorageService } from './worldStorageService';
import { ProximityVoice } from './net/voice';
import { parseIceServers } from './net/peerConnection';
import { authClient } from '$lib/auth-client';
import { BLANK_WORLD_NAME, buildBlankWorld } from './templates/blankWorld';
import { gameState, type LoadedWorld, type PublicationContext } from './gameState';
import type { HostedWorldVisibility } from '$lib/worldVisibility';
import type { PlayerInfo } from './net/protocol';
import { PUBLIC_STUN_URLS } from '$env/static/public';
import { createWorldOrb, copyScene, validateWorldPackage, validateWorldScene, worldFromInventory, MAX_SHARED_SCENE_BYTES } from '$lib/worlds/package';
import type { WorldPackage } from '$lib/worlds/types';
import type { InventoryAdapterId, InventoryStorageAdapterId, InventoryItem } from '$lib/inventory/types';
import { createWorldPortalMenu } from './ui/worldPortalMenu';
import { getInventoryAdapter } from '$lib/inventory/registry';
import { getInventoryContext } from './gameState';

export interface MountedGame {
	xrSupported: boolean;
	enterVR(): Promise<void>;
	/** Desktop: captures the mouse for looking around (it must be called from a click or key press). */
	captureMouse(): void;
	dispose(): void;
}

export interface MountGameOptions {
	onXRStateChange?: (state: 'in-xr' | 'not-in-xr') => void;
	/** A published world to open straight away, on its own (the world played as an app). */
	initialWorld?: WorldPackage;
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
	// The desktop pointer only acts on clicks, and XR controllers do their own ray casts. Babylon's default hover pick
	// traverses every pickable mesh on every pointer move, which is wasted CPU work (and costly in large worlds).
	scene.skipPointerMovePicking = true;

	new HemisphericLight('light', new Vector3(0, 1, 0), scene);

	const desktopCamera = new UniversalCamera('desktop-cam', new Vector3(0, 1.6, 2), scene);
	// Face the world facade: the initial view is turned 180 degrees around Y.
	desktopCamera.setTarget(new Vector3(0, 1.4, 4));
	desktopCamera.attachControl(canvas, true);
	desktopCamera.speed = 0.065; // walking speed; the FPS controller changes it for running
	// Babylon's default near plane is 1 m, which cut off panels opened 1 m away and anything held close.
	desktopCamera.minZ = 0.05;
	// Keys that land on the page itself (nothing focused: the focus was taken by a panel's page and dropped) are the
	// game's: without this, opening a web panel could leave the player unable to move until they clicked the canvas.
	const passStrayKey = (event: KeyboardEvent) => {
		if (event.target === document.body || event.target === document.documentElement || event.target === document) forwardKeyTo(canvas, event);
	};
	window.addEventListener('keydown', passStrayKey);
	window.addEventListener('keyup', passStrayKey);
	desktopCamera.keysUp.push(87); // W
	desktopCamera.keysDown.push(83); // S
	desktopCamera.keysLeft.push(65); // A
	desktopCamera.keysRight.push(68); // D
	scene.activeCamera = desktopCamera;

	let hostAuthority: HostAuthority | null = null;
	let guestSync: GuestSync | null = null;
	// Models are found on this device first; the cloud and the session host are added to this list as they become available.
	// The cloud first, then the other end(s) of the session: a model that only exists on someone's device travels peer to peer.
	const assetResolvers: AssetResolver[] = [
		new CloudResolver(),
		new PeerResolver(() => [...(hostAuthority?.getAssetPeers() ?? []), ...(guestSync?.getAssetPeer() ? [guestSync.getAssetPeer()!] : [])])
	];
	const models = new ModelLibrary(scene, { store: getLocalAssetStore(), getResolvers: () => assetResolvers });
	const mediaAssets = new BlobAssetLibrary({ store: getLocalAssetStore(), getResolvers: () => assetResolvers });
	const scriptAudio = createScriptAudio(mediaAssets);
	// Previews of what is saved are drawn as a second scene on this engine (a second WebGL context would be costly on a headset).
	configureThumbnails({ engine, getResolvers: () => assetResolvers });
	configureThumbnailSources(() => assetResolvers);
	const worldStorage = new WorldStorageService({
		getLocalPlayerId: () => localPlayerId,
		getPlayerName: (playerId) => playerId === localPlayerId ? (gameState.userName ?? 'Player') : (hostAuthority?.getPlayerDisplayName(playerId) ?? 'Player'),
		getPublication: () => gameState.publication,
		getRoomCode: () => gameState.roomCode,
		getRole: () => gameState.role,
		isSignedIn: () => !!gameState.userId,
		relay: (playerId, call) => hostAuthority?.relayPlayerApi(playerId, call) ?? Promise.resolve({ ok: false, error: 'No session is hosted' })
	});
	let viewerCamera: () => { globalPosition: Vector3 } = () => desktopCamera;
	const sceneGraph = new SceneGraph(scene, {
		storage: worldStorage,
		audio: scriptAudio,
		models,
		mediaAssets,
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
		onImportPolyHavenModel: async (id, name) => {
			if (gameState.role === 'guest') throw new Error('Only the host can import models into this world.');
			if (!/^[A-Za-z0-9_]{1,90}$/.test(id)) throw new Error('Invalid Poly Haven model ID.');
			const response = await fetch(`/api/polyhaven/models/${id}/glb`);
			if (!response.ok) {
				const body = await response.json().catch(() => null) as { message?: string } | null;
				throw new Error(body?.message ?? 'Could not download this model.');
			}
			const objectName = (name.trim().slice(0, 80) || id);
			const { manifest } = await importGlb(new Uint8Array(await response.arrayBuffer()), `${objectName}.glb`, getLocalAssetStore());
			const adapter = getInventoryAdapter('local');
			if (!adapter?.saveItem) throw new Error('Local inventory is unavailable.');
			await saveWithPreview(adapter, getInventoryContext(), null, objectName, [createSlot({
				name: objectName,
				components: [
					{ type: 'meshRenderer', meshRef: { kind: 'asset', assetId: manifest.assetId } },
					{ type: 'collider', shape: 'box' },
					{ type: 'grabbable', scalable: true }
				]
			})], 'object');
			return manifest.assetId;
		},
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
	const startupParams = new URLSearchParams(window.location.search);
	const startupBuiltin = !initialRoomCode && !options.initialWorld && !startupParams.has('studioPlay')
		? getBuiltinWorld(startupParams.get('world') ?? '') : undefined;
	// A direct world link only needs a temporary floor during input setup. Avoid starting lobby media that would be disposed mid-load.
	sceneGraph.load((startupBuiltin ? lobbyTemplate.filter((slot) => slot.id === 'floor') : [...lobbyTemplate, ...buildLobbyBillboard()]) as SlotTree);

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
				// Quest is usually fill-rate bound. Rendering fewer pixels (with foveation below) preserves enough GPU
				// headroom to hold the session refresh rate instead of oscillating around it.
				outputCanvasOptions: { canvasOptions: { antialias: false, framebufferScaleFactor: XR_FRAMEBUFFER_SCALE } },
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
	AbstractEngine.audioEngine?.setGlobalVolume(xrSettings.masterVolume);
	const grabSystem = new GrabSystem(scene, sceneGraph);
	// Bodies for every player: the host (or a solo player) owns the avatar slots, everyone poses them from presence.
	const avatarSystem = new AvatarSystem(scene, sceneGraph, {
		getLocalPlayerId: () => localPlayerId,
		getCamera: () => getActiveCamera(),
		getXr: () => xr,
		getHeldSlots: (playerId) => {
			// Equipment is kept under the id the host knows a guest by, which is not always the one it announced.
			const key = hostAuthority?.equipmentKeyFor(playerId) ?? playerId;
			const held = (hand: 'left' | 'right') => {
				const equipped = equipment.registry.getSlot(key, hand);
				if (equipped) return { slotId: equipped, via: 'equip' as const };
				// Grabs are kept per hand: the local player's are just 'left' and 'right', a guest's are prefixed with its id.
				const grabbed = grabSystem.getHeldSlot(playerId === localPlayerId ? hand : `${key}:${hand}`);
				return grabbed ? { slotId: grabbed, via: 'grab' as const } : null;
			};
			return { left: held('left'), right: held('right') };
		}
	});
	const playerAvatars = new PlayerAvatars(sceneGraph);
	const hostAvatarHooks: AvatarHooks = { system: avatarSystem, players: playerAvatars };
	const guestAvatarHooks: AvatarHooks = { system: avatarSystem };
	sceneGraph.setGrabQuery(grabSystem);
	// Objects let go near a socket settle into it (host/solo decide; guests get the result in the snapshot).
	new SocketSystem(sceneGraph, grabSystem, () => gameState.role !== 'guest');
	// Objects let go inside a drop zone turn upright and settle on its floor (after the sockets have had their pick).
	new DropZoneSystem(sceneGraph, grabSystem, () => gameState.role !== 'guest');
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
	playerBody.setSeated(xrSettings.seatedMode);
	// The starting world is already up: stand at its spawn point.
	playerBody.respawn();
	const inXr = () => xr?.baseExperience.state === WebXRState.IN_XR;
	const fps = setupFpsController(scene, canvas, desktopCamera, playerBody, { isXr: inXr });
	resetDesktopHud();
	desktopHud.active = true;
	if (xr) xr.baseExperience.onStateChangedObservable.add((state) => {
		if (state === WebXRState.IN_XR) fps.exitLock();
		if (state === WebXRState.IN_XR || state === WebXRState.NOT_IN_XR) desktopHud.active = state !== WebXRState.IN_XR;
	});
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

	/** An avatar worn for this session only. Any change of session drops it and the default avatar comes back. */
	let sessionAvatar: SlotTree | null = null;

	function resetSessionState(): void {
		sessionAvatar = null;
		gameState.worldId = null;
		gameState.worldName = null;
		gameState.roomCode = null;
		gameState.worldVisibility = null;
		gameState.sessionStartedAt = null;
		gameState.loadedWorld = null;
		gameState.publication = null;
		worldStorage.reset();
		gameState.role = 'solo';
	}

	/** Puts the player's chosen avatar (or the built-in one) into the world: the host places it, a guest asks the host to. */
	async function applyLocalAvatar(): Promise<void> {
		const chosen = sessionAvatar ?? xrSettings.defaultAvatar;
		const tree = chosen ?? (await loadBaseAvatar());
		if (!tree) return;
		if (gameState.role === 'guest') {
			guestSync?.sendAvatar(tree);
			return;
		}
		try {
			playerAvatars.setAvatar(localPlayerId, tree);
		} catch (error) {
			console.warn('[avatar] the chosen avatar cannot be used; falling back to the built-in one', error);
			const base = await loadBaseAvatar();
			if (!base) return;
			playerAvatars.setAvatar(localPlayerId, base);
		}
		hostAuthority?.broadcastSnapshot();
	}

	/** The local player is identified: world scripts may now restore what they saved for them. */
	function announceLocalPlayerReady(): void {
		sceneGraph.dispatchPlayerReady({ id: localPlayerId, name: gameState.userName ?? 'Player' });
	}

	async function leaveCurrentSession(): Promise<void> {
		const wasGuest = guestSync !== null;
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
		if (wasGuest) {
			// The other players' avatars belonged to that session; ours is placed again by this device.
			playerAvatars.clearAll();
			void applyLocalAvatar();
		}
	}

	async function launchScene(name: string, snapshot: SlotTree, visibility: HostedWorldVisibility | 'solo', loaded: LoadedWorld | null = null, publication: PublicationContext | null = null): Promise<void> {
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
				body: JSON.stringify({ name, visibility, sceneSnapshot: snapshot, publicationId: publication?.publicationId })
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
			gameState.publication = publication;
			sceneGraph.reconcile(copyScene(snapshot));
			refreshTeleportFloors();
			playerBody.respawn();
			void applyLocalAvatar();
			if (visibility === 'solo') {
				// Kept so that hosting it later, or saving it, starts from its own name.
				gameState.worldName = name;
				refreshWorldsTab();
				announceLocalPlayerReady();
				return;
			}
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
			hostAuthority.setAvatarHooks(hostAvatarHooks);
			hostAuthority.setStorageHooks({
				getPublicationId: () => gameState.publication?.publicationId ?? null,
				onPlayerReady: (player) => sceneGraph.dispatchPlayerReady({ id: player.playerId, name: player.displayName })
			});
			announceLocalPlayerReady();
			refreshWorldsTab();
			if (worldId) void uploadWorldPreview(worldId, snapshot);
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

	/** The picture the Worlds tab shows for this session. It is made once the session is up, so hosting never waits for it. */
	async function uploadWorldPreview(worldId: string, snapshot: SlotTree): Promise<void> {
		try {
			const thumbnailAssetId = await captureItemThumbnail(snapshot, 'world');
			if (!thumbnailAssetId) return;
			await ensureCloudAssets([], getLocalAssetStore(), { extraIds: [thumbnailAssetId] });
			await fetch(`/api/worlds/${worldId}/preview`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ thumbnailAssetId })
			});
		} catch (error) {
			console.warn('[worlds] could not send the session preview', error);
		}
	}

	async function hostCurrentWorld(visibility: HostedWorldVisibility): Promise<void> {
		await launchScene(gameState.worldName ?? 'My Lobby', sceneGraph.serialize({ withoutAvatars: true }), visibility, gameState.loadedWorld, gameState.publication);
	}

	async function stopHostingWorld(): Promise<void> {
		if (!hostAuthority) return;
		await leaveCurrentSession();
		refreshWorldsTab();
	}

	async function launchWorldPackage(world: WorldPackage, visibility: HostedWorldVisibility | 'solo'): Promise<void> {
		validateWorldPackage(world);
		for (const asset of world.assets ?? []) if (asset.bounds) models.provideBounds(asset.assetId, asset.bounds);
		const source = world.source;
		const loaded: LoadedWorld | null = source?.kind === 'inventory' && source.worldLineageId
			? { adapterId: source.adapterId, worldLineageId: source.worldLineageId, folderId: source.folderId ?? null, name: world.name, revisionNumber: source.revisionNumber ?? null }
			: null;
		const publication: PublicationContext | null = source?.kind === 'published' ? { publicationId: source.worldId, revisionId: source.revisionId ?? null } : null;
		await launchScene(world.name, world.scene, visibility, loaded, publication);
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
		gameState.publication = null;
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
				playerAvatars.clearAll();
				void applyLocalAvatar();
				refreshWorldsTab();
			},
			refreshTeleportFloors,
			() => void applyLocalAvatar()
		);
		playerBody.respawn();
		guestSync.setAvatarHooks(guestAvatarHooks);
		guestSync.setStorageHooks({
			onPublication: (publicationId) => { gameState.publication = publicationId ? { publicationId, revisionId: null } : null; },
			handlePlayerApi: (publicationId, call) => worldStorage.handleRelayed(publicationId, call)
		});
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
		const tree = instantiate(atRest(slotData), [spawnPosition.x, spawnPosition.y, spawnPosition.z]);
		for (const slot of tree) {
			sceneGraph.addSlot(slot);
			if (gameState.role === 'guest') guestSync?.requestSpawn(slot);
		}
		if (gameState.role !== 'guest') hostAuthority?.broadcastSnapshot();
	}

	function spawnWorldOrb(item: InventoryItem, adapterId: InventoryStorageAdapterId): void {
		spawnWorldOrbPackage(worldFromInventory(item, adapterId, gameState.userId));
	}

	const inspector = createInspectorHost(scene, sceneGraph, {
		onSceneChanged: () => {
			if (gameState.role !== 'guest') hostAuthority?.broadcastSnapshot();
		},
		getViewPose: () => {
			const camera = getActiveCamera();
			return { position: camera.globalPosition.asArray() as [number, number, number], rotation: camera.absoluteRotation.asArray() as [number, number, number, number] };
		}
	});
	// A drop zone has no mesh of its own: its box is drawn while the inspector has it marked, so it can be seen and adjusted there.
	createDropZoneOutline(scene, sceneGraph, () => inspector.selectedSlotId());

	/**
	 * The display refresh rates the headset offers, known once a session has started (the last session's otherwise).
	 * Declared before the dash, which reads it while it builds its Settings tab.
	 */
	let supportedFrameRates: number[] = [];
	const dash = createDashPanel(scene, sceneGraph, {
		onHostWorld: hostCurrentWorld,
		onStopHosting: stopHostingWorld,
		onJoinWorld: joinWorld,
		onSpawnItem: spawnFromInventory,
		onWearAvatar: async (item) => {
			sessionAvatar = sanitizeAvatarTree(item.slotData);
			await applyLocalAvatar();
		},
		onSetDefaultAvatar: async (item, adapterId) => {
			// Rebuilt exactly as the host will rebuild it, so a bad avatar is refused here with a reason instead of silently ignored there.
			const tree = sanitizeAvatarTree(item.slotData);
			xrSettings.defaultAvatar = tree;
			xrSettings.defaultAvatarSource = `${adapterId}:${item.id}`;
			sessionAvatar = null;
			saveSettings();
			await applyLocalAvatar();
		},
		onUnsetDefaultAvatar: async () => {
			xrSettings.defaultAvatar = null;
			xrSettings.defaultAvatarSource = null;
			sessionAvatar = null;
			saveSettings();
			await applyLocalAvatar();
		},
		onSpawnWorldOrb: spawnWorldOrb,
		onSpawnPublishedWorld: spawnWorldOrbPackage,
		onLaunchPublishedWorld: (world) => launchWorldPackage(world, 'solo'),
		onLaunchWorldItem: async (item, adapterId: InventoryStorageAdapterId) => {
			const world = worldFromInventory(item, adapterId, gameState.userId);
			await launchWorldPackage(world, world.defaultVisibility);
		},
		// On your own at first; the Session tab hosts it for others like any world.
		onLaunchBuiltinWorld: (world) => launchScene(world.name, copyScene(world.scene), 'solo'),
		onCreateWorld: () => launchScene(BLANK_WORLD_NAME, buildBlankWorld(), 'solo'),
		onLocomotionSettingsChanged: async () => { await locomotion?.applySettings(); },
		onExitVr: async () => { await xr?.baseExperience.exitXRAsync(); },
		onToggleInspector: () => inspector.root.setEnabled(!inspector.root.isEnabled()),
		onSeatedModeChanged: () => playerBody.setSeated(xrSettings.seatedMode),
		onDesktopSettingsChanged: () => fps.applySettings(),
		onAudioSettingsChanged: () => AbstractEngine.audioEngine?.setGlobalVolume(xrSettings.masterVolume),
		onPerformanceSettingsChanged: () => applyPerformanceSettings(),
		frameRates: () => supportedFrameRates
	});
	refreshWorldsTab = dash.refreshWorldsTab;

	const worldPortalMenu = createWorldPortalMenu(scene, sceneGraph, getActiveCamera, launchWorldPackage, async (world) => {
		validateWorldPackage(world);
		const selected = getInventoryAdapter(gameState.currentInventoryAdapterId ?? 'local');
		const adapter = selected?.isAvailable(getInventoryContext()) && selected.saveItem ? selected : getInventoryAdapter('local');
		if (!adapter?.saveItem) throw new Error('Choose a writable inventory first');
		const folderId = adapter.id === gameState.currentInventoryAdapterId ? gameState.currentInventoryFolderId : null;
		await saveWithPreview(adapter, getInventoryContext(), folderId, world.name, copyScene(world.scene), 'world');
	}, async (id) => {
		const world = getBuiltinWorld(id);
		if (!world) throw new Error(`There is no built-in world "${id}"`);
		await launchScene(world.name, copyScene(world.scene), 'solo');
	});
	scene.onPointerObservable.add((event) => {
		// With the mouse captured the hand opens portals itself (see desktopHand.ts); this is for a free cursor.
		if (event.type !== PointerEventTypes.POINTERPICK || inXr() || fps.locked) return;
		const slotId = sceneGraph.getSlotIdForNode(event.pickInfo?.pickedMesh);
		const slot = slotId ? sceneGraph.getLive(slotId)?.slot : undefined;
		if (slotId && slot && opensWorldMenu(slot)) worldPortalMenu.open(slotId);
	});
	// The reactions to a trigger, a grab or a portal are the same whether a controller or the mouse's hand does it.
	const pointerHooks: PointerControllerNetworkHooks = {
		onWorldPortal: (slotId) => worldPortalMenu.open(slotId),
		onUse: (slotId, hand, phase, value) => {
			// A camera takes its pictures here, on the device of whoever holds it.
			const usable = equipment.getUsableSlot(localPlayerId, hand, slotId);
			const local = usable ? sceneGraph.getSubtree(usable).find((entry) => entry.runtime?.localUse) : undefined;
			if (local) { local.runtime!.localUse!(phase); return; }
			// A guest asks the host, which runs the object's actions once; solo/host run them here.
			if (gameState.role === 'guest') guestSync?.requestUse(slotId, hand, phase, value);
			else equipment.dispatchTrigger(localPlayerId, hand, phase, value, slotId);
		},
		onUnequip: (hand, slotId) => {
			if (gameState.role === 'guest') guestSync?.requestUnequip(hand, slotId);
			else hostAuthority?.broadcastSnapshot();
		},
		onEquip: (hand, slotId) => {
			if (gameState.role === 'guest') guestSync?.requestEquip(hand, slotId);
			else hostAuthority?.broadcastSnapshot();
		},
		onGrab: (grabberId, slotId) => {
			if (gameState.role === 'host') hostAuthority?.broadcastSnapshot();
			else guestSync?.requestGrab(grabberId, slotId);
		},
		onRelease: (grabberId, slotId) => {
			if (gameState.role === 'host') hostAuthority?.broadcastSnapshot();
			else guestSync?.requestRelease(grabberId, slotId);
		},
		onHold: (grabberId, slotId, position, rotation) => {
			if (gameState.role === 'guest') guestSync?.requestHoldMove(grabberId, slotId, position, rotation);
		}
	};
	const pointerState = xr ? setupPointerAndGrabControllers(scene, xr, sceneGraph, grabSystem, equipment, () => localPlayerId, pointerHooks) : null;
	setupPanelToggle(scene, xr, dash.root, getActiveCamera, { keyboardKey: 'tab', buttonIdPattern: /x-button|menu/i });
	setupPanelToggle(scene, xr, inspector.root, getActiveCamera, { keyboardKey: 'i', buttonIdPattern: /a-button/i });
	const radialNetwork = {
		getInspectTarget: (hand: 'left' | 'right') => inspector.root.isEnabled() ? pointerState?.getLaserTarget(hand) ?? null : null,
		onInspect: (slotId: string) => { inspector.select(slotId); },
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
	// Mouse and keyboard. The menu and the inspector fill the screen instead of standing in the world, and the mouse plays
	// the right hand: the same grabs, uses and radial menu a controller has (see interaction/desktop).
	const desktopPanels = setupDesktopPanels(scene, desktopCamera, [{ name: 'Menu', root: dash.root }, { name: 'Inspector', root: inspector.root }], {
		isXr: inXr,
		onDockChange: (panel) => {
			desktopHud.panelOpen = panel !== null;
			desktopHud.panelName = panel?.name ?? '';
			fps.setEnabled(panel === null);
			if (panel) fps.exitLock();
			else fps.requestLock();
		}
	});
	hudActions.closePanel = () => desktopPanels.close();
	const openPanel = (root: { setEnabled(enabled: boolean): void }) => root.setEnabled(true);
	const desktopHand = setupDesktopHand({
		scene,
		camera: desktopCamera,
		sceneGraph,
		grabSystem,
		equipment,
		localPlayerId: () => localPlayerId,
		fps,
		isActive: () => !inXr() && desktopPanels.docked === null,
		network: pointerHooks,
		radial: {
			onEquip: radialNetwork.onEquip,
			onUnequip: radialNetwork.onUnequip,
			onDelete: radialNetwork.onDelete,
			onInspect: (slotId) => {
				openPanel(inspector.root);
				inspector.select(slotId);
			}
		},
		globalItems: (): RadialItem[] => [
			{ label: 'Menu', isEnabled: () => true, onSelect: () => openPanel(dash.root) },
			{ label: 'Inspector', isEnabled: () => true, onSelect: () => openPanel(inspector.root) }
		]
	});
	// Fixed foveated rendering (less detail at the edges of the view) applies to a headset session's layer, so it is set
	// again every time one starts; the readout can be shown anywhere.
	const performanceOverlay = createPerformanceOverlay(scene, getActiveCamera);
	/**
	 * Multiview draws both eyes with each draw call (through WebXR layers). A session is set up with it or without it when
	 * it starts, so the setting is applied only outside one: it takes effect the next time VR is entered.
	 */
	let multiviewApplied = false;
	function applyMultiview(): void {
		if (!xr || xr.baseExperience.state !== WebXRState.NOT_IN_XR || multiviewApplied === xrSettings.multiview) return;
		const features = xr.baseExperience.featuresManager;
		try {
			if (xrSettings.multiview) features.enableFeature(WebXRFeatureName.LAYERS, 'latest', { preferMultiviewOnInit: true }, true, false);
			else features.disableFeature(WebXRFeatureName.LAYERS);
			multiviewApplied = xrSettings.multiview;
		} catch (error) {
			console.warn('[engine] multiview could not be set up; drawing each eye on its own', error);
		}
	}
	function applyFrameRate(): void {
		if (!xr || xr.baseExperience.state !== WebXRState.IN_XR) return;
		const sessionManager = xr.baseExperience.sessionManager;
		supportedFrameRates = Array.from(sessionManager.supportedFrameRates ?? []).sort((a, b) => a - b);
		const wanted = selectTargetFrameRate(supportedFrameRates, xrSettings.frameRate);
		if (wanted === null || sessionManager.currentFrameRate === wanted) return;
		sessionManager.updateTargetFrameRate(wanted).catch((error) => console.warn('[engine] the headset refused that refresh rate', error));
	}
	function applyPerformanceSettings(): void {
		applyFrameRate();
		if (xr?.baseExperience.state === WebXRState.IN_XR) xr.baseExperience.sessionManager.fixedFoveation = FOVEATION[xrSettings.foveation];
		performanceOverlay.setVisible(xrSettings.showPerformance);
		applyMultiview();
	}
	xr?.baseExperience.onStateChangedObservable.add((state) => {
		if (state === WebXRState.IN_XR || state === WebXRState.NOT_IN_XR) applyPerformanceSettings();
	});
	applyPerformanceSettings();
	// Anything asking for text in a headset gets the in-world keyboard (see keyboard/service.ts).
	const keyboards = xr ? new KeyboardSystem(scene, sceneGraph, xr, (side) => avatarSystem.localIndexTip(side)) : null;
	setTextInputProvider(keyboards);

	scene.onBeforeRenderObservable.add(() => {
		const camera = getActiveCamera();
		voice.update({
			position: camera.position.asArray() as [number, number, number],
			forward: camera.getForwardRay().direction.asArray() as [number, number, number]
		});
	});

	if (initialRoomCode) void joinWorld(initialRoomCode);
	else if (options.initialWorld) {
		const world = options.initialWorld;
		void launchWorldPackage(world, 'solo').catch((error) => console.error('Could not open the world', error));
	}

	// "Play" in the Studio hands its scene over through localStorage and opens `/play?studioPlay=<key>`.
	const studioPlayKey = new URLSearchParams(window.location.search).get('studioPlay');
	if (startupBuiltin) {
		void launchScene(startupBuiltin.name, structuredClone(startupBuiltin.scene), 'solo').catch((error) => console.error('Could not open the built-in world', error));
	}
	if (studioPlayKey && !initialRoomCode && !options.initialWorld) {
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

	void applyLocalAvatar();
	// Lets a developer inspect the live scene from the browser console.
	if (import.meta.env.DEV) (window as unknown as { __game?: unknown }).__game = { scene, sceneGraph, avatarSystem, playerAvatars, hostCurrentWorld, joinWorld, applyLocalAvatar, xrSettings };

	// Last of the per-frame work: GUI textures changed during this frame are uploaded before the cameras draw (see guiUploads.ts).
	const stopGuiUploads = uploadGuiBeforeDrawing(scene);
	engine.runRenderLoop(() => scene.render());
	const onResize = () => engine.resize();
	window.addEventListener('resize', onResize);

	return {
		xrSupported,
		enterVR: async () => {
			if (!xr) return;
			await xr.baseExperience.enterXRAsync('immersive-vr', 'local-floor', xr.renderTarget);
		},
		captureMouse: () => fps.requestLock(),
		dispose() {
			desktopHand.dispose();
			desktopPanels.dispose();
			fps.dispose();
			resetDesktopHud();
			window.removeEventListener('resize', onResize);
			setTextInputProvider(null);
			stopGuiUploads();
			performanceOverlay.dispose();
			keyboards?.dispose();
			avatarSystem.dispose();
			hostAuthority?.dispose();
			guestSync?.dispose();
			worldPortalMenu.dispose();
			voice.dispose();
			sceneGraph.dispose();
			scriptAudio.dispose();
			models.dispose();
			mediaAssets.dispose();
			window.removeEventListener('keydown', passStrayKey);
			window.removeEventListener('keyup', passStrayKey);
			engine.dispose();
		}
	};
}
