import type { Slot } from '../ecs/types.ts';

/** A tab a script adds to the personal menu. Its page is a UI panel written as slots, like the panels of a world. */
export interface ScriptDashTab {
	/** Names the tab for this script (the menu keeps it apart from the game's own tabs). Adding again with the same id replaces the tab. */
	id: string;
	label: string;
	/** The name of an icon of the game ('house', 'users', 'globe', 'backpack', 'settings', 'user'…). Without one, or with an unknown one, only the label shows. */
	icon?: string;
	/** Where it sits on the bar: lower comes first. The game's own tabs are 0 to 50. */
	order?: number;
	/** The page: the panel first (a slot with `uiPanel`), then its `uiElement` slots, tied together with `parentId` as in a world. The slots may carry code blocks that answer to the controls. */
	ui: Array<Partial<Slot> & { name: string }>;
}

/** What a script running in the player's own menu may ask of it. Absent for scripts of a world: only the menu's own can change the menu. */
export interface ScriptDash {
	/** Adds a tab. Returns the ids the slots of `ui` got (the ones given as keys), to change them later with `world.setComponentField`; null when refused. */
	addTab(ownerSlotId: string, tab: ScriptDashTab): { slots: Record<string, string> } | null;
	/** Takes a tab this script added away. Returns whether there was one. */
	removeTab(ownerSlotId: string, id: string): boolean;
	/** Opens a tab by the id the script gave it. */
	showTab(ownerSlotId: string, id: string): boolean;
	/** A name for this piece of UI that stays the same every time it is started, to key what it keeps (the contents of a grid on one of its tabs). Null when there is none. */
	instanceId(ownerSlotId: string): string | null;
	/** One of the few settings a script may read and change (`masterVolume`, 0 to 1). Null for any other. */
	getSetting(key: string): number | null;
	setSetting(key: string, value: number): boolean;
}

export interface ScriptSystemStats {
	fps: number;
	/** How long a frame takes, in milliseconds. */
	frameMs: number;
	drawCalls: number;
	/** Meshes drawn this frame. */
	meshes: number;
	/** Thousands of triangles drawn this frame. */
	kilotriangles: number;
}

export interface ScriptSessionInfo {
	role: 'solo' | 'host' | 'guest';
	roomCode: string | null;
	worldName: string | null;
}

/** Readings of the game itself, for the scripts of the player's menu. */
export interface ScriptSystem {
	stats(): ScriptSystemStats;
	session(): ScriptSessionInfo;
}
