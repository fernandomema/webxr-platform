import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Compiles the real code block runtime (and its sandbox) to data: modules, the way the other tests load .ts files that use
// extensionless imports, and loads the QuickJS engine once. `runtimeUrl` is what a test replaces './codeBlockRuntime' with.
const coreUrl = import.meta.resolve('@babylonjs/core');
const quickjsCoreUrl = import.meta.resolve('quickjs-emscripten-core');
const quickjsVariantUrl = import.meta.resolve('@jitl/quickjs-wasmfile-release-sync');
const libUrl = new URL('../../src/lib/', import.meta.url);
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
	.replaceAll("'@babylonjs/core'", JSON.stringify(coreUrl))
	.replaceAll("'quickjs-emscripten-core'", JSON.stringify(quickjsCoreUrl))
	.replaceAll("'@jitl/quickjs-wasmfile-release-sync'", JSON.stringify(quickjsVariantUrl))
	.replace(/'\$lib\/([^']+)'/g, (_, path) => JSON.stringify(new URL(`${path}.ts`, libUrl).href));
const moduleUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const read = (path) => readFile(new URL(path, libUrl), 'utf8');

const preludeUrl = moduleUrl(compile(await read('xr/sandbox/prelude.ts')));
export const sandboxUrl = moduleUrl(compile(await read('xr/sandbox/codeBlockVm.ts')).replaceAll("'./prelude'", JSON.stringify(preludeUrl)));
export const runtimeUrl = moduleUrl(compile(await read('xr/codeBlockRuntime.ts'))
	.replaceAll("'./scriptNet'", JSON.stringify(new URL('xr/scriptNet.ts', libUrl).href))
	.replaceAll("'./sandbox/codeBlockVm'", JSON.stringify(sandboxUrl)));

export const sandbox = await import(sandboxUrl);
await sandbox.initCodeBlockSandbox();
export const { createCodeBlockHandlers, buildCodeBlockCtx } = await import(runtimeUrl);
