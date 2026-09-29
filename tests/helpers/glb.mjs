/** Builds small valid .glb files for tests. */
export function buildGlb({ positions = [0, 0, 0, 1, 0, 0, 0, 1, 0], indices = [0, 1, 2], nodes, extra = {}, buffers, images, extensionsUsed, extensionsRequired, version = 2, corrupt } = {}) {
  const posBytes = new Float32Array(positions);
  const idxBytes = new Uint16Array(indices);
  const idxPadded = new Uint8Array(Math.ceil(idxBytes.byteLength / 4) * 4);
  idxPadded.set(new Uint8Array(idxBytes.buffer));
  const bin = new Uint8Array(posBytes.byteLength + idxPadded.byteLength);
  bin.set(new Uint8Array(posBytes.buffer), 0);
  bin.set(idxPadded, posBytes.byteLength);

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], positions[i + k]); max[k] = Math.max(max[k], positions[i + k]); }

  const json = {
    asset: { version: version === 2 ? '2.0' : '1.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: nodes ?? [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' }
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: posBytes.byteLength }, { buffer: 0, byteOffset: posBytes.byteLength, byteLength: idxBytes.byteLength }],
    buffers: buffers ?? [{ byteLength: bin.byteLength }],
    materials: [{}],
    ...extra
  };
  if (images) json.images = images;
  if (extensionsUsed) json.extensionsUsed = extensionsUsed;
  if (extensionsRequired) json.extensionsRequired = extensionsRequired;

  const jsonText = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = new Uint8Array(Math.ceil(jsonText.byteLength / 4) * 4).fill(0x20);
  jsonPadded.set(jsonText);
  const total = 12 + 8 + jsonPadded.byteLength + 8 + bin.byteLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, corrupt === 'magic' ? 0x12345678 : 0x46546c67, true);
  view.setUint32(4, version, true);
  view.setUint32(8, corrupt === 'length' ? total + 4 : total, true);
  view.setUint32(12, jsonPadded.byteLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonPadded, 20);
  const binStart = 20 + jsonPadded.byteLength;
  view.setUint32(binStart, bin.byteLength, true);
  view.setUint32(binStart + 4, 0x004e4942, true);
  out.set(bin, binStart + 8);
  return out;
}
