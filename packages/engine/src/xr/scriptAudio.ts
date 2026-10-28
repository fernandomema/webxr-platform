import { AbstractEngine } from '@babylonjs/core';
import { normalizeSourceRef } from '../assets/ref.ts';
import { analyzeAudio, type AudioAnalysis } from '../audio/analysis.ts';
import type { BlobAssetLibrary } from './blobAssetLibrary.ts';

/** A track started with `ctx.audio.playTrack`. `time()` follows the audio hardware clock, so it is the one to sync to. */
export interface AudioTrackHandle {
	/** Seconds of the track played so far (frozen while paused, never past its length). */
	time(): number;
	readonly duration: number;
	readonly playing: boolean;
	/** True once a track that does not loop has played to its end. */
	readonly ended: boolean;
	pause(): void;
	resume(): void;
	stop(): void;
	setVolume(volume: number): void;
}

export interface PlayTrackOptions {
	volume?: number;
	loop?: boolean;
	/** Where in the track to start, in seconds. */
	offset?: number;
	/** How fast it plays, 1 being as recorded (it changes the pitch): a little variety for a sound heard often. */
	rate?: number;
}

/** A sound placed in the world with `playAt`: a track that can also be moved. */
export interface PositionedTrackHandle extends AudioTrackHandle {
	setPosition(position: [number, number, number]): void;
}

export interface PlayAtOptions extends PlayTrackOptions {
	/** Up to this far (m, default 1) it is as loud as it gets; beyond it it fades. */
	refDistance?: number;
	/** Past this (m, default 60) it is no louder fading. */
	maxDistance?: number;
	/** How fast it fades with distance (default 1). */
	rolloff?: number;
}

/** What a script can do with sound beyond placing it in the world: look inside a track and play it on the audio clock. */
export interface ScriptAudio {
	/** Decodes the source and returns its onsets, tempo and band energy (see `analyzeAudio`). Cached per source. */
	analyze(source: unknown): Promise<AudioAnalysis>;
	/** Starts playing the source right away, not spatialised. Resolves once it is decoded and playing. */
	playTrack(source: unknown, options?: PlayTrackOptions): Promise<AudioTrackHandle>;
	/** Starts playing the source from a point in the world: it is heard from where it is, louder the nearer the listener is. */
	playAt(source: unknown, position: [number, number, number], options?: PlayAtOptions): Promise<PositionedTrackHandle>;
	/** Tells the audio where the listener is (the player's head) and which way it faces. The engine calls it every frame. */
	setListener(position: [number, number, number], forward: [number, number, number], up: [number, number, number]): void;
	dispose(): void;
}

const MAX_CACHED = 4;
const ASSET_WAIT_MS = 15_000;

function mediaUrl(url: string): string {
	const parsed = new URL(url, window.location.href);
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'blob:') throw new Error('Audio sources must be http(s) URLs or assets');
	return parsed.href;
}

/** Keeps the most recent promises; a rejected one is dropped so a later call can try again. */
function remember<T>(cache: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> {
	const cached = cache.get(key);
	if (cached) {
		cache.delete(key);
		cache.set(key, cached);
		return cached;
	}
	const created = make();
	cache.set(key, created);
	created.catch(() => {
		if (cache.get(key) === created) cache.delete(key);
	});
	while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string);
	return created;
}

export function createScriptAudio(assets?: BlobAssetLibrary): ScriptAudio {
	const buffers = new Map<string, Promise<AudioBuffer>>();
	const analyses = new Map<string, Promise<AudioAnalysis>>();
	const tracks = new Set<AudioTrackHandle>();

	const context = (): AudioContext => {
		const audioContext = AbstractEngine.audioEngine?.audioContext as AudioContext | undefined;
		if (!audioContext) throw new Error('Audio is not available here');
		return audioContext;
	};

	/** The bytes' address: a plain URL, or the object URL of an asset once its lease is ready. */
	async function withUrl<T>(source: unknown, use: (url: string) => Promise<T>): Promise<T> {
		const ref = normalizeSourceRef(source);
		if (ref.kind === 'url') return use(mediaUrl(ref.url));
		if (!assets) throw new Error('Asset audio is not available here');
		let lease: ReturnType<BlobAssetLibrary['acquire']> | null = null;
		try {
			const url = await new Promise<string>((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error('The audio asset is not available')), ASSET_WAIT_MS);
				lease = assets.acquire(ref.assetId, () => {
					if (!lease) return;
					if (lease.state === 'ready' && lease.url) {
						clearTimeout(timer);
						resolve(lease.url);
					} else if (lease.state === 'error') {
						clearTimeout(timer);
						reject(new Error('The audio asset is invalid'));
					}
				});
			});
			return await use(url);
		} finally {
			(lease as { release(): void } | null)?.release();
		}
	}

	const keyOf = (source: unknown): string => {
		const ref = normalizeSourceRef(source);
		return ref.kind === 'asset' ? ref.assetId : `url:${ref.url}`;
	};

	const decode = (source: unknown): Promise<AudioBuffer> =>
		remember(buffers, keyOf(source), () =>
			withUrl(source, async (url) => {
				const response = await fetch(url);
				if (!response.ok) throw new Error(`The audio could not be loaded (${response.status})`);
				return context().decodeAudioData(await response.arrayBuffer());
			})
		);

	return {
		analyze: (source) =>
			remember(analyses, keyOf(source), async () => {
				const buffer = await decode(source);
				// Yield first so a long track does not stall the frame that asked for it.
				await new Promise((resolve) => setTimeout(resolve, 0));
				const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
				return analyzeAudio(channels, buffer.sampleRate);
			}),

		setListener(position, forward, up) {
			const audioContext = AbstractEngine.audioEngine?.audioContext as AudioContext | undefined;
			const listener = audioContext?.listener;
			if (!listener || !position.every(Number.isFinite) || !forward.every(Number.isFinite) || !up.every(Number.isFinite)) return;
			if (listener.positionX) {
				const t = audioContext!.currentTime;
				listener.positionX.setValueAtTime(position[0], t); listener.positionY.setValueAtTime(position[1], t); listener.positionZ.setValueAtTime(position[2], t);
				listener.forwardX.setValueAtTime(forward[0], t); listener.forwardY.setValueAtTime(forward[1], t); listener.forwardZ.setValueAtTime(forward[2], t);
				listener.upX.setValueAtTime(up[0], t); listener.upY.setValueAtTime(up[1], t); listener.upZ.setValueAtTime(up[2], t);
			}
		},

		async playAt(source, position, options = {}) {
			const audioContext = context();
			const panner = audioContext.createPanner();
			panner.panningModel = 'HRTF';
			panner.distanceModel = 'inverse';
			panner.refDistance = Math.max(0.1, options.refDistance ?? 1);
			panner.maxDistance = Math.max(panner.refDistance, options.maxDistance ?? 60);
			panner.rolloffFactor = Math.max(0, options.rolloff ?? 1);
			const place = (p: [number, number, number]) => {
				if (!p.every(Number.isFinite)) return;
				if (panner.positionX) {
					panner.positionX.value = p[0]; panner.positionY.value = p[1]; panner.positionZ.value = p[2];
				}
			};
			place(position);
			const handle = (await startTrack(source, options, panner)) as PositionedTrackHandle;
			handle.setPosition = place;
			return handle;
		},

		playTrack: (source, options = {}) => startTrack(source, options),

		dispose() {
			for (const track of [...tracks]) track.stop();
			buffers.clear();
			analyses.clear();
		}
	};

	async function startTrack(source: unknown, options: PlayTrackOptions, panner?: PannerNode): Promise<AudioTrackHandle> {
		const audioContext = context();
		const buffer = await decode(source);
		await audioContext.resume();
		const gain = audioContext.createGain();
		gain.gain.value = Math.min(1, Math.max(0, options.volume ?? 1));
		if (panner) { gain.connect(panner); panner.connect(audioContext.destination); } else gain.connect(audioContext.destination);
		const loop = options.loop ?? false;
		let node: AudioBufferSourceNode | null = null;
		let startedAt = 0;
		let offset = Math.min(Math.max(0, options.offset ?? 0), buffer.duration);
		let playing = false;
		let ended = false;

		const elapsed = () => {
			const raw = playing ? offset + (audioContext.currentTime - startedAt) : offset;
			return loop ? raw % buffer.duration : Math.min(raw, buffer.duration);
		};
		const start = () => {
			const next = audioContext.createBufferSource();
			next.buffer = buffer;
			next.loop = loop;
			if (options.rate && Number.isFinite(options.rate)) next.playbackRate.value = Math.min(4, Math.max(0.25, options.rate));
			next.connect(gain);
			next.onended = () => {
				if (node !== next) return;
				playing = false;
				ended = !loop;
				offset = buffer.duration;
			};
			node = next;
			startedAt = audioContext.currentTime;
			playing = true;
			next.start(0, offset);
		};
		const halt = () => {
			const old = node;
			node = null;
			if (!old) return;
			old.onended = null;
			try {
				old.stop();
			} catch {
				// Already stopped.
			}
			old.disconnect();
		};

		const handle: AudioTrackHandle = {
			time: elapsed,
			duration: buffer.duration,
			get playing() {
				return playing;
			},
			get ended() {
				return ended;
			},
			pause() {
				if (!playing) return;
				offset = elapsed();
				playing = false;
				halt();
			},
			resume() {
				if (playing || ended) return;
				start();
			},
			stop() {
				playing = false;
				ended = true;
				halt();
				gain.disconnect();
				panner?.disconnect();
				tracks.delete(handle);
			},
			setVolume(volume) {
				gain.gain.value = Math.min(1, Math.max(0, volume));
			}
		};
		tracks.add(handle);
		start();
		return handle;
	}
}
