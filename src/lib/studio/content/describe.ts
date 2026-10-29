import type { AssetManifest } from '@kithin/engine/assets/manifest';

export interface DescribedField {
	label: string;
	value: string;
}

/** Fields every manifest has, which the content manager already shows in its own rows. */
const COMMON = new Set(['assetId', 'type', 'format', 'mimeType', 'byteSize', 'name', 'importedAt', 'lastUsedAt', 'origin']);

const LABELS: Record<string, string> = { sampleRate: 'Sample rate', duration: 'Duration', voxel: 'Voxel size' };

const humanize = (key: string): string => LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase());
const round = (value: number): string => String(Math.round(value * 100) / 100);

function describeValue(key: string, value: unknown): string | null {
	if (typeof value === 'number') return key === 'duration' ? `${round(value)} s` : key === 'sampleRate' ? `${value} Hz` : key === 'voxel' ? `${round(value)} m` : value.toLocaleString();
	if (typeof value === 'string') return value;
	if (typeof value === 'boolean') return value ? 'Yes' : 'No';
	if (Array.isArray(value)) return value.every((entry) => typeof entry === 'number') ? value.map(round).join(' × ') : `${value.length} entries`;
	if (value && typeof value === 'object') {
		const { min, max, joints } = value as { min?: number[]; max?: number[]; joints?: unknown[] };
		if (Array.isArray(min) && Array.isArray(max)) return `${min.map((low, axis) => round(max[axis] - low)).join(' × ')} m`;
		if (Array.isArray(joints)) return `${joints.length} bones`;
	}
	return null;
}

/** The kind-specific facts of a manifest (triangles, duration, pixels, …) as label/value pairs, without each kind needing its own view. */
export function describeFields(manifest: AssetManifest): DescribedField[] {
	const fields: DescribedField[] = [];
	for (const [key, value] of Object.entries(manifest)) {
		if (COMMON.has(key)) continue;
		const text = describeValue(key, value);
		if (text !== null) fields.push({ label: key === 'bounds' ? 'Dimensions' : humanize(key), value: text });
	}
	return fields;
}

export const formatDate = (epochMs: number): string => new Date(epochMs).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

