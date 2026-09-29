import { Control, StackPanel, TextBlock } from '@babylonjs/gui';
import type { Component } from '$lib/ecs/types';
import type { SceneGraph } from '../../sceneGraph';
import { mountCodeBlockDebug } from './codeBlockDebug';

export interface ComponentDetailContext {
	slotId: string;
	sceneGraph: SceneGraph;
	/** The detail panel's scrollable content — append extra rows/sections here. */
	container: StackPanel;
	/** Registers a per-frame refresh for anything in this section that changes live (e.g. the codeBlock debug log). Call is a no-op once the detail panel is rebuilt/torn down. */
	onLiveRefresh(refresh: () => void): void;
}

export type ComponentDetailRenderer<T extends Component = Component> = (component: T, ctx: ComponentDetailContext) => void;

/**
 * Registry of extra detail sections keyed by component type — this is the
 * extension point for new component types: register a renderer once here
 * (or from any module loaded before the Inspector mounts) instead of adding
 * another branch to a growing if-chain in inspectorPanel.ts. A component
 * with no registered renderer still gets its plain badge in the Components
 * row; this only adds richer, type-specific detail below it.
 */
const renderers = new Map<Component['type'], ComponentDetailRenderer>();

export function registerComponentDetail<K extends Component['type']>(
	type: K,
	renderer: ComponentDetailRenderer<Extract<Component, { type: K }>>
): void {
	renderers.set(type, renderer as ComponentDetailRenderer);
}

export function getComponentDetailRenderer(type: Component['type']): ComponentDetailRenderer | undefined {
	return renderers.get(type);
}

function mediaSourceRenderer(component: Component, ctx: ComponentDetailContext): void {
	if (component.type !== 'videoPlayer' && component.type !== 'audioPlayer') return;
	const source = new TextBlock('', `Source: ${component.url || 'Not configured'}`);
	source.color = '#d1d5db';
	source.fontSize = 14;
	source.height = '32px';
	source.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	source.textWrapping = false;
	ctx.container.addControl(source);
}

registerComponentDetail('videoPlayer', mediaSourceRenderer);
registerComponentDetail('audioPlayer', mediaSourceRenderer);

registerComponentDetail('codeBlock', (_component, ctx) => {
	const { refresh } = mountCodeBlockDebug(ctx.container, ctx.sceneGraph, ctx.slotId);
	ctx.onLiveRefresh(refresh);
});
