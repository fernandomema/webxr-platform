import { KhronosTextureContainer2 } from '@babylonjs/core';
import { assetUrl } from './platform/config.ts';

/**
 * KTX2 (Basis Universal) textures in glTF models decode with the copy of Babylon's decoder in /static/ktx2 instead of
 * Babylon's default of cdn.babylonjs.com: a headset on a LAN without a route to the internet would never get the decoder,
 * and the model would silently never appear (the same trap as the Draco decoder, see draco.ts). The URL must be absolute
 * because the decoder runs in a blob: worker, where relative paths do not resolve.
 */
export function configureKtx2(): void {
	if (typeof location === 'undefined') return;
	KhronosTextureContainer2.URLConfig = {
		...KhronosTextureContainer2.URLConfig,
		jsDecoderModule: new URL(assetUrl('/ktx2/babylon.ktx2Decoder.js'), location.href).href
	};
}
