import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, block, near } from './helpers/workshopWorld.mjs';

const H = 2.8;
const find = (slot, type) => slot.components.find((c) => c.type === type);
const dataOf = (slot) => find(slot, 'scriptState')?.data;
const house = (w) => [...w.slots.values()].find((slot) => slot.name === 'House' && dataOf(slot)?.kind === 'house');
const pieces = (w, kind) => {
	const h = house(w);
	return h ? w.children(h.id).filter((slot) => dataOf(slot)?.kind === kind) : [];
};
const area = (rects) => rects.reduce((sum, r) => sum + (r[2] - r[0]) * (r[3] - r[1]), 0);
const overlapArea = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

/** Presses on one point of the floor, drags to another and lets go. */
function drag(w, from, to) {
	w.pointAt(from);
	w.handlers.tick(0.016);
	w.trigger('press');
	w.pointAt(to);
	w.handlers.tick(0.016);
	w.trigger('release');
}
/** Moves a tool to the world where another one built, sharing its slots: tools work on whatever is there. */
function handOver(from, toolName) {
	const w = world(toolName, { onBench: false });
	for (const [id, slot] of from.slots) if (!w.slots.has(id)) w.slots.set(id, slot);
	return w;
}

test('the Wall Tool snaps a dragged wall to the grid, standing on the level, solid and fixed in place', () => {
	const w = world('Wall Tool', { onBench: false });
	drag(w, [1.1, 0, -2.9], [4.2, 0, -3.1]);
	const [wall] = pieces(w, 'wall');
	assert.ok(wall, 'a wall was built in the house');
	const data = dataOf(wall);
	assert.deepEqual(data.at, [2.5, 0, -3]);
	assert.equal(data.length, 3);
	assert.ok(near(wall.rotation, [0, 0, 0, 1]), 'it runs along X');
	const sections = w.children(wall.id);
	assert.equal(sections.length, 1);
	assert.ok(near(sections[0].scale, [3.15, H, 0.15]), 'the wall runs on into its corners');
	assert.ok(find(sections[0], 'collider') && !find(sections[0], 'grabbable'), 'it blocks the way and cannot be picked up');
	assert.ok(!find(house(w), 'grabbable'));
});

test('a wall dragged at an angle keeps to 45° steps, a whole number of squares long', () => {
	const w = world('Wall Tool', { onBench: false });
	drag(w, [0, 0, -2], [1.9, 0, -3.6]);
	const data = dataOf(pieces(w, 'wall')[0]);
	// Four diagonal squares from (0, -2): to (2, -4).
	assert.deepEqual(data.at, [1, 0, -3]);
	assert.ok(Math.abs(data.length - 2 * Math.SQRT2) < 1e-3);
	assert.ok(Math.abs(Math.abs(data.yaw) - Math.PI / 4) < 1e-9);
});

test('drawing a room makes four walls and the floor between them, and undo takes them away again', () => {
	const w = world('Wall Tool', { onBench: false });
	w.menu('Draw:'); // Wall -> Room
	drag(w, [0, 0, -2], [3, 0, -5]);
	assert.equal(pieces(w, 'wall').length, 4);
	const [floor] = pieces(w, 'floor');
	assert.deepEqual(dataOf(floor).rect, [0, -5, 3, -2]);
	assert.equal(find(floor, 'meshRenderer').meshRef.id, 'ground', 'a floor is walked on');
	assert.ok(near(floor.scale, [0.15, 1, 0.15]));
	w.menu('Undo');
	assert.equal(pieces(w, 'wall').length + pieces(w, 'floor').length, 0);
});

test('the preview of a wall follows the drag, and goes when the tool is put down', () => {
	const w = world('Wall Tool', { onBench: false });
	w.pointAt([0, 0, -2]);
	w.handlers.tick(0.016);
	w.trigger('press');
	w.pointAt([2, 0, -2]);
	w.handlers.tick(0.016);
	const previews = [...w.slots.values()].filter((slot) => slot.name === 'Build Preview' && !slot.disabled);
	assert.equal(previews.length, 1);
	assert.ok(near(previews[0].scale, [2.15, H, 0.15]));
	assert.ok(find(previews[0], 'meshRenderer').opacity < 1, 'it is see-through');
	assert.ok(!find(previews[0], 'collider'), 'it is not in the way');
	assert.ok([...w.slots.values()].some((slot) => slot.name === 'Build Grid'), 'the grid shows round the pointer');
	w.handlers.onDrop?.();
	w.setInHand(false);
	w.handlers.tick(0.016);
	assert.ok(![...w.slots.values()].some((slot) => slot.name === 'Build Preview' || slot.name === 'Build Grid'));
});

test('stairs climb one level and open the floor above, laid before or after them', () => {
	const w = world('Stairs Tool', { onBench: false });
	// From (2, 0, -1), pointing away along -Z.
	w.pointAt([2, 0, -1], [2, 1.5, 0.5]);
	w.handlers.tick(0.016);
	w.trigger('press');
	const [stairs] = pieces(w, 'stairs');
	assert.ok(stairs);
	assert.deepEqual(dataOf(stairs).rect, [1.5, -5, 2.5, -1]);
	const steps = w.children(stairs.id).filter((slot) => slot.name === 'Step');
	assert.equal(steps.length, 16);
	const tallest = Math.max(...steps.map((step) => step.position[1] + step.scale[1] / 2));
	assert.ok(Math.abs(tallest - (H + 0.02)) < 1e-3, 'the top step is level with the floor above');
	const walkway = w.children(stairs.id).find((slot) => slot.name === 'Stairs Walkway');
	assert.equal(find(walkway, 'meshRenderer').meshRef.id, 'ground', 'the stairs are walked up');
	assert.equal(find(walkway, 'meshRenderer').opacity, 0, 'on a ramp no one sees');
	for (const step of steps) assert.ok(!find(step, 'collider'), 'the steps do not stop feet');

	// A floor laid above afterwards leaves the stairwell open.
	const f = handOver(w, 'Floor Tool');
	f.menu('Level:'); // Ground -> 1st floor
	drag(f, [0.2, H, -5.8], [3.8, H, -0.2]);
	const rects = pieces(f, 'floor').map((floor) => dataOf(floor).rect);
	assert.ok(Math.abs(area(rects) - (24 - 4)) < 1e-6, `the floor is all there but the stairwell (${area(rects)} m²)`);
	for (const r of rects) assert.equal(overlapArea(r, [1.5, -5, 2.5, -1]), 0);
	for (const floor of pieces(f, 'floor')) assert.ok(Math.abs(floor.position[1] - (H + 0.02)) < 1e-9);

	// Stairs put in under a floor already there open it too.
	const s = handOver(f, 'Stairs Tool');
	s.pointAt([3, 0, -1], [3, 1.5, 0.5]);
	s.handlers.tick(0.016);
	s.trigger('press');
	const after = pieces(s, 'floor').map((floor) => dataOf(floor).rect);
	assert.ok(Math.abs(area(after) - (24 - 8)) < 1e-6);
	for (const r of after) assert.equal(overlapArea(r, [2.5, -5, 3.5, -1]), 0);
	s.menu('Undo');
	assert.ok(Math.abs(area(pieces(s, 'floor').map((floor) => dataOf(floor).rect)) - 20) < 1e-6, 'undo puts the floor back');
});

test('laying a floor again over one replaces it there, in the new finish', () => {
	const w = world('Floor Tool', { onBench: false });
	drag(w, [0.2, 0, -3.8], [3.8, 0, -0.2]);
	w.menu('Finish:'); // Oak -> Walnut
	drag(w, [1.2, 0, -2.8], [1.4, 0, -1.2]);
	const floors = pieces(w, 'floor');
	assert.ok(Math.abs(area(floors.map((floor) => dataOf(floor).rect)) - 16) < 1e-6, 'no floor laid twice');
	const walnut = floors.filter((floor) => find(floor, 'meshRenderer').color === '#6b4430');
	assert.deepEqual(walnut.map((floor) => dataOf(floor).rect), [[1, -3, 1.5, -1]]);
});

/** A 4 m wall along X at z = -3, from x = 0 to 4. */
function withWall(toolName) {
	const w = world('Wall Tool', { onBench: false });
	drag(w, [0, 0, -3], [4, 0, -3]);
	return handOver(w, toolName);
}
const wallOf = (w) => pieces(w, 'wall')[0];
const sectionOf = (w) => w.children(wallOf(w).id).find((slot) => slot.name === 'Wall Section');

test('a door goes into the wall where it is aimed, with a frame and a door that opens by itself', () => {
	const w = withWall('Door & Window Tool');
	w.aimAt(sectionOf(w).id, [2.1, 1, -3]);
	w.handlers.tick(0.016);
	w.trigger('press');
	const wall = wallOf(w);
	assert.deepEqual(dataOf(wall).openings, [{ kind: 'door', width: 1, bottom: 0, top: 2.1, x: 0 }]);
	const parts = w.children(wall.id);
	const sections = parts.filter((slot) => slot.name === 'Wall Section');
	assert.equal(sections.length, 3, 'beside and above the door');
	assert.ok(!sections.some((slot) => Math.abs(slot.position[0]) < 0.5 && slot.position[1] - slot.scale[1] / 2 < 2.1 - 1e-6), 'nothing blocks the doorway');
	const hinge = parts.find((slot) => slot.name === 'Door Hinge');
	assert.ok(hinge && find(hinge, 'codeBlock'));
	assert.doesNotThrow(() => new Function('ctx', find(hinge, 'codeBlock').code));
	const door = w.children(hinge.id).find((slot) => slot.name === 'Door');
	assert.ok(!find(door, 'collider'), 'the door never shuts anyone in');
	// It swings open while someone (an avatar) stands near, and shut once they have gone.
	let nearby = [];
	let turned = null;
	const doorScript = new Function('ctx', find(hinge, 'codeBlock').code)({
		self: { getWorldPosition: () => [2, 0, -3], setLocalTransform: (pose) => { turned = pose.rotation; } },
		world: { findNear: () => nearby }
	});
	nearby = [{ components: [{ type: 'avatar' }] }];
	for (let i = 0; i < 40; i++) doorScript.tick(0.05);
	assert.ok(Math.abs(2 * Math.asin(turned[1]) - 1.45) < 1e-6, 'open');
	nearby = [];
	for (let i = 0; i < 40; i++) doorScript.tick(0.05);
	assert.ok(Math.abs(turned[1]) < 1e-6, 'shut');

	// A second one on top of it does not fit; a window further along does.
	w.trigger('press');
	assert.equal(dataOf(wallOf(w)).openings.length, 1);
	w.menu('Item:'); // Door -> Window
	w.aimAt(w.children(wallOf(w).id).find((slot) => slot.name === 'Wall Section').id, [3.3, 1.5, -3]);
	w.trigger('press');
	assert.deepEqual(dataOf(wallOf(w)).openings.map((o) => [o.kind, o.x]), [['door', 0], ['window', 1.25]]);
	w.menu('Undo');
	assert.deepEqual(dataOf(wallOf(w)).openings.map((o) => o.kind), ['door']);
});

test('the sledgehammer knocks out just a door, or a whole wall, and undo builds it again', () => {
	const d = withWall('Door & Window Tool');
	d.aimAt(sectionOf(d).id, [2, 1, -3]);
	d.trigger('press');
	const w = handOver(d, 'Sledgehammer');
	const frame = w.children(wallOf(w).id).find((slot) => slot.name === 'Frame');
	w.aimAt(frame.id, [1.55, 1, -3]);
	w.handlers.tick(0.016);
	w.trigger('press');
	assert.deepEqual(dataOf(wallOf(w)).openings, [], 'the door is gone, the wall stays');
	w.aimAt(sectionOf(w).id, [1, 1, -3]);
	w.trigger('press');
	assert.equal(pieces(w, 'wall').length, 0);
	w.menu('Undo');
	assert.equal(pieces(w, 'wall').length, 1);
	w.aimAt('workshop-wall-left', [15.8, 2, -5]);
	w.trigger('press');
	assert.ok(w.slots.has('workshop-wall-left'), 'only what was built with the home tools');
});

test('a roof sits on the walls of its level, its ridge along the longer side', () => {
	const w = world('Roof Tool', { onBench: false });
	drag(w, [0, 0, -2], [3, 0, -7]);
	const [roof] = pieces(w, 'roof');
	assert.ok(roof);
	assert.deepEqual(roof.position, [1.5, H, -4.5]);
	assert.ok(near(w.worldPose(roof.id).right.map(Math.abs), [0, 0, 1]), 'the ridge runs along Z, the longer side');
	assert.equal(w.children(roof.id).filter((slot) => slot.name === 'Roof Side').length, 2);
});

test('the Color Sprayer paints a whole built wall, and leaves its window frames white', () => {
	const d = withWall('Door & Window Tool');
	d.menu('Item:'); // Door -> Window
	d.aimAt(sectionOf(d).id, [2, 1.5, -3]);
	d.trigger('press');
	const w = handOver(d, 'Color Sprayer');
	w.aimAt(sectionOf(w).id, [0.3, 1, -3]);
	w.trigger('press');
	w.trigger('release');
	const parts = w.children(wallOf(w).id);
	for (const section of parts.filter((slot) => slot.name === 'Wall Section')) assert.equal(find(section, 'meshRenderer').color, '#ef4444');
	for (const frame of parts.filter((slot) => slot.name === 'Frame')) assert.equal(find(frame, 'meshRenderer').color, '#f8fafc');
	assert.equal(dataOf(wallOf(w)).color, '#ef4444', 'it stays that colour when the wall is rebuilt');
});

/** Holds the drill's trigger long enough to drive a screw home. */
function drill(w) {
	w.handlers.tick(0.2);
	w.trigger('press');
	for (let i = 0; i < 8; i++) w.handlers.tick(0.1);
	w.trigger('release');
}
const assembly = (w) => [...w.slots.values()].find((slot) => slot.name === 'Assembly');

test('the drill joins the objects its screw touches under one assembly that is picked up as one', () => {
	const w = world('Drill');
	w.add(block('a'));
	w.add({ ...block('b'), position: [0, 1.5, -5] });
	w.touch(['a', 'b']);
	w.handlers.tick(0.2);
	assert.equal(find(w.part('Screw'), 'meshRenderer').color, '#22c55e', 'the screw at the tip shows it will join them');
	drill(w);
	const group = assembly(w);
	assert.ok(group, 'an assembly was made');
	assert.ok(find(group, 'grabbable'), 'the assembly is what is picked up');
	for (const id of ['a', 'b']) {
		const slot = w.slots.get(id);
		assert.equal(slot.parentId, group.id);
		assert.ok(!find(slot, 'grabbable'), 'its parts no longer come away on their own');
	}
	assert.ok(near(w.worldPose('b').position, [0, 1.5, -5]), 'the parts stay where they were');
	const screw = w.children(group.id).find((slot) => slot.name === 'Screw');
	assert.ok(screw, 'a screw is left in');
	assert.deepEqual(dataOf(screw).joins.sort(), ['a', 'b']);

	// A third one joins the same assembly.
	w.add({ ...block('c'), position: [0, 2, -5] });
	w.touch(['b', 'c']);
	drill(w);
	assert.equal(w.slots.get('c').parentId, group.id);
	assert.equal([...w.slots.values()].filter((slot) => slot.name === 'Assembly').length, 1);
});

test('a drilled part let go of too soon, or held by someone, is not joined', () => {
	const w = world('Drill');
	w.add(block('a'));
	w.add(block('b'));
	w.touch(['a', 'b']);
	w.handlers.tick(0.2);
	w.trigger('press');
	w.handlers.tick(0.1);
	w.trigger('release');
	w.handlers.tick(1);
	assert.ok(!assembly(w), 'the trigger was let go before the screw was in');
	w.hold('b');
	drill(w);
	assert.ok(!assembly(w));
});

test('screwing an object to something fixed fixes it in place; unscrewing frees it again', () => {
	const w = world('Drill');
	w.add(block('a'));
	w.touch(['a', 'workshop-wall-left']);
	drill(w);
	const group = assembly(w);
	assert.ok(group && !find(group, 'grabbable'), 'nothing can carry it off');
	assert.equal(w.slots.get('a').parentId, group.id);

	w.menu('Mode:'); // Join -> Unscrew
	w.touch(['a']);
	drill(w);
	assert.equal(w.slots.get('a').parentId, null);
	assert.ok(find(w.slots.get('a'), 'grabbable'), 'it can be picked up again');
	assert.ok(!assembly(w), 'an assembly left with nothing in it goes');
	assert.ok(w.slots.has('workshop-wall-left'));
});

test('unscrewing one part of three leaves the other two joined, without the screws that held it', () => {
	const w = world('Drill');
	for (const id of ['a', 'b', 'c']) w.add(block(id));
	w.touch(['a', 'b']);
	drill(w);
	w.touch(['b', 'c']);
	drill(w);
	const group = assembly(w);
	w.menu('Mode:');
	w.touch(['c']);
	drill(w);
	assert.equal(w.slots.get('c').parentId, null);
	assert.deepEqual(w.children(group.id).filter((slot) => slot.name !== 'Screw').map((slot) => slot.id).sort(), ['a', 'b']);
	const screws = w.children(group.id).filter((slot) => slot.name === 'Screw');
	assert.equal(screws.length, 1);
	assert.ok(!dataOf(screws[0]).joins.includes('c'));
});

test('the drill leaves tools and the building alone when joining', () => {
	const w = world('Drill');
	w.touch(['workshop-tool-copier-part-0', 'workshop-wall-left']);
	drill(w);
	assert.ok(!assembly(w));
	assert.equal(w.slots.get('workshop-tool-copier').parentId, 'workshop-bay-shapes');
});
