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
	Quaternion,
	PointerEventTypes,
	type AbstractMesh,
	type TransformNode,
	type WebXRDefaultExperience
} from '@babylonjs/core';
import { initBrowserCodeBlockSandbox } from './sandbox/browserInit.ts';
import { getPlatformConfig, platformFetch, platformUrl, assetUrl } from './platform/config.ts';
import { getContent, findBuiltinWorld, loadBuiltinWorlds } from './content/registry.ts';
import { publicationFor } from './appPublication.ts';
import { getFeatures } from './features.ts';
import { engineLocale } from './i18n/locale.ts';
import type { InputDevice } from './inputHints.ts';
import { createSlot, findComponent, opensWorldMenu, type SlotTree } from '../ecs/types.ts';
import { atRest, instantiate } from '../ecs/serialize.ts';
import { isBuiltinMesh, migrateSlotTree } from '../assets/ref.ts';
import type { AssetResolver } from '../assets/resolve.ts';
import { CloudResolver } from '../assets/cloud.ts';
import { PeerResolver } from '../assets/p2p.ts';
import { getLocalAssetStore } from '../assets/store.ts';
import { importGlb } from '../assets/importGlb.ts';
import { parseAssetRef } from '../library/ref.ts';
import { pickVariant } from '../library/variants.ts';
import type { AssetProvenance } from '../library/provenance.ts';
import type { AssetDetail } from '../library/types.ts';
import { BlobAssetLibrary } from './blobAssetLibrary.ts';
import { createScriptAudio } from './scriptAudio.ts';
import { ModelLibrary } from './modelLibrary.ts';
import { SceneGraph } from './sceneGraph.ts';
import { SocketSystem } from './interaction/socketSystem.ts';
import { DropZoneSystem } from './interaction/dropZoneSystem.ts';
import { DashPinSystem } from './interaction/dashPinSystem.ts';
import { GrabSystem } from './interaction/grabSystem.ts';
import { EquipmentSystem } from './interaction/equipmentSystem.ts';
import { PressableButtonSystem } from './interaction/pressableButtonSystem.ts';
import { setupPointerAndGrabControllers, type PointerControllerNetworkHooks } from './interaction/pointerController.ts';
import { setupPanelToggle } from './interaction/panelToggle.ts';
import { placeInFrontOfCamera } from './interaction/panelPlacement.ts';
import { setupRotationController } from './interaction/rotationController.ts';
import { setupMovementController } from './interaction/movementController.ts';
import { setupPlayerBody } from './interaction/playerBody.ts';
import { SceneColliders } from './sceneColliders.ts';
import { createScriptPhysics, type ScriptPhysics } from './scriptPhysics.ts';
import { viewPlayerPose } from './playerPoses.ts';
import { registerIrradiancePlugin } from './irradiancePlugin.ts';
import { cameraHeadPose } from './avatar/headPose.ts';
import { readHandPoses } from './avatar/localHands.ts';
import { setupFpsController } from './interaction/desktop/fpsController.ts';
import { setupDesktopPanels } from './interaction/desktop/desktopPanels.ts';
import { setupDesktopHand } from './interaction/desktop/desktopHand.ts';
import { desktopHud, hudActions, resetDesktopHud } from './interaction/desktop/desktopHud.svelte.ts';
import type { RadialItem } from './ui/radialView.ts';
import { setupLocomotion } from './locomotion.ts';
import { setupHandControllerSwitch } from './interaction/handControllerSwitch.ts';
import { createDashPanel, type DashPanelHandle } from './ui/dashPanel.ts';
import { createInspectorHost } from './ui/inspectorHost.ts';
import { createDropZoneOutline } from './ui/dropZoneOutline.ts';
import { forwardKeyTo } from './keyForwarding.ts';
import { createRemoteRadial, setupRadialMenuForHand } from './ui/radialMenu.ts';
import { KeyboardSystem } from './keyboard/keyboardSystem.ts';
import { setTextInputProvider } from './keyboard/service.ts';
import { createPerformanceOverlay } from './ui/performanceOverlay.ts';
import { createStatusNotice } from './ui/statusNotice.ts';
import { uploadGuiBeforeDrawing } from './guiUploads.ts';
import { FOVEATION, loadSettings, saveSettings, xrSettings } from './settings.ts';
import { selectTargetFrameRate, XR_FRAMEBUFFER_SCALE } from './performance.ts';
import { sanitizeAvatarTree } from './avatar/sanitize.ts';
import { saveWithPreview } from './inventorySave.ts';
import { captureItemThumbnail, configureThumbnails } from './thumbnail/capture.ts';
import { ensureCloudAssets } from '../assets/cloudSync.ts';
import { configureThumbnailSources } from '../assets/thumbnails.ts';
import { AvatarSystem } from './avatar/avatarSystem.ts';
import { PlayerAvatars } from './avatar/playerAvatars.ts';
import { loadBaseAvatar } from './avatar/baseAvatar.ts';
import type { AvatarHooks } from './avatar/avatarHooks.ts';
import { HostAuthority, type HostConnectionEvent } from './net/hostAuthority.ts';
import { GuestSync, type GuestConnectionStatus, type GuestEndReason } from './net/guestSync.ts';
import { WorldStorageService } from './worldStorageService.ts';
import { createWorldItemStore } from '../worldStorage/items.ts';
import { localWorldItems } from '../worldStorage/localItems.ts';
import { cloudWorldItems } from '../worldStorage/cloudItems.ts';
import { setWorldItemStore } from '../worldStorage/registry.ts';
import { createExternalResolver } from '../inventory/externalResolver.ts';
import { PaymentService } from './payments/paymentService.ts';
import { createMetaPayments } from './payments/metaPayments.ts';
import { createAtmController } from './payments/atmController.ts';
import { createAtmPanel } from './ui/atmPanel.ts';
import { createPurchasePrompt } from './ui/purchasePrompt.ts';
import type { PayResult } from './payments/types.ts';
import { ProximityVoice } from './net/voice.ts';
import { parseIceServers } from './net/peerConnection.ts';
import { currentUser, isAdminUser } from './platform/auth.ts';
import { BLANK_WORLD_NAME, buildBlankWorld } from './blankWorld.ts';
import { gameState, type LoadedWorld, type PublicationContext } from './gameState.ts';
import type { HostedWorldVisibility } from '../worldVisibility.ts';
import type { PlayerInfo } from './net/protocol.ts';
import { createWorldOrb, copyScene, validateWorldPackage, validateWorldScene, worldFromInventory, MAX_SHARED_SCENE_BYTES } from '../worlds/package.ts';
import type { WorldPackage } from '../worlds/types.ts';
import type { InventoryAdapterId, InventoryStorageAdapterId, InventoryItem } from '../inventory/types.ts';
import { createWorldPortalMenu } from './ui/worldPortalMenu.ts';
import { canHoldWorlds, getInventoryAdapter } from '../inventory/registry.ts';
import { getInventoryContext } from './gameState.ts';

export interface MountedGame {
	xrSupported: boolean;
	enterVR(): Promise<void>;
	/** Desktop: captures the mouse for looking around (it must be called from a click or key press). */
	captureMouse(): void;
	/** The tabs of the personal menu: add your own (a page built with Babylon GUI), remove or open one. */
	dash: Pick<DashPanelHandle, 'addTab' | 'removeTab' | 'showTab' | 'pageSize'>;
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
	// Code blocks run in a sandbox that has to be loaded before the first scene is.
	await initBrowserCodeBlockSandbox();
	// The scene to stand in when no world is asked for: the hosting app's lobby, if it has one.
	const homeScene = options.initialWorld ? null : ((await getContent().loadHome?.()) ?? null);
	// Babylon 9 no longer creates its audio engine by default; without it every Sound (audio players,
	// generated impact sounds) has no backend and throws on use.
	const engine = new Engine(canvas, true, { audioEngine: true });
	// Baked lighting: every lit material made from here on can read the world's baked volumes. It needs 3D textures (WebGL 2).
	registerIrradiancePlugin(((engine as unknown as { webGLVersion?: number }).webGLVersion ?? 2) >= 2);
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
	// Sounds placed in the world are heard from where the player's head is, facing where it faces. The engine is the only one
	// that moves the listener: Babylon's own Sounds (impacts, audio players) would also move it twice a second, from its camera
	// and with forward the other way round, and each of those jumps back and forth is heard as a crackle.
	scene.audioPositioningRefreshRate = Number.POSITIVE_INFINITY;
	/** Where the player's ears are and which way they face, in Web Audio's terms: for the world's sounds and for voice chat. */
	const readListenerPose = () => {
		const eye = getActiveCamera();
		const forward = eye.getDirection(Vector3.Forward(scene.useRightHandedSystem)), up = eye.getDirection(Vector3.Up());
		// Web Audio's axes are right-handed: in a left-handed scene its right ear would be the player's left one. With up flipped,
		// left and right and front and back come out right; only above and below swap, which a mirror cannot avoid.
		if (!scene.useRightHandedSystem) up.scaleInPlace(-1);
		return {
			position: eye.globalPosition.asArray() as [number, number, number],
			forward: forward.asArray() as [number, number, number],
			up: up.asArray() as [number, number, number]
		};
	};
	scene.onBeforeRenderObservable.add(() => {
		const { position, forward, up } = readListenerPose();
		scriptAudio.setListener(position, forward, up);
	});
	// Previews of what is saved are drawn as a second scene on this engine (a second WebGL context would be costly on a headset).
	configureThumbnails({ engine, getResolvers: () => assetResolvers });
	configureThumbnailSources(() => assetResolvers);
	const worldStorage = new WorldStorageService({
		fetch: (input, init) => platformFetch(input, init),
		getLocalPlayerId: () => localPlayerId,
		getPlayerName: (playerId) => playerId === localPlayerId ? (gameState.userName ?? 'Player') : (hostAuthority?.getPlayerDisplayName(playerId) ?? 'Player'),
		getPublication: () => gameState.publication,
		getRoomCode: () => gameState.roomCode,
		getRole: () => gameState.role,
		isSignedIn: () => !!gameState.userId,
		relay: (playerId, call) => hostAuthority?.relayPlayerApi(playerId, call) ?? Promise.resolve({ ok: false, error: 'No session is hosted' })
	});
	// What this world has saved for its host, kept where the host chose (this device or the cloud); only a hosted published world has any.
	const worldItems = createWorldItemStore({
		backends: { local: localWorldItems, cloud: cloudWorldItems(() => !!gameState.userId) },
		getLocation: () => xrSettings.worldStorageLocation,
		getPublicationId: () => (gameState.role === 'guest' ? null : gameState.publication?.publicationId ?? null)
	});
	setWorldItemStore(worldItems);
	// Objects from outside the world (starter kit, marketplace, public cloud objects, saved objects) that loaders and scripts bring in.
	const externalItems = createExternalResolver({
		worldStorage: { read: async (ref) => { const item = await worldItems.find(ref); return item ? { name: item.name, slotData: item.slotData } : null; } }
	});
	// Paying: the prompt and the service belong to the game, outside everything a world's scripts can reach (see ui/purchasePrompt.ts).
	const purchasePrompt = createPurchasePrompt(scene, () => getActiveCamera());
	// In-app purchases with Meta's payments (see payments/metaPayments.ts): used by the ATM and by the purchase prompt's "Add credits".
	const metaPayments = createMetaPayments({ fetch: (input, init) => platformFetch(input, init) });
	const metaTopUp = metaPayments.topUp(async () => ((await platformFetch('/api/credits').then((response) => response.json())) as { packs: Array<{ id: string; credits: number; metaSku: string }> }).packs);
	const paymentService = new PaymentService({
		fetch: (input, init) => platformFetch(input, init),
		isSignedIn: () => !!gameState.userId,
		prompt: (details) => purchasePrompt.show(details),
		topUp: metaTopUp
	});
	let viewerCamera: () => { globalPosition: Vector3 } = () => desktopCamera;
	// Which device's controls the texts of the world name (`{dash}`, `{use}`…). It follows the headset session, and the panels are redrawn when it changes.
	let inputDevice: InputDevice = 'desktop';
	// `ctx.physics` is answered from the scene's colliders, which exist once the scene graph does.
	let scriptPhysics: ScriptPhysics | null = null;
	const physicsProxy: ScriptPhysics = {
		raycast: (...args) => scriptPhysics?.raycast(...args) ?? null,
		sphereCast: (...args) => scriptPhysics?.sphereCast(...args) ?? null,
		overlapSphere: (...args) => scriptPhysics?.overlapSphere(...args) ?? [],
		closest: (...args) => scriptPhysics?.closest(...args) ?? null
	};
	/** Everyone in the world, the local player first. */
	const listPlayers = () => [
		{ id: localPlayerId, name: gameState.userName ?? 'Player', role: gameState.role === 'guest' ? ('guest' as const) : ('host' as const) },
		...(hostAuthority?.listGuests() ?? [])
	];
	const sceneGraph = new SceneGraph(scene, {
		physics: physicsProxy,
		setPlayerVelocity: (playerId, velocity, add) => {
			if (playerId === localPlayerId) {
				if (add) playerBody.addImpulse(velocity); else playerBody.setVelocity(velocity);
				return true;
			}
			return hostAuthority?.impulseGuest(playerId, velocity, add) ?? false;
		},
		hapticPulse: (playerId, hand, intensity, durationMs) => {
			if (playerId === localPlayerId) return pulseControllers(hand, intensity, durationMs);
			return hostAuthority?.hapticGuest(playerId, hand, intensity, durationMs) ?? false;
		},
		getUiContext: () => ({ locale: engineLocale(), device: inputDevice }),
		sameOriginPathsFor: (code) => getContent().sameOriginPathsFor?.(code) ?? [],
		storage: worldStorage,
		worldItems,
		externalItems,
		audio: scriptAudio,
		payments: {
			// The host asks for a player; the player's own client does the paying, with their own account.
			request: async (playerId, sku): Promise<PayResult> => {
				const id = playerId ?? localPlayerId;
				if (id === localPlayerId) return paymentService.buy(gameState.publication?.publicationId, sku);
				const answer = await (hostAuthority?.relayPayment(id, 'buy', sku) ?? Promise.resolve<PayResult>({ ok: false, reason: 'unavailable' }));
				return 'ok' in answer ? answer : { ok: false, reason: 'error' };
			},
			owns: async (playerId, sku) => {
				const id = playerId ?? localPlayerId;
				if (id === localPlayerId) return paymentService.owns(gameState.publication?.publicationId, sku);
				const answer = await (hostAuthority?.relayPayment(id, 'owns', sku) ?? Promise.resolve({ owns: false }));
				return 'owns' in answer && answer.owns === true;
			}
		},
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
		onImportLibraryAsset: async (ref, name) => {
			if (gameState.role === 'guest') throw new Error('Only the host can import models into this world.');
			if (!parseAssetRef(ref)) throw new Error('Invalid library reference.');
			const detailResponse = await platformFetch(`/api/library/assets/${encodeURIComponent(ref)}`);
			const detail = await detailResponse.json().catch(() => null) as AssetDetail | { message?: string } | null;
			if (!detailResponse.ok || !detail || !('variants' in detail)) throw new Error((detail as { message?: string } | null)?.message ?? 'Could not read this asset.');
			if (detail.kind !== 'model') throw new Error('Only models can be imported into a world from a script.');
			const variant = pickVariant(detail.variants, { formats: ['glb', 'gltf'] });
			if (!variant) throw new Error(detail.variants.find((candidate) => candidate.unsupported)?.unsupported ?? 'There is no version of this model that can be imported.');
			const response = await platformFetch(`/api/library/assets/${encodeURIComponent(ref)}/file?${new URLSearchParams({ variant: variant.id, role: 'model' })}`);
			if (!response.ok) {
				const body = await response.json().catch(() => null) as { message?: string } | null;
				throw new Error(body?.message ?? 'Could not download this model.');
			}
			const objectName = (name.trim().slice(0, 80) || detail.title);
			const provenance: AssetProvenance = { source: parseAssetRef(ref)!.source, ref, sourceUrl: detail.sourceUrl, ...(detail.author ? { author: detail.author } : {}), license: detail.license, importedAt: Date.now() };
			const { manifest } = await importGlb(new Uint8Array(await response.arrayBuffer()), `${objectName}.glb`, getLocalAssetStore(), undefined, provenance);
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
		onSpawnRequest: (slot, spawnOptions) => {
			sceneGraph.addSlot(slot);
			if (gameState.role === 'guest') guestSync?.requestSpawn(slot);
			else if (spawnOptions?.ephemeral) hostAuthority?.broadcastEphemeral(slot);
			else hostAuthority?.broadcastSnapshot();
		},
		onDeleteRequest: (slotId) => {
			if (gameState.role === 'guest') guestSync?.requestDelete(slotId);
			else {
				sceneGraph.removeSlot(slotId);
				hostAuthority?.broadcastSnapshot();
			}
		},
		// A script changed a slot: what guests lack is told as a difference (components that changed, a slot switched off), not as the whole
		// world; a pose goes with the state stream; what changes the shape of the hierarchy needs everyone to be told it all.
		onSlotMutated: (slotId, change) => {
			if (gameState.role === 'guest') return;
			if (change === 'structure') hostAuthority?.broadcastSnapshot();
			else if (change === 'flush') hostAuthority?.broadcastSlotsChanged(sceneGraph.takeQuietChanges());
			else if (change === 'pose') hostAuthority?.broadcastSlotsChanged(sceneGraph.takeQuietChanges());
			else hostAuthority?.broadcastSlotsChanged([slotId, ...sceneGraph.takeQuietChanges()]);
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
				// Scripts know a guest by the id it announced, the one `onPlayerReady` and `ctx.storage.player` use.
				return { id: hostAuthority?.announcedIdFor(guestId) ?? guestId, name: hostAuthority?.getPlayerDisplayName(guestId) ?? 'Guest' };
			}
			return {
				id: localPlayerId,
				name: gameState.userName ?? (gameState.role === 'guest' ? 'Guest' : gameState.role === 'host' ? 'Host' : 'Player')
			};
		},
		scriptPlayerId: (equipmentKey) => (equipmentKey === localPlayerId ? equipmentKey : (hostAuthority?.announcedIdFor(equipmentKey) ?? equipmentKey)),
		getPlayers: () => listPlayers(),
		getPlayerPose: (playerId) => {
			if (playerId === localPlayerId) return viewPlayerPose({ head: cameraHeadPose(getActiveCamera()), ...readHandPoses(xr) });
			const pose = hostAuthority?.getGuestPose(playerId);
			return pose ? viewPlayerPose(pose) : null;
		},
		teleportPlayer: (playerId, target) => {
			if (playerId === localPlayerId) {
				playerBody.teleport(target);
				return true;
			}
			return hostAuthority?.teleportGuest(playerId, target) ?? false;
		},
		// A script puts something in the hand of a player, or takes it off. The host decides equipment: its own hands are here, a
		// guest's are told by a message (and mirror it on their own hands).
		equipPlayer: (playerId, slotId, hand): boolean => {
			if (gameState.role === 'guest') return false;
			if (playerId !== localPlayerId) return hostAuthority?.equipGuest(playerId, slotId, hand) ?? false;
			const handNode = localHandNode(hand);
			return Boolean(handNode) && equipment.equip(localPlayerId, hand, handNode!, slotId, { replace: true });
		},
		unequipPlayer: (playerId, hand): boolean => {
			if (gameState.role === 'guest') return false;
			return playerId === localPlayerId ? equipment.unequip(localPlayerId, hand) : (hostAuthority?.unequipGuest(playerId, hand) ?? false);
		},
		// A script opens the menu of the game at a tab (the invitation, say) on this device.
		openDash: (tab, options): void => openDashAt(tab, options)
	});
	/** The node a hand's equipment hangs from on this device: a controller's grip in a headset, the mouse's hand on a desktop (the right one only). */
	function localHandNode(hand: 'left' | 'right'): TransformNode | undefined {
		const inXr = xr?.baseExperience.state === WebXRState.IN_XR;
		const controller = inXr ? xr!.input.controllers.find((candidate) => candidate.inputSource.handedness === hand) : undefined;
		return controller ? (controller.grip ?? controller.pointer) : !inXr && hand === 'right' ? desktopHand?.handNode : undefined;
	}
	/** Opens the dash at a tab: in front of the player in a headset, docked on a desktop. */
	function openDashAt(tab: string, options?: { invite?: boolean }): void {
		// On the next frame, once the click or the trigger that asked has been dealt with: a menu that opens in the middle of the
		// event of a press can be closed by that same event.
		scene.onBeforeRenderObservable.addOnce(() => {
			try {
				dash.showTab(tab);
				if (options?.invite) dash.openInvite();
				if (xr?.baseExperience.state === WebXRState.IN_XR) placeInFrontOfCamera(dash.root, getActiveCamera(), xrSettings.dashDistance, -0.15);
				dash.root.setEnabled(true);
			} catch (error) {
				console.error('[engine] could not open the menu', error);
			}
		});
	}
	// A world asked for on its own only needs a temporary floor during input setup. Avoid starting lobby media that would be disposed mid-load.
	sceneGraph.load(options.initialWorld || !homeScene ? buildBlankWorld() : homeScene);

	const floorMesh = sceneGraph.getLive('floor')?.node as AbstractMesh | undefined;
	// Controller profiles + models (Meta/Oculus Touch) are served from /static/xr-input-profiles instead of
	// Babylon's default of immersive-web.github.io: a headset on a LAN without a route to GitHub Pages
	// never gets an answer (the request hangs rather than fails), and no motion controller would ever
	// initialise. A controller not in the local set falls back to Babylon's built-in profiles.
	WebXRMotionControllerManager.BaseRepositoryUrl = assetUrl('/xr-input-profiles');
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
		if (state === WebXRState.IN_XR || state === WebXRState.NOT_IN_XR) {
			inputDevice = state === WebXRState.IN_XR ? 'xr' : 'desktop';
			sceneGraph.refreshUI();
		}
		if (state === WebXRState.IN_XR) options.onXRStateChange?.('in-xr');
		else if (state === WebXRState.NOT_IN_XR) options.onXRStateChange?.('not-in-xr');
	});
	const getActiveCamera = () => (xr?.baseExperience.state === WebXRState.IN_XR ? xr.baseExperience.camera : desktopCamera);
	viewerCamera = getActiveCamera;
	/** What the player must know about the session's connection, held in front of the view. */
	const statusNotice = createStatusNotice(scene, getActiveCamera);
	let guestStatus: GuestConnectionStatus = 'connecting';
	function showGuestStatus(status: GuestConnectionStatus): void {
		const previous = guestStatus;
		guestStatus = status;
		if (status === 'unstable') statusNotice.show('The connection to the host is unstable…', { tone: 'warn' });
		else if (status === 'reconnecting') statusNotice.show('Lost the connection to the host. Reconnecting…', { tone: 'warn' });
		else if (status === 'connected' && (previous === 'unstable' || previous === 'reconnecting')) {
			statusNotice.show(previous === 'reconnecting' ? 'Reconnected to the host.' : 'The connection is stable again.', { durationMs: 3_000 });
		}
	}
	const GUEST_END_NOTICES: Record<GuestEndReason, { message: string; tone: 'info' | 'error' } | null> = {
		left: null,
		'host-left': { message: 'The host ended the session.', tone: 'info' },
		lost: { message: 'Could not reconnect to the host. You left the session.', tone: 'error' },
		unreachable: { message: 'Could not reach the host of this session.', tone: 'error' },
		refused: { message: 'This session is only open to the host\u2019s friends.', tone: 'error' },
		incompatible: { message: 'The host runs another version of the game. Reload the page to update.', tone: 'error' }
	};
	let hostSignaling: 'connecting' | 'connected' | 'reconnecting' = 'connecting';
	function showHostEvent(event: HostConnectionEvent): void {
		if (event.kind === 'signaling') {
			const previous = hostSignaling;
			hostSignaling = event.status;
			if (event.status === 'reconnecting') statusNotice.show('Lost the connection to the server. Reconnecting… (players already here can keep playing)', { tone: 'warn' });
			else if (event.status === 'connected' && previous === 'reconnecting') statusNotice.show('Reconnected to the server.', { durationMs: 3_000 });
		} else if (event.kind === 'guest-lost') statusNotice.show(`${event.name} lost the connection. Waiting for them to come back…`, { tone: 'warn', durationMs: 8_000 });
		else if (event.kind === 'guest-back') statusNotice.show(`${event.name} is back.`, { durationMs: 4_000 });
		else statusNotice.show(`${event.name} could not reconnect and left.`, { tone: 'warn', durationMs: 6_000 });
	}

	loadSettings();
	AbstractEngine.audioEngine?.setGlobalVolume(xrSettings.masterVolume);
	const sceneColliders = new SceneColliders(sceneGraph);
	scriptPhysics = createScriptPhysics(sceneColliders, (id) => sceneGraph.getLive(id)?.slot.parentId ?? null);
	/** Buzzes the controllers of this device's player (`ctx.haptics.pulse`). Returns whether there was one to buzz. */
	function pulseControllers(hand: 'left' | 'right' | 'both', intensity: number, durationMs: number): boolean {
		let buzzed = false;
		for (const controller of xr?.input.controllers ?? []) {
			const side = controller.inputSource.handedness;
			if (hand !== 'both' && side !== hand) continue;
			const motion = controller.motionController;
			if (motion) {
				void motion.pulse(intensity, durationMs);
				buzzed = true;
			}
		}
		return buzzed;
	}
	const grabSystem = new GrabSystem(scene, sceneGraph);
	// Bodies for every player: the host (or a solo player) owns the avatar slots, everyone poses them from presence.
	// Where the floor is under a head, from the player's body (set once it exists): an avatar's feet stand on it however high the player has climbed.
	let floorProbe: ((x: number, y: number, z: number) => number | null) | null = null;
	const avatarSystem = new AvatarSystem(scene, sceneGraph, {
		getFloorY: (x, y, z) => floorProbe?.(x, y, z) ?? null,
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
	const equipment: EquipmentSystem = new EquipmentSystem(
		scene,
		sceneGraph,
		grabSystem,
		() => localPlayerId,
		(playerId) =>
			hostAuthority?.getPlayerDisplayName(playerId) ??
			(playerId === localPlayerId ? (gameState.userName ?? 'Player') : 'Player'),
		// Hand events carry the id a guest announced, like `onPlayerReady` and `ctx.storage.player` do.
		(playerId) => (playerId === localPlayerId ? playerId : (hostAuthority?.announcedIdFor(playerId) ?? playerId))
	);
	// Same "grip if present, else pointer" node pointerController.ts already
	// uses as each hand/controller's interaction point — reused here so a
	// pressable button reacts identically to hand-tracking and controllers.
	let locomotion: ReturnType<typeof setupLocomotion> | null = null;
	const playerBody = setupPlayerBody(scene, sceneGraph, xr, desktopCamera, { x: desktopCamera.position.x, z: desktopCamera.position.z }, sceneColliders);
	floorProbe = (x, y, z) => playerBody.floorAt(x, y, z);
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
				.filter((entry) => (!entry.system || entry.fragment) && entry.slot.components.some((component) => component.type === 'meshRenderer' && (isBuiltinMesh(component.meshRef, 'ground') || isBuiltinMesh(component.meshRef, 'disc'))))
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
	const iceServers = parseIceServers(getPlatformConfig().stunUrls);
	const voice = new ProximityVoice();
	let localAudio: { track: MediaStreamTrack; stream: MediaStream } | null = null;

	async function refreshUser(): Promise<void> {
		const user = await currentUser();
		gameState.userId = user?.id ?? null;
		gameState.userName = user?.name ?? null;
		gameState.isAdmin = isAdminUser(user);
	}
	await refreshUser();
	const localPlayerId = crypto.randomUUID();
	let refreshWorldsTab = () => {};

	async function ensureLocalAudio() {
		// Quest cannot show the mic prompt inside VR: it pulls the player out of the session. Joining without voice is better.
		if (!localAudio && xr?.baseExperience.state === WebXRState.IN_XR && (await voice.micPermission()) === 'prompt') {
			console.warn('[voice] microphone not allowed yet; joining without voice');
			return undefined;
		}
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
			const res = await platformFetch(`/api/worlds/${gameState.worldId}/host`, { method: 'DELETE' });
			if (!res.ok) throw new Error('Could not close the hosted session');
		}
		hostAuthority?.dispose();
		hostAuthority = null;
		guestSync?.dispose();
		guestSync = null;
		statusNotice.hide(); // what it said was about the session left
		resetSessionState();
		if (wasGuest) {
			// The other players' avatars belonged to that session; ours is placed again by this device.
			playerAvatars.clearAll();
			void applyLocalAvatar();
		}
	}

	async function launchScene(name: string, snapshot: SlotTree, visibility: HostedWorldVisibility | 'solo', loaded: LoadedWorld | null = null, publication: PublicationContext | null = null): Promise<void> {
		// A world with no publication of its own belongs to the game's app, if it is one (see appPublication.ts).
		publication ??= publicationFor(undefined, getPlatformConfig().appId);
		validateWorldScene(snapshot);
		snapshot = migrateSlotTree(snapshot);
		if (visibility !== 'solo' && visibility !== 'private' && !gameState.userId) {
			throw new Error('Sign in to host a public session');
		}
		const previousScene = sceneGraph.serialize({ withExternal: true });
		const track = visibility === 'solo' ? undefined : await ensureLocalAudio();
		let roomCode = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
		let worldId: string | null = null;
		let startedAt = new Date().toISOString();
		if (visibility !== 'solo' && gameState.userId) {
			const res = await platformFetch('/api/worlds', {
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
			hostSignaling = 'connecting';
			hostAuthority.setStatusHandler(showHostEvent);
			hostAuthority.setStorageHooks({
				getPublicationId: () => gameState.publication?.publicationId ?? null,
				onPlayerReady: (player) => sceneGraph.dispatchPlayerReady({ id: player.playerId, name: player.displayName }),
				onPlayerLeft: (player) => sceneGraph.dispatchPlayerLeft({ id: player.playerId, name: player.displayName })
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
			if (worldId) void platformFetch(`/api/worlds/${worldId}/host`, { method: 'DELETE' });
			throw error;
		}
	}

	/** The picture the Worlds tab shows for this session. It is made once the session is up, so hosting never waits for it. */
	async function uploadWorldPreview(worldId: string, snapshot: SlotTree): Promise<void> {
		try {
			const thumbnailAssetId = await captureItemThumbnail(snapshot, 'world');
			if (!thumbnailAssetId) return;
			await ensureCloudAssets([], getLocalAssetStore(), { extraIds: [thumbnailAssetId] });
			await platformFetch(`/api/worlds/${worldId}/preview`, {
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
		await launchScene(world.name, world.scene, visibility, loaded, publicationFor(source, null));
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
			(reason) => {
				guestSync = null;
				resetSessionState();
				playerAvatars.clearAll();
				void applyLocalAvatar();
				refreshWorldsTab();
				const notice = GUEST_END_NOTICES[reason];
				if (notice) statusNotice.show(notice.message, { tone: notice.tone, durationMs: 8_000 });
				else statusNotice.hide();
			},
			refreshTeleportFloors,
			() => void applyLocalAvatar()
		);
		playerBody.respawn();
		guestStatus = 'connecting';
		guestSync.setStatusHandler(showGuestStatus);
		guestSync.setAvatarHooks(guestAvatarHooks);
		guestSync.setStorageHooks({
			onPublication: (publicationId) => { gameState.publication = publicationId ? { publicationId, revisionId: null } : null; },
			handlePlayerApi: (publicationId, call) => worldStorage.handleRelayed(publicationId, call)
		});
		guestSync.setTeleportHandler((target) => playerBody.teleport(target));
		guestSync.setBodyHandlers({ impulse: (velocity, add) => (add ? playerBody.addImpulse(velocity) : playerBody.setVelocity(velocity)), haptic: (hand, intensity, durationMs) => void pulseControllers(hand, intensity, durationMs) });
		// The host put something in this player's hand: the same on the hands of this device (the host already did it on its side).
		guestSync.setEquipHandler((slotId, hand) => {
			const handNode = localHandNode(hand);
			if (handNode) equipment.equip(localPlayerId, hand, handNode, slotId, { replace: true });
		});
		guestSync.setPaymentHandler(async (publicationId, sku, op) => op === 'buy'
			? paymentService.buy(publicationId, sku, gameState.roomCode)
			: { owns: await paymentService.owns(publicationId, sku) });
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
		// A UI panel is read from its front (-Z): turned to face whoever spawns it, not left to show its back, which reads mirrored.
		if (findComponent(tree[0], 'uiPanel')) {
			const forward = camera.getForwardRay().direction;
			tree[0] = { ...tree[0], rotation: Quaternion.FromEulerAngles(0, Math.atan2(forward.x, forward.z), 0).asArray() as [number, number, number, number] };
		}
		for (const slot of tree) {
			sceneGraph.addSlot(slot);
			if (gameState.role === 'guest') guestSync?.requestSpawn(slot);
		}
		if (gameState.role !== 'guest') hostAuthority?.broadcastSnapshot();
	}

	function spawnWorldOrb(item: InventoryItem, adapterId: InventoryStorageAdapterId): void {
		spawnWorldOrbPackage(worldFromInventory(item, adapterId, gameState.userId));
	}

	// The in-game inspector is the hosting app's own page in a panel: an app that does not serve one turns it off.
	const inspector = getFeatures().inspector ? createInspectorHost(scene, sceneGraph, {
		onSceneChanged: () => {
			if (gameState.role !== 'guest') hostAuthority?.broadcastSnapshot();
		},
		getViewPose: () => {
			const camera = getActiveCamera();
			return { position: camera.globalPosition.asArray() as [number, number, number], rotation: camera.absoluteRotation.asArray() as [number, number, number, number] };
		}
	}) : null;
	// A drop zone has no mesh of its own: its box is drawn while the inspector has it marked, so it can be seen and adjusted there.
	if (inspector) createDropZoneOutline(scene, sceneGraph, () => inspector.selectedSlotId());

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
		getUiContext: () => ({ locale: engineLocale(), device: inputDevice }),
		getPlayers: () => listPlayers(),
		onToggleInspector: inspector ? () => inspector.root.setEnabled(!inspector.root.isEnabled()) : null,
		onSeatedModeChanged: () => playerBody.setSeated(xrSettings.seatedMode),
		onDesktopSettingsChanged: () => fps.applySettings(),
		onAudioSettingsChanged: () => AbstractEngine.audioEngine?.setGlobalVolume(xrSettings.masterVolume),
		onPerformanceSettingsChanged: () => applyPerformanceSettings(),
		frameRates: () => supportedFrameRates
	});
	refreshWorldsTab = dash.refreshWorldsTab;

	// The ATM's window belongs to the game: an `atm` component only asks for it to open.
	const atmPanel = createAtmPanel(scene, getActiveCamera, createAtmController({
		fetch: (input, init) => platformFetch(input, init),
		meta: metaPayments,
		isSignedIn: () => !!gameState.userId
	}), { openWebsite: () => { window.open(platformUrl(getPlatformConfig().creditsPageUrl), '_blank', 'noopener'); }, inXr });
	const worldPortalMenu = createWorldPortalMenu(scene, sceneGraph, getActiveCamera, launchWorldPackage, async (world) => {
		validateWorldPackage(world);
		const selected = getInventoryAdapter(gameState.currentInventoryAdapterId ?? 'local');
		const adapter = selected?.isAvailable(getInventoryContext()) && selected.saveItem && canHoldWorlds(selected.id) ? selected : getInventoryAdapter('local');
		if (!adapter?.saveItem) throw new Error('Choose a writable inventory first');
		const folderId = adapter.id === gameState.currentInventoryAdapterId ? gameState.currentInventoryFolderId : null;
		await saveWithPreview(adapter, getInventoryContext(), folderId, world.name, copyScene(world.scene), 'world');
	}, async (id) => {
		const world = await findBuiltinWorld(id);
		if (!world) throw new Error(`There is no built-in world "${id}"`);
		await launchScene(world.name, copyScene(world.scene), 'solo');
	}, async (worldId) => {
		const response = await platformFetch(`/api/published-worlds/${encodeURIComponent(worldId)}`);
		if (!response.ok) throw new Error('Could not load the published world');
		await launchWorldPackage((await response.json()) as WorldPackage, 'solo');
	}, () => launchScene(BLANK_WORLD_NAME, buildBlankWorld(), 'solo'));
	/** Pointing at a slot of the game's own menus and pressing: a cash machine opens the credits window, a world orb or link its menu. */
	function openSlotMenu(slotId: string): void {
		if (sceneGraph.getLive(slotId)?.slot.components.some((component) => component.type === 'atm')) {
			worldPortalMenu.close();
			atmPanel.open();
			return;
		}
		atmPanel.close();
		worldPortalMenu.open(slotId);
	}
	scene.onPointerObservable.add((event) => {
		// With the mouse captured the hand opens portals itself (see desktopHand.ts); this is for a free cursor.
		if (event.type !== PointerEventTypes.POINTERPICK || inXr() || fps.locked) return;
		const slotId = sceneGraph.getSlotIdForNode(event.pickInfo?.pickedMesh);
		const slot = slotId ? sceneGraph.getLive(slotId)?.slot : undefined;
		if (slotId && slot && opensWorldMenu(slot)) openSlotMenu(slotId);
	});
	// The reactions to a trigger, a grab or a portal are the same whether a controller or the mouse's hand does it.
	const pointerHooks: PointerControllerNetworkHooks = {
		onWorldPortal: (slotId) => openSlotMenu(slotId),
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
	// Letting go of UI over the open menu's Home keeps a copy there.
	new DashPinSystem(scene, sceneGraph, grabSystem, () => gameState.role !== 'guest');
	setupPanelToggle(scene, xr, dash.root, getActiveCamera, { keyboardKey: 'tab', buttonIdPattern: /x-button|menu/i, distance: () => xrSettings.dashDistance });
	if (inspector) setupPanelToggle(scene, xr, inspector.root, getActiveCamera, { keyboardKey: 'i', buttonIdPattern: /a-button/i });
	const radialNetwork = {
		getInspectTarget: (hand: 'left' | 'right') => inspector?.root.isEnabled() ? pointerState?.getLaserTarget(hand) ?? null : null,
		onInspect: (slotId: string) => { inspector?.select(slotId); },
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
		},
		remoteRadial: createRemoteRadial(() => (gameState.role === 'guest' ? guestSync : null))
	};
	if (xr) {
		setupRadialMenuForHand(scene, xr, sceneGraph, grabSystem, equipment, () => localPlayerId, 'left', /y-button/i, radialNetwork);
		setupRadialMenuForHand(scene, xr, sceneGraph, grabSystem, equipment, () => localPlayerId, 'right', /b-button/i, radialNetwork);
	}
	// Mouse and keyboard. The menu and the inspector fill the screen instead of standing in the world, and the mouse plays
	// the right hand: the same grabs, uses and radial menu a controller has (see interaction/desktop).
	const desktopPanels = setupDesktopPanels(scene, desktopCamera, [{ name: 'Menu', root: dash.root }, ...(inspector ? [{ name: 'Inspector', root: inspector.root }] : [])], {
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
	// A handle on the live scene for the browser's console while developing (stripped from a production build).
	if (import.meta.env?.DEV) (globalThis as { __kithin?: unknown }).__kithin = { scene, sceneGraph, dash, desktopCamera, desktopPanels };
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
			remoteRadial: radialNetwork.remoteRadial,
			onInspect: (slotId) => {
				if (!inspector) return;
				openPanel(inspector.root);
				inspector.select(slotId);
			}
		},
		globalItems: (): RadialItem[] => [
			{ label: 'Menu', isEnabled: () => true, onSelect: () => openPanel(dash.root) },
			...(inspector ? [{ label: 'Inspector', isEnabled: () => true, onSelect: () => openPanel(inspector.root) }] : [])
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
		voice.update(readListenerPose());
	});

	if (initialRoomCode) void joinWorld(initialRoomCode);
	else if (options.initialWorld) {
		const world = options.initialWorld;
		void launchWorldPackage(world, 'solo').catch((error) => console.error('Could not open the world', error));
	}

	void applyLocalAvatar();
	// Lets a developer inspect the live scene from the browser console.
	if (import.meta.env.DEV) (window as unknown as { __game?: unknown }).__game = { scene, sceneGraph, avatarSystem, playerAvatars, hostCurrentWorld, joinWorld, applyLocalAvatar, xrSettings };

	// Last of the per-frame work: GUI textures changed during this frame are uploaded before the cameras draw (see guiUploads.ts).
	const stopGuiUploads = uploadGuiBeforeDrawing(scene);
	engine.runRenderLoop(() => scene.render());
	// The first time a world is asked for, its module has to be fetched and built: with a click that seems to do nothing for seconds.
	// Doing it once the game is up (and the device has a moment to spare) makes the click instant.
	if (getContent().preloadWorlds) {
		const warm = () => void loadBuiltinWorlds().catch((error) => console.warn('[content] could not preload the worlds', error));
		if (typeof requestIdleCallback === 'function') requestIdleCallback(warm, { timeout: 8000 });
		else setTimeout(warm, 3000);
	}
	const onResize = () => engine.resize();
	window.addEventListener('resize', onResize);

	return {
		xrSupported,
		enterVR: async () => {
			if (!xr) return;
			const state = xr.baseExperience.state;
			if (state === WebXRState.IN_XR || state === WebXRState.ENTERING_XR) return;
			// Voice needs the mic once the player hosts or joins; asking inside VR would end the session (see ensureLocalAudio).
			const askedForMic = (await voice.micPermission()) === 'prompt';
			if (askedForMic) await voice.askMicPermission();
			try {
				await xr.baseExperience.enterXRAsync('immersive-vr', 'local-floor', xr.renderTarget);
			} catch (error) {
				// The prompt can use up the click that VR needs to start: a second tap no longer shows it.
				if (askedForMic) throw new Error('Microphone set up. Tap Enter VR again.');
				throw error;
			}
		},
		captureMouse: () => fps.requestLock(),
		dash: { addTab: dash.addTab, removeTab: dash.removeTab, showTab: dash.showTab, pageSize: dash.pageSize },
		dispose() {
			desktopHand.dispose();
			desktopPanels.dispose();
			fps.dispose();
			resetDesktopHud();
			window.removeEventListener('resize', onResize);
			setTextInputProvider(null);
			stopGuiUploads();
			performanceOverlay.dispose();
			statusNotice.dispose();
			keyboards?.dispose();
			avatarSystem.dispose();
			hostAuthority?.dispose();
			guestSync?.dispose();
			worldPortalMenu.dispose();
			purchasePrompt.dispose();
			atmPanel.dispose();
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
