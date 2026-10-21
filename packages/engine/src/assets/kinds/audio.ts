import type { AudioManifest } from '../manifest.ts';
import { AssetImportError, type AssetKindDef } from './types.ts';

const MAX_BYTES = 20 * 1024 * 1024;

const ascii = (bytes: Uint8Array, at: number, text: string) => {
	if (at + text.length > bytes.byteLength) return false;
	for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
	return true;
};

// --- MP3 ----------------------------------------------------------------------

const MPEG1_L3_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_L3_KBPS = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Bytes taken by a leading ID3v2 tag, which is metadata and not audio. */
function id3Length(bytes: Uint8Array): number {
	if (!ascii(bytes, 0, 'ID3') || bytes.byteLength < 10) return 0;
	const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
	return 10 + size + (bytes[5] & 0x10 ? 10 : 0);
}

function isMp3Sync(bytes: Uint8Array, at: number): boolean {
	return at + 1 < bytes.byteLength && bytes[at] === 0xff && (bytes[at + 1] & 0xe0) === 0xe0 && ((bytes[at + 1] >> 1) & 3) !== 0 && ((bytes[at + 1] >> 3) & 3) !== 1;
}

function analyzeMp3(bytes: Uint8Array) {
	const start = id3Length(bytes);
	let at = start;
	const limit = Math.min(bytes.byteLength - 4, start + 64 * 1024);
	while (at < limit && !isMp3Sync(bytes, at)) at++;
	if (at >= limit) throw new AssetImportError('not-audio', 'No audio frames were found in this MP3.');
	const version = (bytes[at + 1] >> 3) & 3;
	const layer = (bytes[at + 1] >> 1) & 3;
	if (layer !== 1) throw new AssetImportError('unsupported-layer', 'Only MPEG Layer III (.mp3) audio is supported.');
	const kbps = (version === 3 ? MPEG1_L3_KBPS : MPEG2_L3_KBPS)[bytes[at + 2] >> 4];
	const sampleRate = SAMPLE_RATES[version]?.[(bytes[at + 2] >> 2) & 3];
	if (!kbps || !sampleRate) throw new AssetImportError('not-audio', 'This MP3 has an unreadable header.');
	return { channels: bytes[at + 3] >> 6 === 3 ? 1 : 2, sampleRate, duration: ((bytes.byteLength - at) * 8) / (kbps * 1000) };
}

// --- WAV ----------------------------------------------------------------------

function analyzeWav(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let channels = 0;
	let sampleRate = 0;
	let byteRate = 0;
	let dataBytes = -1;
	let offset = 12;
	while (offset + 8 <= bytes.byteLength) {
		const length = view.getUint32(offset + 4, true);
		if (ascii(bytes, offset, 'fmt ') && length >= 16 && offset + 24 <= bytes.byteLength) {
			const tag = view.getUint16(offset + 8, true);
			if (tag !== 1 && tag !== 3 && tag !== 0xfffe) throw new AssetImportError('unsupported-codec', 'Only PCM or float .wav files are supported.');
			channels = view.getUint16(offset + 10, true);
			sampleRate = view.getUint32(offset + 12, true);
			byteRate = view.getUint32(offset + 16, true);
		} else if (ascii(bytes, offset, 'data')) {
			dataBytes = Math.min(length, bytes.byteLength - offset - 8);
			break;
		}
		offset += 8 + length + (length & 1);
	}
	if (!channels || !sampleRate || !byteRate || dataBytes < 0) throw new AssetImportError('not-audio', 'This .wav file is incomplete.');
	return { channels, sampleRate, duration: dataBytes / byteRate };
}

// --- Ogg (Vorbis / Opus) ------------------------------------------------------

function analyzeOgg(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	// The first page carries the identification header after 27 header bytes and the segment table.
	const segments = bytes[26] ?? 0;
	const body = 27 + segments;
	let channels = 0;
	let sampleRate = 0;
	let preSkip = 0;
	if (ascii(bytes, body, '\x01vorbis') && body + 16 <= bytes.byteLength) {
		channels = bytes[body + 11];
		sampleRate = view.getUint32(body + 12, true);
	} else if (ascii(bytes, body, 'OpusHead') && body + 12 <= bytes.byteLength) {
		channels = bytes[body + 9];
		preSkip = view.getUint16(body + 10, true);
		sampleRate = 48000; // Opus always decodes at 48 kHz
	} else {
		throw new AssetImportError('unsupported-codec', 'Only Vorbis or Opus .ogg files are supported.');
	}
	if (!channels || !sampleRate) throw new AssetImportError('not-audio', 'This .ogg file has an unreadable header.');
	// The last page's granule position is the total sample count.
	let last = -1;
	for (let at = bytes.byteLength - 14; at >= Math.max(0, bytes.byteLength - 70_000); at--) {
		if (ascii(bytes, at, 'OggS')) {
			last = at;
			break;
		}
	}
	if (last < 0) throw new AssetImportError('not-audio', 'This .ogg file is truncated.');
	const granule = Number(view.getBigUint64(last + 6, true));
	if (!Number.isFinite(granule) || granule <= 0) throw new AssetImportError('not-audio', 'This .ogg file is truncated.');
	return { channels, sampleRate, duration: Math.max(0, granule - preSkip) / sampleRate };
}

export const audioKind: AssetKindDef<AudioManifest> = {
	type: 'audio',
	label: 'Audio',
	defaultName: 'Audio',
	formats: [
		{ format: 'mp3', extensions: ['.mp3'], mimeType: 'audio/mpeg' },
		{ format: 'wav', extensions: ['.wav'], mimeType: 'audio/wav' },
		{ format: 'ogg', extensions: ['.ogg', '.oga'], mimeType: 'audio/ogg' }
	],
	maxBytes: MAX_BYTES,
	headBytes: 12,
	sniff(head) {
		if (ascii(head, 0, 'RIFF') && ascii(head, 8, 'WAVE')) return 'wav';
		if (ascii(head, 0, 'OggS')) return 'ogg';
		if (ascii(head, 0, 'ID3') || isMp3Sync(head, 0)) return 'mp3';
		return null;
	},
	analyze(bytes, _fileName) {
		if (bytes.byteLength > MAX_BYTES) {
			throw new AssetImportError('too-large', `The audio is ${(bytes.byteLength / 1048576).toFixed(1)} MB; the limit is ${(MAX_BYTES / 1048576).toFixed(0)} MB.`);
		}
		const format = audioKind.sniff(bytes) as AudioManifest['format'] | null;
		if (!format) throw new AssetImportError('not-audio', 'This is not a supported audio file (.mp3, .wav or .ogg).');
		const info = format === 'wav' ? analyzeWav(bytes) : format === 'ogg' ? analyzeOgg(bytes) : analyzeMp3(bytes);
		return { format, ...info };
	},
	validate(m) {
		if (!Number.isFinite(m.duration) || (m.duration as number) < 0) throw new Error('Invalid audio duration');
		if (!Number.isInteger(m.channels) || (m.channels as number) < 1 || (m.channels as number) > 8) throw new Error('Invalid audio channels');
		if (!Number.isInteger(m.sampleRate) || (m.sampleRate as number) < 4000 || (m.sampleRate as number) > 192_000) throw new Error('Invalid audio sample rate');
	},
	summary: (m) => ({ duration: m.duration })
};
