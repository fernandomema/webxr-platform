import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bundleScript } from '@kithin/game/script-bundle';

/** Every sound of the game: the music, the jingles and the effects played from where they happen (`tools/make-audio.py`). */
const SOUNDS = ['lobby', 'duel', 'victory', 'defeat', 'point', 'down', 'card', 'shot', 'hit', 'kill', 'block', 'jump', 'land', 'reload', 'empty', 'bounce', 'explosion', 'click'];

/** The asset id of each sound that has been made (the hash of its file in `static/content/audio`), by name. */
function audioAssets(): Record<string, string> {
	const found: Record<string, string> = {};
	for (const name of SOUNDS) {
		const url = new URL(`../../static/content/audio/${name}.ogg`, import.meta.url);
		if (existsSync(url)) found[name] = `sha256:${createHash('sha256').update(readFileSync(url)).digest('hex')}`;
	}
	return found;
}

let director: string | null = null;
let brain: string | null = null;

/** Bundles the scripts of the game (`src/script/`): they are TypeScript modules, checked like any other code. Call once, before `buildRounds()`. */
export async function prepareScripts(): Promise<void> {
	const entry = (name: string) => fileURLToPath(new URL(`../script/${name}.ts`, import.meta.url));
	director = await bundleScript(entry('director'), { inject: { AUDIO: audioAssets() } });
	brain = await bundleScript(entry('brain'));
}

const ready = (code: string | null): string => {
	if (code === null) throw new Error('The scripts are not bundled: await prepareScripts() before building the world');
	return code;
};

/** The director: the body of a code block (it receives `ctx` and returns handlers). */
export const directorScript = (): string => ready(director);

/** The script of a gun or a shield, for one side. */
export const brainScript = (kind: 'gun' | 'shield', side: number, brainId: string, commandsId: string): string =>
	`const SIDE = ${side}, BRAIN = ${JSON.stringify(brainId)}, COMMANDS = ${JSON.stringify(commandsId)}, KIND = ${JSON.stringify(kind)};\n${ready(brain)}`;
