import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { CubeTexture, NullEngine, Scene, TransformNode } from '@babylonjs/core';

// Exercise the renderer itself with Babylon's CPU engine and controlled asset arrivals.
const source = await readFile(new URL('../src/lib/xr/skyboxRenderer.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
 .replaceAll("'@babylonjs/core'", JSON.stringify(import.meta.resolve('@babylonjs/core')))
 .replaceAll("'$lib/assets/builtin'", JSON.stringify(new URL('../src/lib/assets/builtin.ts', import.meta.url).href));
const { setupSkybox } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const tree = JSON.parse(await readFile(new URL('../src/lib/xr/templates/avatarShowcase.json', import.meta.url), 'utf8'));
const component = tree[0].components.find((item) => item.type === 'skybox');
const directions = ['Px', 'Py', 'Pz', 'Nx', 'Ny', 'Nz'];

test('Avatar Showcase waits for all six reflection images, regardless of arrival order', () => {
 const engine = new NullEngine();
 const scene = new Scene(engine);
 const node = new TransformNode('sky', scene);
 const original = CubeTexture.CreateFromImages;
 const calls = [];
 CubeTexture.CreateFromImages = (urls) => { calls.push([...urls]); return new CubeTexture('', scene); };
 const leases = new Map();
 const assets = { acquire(id, notify) {
  const lease = { state: 'pending', url: undefined, released: false, release() { this.released = true; }, notify };
  leases.set(id, lease);
  return lease;
 }};
 let binding;
 try {
  binding = setupSkybox(scene, node, component, assets);
  assert.equal(calls.length, 0, 'no URLs have arrived');
  for (const [index, face] of ['Nz', 'Px', 'Ny', 'Pz', 'Nx', 'Py'].entries()) {
   const lease = leases.get(component[`reflection${face}`].assetId);
   lease.state = 'ready'; lease.url = `blob:${face}`; lease.notify();
   assert.equal(calls.length, index === 5 ? 1 : 0, 'incomplete probes must not reach Babylon');
  }
  assert.deepEqual(calls[0], directions.map((face) => `blob:${face}`));
  assert.ok(scene.environmentTexture);
  for (const lease of leases.values()) lease.notify();
  assert.equal(calls.length, 1, 'repeated notifications do not recreate the probe');
  binding.dispose(); binding = null;
  assert.equal(scene.environmentTexture, null);
  assert.ok([...leases.values()].every((lease) => lease.released));
  for (const lease of leases.values()) lease.notify();
  assert.equal(calls.length, 1, 'late asset notifications cannot recreate a disposed probe');
 } finally {
  binding?.dispose();
  CubeTexture.CreateFromImages = original;
  scene.dispose(); engine.dispose();
 }
});
