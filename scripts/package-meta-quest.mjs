#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const origin = 'https://kithin.app';
const manifestUrl = `${origin}/manifest.webmanifest`;
const mode = process.argv[2] ?? 'check';

/** The app's id in the Meta Horizon developer dashboard (`META_APP_ID`, from the environment or `.env`). The headset's platform SDK needs it in the APK to find the store entry the in-app purchases belong to. */
async function metaAppId() {
	let value = process.env.META_APP_ID;
	if (!value) {
		const env = await readFile('.env', 'utf8').catch(() => '');
		value = /^META_APP_ID=["']?([^"'\s#]*)/m.exec(env)?.[1];
	}
	if (!value || !/^[1-9]\d{5,24}$/.test(value)) throw new Error('META_APP_ID is needed to build the Quest app: without it the store cannot sell anything from inside it. Set it in .env or the environment.');
	return value;
}

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

async function hardenAndroidProject(directory) {
	await disableAndroidBackup(directory);
	const configPath = resolve(directory, 'twa-manifest.json');
	const config = JSON.parse(await readFile(configPath, 'utf8'));
	const appId = await metaAppId();
	let changed = false;
	if (config.enableNotifications !== false) {
		config.enableNotifications = false;
		changed = true;
	}
	if (config.applicationId !== appId) {
		// The store only accepts a version it has not seen, so a build that changes the app it belongs to is a new version.
		config.applicationId = appId;
		config.appVersionCode = Number(config.appVersionCode ?? 0) + 1;
		config.appVersion = String(config.appVersionCode);
		config.appVersionName = String(config.appVersionCode);
		changed = true;
		console.log(`The Quest app now belongs to Meta app ${appId}; its version is ${config.appVersionCode}.`);
	}
	if (changed) await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
	const gradlePath = resolve(directory, 'app/build.gradle');
	const gradle = await readFile(gradlePath, 'utf8');
	const updatedGradle = gradle.replace(/enableNotifications:\s*true\b/g, 'enableNotifications: false');
	if (updatedGradle !== gradle) await writeFile(gradlePath, updatedGradle);
	const { path, manifest: generated } = await backupEnabled(directory);
	// The platform SDK reads the Meta app id from here (a leading backslash keeps it a string).
	const manifest = generated.replace(/(android:name="com\.meta\.horizon\.platform\.ovr\.OCULUS_APP_ID"\s+android:value=")[^"]*(")/, `$1\\ ${appId}$2`);
	// Override dependency manifests too, so they cannot restore this permission.
	let updated = manifest.replace(/<uses-permission\b[^>]*android:name=["']android\.permission\.POST_NOTIFICATIONS["'][^>]*\/\s*>/g, '');
	if (!/xmlns:tools=/.test(updated)) updated = updated.replace('<manifest ', '<manifest xmlns:tools="http://schemas.android.com/tools" ');
	updated = updated.replace(/(<manifest\b[^>]*>)/s, '$1\n    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" tools:node="remove" />');
	if (updated !== generated) await writeFile(path, updated);
	console.log('Notification delegation is disabled and POST_NOTIFICATIONS is excluded.');
}

async function androidProjectIsHardened(directory) {
	const { manifest, application } = await backupEnabled(directory);
	const permissions = manifest.match(/<uses-permission\b[^>]*android:name=["']android\.permission\.POST_NOTIFICATIONS["'][^>]*>/g) ?? [];
	const config = JSON.parse(await readFile(resolve(directory, 'twa-manifest.json'), 'utf8'));
	const gradle = await readFile(resolve(directory, 'app/build.gradle'), 'utf8');
	const appId = await metaAppId();
	return application.includes('android:allowBackup="false"') && config.enableNotifications === false
		&& config.applicationId === appId && manifest.includes(`\\ ${appId}"`)
		&& !/enableNotifications:\s*true\b/.test(gradle)
		&& permissions.length === 1 && permissions[0].includes('tools:node="remove"');
}

async function buildSecureApk(directory) {
	await hardenAndroidProject(directory);
	await bubblewrap(directory, ['build']);
	if (!await androidProjectIsHardened(directory)) {
		// Bubblewrap regenerated the Android project during build.
		await hardenAndroidProject(directory);
		await bubblewrap(directory, ['build']);
	}
	if (!await androidProjectIsHardened(directory)) {
		throw new Error('The Android project must disable backups and notification permissions. Do not distribute the APK.');
	}
	await verifyCompiledManifest(directory);
}

async function verifyCompiledManifest(directory) {
	const config = JSON.parse(await readFile(resolve(homedir(), '.bubblewrap/config.json'), 'utf8'));
	const toolsDirectory = resolve(config.androidSdkPath, 'build-tools');
	const versions = (await readdir(toolsDirectory)).sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
	if (!versions.length) throw new Error('Android build tools are missing.');
	const aapt = resolve(toolsDirectory, versions[0], process.platform === 'win32' ? 'aapt.exe' : 'aapt');
	const apk = resolve(directory, 'app-release-signed.apk');
	const result = spawnSync(aapt, ['dump', 'xmltree', apk, 'AndroidManifest.xml'], { encoding: 'utf8' });
	if (result.status !== 0) throw new Error(`Could not inspect the APK manifest: ${result.stderr}`);
	if (!/android:allowBackup\([^\n]*\)=\(type 0x12\)0x0\b/.test(result.stdout)) {
		throw new Error(`The compiled APK does not explicitly disable Android backup: ${apk}`);
	}
	if (!result.stdout.includes(await metaAppId())) throw new Error(`The compiled APK does not carry the Meta app id, so the store cannot sell from inside it: ${apk}`);
	console.log(`Verified android:allowBackup=false and the Meta app id in ${apk}.`);
}

try {
	if (mode === 'check-local') await checkLocal();
	else if (mode === 'check') await checkProduction();
	else if (mode === 'init') {
		await checkProduction();
		await runBubblewrap(resolve(process.argv[3] ?? 'meta-quest-package'));
		await hardenAndroidProject(resolve(process.argv[3] ?? 'meta-quest-package'));
	} else if (mode === 'harden') await hardenAndroidProject(resolve(process.argv[3] ?? 'meta-quest-package'));
	else if (mode === 'build') await buildSecureApk(resolve(process.argv[3] ?? 'meta-quest-package'));
	else if (mode === 'verify') await verifyCompiledManifest(resolve(process.argv[3] ?? 'meta-quest-package'));
	else throw new Error('Usage: node scripts/package-meta-quest.mjs [check-local|check|init [output-directory]|harden [output-directory]|build [output-directory]|verify [output-directory]]');
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
