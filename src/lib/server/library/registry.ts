import { env } from '$env/dynamic/private';
import type { AssetSource } from '@kithin/engine/library/types';
import { createLibrary, type Library } from './service';
import { polyHavenSource } from './sources/polyhaven';
import { createShepSource } from './sources/shep';

/** Every source the app knows, as a way to build it from the environment and the other sources that are on. */
const KNOWN: Record<string, (others: string[]) => AssetSource> = {
	polyhaven: () => polyHavenSource,
	// shep leaves out the providers that a direct source of ours already serves.
	shep: (others) => createShepSource({
		baseUrl: env.SHEP_API_URL, apiKey: env.SHEP_API_KEY,
		extraHosts: env.SHEP_CDN_HOSTS?.split(',').map((host) => host.trim()).filter(Boolean),
		exclude: others
	})
};

let current: { key: string; library: Library } | null = null;

/** `LIBRARY_SOURCES` (comma separated) turns sources on; Poly Haven and shep are on by default. */
export function getLibrary(): Library {
	const key = env.LIBRARY_SOURCES?.trim() || 'polyhaven,shep';
	if (current?.key !== key) {
		const ids = key.split(',').map((id) => id.trim()).filter((id) => id in KNOWN);
		current = { key, library: createLibrary(ids.map((id) => KNOWN[id](ids.filter((other) => other !== id)))) };
	}
	return current.library;
}
