import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutUiTree, lintUiPanels, PANEL_CONTENT_HEIGHT, PANEL_CONTENT_WIDTH, uiLayoutIssues, uiNodesOf } from '../packages/engine/src/xr/uiLayout.ts';

const panel = { width: 1000, height: 600 };
const node = (id, parentId, component) => ({ id, parentId, component: { type: 'uiElement', ...component } });
const widthOf = (layout, id) => layout.widths.get(id);

test('an element as wide as the panel is brought inside the panel’s margin', () => {
	const layout = layoutUiTree([node('a', null, { kind: 'text', width: 1000, height: 40 })], panel);
	assert.equal(widthOf(layout, 'a'), 920);
	assert.match(layout.issues[0].message, /1000 px wide in 920 px/);
	assert.equal(layoutUiTree([node('a', null, { kind: 'text', width: 920, height: 40 })], panel).issues.length, 0, 'exactly the room is fine');
});

test('what is inside a box is never wider than the box, however deep', () => {
	const layout = layoutUiTree([
		node('box', null, { kind: 'container', width: 400, padding: 20 }),
		node('inner', 'box', { kind: 'container', width: 500 }),
		node('text', 'inner', { kind: 'text', width: 700, height: 30 })
	], panel);
	assert.equal(widthOf(layout, 'box'), 400);
	assert.equal(widthOf(layout, 'inner'), 360, 'the room inside the padding');
	assert.equal(widthOf(layout, 'text'), 360);
	assert.deepEqual(layout.issues.map((issue) => issue.id), ['inner', 'text']);
});

test('the children of a row share the room when they do not fit, in proportion, gaps and margins kept', () => {
	const layout = layoutUiTree([
		node('row', null, { kind: 'container', flexDirection: 'row', width: 500, gap: 20 }),
		node('a', 'row', { kind: 'button', width: 300, height: 50 }),
		node('b', 'row', { kind: 'button', width: 300, height: 50 })
	], panel);
	assert.equal(widthOf(layout, 'a') + widthOf(layout, 'b') + 20, 500, 'together with the gap they fill the row');
	assert.equal(widthOf(layout, 'a'), widthOf(layout, 'b'));
	assert.match(layout.issues[0].message, /620 px across in 500 px/);
	const margins = layoutUiTree([
		node('row', null, { kind: 'container', flexDirection: 'row', width: 500 }),
		node('a', 'row', { kind: 'button', width: 300, height: 50, margin: 10 }),
		node('b', 'row', { kind: 'button', width: 300, height: 50, margin: 10 })
	], panel);
	assert.equal(widthOf(margins, 'a') + widthOf(margins, 'b') + 40, 500, 'the margins stay');
	const fits = layoutUiTree([node('row', null, { kind: 'container', flexDirection: 'row', width: 700, gap: 20 }), node('a', 'row', { kind: 'button', width: 300, height: 50 }), node('b', 'row', { kind: 'button', width: 300, height: 50 })], panel);
	assert.equal(fits.issues.length, 0);
	assert.equal(widthOf(fits, 'a'), 300, 'what fits is left alone');
});

test('a column gives every child the whole width, and a row inside shrinks its own children', () => {
	const layout = layoutUiTree([
		node('col', null, { kind: 'container', width: 400 }),
		node('wide', 'col', { kind: 'image', width: 900, height: 50 }),
		node('row', 'col', { kind: 'container', flexDirection: 'row', width: 400 }),
		node('x', 'row', { kind: 'text', width: 300, height: 20 }),
		node('y', 'row', { kind: 'text', width: 300, height: 20 })
	], panel);
	assert.equal(widthOf(layout, 'wide'), 400);
	assert.equal(widthOf(layout, 'x'), 200);
});

test('an element without a width fills what it has, and keeps no width of its own', () => {
	const layout = layoutUiTree([node('box', null, { kind: 'container', width: 300 }), node('free', 'box', { kind: 'text', height: 30 })], panel);
	assert.equal(layout.widths.has('free'), false);
	assert.equal(layout.issues.length, 0);
});

test('hidden elements take no room, and one laid over its parent is not in the flow', () => {
	const row = (extra) => layoutUiTree([
		node('row', null, { kind: 'container', flexDirection: 'row', width: 500 }),
		node('a', 'row', { kind: 'button', width: 400, height: 50 }),
		node('b', 'row', { kind: 'button', width: 400, height: 50, ...extra })
	], panel);
	assert.equal(row({ visible: false }).issues.length, 0);
	assert.equal(row({ overlayBottom: true }).issues.length, 0);
	assert.ok(row({}).issues.length > 0);
	const hidden = row({ visible: false });
	assert.ok(hidden.widths.get('b') <= 500, 'it still gets a size for when it is shown');
});

test('a box tells when what is in it is taller than it is, and when the whole panel is', () => {
	const tall = uiLayoutIssues([
		node('box', null, { kind: 'container', height: 100 }),
		node('a', 'box', { kind: 'text', height: 70 }),
		node('b', 'box', { kind: 'text', height: 70 })
	], panel);
	assert.deepEqual(tall.map((issue) => [issue.id, issue.kind]), [['box', 'too-tall']]);
	assert.match(tall[0].message, /100 px tall and what is in it is 140 px/);
	const gaps = uiLayoutIssues([node('box', null, { kind: 'container', height: 150, gap: 20 }), node('a', 'box', { kind: 'text', height: 70 }), node('b', 'box', { kind: 'text', height: 70 })], panel);
	assert.equal(gaps[0]?.kind, 'too-tall', 'gaps count');
	assert.equal(uiLayoutIssues([node('box', null, { kind: 'container', flexDirection: 'row', height: 100 }), node('a', 'box', { kind: 'text', height: 100 }), node('b', 'box', { kind: 'text', height: 100 })], panel).length, 0, 'in a row the tallest decides');
	const whole = uiLayoutIssues([node('a', null, { kind: 'container', height: 300 }), node('b', null, { kind: 'container', height: 300 })], panel);
	assert.equal(whole.some((issue) => /panel's content is 600 px tall in 528 px/.test(issue.message)), true);
	assert.equal(uiLayoutIssues([node('a', null, { kind: 'container', height: 500 })], panel).length, 0);
	assert.ok(PANEL_CONTENT_WIDTH === 0.92 && PANEL_CONTENT_HEIGHT === 0.88);
});

test('a container without a height is as tall as its content, so it is never too tall', () => {
	assert.equal(uiLayoutIssues([node('box', null, { kind: 'container' }), node('a', 'box', { kind: 'text', height: 700 })], panel).some((issue) => /what is in it/.test(issue.message)), false);
});

test('a scene is linted panel by panel, with the elements found down the slot tree', () => {
	const slot = (id, parentId, components) => ({ id, parentId, name: id, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components });
	const scene = [
		slot('board', null, [{ type: 'uiPanel', width: 400, height: 300 }]),
		slot('root', 'board', [{ type: 'uiElement', kind: 'container', width: 390, height: 100 }]),
		slot('label', 'root', [{ type: 'uiElement', kind: 'text', width: 380, height: 30, text: 'Too wide for its panel' }]),
		slot('other', null, [{ type: 'mesh' }]),
		slot('fine', null, [{ type: 'uiPanel', width: 400, height: 300 }]),
		slot('fine-root', 'fine', [{ type: 'uiElement', kind: 'text', width: 300, height: 30 }])
	];
	assert.deepEqual(uiNodesOf(scene, 'board').map((n) => n.id), ['root', 'label']);
	const issues = lintUiPanels(scene);
	assert.deepEqual(issues.map((issue) => [issue.panelId, issue.id]), [['board', 'root'], ['board', 'label']]);
	assert.equal(lintUiPanels([scene[4], scene[5]]).length, 0);
});
