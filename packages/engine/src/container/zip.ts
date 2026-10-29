/**
 * A small ZIP reader and writer (PKWARE APPNOTE 6.3, no ZIP64, no encryption), enough for Kithin's own container files
 * (`container/kithinFile.ts`). Entries are stored or deflated with the platform's `CompressionStream`, so there is no dependency
 * and the same code runs in a browser and in Node. Anything that opens a ZIP can open a container.
 *
 * Reading never trusts the archive: sizes are capped, every entry is checked against its CRC-32 and declared size, and a
 * compressed entry is stopped as soon as it inflates past what it declared.
 */

export class ZipError extends Error {
	constructor(
		readonly code: string,
		message: string
	) {
		super(message);
		this.name = 'ZipError';
	}
}

export interface ZipEntryInput {
	/** Forward slashes, no leading slash, no `..`. */
	path: string;
	data: Uint8Array;
	/** Deflate this entry. Worth it for text and uncompressed model data; pointless for MP3, PNG and the like. */
	compress?: boolean;
}

export interface ZipReadLimits {
	maxEntries: number;
	/** Largest single entry once inflated. */
	maxEntryBytes: number;
	/** All entries together once inflated. */
	maxTotalBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipReadLimits = { maxEntries: 1024, maxEntryBytes: 64 * 1024 * 1024, maxTotalBytes: 512 * 1024 * 1024 };

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const UTF8_FLAG = 0x0800;
/** 1980-01-01 00:00: a fixed time keeps an export of the same content byte for byte identical. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

let crcTable: Uint32Array | null = null;

export function crc32(bytes: Uint8Array): number {
	if (!crcTable) {
		crcTable = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			crcTable[n] = c >>> 0;
		}
	}
	let crc = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

async function pump(input: Uint8Array, stream: CompressionStream | DecompressionStream, maxBytes: number): Promise<Uint8Array> {
	const writer = stream.writable.getWriter();
	// Errors on the write side surface on the read side, so the write is not awaited on its own.
	void writer.write(input as Uint8Array<ArrayBuffer>).then(() => writer.close()).catch(() => {});
	const reader = stream.readable.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) throw new ZipError('too-large', 'An entry is larger than it says it is');
			chunks.push(value);
		}
	} catch (error) {
		await reader.cancel().catch(() => {});
		if (error instanceof ZipError) throw error;
		throw new ZipError('corrupt', 'An entry could not be inflated');
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

const deflate = (bytes: Uint8Array) => pump(bytes, new CompressionStream('deflate-raw'), Number.MAX_SAFE_INTEGER);
const inflate = (bytes: Uint8Array, maxBytes: number) => pump(bytes, new DecompressionStream('deflate-raw'), maxBytes);

export function isSafeZipPath(path: string): boolean {
	return path.length > 0 && path.length <= 240 && !path.startsWith('/') && !path.includes('\\') && !path.includes('\0') && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

export async function writeZip(entries: readonly ZipEntryInput[]): Promise<Uint8Array> {
	if (entries.length > 0xffff) throw new ZipError('too-many-entries', 'Too many entries for a ZIP');
	const encoder = new TextEncoder();
	const seen = new Set<string>();
	const parts: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;
	for (const entry of entries) {
		if (!isSafeZipPath(entry.path) || seen.has(entry.path)) throw new ZipError('bad-path', `Invalid or repeated entry name: ${entry.path}`);
		seen.add(entry.path);
		const name = encoder.encode(entry.path);
		const crc = crc32(entry.data);
		let body = entry.data;
		let method = 0;
		if (entry.compress && entry.data.byteLength > 64) {
			const packed = await deflate(entry.data);
			if (packed.byteLength < entry.data.byteLength) {
				body = packed;
				method = 8;
			}
		}
		if (entry.data.byteLength >= 0xffffffff || offset + body.byteLength >= 0xffffffff) throw new ZipError('too-large', 'The archive would be larger than 4 GB');

		const local = new Uint8Array(30 + name.length);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, LOCAL_SIGNATURE, true);
		lv.setUint16(4, 20, true);
		lv.setUint16(6, UTF8_FLAG, true);
		lv.setUint16(8, method, true);
		lv.setUint16(10, DOS_TIME, true);
		lv.setUint16(12, DOS_DATE, true);
		lv.setUint32(14, crc, true);
		lv.setUint32(18, body.byteLength, true);
		lv.setUint32(22, entry.data.byteLength, true);
		lv.setUint16(26, name.length, true);
		local.set(name, 30);

		const head = new Uint8Array(46 + name.length);
		const hv = new DataView(head.buffer);
		hv.setUint32(0, CENTRAL_SIGNATURE, true);
		hv.setUint16(4, 20, true);
		hv.setUint16(6, 20, true);
		hv.setUint16(8, UTF8_FLAG, true);
		hv.setUint16(10, method, true);
		hv.setUint16(12, DOS_TIME, true);
		hv.setUint16(14, DOS_DATE, true);
		hv.setUint32(16, crc, true);
		hv.setUint32(20, body.byteLength, true);
		hv.setUint32(24, entry.data.byteLength, true);
		hv.setUint16(28, name.length, true);
		hv.setUint32(42, offset, true);
		head.set(name, 46);

		parts.push(local, body);
		central.push(head);
		offset += local.byteLength + body.byteLength;
	}
	const centralSize = central.reduce((sum, part) => sum + part.byteLength, 0);
	const end = new Uint8Array(22);
	const ev = new DataView(end.buffer);
	ev.setUint32(0, END_SIGNATURE, true);
	ev.setUint16(8, entries.length, true);
	ev.setUint16(10, entries.length, true);
	ev.setUint32(12, centralSize, true);
	ev.setUint32(16, offset, true);

	const all = [...parts, ...central, end];
	const out = new Uint8Array(all.reduce((sum, part) => sum + part.byteLength, 0));
	let at = 0;
	for (const part of all) {
		out.set(part, at);
		at += part.byteLength;
	}
	return out;
}

/** Whether the bytes begin like a ZIP file (a local file header, or an empty archive). */
export function looksLikeZip(bytes: Uint8Array): boolean {
	return bytes.byteLength >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5) && (bytes[3] === 4 || bytes[3] === 6);
}

export interface ZipDirectoryEntry {
	path: string;
	method: number;
	crc: number;
	compressedSize: number;
	size: number;
	offset: number;
}

/** Lists the entries without inflating any of them. */
export function readZipDirectory(bytes: Uint8Array, limits: ZipReadLimits = DEFAULT_ZIP_LIMITS): ZipDirectoryEntry[] {
	if (!looksLikeZip(bytes)) throw new ZipError('not-a-zip', 'This is not a Kithin file');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let end = -1;
	for (let at = bytes.byteLength - 22; at >= Math.max(0, bytes.byteLength - 22 - 0xffff); at--) {
		if (view.getUint32(at, true) === END_SIGNATURE) {
			end = at;
			break;
		}
	}
	if (end < 0) throw new ZipError('corrupt', 'The file is truncated or damaged');
	const count = view.getUint16(end + 10, true);
	const centralSize = view.getUint32(end + 12, true);
	const centralOffset = view.getUint32(end + 16, true);
	if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new ZipError('unsupported', 'ZIP64 archives are not supported');
	if (count > limits.maxEntries) throw new ZipError('too-many-entries', 'The file contains too many entries');
	if (centralOffset + centralSize > end) throw new ZipError('corrupt', 'The file is truncated or damaged');

	const decoder = new TextDecoder('utf-8', { fatal: true });
	const entries: ZipDirectoryEntry[] = [];
	const seen = new Set<string>();
	let total = 0;
	let at = centralOffset;
	for (let i = 0; i < count; i++) {
		if (at + 46 > end || view.getUint32(at, true) !== CENTRAL_SIGNATURE) throw new ZipError('corrupt', 'The file is truncated or damaged');
		const flags = view.getUint16(at + 8, true);
		const nameLength = view.getUint16(at + 28, true);
		const extraLength = view.getUint16(at + 30, true);
		const commentLength = view.getUint16(at + 32, true);
		if (flags & 1) throw new ZipError('unsupported', 'Encrypted archives are not supported');
		let path: string;
		try {
			path = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
		} catch {
			throw new ZipError('bad-path', 'An entry has an invalid name');
		}
		const entry: ZipDirectoryEntry = {
			path,
			method: view.getUint16(at + 10, true),
			crc: view.getUint32(at + 16, true),
			compressedSize: view.getUint32(at + 20, true),
			size: view.getUint32(at + 24, true),
			offset: view.getUint32(at + 42, true)
		};
		at += 46 + nameLength + extraLength + commentLength;
		if (path.endsWith('/')) continue; // a folder entry carries nothing
		if (!isSafeZipPath(path) || seen.has(path)) throw new ZipError('bad-path', 'An entry has an invalid or repeated name');
		seen.add(path);
		if (entry.method !== 0 && entry.method !== 8) throw new ZipError('unsupported', 'An entry uses an unsupported compression method');
		if (entry.size > limits.maxEntryBytes) throw new ZipError('too-large', 'An entry is too large');
		total += entry.size;
		if (total > limits.maxTotalBytes) throw new ZipError('too-large', 'The file is too large');
		entries.push(entry);
	}
	return entries;
}

/** Inflates and verifies one entry. */
export async function readZipEntry(bytes: Uint8Array, entry: ZipDirectoryEntry): Promise<Uint8Array> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (entry.offset + 30 > bytes.byteLength || view.getUint32(entry.offset, true) !== LOCAL_SIGNATURE) throw new ZipError('corrupt', 'The file is truncated or damaged');
	const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
	if (start + entry.compressedSize > bytes.byteLength) throw new ZipError('corrupt', 'The file is truncated or damaged');
	const body = bytes.subarray(start, start + entry.compressedSize);
	const data = entry.method === 0 ? body.slice() : await inflate(body, entry.size);
	if (data.byteLength !== entry.size || crc32(data) !== entry.crc) throw new ZipError('corrupt', `The entry ${entry.path} is damaged`);
	return data;
}
