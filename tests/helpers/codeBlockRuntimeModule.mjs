import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { resolveRelativeImports } from './resolveSpecifiers.mjs';

// Compiles the real code block runtime (and its sandbox) to data: modules, the way the other tests load .ts files that use
// extensionless imports, and loads the QuickJS engine once. `runtimeUrl` is what a test replaces './codeBlockRuntime' with.
const coreUrl = import.meta.resolve('@babylonjs/core');
const quickjsCoreUrl = import.meta.resolve('quickjs-emscripten-core');
const quickjsVariantUrl = import.meta.resolve('@jitl/quickjs-wasmfile-release-sync');
const libUrl = new URL('../../packages/engine/src/', import.meta.url);
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
	.replaceAll("'@babylonjs/core'", JSON.stringify(coreUrl))
	.replaceAll("'quickjs-emscripten-core'", JSON.stringify(quickjsCoreUrl))
	.replaceAll("'@jitl/quickjs-wasmfile-release-sync'", JSON.stringify(quickjsVariantUrl))
	;
const moduleUrl = (code, file) => `data:text/javascript;base64,${Buffer.from(file ? resolveRelativeImports(code, new URL(file, libUrl)) : code).toString('base64')}`;
const read = (path) => readFile(new URL(path, libUrl), 'utf8');

const preludeUrl = moduleUrl(compile(await read('xr/sandbox/prelude.ts')), 'xr/sandbox/prelude.ts');
export const sandboxUrl = moduleUrl(compile(await read('xr/sandbox/codeBlockVm.ts')).replaceAll("'./prelude.ts'", JSON.stringify(preludeUrl)), 'xr/sandbox/codeBlockVm.ts');
export const runtimeUrl = moduleUrl(compile(await read('xr/codeBlockRuntime.ts'))
	.replaceAll("'./scriptNet.ts'", JSON.stringify(new URL('xr/scriptNet.ts', libUrl).href))
	.replaceAll("'./sandbox/codeBlockVm.ts'", JSON.stringify(sandboxUrl)), 'xr/codeBlockRuntime.ts');

export const sandbox = await import(sandboxUrl);
await sandbox.initCodeBlockSandbox();
export const { createCodeBlockHandlers, buildCodeBlockCtx } = await import(runtimeUrl);
