import { jsonSchema, tool, type ToolSet } from 'ai';
import { STUDIO_TOOLS, StudioDraft, isRemoteTool } from './tools';
import { describeToolCall, type ActivityItem } from './activity';

export interface AgentToolHooks {
	/** The draft for the current run. The agent syncs it with the open scene between steps. */
	draft: () => StudioDraft;
	/** Runs a remote tool (search/import/list assets) in the browser. */
	runRemote: (name: string, args: unknown, signal: AbortSignal) => Promise<unknown>;
	/** Records what a tool did for the activity card. */
	onActivity: (item: ActivityItem) => void;
	/** Applies the draft's changes to the open scene after a mutating tool. */
	onSceneChanged: () => void;
}

/**
 * The Studio tools as an AI SDK tool set. Executions are serialized through a queue: the SDK may run the tools of one step
 * concurrently, but the draft is a sequence of dependent mutations (temporary ids become aliases, validations see earlier
 * edits), so order must hold. Remote tools run in the browser, like the hand-rolled loop did.
 */
export function createAgentTools(hooks: AgentToolHooks, signal: AbortSignal): ToolSet {
	let queue: Promise<unknown> = Promise.resolve();
	const enqueue = <T>(run: () => Promise<T>): Promise<T> => {
		const next = queue.then(run, run);
		queue = next.then(() => undefined, () => undefined);
		return next;
	};
	const set: ToolSet = {};
	for (const definition of STUDIO_TOOLS) {
		set[definition.name] = tool({
			description: definition.description,
			inputSchema: jsonSchema(definition.parameters as Parameters<typeof jsonSchema>[0]),
			execute: (args) => enqueue(async () => {
				const name = definition.name;
				if (isRemoteTool(name)) return hooks.runRemote(name, args, signal);
				const draft = hooks.draft();
				const before = draft.tree;
				const result = draft.call(name, args).value;
				hooks.onActivity(describeToolCall(name, args, before, result));
				hooks.onSceneChanged();
				return result;
			})
		});
	}
	return set;
}
