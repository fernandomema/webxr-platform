import type { Slot, SlotTree } from '$lib/ecs/types';
import type { TransformPose } from '../avatar/defaultAvatar';

/** Messages carried over each PeerLink's `world-sync` DataChannel. */
export type WorldSyncMessage =
	| { kind: 'scene-snapshot'; tree: SlotTree }
	| { kind: 'grab-request'; slotId: string; grabberId: string }
	| { kind: 'release-request'; grabberId: string }
	| { kind: 'spawn-request'; slot: Slot }
	| { kind: 'presence'; head: TransformPose; hands: Partial<Record<'left' | 'right', TransformPose>> };
