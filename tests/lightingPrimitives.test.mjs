import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Matrix, MeshBuilder, NullEngine, Quaternion, Ray, Scene, Vector3 } from '@babylonjs/core';
import { compose, invert } from '../src/lib/lighting/matrix.ts';
import { insideSolid, intersect, worldBounds } from '../src/lib/lighting/primitives.ts';

/** A repeatable stream of numbers. */
const rng = (seed) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const unit = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };

function randomPlacement(random, shape) {
  const q = unit([random() - 0.5, random() - 0.5, random() - 0.5, random() + 0.2]);
  const base = shape === 'ground' ? [0.2, 1, 0.2] : [0.5 + random() * 2, 0.5 + random() * 2, 0.5 + random() * 2];
  return { position: [(random() - 0.5) * 6, (random() - 0.5) * 6, (random() - 0.5) * 6], rotation: q, scale: shape === 'sphere' ? [base[0], base[0], base[0]] : base };
}

function primitive(shape, { position, rotation, scale }) {
  const world = compose(position, rotation, scale);
  const inverse = invert(world);
  return { id: shape, shape, world, inverse, albedo: [1, 1, 1], emissive: null, opaque: true, ...worldBounds(shape, world) };
}

/** The mesh the renderer makes for a shape (sceneGraph.ts), with the placement a slot gives it. */
function babylonMesh(scene, shape, { position, rotation, scale }) {
  const mesh = {
    box: () => MeshBuilder.CreateBox('m', { size: 1 }, scene),
    sphere: () => MeshBuilder.CreateSphere('m', { diameter: 1 }, scene),
    cylinder: () => MeshBuilder.CreateCylinder('m', { diameter: 1, height: 1 }, scene),
    plane: () => MeshBuilder.CreatePlane('m', { size: 1 }, scene),
    ground: () => MeshBuilder.CreateGround('m', { width: 20, height: 20 }, scene),
    disc: () => { const d = MeshBuilder.CreateDisc('m', { radius: 0.5, tessellation: 96, sideOrientation: 2 }, scene); d.bakeTransformIntoVertices(Matrix.RotationX(Math.PI / 2)); return d; }
  }[shape]();
  mesh.position = Vector3.FromArray(position);
  mesh.rotationQuaternion = Quaternion.FromArray(rotation);
  mesh.scaling = Vector3.FromArray(scale);
  mesh.computeWorldMatrix(true);
  mesh.refreshBoundingInfo();
  mesh.isPickable = true;
  return mesh;
}

for (const shape of ['box', 'sphere', 'cylinder', 'plane', 'ground', 'disc']) {
  test(`${shape}: rays aimed at it hit it where Babylon says they do, and rays aimed away miss`, () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const random = rng(shape.length * 977);
      let hits = 0, misses = 0;
      for (let round = 0; round < 40; round++) {
        const placement = randomPlacement(random, shape);
        const mesh = babylonMesh(scene, shape, placement);
        const mine = primitive(shape, placement);
        // Aim at a point inside the shape (its middle, nudged), seen from a random direction.
        const through = Vector3.TransformCoordinates(new Vector3((random() - 0.5) * 0.5, (random() - 0.5) * (shape === 'plane' ? 0.5 : 0.5), (random() - 0.5) * 0.5), mesh.getWorldMatrix());
        const direction = unit([random() - 0.5, random() - 0.5, random() - 0.5]);
        const origin = [through.x - direction[0] * 12, through.y - direction[1] * 12, through.z - direction[2] * 12];
        const expected = scene.pickWithRay(new Ray(Vector3.FromArray(origin), Vector3.FromArray(direction), 40), (m) => m === mesh);
        const got = intersect(mine, origin, direction, 40);
        if (!expected.hit) { assert.equal(got, null, `${shape} round ${round}: Babylon misses`); misses++; continue; }
        assert.ok(got, `${shape} round ${round}: we hit where Babylon hits at ${expected.distance.toFixed(3)}`);
        const tolerance = shape === 'sphere' || shape === 'cylinder' ? 0.03 * Math.max(...placement.scale) : 1e-3;
        assert.ok(Math.abs(got.t - expected.distance) < tolerance, `${shape} round ${round}: distance ${got.t.toFixed(4)} vs ${expected.distance.toFixed(4)}`);
        const n = expected.getNormal(true);
        if (shape !== 'sphere' && shape !== 'cylinder') {
          const side = got.normal[0] * n.x + got.normal[1] * n.y + got.normal[2] * n.z;
          assert.ok(Math.abs(side) > 0.999, `${shape} round ${round}: the normal is square to the face (${side.toFixed(4)})`);
        }
        hits++;
        const wide = Vector3.FromArray(origin);
        // Aimed well off to the side: nothing either.
        const farAway = unit([direction[1], -direction[0], 0.2]);
        const off = [through.x + farAway[0] * 60, through.y + farAway[1] * 60, through.z + farAway[2] * 60];
        assert.equal(intersect(mine, off, direction, 40), null);
        void wide;
        mesh.dispose();
      }
      assert.ok(hits >= 10, `${hits} hits and ${misses} misses`);
    } finally { scene.dispose(); engine.dispose(); }
  });
}

test('a ray that starts inside a solid sees nothing of it, so a lamp inside a crate lights nothing but also casts no shadow on itself', () => {
  for (const shape of ['box', 'sphere', 'cylinder']) {
    const mine = primitive(shape, { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [2, 2, 2] });
    assert.equal(intersect(mine, [0, 0, 0], [1, 0, 0], 10), null);
    assert.equal(insideSolid(mine, [0, 0, 0]), true);
    assert.equal(insideSolid(mine, [1.5, 0, 0]), false);
  }
  assert.equal(insideSolid(primitive('plane', { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [2, 2, 2] }), [0, 0, 0]), false, 'a sheet encloses nothing');
});

test('a sheet blocks from both sides and shows its face to the ray, and a ray parallel to it misses', () => {
  const sheet = primitive('plane', { position: [0, 0, 5], rotation: [0, 0, 0, 1], scale: [4, 4, 1] });
  const front = intersect(sheet, [0, 0, 0], [0, 0, 1], 20), back = intersect(sheet, [0, 0, 10], [0, 0, -1], 20);
  assert.ok(front && back);
  assert.ok(front.normal[2] < 0 && back.normal[2] > 0, 'each normal faces its own ray');
  assert.equal(intersect(sheet, [0, 0, 4], [1, 0, 0], 20), null);
  assert.equal(intersect(sheet, [3, 0, 0], [0, 0, 1], 20), null, 'outside its edge');
});

test('the world bounds of a tilted box hold all of its corners', () => {
  const placement = { position: [1, 2, 3], rotation: unit([0.3, 0.4, 0.1, 0.8]), scale: [2, 1, 3] };
  const mine = primitive('box', placement);
  const mesh = (() => { const engine = new NullEngine(); const scene = new Scene(engine); const m = babylonMesh(scene, 'box', placement); const box = m.getBoundingInfo().boundingBox; const r = { min: box.minimumWorld.asArray(), max: box.maximumWorld.asArray() }; scene.dispose(); engine.dispose(); return r; })();
  for (let k = 0; k < 3; k++) { assert.ok(Math.abs(mine.min[k] - mesh.min[k]) < 2e-3 && Math.abs(mine.max[k] - mesh.max[k]) < 2e-3, `axis ${k}`); }
});
