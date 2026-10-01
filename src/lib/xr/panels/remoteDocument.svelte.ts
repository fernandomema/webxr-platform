import type { Component, Slot, SlotTree, Vec3 } from '../../ecs/types';
import { newNonce, reduceDocOp, type DocOp, type InspectorDocument } from '../../studio/state/docOps';
import type { ComponentType } from '../../studio/schema/components';
import { getSlot, rootSlots } from '../../studio/tree/ops';
import type { CodeBlockLogEntry } from '../codeBlockRuntime';
import { envelope, openEnvelope, type FrameToHost, type HostToFrame, type InventoryFolderInfo, type ViewPose } from './inspectorProtocol';

/** How long an edit may stay unanswered before the page stops protecting it from the host's view of the slot. */
const PENDING_TIMEOUT_MS = 2000;
const VIEW_POSE_TIMEOUT_MS = 1000;

/**
 * The inspector's document inside the XR panel. The tree is a copy of the game's world. Edits are applied to the copy at
 * once (so typing and dragging feel instant) and sent to the game as ops, which it applies to the live scene; the game
 * sends back what changed, and while an edit of a slot is still unanswered the slot is not overwritten by older news.
 */
export class RemoteDocument implements InspectorDocument {
	tree = $state.raw<SlotTree>([]);
	selectedId = $state<string | null>(null);
	readonly kind = 'world' as const;
	readonly = $state(true);
	ready = $state(false);
	inventoryFolders = $state<InventoryFolderInfo[]>([]);
	debugLog = $state.raw<{ slotId: string; entries: CodeBlockLogEntry[] } | null>(null);
	notice = $state<{ level: 'info' | 'error'; message: string } | null>(null);

	readonly selected = $derived<Slot | undefined>(getSlot(this.tree, this.selectedId));

	private seq = 0;
	/** Ops sent and not yet answered, by the slot they touch. */
	private pending = new Map<string, number>();
	private opSlots = new Map<number, { slotId: string | null; timer: ReturnType<typeof setTimeout> }>();
	private poseRequests = new Map<number, (pose: ViewPose | null) => void>();
	private requestId = 0;
	private listener = (event: MessageEvent) => this.receive(event);

	constructor(private parentWindow: Window = window.parent) {}

	connect(): void {
		window.addEventListener('message', this.listener);
		this.post({ type: 'ready' });
	}

	disconnect(): void {
		window.removeEventListener('message', this.listener);
		for (const { timer } of this.opSlots.values()) clearTimeout(timer);
	}

	private post(message: FrameToHost): void {
		this.parentWindow.postMessage(envelope(message), window.location.origin);
	}

	private receive(event: MessageEvent): void {
		if (event.source !== this.parentWindow || event.origin !== window.location.origin) return;
		const message = openEnvelope<HostToFrame>(event.data);
		if (!message) return;
		switch (message.type) {
			case 'init':
				this.tree = message.tree;
				this.selectedId = getSlot(message.tree, message.selectedId)?.id ?? rootSlots(message.tree)[0]?.id ?? null;
				this.readonly = message.readonly;
				this.inventoryFolders = message.inventoryFolders;
				this.pending.clear();
				this.ready = true;
				break;
			case 'patch':
				this.applyPatch(message.upserts, message.removes, message.order);
				break;
			case 'transform':
				if (!this.pending.has(message.id)) this.replace(message.id, (slot) => ({ ...slot, position: message.position, rotation: message.rotation, scale: message.scale }));
				break;
			case 'select':
				if (getSlot(this.tree, message.id)) this.selectedId = message.id;
				break;
			case 'readonly':
				this.readonly = message.readonly;
				break;
			case 'ack':
				this.settle(message.seq);
				break;
			case 'debugLog':
				this.debugLog = { slotId: message.slotId, entries: message.entries };
				break;
			case 'viewPose':
				this.poseRequests.get(message.requestId)?.(message.pose);
				this.poseRequests.delete(message.requestId);
				break;
			case 'notice':
				this.notice = { level: message.level, message: message.message };
				break;
		}
	}

	private replace(id: string, change: (slot: Slot) => Slot): void {
		this.tree = this.tree.map((slot) => (slot.id === id ? change(slot) : slot));
	}

	private applyPatch(upserts: Slot[], removes: string[], order: string[]): void {
		const removed = new Set(removes);
		const incoming = new Map(upserts.map((slot) => [slot.id, slot]));
		const byId = new Map<string, Slot>();
		for (const slot of this.tree) if (!removed.has(slot.id)) byId.set(slot.id, slot);
		// A slot with an edit still in flight keeps the page's own version: the host's news is older than it.
		for (const [id, slot] of incoming) if (!this.pending.has(id)) byId.set(id, slot);
		const next: Slot[] = [];
		for (const id of order) {
			const slot = byId.get(id);
			if (slot) next.push(slot);
			byId.delete(id);
		}
		for (const slot of byId.values()) next.push(slot); // known here but not in the host's order: a slot added here a moment ago
		this.tree = next;
		if (this.selectedId && !getSlot(this.tree, this.selectedId)) this.selectedId = rootSlots(this.tree)[0]?.id ?? null;
	}

	private settle(seq: number): void {
		const entry = this.opSlots.get(seq);
		if (!entry) return;
		clearTimeout(entry.timer);
		this.opSlots.delete(seq);
		if (!entry.slotId) return;
		const left = (this.pending.get(entry.slotId) ?? 1) - 1;
		if (left <= 0) this.pending.delete(entry.slotId);
		else this.pending.set(entry.slotId, left);
	}

	/** Applies `op` here and sends it to the game. Returns the result (for `selectId`), or null if it is refused. */
	private dispatch(op: DocOp, slotId: string | null): ReturnType<typeof reduceDocOp> {
		if (this.readonly) return null;
		const result = reduceDocOp(this.tree, op);
		if (!result) return null;
		this.tree = result.tree;
		const seq = ++this.seq;
		if (slotId) this.pending.set(slotId, (this.pending.get(slotId) ?? 0) + 1);
		this.opSlots.set(seq, { slotId, timer: setTimeout(() => this.settle(seq), PENDING_TIMEOUT_MS) });
		this.post({ type: 'op', seq, op });
		return result;
	}

	generateReflectionProbe(slotId: string): void {
		if (!this.readonly) this.post({ type: 'action', action: 'generateReflectionProbe', slotId });
	}

	select(id: string | null): void {
		this.selectedId = id && getSlot(this.tree, id) ? id : null;
		this.post({ type: 'select', id: this.selectedId });
	}

	renameSlot(id: string, name: string): void {
		this.dispatch({ op: 'rename', id, name }, id);
	}
	setPosition(id: string, position: Vec3): void {
		this.dispatch({ op: 'setPosition', id, position }, id);
	}
	setScale(id: string, scale: Vec3): void {
		this.dispatch({ op: 'setScale', id, scale }, id);
	}
	setRotationEuler(id: string, degrees: Vec3): void {
		this.dispatch({ op: 'setRotationEuler', id, degrees }, id);
	}
	addComponent(id: string, type: ComponentType): void {
		const result = this.dispatch({ op: 'addComponent', id, type, nonce: newNonce() }, id);
		if (result?.selectId) this.select(result.selectId);
	}
	addRawComponent(id: string, component: Component): void {
		this.dispatch({ op: 'addRawComponent', id, component }, id);
	}
	removeComponent(id: string, index: number): void {
		this.dispatch({ op: 'removeComponent', id, index }, id);
	}
	setField(id: string, index: number, key: string, value: unknown): void {
		this.dispatch({ op: 'setField', id, index, key, value }, id);
	}

	addSlot(partial: Partial<Slot> & { name: string }, parentId: string | null = this.selectedId): string {
		const id = partial.id ?? newNonce();
		const result = this.dispatch({ op: 'addSlot', parentId, slot: { ...partial, id } }, id);
		if (result) this.select(id);
		return id;
	}

	removeSelected(): boolean {
		const id = this.selectedId;
		if (!id) return false;
		const result = this.dispatch({ op: 'removeSlot', id }, null);
		if (!result) return false;
		this.select(result.selectId ?? null);
		return true;
	}

	duplicateSelected(): void {
		if (!this.selectedId) return;
		const result = this.dispatch({ op: 'duplicate', id: this.selectedId, nonce: newNonce() }, null);
		if (result?.selectId) this.select(result.selectId);
	}

	reparent(id: string, newParentId: string | null): boolean {
		return this.dispatch({ op: 'reparent', id, parentId: newParentId }, id) !== null;
	}

	// --- what only the game can do ---------------------------------------------------------------------------------

	saveToInventory(slotId: string, adapterId: string): void {
		this.post({ type: 'action', action: 'saveToInventory', slotId, adapterId });
	}

	createContainer(): void {
		if (!this.readonly) this.post({ type: 'action', action: 'createContainer' });
	}

	close(): void {
		this.post({ type: 'close' });
	}

	/** The game camera's pose, for "Use editor view". */
	viewPose(): Promise<ViewPose | null> {
		const requestId = ++this.requestId;
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.poseRequests.delete(requestId);
				resolve(null);
			}, VIEW_POSE_TIMEOUT_MS);
			this.poseRequests.set(requestId, (pose) => {
				clearTimeout(timer);
				resolve(pose);
			});
			this.post({ type: 'requestViewPose', requestId });
		});
	}
}

