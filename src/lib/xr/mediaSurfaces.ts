import {
	AbstractEngine,
	ActionManager,
	ExecuteCodeAction,
	Sound,
	type AbstractMesh,
	type Scene
} from '@babylonjs/core';
import { normalizeSourceRef } from '$lib/assets/ref';
import type { BlobAssetLibrary, BlobLease } from './blobAssetLibrary';
import {
	findComponent,
	type AudioPlayerComponent,
	type MediaControlAction,
	type Slot
} from '$lib/ecs/types';

export interface MediaRuntimeBinding {
	dispose(): void;
	sync(slot: Slot): void;
	control(action: MediaControlAction): void;
}

interface MediaSurfaceCallbacks {
	onControl(action: MediaControlAction): void;
	/** Where asset-backed media gets its bytes. Without it, an audio asset stays silent. */
	assets?: BlobAssetLibrary;
	/** Whether clicking the surface toggles playback. False when something else (a socket) drives it. */
	interactive?: boolean;
}

function resolveMediaUrl(url: string): string {
	try {
		const parsed = new URL(url, window.location.href);
		if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'blob:') return parsed.href;
	} catch {
		// Invalid media URLs are left as an empty source and shown as a placeholder.
	}
	return '';
}

function clampVolume(volume: number | undefined): number {
	return Math.min(1, Math.max(0, volume ?? 1));
}

function installMediaControl(
	scene: Scene,
	mesh: AbstractMesh,
	callbacks: MediaSurfaceCallbacks
): ActionManager {
	mesh.isPickable = true;
	mesh.metadata = { ...(mesh.metadata ?? {}), interactive: true, mediaSurface: true };
	const actionManager = new ActionManager(scene);
	actionManager.registerAction(
		new ExecuteCodeAction(ActionManager.OnPickTrigger, () => callbacks.onControl('toggle'))
	);
	mesh.actionManager = actionManager;
	return actionManager;
}

export function setupAudioPlayerSurface(
	scene: Scene,
	mesh: AbstractMesh,
	initial: AudioPlayerComponent,
	callbacks: MediaSurfaceCallbacks
): MediaRuntimeBinding {
	let component = initial;
	let requestedTime = component.currentTime ?? 0;
	let sourceKey = '';
	let sourceUrl = '';
	let lease: BlobLease | null = null;
	let sound: Sound | null = null;

	/** Points `sourceUrl` at the component's current source. Returns whether it changed. */
	const resolveSource = (next: AudioPlayerComponent): boolean => {
		const ref = normalizeSourceRef(next.source, next.url);
		const key = ref.kind === 'asset' ? ref.assetId : `url:${ref.url}`;
		let changed = false;
		if (key !== sourceKey) {
			sourceKey = key;
			changed = true;
			lease?.release();
			lease = null;
			if (ref.kind === 'asset' && callbacks.assets) {
				lease = callbacks.assets.acquire(ref.assetId, () => {
					const ready = lease?.state === 'ready' ? (lease.url ?? '') : '';
					if (ready !== sourceUrl) {
						sourceUrl = ready;
						replaceSound();
					}
				});
			}
		}
		const url = ref.kind === 'url' ? resolveMediaUrl(ref.url) : lease?.state === 'ready' ? (lease.url ?? '') : '';
		if (url !== sourceUrl) {
			sourceUrl = url;
			changed = true;
		}
		return changed;
	};
	const actionManager = callbacks.interactive === false ? null : installMediaControl(scene, mesh, callbacks);
	mesh.metadata = { ...(mesh.metadata ?? {}), specialSurface: 'audio-player' };

	const createSound = () => {
		// Without an audio engine (e.g. the Studio preview) a Sound has no backend and throws when used.
		if (!sourceUrl || !AbstractEngine.audioEngine) return null;
		const next = new Sound(
			`${mesh.name}-audio`,
			sourceUrl,
			scene,
			() => {
				if (component.autoplay || component.playing) next.play(0, component.currentTime ?? 0);
			},
			{
				autoplay: false,
				loop: component.loop ?? false,
				volume: clampVolume(component.volume),
				spatialSound: true,
				maxDistance: 12,
				refDistance: 1
			}
		);
		next.attachToMesh(mesh);
		next.onEndedObservable.add(() => {
			if (!next.loop) {
				component.playing = false;
				component.currentTime = 0;
			}
		});
		return next;
	};

	const replaceSound = () => {
		sound?.dispose();
		sound = createSound();
	};
	resolveSource(component);
	replaceSound();

	const sync = (slot: Slot) => {
		const next = findComponent(slot, 'audioPlayer');
		if (!next) return;
		component = next;
		if (resolveSource(next)) replaceSound();
		if (!sound) return;
		sound.loop = component.loop ?? false;
		sound.setVolume(clampVolume(component.volume));
		if (component.playing && !sound.isPlaying) sound.play(0, component.currentTime ?? 0);
		else if (!component.playing && sound.isPlaying) sound.pause();
		else if (component.playing && (component.currentTime ?? 0) !== requestedTime) {
			// Seek only when the requested position itself changed: a playing track's own progress is not a request to restart it.
			sound.stop();
			sound.play(0, component.currentTime ?? 0);
		}
		requestedTime = component.currentTime ?? 0;
	};

	const control = (action: MediaControlAction) => {
		component.playing = action === 'toggle' ? !component.playing : action === 'play';
		if (!sound) return;
		if (component.playing) sound.play(0, component.currentTime ?? 0);
		else {
			component.currentTime = sound.currentTime;
			sound.pause();
		}
	};

	if (component.autoplay) component.playing = true;

	return {
		dispose() {
			actionManager?.dispose();
			sound?.dispose();
			lease?.release();
		},
		sync,
		control
	};
}
