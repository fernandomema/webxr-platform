import { audioKind } from './audio.ts';
import { modelKind } from './model.ts';
import { registerAssetKind } from './registry.ts';

// To support a new kind of asset: write `kinds/<name>.ts`, add its manifest to
// `AssetManifest` in `../manifest.ts`, and register it here.
registerAssetKind(modelKind);
registerAssetKind(audioKind);

export * from './registry.ts';
export * from './types.ts';
