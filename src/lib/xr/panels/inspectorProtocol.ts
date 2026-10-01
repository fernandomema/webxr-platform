import type { Quat, Slot, SlotTree, Vec3 } from '../../ecs/types';
import type { DocOp } from '../../studio/state/docOps';
import type { CodeBlockLogEntry } from '../codeBlockRuntime';

/**
 * The messages between the game (the host of the inspector, `ui/inspectorHost.ts`) and the inspector page it shows on a
 * panel (`/xr-panel/inspector`, inside an iframe). Both sides check that a message comes from the other one, and from
 * this origin, before acting on it.
 */

export const INSPECTOR_PANEL_PATH = '/xr-panel/inspector';

/** Every message carries this, so unrelated `postMessage` traffic (extensions, other frames) is ignored. */
export const INSPECTOR_CHANNEL = 'xr-inspector';

export interface InventoryFolderInfo {
	id: string;
	label: string;
}

export interface ViewPose {
	position: Vec3;
	rotation: Quat;
}

export type HostToFrame =
	/** The whole state, sent when the page is ready and whenever the panel is opened. */
	| { type: 'init'; tree: SlotTree; selectedId: string | null; readonly: boolean; inventoryFolders: InventoryFolderInfo[] }
	/** What changed since the last patch (content, not poses). `order` is every id, in hierarchy order. */
	| { type: 'patch'; upserts: Slot[]; removes: string[]; order: string[] }
	/** The pose of one slot, which changes while it is held. */
	| { type: 'transform'; id: string; position: Vec3; rotation: Quat; scale: Vec3 }
	| { type: 'select'; id: string | null }
	| { type: 'readonly'; readonly: boolean }
	/** The host finished (or refused) op number `seq`. */
	| { type: 'ack'; seq: number; ok: boolean }
	| { type: 'debugLog'; slotId: string; entries: CodeBlockLogEntry[] }
	| { type: 'viewPose'; requestId: number; pose: ViewPose | null }
	| { type: 'notice'; level: 'info' | 'error'; message: string };

export type FrameToHost =
	| { type: 'ready' }
	/** An edit. `seq` is counted by the page, and answered with an `ack`. */
	| { type: 'op'; seq: number; op: DocOp }
	| { type: 'select'; id: string | null }
	| { type: 'action'; action: 'saveToInventory'; slotId: string; adapterId: string }
	| { type: 'action'; action: 'createContainer' }
	| { type: 'action'; action: 'generateReflectionProbe'; slotId: string }
	| { type: 'requestViewPose'; requestId: number }
	| { type: 'close' };

export type InspectorMessage<T> = T & { channel: typeof INSPECTOR_CHANNEL };

export function envelope<T extends HostToFrame | FrameToHost>(message: T): InspectorMessage<T> {
	return { ...message, channel: INSPECTOR_CHANNEL };
}

/** The payload of a `message` event if it is one of ours, otherwise null. */
export function openEnvelope<T extends HostToFrame | FrameToHost>(data: unknown): T | null {
	if (!data || typeof data !== 'object' || (data as { channel?: unknown }).channel !== INSPECTOR_CHANNEL) return null;
	return data as T;
}
