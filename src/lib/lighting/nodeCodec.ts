import { deflateRawSync, inflateRawSync } from 'node:zlib';
import type { Codec } from './format.ts';

/** Deflate for scripts and tests, with Node's zlib. Not imported by anything that runs in a browser. */
export const nodeCodec: Codec = {
	compress: (bytes) => new Uint8Array(deflateRawSync(bytes, { level: 9 })),
	decompress: (bytes) => new Uint8Array(inflateRawSync(bytes))
};
