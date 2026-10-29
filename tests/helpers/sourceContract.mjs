import assert from 'node:assert/strict';
import { checkDetail, checkSourceInfo, checkSummary } from '../../packages/engine/src/library/validate.ts';

/**
 * The checks every source must pass: its info, a search for each kind it serves (with the paging contract), and the detail of what
 * the search found. A new adapter calls this with recorded responses (no network) and gets the whole contract tested.
 */
export async function assertSourceContract(source, { queries, minResults = 1 }) {
	assert.deepEqual(checkSourceInfo(source), [], 'info');
	for (const { kind, text } of queries) {
		assert.ok(source.info.kinds.includes(kind), `${source.info.id} serves ${kind}`);
		const page = await source.search({ text, kind, limit: 2 });
		assert.ok(page.items.length >= minResults, `${kind} search for "${text}" found something`);
		assert.ok(page.items.length <= 2, 'the limit is respected');
		for (const item of page.items) {
			assert.deepEqual(checkSummary(item), [], `summary ${item.ref}`);
			assert.equal(item.kind, kind);
			assert.ok(item.ref.startsWith(`${source.info.id}:`), 'a ref starts with its source');
		}
		assert.ok(page.next === null || typeof page.next === 'string', 'next is a cursor or null');
		const first = page.items[0];
		const detail = await source.detail(first.ref.slice(source.info.id.length + 1));
		assert.deepEqual(checkDetail(detail), [], `detail ${first.ref}`);
		assert.equal(detail.ref, first.ref);
		assert.equal(detail.kind, kind);
		for (const variant of detail.variants) for (const file of variant.files) {
			const real = /^https:\/\//.test(file.url);
			if (real && !source.open) assert.ok(source.info.allowedHosts.some((allowed) => (allowed.startsWith('*.') ? new URL(file.url).hostname.endsWith(allowed.slice(1)) : allowed === new URL(file.url).hostname)), `${file.url} is on an allowed host`);
		}
	}
}
