import type { Slot, SlotTree } from '$lib/ecs/types';
import type { TransformPose } from '../avatar/defaultAvatar';

export type PlayerInfo = {
	playerId: string;
	displayName: string;
	role: 'host' | 'guest';
};

/** Messages carried over the reliable world-sync DataChannel. */
export type WorldSyncMessage =
	| { kind: 'scene-snapshot'; revision: number; tree: SlotTree; players: PlayerInfo[] }
	| { kind: 'player-hello'; player: PlayerInfo }
	| { kind: 'player-left'; playerId: string }
	| { kind: 'snapshot-ack'; revision: number }
	| { kind: 'resync-request'; haveRevision: number }
	| { kind: 'interaction-result'; requestId: string; accepted: boolean; slotId?: string }
	| { kind: 'grab-request'; requestId: string; slotId: string; grabberId: string }
	| { kind: 'release-request'; requestId: string; grabberId: string }
	| { kind: 'spawn-request'; requestId: string; slot: Slot }
	| { kind: 'delete-request'; requestId: string; slotId: string };

/** High-frequency state messages sent on the unordered/unreliable channel. */
export type WorldStateMessage =
	| { kind: 'scene-state'; revision: number; tree: SlotTree }
	| {
		kind: 'presence';
		player: PlayerInfo;
		sequence: number;
		timestamp: number;
		head: TransformPose;
		hands: Partial<Record<'left' | 'right', TransformPose>>;
	};
