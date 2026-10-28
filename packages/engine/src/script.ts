import type { CodeBlockCtx, CodeBlockHandlers } from './xr/codeBlockRuntime.ts';

/**
 * Scripts as real modules. A script is a `.ts` file whose default export is `defineScript((ctx) => handlers)`: it is type-checked like any
 * other code (`kithin-game check`), imports what it likes from the game's own modules, and is bundled into the body of a `codeBlock` when
 * the world is built (`bundleScript` in `@kithin/game/script-bundle`).
 *
 * ```ts
 * import { defineScript } from '@kithin/engine/script';
 * export default defineScript((ctx) => ({
 *   onSpawn() { ctx.log('hello'); },
 *   tick(dt) { ... }
 * }));
 * ```
 */
export type ScriptContext = CodeBlockCtx;

/** What a script returns: the handlers the engine calls (`onSpawn`, `tick`, `onUIEvent`...) and, if it likes, anything else (a test can read it back). */
export type ScriptHandlers = CodeBlockHandlers & { [extra: string]: unknown };

export type Script = (ctx: ScriptContext) => ScriptHandlers;

/** Declares a script, so that `ctx` and the handlers are typed. */
export function defineScript(script: Script): Script {
	return script;
}
