/**
 * Makes an audio file lighter without changing how it sounds: 16 bits, nothing above 44.1 kHz, and one channel when both are the
 * same. It writes WAV, so it only helps WAV files (an MP3 or OGG is already smaller than any WAV; the caller keeps the original
 * when the result is not smaller). Lossy re-encoding (MP3, Opus) would shrink those too; it needs an encoder this app does not ship.
 */
export interface AudioShape { channels: number; sampleRate: number; /** Energy of the difference between the two channels over the energy of their sum: 0 when they are the same. */ sideRatio: number }

const MAX_RATE = 44_100;
/** Below this the two channels are the same for any ear. */
const SAME_CHANNELS = 0.0005;

export function planAudio(shape: AudioShape): { channels: 1 | 2; sampleRate: number } {
	const mono = shape.channels === 1 || (shape.channels >= 2 && shape.sideRatio < SAME_CHANNELS);
	return { channels: mono ? 1 : 2, sampleRate: Math.min(shape.sampleRate, MAX_RATE) };
}

/** How different the two channels are (0 = identical), from their samples. */
export function sideRatio(left: Float32Array, right: Float32Array): number {
	let side = 0;
	let mid = 0;
	const length = Math.min(left.length, right.length);
	for (let i = 0; i < length; i++) {
		const sum = left[i] + right[i];
		const difference = left[i] - right[i];
		mid += sum * sum;
		side += difference * difference;
	}
	return mid === 0 ? (side === 0 ? 0 : Infinity) : side / mid;
}

/** 16-bit PCM WAV from one or two channels of samples (-1 to 1). */
export function encodeWav16(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
	const count = channels.length;
	const frames = channels[0].length;
	const dataBytes = frames * count * 2;
	const out = new Uint8Array(44 + dataBytes);
	const view = new DataView(out.buffer);
	const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) out[offset + i] = value.charCodeAt(i); };
	text(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); text(8, 'WAVE');
	text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, count, true);
	view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * count * 2, true); view.setUint16(32, count * 2, true); view.setUint16(34, 16, true);
	text(36, 'data'); view.setUint32(40, dataBytes, true);
	let offset = 44;
	for (let i = 0; i < frames; i++) {
		for (let c = 0; c < count; c++) {
			const sample = Math.max(-1, Math.min(1, channels[c][i]));
			view.setInt16(offset, sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff), true);
			offset += 2;
		}
	}
	return out;
}

/** Runs in the browser: decodes, applies the plan and writes the WAV. */
export async function optimizeAudio(source: Uint8Array): Promise<{ bytes: Uint8Array; mimeType: string; format: 'wav' }> {
	const context = new AudioContext();
	let decoded: AudioBuffer;
	try { decoded = await context.decodeAudioData(source.slice().buffer); } finally { void context.close(); }
	const left = decoded.getChannelData(0);
	const right = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : left;
	const plan = planAudio({ channels: decoded.numberOfChannels, sampleRate: decoded.sampleRate, sideRatio: decoded.numberOfChannels > 1 ? sideRatio(left, right) : 0 });
	let channels: Float32Array[] = plan.channels === 1 ? [left] : [left, right];
	if (plan.sampleRate !== decoded.sampleRate) {
		const offline = new OfflineAudioContext(plan.channels, Math.ceil(decoded.duration * plan.sampleRate), plan.sampleRate);
		const node = offline.createBufferSource();
		node.buffer = decoded;
		node.connect(offline.destination);
		node.start();
		const rendered = await offline.startRendering();
		channels = Array.from({ length: plan.channels }, (_, index) => rendered.getChannelData(index));
	}
	return { bytes: encodeWav16(channels, plan.sampleRate), mimeType: 'audio/wav', format: 'wav' };
}
