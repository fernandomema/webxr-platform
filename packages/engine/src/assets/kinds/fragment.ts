import { FRAGMENT_FORMAT, FRAGMENT_LIMITS, FragmentError, fragmentAssets, parseFragment } from '../fragment.ts';
import type { FragmentManifest } from '../manifest.ts';
import { isAssetId } from '../ref.ts';
import { AssetImportError, type AssetKindDef } from './types.ts';

/** A scene fragment (see `assets/fragment.ts`): a map or a room as a file, built where a `fragment` component asks. */
export const fragmentKind: AssetKindDef<FragmentManifest> = {
	type: 'fragment',
	label: 'Fragments',
	defaultName: 'Scene fragment',
	formats: [{ format: 'kfrag', extensions: ['.kfrag', '.fragment.json'], mimeType: 'application/x-kithin-fragment+json' }],
	maxBytes: FRAGMENT_LIMITS.maxBytes,
	headBytes: 64,
	sniff(head) {
		// The writer puts the format first, so it is within the first bytes.
		return new TextDecoder().decode(head.subarray(0, 64)).replace(/\s/g, '').startsWith(`{"format":"${FRAGMENT_FORMAT}"`) ? 'kfrag' : null;
	},
	analyze(bytes) {
		try {
			const data = parseFragment(bytes);
			return { format: 'kfrag', slots: data.slots.length, assets: fragmentAssets(data) };
		} catch (error) {
			if (error instanceof FragmentError) throw new AssetImportError(`invalid-fragment-${error.code}`, error.message);
			throw error;
		}
	},
	validate(m) {
		if (!Number.isInteger(m.slots) || (m.slots as number) < 1 || (m.slots as number) > FRAGMENT_LIMITS.maxSlots) throw new Error('Invalid fragment size');
		if (!Array.isArray(m.assets) || m.assets.length > 128 || m.assets.some((id) => !isAssetId(id))) throw new Error('Invalid fragment assets');
	}
};
