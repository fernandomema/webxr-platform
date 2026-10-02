/**
 * Slot/Component data model, patterned after Neos/Resonite's scene graph:
 * every entity is a "Slot" (transform node) carrying zero or more
 * "Components" that add behaviour/data. This is the single serialization
 * format shared by world templates, the inventory (all three backends) and
 * the host->guest scene snapshot sent over the DataChannel.
 */

import type { MeshRef, SourceRef } from '../assets/ref';
import type { HumanoidMap } from '../xr/avatar/humanoid';

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface MeshRendererComponent {
	type: 'meshRenderer';
	/** A built-in primitive, or a model addressed by the SHA-256 of its bytes (see $lib/assets/ref). */
	meshRef: MeshRef;
	color?: string;
}

export interface ColliderComponent {
	type: 'collider';
	shape: 'box' | 'sphere' | 'mesh';
}

export interface GrabbableComponent {
	type: 'grabbable';
	/** Whether a two-point grab (two hands / two lasers / one of each) is allowed to scale this slot. */
	scalable: boolean;
	/** The fingers of an avatar grabbing it close round its shape. On unless set to `false`. */
	autoGrip?: boolean;
}

/** Where an equipped object sits relative to the controller grip, in the grip's local space. */
export interface EquipPose {
	position: Vec3;
	/** Euler angles in degrees (pitch, yaw, roll — Babylon's yaw-pitch-roll order). The object's own scale is never changed by equipping. */
	rotation: Vec3;
}

/**
 * Lets a `grabbable` object be equipped in a hand from the radial menu. While
 * equipped it stays in that hand after the grip is released, and its (and its
 * children's) codeBlocks receive the hand's trigger through `onTrigger`.
 * Which hand holds it is session state; the serialized `parentId` never changes.
 */
export interface EquippableComponent {
	type: 'equippable';
	left: EquipPose;
	right: EquipPose;
	/** The fingers of an avatar holding it close around its shape, instead of taking a fixed grip. */
	autoGrip?: boolean;
}

export interface AudioSourceComponent {
	type: 'audioSource';
}

export interface ContainerComponent {
	type: 'container';
}

export interface WorldPortalComponent {
	type: 'worldPortal';
	/** A portable snapshot plus provenance. Other peers never read its owner's inventory. */
	world: import('$lib/worlds/types').WorldPackage;
}

export interface MirrorComponent {
	type: 'mirror';
	resolution?: number;
}

/**
 * A camera whose screen is this slot's mesh: what lies in front of the screen (along its local +Z) is shown on it live.
 * Held in a hand, the trigger takes a photo or starts and stops a video, saved on the holder's device.
 */
export interface CameraComponent {
	type: 'camera';
	/** Pixels on the long side of the preview (and of a video and a photo). */
	resolution?: number;
}

export interface AudioPlayerComponent {
	type: 'audioPlayer';
	/** A direct browser-loadable audio URL, or an audio asset (local, cloud or shared). */
	source: SourceRef;
	/** Legacy form of `source`; read by `normalizeSourceRef`, never written. */
	url?: string;
	autoplay?: boolean;
	loop?: boolean;
	volume?: number;
	playing?: boolean;
	currentTime?: number;
}

/**
 * A live web page (a sandboxed iframe) drawn onto this slot's mesh through the
 * WICG HTML-in-Canvas API, via Babylon's `HtmlTexture`. The browser must expose
 * that API (Chrome: chrome://flags/#canvas-draw-element); without it the mesh
 * shows a short notice instead. Put it on a slot with a plane `meshRenderer`.
 */
export interface HtmlViewComponent {
	type: 'htmlView';
	/** https (or same-origin) URL loaded in the iframe. Empty shows a blank page. */
	url: string;
	/** Size of the page in CSS pixels; fixed when the view is created. */
	width?: number;
	height?: number;
	/**
	 * How pointer input reaches the page. `raycast` forwards the laser/mouse hit (as UV) as DOM pointer and click
	 * events into a same-origin page (a cross-origin page cannot be reached);
	 * `overlay` puts the real element under the cursor so the browser hit-tests it natively (flat, camera-facing
	 * surfaces only); `none` is display only. Fixed when the view is created.
	 */
	interaction?: 'none' | 'raycast' | 'overlay';
	/** Sharpness of the picture drawn when the page has to be rasterized (1–3; 1.5 reads text well). Fixed when the view is created. */
	pixelRatio?: number;
}

export type MediaControlAction = 'toggle' | 'play' | 'pause';

export interface CodeBlockComponent {
	type: 'codeBlock';
	/**
	 * The body of a function receiving a bounded `ctx` API object and
	 * returning an optional handlers object: `{ onSpawn?, onGrab?, onRelease?,
	 * onEquip?, onUnequip?, onTrigger?, tick?, getRadialItems? }`. Compiled once per live instantiation via
	 * `new Function('ctx', code)` — NOT a real sandbox (see sceneGraph.ts):
	 * this data travels over the network like any other Slot field, so it
	 * runs inside the page of anyone who joins a world using it.
	 */
	code: string;
}

export interface ExpiresComponent {
	type: 'expires';
	/** Absolute epoch ms — every peer independently removes the slot once past this, see SceneGraph.tick(). */
	expiresAt: number;
}

export interface ParticleBurstComponent {
	type: 'particleBurst';
	color?: string;
	count?: number;
	durationMs?: number;
}

/**
 * A freehand line drawn through `points` (world-space, flat [x, y, z, ...]),
 * rendered as a single tube. One slot per brush stroke keeps long drawings
 * cheap: one mesh and one snapshot entry instead of one slot per segment.
 */
export interface StrokeComponent {
	type: 'stroke';
	points: number[];
	color: string;
	/** Line thickness (diameter) in meters. */
	width: number;
}

/**
 * A translucent coating tinted over a surface's own material — grime, frost,
 * paint, snow, blood, rust, or anything else that reads as a layer ON an
 * object rather than a property of it. `mask` is a small grayscale coverage
 * bitmap (`resolution` × `resolution`, row-major, base64-encoded bytes:
 * 0 = fully clean/absent, 255 = fully covered), fixed at creation time and
 * mutated in place by a script — see `world.raycast` (codeBlockRuntime.ts)
 * for finding where on the mask to paint and `world.setComponentField` for
 * writing the result back. Generic: any "erode/build up a coating by
 * contact" mechanic (a pressure washer, a snowball, a paintbrush spray gun)
 * reuses this same component and the same read/paint/write primitives — see
 * the "Pressure Washer" lobby tool for the reference reader/writer.
 */
export interface SurfaceMaskComponent {
	type: 'surfaceMask';
	/** Overlay tint, alpha-blended by the mask. */
	color: string;
	/** Alpha where the mask reads fully "on" (1 = a fully opaque coating), 0-1. */
	opacity?: number;
	/** Mask width/height in pixels. Fixed when the coating is created. */
	resolution: number;
	mask: string;
}

/** A light attached to a slot, measured in metres in the scene. */
export interface PointLightComponent {
	type: 'pointLight';
	color: string;
	intensity: number;
	range: number;
}

/** A gradient sky with optional stars, drawn behind everything and following the camera. Use one per scene. */
export interface SkyboxComponent {
	type: 'skybox';
	topColor: string;
	horizonColor: string;
	bottomColor: string;
	/** Star density, 0 (none) to 1 (dense). */
	stars?: number;
	/** Global diffuse light level while this skybox is active. */
	ambientIntensity?: number;
	/** Six images of a reflection cubemap, addressed by cubemap face. */
	reflectionPx?: SourceRef;
	reflectionNx?: SourceRef;
	reflectionPy?: SourceRef;
	reflectionNy?: SourceRef;
	reflectionPz?: SourceRef;
	reflectionNz?: SourceRef;
	/** Capture the scene from this slot to provide live environment reflections. */
	reflectionCapture?: boolean;
	/** Legacy built-in preset, kept for saved Polygon Quest worlds. */
	reflectionPreset?: 'polygon-quest';
	/** Apply ACES tone mapping while this world is active. */
	toneMapping?: 'aces';
}

/**
 * How a published world presents itself when installed as its own app: name, description, icon and colours of its
 * web app manifest (see `$lib/worlds/appManifest`). Use one per scene.
 */
export interface AppInfoComponent {
	type: 'appInfo';
	name?: string;
	shortName?: string;
	description?: string;
	/** An image asset used as the app icon; the world's thumbnail is used when empty. */
	icon?: SourceRef;
	themeColor?: string;
	backgroundColor?: string;
}

export interface VelocityComponent {
	type: 'velocity';
	/** Units/second, integrated into the Slot's position every tick by SceneGraph — generic simple kinematics for any thrown/rolling/sliding object, not tied to any one demo. Paused while the slot is grabbed (see SceneGraph.tick). */
	linear: Vec3;
	/** Fraction of speed lost per second (exponential decay); omitted/0 means it coasts forever. */
	drag?: number;
}

export interface TextDisplayComponent {
	type: 'textDisplay';
	/** Rendered larger, above `lines` — generic floating sign/label surface, not tied to any one demo. */
	title?: string;
	lines: string[];
	color?: string;
	/** How big the text is, times the usual size (1). Larger for shop signs, smaller to fit more lines. */
	scale?: number;
	/** Where the text block sits in the sign: from the top (the default) or centred vertically. */
	verticalAlign?: 'top' | 'middle';
}

/**
 * A generic tabular leaderboard/scoreboard surface — a header row of
 * `columns` plus one row per player, styled like an arcade scoreboard.
 * All the game logic (turn order, what a cell means) lives in the codeBlock
 * that writes these fields; this component only knows how to lay a grid
 * out, so it's reusable for any multiplayer minigame that wants a shared
 * scoreboard, not just bowling.
 */
export interface ScoreboardComponent {
	type: 'scoreboard';
	title?: string;
	/** A short status line above the grid, e.g. "Up: Alice — throw 1/2". */
	status?: string;
	columns: string[];
	rows: {
		name: string;
		/** Aligned with `columns`, one string per column. */
		cells: string[];
		/** Highlights the row (e.g. whoever's turn it is). */
		highlight?: boolean;
		/** Shows a leader marker next to the name. */
		isLeader?: boolean;
	}[];
}

/** Root surface for a hierarchy of world-space UI elements. Dimensions are design pixels. */
export interface UIPanelComponent {
	type: 'uiPanel';
	width: number;
	height: number;
	background?: string;
	/** Physical width in world units; height follows the design-pixel aspect ratio. */
	worldWidth?: number;
	/** Mirrors only the GUI texture horizontally; the panel's world transform stays unchanged. */
	mirrorX?: boolean;
}

/** A renderable UI control attached to a normal Slot in the scene hierarchy. */
export interface UIElementComponent {
	type: 'uiElement';
	kind: 'container' | 'text' | 'button' | 'input' | 'image' | 'video';
	visible?: boolean;
	width?: number;
	height?: number;
	flexDirection?: 'row' | 'column';
	gap?: number;
	margin?: number;
	padding?: number;
	background?: string;
	color?: string;
	text?: string;
	fontSize?: number;
	fontWeight?: 'normal' | 'bold';
	/** `container`: 'scroll' clips children to `height` and adds a scrollbar. */
	overflow?: 'visible' | 'scroll';
	/** `image` / `video`: a browser-loadable URL (video: MP4/WebM). */
	src?: string;
	/** `input`: hint shown while the field is empty. */
	placeholder?: string;
	/** `video` playback, shared by every peer. Scripts write these with `world.setComponentField`. */
	playing?: boolean;
	loop?: boolean;
	muted?: boolean;
	volume?: number;
	/** `video`: writing a new value seeks to it (the running position is read with `ui.getMedia`). */
	currentTime?: number;
}

/** A user interaction with a UI element. Delivered to the element's codeBlock and every ancestor's `onUIEvent`, on the host. */
export interface UIEvent {
	/** Set by the host for events forwarded by a guest. */
	remoteGuestId?: string;
	type: 'press' | 'change' | 'submit';
	slotId: string;
	/** `input` only: the field's current text. */
	text?: string;
}

export interface ScriptStateComponent {
	type: 'scriptState';
	/**
	 * Arbitrary JSON a codeBlock reads/writes via `world.setComponentField` —
	 * a generic shared "blackboard" for coordinating several cooperating
	 * codeBlocks on different Slots (turn counters, tallies, reset signals),
	 * since scripts otherwise can't call into each other directly. Not tied
	 * to any one demo.
	 */
	data: Record<string, unknown>;
}

export interface PressableButtonComponent {
	type: 'pressableButton';
	/** Local-space direction the button travels when pressed, e.g. [0, -1, 0] to push straight down. Need not be unit length. */
	axis: Vec3;
	/** Local-space distance from resting to fully pressed. */
	travel: number;
	/** Local-space radius around the press axis a hand/controller tip must be within to register as touching the button. */
	radius: number;
	/** Depression fraction (0-1) at which the codeBlock's `onPress()` fires — defaults to 1 (fully pressed). */
	threshold?: number;
}

/** A short procedural percussive sound (noise burst + optional pitched tone) — see impactSoundEffects.ts. Generic game-feel audio (impacts, clicks, knocks) without needing to source/host external sound files. */
export interface ImpactSoundComponent {
	type: 'impactSound';
	/** Base tone frequency in Hz; omit/0 for a pure noise hit (e.g. a clatter/crash). */
	frequency?: number;
	/** How far the tone's pitch drops over the sound's life, in Hz — gives a "knock"/"thud" character. */
	pitchDrop?: number;
	/** 0-1, how much filtered noise is mixed in alongside the tone (1 = pure noise). */
	noiseMix?: number;
	durationMs?: number;
	volume?: number;
}

/**
 * A place where a matching object can be set down and stay: a record player's
 * platter, a key slot, a shelf. When a grabbed slot carrying `insertable` is
 * released within `radius` of the socket and one of its `tags` is accepted, it
 * snaps into `snap` (in the socket's space) and becomes a child of the socket
 * until someone grabs it again. Resolved by the host (or solo player) only;
 * everyone else sees the result in the next snapshot.
 */
export interface SocketComponent {
	type: 'socket';
	/** Tags of `insertable` objects this socket takes. Empty takes anything insertable. */
	accepts: string[];
	/** How close, in metres, a released object must be to the socket's snap point. */
	radius: number;
	/** Where the object settles, in the socket's local space. Rotation is Euler degrees (pitch, yaw, roll). */
	snap: EquipPose;
	/** Whether inserting starts the object's `audioPlayer` and removing it pauses it. */
	playMedia?: boolean;
	/** Set by the host while something sits in the socket. Never author this by hand. */
	occupantId?: string;
}

/**
 * Where the preview picture of an object, avatar or world is taken from. The slot's position is the camera and its forward
 * direction (+Z) is where it looks; in a world, this replaces the spawn point that the 360° panorama is taken from.
 */
export interface PreviewCameraComponent {
	type: 'previewCamera';
	/** Vertical field of view in degrees for objects and avatars (a world's panorama always sees everything). */
	fov?: number;
}

/**
 * A box that tidies up what is let go inside it, like a table top that sets things down on itself. The box is the slot's own
 * unit cube, so the slot's position, rotation and scale are the box's centre, orientation and size. When a grabbed object
 * is released with its middle inside the box, it turns to sit upright against the box's up direction and drops (or rises)
 * until its lowest point rests on the box's floor. Only the host decides, like sockets.
 */
export interface DropZoneComponent {
	type: 'dropZone';
	/** How the object turns when it lands: `upright` stands it on its own up (the default), `nearest` rests it on whichever face is closest to down, `keep` leaves its rotation alone. */
	align?: 'upright' | 'nearest' | 'keep';
	/** Snaps the object's turn around the vertical to steps of this many degrees, from the box's own forward. 0 or unset leaves it free. */
	yawStep?: number;
}

/**
 * One key of the in-world keyboard (see xr/keyboard): what it types or does. The keyboard builds its keys from a layout
 * and is the only thing that reads this; `variant` and `candidate` mark the extra keys it shows while a key is held down
 * or while an input method offers candidates.
 */
export interface KeyboardKeyComponent {
	type: 'keyboardKey';
	key: import('../xr/keyboard/layout').KeyDef;
	variant?: string;
	candidate?: number;
}

/**
 * The title, author and colours of a record disc (see `$lib/xr/templates/recordDisc`). The disc's look (label text,
 * label and rim colour, vinyl and groove tones) is derived from these fields whenever they are edited, in the Studio
 * and in the in-game inspector alike, so nobody has to touch the parts of the disc by hand.
 */
export interface RecordDiscComponent {
	type: 'recordDisc';
	title: string;
	author: string;
	/** Centre label and rim. */
	labelColor: string;
	/** The vinyl itself; the groove tones follow from it. Near-black when absent. */
	vinylColor?: string;
}

/** Marks a grabbable object as something a `socket` can take. */
export interface InsertableComponent {
	type: 'insertable';
	/** What kind of object this is, matched against a socket's `accepts` (for example `disc`). */
	tag: string;
}

/**
 * Marks a slot with a skinned model as a player avatar. Everything else about it
 * is an ordinary slot: children are attached to it (optionally to a bone, see
 * `boneAttach`) and travel with the snapshot. The pose is never stored; each
 * client derives it from the owner's presence.
 */
export interface AvatarComponent {
	type: 'avatar';
	/** Standing eye height in metres, used to scale the body to the player's real height. */
	height: number;
	/** Humanoid role to bone name in the model. Filled by detection, editable by hand. */
	bones: HumanoidMap;
	/** Player this avatar currently represents. Set by the host on spawn; never authored or saved. */
	ownerId?: string;
}

/** Puts a slot under a bone of its parent's skinned model instead of under the parent's root, so it follows that bone. */
export interface BoneAttachComponent {
	type: 'boneAttach';
	/** Bone name as written in the parent's model. */
	bone: string;
}

export type Component =
	| MeshRendererComponent
	| ColliderComponent
	| GrabbableComponent
	| EquippableComponent
	| AudioSourceComponent
	| ContainerComponent
	| WorldPortalComponent
	| MirrorComponent
	| CameraComponent
	| AudioPlayerComponent
	| HtmlViewComponent
	| CodeBlockComponent
	| ExpiresComponent
	| ParticleBurstComponent
	| StrokeComponent
	| SurfaceMaskComponent
	| SkyboxComponent
	| AppInfoComponent
	| PointLightComponent
	| VelocityComponent
	| PressableButtonComponent
	| ImpactSoundComponent
	| SocketComponent
	| InsertableComponent
	| RecordDiscComponent
	| PreviewCameraComponent
	| DropZoneComponent
	| KeyboardKeyComponent
	| AvatarComponent
	| BoneAttachComponent
	| TextDisplayComponent
	| ScoreboardComponent
	| UIPanelComponent
	| UIElementComponent
	| ScriptStateComponent;

export interface Slot {
	id: string;
	parentId: string | null;
	name: string;
	position: Vec3;
	rotation: Quat;
	scale: Vec3;
	components: Component[];
}

/** A flat list of slots forming one or more trees via parentId — the on-disk/over-the-wire shape. */
export type SlotTree = Slot[];

export function createSlot(partial: Partial<Slot> & { name: string }): Slot {
	return {
		id: partial.id ?? crypto.randomUUID(),
		parentId: partial.parentId ?? null,
		name: partial.name,
		position: partial.position ?? [0, 0, 0],
		rotation: partial.rotation ?? [0, 0, 0, 1],
		scale: partial.scale ?? [1, 1, 1],
		components: partial.components ?? []
	};
}

export function findComponent<T extends Component['type']>(
	slot: Slot,
	type: T
): Extract<Component, { type: T }> | undefined {
	return slot.components.find((c) => c.type === type) as Extract<Component, { type: T }> | undefined;
}

export function isEquippable(slot: Slot): EquippableComponent | undefined {
	return findComponent(slot, 'equippable');
}

export function isGrabbable(slot: Slot): GrabbableComponent | undefined {
	return findComponent(slot, 'grabbable');
}
