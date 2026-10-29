import type { AssetKind } from '@kithin/engine/library/types';
import type { ImportResult } from '../library/importers';

export interface ExploreRequest {
	kind: AssetKind;
	title: string;
	/** The button that imports the chosen asset and closes the window. */
	actionLabel: string;
	/** A second button that takes it made lighter. Left out, there is none. */
	optimizedLabel?: string;
	resolve: (value: ImportResult | null) => void;
}

/**
 * Opens the online libraries in a window and gives back what the person imported from them. One window for the whole Studio: a field
 * that wants a material or a model asks for it with `await explore.pick(...)` and gets the imported asset, or null if they closed it.
 */
class Explore {
	request = $state<ExploreRequest | null>(null);

	pick(options: Omit<ExploreRequest, 'resolve'>): Promise<ImportResult | null> {
		// Asking again while a window is open closes the first with no answer.
		this.request?.resolve(null);
		return new Promise((resolve) => {
			this.request = { ...options, resolve };
		});
	}

	finish(value: ImportResult | null): void {
		const current = this.request;
		this.request = null;
		current?.resolve(value);
	}
}

export const explore = new Explore();
