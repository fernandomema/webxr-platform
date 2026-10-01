import { DracoCompression } from '@babylonjs/core';

/**
 * Draco-compressed glTF meshes are decoded with the copy of the decoder in /static/draco instead of
 * Babylon's default of cdn.babylonjs.com: a headset on a LAN without a route to the internet would never
 * get the decoder, and the model would silently never appear. The URLs must be absolute because the
 * decoder runs in a blob: worker, where relative paths do not resolve.
 */
export function configureDraco(): void {
	if (typeof location === 'undefined') return;
	DracoCompression.Configuration = {
		decoder: {
			wasmUrl: `${location.origin}/draco/draco_wasm_wrapper.js`,
			wasmBinaryUrl: `${location.origin}/draco/draco_decoder.wasm`,
			fallbackUrl: `${location.origin}/draco/draco_decoder.js`
		}
	};
}
