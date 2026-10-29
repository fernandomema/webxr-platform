#!/usr/bin/env node
// Builds a development APK of the Quest package that loads the local dev server instead of kithin.app.
// It has its own package id, launcher name, tinted icon and signing key, so it installs next to the official app.
// Run: node scripts/package-meta-quest-dev.mjs [https://192.168.1.144:5173]

import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import sharp from 'sharp';

const devOrigin = new URL(process.argv[2] ?? 'https://192.168.1.144:5173');
const directory = resolve('meta-quest-package-dev');
const keystore = resolve(directory, 'kithin-dev.keystore');
// The key only signs a debug-grade build for this LAN; it is not a secret and must never sign the official package.
const password = 'kithin-dev';
const alias = 'kithin-dev';
const tint = '#1e6cff';

/** The official icons recoloured blue, with a DEV ribbon, so the two apps are told apart in the library. */
async function renderIcon(file, size) {
	const base = sharp(await readFile(resolve('static/icons', file)));
	const ribbonHeight = Math.round(size * 0.2);
	const ribbon = Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${ribbonHeight}">` +
			`<rect width="100%" height="100%" fill="${tint}"/>` +
			`<text x="50%" y="${ribbonHeight * 0.74}" font-family="sans-serif" font-weight="700" font-size="${ribbonHeight * 0.74}" fill="#fff" text-anchor="middle">DEV</text></svg>`
	);
	const tinted = await base.modulate({ hue: 200 }).tint(tint).png().toBuffer();
	// The ribbon sits inside the 80% safe zone of a maskable icon, so a round mask cannot cut it.
	const top = Math.round(size * (file.includes('maskable') ? 0.62 : 0.8));
	return sharp(tinted).composite([{ input: ribbon, top, left: 0 }]).png().toBuffer();
}

/** Bubblewrap downloads its icons by URL, so they are served from a throwaway local server. */
async function serveIcons() {
	const icons = { '/icon.png': await renderIcon('icon-512.png', 512), '/maskable.png': await renderIcon('icon-512-maskable.png', 512) };
	const server = createServer((request, response) => {
		const body = icons[request.url];
		response.writeHead(body ? 200 : 404, { 'content-type': 'image/png' }).end(body);
	});
	await new Promise((done) => server.listen(0, '127.0.0.1', done));
	return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function exists(path) {
	return access(path).then(() => true, () => false);
}

async function ensureKeystore() {
	if (await exists(keystore)) return;
	const { jdkPath } = JSON.parse(await readFile(resolve(homedir(), '.bubblewrap/config.json'), 'utf8'));
	const result = spawnSync(resolve(jdkPath, 'bin/keytool'), [
		'-genkeypair', '-keystore', keystore, '-alias', alias, '-storepass', password, '-keypass', password,
		'-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=Kithin Dev'
	], { stdio: 'inherit' });
	if (result.status !== 0) throw new Error('keytool could not create the dev keystore. Is the JDK from ~/.bubblewrap/config.json reachable?');
}

function run(command, args, cwd = process.cwd()) {
	return new Promise((done, fail) => {
		const child = spawn(command, args, {
			cwd,
			stdio: 'inherit',
			env: {
				...process.env,
				// The dev server uses a self-signed certificate, which Node would otherwise refuse.
				NODE_TLS_REJECT_UNAUTHORIZED: '0',
				BUBBLEWRAP_KEYSTORE_PASSWORD: password,
				BUBBLEWRAP_KEY_PASSWORD: password,
				BUBBLEWRAP_BIN: process.env.BUBBLEWRAP_BIN ?? 'bubblewrap'
			}
		});
		child.on('error', fail);
		child.on('exit', (code) => code === 0 ? done() : fail(new Error(`${command} ${args.join(' ')} exited with code ${code}.`)));
	});
}

const reachable = await fetch(new URL('/play', devOrigin), { method: 'HEAD' }).catch(() => null);
// fetch rejects the self-signed certificate, which says nothing about the server; only a missing listener matters here.
if (!reachable && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0') console.warn(`Could not confirm ${devOrigin.origin}/play from here (self-signed certificate?). Make sure \`npm run dev -- --host\` is running.`);

await mkdir(directory, { recursive: true });
await ensureKeystore();
const { server, base } = await serveIcons();
try {
	const config = {
		packageId: 'app.kithin.play.dev',
		host: devOrigin.host,
		name: 'Kithin Dev',
		launcherName: 'Kithin Dev',
		display: 'standalone',
		themeColor: tint,
		themeColorDark: '#000000',
		navigationColor: '#000000',
		navigationColorDark: '#000000',
		navigationDividerColor: '#000000',
		navigationDividerColorDark: '#000000',
		backgroundColor: '#07070C',
		enableNotifications: false,
		enableMicrophone: true,
		enableXRScene: false,
		startUrl: '/play',
		iconUrl: `${base}/icon.png`,
		maskableIconUrl: `${base}/maskable.png`,
		splashScreenFadeOutDuration: 300,
		signingKey: { path: keystore, alias },
		appVersionName: '1',
		appVersionCode: 1,
		shortcuts: [],
		generatorApp: 'bubblewrap-cli',
		fallbackType: 'customtabs',
		features: { horizonPlatformSDK: { enabled: true } },
		alphaDependencies: { enabled: false },
		enableSiteSettingsShortcut: true,
		isChromeOSOnly: false,
		isMetaQuest: true,
		horizonOSAppMode: 'immersive',
		fullScopeUrl: `${devOrigin.origin}/`,
		minSdkVersion: 23,
		orientation: 'default',
		fingerprints: [],
		additionalTrustedOrigins: [],
		retainedBundles: [],
		protocolHandlers: [],
		fileHandlers: [],
		launchHandlerClientMode: '',
		displayOverride: []
	};
	await writeFile(resolve(directory, 'twa-manifest.json'), `${JSON.stringify(config, null, 2)}\n`);
	await run(process.env.BUBBLEWRAP_BIN ?? 'bubblewrap', ['update', '--skipVersionUpgrade'], directory);
	// Reuse the production hardening (no backups, no notifications) and compiled-manifest check.
	await run('node', [resolve('scripts/package-meta-quest.mjs'), 'build', directory]);
} finally {
	server.close();
}
console.log(`\nDev APK: ${directory}/app-release-signed.apk\nInstall: adb install -r ${directory}/app-release-signed.apk`);
