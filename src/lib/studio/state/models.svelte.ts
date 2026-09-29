import { GlbError } from '$lib/assets/glb';
import { importGlbFile } from '$lib/assets/importGlb';
import type { AssetId } from '$lib/assets/ref';
import { getLocalAssetStore, type AssetListing } from '$lib/assets/store';
import { toasts } from './toasts.svelte';

/** The models imported on this device, as the Studio shows them. */
class StudioModels {
	items = $state<AssetListing[]>([]);
	loaded = $state(false);
	importing = $state(false);

	async refresh(): Promise<void> {
		try {
			this.items = (await getLocalAssetStore().list()).sort((a, b) => b.importedAt - a.importedAt);
		} catch (error) {
			toasts.error(error, 'Could not read the models on this device');
		} finally {
			this.loaded = true;
		}
	}

	byId(id: AssetId): AssetListing | undefined {
		return this.items.find((item) => item.assetId === id);
	}

	/** Imports each file independently; a bad file reports its own reason and never blocks the others. */
	async importFiles(files: Iterable<File>): Promise<AssetListing[]> {
		this.importing = true;
		const imported: AssetListing[] = [];
		try {
			for (const file of files) {
				if (!/\.glb$/i.test(file.name)) {
					toasts.push('error', `“${file.name}” is not a .glb file.`);
					continue;
				}
				try {
					const result = await importGlbFile(file, getLocalAssetStore());
					await this.refresh();
					const listing = this.byId(result.manifest.assetId);
					if (listing) imported.push(listing);
					toasts.success(result.alreadyStored ? `“${result.manifest.name}” was already imported.` : `Imported “${result.manifest.name}”.`);
				} catch (error) {
					toasts.push('error', error instanceof GlbError ? `“${file.name}”: ${error.message}` : `“${file.name}” could not be imported.`);
				}
			}
		} finally {
			this.importing = false;
		}
		return imported;
	}

	/** Opens the system file picker and imports what is chosen. */
	pickAndImport(): Promise<AssetListing[]> {
		return new Promise((resolve) => {
			const input = document.createElement('input');
			input.type = 'file';
			input.accept = '.glb,model/gltf-binary';
			input.multiple = true;
			input.onchange = () => void this.importFiles([...(input.files ?? [])]).then(resolve);
			input.oncancel = () => resolve([]);
			input.click();
		});
	}

	async remove(id: AssetId): Promise<void> {
		try {
			await getLocalAssetStore().delete(id);
			await this.refresh();
		} catch (error) {
			toasts.error(error, 'Could not remove the model');
		}
	}
}

export const studioModels = new StudioModels();

export function formatBytes(bytes: number): string {
	return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
