import test from 'node:test';
import assert from 'node:assert/strict';
import { detectDevice } from '../src/lib/server/deviceInfo.ts';

test('headsets, phones and desktops are told apart', () => {
	assert.deepEqual(detectDevice('Mozilla/5.0 (Linux; Android 12; Quest 3) AppleWebKit/537.36 OculusBrowser/32.0 Mobile VR Safari/537.36'), { platform: 'quest', headset: true, device: 'Quest 3' });
	assert.equal(detectDevice('Mozilla/5.0 (Linux; Android 12; Quest 2) OculusBrowser/30.0 VR').device, 'Quest 2');
	assert.equal(detectDevice('Mozilla/5.0 (X11; Linux x86_64) OculusBrowser/30.0 SamsungBrowser/4.0 Chrome/112 VR Safari/537.36').device, 'Quest (model unknown)');
	assert.equal(detectDevice('Mozilla/5.0 (X11; Linux x86_64) OculusBrowser/30.0 VR', 'Quest 3S').device, 'Quest 3S');
	assert.equal(detectDevice('Mozilla/5.0 (Linux; Android 12; PICO 4) PicoBrowser/3.0').platform, 'pico');
	assert.deepEqual(detectDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile Safari/537.36'), { platform: 'android', headset: false, device: 'Pixel 8' });
	assert.equal(detectDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120').platform, 'windows');
	assert.equal(detectDevice(null).platform, 'other');
});
