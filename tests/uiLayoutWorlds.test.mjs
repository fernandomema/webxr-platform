import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { lintUiPanels } from '../packages/engine/src/xr/uiLayout.ts';
import { buildBistro } from '../src/lib/content/templates/bistro.ts';
import { buildDeadDrop } from '../src/lib/content/templates/deadDrop.ts';
import { buildArcade } from '../src/lib/content/templates/arcade.ts';
import { buildBeatTurntable } from '../src/lib/content/templates/beatTurntable.ts';
import { buildArchiveJukebox } from '../src/lib/content/templates/archiveJukebox.ts';
import { buildPolyHeavenMaterials } from '../src/lib/content/templates/polyHeavenMaterials.ts';
import { buildWishEngine } from '../src/lib/content/templates/wishEngine.ts';
import { buildLobbyExtras } from '../src/lib/content/templates/lobbyExtras.ts';

const json = async (name) => JSON.parse(await readFile(new URL(name === 'keyboard' ? '../packages/engine/src/xr/keyboard/frame.json' : `../src/lib/content/templates/${name}.json`, import.meta.url), 'utf8'));
const worlds = {
	lobby: [...(await json('lobby')), ...buildLobbyExtras()], workshop: await json('workshop'), pulse: await json('pulse'), 'pop-up-store': await json('popUpStore'), keyboard: await json('keyboard'),
	avatarShowcase: await json('avatarShowcase'), bistro: buildBistro(), 'dead-drop': buildDeadDrop(), arcade: buildArcade(), 'beat-turntable': buildBeatTurntable(),
	'archive-jukebox': buildArchiveJukebox(), 'polyheaven-materials': buildPolyHeavenMaterials(), 'wish-engine': buildWishEngine()
};

/**
 * Where a panel's elements ask for a little more room than their boxes have. The game shrinks them to fit, so nothing is cut off, but
 * the numbers should be right: these are the worlds that predate the check, and the count of each may only go down. A world that is
 * not in the list has none.
 */
const KNOWN_OVERFLOWS = { bistro: 73, 'dead-drop': 29, 'beat-turntable': 14, 'wish-engine': 10, arcade: 1 };

for (const [name, tree] of Object.entries(worlds)) {
	test(`the ${name} world does not ask its panels for more room than they have`, () => {
		const issues = lintUiPanels(tree);
		const allowed = KNOWN_OVERFLOWS[name] ?? 0;
		assert.ok(issues.length <= allowed, `${issues.length} (at most ${allowed}): ${issues.slice(0, 5).map((issue) => `${issue.panelId}/${issue.id}: ${issue.message}`).join('; ')}`);
		if (issues.length < allowed) assert.fail(`${name} improved to ${issues.length}: lower its number in KNOWN_OVERFLOWS`);
	});
}
