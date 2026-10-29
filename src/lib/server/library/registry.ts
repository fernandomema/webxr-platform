import { env } from '$env/dynamic/private';
import type { AssetSource } from '@kithin/engine/library/types';
import { createLibrary, type Library } from './service';
import { freeToUseSource } from './sources/freetouse';
import { grab3dSource } from './sources/grab3d';
import { lazytexturesSource } from './sources/lazytextures';
import { polyHavenSource } from './sources/polyhaven';
import { createShepSource } from './sources/shep';

/** Every source the app knows, as a way to build it from the environment and the other sources that are on. */
const KNOWN: Record<string, (others: string[]) => AssetSource> = {
	polyhaven: () => polyHavenSource,
	grab3d: () => grab3dSource,
	lazytextures: () => lazytexturesSource,
	// Music under its own license (credit; commercial use is paid), shown on every card. shep's audio is ZIP packs that can not be imported, so this is what Sounds lists.
	freetouse: () => freeToUseSource,
	// shep leaves out the providers that a direct source of ours already serves.
	shep: (others) => createShepSource({
		baseUrl: env.SHEP_API_URL, apiKey: env.SHEP_API_KEY,
		extraHosts: env.SHEP_CDN_HOSTS?.split(',').map((host) => host.trim()).filter(Boolean),
		exclude: others
	})
};

let current: { key: string; library: Library } | null = null;

/** `LIBRARY_SOURCES` (comma separated) turns sources on; Poly Haven, Grab3D, Lazytextures, Free To Use and shep are on by default. */
export function getLibrary(): Library {
	const key = env.LIBRARY_SOURCES?.trim() || 'polyhaven,grab3d,lazytextures,freetouse,shep';
	if (current?.key !== key) {
		const ids = key.split(',').map((id) => id.trim()).filter((id) => id in KNOWN);
		current = { key, library: createLibrary(ids.map((id) => KNOWN[id](ids.filter((other) => other !== id)))) };
	}
	return current.library;
}
