import type { Slot, SlotTree } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';
import { box, cylinder, ui } from './beatTurntableParts.ts';
import { buildShopDecor } from './polyHeavenDecor.ts';
import { MATERIAL_ORB_TAG, buildMaterialOrb } from './materialOrb.ts';
import { PRELUDE, WAND_GRIP } from '../../../../scripts/workshop-tools.mjs';

/**
 * PolyHeaven materials: a shop of materials. The panel searches the Poly Haven texture library (`ctx.net.fetchJson`), lists what
 * it finds with its thumbnails, and when one is chosen the script spawns a material orb whose `material` component points at the
 * library's own pictures (nothing is downloaded or imported: the maps are loaded from the library's CDN). The orb is an ordinary
 * object: carry it, or put it in the socket of the Material Applicator on the table, whose laser puts the material on whatever
 * it points at. A few objects to try it on stand around the room.
 *
 * Poly Haven's textures are CC0; the credit is on the panel and on a sign, as the library asks.
 */

/**
 * What the world needs to know about Poly Haven, as plain JavaScript with no dependency on the engine: how to ask for the
 * list, a search and the files of one texture, how to read the answers, and which maps to use. A world's code block cannot import
 * modules, so the rules live in one source string that the world's script embeds, and `loadPolyHavenLogic` evaluates the very
 * same text for tests.
 */
export const POLY_HAVEN_LOGIC_SOURCE = `
const PH_API = 'https://api.polyhaven.com';
const PH_THUMBS = 'https://cdn.polyhaven.com/asset_img/thumbs';
/** The sizes to look for, smallest first: 1k is plenty for a surface seen at arm's length and light on a headset. */
const PH_RESOLUTIONS = ['1k', '2k', '4k'];
const PH_FORMATS = ['jpg', 'png'];

const phFirst = (value) => Array.isArray(value) ? phFirst(value[0]) : value === undefined || value === null ? '' : String(value);

function assetsUrl() {
  return PH_API + '/assets?type=textures';
}

function searchUrl(query) {
  return PH_API + '/search?q=' + encodeURIComponent(String(query || '').trim()) + '&t=textures';
}

function filesUrl(id) {
  return PH_API + '/files/' + encodeURIComponent(id);
}

function thumbUrl(id, asset) {
  const given = asset && typeof asset.thumbnail_url === 'string' ? asset.thumbnail_url.replace(/&amp;/g, '&') : '';
  return given.startsWith('https://') ? given : PH_THUMBS + '/' + encodeURIComponent(id) + '.png?width=128&height=128';
}

/** The real size one repeat of a texture covers, in metres (the library gives it in millimetres), kept to what a surface can use. */
function sizeOf(asset) {
  const millimetres = Array.isArray(asset.dimensions) ? Number(asset.dimensions[0]) : 0;
  return millimetres > 0 ? Math.min(10, Math.max(0.1, Math.round(millimetres) / 1000)) : 1;
}

/** The textures of the library's list: { id, name, category, downloads, size, thumb }, the most downloaded first. */
function parseAssets(json) {
  if (!json || typeof json !== 'object') return [];
  return Object.keys(json)
    .filter((id) => json[id] && typeof json[id] === 'object')
    .map((id) => ({
      id: id,
      name: phFirst(json[id].name) || id,
      category: phFirst(json[id].categories),
      downloads: Number(json[id].download_count) || 0,
      size: sizeOf(json[id]),
      thumb: thumbUrl(id, json[id])
    }))
    .sort((a, b) => b.downloads - a.downloads);
}

/** The ids a search found, best first (the search names them and the list says what they are). */
function parseSearch(json) {
  const results = json && Array.isArray(json.results) ? json.results : [];
  return results.map((entry) => entry && entry.slug).filter((slug) => typeof slug === 'string' && slug);
}

/** The address of a map in the files of a texture: the smallest size that has it, as a jpg when it can. '' when it has none. */
function mapUrl(files, names) {
  for (const name of names) {
    const sizes = files && files[name];
    if (!sizes || typeof sizes !== 'object') continue;
    for (const resolution of PH_RESOLUTIONS) {
      for (const format of PH_FORMATS) {
        const file = sizes[resolution] && sizes[resolution][format];
        if (file && typeof file.url === 'string' && file.url.startsWith('https://')) return file.url;
      }
    }
  }
  return '';
}

/**
 * The maps a material needs: colour (Diffuse, or the first colour variant a texture has), normal (OpenGL) and arm (occlusion, roughness and metallic packed in red, green
 * and blue). A texture may lack some; the surface then shows what it has.
 */
function pickMaps(files) {
  return { albedo: mapUrl(files, ['Diffuse', 'diff', 'col_1', 'col_01', 'col_2']), normal: mapUrl(files, ['nor_gl']), arm: mapUrl(files, ['arm']) };
}

function clip(text, length) {
  const value = String(text || '').trim();
  return value.length > length ? value.slice(0, length - 1).trimEnd() + '\\u2026' : value;
}
`;

interface PolyHavenLogic {
	assetsUrl(): string;
	searchUrl(query: string): string;
	filesUrl(id: string): string;
	thumbUrl(id: string, asset?: unknown): string;
	parseAssets(json: unknown): { id: string; name: string; category: string; downloads: number; size: number; thumb: string }[];
	parseSearch(json: unknown): string[];
	pickMaps(files: unknown): { albedo: string; normal: string; arm: string };
	clip(text: string, length: number): string;
}

/** Evaluates the Poly Haven rules: what the world's script does at load, for code that wants to call them directly. */
export function loadPolyHavenLogic(): PolyHavenLogic {
	// eslint-disable-next-line no-new-func -- the same source text that the world's code block runs.
	return new Function(`${POLY_HAVEN_LOGIC_SOURCE}\nreturn { assetsUrl, searchUrl, filesUrl, thumbUrl, parseAssets, parseSearch, pickMaps, clip };`)() as PolyHavenLogic;
}

export const POLY_HAVEN_WORLD = {
	panelId: 'ph-panel',
	inputId: 'ph-input',
	searchId: 'ph-search',
	statusId: 'ph-status',
	prevId: 'ph-prev',
	nextId: 'ph-next',
	pageId: 'ph-page',
	rows: 6,
	rowId: (index: number) => `ph-row-${index}`,
	boxId: (index: number) => `ph-rowbox-${index}`,
	thumbId: (index: number) => `ph-thumb-${index}`,
	/** The table: the applicator on the left and, on the right, the tray where the new orbs appear. */
	tableTop: 0.8,
	tableZ: 3.1,
	toolX: -0.55,
	trayX: 0.55,
	toolId: 'ph-tool',
	socketName: 'Material Socket',
	/** Where the tool's socket sits, in the tool's own space (it points along +Z). */
	socketAt: [0, 0.075, 0.14] as [number, number, number]
} as const;

/** How the workshop's tools are held (in the fist, like a wand): the applicator is held the same way. */
const GRIP = WAND_GRIP as { position: [number, number, number]; rotation: [number, number, number] };

const TOKENS = { id: '__ID__', label: '__LABEL__' } as const;

/** The orb to copy for each material: the very same parts as every orb, with tokens where the name goes. */
function orbTemplate(): Slot[] {
	return buildMaterialOrb({ id: TOKENS.id, label: TOKENS.label });
}

const ROW_WIDTH = 880;
const THUMB = 60;
const BROWN = '#3b2a1e';
const WOOD = '#4a3224';
const WOOD_DARK = '#2b1d14';

function buildPanel(code: string): Slot[] {
	const { panelId: root, rows } = POLY_HAVEN_WORLD;
	const slots: Slot[] = [
		createSlot({
			id: root,
			name: 'PolyHeaven Materials Panel',
			position: [0, 1.6, 4.6],
			components: [{ type: 'uiPanel', width: 1000, height: 880, worldWidth: 2.2, background: '#10151c' }, { type: 'codeBlock', code }]
		}),
		ui('ph-title', root, 'text', { text: 'POLYHEAVEN MATERIALS', height: 56, fontSize: 40, fontWeight: 'bold', textAlign: 'center', color: '#7dd3fc' }),
		ui('ph-sub', root, 'text', { text: 'Pick a material to press an orb, then put it in the applicator', height: 30, fontSize: 20, textAlign: 'center', color: '#94a3b8' }),
		ui('ph-search-row', root, 'container', { width: ROW_WIDTH, height: 60, margin: 6, flexDirection: 'row', gap: 10 }),
		createSlot({
			id: POLY_HAVEN_WORLD.inputId,
			parentId: 'ph-search-row',
			name: 'Search',
			components: [{ type: 'uiElement', kind: 'input', placeholder: 'Search materials (brick, wood, metal)', width: 690, height: 56, fontSize: 24 }]
		}),
		ui(POLY_HAVEN_WORLD.searchId, 'ph-search-row', 'button', { width: 180, height: 56, text: 'Search', fontSize: 26, fontWeight: 'bold', textAlign: 'center', cornerRadius: 16, background: '#0369a1' }),
		ui(POLY_HAVEN_WORLD.statusId, root, 'text', { text: 'Loading the library...', height: 56, fontSize: 21, textAlign: 'center', color: '#e2e8f0' })
	];
	for (let index = 0; index < rows; index++) {
		slots.push(
			ui(POLY_HAVEN_WORLD.boxId(index), root, 'container', { width: ROW_WIDTH, height: THUMB + 10, margin: 2, flexDirection: 'row', gap: 10, visible: false }),
			ui(POLY_HAVEN_WORLD.thumbId(index), POLY_HAVEN_WORLD.boxId(index), 'image', { width: THUMB, height: THUMB + 4 }),
			ui(POLY_HAVEN_WORLD.rowId(index), POLY_HAVEN_WORLD.boxId(index), 'button', { width: ROW_WIDTH - THUMB - 10, height: THUMB + 4, text: '', fontSize: 22, textAlign: 'left', cornerRadius: 14, background: BROWN })
		);
	}
	slots.push(
		ui('ph-nav-row', root, 'container', { width: ROW_WIDTH, height: 60, margin: 8, flexDirection: 'row', gap: 10 }),
		ui(POLY_HAVEN_WORLD.prevId, 'ph-nav-row', 'button', { width: 200, height: 56, text: 'Previous', fontSize: 24, textAlign: 'center', cornerRadius: 16, background: '#334155' }),
		ui(POLY_HAVEN_WORLD.pageId, 'ph-nav-row', 'text', { width: 460, height: 56, text: '', fontSize: 22, textAlign: 'center', color: '#94a3b8' }),
		ui(POLY_HAVEN_WORLD.nextId, 'ph-nav-row', 'button', { width: 200, height: 56, text: 'Next', fontSize: 24, textAlign: 'center', cornerRadius: 16, background: '#334155' }),
		ui('ph-credit', root, 'text', { text: 'Textures, thumbnails and data from Poly Haven (polyhaven.com), published under CC0.', height: 30, fontSize: 17, textAlign: 'center', color: '#64748b' })
	);
	return slots;
}

/** The table under the panel: the applicator lying on its cradle, and the tray where the orbs appear. */
function buildTable(): Slot[] {
	const { tableTop: top, tableZ: z, trayX, toolX } = POLY_HAVEN_WORLD;
	return [
		box('ph-table-top', 'Table Top', [0, top - 0.02, z], [2, 0.04, 0.8], WOOD, {}, true),
		box('ph-table-edge', 'Table Edge', [0, top - 0.055, z], [2.04, 0.03, 0.84], WOOD_DARK),
		...[[-0.95, -0.35], [0.95, -0.35], [-0.95, 0.35], [0.95, 0.35]].map(([dx, dz], index) => box(`ph-table-leg-${index}`, 'Table Leg', [dx, (top - 0.02) / 2, z + dz], [0.06, top - 0.02, 0.06], WOOD_DARK, {}, true)),
		box('ph-cradle-0', 'Tool Cradle', [toolX, top + 0.015, z - 0.14], [0.14, 0.03, 0.05], '#1f2937'),
		box('ph-cradle-1', 'Tool Cradle', [toolX, top + 0.015, z + 0.2], [0.14, 0.03, 0.05], '#1f2937'),
		box('ph-tray', 'Orb Tray', [trayX, top + 0.01, z], [0.7, 0.02, 0.6], '#0f172a', {}, true),
		box('ph-tray-rim', 'Orb Tray Rim', [trayX, top + 0.025, z + 0.29], [0.7, 0.03, 0.02], '#38bdf8'),
		box('ph-tray-sign', 'Tray Label', [trayX, top + 0.021, z - 0.26], [0.5, 0.002, 0.06], '#38bdf8')
	];
}

/**
 * The Material Applicator: a hand tool with a socket for one material orb and a laser. It points along +Z, like every tool; its
 * handle is in the fist. The script is the workshop's shared prelude (aiming, the beam, what a tool may act on) and its own rules.
 */
function buildTool(): Slot[] {
	const { toolId: id, tableTop: top, tableZ: z, toolX: x, socketAt } = POLY_HAVEN_WORLD;
	const part = (name: string, position: [number, number, number], scale: [number, number, number], color: string, collider = false): Slot =>
		box(`${id}-${name.toLowerCase().replace(/\W+/g, '-')}`, name, position, scale, color, { parentId: id }, collider);
	return [
		createSlot({
			id,
			name: 'Material Applicator',
			position: [x, top + 0.075, z - 0.1],
			components: [{ type: 'container' }, { type: 'grabbable', scalable: false }, { type: 'equippable', left: GRIP, right: GRIP, autoGrip: true }, { type: 'codeBlock', code: TOOL_SCRIPT }]
		}),
		part('Handle', [0, 0, 0], [0.03, 0.03, 0.16], '#374151', true),
		part('Head', [0, 0.01, 0.14], [0.07, 0.04, 0.12], '#1e293b'),
		part('Barrel', [0, 0.01, 0.26], [0.02, 0.02, 0.14], '#94a3b8'),
		part('Lens', [0, 0.01, 0.34], [0.03, 0.03, 0.02], '#38bdf8'),
		// A shallow cup on the head: the orb sits in it.
		cylinder(`${id}-cup`, 'Orb Cup', [socketAt[0], socketAt[1] - 0.015, socketAt[2]], 0.09, 0.02, '#475569', { parentId: id }),
		cylinder(`${id}-led`, 'Status LED', [0, 0.034, 0.1], 0.015, 0.008, '#ef4444', { parentId: id }),
		createSlot({ id: `${id}-muzzle`, parentId: id, name: 'Muzzle', position: [0, 0.01, 0.36] }),
		createSlot({
			id: `${id}-socket`,
			parentId: id,
			name: POLY_HAVEN_WORLD.socketName,
			position: [...socketAt],
			components: [{ type: 'socket', accepts: [MATERIAL_ORB_TAG], radius: 0.1, snap: { position: [0, 0, 0], rotation: [0, 0, 0] }, playMedia: false }]
		})
	];
}

/** What the tool does, after the shared prelude (see workshop-tools.mjs): a laser, and the trigger puts the orb's material on what it points at, by real size. */
const TOOL_BODY = String.raw`
const LED = SELF + '-led';
const BEAM_READY = '#22c55e';
const BEAM_STOP = '#ef4444';
const BEAM_IDLE = '#f8fafc';
let ledColor = '';

// The material of the orb in the socket, laid out by its real size (the orb keeps it in its state), or null when the socket is empty.
function loaded() {
  const holder = part('Material Socket');
  const socket = holder && holder.components.find((c) => c.type === 'socket');
  const orb = socket && socket.occupantId ? ctx.hierarchy.getSlot(socket.occupantId) : null;
  if (!orb || orb.parentId !== holder.id) return null;
  const material = orb.components.find((c) => c.type === 'material');
  if (!material) return null;
  const state = orb.components.find((c) => c.type === 'scriptState');
  const size = state && state.data && Number(state.data.size) > 0 ? Number(state.data.size) : 1;
  return Object.assign({}, material, { mapping: 'world', size: size });
}

// What a material may be put on: a built-in shape that is not a tool, an avatar, an orb or a panel. The building is fair game.
function accepts(slot) {
  const mesh = slot && slot.components.find((c) => c.type === 'meshRenderer');
  if (!mesh || !mesh.meshRef || mesh.meshRef.kind !== 'builtin') return false;
  if (has(slot, 'insertable') || has(slot, 'uiPanel')) return false;
  const object = objectOf(slot.id);
  return !object || editable(object);
}

function targetOf(shot) {
  const hit = shot && shot.hit;
  const slot = hit ? ctx.hierarchy.getSlot(hit.slotId) : null;
  return accepts(slot) ? slot : null;
}

function showLed(color) {
  if (color === ledColor) return;
  ledColor = color;
  ctx.world.setComponentField(LED, 'meshRenderer', 'color', color);
}

const tool = {
  onTrigger(e) {
    if (e.phase !== 'press') return true;
    const material = loaded();
    const shot = aim();
    const target = targetOf(shot);
    if (!material || !target) { buzz(); return true; }
    // Laid out by real size, so a wall and a cube show the same grain at the same scale and nothing looks stretched.
    if (ctx.world.setComponent(target.id, material)) {
      flash(shot.hit.point, '#7dd3fc');
      beep(760);
    } else buzz();
    return true;
  },
  tick() {
    if (!ctx.world.isHost()) return;
    const material = loaded();
    showLed(material ? '#22c55e' : '#ef4444');
    const shot = aim();
    if (shot) showBeam(shot.from, shot.end, !material ? BEAM_IDLE : targetOf(shot) ? BEAM_READY : BEAM_STOP);
  }
};
`;

const TOOL_SCRIPT = `${PRELUDE}\n${TOOL_BODY.trim()}\nreturn withBench(tool);\n`;

/** The script that runs the shop, as the body of a code block. */
export const POLY_HAVEN_SCRIPT = `${POLY_HAVEN_LOGIC_SOURCE}
const ROWS = ${POLY_HAVEN_WORLD.rows};
const ROW_IDS = ${JSON.stringify(Array.from({ length: POLY_HAVEN_WORLD.rows }, (_, index) => POLY_HAVEN_WORLD.rowId(index)))};
const BOX_IDS = ${JSON.stringify(Array.from({ length: POLY_HAVEN_WORLD.rows }, (_, index) => POLY_HAVEN_WORLD.boxId(index)))};
const THUMB_IDS = ${JSON.stringify(Array.from({ length: POLY_HAVEN_WORLD.rows }, (_, index) => POLY_HAVEN_WORLD.thumbId(index)))};
const INPUT = '${POLY_HAVEN_WORLD.inputId}';
const IDS = { search: '${POLY_HAVEN_WORLD.searchId}', status: '${POLY_HAVEN_WORLD.statusId}', prev: '${POLY_HAVEN_WORLD.prevId}', next: '${POLY_HAVEN_WORLD.nextId}', page: '${POLY_HAVEN_WORLD.pageId}' };
const ORB_TEMPLATE = ${JSON.stringify(JSON.stringify(orbTemplate()))};
const TOKENS = ${JSON.stringify(TOKENS)};
const TRAY = [${POLY_HAVEN_WORLD.trayX}, ${POLY_HAVEN_WORLD.tableTop + 0.1}, ${POLY_HAVEN_WORLD.tableZ}];
const MAX_ORBS = 4;

const set = (id, field, value, broadcast) => ctx.world.setComponentField(id, 'uiElement', field, value, broadcast !== false);
const say = (text) => set(IDS.status, 'text', text);
const message = (error) => (error && error.message ? error.message : String(error));

let library = [];
let listing = [];
let query = '';
let typed = '';
let page = 1;
let request = 0;
let spawned = 0;
let orbs = [];
let ready = false;

function paintRows() {
  const from = (page - 1) * ROWS;
  const shown = listing.slice(from, from + ROWS);
  for (let i = 0; i < ROWS; i++) {
    const entry = shown[i];
    set(BOX_IDS[i], 'visible', !!entry);
    set(ROW_IDS[i], 'visible', !!entry);
    set(ROW_IDS[i], 'text', entry ? clip(entry.name, 34) + (entry.category ? '  -  ' + clip(entry.category, 18) : '') : '');
    set(THUMB_IDS[i], 'src', entry ? entry.thumb : '');
  }
  const pages = Math.max(1, Math.ceil(listing.length / ROWS));
  set(IDS.page, 'text', 'Page ' + page + ' / ' + pages);
  set(IDS.prev, 'visible', page > 1);
  set(IDS.next, 'visible', page < pages);
}

async function loadLibrary() {
  const mine = ++request;
  say('Loading the Poly Haven library...');
  try {
    const found = parseAssets(await ctx.net.fetchJson(assetsUrl()));
    if (mine !== request) return;
    library = found;
    ready = true;
    listing = library;
    paintRows();
    say(library.length + ' materials. Pick one to press an orb.');
  } catch (error) {
    if (mine === request) say('Could not load the library: ' + message(error));
  }
}

async function search() {
  if (!ready) return loadLibrary();
  const mine = ++request;
  page = 1;
  if (!query.trim()) {
    listing = library;
    paintRows();
    say(library.length + ' materials, the most downloaded first.');
    return;
  }
  say('Searching...');
  try {
    const ids = parseSearch(await ctx.net.fetchJson(searchUrl(query)));
    if (mine !== request) return;
    const byId = new Map(library.map((entry) => [entry.id, entry]));
    listing = ids.map((id) => byId.get(id)).filter(Boolean);
    paintRows();
    say(listing.length ? listing.length + ' results for "' + clip(query, 24) + '". Pick one.' : 'Nothing found. Try other words.');
  } catch (error) {
    if (mine === request) say('Search failed: ' + message(error));
  }
}

/** The orb of this material, in the tray, with the library's pictures as its maps. */
async function pressOrb(entry) {
  const mine = ++request;
  say('Loading ' + clip(entry.name, 34) + '...');
  try {
    const maps = pickMaps(await ctx.net.fetchJson(filesUrl(entry.id)));
    if (mine !== request) return;
    if (!maps.albedo && !maps.normal && !maps.arm) return say('That material has no maps this world can use. Pick another one.');
    const stamp = Date.now().toString(36) + '-' + (spawned++).toString(36);
    const plain = (text) => JSON.stringify(text).slice(1, -1);
    let text = ORB_TEMPLATE;
    for (const [token, value] of [[TOKENS.id, 'ph-orb-' + stamp], [TOKENS.label, clip(entry.name, 24)]]) text = text.split(token).join(plain(value));
    const slots = JSON.parse(text);
    const column = (spawned - 1) % 4 - 1.5;
    for (const slot of slots) {
      if (slot.parentId === null) {
        slot.position = [TRAY[0] + column * 0.16, TRAY[1], TRAY[2]];
        const material = slot.components.find((c) => c.type === 'material');
        slot.components.find((c) => c.type === 'scriptState').data.size = entry.size;
        for (const name of ['albedo', 'normal', 'arm']) if (maps[name]) material[name] = { kind: 'url', url: maps[name] };
      }
      ctx.world.spawn(slot);
    }
    orbs.push(slots[0].id);
    // The tray holds a few: the oldest one that is still lying there makes room.
    while (orbs.length > MAX_ORBS) {
      const old = orbs.shift();
      const slot = ctx.hierarchy.getSlot(old);
      if (slot && slot.parentId === null) ctx.world.deleteSlot(old);
    }
    say('Pressed "' + clip(entry.name, 34) + '". Put the orb in the applicator and aim at something.');
  } catch (error) {
    if (mine === request) say('Could not load it: ' + message(error));
  }
}

return {
  onSpawn() { loadLibrary(); },
  onUIEvent(event) {
    if (event.slotId === INPUT) {
      typed = event.text || '';
      if (event.type === 'submit') { query = typed; search(); }
      return;
    }
    if (event.type !== 'press') return;
    if (event.slotId === IDS.search) { query = typed; search(); return; }
    if (event.slotId === IDS.prev || event.slotId === IDS.next) {
      page = Math.max(1, page + (event.slotId === IDS.next ? 1 : -1));
      paintRows();
      return;
    }
    const row = ROW_IDS.indexOf(event.slotId);
    const entry = row < 0 ? null : listing[(page - 1) * ROWS + row];
    if (entry) pressOrb(entry);
  }
};
`;

/** The PolyHeaven materials world: the shop room, the search panel, the table with the applicator, and things to try it on. */
export function buildPolyHeavenMaterials(): SlotTree {
	return [
		// A glossy or metallic material shows what is around it, so the room is captured as a reflection probe, from where the orbs and
		// the applicator are (the skybox slot is where the capture is taken), and the tone is filmic, nearer to how the library shows its textures.
		createSlot({
			id: 'ph-skybox',
			name: 'Skybox',
			position: [0, 1.3, POLY_HAVEN_WORLD.tableZ],
			// The ambient light is kept low so that the ceiling lights shape the surfaces: under an even light, relief and gloss do not show.
			components: [{ type: 'skybox', topColor: '#0f172a', horizonColor: '#334155', bottomColor: '#020617', stars: 0, ambientIntensity: 0.55, reflectionCapture: true, toneMapping: 'aces' }]
		}),
		createSlot({
			id: 'ph-floor',
			name: 'Floor',
			position: [0, -0.05, 0],
			components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'ground' }, color: '#334155' }, { type: 'collider', shape: 'box' }]
		}),
		...buildPanel(POLY_HAVEN_SCRIPT),
		...buildTable(),
		...buildTool(),
		...buildShopDecor()
	];
}
