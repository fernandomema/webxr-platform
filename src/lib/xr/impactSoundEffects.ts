import { AbstractEngine, Sound, type Scene, type TransformNode } from '@babylonjs/core';
import type { ImpactSoundComponent } from '$lib/ecs/types';

/**
 * Procedurally synthesizes a short percussive hit (an enveloped noise burst,
 * optionally mixed with a downward-sliding tone for a "knock"/"thud"
 * character) directly into an AudioBuffer — no sound file to host or guess
 * a URL for. Generic game-feel audio: reused for pin knocks, a strike
 * crash, and a button click, but not tied to any of them specifically.
 */
function synthesizeImpactBuffer(scene: Scene, component: ImpactSoundComponent): AudioBuffer | null {
	const audioContext = AbstractEngine.audioEngine?.audioContext;
	if (!audioContext) return null;

	const durationSec = Math.max((component.durationMs ?? 220) / 1000, 0.02);
	const frequency = component.frequency ?? 0;
	const pitchDrop = component.pitchDrop ?? 0;
	const noiseMix = component.noiseMix ?? (frequency > 0 ? 0.25 : 1);

	const sampleRate = audioContext.sampleRate;
	const length = Math.floor(sampleRate * durationSec);
	const buffer = audioContext.createBuffer(1, length, sampleRate);
	const data = buffer.getChannelData(0);

	for (let i = 0; i < length; i++) {
		const t = i / sampleRate;
		const progress = t / durationSec;
		const envelope = Math.exp(-progress * 6); // fast percussive decay
		const tone = frequency > 0 ? Math.sin(2 * Math.PI * Math.max(frequency - pitchDrop * progress, 1) * t) : 0;
		const noise = Math.random() * 2 - 1;
		data[i] = envelope * (tone * (1 - noiseMix) + noise * noiseMix);
	}

	return buffer;
}

/** Plays (and self-disposes after) a synthesized impact sound positioned at `node`. Returns a dispose function for early cleanup. */
export function setupImpactSound(scene: Scene, node: TransformNode, component: ImpactSoundComponent): () => void {
	const buffer = synthesizeImpactBuffer(scene, component);
	if (!buffer) return () => {};

	// This Babylon version initializes Sound's playback engine asynchronously
	// internally — calling .play() synchronously right after `new Sound(...)`
	// fires before it's actually ready, and nothing plays. `autoplay: true`
	// makes it play itself the moment it finishes that async setup instead.
	const sound = new Sound(`impact-${node.name}`, buffer, scene, null, {
		spatialSound: true,
		volume: component.volume ?? 0.6,
		maxDistance: 25,
		autoplay: true
	});
	sound.attachToMesh(node);

	return () => sound.dispose();
}
