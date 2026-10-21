import { DracoCompression } from '@babylonjs/core';
import { assetUrl } from './platform/config.ts';

/**
 * Draco-compressed glTF meshes are decoded with the copy of the decoder in /static/draco instead of
 * Babylon's default of cdn.babylonjs.com: a headset on a LAN without a route to the internet would never
 * get the decoder, and the model would silently never appear. The URLs must be absolute because the
 * decoder runs in a blob: worker, where relative paths do not resolve.
 */
export function configureDraco(): void {
	if (typeof location === 'undefined') return;
	const absolute = (path: string) => new URL(assetUrl(path), location.href).href;
	DracoCompression.Configuration = {
		decoder: {
			wasmUrl: absolute('/draco/draco_wasm_wrapper.js'),
			wasmBinaryUrl: absolute('/draco/draco_decoder.wasm'),
			fallbackUrl: absolute('/draco/draco_decoder.js')
		}
	};
}
