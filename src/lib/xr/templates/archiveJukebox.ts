import type { Slot, SlotTree } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';
import { buildDisc } from './recordDisc.ts';
import { box, ui, uiPanel } from './beatTurntableParts.ts';

/**
 * Archive Jukebox: a development world to look for music on archive.org and press it onto a record. The panel searches the
 * Internet Archive (`ctx.net.fetchJson`), lists what it finds, and when a song is chosen the script spawns a disc whose
 * `audioPlayer` points at that file (`ctx.world.spawn`). The disc is an ordinary record: put it on the player beside the
 * panel, or carry it to a turntable such as the one in Beat Turntable.
 *
 * The player stands at (0, 0, 2), facing +Z, as the desktop camera does. The panel is in front of them, the player of records
 * and the tray where new discs appear are on the table below it.
 */

/**
 * What the world needs to know about archive.org, as plain JavaScript with no dependency on the engine: how to ask for a
 * search, how to read the answer, and which files of an item are songs. A world's code block cannot import modules, so the
 * rules live in one source string that the world's script embeds, and `loadArchiveLogic` evaluates the very same text for tests.
 */
export const ARCHIVE_LOGIC_SOURCE = `
const ARCHIVE_ORIGIN = 'https://archive.org';
/** archive.org serves files from here with the CORS headers that decoding a song in the browser needs. */
const ARCHIVE_FILES = 'https://cors.archive.org/cors';
/** Formats the browser can decode, best first: MP3 is small, so it wins when an item has it. */
const AUDIO_FORMATS = ['VBR MP3', 'MP3', '128Kbps MP3', '64Kbps MP3', 'Ogg Vorbis', 'Flac', 'WAVE'];
const MAX_FILE_BYTES = 80 * 1024 * 1024;
const MAX_TRACKS = 60;

const first = (value) => Array.isArray(value) ? first(value[0]) : value === undefined || value === null ? '' : String(value);

/** Where to ask for audio items that match \`query\` (all audio, most downloaded first, when it is empty). */
function searchUrl(query, page, rows) {
  const text = String(query || '').trim();
  const q = (text ? '(' + text + ') AND ' : '') + 'mediatype:audio';
  return ARCHIVE_ORIGIN + '/advancedsearch.php?q=' + encodeURIComponent(q)
    + '&fl[]=identifier&fl[]=title&fl[]=creator&sort[]=' + encodeURIComponent('downloads desc')
    + '&rows=' + rows + '&page=' + page + '&output=json';
}

/** The items of a search answer: { id, title, creator }. */
function parseSearch(json) {
  const response = json && json.response;
  const docs = response && Array.isArray(response.docs) ? response.docs : [];
  return {
    total: response && Number.isFinite(response.numFound) ? response.numFound : docs.length,
    items: docs.filter((doc) => doc && doc.identifier).map((doc) => ({ id: String(doc.identifier), title: first(doc.title) || String(doc.identifier), creator: first(doc.creator) }))
  };
}

function baseName(name) {
  const slash = name.lastIndexOf('/');
  const file = slash >= 0 ? name.slice(slash + 1) : name;
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}

/**
 * The songs of an item's metadata: { name, title, format, size }, in file order. Only the best format the item has is kept (the
 * list above, MP3 first), so a song is not listed once per copy. Files too big to decode comfortably are left out.
 */
function audioFiles(meta) {
  const files = meta && Array.isArray(meta.files) ? meta.files : [];
  const usable = files.filter((file) => file && file.name && AUDIO_FORMATS.includes(file.format) && !(Number(file.size) > MAX_FILE_BYTES));
  const rank = (file) => AUDIO_FORMATS.indexOf(file.format);
  const best = usable.reduce((found, file) => (found === -1 || rank(file) < found ? rank(file) : found), -1);
  if (best === -1) return [];
  const chosen = usable.filter((file) => rank(file) === best);
  return chosen
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, MAX_TRACKS)
    .map((file) => ({ name: String(file.name), title: first(file.title) || baseName(String(file.name)), format: String(file.format), size: Number(file.size) || 0 }));
}

function metadataUrl(id) {
  return ARCHIVE_ORIGIN + '/metadata/' + encodeURIComponent(id);
}

/** The address of a file of an item: each part of its path is escaped on its own. */
function fileUrl(id, name) {
  return ARCHIVE_FILES + '/' + encodeURIComponent(id) + '/' + String(name).split('/').map(encodeURIComponent).join('/');
}

/** A number from a text, always the same for the same text: picks a colour for an item. */
function hashText(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clip(text, length) {
  const value = String(text || '').trim();
  return value.length > length ? value.slice(0, length - 1).trimEnd() + '\\u2026' : value;
}
`;

interface ArchiveLogic {
	searchUrl(query: string, page: number, rows: number): string;
	parseSearch(json: unknown): { total: number; items: { id: string; title: string; creator: string }[] };
	audioFiles(meta: unknown): { name: string; title: string; format: string; size: number }[];
	metadataUrl(id: string): string;
	fileUrl(id: string, name: string): string;
	clip(text: string, length: number): string;
	hashText(text: string): number;
}

/** Evaluates the archive rules: what the world's script does at load, for code that wants to call them directly. */
export function loadArchiveLogic(): ArchiveLogic {
	// eslint-disable-next-line no-new-func -- the same source text that the world's code block runs.
	return new Function(`${ARCHIVE_LOGIC_SOURCE}\nreturn { searchUrl, parseSearch, audioFiles, metadataUrl, fileUrl, clip, hashText };`)() as ArchiveLogic;
}

export const ARCHIVE_JUKEBOX = {
	panelId: 'aj-panel',
	inputId: 'aj-input',
	searchId: 'aj-search',
	statusId: 'aj-status',
	prevId: 'aj-prev',
	backId: 'aj-back',
	nextId: 'aj-next',
	pageId: 'aj-page',
	rows: 6,
	rowId: (index: number) => `aj-row-${index}`,
	/** The table: a record player on the left and, on the right, the tray where the new discs appear. */
	tableTop: 0.8,
	tableZ: 3.1,
	playerX: -0.5,
	trayX: 0.5
} as const;

/** Colours for the labels of the discs: one is picked from the item's name, so an item always gets the same one. */
const LABEL_COLORS = ['#9f1239', '#0f766e', '#1d4ed8', '#a16207', '#7e22ce', '#be185d', '#047857', '#c2410c'];

const TOKENS = { id: '__ID__', title: '__TITLE__', author: '__AUTHOR__', url: '__URL__', color: '__COLOR__' } as const;

/** The disc to copy for each song: the very same parts as every other record, with tokens where the song goes. */
function discTemplate(): Slot[] {
	return buildDisc({ id: TOKENS.id, title: TOKENS.title, author: TOKENS.author, labelColor: TOKENS.color, source: { kind: 'url', url: TOKENS.url } });
}

const ROW_WIDTH = 940;

function buildPanel(code: string): Slot[] {
	const { panelId: root, rows } = ARCHIVE_JUKEBOX;
	const slots: Slot[] = [
		createSlot({
			id: root,
			name: 'Archive Jukebox Panel',
			position: [0, 1.6, 4.6],
			components: [{ type: 'uiPanel', width: 1000, height: 780, worldWidth: 2.2, background: '#0b1020' }, { type: 'codeBlock', code }]
		}),
		ui('aj-title', root, 'text', { text: 'ARCHIVE JUKEBOX', height: 56, fontSize: 42, fontWeight: 'bold', textAlign: 'center', color: '#fbbf24' }),
		ui('aj-sub', root, 'text', { text: 'Find a song on archive.org and press it onto a disc', height: 30, fontSize: 20, textAlign: 'center', color: '#94a3b8' }),
		ui('aj-search-row', root, 'container', { width: ROW_WIDTH, height: 60, margin: 6, flexDirection: 'row', gap: 10 }),
		createSlot({
			id: ARCHIVE_JUKEBOX.inputId,
			parentId: 'aj-search-row',
			name: 'Search',
			components: [{ type: 'uiElement', kind: 'input', placeholder: 'Search music (artist, song, genre)', width: 740, height: 56, fontSize: 24 }]
		}),
		ui(ARCHIVE_JUKEBOX.searchId, 'aj-search-row', 'button', { width: 190, height: 56, text: 'Search', fontSize: 26, fontWeight: 'bold', textAlign: 'center', cornerRadius: 16, background: '#d97706' }),
		ui(ARCHIVE_JUKEBOX.statusId, root, 'text', { text: 'Type something and press Search, or Search with an empty box for the most popular music.', height: 56, fontSize: 21, textAlign: 'center', color: '#e2e8f0' })
	];
	for (let index = 0; index < rows; index++) {
		slots.push(ui(ARCHIVE_JUKEBOX.rowId(index), root, 'button', { width: ROW_WIDTH, height: 64, margin: 3, text: '', fontSize: 22, textAlign: 'left', cornerRadius: 14, background: '#1e293b', visible: false }));
	}
	slots.push(
		ui('aj-nav-row', root, 'container', { width: ROW_WIDTH, height: 60, margin: 8, flexDirection: 'row', gap: 10 }),
		ui(ARCHIVE_JUKEBOX.prevId, 'aj-nav-row', 'button', { width: 220, height: 56, text: 'Previous', fontSize: 24, textAlign: 'center', cornerRadius: 16, background: '#374151' }),
		ui(ARCHIVE_JUKEBOX.backId, 'aj-nav-row', 'button', { width: 220, height: 56, text: 'Back to results', fontSize: 22, textAlign: 'center', cornerRadius: 16, background: '#374151', visible: false }),
		ui(ARCHIVE_JUKEBOX.pageId, 'aj-nav-row', 'text', { width: 240, height: 56, text: '', fontSize: 22, textAlign: 'center', color: '#94a3b8' }),
		ui(ARCHIVE_JUKEBOX.nextId, 'aj-nav-row', 'button', { width: 220, height: 56, text: 'Next', fontSize: 24, textAlign: 'center', cornerRadius: 16, background: '#374151' })
	);
	return slots;
}

/** The table under the panel: a record player (a socket that plays the disc put on it) and the tray for new discs. */
function buildTable(): Slot[] {
	const { tableTop: top, tableZ: z, playerX, trayX } = ARCHIVE_JUKEBOX;
	return [
		box('aj-table-top', 'Table Top', [0, top - 0.02, z], [1.7, 0.04, 0.8], '#4a3224', {}, true),
		...[[-0.8, -0.35], [0.8, -0.35], [-0.8, 0.35], [0.8, 0.35]].map(([dx, dz], index) => box(`aj-table-leg-${index}`, 'Table Leg', [dx, (top - 0.02) / 2, z + dz], [0.05, top - 0.02, 0.05], '#1f2937', {}, true)),
		box('aj-player-base', 'Record Player', [playerX, top + 0.04, z], [0.7, 0.08, 0.6], '#111827', {}, true),
		box('aj-tray', 'Disc Tray', [trayX, top + 0.01, z], [0.7, 0.02, 0.6], '#7c2d12', {}, true),
		box('aj-tray-sign', 'Tray Label', [trayX, top + 0.021, z - 0.26], [0.5, 0.002, 0.06], '#fbbf24'),
		createSlot({
			id: 'aj-socket',
			name: 'Record Player Socket',
			position: [playerX, top + 0.087, z],
			components: [{ type: 'socket', accepts: ['disc'], radius: 0.25, snap: { position: [0, 0, 0], rotation: [0, 0, 0] } }]
		})
	];
}

/** The script that runs the jukebox, as the body of a code block. */
export const ARCHIVE_JUKEBOX_SCRIPT = `${ARCHIVE_LOGIC_SOURCE}
const ROWS = ${ARCHIVE_JUKEBOX.rows};
const ROW_IDS = ${JSON.stringify(Array.from({ length: ARCHIVE_JUKEBOX.rows }, (_, index) => ARCHIVE_JUKEBOX.rowId(index)))};
const INPUT = '${ARCHIVE_JUKEBOX.inputId}';
const IDS = { search: '${ARCHIVE_JUKEBOX.searchId}', status: '${ARCHIVE_JUKEBOX.statusId}', prev: '${ARCHIVE_JUKEBOX.prevId}', back: '${ARCHIVE_JUKEBOX.backId}', next: '${ARCHIVE_JUKEBOX.nextId}', page: '${ARCHIVE_JUKEBOX.pageId}' };
const DISC_TEMPLATE = ${JSON.stringify(JSON.stringify(discTemplate()))};
const LABEL_COLORS = ${JSON.stringify(LABEL_COLORS)};
const TRAY = [${ARCHIVE_JUKEBOX.trayX}, ${ARCHIVE_JUKEBOX.tableTop + 0.03}, ${ARCHIVE_JUKEBOX.tableZ}];
const TOKENS = ${JSON.stringify(TOKENS)};

const set = (id, field, value, broadcast) => ctx.world.setComponentField(id, 'uiElement', field, value, broadcast !== false);
const say = (text) => set(IDS.status, 'text', text);
const message = (error) => (error && error.message ? error.message : String(error));

let query = '';
let typed = '';
let mode = 'results';
let page = 1;
let total = 0;
let items = [];
let item = null;
let tracks = [];
let trackPage = 0;
let request = 0;
let spawned = 0;

function paintRows(labels) {
  for (let i = 0; i < ROWS; i++) {
    set(ROW_IDS[i], 'visible', i < labels.length);
    set(ROW_IDS[i], 'text', labels[i] || '');
  }
}

function paintNav(pageText, canPrev, canNext, canBack) {
  set(IDS.page, 'text', pageText);
  set(IDS.prev, 'visible', canPrev);
  set(IDS.next, 'visible', canNext);
  set(IDS.back, 'visible', canBack);
}

function showResults() {
  mode = 'results';
  paintRows(items.map((entry) => clip(entry.title, 44) + (entry.creator ? '  -  ' + clip(entry.creator, 24) : '')));
  const pages = Math.max(1, Math.ceil(total / ROWS));
  paintNav('Page ' + page + ' / ' + pages, page > 1, page < pages, false);
}

function showTracks() {
  mode = 'tracks';
  const from = trackPage * ROWS;
  paintRows(tracks.slice(from, from + ROWS).map((track, index) => String(from + index + 1) + '.  ' + clip(track.title, 52)));
  const pages = Math.max(1, Math.ceil(tracks.length / ROWS));
  paintNav((trackPage + 1) + ' / ' + pages, trackPage > 0, trackPage < pages - 1, true);
}

async function search(nextPage) {
  const mine = ++request;
  page = nextPage;
  say('Searching archive.org...');
  try {
    const found = parseSearch(await ctx.net.fetchJson(searchUrl(query, page, ROWS)));
    if (mine !== request) return;
    items = found.items;
    total = found.total;
    showResults();
    say(items.length ? total + ' results. Pick one.' : 'Nothing found. Try other words.');
  } catch (error) {
    if (mine === request) say('Search failed: ' + message(error));
  }
}

async function openItem(entry) {
  const mine = ++request;
  say('Loading ' + clip(entry.title, 40) + '...');
  try {
    const files = audioFiles(await ctx.net.fetchJson(metadataUrl(entry.id)));
    if (mine !== request) return;
    if (!files.length) return say('No playable audio in that item. Pick another one.');
    item = entry;
    tracks = files;
    if (files.length === 1) return makeDisc(files[0]);
    trackPage = 0;
    showTracks();
    say(clip(entry.title, 50) + ': pick a song.');
  } catch (error) {
    if (mine === request) say('Could not load it: ' + message(error));
  }
}

/** A copy of the disc template for this song, with its own ids, in the tray. */
function makeDisc(track) {
  const stamp = Date.now().toString(36) + '-' + (spawned++).toString(36);
  const title = clip(track.title, 34);
  const author = clip(item.creator || item.title, 30);
  const color = LABEL_COLORS[hashText(item.id) % LABEL_COLORS.length];
  const plain = (text) => JSON.stringify(text).slice(1, -1);
  let text = DISC_TEMPLATE;
  for (const [token, value] of [[TOKENS.id, 'aj-disc-' + stamp], [TOKENS.title, title], [TOKENS.author, author], [TOKENS.url, fileUrl(item.id, track.name)], [TOKENS.color, color]]) {
    text = text.split(token).join(plain(value));
  }
  const slots = JSON.parse(text);
  const column = (spawned - 1) % 3 - 1;
  for (const slot of slots) {
    if (slot.parentId === null) slot.position = [TRAY[0] + column * 0.2, TRAY[1] + 0.02 * ((spawned - 1) % 5), TRAY[2]];
    ctx.world.spawn(slot);
  }
  say('Pressed "' + title + '". The disc is on the tray: put it on the player.');
}

return {
  onUIEvent(event) {
    if (event.slotId === INPUT) {
      typed = event.text || '';
      if (event.type === 'submit') { query = typed; search(1); }
      return;
    }
    if (event.type !== 'press') return;
    if (event.slotId === IDS.search) { query = typed; search(1); return; }
    if (event.slotId === IDS.back) { showResults(); say('Pick one.'); return; }
    if (event.slotId === IDS.prev || event.slotId === IDS.next) {
      const step = event.slotId === IDS.next ? 1 : -1;
      if (mode === 'results') search(page + step);
      else { trackPage += step; showTracks(); }
      return;
    }
    const row = ROW_IDS.indexOf(event.slotId);
    if (row < 0) return;
    if (mode === 'results') { if (items[row]) openItem(items[row]); }
    else { const track = tracks[trackPage * ROWS + row]; if (track) makeDisc(track); }
  }
};
`;

/** The Archive Jukebox world: the search panel and the table where the discs appear. */
export function buildArchiveJukebox(): SlotTree {
	return [
		createSlot({ id: 'aj-skybox', name: 'Skybox', components: [{ type: 'skybox', topColor: '#0f172a', horizonColor: '#78350f', bottomColor: '#020617', stars: 0.3 }] }),
		createSlot({
			id: 'aj-floor',
			name: 'Floor',
			position: [0, -0.05, 0],
			components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'ground' }, color: '#27272a' }, { type: 'collider', shape: 'box' }]
		}),
		...buildPanel(ARCHIVE_JUKEBOX_SCRIPT),
		...buildTable()
	];
}
