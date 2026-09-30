import { Vector3 } from '@babylonjs/core';
import { findComponent, type Vec3 } from '$lib/ecs/types';
import { eulerToQuat } from '$lib/math/euler';
import type { SceneGraph } from '../sceneGraph';
import type { GrabSystem } from './grabSystem';

/**
 * Sets `insertable` objects into `socket` slots when they are let go near one,
 * and takes them out again when they are grabbed. Only the host (or a solo
 * player) decides; guests see the result in the next snapshot, like every other
 * authoritative change. Knows nothing about what an inserted object does: the
 * socket's `playMedia` flag is the only built-in effect.
 */
export class SocketSystem {
	constructor(
		private sceneGraph: SceneGraph,
		private grabSystem: GrabSystem,
		private isHost: () => boolean
	) {
		grabSystem.setListener({
			onGrab: (slotId) => this.handleGrab(slotId),
			onRelease: (slotId) => this.handleRelease(slotId)
		});
	}

	/** The socket currently holding `slotId`, if any. */
	private socketHolding(slotId: string) {
		return this.sceneGraph.allSlots().find((entry) => {
			const socket = findComponent(entry.slot, 'socket');
			return socket?.occupantId === slotId && this.sceneGraph.getLive(slotId)?.slot.parentId === entry.slot.id;
		});
	}

	private handleGrab(slotId: string): void {
		if (!this.isHost()) return;
		const holder = this.socketHolding(slotId);
		if (!holder) return;
		const socket = findComponent(holder.slot, 'socket')!;
		this.sceneGraph.setComponentField(holder.slot.id, 'socket', 'occupantId', undefined);
		// The object now follows the hand; it must go back to the world, not to the socket, when let go.
		this.sceneGraph.setSlotParentData(slotId, null);
		this.grabSystem.overrideReleaseParent(slotId, null);
		if (socket.playMedia !== false) this.sceneGraph.controlMedia(slotId, 'pause');
	}

	private handleRelease(slotId: string): void {
		if (!this.isHost()) return;
		const live = this.sceneGraph.getLive(slotId);
		const insertable = live && findComponent(live.slot, 'insertable');
		if (!live || !insertable) return;

		live.node.computeWorldMatrix(true);
		const at = live.node.getAbsolutePosition();
		let best: { id: string; distance: number } | null = null;
		for (const entry of this.sceneGraph.allSlots()) {
			const socket = findComponent(entry.slot, 'socket');
			if (!socket || entry.slot.id === slotId) continue;
			if (socket.accepts.length > 0 && !socket.accepts.includes(insertable.tag)) continue;
			if (socket.occupantId && this.sceneGraph.getLive(socket.occupantId)?.slot.parentId === entry.slot.id) continue;
			entry.node.computeWorldMatrix(true);
			const target = Vector3.TransformCoordinates(Vector3.FromArray(socket.snap.position), entry.node.getWorldMatrix());
			const distance = Vector3.Distance(at, target);
			if (distance <= socket.radius && (!best || distance < best.distance)) best = { id: entry.slot.id, distance };
		}
		if (!best) return;

		const socketEntry = this.sceneGraph.getLive(best.id)!;
		const socket = findComponent(socketEntry.slot, 'socket')!;
		if (!this.sceneGraph.reparentSlot(slotId, best.id)) return;
		this.sceneGraph.placeSlotLocal(slotId, socket.snap.position as Vec3, eulerToQuat(socket.snap.rotation));
		this.sceneGraph.setComponentField(best.id, 'socket', 'occupantId', slotId);
		if (socket.playMedia !== false) this.sceneGraph.controlMedia(slotId, 'play');
	}
}
