// Builds src/lib/xr/templates/keyboard.json: the frame of the in-world keyboard, as slots. The keys themselves are not
// in it: they are built from the chosen layout (src/lib/xr/keyboard/layouts) each time the keyboard appears, under the
// "Keys" slot. The keyboard system fits the named parts (Body, Preview, Handle, Close) to the size of the layout;
// anything else added to the template is kept as it is. Run with `node scripts/generate-keyboard.mjs`.
//
// Keyboard space: +X to the typist's right, +Y out of the board, +Z away from the typist. The keys sit on the board
// with their tops at y = 0.012; the Body's top is y = 0.
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const I = [0, 0, 0, 1];
// The text bar stands up at the far edge, leaning back 40° from upright (a plane is seen from its -Z side).
const lean = (40 * Math.PI) / 180;
const PREVIEW_ROTATION = [Math.sin(lean / 2), 0, 0, Math.cos(lean / 2)];
const ALONG_X = [0, 0, Math.SQRT1_2, Math.SQRT1_2];

const slot = (id, parentId, name, position, rotation, scale, components) => ({ id, parentId, name, position, rotation, scale, components });
const mesh = (id, color) => ({ type: 'meshRenderer', meshRef: { kind: 'builtin', id }, ...(color ? { color } : {}) });

// Sizes are for a reference block of keys; the keyboard system refits them to the layout in use.
const slots = [
	slot('keyboard', null, 'Keyboard', [0, 0, 0], I, [1, 1, 1], [{ type: 'container' }, { type: 'grabbable', scalable: false }]),
	slot('keyboard-body', 'keyboard', 'Body', [0, -0.008, 0.02], I, [0.54, 0.016, 0.3], [mesh('box', '#0b1220')]),
	slot('keyboard-keys', 'keyboard', 'Keys', [0, 0, 0], I, [1, 1, 1], []),
	slot('keyboard-preview', 'keyboard', 'Preview', [0, 0.035, 0.14], PREVIEW_ROTATION, [0.5, 0.06, 1], [mesh('plane', '#111827')]),
	slot('keyboard-close', 'keyboard', 'Close', [0.28, 0.02, 0.14], I, [0.04, 0.012, 0.04], [mesh('box', '#7f1d1d'), { type: 'keyboardKey', key: { action: 'close', label: '✕' } }]),
	slot('keyboard-handle', 'keyboard', 'Handle', [0, 0.004, -0.13], ALONG_X, [0.018, 0.3, 0.018], [mesh('cylinder', '#334155')])
];

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../src/lib/xr/templates/keyboard.json');
writeFileSync(out, JSON.stringify(slots, null, '\t') + '\n');
console.log(`Wrote ${slots.length} slots to ${out}`);
