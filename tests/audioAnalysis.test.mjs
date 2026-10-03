import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAudio } from '../src/lib/audio/analysis.ts';

const RATE = 22050;

/** A kick (decaying 60 Hz sine) on every beat and a hat (a burst of noise) halfway between beats. */
function drumTrack(bpm, seconds) {
	const samples = new Float32Array(Math.floor(RATE * seconds));
	const beat = 60 / bpm;
	let seed = 7;
	const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0xffffffff) * 2 - 1;
	for (let t = 0.5; t < seconds - 0.2; t += beat) {
		const kick = Math.floor(t * RATE);
		for (let i = 0; i < RATE * 0.12; i++) samples[kick + i] += 0.9 * Math.sin((2 * Math.PI * 60 * i) / RATE) * Math.exp(-i / (RATE * 0.04));
		const hat = Math.floor((t + beat / 2) * RATE);
		for (let i = 0; i < RATE * 0.03 && hat + i < samples.length; i++) samples[hat + i] += 0.35 * noise() * Math.exp(-i / (RATE * 0.008));
	}
	return samples;
}

test('onsets of a steady drum track land on the beats, kicks low and hats high', () => {
	const analysis = analyzeAudio(drumTrack(120, 20), RATE);
	const lows = analysis.onsets.filter((onset) => onset.band === 'low');
	const highs = analysis.onsets.filter((onset) => onset.band === 'high');
	assert.ok(lows.length >= 30, `expected about 38 kicks, got ${lows.length}`);
	assert.ok(highs.length >= 25, `expected the hats, got ${highs.length}`);
	// Every kick onset is within 40 ms of a beat (beats at 0.5 + n * 0.5 s).
	const offBeat = lows.filter((onset) => {
		const phase = ((onset.t - 0.5) % 0.5 + 0.5) % 0.5;
		return Math.min(phase, 0.5 - phase) > 0.04;
	});
	assert.ok(offBeat.length <= lows.length * 0.1, `${offBeat.length} of ${lows.length} kicks are off the beat`);
	assert.deepEqual(analysis.onsets.map((onset) => onset.t), analysis.onsets.map((onset) => onset.t).sort((a, b) => a - b));
	for (const onset of analysis.onsets) assert.ok(onset.strength >= 0 && onset.strength <= 1);
});

test('the tempo of a steady track is found', () => {
	for (const bpm of [100, 120, 140]) {
		const analysis = analyzeAudio(drumTrack(bpm, 24), RATE);
		assert.ok(Math.abs(analysis.bpm - bpm) <= 3, `${bpm} BPM was read as ${analysis.bpm}`);
		assert.ok(analysis.bpmConfidence > 0.3);
	}
});

test('band energy and duration are reported, silence has no onsets', () => {
	const analysis = analyzeAudio(drumTrack(120, 10), RATE);
	assert.ok(Math.abs(analysis.duration - 10) < 0.01);
	assert.ok(analysis.energy.low.length > 100);
	assert.equal(analysis.energy.low.length, analysis.energy.high.length);
	assert.ok(analysis.energy.low.every((value) => value >= 0 && value <= 1));
	const silent = analyzeAudio(new Float32Array(RATE * 5), RATE);
	assert.equal(silent.onsets.length, 0);
	assert.equal(silent.bpm, 0);
	assert.equal(analyzeAudio(new Float32Array(10), RATE).onsets.length, 0);
});

test('stereo input is mixed down', () => {
	const mono = drumTrack(120, 10);
	const left = analyzeAudio([mono, mono], RATE);
	const single = analyzeAudio(mono, RATE);
	assert.equal(left.onsets.length, single.onsets.length);
});
