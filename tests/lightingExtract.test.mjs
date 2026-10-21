import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSlot } from '../packages/engine/src/ecs/types.ts';
import { bake, specFor } from '../packages/engine/src/lighting/bake.ts';
import { extractScene, fingerprint, parseColor, sceneSignature } from '../packages/engine/src/lighting/sceneExtract.ts';

const mesh = (id, shape, extra = {}, components = []) => createSlot({ id, name: id, ...extra, components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: shape }, color: '#808080' }, ...components] });

test('colours are read as hex with or without alpha, and anything else is white', () => {
  assert.deepEqual(parseColor('#ff0000'), [1, 0, 0]);
  assert.deepEqual(parseColor('#0f0'), [0, 1, 0]);
  assert.deepEqual(parseColor('#0000ffcc'), [0, 0, 1]);
  assert.deepEqual(parseColor('nonsense'), [1, 1, 1]);
  assert.deepEqual(parseColor(undefined), [1, 1, 1]);
});

test('a child sits where its parents put it, and a switched-off slot takes everything below it out of the scene', () => {
  const tree = [
    createSlot({ id: 'group', name: 'g', position: [10, 0, 0], rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2], components: [{ type: 'container' }] }),
    mesh('crate', 'box', { parentId: 'group', position: [0, 1, 2] }),
    { ...createSlot({ id: 'off', name: 'off', components: [{ type: 'container' }] }), disabled: true },
    mesh('hidden', 'box', { parentId: 'off' }),
    { ...mesh('alsoHidden', 'sphere'), disabled: true }
  ];
  const { primitives } = extractScene(tree);
  assert.deepEqual(primitives.map((p) => p.id), ['crate']);
  const [x, y, z] = [(primitives[0].min[0] + primitives[0].max[0]) / 2, (primitives[0].min[1] + primitives[0].max[1]) / 2, (primitives[0].min[2] + primitives[0].max[2]) / 2];
  // A quarter turn about Y takes the child's +z (2) to +x: it ends up 2 m along x from the group at x = 10.
  assert.ok(Math.abs(x - 12) < 1e-9 && Math.abs(y - 1) < 1e-9 && Math.abs(z) < 1e-9, `${x}, ${y}, ${z}`);
});

test('the shape, tint and opacity of a mesh become what light does to it', () => {
  const tree = [
    mesh('red', 'box', {}, []),
    { ...mesh('glass', 'box'), components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color: '#ffffff', opacity: 0.3 }] },
    { ...mesh('ghost', 'box'), components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color: '#ffffff', opacity: 0 }] },
    { ...mesh('lamp', 'box'), components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color: '#ffe2a8', unlit: true }] },
    { ...mesh('wall', 'box'), components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color: '#ffffff' }, { type: 'material', label: 'concrete' }] },
    { ...mesh('unknown', 'box'), components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'blob' }, color: '#ffffff' }] },
    createSlot({ id: 'model', name: 'model', components: [{ type: 'meshRenderer', meshRef: { kind: 'asset', assetId: `sha256:${'1'.repeat(64)}` } }] }),
    createSlot({ id: 'panel', name: 'panel', components: [{ type: 'uiPanel', width: 600, height: 300, worldWidth: 2, background: '#000' }] })
  ];
  const by = Object.fromEntries(extractScene(tree).primitives.map((p) => [p.id, p]));
  assert.deepEqual(Object.keys(by).sort(), ['glass', 'lamp', 'model', 'panel', 'red', 'unknown', 'wall']);
  assert.ok(by.red.opaque && !by.glass.opaque, 'glass lets light through');
  assert.ok(by.lamp.opaque, 'an unlit lamp still has a body');
  assert.ok(by.wall.albedo[0] < 0.7 && by.wall.albedo[0] > 0.5, 'a textured wall reflects a share of its tint, since its pictures cannot be read');
  assert.equal(by.unknown.shape, 'box', 'what is not a built-in shape draws as a box, as the renderer does');
  assert.equal(by.model.shape, 'box');
  assert.equal(by.panel.shape, 'plane');
  assert.ok(Math.abs((by.panel.max[0] - by.panel.min[0]) - 2) < 0.01 && Math.abs((by.panel.max[1] - by.panel.min[1]) - 1) < 0.01, 'a panel is as wide as its world width and as tall as its pixels say');
});

test('only lights marked as baked are taken, with their colour times their intensity; and the sky comes with the intensity asked for', () => {
  const tree = [
    createSlot({ id: 'sky', name: 'sky', components: [{ type: 'skybox', topColor: '#ff0000', horizonColor: '#00ff00', bottomColor: '#0000ff', ambientIntensity: 1.2 }] }),
    createSlot({ id: 'live', name: 'live', position: [0, 2, 0], components: [{ type: 'pointLight', color: '#ffffff', intensity: 1, range: 5 }] }),
    createSlot({ id: 'baked', name: 'baked', position: [3, 2, 1], components: [{ type: 'pointLight', color: '#ff8000', intensity: 0.5, range: 9, baked: true }] })
  ];
  const scene = extractScene(tree, { skyIntensity: 0.3 });
  assert.equal(scene.lights.length, 1);
  assert.deepEqual(scene.lights[0].position, [3, 2, 1]);
  assert.ok(Math.abs(scene.lights[0].color[0] - 0.5) < 1e-9 && Math.abs(scene.lights[0].color[1] - 0.5 * 128 / 255) < 1e-9);
  assert.equal(scene.lights[0].range, 9);
  assert.deepEqual(scene.sky.top, [1, 0, 0]);
  assert.equal(scene.sky.intensity, 0.3);
  assert.equal(extractScene(tree, { allLights: true }).lights.length, 2);
  assert.equal(extractScene([]).sky.intensity, 0, 'no sky, no sky light');
});

test('a spot light is read with its direction (the slot’s forward), the half angle of its cone and its falloff', () => {
  const tree = [createSlot({ id: 's', name: 's', position: [1, 3, 1], rotation: [Math.sin(Math.PI / 4), 0, 0, Math.cos(Math.PI / 4)], components: [{ type: 'spotLight', color: '#ffffff', intensity: 2, range: 12, angle: 60, exponent: 4, baked: true }] })];
  const [light] = extractScene(tree).lights;
  assert.equal(light.kind, 'spot');
  assert.ok(Math.abs(light.cosHalfAngle - Math.cos(Math.PI / 6)) < 1e-9, 'a cone of 60 degrees has a half angle of 30');
  assert.equal(light.exponent, 4);
  // A quarter turn about X takes +z to -y: pointing straight down.
  assert.ok(Math.abs(light.direction[1] + 1) < 1e-9 && Math.abs(light.direction[0]) < 1e-9 && Math.abs(light.direction[2]) < 1e-9, `${light.direction}`);
  assert.deepEqual(extractScene([createSlot({ ...tree[0], components: [{ type: 'spotLight', color: '#fff', intensity: 1, range: 5, angle: 40 }] })]).lights, [], 'a live spot light is not baked');
});

test('avatars are left out, and so is what is too far from the region to matter', () => {
  const tree = [mesh('near', 'box', { position: [1, 1, 1] }), mesh('far', 'box', { position: [500, 0, 0] }), mesh('parked', 'box', { position: [0, -200, 0] }), createSlot({ id: 'me', name: 'me', components: [{ type: 'avatar' }, { type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' } }] })];
  const kept = extractScene(tree, { region: { min: [0, 0, 0], max: [10, 4, 10] } }).primitives.map((p) => p.id);
  assert.deepEqual(kept, ['near']);
});

test('the signature is steady for the same world and changes when the world, a light or the grid does; and ignores what is out of reach', () => {
  const grid = { min: [0, 0, 0], voxel: 0.5, dims: [10, 4, 10] };
  const region = { min: [0, 0, 0], max: [5, 2, 5] };
  const base = [mesh('a', 'box', { position: [2, 1, 2] }), createSlot({ id: 'l', name: 'l', position: [1, 2, 1], components: [{ type: 'pointLight', color: '#ffffff', intensity: 1, range: 6, baked: true }] })];
  const sig = (tree, g = grid) => sceneSignature(extractScene(tree), g, region);
  assert.equal(sig(base), sig(structuredClone(base)));
  assert.equal(sig(base).length, 32);
  assert.notEqual(sig(base), sig([mesh('a', 'box', { position: [2.5, 1, 2] }), base[1]]), 'a surface moved');
  assert.notEqual(sig(base), sig([base[0], createSlot({ ...base[1], components: [{ type: 'pointLight', color: '#ffffff', intensity: 2, range: 6, baked: true }] })]), 'a light changed');
  assert.notEqual(sig(base), sig(base, { ...grid, voxel: 0.25 }), 'the grid changed');
  assert.equal(sig(base), sig([...base, mesh('elsewhere', 'box', { position: [900, 0, 0] })]), 'something a world away does not matter');
  assert.notEqual(fingerprint('a'), fingerprint('b'));
});

test('a scene read from slots bakes to the same light as one built by hand: a lamp in a closed box of slots lights its floor', () => {
  const t = 0.3;
  const wall = (id, position, scale) => mesh(id, 'box', { position, scale }, [{ type: 'collider', shape: 'box' }]);
  const tree = [
    wall('floor', [2, -t / 2, 2], [4 + 2 * t, t, 4 + 2 * t]), wall('roof', [2, 3 + t / 2, 2], [4 + 2 * t, t, 4 + 2 * t]),
    wall('w', [-t / 2, 1.5, 2], [t, 3, 4]), wall('e', [4 + t / 2, 1.5, 2], [t, 3, 4]), wall('s', [2, 1.5, -t / 2], [4, 3, t]), wall('n', [2, 1.5, 4 + t / 2], [4, 3, t]),
    createSlot({ id: 'lamp', name: 'lamp', position: [2, 2.5, 2], components: [{ type: 'pointLight', color: '#ffffff', intensity: 1, range: 10, baked: true }] })
  ];
  const scene = extractScene(tree);
  const volume = bake(scene, specFor([-1, -1, -1], [5, 4, 5], 0.5), { samples: 24, passes: 1, blur: 0 });
  const floorUnderLamp = volume.data[(((2 * volume.spec.dims[2] + 4) * volume.spec.dims[1] + 2) * volume.spec.dims[0] + 4) * 3];
  const outside = volume.data[(((2 * volume.spec.dims[2] + 4) * volume.spec.dims[1] + 2) * volume.spec.dims[0] + 0) * 3];
  assert.ok(floorUnderLamp > 0.1, `under the lamp: ${floorUnderLamp}`);
  assert.ok(outside < floorUnderLamp * 0.05, `outside the wall: ${outside}`);
});
