import type { MediaControlAction, Slot, SlotTree, UIEvent } from '$lib/ecs/types';
import type { TransformPose } from '../avatar/defaultAvatar';

export type SlotTransform = Pick<Slot, 'id' | 'position' | 'rotation' | 'scale'>;

/** Which object a player has equipped in which hand — session state, never part of the serialized scene. */
export type EquippedEntry = { slotId: string; playerId: string; hand: 'left' | 'right' };

export type PlayerInfo = {
	playerId: string;
	displayName: string;
	role: 'host' | 'guest';
};

/** Messages carried over the reliable world-sync DataChannel. */
export type WorldSyncMessage =
	| { kind: 'scene-snapshot'; revision: number; tree: SlotTree; players: PlayerInfo[]; equipped?: EquippedEntry[] }
	| { kind: 'transform-correction'; revision: number; transforms: SlotTransform[] }
	| { kind: 'player-hello'; player: PlayerInfo }
	| { kind: 'player-left'; playerId: string }
	| { kind: 'snapshot-ack'; revision: number }
	| { kind: 'resync-request'; haveRevision: number }
	| { kind: 'interaction-result'; requestId: string; accepted: boolean; slotId?: string }
	| { kind: 'grab-request'; requestId: string; slotId: string; grabberId: string }
	| { kind: 'release-request'; requestId: string; grabberId: string }
	| { kind: 'equip-request'; requestId: string; slotId: string; hand: 'left' | 'right' }
	| { kind: 'unequip-request'; requestId: string; hand: 'left' | 'right' }
	/** A trigger event for the object equipped in `hand`. The host validates it and runs the object's actions once. */
	| { kind: 'use-request'; slotId: string; hand: 'left' | 'right'; phase: 'press' | 'release' | 'value'; value: number }
	| { kind: 'spawn-request'; requestId: string; slot: Slot }
	| { kind: 'delete-request'; requestId: string; slotId: string }
	| { kind: 'media-control-request'; requestId: string; slotId: string; action: MediaControlAction }
	| { kind: 'ui-event-request'; requestId: string; event: UIEvent };

/** High-frequency state messages sent on the unordered/unreliable channel. */
export type WorldStateMessage =
	| { kind: 'scene-state'; revision: number; transforms: SlotTransform[] }
	| {
		kind: 'presence';
		player: PlayerInfo;
		sequence: number;
		timestamp: number;
		head: TransformPose;
		hands: Partial<Record<'left' | 'right', TransformPose>>;
	};
