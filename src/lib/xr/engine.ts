import {
	Engine,
	Scene,
	HemisphericLight,
	Vector3,
	UniversalCamera,
	WebXRState,
	type AbstractMesh
} from '@babylonjs/core';
import lobbyTemplate from './templates/lobby.json';
import type { Slot, SlotTree } from '$lib/ecs/types';
import { SceneGraph } from './sceneGraph';
import { GrabSystem } from './interaction/grabSystem';
import { setupPointerAndGrabControllers } from './interaction/pointerController';
import { setupPanelToggle } from './interaction/panelToggle';
import { setupRotationController } from './interaction/rotationController';
import { setupMovementController } from './interaction/movementController';
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
import { gameState } from './gameState';
import { PUBLIC_STUN_URLS } from '$env/static/public';

export interface MountedGame {
	dispose(): void;
}

/** Boots the whole game (the "juego base" — works with zero login, zero network). */
export async function mountGame(canvas: HTMLCanvasElement, initialRoomCode?: string): Promise<MountedGame> {
	const engine = new Engine(canvas, true);
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

	const sceneGraph = new SceneGraph(scene);
	sceneGraph.load(lobbyTemplate as SlotTree);

	const floorMesh = sceneGraph.getLive('floor')?.node as AbstractMesh | undefined;
	const xr = await scene.createDefaultXRExperienceAsync({
		floorMeshes: floorMesh ? [floorMesh] : [],
		// Babylon's pointer-selection feature defaults to ONE "attached"
		// controller at a time (switching between them), which made only one
		// laser actually pick/grab at once — enable both simultaneously.
		pointerSelectionOptions: { enablePointerSelectionOnAllControllers: true }
	});

	const getActiveCamera = () => (xr.baseExperience.state === WebXRState.IN_XR ? xr.baseExperience.camera : desktopCamera);

	loadSettings();
	const grabSystem = new GrabSystem(scene, sceneGraph);
	const locomotion = setupLocomotion(xr, floorMesh ? [floorMesh] : []);
	setupRotationController(scene, xr);
	setupMovementController(scene, xr);
	setupHandControllerSwitch(xr);
	const iceServers = parseIceServers(PUBLIC_STUN_URLS);
	const voice = new ProximityVoice();
	let localAudio: { track: MediaStreamTrack; stream: MediaStream } | null = null;

	let hostAuthority: HostAuthority | null = null;
	let guestSync: GuestSync | null = null;

	async function refreshUser(): Promise<void> {
		const { data } = await authClient.getSession();
		gameState.userId = data?.user.id ?? null;
		gameState.userName = data?.user.name ?? null;
	}
	await refreshUser();

	async function ensureLocalAudio() {
		if (!localAudio) localAudio = await voice.getLocalMicTrack();
		return localAudio ?? undefined;
	}

	async function hostCurrentWorld(): Promise<void> {
		if (!gameState.userId) return; // hosting requires an account (see plan: better-auth required to host)
		const track = await ensureLocalAudio();

		const res = await fetch('/api/worlds', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'My Lobby', sceneSnapshot: sceneGraph.serialize() })
		});
		if (!res.ok) return;
		const { world, session } = (await res.json()) as { world: { id: string }; session: { roomCode: string } };

		gameState.worldId = world.id;
		gameState.roomCode = session.roomCode;
		gameState.role = 'host';

		hostAuthority = new HostAuthority(scene, xr, sceneGraph, grabSystem, session.roomCode, iceServers, {
			localTrack: track,
			onRemoteStream: (_guestId, stream, targetNode) => voice.addPeer(_guestId, stream, targetNode)
		});
	}

	async function joinWorld(roomCode: string): Promise<void> {
		const track = await ensureLocalAudio();
		gameState.roomCode = roomCode;
		gameState.role = 'guest';

		guestSync = new GuestSync(scene, xr, sceneGraph, grabSystem, roomCode, iceServers, {
			localTrack: track,
			onRemoteStream: (stream, targetNode) => voice.addPeer('host', stream, targetNode)
		});
	}

	function spawnFromInventory(slotData: SlotTree): void {
		if (slotData.length === 0) return;
		// Ignore the saved position: it may have been captured while the object
		// was still held (parented to a hand), which is a meaningless local
		// offset as a world position — spawn in front of the player instead.
		const camera = getActiveCamera();
		const spawnPosition = camera.globalPosition.add(camera.getForwardRay().direction.scale(0.6));
		const root: Slot = {
			...slotData[0],
			id: crypto.randomUUID(),
			parentId: null,
			position: [spawnPosition.x, spawnPosition.y, spawnPosition.z]
		};
		sceneGraph.addSlot(root);
		if (guestSync) guestSync.requestSpawn(root);
	}

	const inspector = createInspectorPanel(scene, sceneGraph);

	const dash = createDashPanel(scene, sceneGraph, {
		onHostWorld: hostCurrentWorld,
		onJoinWorld: joinWorld,
		onSpawnItem: spawnFromInventory,
		onLocomotionSettingsChanged: () => locomotion.applySettings(),
		onExitVr: () => xr.baseExperience.exitXRAsync(),
		onToggleInspector: () => inspector.root.setEnabled(!inspector.root.isEnabled())
	});

	setupPointerAndGrabControllers(scene, xr, sceneGraph, grabSystem, {
		onGrab: (grabberId, slotId) => guestSync?.requestGrab(grabberId, slotId),
		onRelease: (grabberId) => guestSync?.requestRelease(grabberId)
	});
	setupPanelToggle(scene, xr, dash.root, getActiveCamera, { keyboardKey: 'm', buttonIdPattern: /x-button|menu/i });
	setupPanelToggle(scene, xr, inspector.root, getActiveCamera, { keyboardKey: 'i', buttonIdPattern: /a-button/i });
	setupRadialMenuForHand(scene, xr, sceneGraph, grabSystem, 'left', /y-button/i);
	setupRadialMenuForHand(scene, xr, sceneGraph, grabSystem, 'right', /b-button/i);

	scene.onBeforeRenderObservable.add(() => {
		const camera = getActiveCamera();
		voice.update({
			position: camera.position.asArray() as [number, number, number],
			forward: camera.getForwardRay().direction.asArray() as [number, number, number]
		});
	});

	if (initialRoomCode) void joinWorld(initialRoomCode);

	engine.runRenderLoop(() => scene.render());
	const onResize = () => engine.resize();
	window.addEventListener('resize', onResize);

	return {
		dispose() {
			window.removeEventListener('resize', onResize);
			hostAuthority?.dispose();
			guestSync?.dispose();
			voice.dispose();
			engine.dispose();
		}
	};
}
