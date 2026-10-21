import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CANDIDATES = ['', '.ts', '.js', '.json', '/index.ts'];

/**
 * Tests that compile a module's source and load it from a `data:` URL cannot resolve its relative imports. This points every
 * relative specifier left in `code` at the real file it names (the way a bundler would), skipping the ones a test has already
 * replaced with something of its own. `fileUrl` is the URL of the module `code` was compiled from.
 */
export function resolveRelativeImports(code, fileUrl) {
	return code.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[^'"]+)\2/g, (whole, pre, quote, specifier) => {
		const base = fileURLToPath(new URL(specifier, fileUrl));
		for (const suffix of CANDIDATES) {
			if (existsSync(base + suffix) && !(suffix === '' && !/\.\w+$/.test(base))) return `${pre}${quote}${pathToFileURL(base + suffix).href}${quote}`;
		}
		return whole;
	});
}
