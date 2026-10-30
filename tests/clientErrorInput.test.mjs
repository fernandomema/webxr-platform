import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClientError } from '../src/lib/server/clientErrorInput.ts';

test('the same failure with other numbers and ids groups together; another one does not', () => {
	const a = parseClientError({ level: 'error', message: 'Error: row 12 of 40 failed for 3f2b8c1e-1111-2222-3333-444455556666', stack: 'Error\n    at f (https://x/app.js?v=1:10:5)', url: 'https://x/w/ABC123?token=s' });
	const b = parseClientError({ level: 'error', message: 'Error: row 99 of 7 failed for aaaaaaaa-1111-2222-3333-444455556666', stack: 'Error\n    at f (https://x/app.js?v=2:77:9)', url: 'https://x/w/ZZZ999' });
	const c = parseClientError({ level: 'error', message: 'Error: something else' });
	assert.equal(a.fingerprint, b.fingerprint);
	assert.notEqual(a.fingerprint, c.fingerprint);
});

test('what could identify a person is removed, and the page is only a path', () => {
	const report = parseClientError({ level: 'warn', message: 'failed for me@example.com at ?token=abc123', url: 'https://x/w/ROOM42?room=secret#frag' });
	assert.ok(!report.message.includes('me@example.com'));
	assert.ok(!report.message.includes('abc123'));
	assert.equal(report.path, '/w/<room>');
});

test('reports that are not usable are refused', () => {
	assert.equal(parseClientError(null), null);
	assert.equal(parseClientError({ level: 'info', message: 'x' }), null);
	assert.equal(parseClientError({ level: 'error', message: '   ' }), null);
});
