import type { MediaControlAction, Slot, SlotTree, UIEvent } from '$lib/ecs/types';
import type { KeyboardPresence } from '../keyboard/presence';
import type { PlayerApiCall, PlayerApiResult } from '$lib/worldStorage/ops';
import type { HandPose, TransformPose } from '../avatar/defaultAvatar';

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
	/** `publicationId` is the published world the host runs, so a guest's own storage calls target it (the server re-checks it against the room). */
	| { kind: 'scene-snapshot'; revision: number; tree: SlotTree; players: PlayerInfo[]; equipped?: EquippedEntry[]; publicationId?: string | null }
	| { kind: 'transform-correction'; revision: number; transforms: SlotTransform[] }
	| { kind: 'player-hello'; player: PlayerInfo }
	/** A guest's chosen avatar. The host validates and rebuilds it; it is never applied as sent. */
	| { kind: 'avatar-set-request'; slots: SlotTree }
	| { kind: 'player-left'; playerId: string }
	| { kind: 'snapshot-ack'; revision: number }
	| { kind: 'resync-request'; haveRevision: number }
	| { kind: 'interaction-result'; requestId: string; accepted: boolean; slotId?: string }
	| { kind: 'grab-request'; requestId: string; slotId: string; grabberId: string }
	| { kind: 'release-request'; requestId: string; grabberId: string }
	/** Where the grabbing guest holds the object now (world space), when that is not just where their hand carries it: pushed or pulled along the laser. */
	| { kind: 'hold-move'; grabberId: string; slotId: string; position: [number, number, number]; rotation: [number, number, number, number] }
	| { kind: 'equip-request'; requestId: string; slotId: string; hand: 'left' | 'right' }
	| { kind: 'unequip-request'; requestId: string; hand: 'left' | 'right' }
	/** A trigger event for the object equipped in `hand`. The host validates it and runs the object's actions once. */
	| { kind: 'use-request'; slotId: string; hand: 'left' | 'right'; phase: 'press' | 'release' | 'value'; value: number }
	| { kind: 'spawn-request'; requestId: string; slot: Slot }
	| { kind: 'delete-request'; requestId: string; slotId: string }
	| { kind: 'media-control-request'; requestId: string; slotId: string; action: MediaControlAction }
	| { kind: 'ui-event-request'; requestId: string; event: UIEvent }
	/** Host to guest: run this storage/leaderboard call with the guest's own account. */
	| { kind: 'player-api-request'; requestId: string; publicationId: string; call: PlayerApiCall }
	| { kind: 'player-api-response'; requestId: string; result: PlayerApiResult };

/** High-frequency state messages sent on the unordered/unreliable channel. */
export type WorldStateMessage =
	| { kind: 'scene-state'; revision: number; transforms: SlotTransform[] }
	| {
		kind: 'presence';
		player: PlayerInfo;
		sequence: number;
		timestamp: number;
		head: TransformPose;
		hands: Partial<Record<'left' | 'right', HandPose>>;
		/** Where the player's in-world keyboard is while they type (never what is on it). See keyboard/presence.ts. */
		keyboard?: KeyboardPresence;
	};
