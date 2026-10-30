import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { createFriendsDb } from './helpers/friendsFake.mjs';

function load(prisma) {
	const source = readFileSync(new URL('../src/lib/server/friends/friendGraph.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export (async )?function /gm, '$1function ');
	return new Function('prisma', `${ts.transpile(source, { target: ts.ScriptTarget.ES2022 })}\nreturn { friendIdsOf, blockedBetween, reachableHosts };`)(prisma);
}

// a - b - c - d: a's friends are b; a reaches c through b, and d is three steps away.
const users = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, name: id, username: id }));
function graph() {
	const db = createFriendsDb({ users });
	for (const [x, y] of [['a', 'b'], ['b', 'c'], ['c', 'd']]) db.state.friendships.push({ userAId: x, userBId: y });
	return { ...db, graph: load(db.prisma) };
}

test('Friends reaches friends, Friends+ also friends of friends, and nobody else', async () => {
	const { graph: g } = graph();
	const reach = await g.reachableHosts('a');
	assert.deepEqual([...reach.friends], ['b']);
	assert.deepEqual([...reach.friendsPlus].sort(), ['b', 'c']);
	const middle = await g.reachableHosts('c');
	assert.deepEqual([...middle.friends].sort(), ['b', 'd']);
	assert.deepEqual([...middle.friendsPlus].sort(), ['a', 'b', 'd']);
	assert.deepEqual([...(await g.reachableHosts('e')).friendsPlus], []);
});

test('a block in either direction removes the person from what is reachable', async () => {
	const { graph: g, state } = graph();
	state.blocks.push({ blockerId: 'c', blockedId: 'a' });
	assert.deepEqual([...(await g.blockedBetween('a'))], ['c']);
	assert.deepEqual([...(await g.reachableHosts('a')).friendsPlus], ['b']);
	assert.deepEqual([...(await g.reachableHosts('c')).friendsPlus].sort(), ['b', 'd']);
});
