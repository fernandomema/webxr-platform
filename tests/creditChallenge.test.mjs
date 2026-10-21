import assert from 'node:assert/strict';
import test from 'node:test';
import { newNonce, signChallenge, verifyChallenge } from '../src/lib/server/creditChallenge.ts';

const SECRET = 'test-secret-test-secret';
const challenge = (over = {}) => ({ u: 'user-1', p: 'pub-1', r: 3, sku: 'sword', a: 250, n: newNonce(), e: Date.now() + 60_000, ...over });

test('a signed challenge verifies and carries exactly what was signed', () => {
	const original = challenge();
	assert.deepEqual(verifyChallenge(SECRET, signChallenge(SECRET, original)), original);
});

test('a challenge is refused when it was signed with another secret, edited, truncated, expired or is not a token', () => {
	const token = signChallenge(SECRET, challenge());
	assert.equal(verifyChallenge('another-secret-another-secret', token), null);
	const [body, signature] = token.split('.');
	const edited = JSON.parse(Buffer.from(body, 'base64url').toString());
	edited.a = 1;
	assert.equal(verifyChallenge(SECRET, `${Buffer.from(JSON.stringify(edited)).toString('base64url')}.${signature}`), null, 'a cheaper price');
	assert.equal(verifyChallenge(SECRET, `${body}.`), null);
	assert.equal(verifyChallenge(SECRET, body), null);
	assert.equal(verifyChallenge(SECRET, `${token}.x`), null);
	assert.equal(verifyChallenge(SECRET, token.slice(0, -4)), null);
	assert.equal(verifyChallenge(SECRET, signChallenge(SECRET, challenge({ e: Date.now() - 1 }))), null, 'expired');
	for (const junk of [undefined, null, 5, {}, '', 'a.b', 'x'.repeat(5000)]) assert.equal(verifyChallenge(SECRET, junk), null);
});

test('a signed payload that is not a challenge is refused', () => {
	for (const bad of [{ ...challenge(), a: 0 }, { ...challenge(), a: 1.5 }, { ...challenge(), u: 7 }, { ...challenge(), e: 'soon' }, { u: 'x' }]) {
		assert.equal(verifyChallenge(SECRET, signChallenge(SECRET, bad)), null);
	}
});

test('nonces are unique', () => {
	assert.equal(new Set(Array.from({ length: 500 }, newNonce)).size, 500);
});
