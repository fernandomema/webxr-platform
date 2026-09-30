import type { IconName } from './Icon.svelte';

/** How the Studio names and draws each inventory storage, so no view has to guess from "is it the cloud". */
const ADAPTER_VIEW: Record<string, { label: string; icon: IconName }> = {
	local: { label: 'This device', icon: 'device' },
	cloud: { label: 'Cloud', icon: 'cloud' },
	purchased: { label: 'Marketplace', icon: 'cube' }
};

export const adapterLabel = (id: string, fallback = id): string => ADAPTER_VIEW[id]?.label ?? fallback;
export const adapterIcon = (id: string): IconName => ADAPTER_VIEW[id]?.icon ?? 'device';
