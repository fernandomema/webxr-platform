import {
	AbstractEngine,
	ActionManager,
	Color3,
	ExecuteCodeAction,
	Sound,
	StandardMaterial,
	VideoTexture,
	type AbstractMesh,
	type Scene
} from '@babylonjs/core';
import {
	findComponent,
	type AudioPlayerComponent,
	type MediaControlAction,
	type Slot,
	type VideoPlayerComponent
} from '$lib/ecs/types';

export interface MediaRuntimeBinding {
	dispose(): void;
	sync(slot: Slot): void;
	control(action: MediaControlAction): void;
}

interface MediaSurfaceCallbacks {
	onControl(action: MediaControlAction): void;
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

export function setupVideoPlayerSurface(
	scene: Scene,
	mesh: AbstractMesh,
	initial: VideoPlayerComponent,
	callbacks: MediaSurfaceCallbacks
): MediaRuntimeBinding {
	let component = initial;
	let sourceUrl = resolveMediaUrl(component.url);
	const video = document.createElement('video');
	video.crossOrigin = 'anonymous';
	video.playsInline = true;
	video.preload = 'auto';
	video.loop = component.loop ?? false;
	video.muted = component.muted ?? false;
	video.volume = clampVolume(component.volume);
	video.src = sourceUrl;

	const texture = new VideoTexture(
		`${mesh.name}-video-texture`,
		video,
		scene,
		false,
		false,
		3,
		{
			autoPlay: false,
			muted: video.muted,
			loop: video.loop,
			autoUpdateTexture: true,
			independentVideoSource: true
		}
	);
	const material = new StandardMaterial(`${mesh.name}-video-material`, scene);
	material.diffuseColor = Color3.White();
	material.emissiveColor = Color3.White();
	material.diffuseTexture = texture;
	material.emissiveTexture = texture;
	material.backFaceCulling = false;
	mesh.material = material;
	mesh.metadata = { ...(mesh.metadata ?? {}), specialSurface: 'video-player' };
	const actionManager = installMediaControl(scene, mesh, callbacks);

	const applyPlayback = () => {
		const targetTime = component.currentTime ?? 0;
		if (Number.isFinite(targetTime) && video.readyState >= HTMLMediaElement.HAVE_METADATA) {
			if (Math.abs(video.currentTime - targetTime) > 0.35) video.currentTime = Math.max(0, targetTime);
		}
		if (component.playing) {
			void video.play().catch(() => {
				// Autoplay policies can require one local user gesture before playback.
			});
		} else {
			video.pause();
		}
	};

	video.addEventListener('play', () => (component.playing = true));
	video.addEventListener('pause', () => {
		component.playing = false;
		component.currentTime = video.currentTime;
	});
	video.addEventListener('timeupdate', () => {
		component.currentTime = video.currentTime;
	});
	video.addEventListener('ended', () => {
		if (!video.loop) {
			component.playing = false;
			component.currentTime = 0;
		}
	});

	const sync = (slot: Slot) => {
		const next = findComponent(slot, 'videoPlayer');
		if (!next) return;
		const nextUrl = resolveMediaUrl(next.url);
		if (nextUrl !== sourceUrl) {
			sourceUrl = nextUrl;
			video.src = sourceUrl;
			video.load();
		}
		component = next;
		video.loop = component.loop ?? false;
		video.muted = component.muted ?? false;
		video.volume = clampVolume(component.volume);
		applyPlayback();
	};

	const control = (action: MediaControlAction) => {
		component.playing = action === 'toggle' ? !component.playing : action === 'play';
		if (component.playing) {
			applyPlayback();
		} else {
			component.currentTime = video.currentTime;
			video.pause();
		}
	};

	if (component.autoplay) {
		component.playing = true;
		applyPlayback();
	}

	return {
		dispose() {
		video.pause();
		actionManager.dispose();
		texture.dispose();
		material.dispose();
	},
		sync,
		control
	};
}

export function setupAudioPlayerSurface(
	scene: Scene,
	mesh: AbstractMesh,
	initial: AudioPlayerComponent,
	callbacks: MediaSurfaceCallbacks
): MediaRuntimeBinding {
	let component = initial;
	let sourceUrl = resolveMediaUrl(component.url);
	let sound: Sound | null = null;
	const actionManager = installMediaControl(scene, mesh, callbacks);
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
	replaceSound();

	const sync = (slot: Slot) => {
		const next = findComponent(slot, 'audioPlayer');
		if (!next) return;
		const nextUrl = resolveMediaUrl(next.url);
		if (nextUrl !== sourceUrl) {
			sourceUrl = nextUrl;
			replaceSound();
		}
		component = next;
		if (!sound) return;
		sound.loop = component.loop ?? false;
		sound.setVolume(clampVolume(component.volume));
		if (component.playing && !sound.isPlaying) sound.play(0, component.currentTime ?? 0);
		else if (!component.playing && sound.isPlaying) sound.pause();
		else if (component.playing && Math.abs(sound.currentTime - (component.currentTime ?? 0)) > 0.5) {
			sound.stop();
			sound.play(0, component.currentTime ?? 0);
		}
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
			actionManager.dispose();
			sound?.dispose();
	},
		sync,
		control
	};
}
