/**
 * Audio analysis for scripts: onsets (where something starts: a kick, a snare, a hat), tempo and band energy, from raw
 * samples. Pure and generic: no Babylon, no DOM, runs in Node. A world decides what the data means (a rhythm game's
 * notes, a visualiser's bars, lights that follow the beat).
 */

export type OnsetBand = 'low' | 'mid' | 'high';

export interface AudioOnset {
	/** Seconds from the start of the audio. */
	t: number;
	/** 0-1, relative to the strongest onset of its band. */
	strength: number;
	band: OnsetBand;
}

export interface AudioAnalysis {
	/** Seconds. */
	duration: number;
	/** Beats per minute, or 0 when no steady tempo was found. */
	bpm: number;
	/** 0-1: how much steadier the tempo is than noise. Below about 0.3 treat `bpm` as a guess. */
	bpmConfidence: number;
	/** Sorted by time. */
	onsets: AudioOnset[];
	/** Loudness per band over time, 0-1 (each band normalised to its own peak). Sample `i` is at `i * hop` seconds. */
	energy: { hop: number; low: number[]; mid: number[]; high: number[] };
}

export interface AnalyzeOptions {
	/** Samples per FFT frame (power of two). Default 1024. */
	frameSize?: number;
	/** Samples between frames. Default `frameSize / 2`. */
	hopSize?: number;
	/** Smallest gap between two onsets of the same band, in seconds. Default 0.09. */
	minGap?: number;
	/** How far above the local average a flux peak must be, in standard deviations. Default 1.2. */
	sensitivity?: number;
}

const BANDS: readonly { id: OnsetBand; from: number; to: number }[] = [
	{ id: 'low', from: 30, to: 200 },
	{ id: 'mid', from: 200, to: 2000 },
	{ id: 'high', from: 2000, to: 12000 }
];

/** In-place iterative radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
	const n = re.length;
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			[re[i], re[j]] = [re[j], re[i]];
			[im[i], im[j]] = [im[j], im[i]];
		}
	}
	for (let len = 2; len <= n; len <<= 1) {
		const angle = (-2 * Math.PI) / len;
		const wr = Math.cos(angle);
		const wi = Math.sin(angle);
		for (let start = 0; start < n; start += len) {
			let cr = 1;
			let ci = 0;
			for (let k = 0; k < len / 2; k++) {
				const a = start + k;
				const b = a + len / 2;
				const tr = re[b] * cr - im[b] * ci;
				const ti = re[b] * ci + im[b] * cr;
				re[b] = re[a] - tr;
				im[b] = im[a] - ti;
				re[a] += tr;
				im[a] += ti;
				const next = cr * wr - ci * wi;
				ci = cr * wi + ci * wr;
				cr = next;
			}
		}
	}
}

/** Averages several channels into one. */
function toMono(channels: Float32Array | Float32Array[]): Float32Array {
	if (channels instanceof Float32Array) return channels;
	if (channels.length === 1) return channels[0];
	const mono = new Float32Array(channels[0].length);
	for (const channel of channels) for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
	return mono;
}

/** Peaks of `flux` that stand out from their surroundings: above the local mean by `sensitivity` deviations. */
function pickPeaks(flux: Float64Array, framesPerSecond: number, minGapSeconds: number, sensitivity: number): { frame: number; value: number }[] {
	const half = Math.max(2, Math.round(framesPerSecond * 0.4));
	const minGap = Math.max(1, Math.round(minGapSeconds * framesPerSecond));
	// Running sums give the local mean and deviation in constant time per frame.
	const prefix = new Float64Array(flux.length + 1);
	const prefixSq = new Float64Array(flux.length + 1);
	for (let i = 0; i < flux.length; i++) {
		prefix[i + 1] = prefix[i] + flux[i];
		prefixSq[i + 1] = prefixSq[i] + flux[i] * flux[i];
	}
	const peaks: { frame: number; value: number }[] = [];
	for (let i = 1; i < flux.length - 1; i++) {
		const value = flux[i];
		if (value <= flux[i - 1] || value < flux[i + 1]) continue;
		const lo = Math.max(0, i - half);
		const hi = Math.min(flux.length, i + half + 1);
		const count = hi - lo;
		const mean = (prefix[hi] - prefix[lo]) / count;
		const variance = Math.max(0, (prefixSq[hi] - prefixSq[lo]) / count - mean * mean);
		if (value <= mean + sensitivity * Math.sqrt(variance) || value < 1e-6) continue;
		const last = peaks[peaks.length - 1];
		if (last && i - last.frame < minGap) {
			if (value > last.value) peaks[peaks.length - 1] = { frame: i, value };
			continue;
		}
		peaks.push({ frame: i, value });
	}
	return peaks;
}

/** Tempo from the autocorrelation of the onset curve, searched between 60 and 180 BPM. */
function estimateTempo(curve: Float64Array, framesPerSecond: number): { bpm: number; confidence: number } {
	const minLag = Math.max(1, Math.floor((framesPerSecond * 60) / 180));
	const maxLag = Math.min(curve.length - 1, Math.ceil((framesPerSecond * 60) / 60));
	if (curve.length < maxLag * 2 || minLag >= maxLag) return { bpm: 0, confidence: 0 };
	const mean = curve.reduce((sum, value) => sum + value, 0) / curve.length;
	const centered = curve.map((value) => value - mean);
	const scores = new Float64Array(maxLag + 1);
	let best = minLag;
	let total = 0;
	for (let lag = minLag; lag <= maxLag; lag++) {
		let sum = 0;
		for (let i = 0; i + lag < centered.length; i++) sum += centered[i] * centered[i + lag];
		scores[lag] = sum / (centered.length - lag);
		total += Math.max(0, scores[lag]);
		if (scores[lag] > scores[best]) best = lag;
	}
	const average = total / (maxLag - minLag + 1);
	if (scores[best] <= 0 || average <= 0) return { bpm: 0, confidence: 0 };
	// Refine the lag with the neighbouring scores (parabolic interpolation).
	let lag = best;
	if (best > minLag && best < maxLag) {
		const a = scores[best - 1];
		const b = scores[best];
		const c = scores[best + 1];
		const denominator = a - 2 * b + c;
		if (denominator !== 0) lag = best + (0.5 * (a - c)) / denominator;
	}
	let bpm = (framesPerSecond * 60) / lag;
	while (bpm < 70) bpm *= 2;
	while (bpm > 170) bpm /= 2;
	return { bpm: Math.round(bpm * 10) / 10, confidence: Math.min(1, Math.max(0, 1 - average / scores[best])) };
}

export function analyzeAudio(channels: Float32Array | Float32Array[], sampleRate: number, options: AnalyzeOptions = {}): AudioAnalysis {
	const samples = toMono(channels);
	const frameSize = options.frameSize ?? 1024;
	const hopSize = options.hopSize ?? frameSize / 2;
	const minGap = options.minGap ?? 0.09;
	const sensitivity = options.sensitivity ?? 1.2;
	const duration = samples.length / sampleRate;
	const empty: AudioAnalysis = { duration, bpm: 0, bpmConfidence: 0, onsets: [], energy: { hop: hopSize / sampleRate, low: [], mid: [], high: [] } };
	const frames = Math.floor((samples.length - frameSize) / hopSize) + 1;
	if (!(sampleRate > 0) || frames < 8) return empty;

	const window = new Float64Array(frameSize);
	for (let i = 0; i < frameSize; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frameSize - 1));
	const binHz = sampleRate / frameSize;
	const ranges = BANDS.map((band) => ({
		id: band.id,
		from: Math.max(1, Math.floor(band.from / binHz)),
		to: Math.min(frameSize / 2, Math.max(2, Math.ceil(band.to / binHz)))
	}));
	const re = new Float64Array(frameSize);
	const im = new Float64Array(frameSize);
	const magnitudes = ranges.map(() => new Float64Array(frames));
	const flux = ranges.map(() => new Float64Array(frames));
	const previous = ranges.map((range) => new Float64Array(range.to - range.from));

	for (let frame = 0; frame < frames; frame++) {
		const offset = frame * hopSize;
		for (let i = 0; i < frameSize; i++) {
			re[i] = samples[offset + i] * window[i];
			im[i] = 0;
		}
		fft(re, im);
		ranges.forEach((range, index) => {
			let energy = 0;
			let rise = 0;
			for (let bin = range.from; bin < range.to; bin++) {
				// Log compression keeps a quiet hat from being drowned by the kick.
				const magnitude = Math.log1p(10 * Math.hypot(re[bin], im[bin]) / frameSize * 8);
				const before = previous[index][bin - range.from];
				if (magnitude > before) rise += magnitude - before;
				previous[index][bin - range.from] = magnitude;
				energy += magnitude * magnitude;
			}
			magnitudes[index][frame] = Math.sqrt(energy / (range.to - range.from));
			flux[index][frame] = rise / (range.to - range.from);
		});
	}

	const framesPerSecond = sampleRate / hopSize;
	const onsets: AudioOnset[] = [];
	const combined = new Float64Array(frames);
	ranges.forEach((range, index) => {
		const peaks = pickPeaks(flux[index], framesPerSecond, minGap, sensitivity);
		const top = peaks.reduce((max, peak) => Math.max(max, peak.value), 0) || 1;
		for (const peak of peaks) {
			// The window is centred on the frame, so the onset sits half a frame after the frame's first sample.
			onsets.push({ t: Math.round(((peak.frame * hopSize + frameSize / 2) / sampleRate) * 1000) / 1000, strength: Math.round((peak.value / top) * 1000) / 1000, band: range.id });
		}
		const maxFlux = flux[index].reduce((max, value) => Math.max(max, value), 0) || 1;
		for (let frame = 0; frame < frames; frame++) combined[frame] += flux[index][frame] / maxFlux;
	});
	onsets.sort((a, b) => a.t - b.t);

	const tempo = estimateTempo(combined, framesPerSecond);
	const normalised = (values: Float64Array) => {
		const top = values.reduce((max, value) => Math.max(max, value), 0) || 1;
		return Array.from(values, (value) => Math.round((value / top) * 1000) / 1000);
	};
	return {
		duration,
		bpm: tempo.bpm,
		bpmConfidence: Math.round(tempo.confidence * 1000) / 1000,
		onsets,
		energy: { hop: hopSize / sampleRate, low: normalised(magnitudes[0]), mid: normalised(magnitudes[1]), high: normalised(magnitudes[2]) }
	};
}
