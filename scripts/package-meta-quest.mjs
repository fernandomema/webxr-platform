#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const origin = 'https://kithin.app';
const manifestUrl = `${origin}/manifest.webmanifest`;
const mode = process.argv[2] ?? 'check';

function validateManifest(manifest) {
	const start = new URL(manifest.start_url, manifestUrl);
	const scope = new URL(manifest.scope, manifestUrl);
	if (start.origin !== origin || start.pathname !== '/play') throw new Error('The manifest must launch https://kithin.app/play.');
	if (scope.origin !== origin || !start.href.startsWith(scope.href)) throw new Error('The manifest scope must include /play.');
	if (manifest.display !== 'standalone') throw new Error('The manifest must use standalone display.');
	if (!manifest.name || !manifest.short_name) throw new Error('The manifest needs a name and short_name.');
	const icon = manifest.icons?.find((item) => item.sizes?.split(/\s+/).includes('512x512') && item.type === 'image/png');
	if (!icon) throw new Error('The manifest needs a 512x512 PNG icon.');
	return manifest.icons;
}

async function checkLocal() {
	const manifest = JSON.parse(await readFile('static/manifest.webmanifest', 'utf8'));
	for (const icon of validateManifest(manifest)) {
		const path = resolve('static', new URL(icon.src, manifestUrl).pathname.slice(1));
		const data = await readFile(path);
		if (data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`${path} is not a PNG.`);
		const size = icon.sizes?.split(/\s+/)[0]?.split('x').map(Number);
		if (data.readUInt32BE(16) !== size?.[0] || data.readUInt32BE(20) !== size?.[1]) throw new Error(`${path} has the wrong dimensions.`);
	}
	console.log('Local Quest PWA manifest and icons are valid.');
}

async function checkProduction() {
	const response = await fetch(manifestUrl);
	if (!response.ok) throw new Error(`${manifestUrl} returned HTTP ${response.status}. Deploy the manifest and icons first.`);
	const icons = validateManifest(await response.json());
	for (const icon of icons) {
		const url = new URL(icon.src, manifestUrl);
		const result = await fetch(url, { method: 'HEAD' });
		if (!result.ok) throw new Error(`${url} returned HTTP ${result.status}.`);
	}
	const play = await fetch(`${origin}/play`, { method: 'HEAD' });
	if (!play.ok) throw new Error(`${origin}/play returned HTTP ${play.status}.`);
	console.log(`Production Quest PWA is ready: ${manifestUrl}`);
}

async function runBubblewrap(directory) {
	await mkdir(directory, { recursive: true });
	if ((await readdir(directory)).length) throw new Error(`${directory} must be empty for bubblewrap init.`);
	await bubblewrap(directory, ['init', `--manifest=${manifestUrl}`, '--metaquest']);
}

async function bubblewrap(directory, args) {
	await new Promise((done, fail) => {
		const child = spawn(process.env.BUBBLEWRAP_BIN ?? 'bubblewrap', args, { cwd: directory, stdio: 'inherit' });
		child.on('error', fail);
		child.on('exit', (code) => code === 0 ? done() : fail(new Error(`Bubblewrap exited with code ${code}.`)));
	});
}

async function backupEnabled(directory) {
	const path = resolve(directory, 'app/src/main/AndroidManifest.xml');
	const manifest = await readFile(path, 'utf8');
	const application = /<application\b[^>]*>/s.exec(manifest)?.[0];
	if (!application) throw new Error(`Could not find the application element in ${path}.`);
	return { path, manifest, application };
}

async function disableAndroidBackup(directory) {
	const { path, manifest, application } = await backupEnabled(directory);
	if (application.includes('android:allowBackup="false"')) {
		console.log('Android backup is already disabled.');
		return;
	}
	if (!application.includes('android:allowBackup="true"')) throw new Error(`Unexpected backup setting in ${path}.`);
	await writeFile(path, manifest.replace(application, application.replace('android:allowBackup="true"', 'android:allowBackup="false"')));
	console.log(`Disabled Android backup in ${path}.`);
}

async function buildSecureApk(directory) {
	await disableAndroidBackup(directory);
	await bubblewrap(directory, ['build']);
	if ((await backupEnabled(directory)).application.includes('android:allowBackup="true"')) {
		// Bubblewrap regenerated the Android project during build.
		await disableAndroidBackup(directory);
		await bubblewrap(directory, ['build']);
	}
	if (!(await backupEnabled(directory)).application.includes('android:allowBackup="false"')) {
		throw new Error('The Android project does not explicitly disable backups. Do not distribute the APK.');
	}
}

try {
	if (mode === 'check-local') await checkLocal();
	else if (mode === 'check') await checkProduction();
	else if (mode === 'init') {
		await checkProduction();
		await runBubblewrap(resolve(process.argv[3] ?? 'meta-quest-package'));
		await disableAndroidBackup(resolve(process.argv[3] ?? 'meta-quest-package'));
	} else if (mode === 'harden') await disableAndroidBackup(resolve(process.argv[3] ?? 'meta-quest-package'));
	else if (mode === 'build') await buildSecureApk(resolve(process.argv[3] ?? 'meta-quest-package'));
	else throw new Error('Usage: node scripts/package-meta-quest.mjs [check-local|check|init [output-directory]|harden [output-directory]|build [output-directory]]');
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
