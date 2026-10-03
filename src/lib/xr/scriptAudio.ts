import { AbstractEngine } from '@babylonjs/core';
import { normalizeSourceRef } from '$lib/assets/ref';
import { analyzeAudio, type AudioAnalysis } from '$lib/audio/analysis';
import type { BlobAssetLibrary } from './blobAssetLibrary';

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
}

/** What a script can do with sound beyond placing it in the world: look inside a track and play it on the audio clock. */
export interface ScriptAudio {
	/** Decodes the source and returns its onsets, tempo and band energy (see `analyzeAudio`). Cached per source. */
	analyze(source: unknown): Promise<AudioAnalysis>;
	/** Starts playing the source right away, not spatialised. Resolves once it is decoded and playing. */
	playTrack(source: unknown, options?: PlayTrackOptions): Promise<AudioTrackHandle>;
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

		async playTrack(source, options = {}) {
			const audioContext = context();
			const buffer = await decode(source);
			await audioContext.resume();
			const gain = audioContext.createGain();
			gain.gain.value = Math.min(1, Math.max(0, options.volume ?? 1));
			gain.connect(audioContext.destination);
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
					tracks.delete(handle);
				},
				setVolume(volume) {
					gain.gain.value = Math.min(1, Math.max(0, volume));
				}
			};
			tracks.add(handle);
			start();
			return handle;
		},

		dispose() {
			for (const track of [...tracks]) track.stop();
			buffers.clear();
			analyses.clear();
		}
	};
}
