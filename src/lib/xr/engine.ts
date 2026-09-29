import {
	Engine,
	Scene,
	HemisphericLight,
	Vector3,
	UniversalCamera,
	WebXRState,
	WebXREnterExitUIButton,
	type AbstractMesh
} from '@babylonjs/core';
import lobbyTemplate from './templates/lobby.json';
import type { SlotTree } from '$lib/ecs/types';
import { instantiate } from '$lib/ecs/serialize';
import { SceneGraph } from './sceneGraph';
import { GrabSystem } from './interaction/grabSystem';
import { PressableButtonSystem } from './interaction/pressableButtonSystem';
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
import type { HostedWorldVisibility } from '$lib/worldVisibility';
import type { PlayerInfo } from './net/protocol';
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

	let hostAuthority: HostAuthority | null = null;
	let guestSync: GuestSync | null = null;
	const sceneGraph = new SceneGraph(scene, {
		onMediaControl: (slotId, action) => {
			// Apply immediately on the local client so a click also unlocks
			// browser audio/video policies; the host remains authoritative.
			sceneGraph.controlMedia(slotId, action);
			if (gameState.role === 'guest') guestSync?.requestMediaControl(slotId, action);
			else hostAuthority?.broadcastSnapshot();
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

	const createXRButton = (label: string, sessionMode: XRSessionMode, referenceSpaceType: XRReferenceSpaceType) => {
		const button = document.createElement('button');
		button.textContent = label;
		button.style.margin = '6px';
		button.style.padding = '10px 14px';
		button.style.border = '0';
		button.style.borderRadius = '8px';
		button.style.background = '#2563eb';
		button.style.color = 'white';
		button.style.font = '600 14px system-ui, sans-serif';
		return new WebXREnterExitUIButton(button, sessionMode, referenceSpaceType);
	};
	const xrButtons = [createXRButton('Enter VR', 'immersive-vr', 'local-floor')];

	const floorMesh = sceneGraph.getLive('floor')?.node as AbstractMesh | undefined;
	const xr = await scene.createDefaultXRExperienceAsync({
		floorMeshes: floorMesh ? [floorMesh] : [],
		// Babylon's pointer-selection feature defaults to ONE "attached"
		// controller at a time (switching between them), which made only one
		// laser actually pick/grab at once — enable both simultaneously.
		pointerSelectionOptions: { enablePointerSelectionOnAllControllers: true },
		uiOptions: { customButtons: xrButtons }
	});
	const getActiveCamera = () => (xr.baseExperience.state === WebXRState.IN_XR ? xr.baseExperience.camera : desktopCamera);

	loadSettings();
	const grabSystem = new GrabSystem(scene, sceneGraph);
	sceneGraph.setGrabQuery(grabSystem);
	// Same "grip if present, else pointer" node pointerController.ts already
	// uses as each hand/controller's interaction point — reused here so a
	// pressable button reacts identically to hand-tracking and controllers.
	new PressableButtonSystem(scene, sceneGraph, () => xr.input.controllers.map((c) => c.grip ?? c.pointer));
	const locomotion = setupLocomotion(xr, floorMesh ? [floorMesh] : []);
	setupRotationController(scene, xr);
	setupMovementController(scene, xr);
	setupHandControllerSwitch(xr);
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

	async function hostCurrentWorld(visibility: HostedWorldVisibility): Promise<void> {
		if (!gameState.userId) throw new Error('Inicia sesión para alojar un mundo');
		const track = await ensureLocalAudio();

		const res = await fetch('/api/worlds', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'My Lobby', visibility, sceneSnapshot: sceneGraph.serialize() })
		});
		if (!res.ok) throw new Error('No se pudo alojar el mundo');
		const { world, session } = (await res.json()) as {
			world: { id: string; name: string; visibility: HostedWorldVisibility };
			session: { roomCode: string; startedAt: string }
		};

		gameState.worldId = world.id;
		gameState.worldName = world.name;
		gameState.worldVisibility = world.visibility;
		gameState.sessionStartedAt = session.startedAt;
		gameState.roomCode = session.roomCode;
		gameState.role = 'host';

		hostAuthority = new HostAuthority(
			scene,
			xr,
			sceneGraph,
			grabSystem,
			session.roomCode,
			iceServers,
			{ playerId: localPlayerId, displayName: gameState.userName ?? 'Host', role: 'host' } satisfies PlayerInfo,
			{
				localTrack: track,
				onRemoteStream: (_guestId, stream, targetNode) => voice.addPeer(_guestId, stream, targetNode)
			}
		);
	}

	async function stopHostingWorld(): Promise<void> {
		if (!gameState.worldId) return;
		const worldId = gameState.worldId;
		const res = await fetch(`/api/worlds/${worldId}/host`, { method: 'DELETE' });
		if (!res.ok) throw new Error('No se pudo cerrar la sesión');
		hostAuthority?.dispose();
		hostAuthority = null;
		gameState.worldId = null;
		gameState.worldName = null;
		gameState.roomCode = null;
		gameState.worldVisibility = null;
		gameState.sessionStartedAt = null;
		gameState.role = 'solo';
	}

	async function joinWorld(roomCode: string): Promise<void> {
		const track = await ensureLocalAudio();
		gameState.worldId = null;
		gameState.worldName = null;
		gameState.roomCode = roomCode;
		gameState.worldVisibility = null;
		gameState.sessionStartedAt = null;
		gameState.role = 'guest';

		guestSync = new GuestSync(
			scene,
			xr,
			sceneGraph,
			grabSystem,
			roomCode,
			iceServers,
			{ playerId: localPlayerId, displayName: gameState.userName ?? 'Guest', role: 'guest' } satisfies PlayerInfo,
			{
				localTrack: track,
				onRemoteStream: (stream, targetNode) => voice.addPeer('host', stream, targetNode)
			},
			() => {
				guestSync = null;
				gameState.worldId = null;
				gameState.worldName = null;
				gameState.roomCode = null;
				gameState.worldVisibility = null;
				gameState.sessionStartedAt = null;
				gameState.role = 'solo';
				refreshWorldsTab();
			}
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
		onLocomotionSettingsChanged: () => locomotion.applySettings(),
		onExitVr: () => xr.baseExperience.exitXRAsync(),
		onToggleInspector: () => inspector.root.setEnabled(!inspector.root.isEnabled())
	});
	refreshWorldsTab = dash.refreshWorldsTab;

	setupPointerAndGrabControllers(scene, xr, sceneGraph, grabSystem, {
		onGrab: (grabberId, slotId) => {
			if (gameState.role === 'host') hostAuthority?.broadcastSnapshot();
			else guestSync?.requestGrab(grabberId, slotId);
		},
		onRelease: (grabberId, slotId) => {
			if (gameState.role === 'host') hostAuthority?.broadcastSnapshot();
			else guestSync?.requestRelease(grabberId, slotId);
		}
	});
	setupPanelToggle(scene, xr, dash.root, getActiveCamera, { keyboardKey: 'm', buttonIdPattern: /x-button|menu/i });
	setupPanelToggle(scene, xr, inspector.root, getActiveCamera, { keyboardKey: 'i', buttonIdPattern: /a-button/i });
	const radialNetwork = {
		onDelete: (slotId: string) => {
			if (gameState.role === 'guest') guestSync?.requestDelete(slotId);
			else {
				sceneGraph.removeSlot(slotId);
				hostAuthority?.broadcastSnapshot();
			}
		}
	};
	setupRadialMenuForHand(scene, xr, sceneGraph, grabSystem, 'left', /y-button/i, radialNetwork);
	setupRadialMenuForHand(scene, xr, sceneGraph, grabSystem, 'right', /b-button/i, radialNetwork);

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
			sceneGraph.dispose();
			engine.dispose();
		}
	};
}
