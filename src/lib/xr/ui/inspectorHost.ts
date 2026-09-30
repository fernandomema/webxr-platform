import { Quaternion, Vector3, type AbstractMesh, type Scene, type TransformNode } from '@babylonjs/core';
import { createSlot, findComponent, type Slot, type SlotTree } from '$lib/ecs/types';
import { extractSubtree } from '$lib/ecs/serialize';
import { availableInventoryFolders } from '$lib/inventory/registry';
import { reduceDocOp, type DocOp } from '$lib/studio/state/docOps';
import type { SceneGraph } from '../sceneGraph';
import { getInventoryContext, gameState } from '../gameState';
import { forInventory } from '../avatar/build';
import { saveWithPreview } from '../inventorySave';
import { envelope, openEnvelope, INSPECTOR_PANEL_PATH, type FrameToHost, type HostToFrame, type ViewPose } from '../panels/inspectorProtocol';

const PANEL_ID = 'inspector-panel';
const PANEL_WIDTH = 1280;
const PANEL_HEIGHT = 860;
/** The plane is 1 × 1 before scaling; this keeps the page's aspect ratio at a comfortable size (metres). */
const PANEL_SCALE: [number, number] = [1.3, (1.3 * PANEL_HEIGHT) / PANEL_WIDTH];
/** Edits are applied to the live scene at once; telling the other players waits for typing or dragging to settle. */
const BROADCAST_DELAY_MS = 150;
/** Tree changes are batched before being sent to the panel. */
const PATCH_DELAY_MS = 100;
/** A snapshot from the host (a guest's world) may have changed anything: checking everything waits longer. */
const FULL_PATCH_DELAY_MS = 1000;
/** How often the selected slot's pose and debug log are checked while the panel is open. */
const POLL_INTERVAL_MS = 200;

export interface InspectorCallbacks {
	/** The world changed in a way other players must see: the caller broadcasts a snapshot (host only). */
	onSceneChanged?(): void;
	/** Where the player's camera is, for placing things in front of them and for "Use editor view". */
	getViewPose?(): ViewPose | null;
}

/** What makes a slot's content differ, leaving out its pose (sent separately) and script state (written by scripts all the time). */
function contentSignature(slot: Slot): string {
	return JSON.stringify([slot.name, slot.parentId, slot.components.filter((component) => component.type !== 'scriptState')]);
}

/**
 * The in-game inspector: a panel showing the app's own inspector page (`/xr-panel/inspector`, the Studio's hierarchy and
 * inspector components) through an `htmlView`. This file is the game's half of the conversation with that page: it sends
 * it the world as a tree and keeps it up to date, applies the edits it sends back to the live scene, and does what only
 * the game can (save to the inventory, read the camera, read a script's log).
 *
 * The page is only loaded the first time the panel is opened.
 */
export function createInspectorHost(scene: Scene, sceneGraph: SceneGraph, callbacks: InspectorCallbacks = {}): { root: TransformNode; select(slotId: string): boolean } {
	const slot = createSlot({
		id: PANEL_ID,
		name: 'Inspector',
		position: [0.9, 1.4, -1],
		components: [
			{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' } },
			{ type: 'grabbable', scalable: true },
			{ type: 'htmlView', url: '', width: PANEL_WIDTH, height: PANEL_HEIGHT, interaction: 'raycast', pixelRatio: 1.5 }
		]
	});
	const node = sceneGraph.addSlot(slot, { system: true });
	const mesh = node as AbstractMesh;
	mesh.scaling.set(PANEL_SCALE[0], PANEL_SCALE[1], 1);
	mesh.metadata = { ...(mesh.metadata ?? {}), interactive: true };
	mesh.setEnabled(false);

	let loaded = false;
	let ready = false;
	let enabled = false;
	let selectedId: string | null = null;
	let sent = new Map<string, string>();
	let lastOrder = '';
	let lastPose = '';
	let lastLog = '';
	let lastReadonly: boolean | null = null;
	let patchTimer: ReturnType<typeof setTimeout> | null = null;
	let patchDue = 0;
	/** Slots to look at in the next patch; null means all of them. */
	let dirtyIds: Set<string> | null = new Set();
	let broadcastTimer: ReturnType<typeof setTimeout> | null = null;
	let sincePoll = 0;

	const canEdit = () => gameState.role !== 'guest';
	const frame = () => sceneGraph.getHtmlViewFrame(PANEL_ID);

	function post(message: HostToFrame): void {
		frame()?.contentWindow?.postMessage(envelope(message), window.location.origin);
	}

	/** The page is loaded by the first opening: the world starts without it. */
	function ensureLoaded(): void {
		if (loaded) return;
		loaded = true;
		const view = findComponent(slot, 'htmlView');
		if (!view) return;
		view.url = INSPECTOR_PANEL_PATH;
		sceneGraph.getLive(PANEL_ID)?.runtime?.sync?.(slot);
	}

	const worldTree = (): SlotTree => sceneGraph.serialize({ withoutAvatars: true });

	function sendInit(): void {
		const tree = worldTree();
		sent = new Map(tree.map((entry) => [entry.id, contentSignature(entry)]));
		lastOrder = tree.map((entry) => entry.id).join('|');
		if (!selectedId || !tree.some((entry) => entry.id === selectedId)) selectedId = tree.find((entry) => entry.parentId === null)?.id ?? tree[0]?.id ?? null;
		lastReadonly = !canEdit();
		lastPose = lastLog = '';
		dirtyIds = new Set();
		post({
			type: 'init',
			tree,
			selectedId,
			readonly: lastReadonly,
			// Only folders that can take a new item (the purchased objects, for one, are read only).
			inventoryFolders: availableInventoryFolders(getInventoryContext())
				.filter((adapter) => adapter.saveItem)
				.map(({ id, label }) => ({ id, label }))
		});
	}

	/**
	 * Tells the page what changed. Only the slots the scene graph named are looked at (a world with scripts changes a
	 * few slots all the time; reading all of them every time is what would cost). Poses are left out: they are sent for
	 * the selected slot only, by `poll`.
	 */
	function sendPatch(): void {
		patchTimer = null;
		if (!enabled || !ready) return;
		const ids = sceneGraph.slotIds({ withoutAvatars: true });
		const present = new Set(ids);
		const candidates = dirtyIds ?? present;
		dirtyIds = new Set();
		const upserts: Slot[] = [];
		const removes: string[] = [];
		for (const id of candidates) {
			const current = present.has(id) ? sceneGraph.serializeSlot(id) : null;
			if (!current) {
				if (sent.delete(id)) removes.push(id);
				continue;
			}
			const signature = contentSignature(current);
			if (sent.get(id) !== signature) {
				sent.set(id, signature);
				upserts.push(current);
			}
		}
		if (candidates === present) for (const id of [...sent.keys()]) if (!present.has(id) && sent.delete(id)) removes.push(id);
		const orderKey = ids.join('|');
		if (!upserts.length && !removes.length && orderKey === lastOrder) return;
		lastOrder = orderKey;
		post({ type: 'patch', upserts, removes, order: ids });
	}

	function schedulePatch(ids: readonly string[] | null): void {
		if (!enabled || !ready) return;
		if (ids === null) dirtyIds = null;
		else if (dirtyIds) for (const id of ids) dirtyIds.add(id);
		const due = performance.now() + (ids === null ? FULL_PATCH_DELAY_MS : PATCH_DELAY_MS);
		if (patchTimer && patchDue <= due) return;
		if (patchTimer) clearTimeout(patchTimer);
		patchDue = due;
		patchTimer = setTimeout(sendPatch, due - performance.now());
	}

	function scheduleBroadcast(): void {
		if (broadcastTimer) clearTimeout(broadcastTimer);
		broadcastTimer = setTimeout(() => {
			broadcastTimer = null;
			callbacks.onSceneChanged?.();
		}, BROADCAST_DELAY_MS);
	}

	sceneGraph.onChanged(schedulePatch);

	// --- edits ------------------------------------------------------------------------------------------------------

	/** Turns an op into changes to the live scene: what was removed, added, reparented or edited. False when refused. */
	function applyOp(op: DocOp): boolean {
		if (!canEdit()) return false;
		const before = worldTree();
		const result = reduceDocOp(before, op);
		if (!result) return false;
		const beforeById = new Map(before.map((entry) => [entry.id, entry]));
		const nextIds = new Set(result.tree.map((entry) => entry.id));
		for (const entry of before) if (!nextIds.has(entry.id) && sceneGraph.getLive(entry.id)) sceneGraph.removeSlot(entry.id);
		for (const entry of result.tree) {
			const old = beforeById.get(entry.id);
			if (!old) sceneGraph.addSlot(entry);
			else if (old === entry) continue; // the ops leave untouched slots as the very same objects
			// Moving under another slot keeps where the object is, in the world, not its numbers: the pose is not taken from the op.
			else if (op.op === 'reparent' && op.id === entry.id) sceneGraph.reparentSlot(entry.id, entry.parentId);
			else sceneGraph.applySlotEdit(entry.id, entry);
		}
		return true;
	}

	function handleOp(seq: number, op: DocOp): void {
		let ok = false;
		try {
			ok = applyOp(op);
		} catch (err) {
			console.warn('[inspector] could not apply', op, err);
		}
		post({ type: 'ack', seq, ok });
		if (ok) {
			scheduleBroadcast();
			if (op.op === 'reparent') lastPose = ''; // the object kept its place in the world, so its numbers changed
		} else {
			sendInit(); // the page's copy was wrong: start it over
		}
	}

	function placeInFront(distance: number): Vector3 | null {
		const pose = callbacks.getViewPose?.();
		if (!pose) return null;
		const forward = Vector3.Forward().applyRotationQuaternion(Quaternion.FromArray(pose.rotation));
		return Vector3.FromArray(pose.position).add(forward.scale(distance));
	}

	function createContainer(): void {
		if (!canEdit()) return;
		const spot = placeInFront(1);
		const container = createSlot({
			name: 'Container',
			position: spot ? (spot.asArray() as Slot['position']) : [0, 1.2, -1.2],
			components: [{ type: 'container' }, { type: 'grabbable', scalable: true }]
		});
		sceneGraph.addSlot(container);
		if (patchTimer) clearTimeout(patchTimer);
		dirtyIds?.add(container.id);
		sendPatch(); // the page must know the slot before it is told to select it
		selectedId = container.id;
		post({ type: 'select', id: container.id });
		scheduleBroadcast();
	}

	async function saveToInventory(slotId: string, adapterId: string): Promise<void> {
		try {
			const subtree = extractSubtree(sceneGraph.serialize(), slotId);
			if (subtree.length === 0) return;
			const adapter = availableInventoryFolders(getInventoryContext()).find((entry) => entry.id === adapterId);
			if (!adapter?.saveItem) return;
			// Only reuse the Dash's current folder if it belongs to THIS adapter; otherwise save to that adapter's root.
			const folderId = gameState.currentInventoryAdapterId === adapterId ? gameState.currentInventoryFolderId : null;
			const { tree, kind } = forInventory(subtree);
			await saveWithPreview(adapter, getInventoryContext(), folderId, subtree[0].name, tree, kind);
			post({ type: 'notice', level: 'info', message: `Saved “${subtree[0].name}” to ${adapter.label}` });
		} catch (err) {
			console.warn('[inspector] save failed', err);
			post({ type: 'notice', level: 'error', message: err instanceof Error ? err.message : 'Could not save' });
		}
	}

	// --- the conversation --------------------------------------------------------------------------------------------

	function sendSelectionState(): void {
		lastPose = lastLog = '';
		poll(true);
	}

	function onMessage(event: MessageEvent): void {
		const target = frame();
		if (!target || event.source !== target.contentWindow || event.origin !== window.location.origin) return;
		const message = openEnvelope<FrameToHost>(event.data);
		if (!message) return;
		switch (message.type) {
			case 'ready':
				ready = true;
				if (enabled) sendInit();
				break;
			case 'op':
				handleOp(message.seq, message.op);
				break;
			case 'select':
				selectedId = message.id;
				sendSelectionState();
				break;
			case 'action':
				if (message.action === 'createContainer') createContainer();
				else void saveToInventory(message.slotId, message.adapterId);
				break;
			case 'requestViewPose':
				post({ type: 'viewPose', requestId: message.requestId, pose: callbacks.getViewPose?.() ?? null });
				break;
			case 'close':
				mesh.setEnabled(false);
				break;
		}
	}
	window.addEventListener('message', onMessage);

	/** What changes without the scene graph announcing it: the selected slot's pose while it is held, its script's log, the role. */
	function poll(force = false): void {
		if (!enabled || !ready) return;
		const readonly = !canEdit();
		if (readonly !== lastReadonly) {
			lastReadonly = readonly;
			post({ type: 'readonly', readonly });
		}
		if (!selectedId) return;
		const current = sceneGraph.serializeSlot(selectedId);
		if (!current) return;
		const pose = JSON.stringify([current.position, current.rotation, current.scale]);
		if (force || pose !== lastPose) {
			lastPose = pose;
			post({ type: 'transform', id: current.id, position: current.position, rotation: current.rotation, scale: current.scale });
		}
		if (findComponent(current, 'codeBlock')) {
			const entries = sceneGraph.getCodeBlockDebugLog(current.id);
			const signature = entries.map((entry) => `${entry.timestamp}:${entry.level}`).join('|');
			if (force || signature !== lastLog) {
				lastLog = signature;
				post({ type: 'debugLog', slotId: current.id, entries });
			}
		}
	}

	scene.onBeforeRenderObservable.add(() => {
		const open = mesh.isEnabled();
		if (open !== enabled) {
			enabled = open;
			if (open) {
				ensureLoaded();
				if (ready) sendInit();
				sincePoll = 0;
			}
		}
		if (!enabled) return;
		sincePoll += scene.getEngine().getDeltaTime();
		if (sincePoll < POLL_INTERVAL_MS) return;
		sincePoll = 0;
		poll();
	});

	return {
		root: node,
		select(slotId) {
			if (!mesh.isEnabled() || !worldTree().some((entry) => entry.id === slotId)) return false;
			selectedId = slotId;
			ensureLoaded();
			if (ready) {
				post({ type: 'select', id: slotId });
				sendSelectionState();
			}
			return true;
		}
	};
}
