import type { AssetId } from '$lib/assets/ref';
import { thumbnailUrl } from '$lib/assets/thumbnails';
import { copyScene } from '$lib/worlds/package';
import { captureItemThumbnail } from '$lib/xr/thumbnail/capture';
import type { BuiltinWorld } from '$lib/xr/templates/builtinWorlds';

// --- Previews of the official worlds -------------------------------------------------------------------------------
// They ship with the app as static pictures (src/lib/worlds/previews/<id>.webp, and <id>-stereo.webp), so opening the Worlds
// tab never loads a world's models just to draw its picture. Only a development build draws a missing one on the device
// (kept in the local asset store, remembered by the content of its scene); `exportBuiltinPreviews()` downloads those
// pictures so they can be dropped into src/lib/worlds/previews/.

const builtinPreviews = new Map<string, Promise<string | null>>();
const builtinStereoPreviews = new Map<string, Promise<string | null>>();

let builtinQueue: Promise<unknown> = Promise.resolve();

/** The pictures that ship with the app, by file name; bundled, so looking one up never touches the network. */
const SHIPPED = import.meta.glob('./previews/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

function shippedPreview(id: string, kind: 'mono' | 'stereo'): Promise<string | null> {
	return Promise.resolve(SHIPPED[`./previews/${id}${kind === 'stereo' ? '-stereo' : ''}.webp`] ?? null);
}

function sceneHash(scene: unknown): string {
	const text = JSON.stringify(scene);
	let hash = 5381;
	for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
	return `${(hash >>> 0).toString(36)}-${text.length.toString(36)}`;
}

function storageGet(key: string): string | null {
	try { return localStorage.getItem(key); } catch { return null; }
}

function storageSet(key: string, value: string): void {
	try { localStorage.setItem(key, value); } catch { /* the preview is simply drawn again next time */ }
}

/** Draws a preview once, remembering it by the content of the scene; `kind` is part of the key so the two kinds of picture never mix. */
function cachedPreview(cache: Map<string, Promise<string | null>>, kind: 'mono' | 'stereo', world: BuiltinWorld): Promise<string | null> {
	let job = cache.get(world.id);
	if (!job) {
		job = (async () => {
			const shipped = await shippedPreview(world.id, kind);
			if (shipped) return shipped;
			if (!import.meta.env.DEV) return null; // never drawn at runtime in a release
			const key = `kithin.worldPreview.v3.${kind}.${world.id}.${sceneHash(world.scene)}`;
			const known = storageGet(key) as AssetId | null;
			if (known && (await thumbnailUrl(known))) return known;
			// One at a time: each picture is six renders (twelve for a stereo one) of a whole world.
			const run = builtinQueue.then(() => captureItemThumbnail(copyScene(world.scene), 'world', { name: world.name, stereo: kind === 'stereo' }));
			builtinQueue = run.catch(() => undefined);
			const made = await run;
			if (made) storageSet(key, made);
			else cache.delete(world.id); // try again the next time the tab is opened
			return made;
		})();
		cache.set(world.id, job);
	}
	return job;
}

/** The 360° preview of an official world, taken from where a player starts and facing the way they face. */
export const builtinPreview = (world: BuiltinWorld): Promise<string | null> => cachedPreview(builtinPreviews, 'mono', world);

/**
 * The same preview in 3D: the left eye's picture above the right eye's. Only for showing in a headset (it is taller than a
 * normal preview and takes longer to draw), so it is made when asked for.
 */
export const builtinStereoPreview = (world: BuiltinWorld): Promise<string | null> => cachedPreview(builtinStereoPreviews, 'stereo', world);

/** Development only: downloads the pictures of every official world, named as src/lib/worlds/previews/ expects them. */
export async function exportBuiltinPreviews(worlds: readonly BuiltinWorld[], stereo = true): Promise<void> {
	for (const world of worlds) {
		for (const kind of stereo ? (['mono', 'stereo'] as const) : (['mono'] as const)) {
			const name = `${world.id}${kind === 'stereo' ? '-stereo' : ''}.webp`;
			const ref = await cachedPreview(kind === 'mono' ? builtinPreviews : builtinStereoPreviews, kind, world);
			const url = ref ? (ref.startsWith('sha256:') ? await thumbnailUrl(ref as AssetId) : ref) : null;
			if (!url) { console.warn(`[previews] could not draw ${name}`); continue; }
			const link = document.createElement('a');
			link.href = url;
			link.download = name;
			document.body.appendChild(link);
			link.click();
			link.remove();
			console.info(`[previews] downloaded ${name}`);
			await new Promise((resolve) => setTimeout(resolve, 400)); // browsers drop downloads that come all at once
		}
	}
}
