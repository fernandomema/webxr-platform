#!/usr/bin/env node
// Copies the engine's static files (Draco decoder, controller profiles, the base avatar, input icons) into an app's static
// folder, where the engine looks for them by default:  kithin-engine-static [destination]   (default: ./static)
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '../static');
const destination = resolve(process.argv[2] ?? 'static');

function copyChanged(from, to) {
	mkdirSync(to, { recursive: true });
	for (const entry of readdirSync(from, { withFileTypes: true })) {
		const sourcePath = join(from, entry.name);
		const targetPath = join(to, entry.name);
		if (entry.isDirectory()) copyChanged(sourcePath, targetPath);
		else if (!existsSync(targetPath) || statSync(targetPath).size !== statSync(sourcePath).size || statSync(targetPath).mtimeMs < statSync(sourcePath).mtimeMs) cpSync(sourcePath, targetPath);
	}
}

copyChanged(source, destination);
