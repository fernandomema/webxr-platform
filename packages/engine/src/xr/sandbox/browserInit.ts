import wasmUrl from '@jitl/quickjs-wasmfile-release-sync/wasm?url';
import { initCodeBlockSandbox } from './codeBlockVm.ts';

/** Loads the code block sandbox in the browser. Await it before the first scene with code blocks is loaded. */
export const initBrowserCodeBlockSandbox = (): Promise<void> => initCodeBlockSandbox(wasmUrl);
