// Scripts as modules: bundles a script's `.ts` file (and what it imports) into the body of a `codeBlock`.
import { dirname } from 'node:path';

/**
 * The code of a `codeBlock` made from the module at `entry`, whose default export is `defineScript((ctx) => handlers)` (or the handlers
 * themselves). Everything the module imports is bundled in, so a script can share the game's own tables and helpers instead of
 * carrying a pasted copy of them. `inject` gives names a value that is known only when the world is built (a hash of a file): they are
 * declared before the bundle as constants, and the script says `declare const AUDIO: ...` to type them.
 *
 * The result is plain JavaScript for the sandbox: it assumes `ctx`, and returns the handlers.
 */
/**
 * @param {string} entry the path of the script's module
 * @param {{ inject?: Record<string, unknown>, minify?: boolean }} [options]
 * @returns {Promise<string>}
 */
export async function bundleScript(entry, { inject = {}, minify = false } = {}) {
	const { build } = await import('vite');
	const result = await build({
		configFile: false,
		logLevel: 'silent',
		root: dirname(entry),
		build: {
			write: false,
			minify,
			target: 'es2022',
			lib: { entry, formats: ['iife'], name: '__kithinScript', fileName: 'script' },
			rollupOptions: { output: { exports: 'named' } }
		}
	});
	const built = /** @type {import('vite').Rollup.RollupOutput} */ (Array.isArray(result) ? result[0] : result);
	const output = built.output[0];
	const constants = Object.entries(inject).map(([name, value]) => `const ${name} = ${JSON.stringify(value)};\n`).join('');
	return `${constants}${output.code}\nconst __kithinEntry = __kithinScript.default;\nreturn typeof __kithinEntry === 'function' ? __kithinEntry(ctx) : __kithinEntry;\n`;
}
