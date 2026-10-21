import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { TransformNode, NullEngine, Scene } from '@babylonjs/core';
import { createCodeBlockHandlers } from './helpers/codeBlockRuntimeModule.mjs';
import {
	CARD_SAFE_WIDTH, GUIDE_CARDS, GUIDE_DONE, GUIDE_NEXT, GUIDE_TOPICS, SAFE_HEIGHT, SAFE_WIDTH, STEP_TEXT_SIZE, STEP_TEXT_WIDTH, buildLobbyHub
} from '../src/lib/xr/templates/lobbyHub.ts';
import { buildLobbyExtras } from '../src/lib/xr/templates/lobbyExtras.ts';
import { localizedText } from '../src/lib/xr/uiLocale.ts';
import { INPUT_HINT_NAMES, resolveInputHints } from '../src/lib/xr/inputHints.ts';
import { layoutRichText, parseRichText } from '../src/lib/xr/richText.ts';
import { lintUiPanels } from '../src/lib/xr/uiLayout.ts';

const lobby = JSON.parse(await readFile(new URL('../src/lib/xr/templates/lobby.json', import.meta.url), 'utf8'));
const hub = buildLobbyHub();
const byId = new Map(hub.map((slot) => [slot.id, slot]));
const find = (slot, type) => slot.components.find((component) => component.type === type);
const ui = (id) => find(byId.get(id), 'uiElement');
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

/** How many lines `text` takes in a box `width` px wide at `fontSize`, assuming a wide average character (0.55 em) so the check errs on the side of overflow. */
const lines = (text, width, fontSize) => text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil((line.length * fontSize * 0.55) / width)), 0);
const children = (id) => hub.filter((slot) => slot.parentId === id);
const words = (text) => text.split(/\s+/).filter(Boolean).length;
/** How tall a step is once its words and pictures are laid out in the box it sits in (a wide average letter, so it errs on the side of overflow). */
const stepHeight = (text) => layoutRichText(parseRichText(text), { width: STEP_TEXT_WIDTH, fontSize: STEP_TEXT_SIZE, align: 'left', measure: (word) => word.length * STEP_TEXT_SIZE * 0.55 }).height;

test('the lobby has one id per slot across its data, the hub, the billboard and the ATM, and every parent exists', () => {
	const all = [...lobby, ...buildLobbyExtras()];
	assert.equal(new Set(all.map((slot) => slot.id)).size, all.length);
	const ids = new Set(all.map((slot) => slot.id));
	for (const slot of all) if (slot.parentId !== null) assert.ok(ids.has(slot.parentId), `${slot.id} has its parent`);
	assert.equal(all.some((slot) => slot.id.startsWith('lobby-sign')), false, 'the old welcome sign is gone');
});

test('every text on the board and the cards is in English and Spanish', () => {
	let texts = 0;
	for (const slot of hub) {
		const element = find(slot, 'uiElement');
		if (element?.kind !== 'text' && element?.kind !== 'button') continue;
		if (/^\d+( \/ \d+)?$/.test(element.text)) continue; // a number the script fills in
		texts++;
		assert.ok(element.translations?.es?.text, `${slot.id} has a Spanish text`);
		assert.notEqual(element.translations.es.text, element.text, `${slot.id} is really translated`);
	}
	assert.ok(texts >= 15, `${texts} texts were checked`);
	for (const topic of GUIDE_TOPICS) {
		assert.ok(topic.label.en && topic.label.es);
		for (const [index, step] of topic.steps.entries()) {
			assert.ok(step.en.trim() && step.es.trim(), `${topic.key} step ${index + 1} has both languages`);
			assert.notEqual(step.en, step.es);
		}
	}
	assert.equal(localizedText({ text: 'Hello', translations: { es: { text: 'Hola' } } }, 'es'), 'Hola');
	assert.equal(localizedText({ text: 'Hello', translations: { es: { text: 'Hola' } } }, 'en'), 'Hello');
	assert.equal(localizedText({ text: 'Hello', translations: { es: { text: 'Hola' } } }, 'fr'), 'Hello', 'a language it does not have gets the original');
	assert.equal(localizedText({ text: 'Hello' }, 'es'), 'Hello');
	assert.equal(localizedText({}, 'es'), undefined);
});

test('the home is a picture and one word for each of six things to do, with few words', () => {
	assert.deepEqual(GUIDE_TOPICS.map((topic) => topic.key), ['explore', 'create', 'friends', 'credits', 'controls', 'account']);
	for (const topic of GUIDE_TOPICS) {
		assert.equal(ui(`lobby-guide-image-${topic.key}`).kind, 'image');
		assert.equal(ui(`lobby-guide-image-${topic.key}`).src, `/assets/lobby/tile-${topic.key}.png`);
		assert.equal(ui(`lobby-guide-tile-${topic.key}`).kind, 'button');
		assert.ok(words(topic.label.en) <= 3 && words(topic.label.es) <= 3, `${topic.key} is named in a few words`);
	}
	for (const language of ['en', 'es']) {
		const shown = hub.filter((slot) => slot.id.startsWith('lobby-guide') && slot.parentId && !/-topic|-bar|-step|-nav|-number|-previous|-next|-back|-counter/.test(slot.id)).map((slot) => find(slot, 'uiElement')).filter((element) => element && (element.kind === 'text' || element.kind === 'button')).map((element) => localizedText(element, language));
		assert.ok(words(shown.join(' ')) <= 30, `${words(shown.join(' '))} words show on the home in ${language}`);
	}
	for (const card of GUIDE_CARDS) {
		assert.equal(ui(`lobby-card-${card.id}-image`).kind, 'image');
		assert.equal(children(`lobby-card-${card.id}-column`).length, 2, 'a picture and its name, nothing else');
		assert.equal(words(card.title.en), 1);
	}
});

test('every picture exists on disk', () => {
	for (const slot of hub) {
		const element = find(slot, 'uiElement');
		if (element?.kind === 'image') assert.ok(existsSync(new URL(`../static${element.src}`, import.meta.url)), `${element.src} exists`);
	}
	for (const topic of GUIDE_TOPICS) assert.ok(existsSync(new URL(`../static/assets/lobby/icon-${topic.key}.png`, import.meta.url)), `the page picture of ${topic.key}`);
});

test('nothing in the lobby asks for more room than it has: the panels are laid out without a single overflow', () => {
	// The same check the Studio and the game run (uiLayout.ts): every box holds what is in it, and every panel its boxes.
	assert.deepEqual(lintUiPanels(buildLobbyExtras()).map((issue) => `${issue.panelId}: ${issue.message}`), []);
	const guide = find(byId.get('lobby-guide-panel'), 'uiPanel');
	assert.ok(SAFE_WIDTH <= guide.width * 0.92 && SAFE_HEIGHT <= guide.height * 0.92);
	for (const screen of ['lobby-guide-home', 'lobby-guide-topic']) assert.ok(ui(screen).width <= SAFE_WIDTH && ui(screen).height <= SAFE_HEIGHT, `${screen} is inside the safe area`);
	for (const tile of GUIDE_TOPICS) {
		const column = children(`lobby-guide-column-${tile.key}`);
		assert.ok(ui(column.at(-1).id).height >= 12, 'a button has room under it before its tile ends');
	}
	assert.ok((ui('lobby-guide-home').gap ?? 0) >= 12, 'the rows are apart');
	for (const card of GUIDE_CARDS) {
		const panel = find(byId.get(`lobby-card-${card.id}-panel`), 'uiPanel');
		assert.ok(ui(`lobby-card-${card.id}-column`).width <= CARD_SAFE_WIDTH && CARD_SAFE_WIDTH <= panel.width * 0.92, `${card.id} fits its width`);
	}
});

test('the words fit their boxes in both languages and on both devices', () => {
	for (const topic of GUIDE_TOPICS) {
		for (const language of ['en', 'es']) {
			assert.ok(lines(topic.label[language], 700, 52) <= 1, `${topic.key} title in ${language}`);
			assert.ok(lines(topic.label[language], 310, 32) <= 1, `${topic.key} button in ${language}`);
			for (const [index, step] of topic.steps.entries()) {
				for (const device of ['desktop', 'xr']) {
					const shown = resolveInputHints(step[language], language, device);
					assert.ok(!/[{}]/.test(shown), `${topic.key} step ${index + 1} has a control that is not known: ${shown}`);
					assert.ok(stepHeight(shown) <= 300, `${topic.key} step ${index + 1} in ${language} on ${device} is ${stepHeight(shown)} px tall in a box of 340`);
				}
				assert.ok(words(step[language]) <= 20, `${topic.key} step ${index + 1} is short`);
			}
		}
	}
	for (const card of GUIDE_CARDS) for (const language of ['en', 'es']) assert.ok(lines(card.title[language], CARD_SAFE_WIDTH, 48) <= 1, `${card.id} in ${language}`);
	for (const language of ['en', 'es']) assert.ok(lines(GUIDE_NEXT[language], 260, 34) <= 1);
});

test('the steps name the controls of the device in hand, and write a way through the menus as arrows, not as words', () => {
	const used = new Set();
	for (const topic of GUIDE_TOPICS) {
		for (const step of topic.steps) {
			for (const language of ['en', 'es']) {
				for (const [, name] of step[language].matchAll(/\{([a-z]+)\}/g)) used.add(name);
				assert.doesNotMatch(step[language], /\bthen\b|\by luego\b|\bluego\b/i, `"${step[language]}" strings its steps together with a word`);
				assert.doesNotMatch(step[language], /\bTab\b|\bmenu button\b|botón de menú|\bgrip\b|\btrigger\b|gatillo/i, `"${step[language]}" names a control by hand`);
			}
			assert.deepEqual([...step.en.matchAll(/\{([a-z]+)\}/g)].map((m) => m[1]).sort(), [...step.es.matchAll(/\{([a-z]+)\}/g)].map((m) => m[1]).sort(), 'both languages name the same controls');
		}
	}
	for (const name of used) assert.ok(INPUT_HINT_NAMES.includes(name), `${name} is a known control`);
	for (const name of ['dash', 'use', 'grab', 'drop', 'move', 'turn']) assert.ok(used.has(name), `${name} is used`);
	const arrows = GUIDE_TOPICS.flatMap((topic) => topic.steps.map((step) => step.en)).filter((text) => text.includes('→'));
	assert.ok(arrows.length >= 8, 'paths through the menus are arrows');
	const controls = GUIDE_TOPICS.find((topic) => topic.key === 'controls');
	for (const language of ['en', 'es']) {
		for (const step of controls.steps) assert.notEqual(resolveInputHints(step[language], language, 'desktop'), resolveInputHints(step[language], language, 'xr'), `"${step[language]}" reads differently on each device`);
	}
});

test('publishing is about worlds, and an account is not said to be needed to host in the account topic', () => {
	const account = GUIDE_TOPICS.find((topic) => topic.key === 'account');
	assert.match(account.steps[0].en, /publish your worlds/);
	assert.match(account.steps[0].es, /publicar tus mundos/);
	assert.doesNotMatch(account.steps[0].en, /\bhost\b/i);
	for (const topic of GUIDE_TOPICS) for (const step of topic.steps) assert.doesNotMatch(step.en, /publish(?! (your )?worlds?)(?! it)/i, `"${step.en}" publishes without saying what`);
});

/** The guide's script running on a fake host that records what it writes, and with how many of those writes it told the guests. */
function guideRuntime() {
	const scene = new Scene(new NullEngine());
	const node = new TransformNode('guide', scene);
	const writes = [];
	const fake = {
		getSlot: () => undefined, getNode: () => node, getChildren: () => [], allSlots: () => [], getGrabbers: () => [], isHost: () => true, requestSpawn() {}, requestDelete() {},
		setComponentField: (slotId, type, field, value, broadcast) => writes.push({ id: slotId.replace('lobby-guide-', ''), field, value, broadcast })
	};
	const runtime = createCodeBlockHandlers('lobby-guide-panel', node, find(byId.get('lobby-guide-panel'), 'codeBlock').code, fake);
	assert.deepEqual(runtime.getDebugLog(), []);
	const press = (id) => { writes.length = 0; runtime.onUIEvent({ type: 'press', slotId: `lobby-guide-${id}` }); return writes.slice(); };
	const last = (list, id, field) => list.findLast((write) => write.id === id && write.field === field)?.value;
	return { runtime, writes, press, last };
}

test('a topic opens on its first step, Next goes through the steps, and the last one says Done and returns home', () => {
	const { runtime, press, last } = guideRuntime();
	const topic = GUIDE_TOPICS.find((candidate) => candidate.key === 'create');
	let w = press('tile-create');
	assert.equal(last(w, 'topic', 'visible'), true);
	assert.equal(last(w, 'home', 'visible'), false);
	assert.equal(last(w, 'topic-title', 'text'), topic.label.en);
	assert.deepEqual(last(w, 'topic-title', 'translations'), { es: { text: topic.label.es } });
	assert.equal(last(w, 'topic-icon', 'src'), '/assets/lobby/icon-create.png');
	assert.equal(last(w, 'number', 'text'), '1');
	assert.equal(last(w, 'number', 'color'), topic.accent);
	assert.equal(last(w, 'step-text', 'text'), topic.steps[0].en);
	assert.deepEqual(last(w, 'step-text', 'translations'), { es: { text: topic.steps[0].es } });
	assert.equal(last(w, 'counter', 'text'), `1 / ${topic.steps.length}`);
	assert.equal(last(w, 'previous', 'visible'), false, 'nothing before the first step');
	assert.equal(last(w, 'next', 'text'), GUIDE_NEXT.en);
	assert.equal(w.filter((write) => write.broadcast === true).length, 1, 'one update to the guests, not one per field');
	assert.equal(w.at(-1).broadcast, true, 'and it is the last, so it carries the rest');

	for (let step = 1; step < topic.steps.length; step++) {
		w = press('next');
		assert.equal(last(w, 'step-text', 'text'), topic.steps[step].en, `step ${step + 1}`);
		assert.deepEqual(last(w, 'step-text', 'translations'), { es: { text: topic.steps[step].es } });
		assert.equal(last(w, 'number', 'text'), String(step + 1));
		assert.equal(last(w, 'previous', 'visible'), true);
		assert.equal(last(w, 'next', 'text'), step === topic.steps.length - 1 ? GUIDE_DONE.en : GUIDE_NEXT.en, 'the last step says Done');
		assert.deepEqual(last(w, 'next', 'translations'), { es: { text: (step === topic.steps.length - 1 ? GUIDE_DONE : GUIDE_NEXT).es } });
	}
	w = press('next');
	assert.equal(last(w, 'home', 'visible'), true, 'Done goes home');
	assert.equal(last(w, 'topic', 'visible'), false);
	assert.deepEqual(runtime.getDebugLog(), []);
	runtime.dispose();
});

test('Back goes to the step before, and Home goes home from any step; every topic can be opened and walked to its end', () => {
	const { runtime, press, last } = guideRuntime();
	press('tile-friends');
	press('next');
	press('next');
	let w = press('previous');
	assert.equal(last(w, 'number', 'text'), '2');
	assert.equal(last(w, 'step-text', 'text'), GUIDE_TOPICS.find((topic) => topic.key === 'friends').steps[1].en);
	w = press('back');
	assert.equal(last(w, 'home', 'visible'), true);
	for (const topic of GUIDE_TOPICS) {
		w = press(`tile-${topic.key}`);
		assert.equal(last(w, 'step-text', 'text'), topic.steps[0].en, `${topic.key} opens`);
		for (let i = 1; i < topic.steps.length; i++) press('next');
		w = press('next');
		assert.equal(last(w, 'home', 'visible'), true, `${topic.key} ends at home`);
	}
	runtime.dispose();
});

test('presses that mean nothing change nothing', () => {
	const { runtime, writes, press } = guideRuntime();
	assert.deepEqual(press('next'), [], 'Next at home');
	assert.deepEqual(press('previous'), []);
	assert.deepEqual(press('tile-nope'), []);
	assert.deepEqual(press('somewhere-else'), []);
	runtime.onUIEvent({ type: 'change', slotId: 'lobby-guide-tile-create' });
	runtime.onUIEvent({ type: 'submit', slotId: 'lobby-guide-tile-create' });
	assert.deepEqual(writes, []);
	press('tile-explore');
	assert.deepEqual(press('previous'), [], 'Back on the first step');
	assert.deepEqual(runtime.getDebugLog(), []);
	runtime.dispose();
});

test('every card is a doorway: to a world that exists, or to a new one', async () => {
	const worlds = await read('src/lib/xr/templates/builtinWorlds.ts');
	assert.ok(GUIDE_CARDS.some((card) => card.link.kind === 'new'), 'one makes a new world');
	for (const card of GUIDE_CARDS) {
		const link = find(byId.get(`lobby-card-${card.id}-panel`), 'worldLink');
		assert.deepEqual(link.target, card.link);
		if (card.link.kind === 'builtin') assert.match(worlds, new RegExp(`id: '${card.link.id}'`), `${card.link.id} is a built-in world`);
	}
	assert.equal(new Set(GUIDE_CARDS.map((card) => card.id)).size, GUIDE_CARDS.length);
});

test('the board and the cards stand on the wall without touching each other or the mirror', () => {
	const extent = (slot) => {
		const parent = byId.get(slot.parentId);
		return [parent.position[0] + slot.position[0] - slot.scale[0] / 2, parent.position[0] + slot.position[0] + slot.scale[0] / 2, parent.position[1] + slot.position[1] - slot.scale[1] / 2, parent.position[1] + slot.position[1] + slot.scale[1] / 2];
	};
	const frames = hub.filter((slot) => /-frame$/.test(slot.id));
	assert.equal(frames.length, 1 + GUIDE_CARDS.length);
	const boxes = frames.map((slot) => [slot.id, extent(slot)]);
	for (let i = 0; i < boxes.length; i++) {
		for (let j = i + 1; j < boxes.length; j++) {
			const [a, b] = [boxes[i][1], boxes[j][1]];
			assert.equal(a[0] < b[1] && b[0] < a[1] && a[2] < b[3] && b[2] < a[3], false, `${boxes[i][0]} and ${boxes[j][0]} overlap`);
		}
	}
	const mirror = lobby.find((slot) => slot.id === 'lobby-mirror-frame');
	const mirrorX = [mirror.position[0] - mirror.scale[0] / 2, mirror.position[0] + mirror.scale[0] / 2];
	for (const [id, box] of boxes) assert.ok(box[1] <= mirrorX[0] || box[0] >= mirrorX[1], `${id} is clear of the mirror`);
	for (const [, box] of boxes) assert.ok(box[2] >= 0 && box[3] < 3.2, 'within reach and sight');
});

test('what the steps tell visitors is what the game shows today, down to the names on its buttons', async () => {
	const dash = await read('src/lib/xr/ui/dashPanel.ts');
	const worldsBrowser = await read('src/lib/xr/ui/worldsBrowser.ts');
	const portalMenu = await read('src/lib/xr/ui/worldPortalMenu.ts');
	const desktopHand = await read('src/lib/xr/interaction/desktop/desktopHand.ts');
	const fps = await read('src/lib/xr/interaction/desktop/fpsController.ts');
	const pointer = await read('src/lib/xr/interaction/pointerController.ts');
	const engine = await read('src/lib/xr/engine.ts');
	const builtin = await read('src/lib/inventory/adapters/builtin.ts');
	const wiki = await read('src/content/wiki/en/getting-started/quick-start.md');
	const worlds = await read('src/lib/xr/templates/builtinWorlds.ts');
	const hosting = await read('src/lib/server/services/worlds.ts');

	// The Dash: its tabs and the buttons the steps name.
	for (const tab of ['Session', 'Worlds', 'Inventory', 'Account', 'Settings']) assert.match(dash, new RegExp(`label: '${tab}'`), `the Dash has a ${tab} tab`);
	for (const label of ["'Spawn'", "'Save world'", "'Invite people'", "'Who can join?'", "'Host  ›'", "'Sign in'", "'Create account'"]) assert.ok(dash.includes(label), `${label} is on a Dash button`);
	for (const label of ['Official', 'Join by code', 'Join room']) assert.ok(worldsBrowser.includes(`'${label}'`), `the Worlds tab has ${label}`);
	assert.match(builtin, /label: 'Starter Kit'/);
	assert.match(wiki, /`Tab` on desktop, or the menu button on your controller/);
	assert.match(engine, /keyboardKey: 'tab', buttonIdPattern: \/x-button\|menu\//);
	// The cards: the first option of the menu is the one that goes (or creates), as the steps say.
	assert.match(portalMenu, /radial\.open\(node, \[\s*\{\s*label: isNew \? 'Create a new world'/);
	// Lobby is a world the Worlds tab lists (it is not a development one).
	assert.match(worlds, /id: 'lobby'/);
	assert.doesNotMatch(/DEV_WORLD_IDS[^=]*=\s*\[([^\]]*)\]/.exec(worlds)[1], /'lobby'/);
	// Controls.
	for (const key of ['KeyE', 'KeyQ']) assert.match(desktopHand, new RegExp(`'${key}'`));
	assert.match(fps, /ShiftLeft/);
	assert.match(fps, /'Space'/);
	for (const code of [87, 65, 83, 68]) assert.match(engine, new RegExp(`keys\\w+\\.push\\(${code}\\)`), `key ${code}`);
	assert.match(pointer, /grip\/squeeze: grabs/);
	assert.match(dash, /How the left stick gets you around/);
	assert.match(dash, /How the right stick turns you/);
	// Accounts: hosting needs one, and the credits page exists.
	assert.match(hosting.slice(hosting.indexOf('export async function startHostingSession')), /if \(!user\) throw new UnauthorizedError\(\)/);
	assert.ok(existsSync(new URL('../src/routes/settings/credits/+page.svelte', import.meta.url)));
	assert.match(await read('src/routes/settings/+layout.svelte'), /label: 'Credits'/);
});
