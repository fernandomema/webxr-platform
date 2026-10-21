import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, PBRMaterial, PointLight, Scene, ShaderMaterial, StandardMaterial, HemisphericLight, Vector3 } from '@babylonjs/core';
import { INJECTION_POINTS, MAX_VOLUMES, PBR_BEFORE_COMPOSITION, STANDARD_BEFORE_FOG, UNIFORMS, atlasSize, customCode, definitions, packAtlas } from '../packages/engine/src/xr/irradianceShader.ts';
import { IrradianceVolumePlugin, registerIrradiancePlugin } from '../packages/engine/src/xr/irradiancePlugin.ts';
import { LightVolumeManager, tintOf } from '../packages/engine/src/xr/lightVolumeManager.ts';
import { setAmbientBase, setAmbientScale } from '../packages/engine/src/xr/ambientControl.ts';

const core = new URL('../node_modules/@babylonjs/core/Shaders/', import.meta.url);
/** A shader of Babylon's with its `#include`s written out, so a marker and the names above it can be found. */
function shader(file) {
  const text = (f) => { const m = /`([\s\S]*?)`/.exec(readFileSync(new URL(f, core), 'utf8')); return m[1].replace(/\\n/g, '\n'); };
  const expand = (source, depth = 0) => source.replace(/#include<([A-Za-z0-9_]+)>(\([^)]*\))?(\[[^\]]*\])?/g, (_, name) => {
    if (depth > 6) return '';
    try { return expand(text(`ShadersInclude/${name}.js`), depth + 1); } catch { return ''; }   // the uniform declarations are made by Babylon itself
  });
  return expand(text(file));
}
const volume = (extra = {}) => ({ min: [0, 0, 0], voxel: 0.25, dims: [4, 3, 2], atlasX: 0, range: 2, ...extra });

test('the shader text names every volume, the atlas and the six faces, with floats written as floats', () => {
  const code = definitions([volume(), volume({ atlasX: 4, min: [-10.5, 2, 400], voxel: 0.3333 })], [8, 3, 12]);
  assert.match(code, /const int LV_COUNT = 2;/);
  assert.match(code, /const vec3 LV_ATLAS = vec3\(8\.0, 3\.0, 12\.0\);/);
  assert.match(code, /LV_A\[2\] = vec4\[2\]\(vec4\(0\.0, 0\.0, 0\.0, 0\.25\), vec4\(-10\.5, 2\.0, 400\.0, 0\.3333\)\)/);
  assert.match(code, /LV_B\[2\] = vec4\[2\]\(vec4\(4\.0, 3\.0, 2\.0, 0\.0\), vec4\(4\.0, 3\.0, 2\.0, 4\.0\)\)/);
  assert.match(code, /LV_RANGE\[2\] = float\[2\]\(2\.0, 2\.0\)/);
  assert.match(code, /uniform highp sampler3D lvAtlas;/);
  assert.match(code, /if \(i == 0\) return lvT0\.rgb;/);
  assert.match(code, /if \(i == 1\) return lvT1\.rgb;/);
  assert.doesNotMatch(code, /lvT2\b/, 'no more tints than volumes');
  for (const face of ['0 : 1', '2 : 3', '4 : 5']) assert.ok(code.includes(face), face);
  assert.ok(code.startsWith('#ifdef IRRADIANCE_VOLUME') && code.endsWith('#endif'));
  // No integer literal where GLSL wants a float: a vec constructor never holds a bare integer.
  for (const row of code.match(/vec[34]\([^)]*\)/g) ?? []) assert.ok(!/(^|[(, -])\d+(?=[,)])/.test(row.replace(/vec[34]\(/, '(')), `an integer in ${row}`);
});

test('with no volume, or more than the shader can hold, there is nothing to add', () => {
  assert.equal(definitions([], [1, 1, 1]), '');
  assert.equal(customCode('StandardMaterial', [], [1, 1, 1]), null);
  assert.equal(customCode('StandardMaterial', Array.from({ length: MAX_VOLUMES + 1 }, () => volume()), [1, 1, 1]), null);
  assert.equal(customCode('ShaderMaterial', [volume()], [1, 1, 1]), null, 'only lit materials take it');
  assert.equal(customCode('StandardMaterial', Array.from({ length: MAX_VOLUMES }, () => volume()), [1, 1, 1]) !== null, true);
});

test('each kind of material gets its pieces at the places of its shader that Babylon leaves open for plugins', () => {
  const standard = customCode('StandardMaterial', [volume()], [4, 3, 12]);
  assert.deepEqual(Object.keys(standard).sort(), ['CUSTOM_FRAGMENT_BEFORE_FOG', 'CUSTOM_FRAGMENT_DEFINITIONS']);
  assert.equal(standard.CUSTOM_FRAGMENT_BEFORE_FOG, STANDARD_BEFORE_FOG);
  const pbr = customCode('PBRMaterial', [volume()], [4, 3, 12]);
  assert.deepEqual(Object.keys(pbr).sort(), ['CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION', 'CUSTOM_FRAGMENT_DEFINITIONS']);
  assert.equal(pbr.CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION, PBR_BEFORE_COMPOSITION);
});

test('the places the plugin writes into exist in the shaders of the installed Babylon, and what the code uses is declared above them', () => {
  const standard = shader('default.fragment.js'), pbr = shader('pbr.fragment.js');
  const above = (source, marker, name) => { const at = source.indexOf(`#define ${marker}`); assert.ok(at > 0, `${marker} is in the shader`); return source.slice(0, at); };
  const std = INJECTION_POINTS.StandardMaterial;
  const beforeStd = above(standard, std.code, '');
  assert.ok(above(standard, std.definitions, '').length > 0);
  for (const name of ['vec4 color=', 'vec4 baseColor=', 'vec3 diffuseColor=', 'vec3 baseAmbientColor=', 'vec3 normalW=', 'varying vec3 vPositionW']) assert.ok(beforeStd.includes(name), `Standard declares ${name} before ${std.code}`);
  const p = INJECTION_POINTS.PBRMaterial;
  const beforePbr = above(pbr, p.code, '');
  assert.ok(above(pbr, p.definitions, '').length > 0);
  for (const name of ['vec3 finalAmbient=', 'vec3 finalDiffuse=', 'vec3 surfaceAlbedo=', 'aoOut', 'vec3 normalW', 'vPositionW']) assert.ok(beforePbr.includes(name), `PBR declares ${name} before ${p.code}`);
  assert.ok(pbr.indexOf('#define CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION') < pbr.indexOf('vec4 finalColor='), 'and it is before the colour is made, so the ambient it adds counts');
  // Every name the injected code reads is one of those.
  for (const name of ['color', 'baseColor', 'diffuseColor', 'baseAmbientColor', 'normalW', 'vPositionW']) assert.ok(STANDARD_BEFORE_FOG.includes(name));
  for (const name of ['finalAmbient', 'finalDiffuse', 'surfaceAlbedo', 'aoOut', 'normalW', 'vPositionW']) assert.ok(PBR_BEFORE_COMPOSITION.includes(name));
});

test('the volumes of a world are packed side by side in one block of texels, each face slab where it should be', () => {
  const nx = 3, ny = 2, nz = 2;
  const texels = (seed) => { const t = new Uint8Array(nx * ny * nz * 6 * 4); for (let i = 0; i < t.length; i++) t[i] = (seed + i) % 251; return t; };
  const a = { min: [0, 0, 0], voxel: 1, dims: [nx, ny, nz], range: 1, texels: texels(1) };
  const b = { min: [9, 0, 0], voxel: 1, dims: [2, 1, 1], range: 2, texels: new Uint8Array(2 * 1 * 1 * 6 * 4).fill(77) };
  assert.deepEqual(atlasSize([a, b]), [5, 2, 12]);
  const { data, size, layouts } = packAtlas([a, b]);
  assert.deepEqual(size, [5, 2, 12]);
  assert.deepEqual(layouts.map((l) => l.atlasX), [0, 3]);
  assert.deepEqual(layouts[1].min, [9, 0, 0]);
  // A texel of the first volume: face 2 (the third slab), slice 1, row 1, column 2.
  const at = (x, y, zd) => ((zd * 2 + y) * 5 + x) * 4;
  const source = ((2 * nz + 1) * ny + 1) * nx * 4 + 2 * 4;
  assert.deepEqual(Array.from(data.slice(at(2, 1, 2 * nz + 1), at(2, 1, 2 * nz + 1) + 4)), Array.from(a.texels.slice(source, source + 4)));
  // The second volume starts at x = 3 and the rest of its depth is empty.
  assert.equal(data[at(3, 0, 0)], 77);
  assert.equal(data[at(3, 0, 6)], 0);
  assert.equal(data[at(3, 1, 0)], 0, 'it is one row high; the row above is empty');
});

// A null engine has no graphics card, so the 3D texture is stood in for.
LightVolumeManager.textureFactory = (data, width, height, depth) => ({ data, width, height, depth, disposed: false, dispose() { this.disposed = true; } });

async function withScene(fn) {
  const engine = new NullEngine();
  Object.defineProperty(engine, 'webGLVersion', { value: 2 });
  const scene = new Scene(engine);
  try { return await fn(scene); } finally { LightVolumeManager.peek(scene)?.dispose(); scene.dispose(); engine.dispose(); }
}

test('the plugin goes on lit materials only, and each reports its uniforms and sampler', async () => {
  await withScene((scene) => {
    registerIrradiancePlugin(true);
    const standard = new StandardMaterial('s', scene), pbr = new PBRMaterial('p', scene), sky = new ShaderMaterial('sky', scene, { vertexSource: 'void main(){}', fragmentSource: 'void main(){}' }, { attributes: ['position'], uniforms: [] });
    for (const material of [standard, pbr]) {
      const plugin = material.pluginManager.getPlugin('IrradianceVolume');
      assert.ok(plugin instanceof IrradianceVolumePlugin, `${material.getClassName()} has it`);
      const samplers = []; plugin.getSamplers(samplers);
      assert.deepEqual(samplers, ['lvAtlas']);
      const uniforms = plugin.getUniforms();
      assert.deepEqual(uniforms.ubo.map((u) => u.name), [...UNIFORMS]);
      assert.ok(uniforms.ubo.every((u) => u.type === 'vec4' && u.size === 4));
      assert.match(uniforms.fragment, /uniform vec4 lvT0;[\s\S]*uniform vec4 lvParams;/);
    }
    assert.equal(sky.pluginManager?.getPlugin('IrradianceVolume') ?? null, null, 'the sky’s own shader is left alone');
  });
});

test('registering without 3D textures leaves materials as they were', async () => {
  await withScene((scene) => {
    registerIrradiancePlugin(false);
    assert.equal(new StandardMaterial('s', scene).pluginManager?.getPlugin('IrradianceVolume') ?? null, null);
    registerIrradiancePlugin(true);
  });
});

test('until a volume is loaded the shader does not change; once one is, the defines turn on and the code to add appears', async () => {
  await withScene(async (scene) => {
    registerIrradiancePlugin(true);
    const material = new StandardMaterial('s', scene);
    const plugin = material.pluginManager.getPlugin('IrradianceVolume');
    const defines = {};
    plugin.prepareDefines(defines, scene);
    assert.equal(defines.IRRADIANCE_VOLUME, false);
    // Babylon learns where a plugin writes only when it is added, before anything has loaded: the points must be named already.
    assert.deepEqual(plugin.getCustomCode('fragment'), { CUSTOM_FRAGMENT_DEFINITIONS: '', CUSTOM_FRAGMENT_BEFORE_FOG: '' });
    assert.deepEqual(Object.keys(material.pluginManager._codeInjectionPoints.fragment).sort(), ['CUSTOM_FRAGMENT_BEFORE_FOG', 'CUSTOM_FRAGMENT_DEFINITIONS']);
    const manager = LightVolumeManager.for(scene);
    const layout = { min: [0, 0, 0], voxel: 0.5, dims: [4, 3, 2], range: 2 };
    manager.add('a', layout, new Uint8Array(4 * 3 * 2 * 6 * 4).fill(100), [1, 1, 1], 1, true);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.ok(manager.texture, 'the atlas exists');
    assert.equal(manager.layouts.length, 1);
    const on = {};
    plugin.prepareDefines(on, scene);
    assert.equal(on.IRRADIANCE_VOLUME, true);
    assert.equal(on.LV_VERSION, manager.version);
    const code = plugin.getCustomCode('fragment');
    assert.ok(code.CUSTOM_FRAGMENT_DEFINITIONS.includes('LV_COUNT = 1') && code.CUSTOM_FRAGMENT_BEFORE_FOG);
    assert.equal(plugin.getCustomCode('vertex'), null);
    // Self-lit materials take no light, so they keep their shader.
    const lamp = new StandardMaterial('lamp', scene);
    lamp.disableLighting = true;
    const lampDefines = {};
    lamp.pluginManager.getPlugin('IrradianceVolume').prepareDefines(lampDefines, scene);
    assert.equal(lampDefines.IRRADIANCE_VOLUME, false);
    assert.equal(lamp.pluginManager.getPlugin('IrradianceVolume').getCustomCode('fragment').CUSTOM_FRAGMENT_BEFORE_FOG, '');
    const pbrCode = new PBRMaterial('p', scene).pluginManager.getPlugin('IrradianceVolume').getCustomCode('fragment');
    assert.ok(pbrCode.CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION);
  });
});

test('the plugin hands the uniforms and the atlas to the shader when a mesh is drawn: the tints times the intensity, and the mode', async () => {
  await withScene(async (scene) => {
    registerIrradiancePlugin(true);
    const plugin = new StandardMaterial('s', scene).pluginManager.getPlugin('IrradianceVolume');
    const manager = LightVolumeManager.for(scene);
    manager.add('a', { min: [0, 0, 0], voxel: 1, dims: [2, 2, 2], range: 1 }, new Uint8Array(2 * 2 * 2 * 6 * 4), [1, 0.5, 0.25], 2, true);
    manager.add('b', { min: [9, 0, 0], voxel: 1, dims: [2, 2, 2], range: 1 }, new Uint8Array(2 * 2 * 2 * 6 * 4), [1, 1, 1], 1, true);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const calls = {}, textures = {};
    const buffer = { updateFloat4: (name, ...v) => { calls[name] = v; }, setTexture: (name, t) => { textures[name] = t; } };
    plugin.bindForSubMesh(buffer, scene, scene.getEngine(), null);
    assert.deepEqual(calls.lvT0, [2, 1, 0.5, 1]);
    assert.deepEqual(calls.lvT1, [1, 1, 1, 1]);
    assert.deepEqual(calls.lvParams.slice(0, 1), [0], 'mode on');
    assert.ok(textures.lvAtlas === manager.texture);
    manager.setMode('only');
    plugin.bindForSubMesh(buffer, scene, scene.getEngine(), null);
    assert.equal(calls.lvParams[0], 1);
    manager.setMode('off');
    plugin.bindForSubMesh(buffer, scene, scene.getEngine(), null);
    assert.equal(calls.lvParams[0], 2);
    // A volume that is switched off is not in the atlas, and the ones after it move up.
    manager.setMode('on');
    manager.update('a', [1, 1, 1], 1, false);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(manager.layouts.length, 1);
    assert.deepEqual(manager.layouts[0].min, [9, 0, 0]);
  });
});

test('a baked light is drawn live only while there is baked light to stand in for it; and the flat ambient goes out and comes back with it', async () => {
  await withScene(async (scene) => {
    const ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene);
    setAmbientBase(scene, 0.8);
    assert.equal(ambient.intensity, 0.8);
    const manager = LightVolumeManager.for(scene);
    const baked = new PointLight('baked', Vector3.Zero(), scene), live = new PointLight('live', Vector3.Zero(), scene);
    manager.registerBakedLight(baked);
    assert.equal(baked.isEnabled(), true, 'with no volume it stays lit');
    manager.add('a', { min: [0, 0, 0], voxel: 1, dims: [2, 2, 2], range: 1 }, new Uint8Array(2 * 2 * 2 * 6 * 4), [1, 1, 1], 1, true);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(baked.isEnabled(), false, 'the volume carries its light');
    assert.equal(live.isEnabled(), true, 'a live light is not touched');
    assert.equal(ambient.intensity, 0, 'and the flat ambient is gone');
    setAmbientBase(scene, 0.5);
    assert.equal(ambient.intensity, 0, 'a sky that asks for ambient does not bring it back');
    manager.setMode('off');
    assert.equal(baked.isEnabled(), true, 'looking without baked light brings the live one back');
    assert.equal(ambient.intensity, 0.5, 'and the ambient the world asked for');
    manager.setMode('on');
    manager.remove('a');
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(baked.isEnabled(), true);
    assert.equal(ambient.intensity, 0.5);
    setAmbientScale(scene, 1);
  });
});

test('a tint is read from a hex colour, and anything else is white', () => {
  assert.deepEqual(tintOf('#ff8000'), [1, 128 / 255, 0]);
  assert.deepEqual(tintOf('#ff8000cc'), [1, 128 / 255, 0]);
  assert.deepEqual(tintOf('red'), [1, 1, 1]);
  assert.deepEqual(tintOf(undefined), [1, 1, 1]);
});
