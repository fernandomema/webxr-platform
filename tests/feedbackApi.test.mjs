import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { FEEDBACK_MOODS, parseFeedbackAction } from '../src/lib/server/feedbackInput.ts';

function handlers(prisma) {
  const source = readFileSync(new URL('../src/routes/api/feedback/+server.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/export const /g, 'const ');
  const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022 });
  return new Function('prisma', 'error', 'json', 'FEEDBACK_MOODS', 'parseFeedbackAction', js + '\nreturn { GET, POST };')(prisma, (status, message) => { throw Object.assign(new Error(message), { status }); }, Response.json, FEEDBACK_MOODS, parseFeedbackAction);
}

const event = (body, user = { id: 'session-user' }) => ({ locals: { user }, request: new Request('https://example.com/api/feedback', { method: 'POST', body: JSON.stringify(body) }) });

test('feedback reads and all submissions require a session before accessing the database', async () => {
  const api = handlers(new Proxy({}, { get() { assert.fail('Anonymous request accessed database'); } }));
  await assert.rejects(api.GET({ locals: { user: null } }), { status: 401 });
  for (const body of [{ action: 'suggest', category: 'idea', title: 'A new idea' }, { action: 'vote', id: 'entry', delta: 1 }, { action: 'mood', key: 'good' }]) {
    await assert.rejects(api.POST(event(body, null)), { status: 401 });
  }
});

test('submissions, votes and moods record the session user, ignoring supplied identity', async () => {
  const calls = [];
  const record = (name, result) => async (args) => { calls.push([name, args]); return result; };
  const tx = {
    feedbackEntry: { upsert: record('entry', { id: 'entry', title: 'An idea', category: 'idea', votes: 1, status: 'planned' }), updateMany: record('vote', { count: 1 }), update: async () => ({}) },
    feedbackInteraction: { create: record('interaction', {}) },
    feedbackVote: { findUnique: async () => null, upsert: async () => ({}) },
    feedbackMoodResponse: { create: record('response', {}) },
    feedbackMood: { upsert: record('mood', {}) }
  };
  let transactions = 0;
  const api = handlers({ $transaction: async (callback) => { transactions++; return callback(tx); } });
  await api.POST(event({ action: 'suggest', category: 'idea', title: 'An idea', userId: 'spoofed' }));
  assert.equal(calls[0][1].create.userId, 'session-user');
  assert.equal(calls[0][1].update.userId, undefined, 'Matching titles preserve the original author');
  assert.deepEqual(calls[1][1].data, { entryId: 'entry', userId: 'session-user', action: 'suggest', delta: 0 });
  await api.POST(event({ action: 'vote', id: 'entry', delta: -1, userId: 'spoofed' }));
  assert.deepEqual(calls[3][1].data, { entryId: 'entry', userId: 'session-user', action: 'vote', delta: -1 });
  await api.POST(event({ action: 'mood', key: 'good', userId: 'spoofed' }));
  assert.deepEqual(calls[4][1].data, { key: 'good', userId: 'session-user' });
  assert.equal(transactions, 3);
});

test('missing entries do not record a vote', async () => {
  const api = handlers({ $transaction: (callback) => callback({ feedbackEntry: { updateMany: async () => ({ count: 0 }) }, feedbackInteraction: { create: () => assert.fail('Recorded vote for missing entry') } }) });
  await assert.rejects(api.POST(event({ action: 'vote', id: 'missing', delta: 1 })), { status: 404 });
});


test('new and repeated suggestions add no votes and start pending review', async () => {
  const api = handlers({ $transaction: (callback) => callback({
    feedbackEntry: { upsert: async ({ create, update }) => {
      assert.equal(create.votes, 0);
      assert.equal(create.status, 'pending');
      assert.deepEqual(update, {});
      return { id: 'entry', ...create };
    } },
    feedbackInteraction: { create: async ({ data }) => assert.equal(data.delta, 0) }
  }) });
  for (let i = 0; i < 2; i++) await api.POST(event({ action: 'suggest', category: 'idea', title: 'An idea' }));
});

test('each user has one vote; repeat clicks do nothing and changing direction replaces it', async () => {
  const votes = new Map();
  let score = 0;
  let interactions = 0;
  const api = handlers({ $transaction: (callback) => callback({
    feedbackEntry: { updateMany: async () => ({ count: 1 }), update: async ({ data }) => { score += data.votes.increment; } },
    feedbackVote: {
      findUnique: async ({ where }) => votes.get(where.entryId_userId.userId) ?? null,
      upsert: async ({ create }) => { votes.set(create.userId, { value: create.value }); }
    },
    feedbackInteraction: { create: async () => { interactions++; } }
  }) });
  const vote = (delta, id = 'session-user') => api.POST(event({ action: 'vote', id: 'entry', delta }, { id }));
  await vote(1);
  assert.equal(score, 1);
  for (let i = 0; i < 10; i++) await vote(1);
  assert.equal(score, 1);
  assert.equal(interactions, 1);
  await vote(-1);
  assert.equal(score, -1);
  await vote(-1);
  assert.equal(score, -1);
  await vote(1, 'another-user');
  assert.equal(score, 0);
  assert.equal(votes.size, 2);
});
