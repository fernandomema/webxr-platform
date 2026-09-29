export interface OpenRouterModel {
	id: string;
	name: string;
	free: boolean;
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function isFree(pricing: unknown): boolean {
	const values = record(pricing);
	if (!values || values.prompt === undefined || values.completion === undefined) return false;
	return Object.values(values).every((value) => {
		if (typeof value !== 'string' && typeof value !== 'number') return false;
		if (String(value).trim() === '') return false;
		return Number.isFinite(Number(value)) && Number(value) === 0;
	});
}

export function parseOpenRouterModels(payload: unknown): OpenRouterModel[] {
	const data = record(payload)?.data;
	if (!Array.isArray(data)) throw new Error('OpenRouter returned an invalid model catalogue.');
	const models: OpenRouterModel[] = [];
	const ids = new Set<string>();
	for (const entry of data) {
		const model = record(entry);
		if (!model || typeof model.id !== 'string' || !model.id || ids.has(model.id)) continue;
		if (!Array.isArray(model.supported_parameters) || !model.supported_parameters.includes('tools')) continue;
		const output = record(model.architecture)?.output_modalities;
		if (Array.isArray(output) && !output.includes('text')) continue;
		ids.add(model.id);
		models.push({
			id: model.id,
			name: typeof model.name === 'string' && model.name.trim() ? model.name : model.id,
			free: isFree(model.pricing)
		});
	}
	return models.sort((a, b) => Number(b.free) - Number(a.free) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
