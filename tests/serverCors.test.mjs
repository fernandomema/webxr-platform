import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigin, corsHeaders, parseAllowedOrigins } from '../src/lib/server/cors.ts';

test('the list of sites that may call the API is read from a comma-separated setting', () => {
	assert.deepEqual(parseAllowedOrigins(' https://a.example/ , http://localhost:* ,,'), ['https://a.example', 'http://localhost:*']);
	assert.deepEqual(parseAllowedOrigins(undefined), []);
});

test('only listed origins are answered, and a * stands for any host or port', () => {
	const list = ['https://game.example', 'https://*.cdn.example', 'http://localhost:*'];
	assert.equal(allowedOrigin('https://game.example', list), 'https://game.example');
	assert.equal(allowedOrigin('https://x.cdn.example', list), 'https://x.cdn.example');
	assert.equal(allowedOrigin('http://localhost:5174', list), 'http://localhost:5174');
	assert.equal(allowedOrigin('https://game.example.evil.test', list), null, 'the whole origin has to match');
	assert.equal(allowedOrigin('http://game.example', list), null, 'a different scheme is a different origin');
	assert.equal(allowedOrigin('https://evil.test', list), null);
	assert.equal(allowedOrigin(null, list), null);
	assert.equal(allowedOrigin('null', list), null, 'a sandboxed page has no origin to trust');
	assert.equal(allowedOrigin('https://game.example', []), null);
});

test('the answer allows the bearer header and no cookies', () => {
	const headers = corsHeaders('https://game.example');
	assert.equal(headers['access-control-allow-origin'], 'https://game.example');
	assert.match(headers['access-control-allow-headers'], /authorization/);
	assert.equal('access-control-allow-credentials' in headers, false);
	assert.equal(headers.vary, 'Origin');
});
