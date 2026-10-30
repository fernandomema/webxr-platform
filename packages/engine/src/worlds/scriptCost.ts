import { parse } from 'acorn';

/**
 * What makes a script's `tick` (run every frame) expensive, found by reading its code: a script runs in a sandbox, and every read of the world
 * goes out of it and back, the slot or component copied across as it goes. `ctx.hierarchy.getSlot(id).components.find(...).field` is one trip
 * for the slot, one for its components and one for each component looked at; done for several slots, in a loop, every frame, it costs
 * milliseconds a frame on a headset (a jukebox spent 10 ms a frame on a Quest this way).
 *
 * The code that runs every frame is `tick` and every function of the script it calls (or hands on, as a callback), however deep. Each hint
 * points at a line of it. Only the source is read: what a branch skips most frames, or how often a function is really called, is not known, so
 * these are hints to look at, not errors.
 */
export interface ScriptCostHint {
	severity: 'warning' | 'info';
	/** 1-based, in the script's own code. */
	line: number;
	kind: 'slot-read' | 'components-walk' | 'world-scan' | 'math-call';
	/** Inside a loop (or a callback of forEach, map, find...), where it is done once per element. */
	inLoop: boolean;
	/** `tick` waits between runs (a timer counted with its `dt` that returns early), so this is done less often than every frame. */
	throttled: boolean;
	message: string;
}

const WEIGHT: Record<ScriptCostHint['kind'], number> = { 'slot-read': 1, 'components-walk': 1, 'world-scan': 2, 'math-call': 0.5 };
/** What a script's hints add up to, a loop counting three times: from `SCRIPT_COST_WARNING` on, the script as a whole is worth a warning. */
export function scriptCostScore(hints: ScriptCostHint[]): number {
	return hints.reduce((sum, hint) => sum + (WEIGHT[hint.kind] * (hint.inLoop ? 3 : 1)) / (hint.throttled ? 3 : 1), 0);
}

/**
 * Whether `tick` waits between runs: among its first statements a variable is counted with its `dt` (`wait -= dt`, `t += dt`) and an `if` on
 * that variable returns. Written any other way it is taken as running every frame.
 */
function waitsBetweenRuns(tick: Node): boolean {
	const params = tick.params as Node[] | undefined;
	const dt = params?.[0]?.type === 'Identifier' ? (params[0].name as string) : null;
	const body = tick.body as Node;
	if (!dt || body.type !== 'BlockStatement') return false;
	const statements = (body.body as Node[]).slice(0, 8);
	const mentions = (node: Node, name: string): boolean => (node.type === 'Identifier' && node.name === name) || children(node).some((child) => mentions(child, name));
	const returns = (node: Node): boolean => node.type === 'ReturnStatement' || (!FUNCTIONS.has(node.type) && children(node).some(returns));
	const timers = new Set<string>();
	for (const statement of statements) {
		const expression = statement.type === 'ExpressionStatement' ? (statement.expression as Node) : null;
		if (expression?.type === 'AssignmentExpression' && (expression.operator === '-=' || expression.operator === '+=') && isNode(expression.left) && mentions(expression.right as Node, dt)) {
			const name = dotted(expression.left);
			if (name) timers.add(name);
		}
		if (statement.type === 'IfStatement' && returns(statement.consequent as Node)) {
			const test = statement.test as Node;
			for (const timer of timers) if (mentions(test, timer.split('.').pop()!)) return true;
		}
	}
	return false;
}
export const SCRIPT_COST_WARNING = 6;

type Node = { type: string; start: number; end: number; loc?: { start: { line: number } } } & Record<string, unknown>;

/** Reads of the world that copy a slot (or a component) out of it. */
const SLOT_READS = new Set(['ctx.hierarchy.getSlot', 'ctx.hierarchy.getParent', 'ctx.self.getSlot', 'ctx.self.getComponent']);
/** Calls that look through many slots of the world. */
const WORLD_SCANS = new Set(['ctx.hierarchy.findByName', 'ctx.hierarchy.getChildren', 'ctx.world.findNear']);
/** Array methods whose callback runs once per element: a loop. */
const ITERATORS = new Set(['forEach', 'map', 'filter', 'find', 'findIndex', 'some', 'every', 'reduce', 'flatMap']);
const LOOPS = new Set(['ForStatement', 'ForOfStatement', 'ForInStatement', 'WhileStatement', 'DoWhileStatement']);
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

const isNode = (value: unknown): value is Node => !!value && typeof value === 'object' && typeof (value as Node).type === 'string';

function children(node: Node): Node[] {
	const out: Node[] = [];
	for (const key of Object.keys(node)) {
		if (key === 'loc') continue;
		const value = node[key];
		if (Array.isArray(value)) for (const item of value) { if (isNode(item)) out.push(item); }
		else if (isNode(value)) out.push(value);
	}
	return out;
}

/** `ctx.hierarchy.getSlot` for that callee, or null when it is not a plain chain of names. */
function dotted(node: Node): string | null {
	if (node.type === 'Identifier') return node.name as string;
	if (node.type === 'MemberExpression' && !node.computed && isNode(node.property) && node.property.type === 'Identifier') {
		const object = isNode(node.object) ? dotted(node.object) : null;
		return object ? `${object}.${node.property.name as string}` : null;
	}
	return null;
}

const propertyName = (node: Node): string | null => {
	const key = node.key;
	if (!isNode(key)) return null;
	if (key.type === 'Identifier') return key.name as string;
	if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
	return null;
};

export function scriptCostHints(code: string): ScriptCostHint[] {
	let program: Node;
	try {
		// Wrapped the way the engine runs it: the body of a function of `ctx`. The wrapper's line is taken off every line below.
		program = parse(`(function (ctx) {\n${code}\n})`, { ecmaVersion: 'latest', locations: true }) as unknown as Node;
	} catch {
		return []; // a syntax error is reported by the syntax check
	}
	const lineOf = (node: Node) => (node.loc?.start.line ?? 2) - 1;

	// The script's named functions (declarations and functions kept in a variable), and the handler run every frame.
	const named = new Map<string, Node>();
	const found: { tick: Node | null } = { tick: null };
	const collect = (node: Node) => {
		if (node.type === 'FunctionDeclaration' && isNode(node.id)) named.set(node.id.name as string, node);
		else if (node.type === 'VariableDeclarator' && isNode(node.id) && node.id.type === 'Identifier' && isNode(node.init) && FUNCTIONS.has(node.init.type)) named.set(node.id.name as string, node.init);
		else if (node.type === 'Property' && propertyName(node) === 'tick' && isNode(node.value) && FUNCTIONS.has(node.value.type)) found.tick = node.value;
		for (const child of children(node)) collect(child);
	};
	collect(program);
	const tick = found.tick;
	if (!tick) return [];

	const hints = new Map<string, ScriptCostHint>();
	// One read on its own is a hint; the same in a loop, done once per element every frame, is a warning. In a tick that waits between runs, all are hints.
	const throttled = waitsBetweenRuns(tick);
	const add = (node: Node, kind: ScriptCostHint['kind'], inLoop: boolean, message: string) => {
		const line = lineOf(node);
		const key = `${line}:${kind}`;
		const severity = inLoop && kind !== 'math-call' && !throttled ? 'warning' : 'info';
		if (!hints.has(key)) hints.set(key, { severity, line, kind, inLoop, throttled, message: throttled ? message.replace('every frame', 'often (it waits between runs)') : message });
	};

	// Walks what runs every frame: tick, then each function it reaches. `via` names the function the code is in, for the message.
	const visited = new Set<Node>();
	const queue: Array<{ fn: Node; via: string | null }> = [{ fn: tick, via: null }];
	while (queue.length) {
		const { fn, via } = queue.shift()!;
		if (visited.has(fn)) continue;
		visited.add(fn);
		const where = via ? `in ${via}(), which tick runs every frame` : 'in tick, every frame';
		const walk = (node: Node, loop: boolean) => {
			if (node.type === 'Identifier' && named.has(node.name as string)) {
				const target = named.get(node.name as string)!;
				if (!visited.has(target)) queue.push({ fn: target, via: node.name as string });
			}
			if (node.type === 'CallExpression' && isNode(node.callee)) {
				const name = dotted(node.callee);
				const inLoop = loop ? ' inside a loop' : '';
				if (name && SLOT_READS.has(name)) {
					add(node, 'slot-read', loop, `${name}() ${where}${inLoop}: each call copies the slot out of the world. Read just the value with ctx.hierarchy.getField(id, type, field), keep what you read, or do it a few times a second.`);
				} else if (name && WORLD_SCANS.has(name)) {
					add(node, 'world-scan', loop, `${name}() ${where}${inLoop}: it looks through the world's slots each time. Find them once (in onSpawn) and keep their ids.`);
				} else if (name?.startsWith('ctx.math.') && loop) {
					add(node, 'math-call', loop, `${name}() ${where}${inLoop}: each call goes out of the script and back. Simple vector and quaternion maths is cheaper written in the script.`);
				}
				// A callback of forEach, map, find... runs once per element.
				const method = node.callee.type === 'MemberExpression' && isNode(node.callee.property) ? (node.callee.property.name as string | undefined) : undefined;
				if (method && ITERATORS.has(method)) {
					walk(node.callee, loop);
					for (const arg of (node.arguments as Node[]) ?? []) walk(arg, true);
					return;
				}
			}
			if (node.type === 'MemberExpression' && !node.computed && isNode(node.property) && node.property.name === 'components') {
				add(node, 'components-walk', loop, `.components ${where}${loop ? ' inside a loop' : ''}: reading a slot's components goes out of the script for the list and again for each one. ctx.hierarchy.getField(id, type, field) (or ctx.self.getField(type, field)) brings one value back in one go.`);
			}
			if (LOOPS.has(node.type)) {
				for (const child of children(node)) walk(child, true);
				return;
			}
			// A function written inline is walked where it is (a callback runs when it is called, usually here); a named one when it is reached.
			for (const child of children(node)) walk(child, loop);
		};
		walk(fn.body as Node, false);
	}
	return [...hints.values()].sort((a, b) => a.line - b.line);
}
