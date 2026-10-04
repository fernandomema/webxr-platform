import type { Slot, SlotTree } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';
import { buildDisc } from './recordDisc.ts';
import { box, cylinder, group, ui } from './beatTurntableParts.ts';
import { buildArchiveDecor } from './archiveJukeboxDecor.ts';

/**
 * Archive.org Sounds (the Archive Jukebox): a development world to look for music on archive.org and press it onto a record. The panel searches the
 * Internet Archive (`ctx.net.fetchJson`), lists what it finds, and when a song is chosen the script spawns a disc whose
 * `audioPlayer` points at that file (`ctx.world.spawn`), with the item's archive.org cover on its centre label. The disc is an ordinary record: put it on the player beside the
 * panel, or carry it to a turntable such as the one in Beat Turntable.
 *
 * The player stands at (0, 0, 2), facing +Z, as the desktop camera does. The panel is in front of them, the player of records
 * and the tray where new discs appear are on the table below it. The room is a record library (see archiveJukeboxDecor.ts), and
 * the player is a turntable that spins whatever disc sits on it while the tonearm swings over it.
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

/**
 * The cover archive.org keeps for an item: the thumbnail it makes from the item's own art, as a file of the item. It is read
 * from the CORS host because /services/img sends no CORS headers, and a texture of the panel needs them.
 */
function coverUrl(id) {
  return ARCHIVE_FILES + '/' + encodeURIComponent(id) + '/__ia_thumb.jpg';
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
	coverUrl(id: string): string;
	fileUrl(id: string, name: string): string;
	clip(text: string, length: number): string;
	hashText(text: string): number;
}

/** Evaluates the archive rules: what the world's script does at load, for code that wants to call them directly. */
export function loadArchiveLogic(): ArchiveLogic {
	// eslint-disable-next-line no-new-func -- the same source text that the world's code block runs.
	return new Function(`${ARCHIVE_LOGIC_SOURCE}\nreturn { searchUrl, parseSearch, audioFiles, metadataUrl, coverUrl, fileUrl, clip, hashText };`)() as ArchiveLogic;
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
	nowId: 'aj-now',
	socketId: 'aj-socket',
	armId: 'aj-arm-pivot',
	ledId: 'aj-led',
	rows: 6,
	rowId: (index: number) => `aj-row-${index}`,
	/** Each row is a box with the cover of its item (the thumb) and the button. */
	boxId: (index: number) => `aj-rowbox-${index}`,
	thumbId: (index: number) => `aj-thumb-${index}`,
	/** The table: a record player on the left and, on the right, the tray where the new discs appear. */
	tableTop: 0.8,
	tableZ: 3.1,
	playerX: -0.55,
	trayX: 0.55
} as const;

/** Colours for the labels of the discs: one is picked from the item's name, so an item always gets the same one. */
const LABEL_COLORS = ['#9f1239', '#0f766e', '#1d4ed8', '#a16207', '#7e22ce', '#be185d', '#047857', '#c2410c'];

const TOKENS = { id: '__ID__', title: '__TITLE__', author: '__AUTHOR__', url: '__URL__', color: '__COLOR__', image: '__IMAGE__' } as const;

/** The disc to copy for each song: the very same parts as every other record, with tokens where the song goes. */
function discTemplate(): Slot[] {
	return buildDisc({ id: TOKENS.id, title: TOKENS.title, author: TOKENS.author, labelColor: TOKENS.color, labelImage: TOKENS.image, source: { kind: 'url', url: TOKENS.url } });
}

/** The panel lays its content out in 92% of its width (920 px of 1000), so every row stays inside that. */
const ROW_WIDTH = 880;
const THUMB = 60;

function buildPanel(code: string): Slot[] {
	const { panelId: root, rows } = ARCHIVE_JUKEBOX;
	const slots: Slot[] = [
		createSlot({
			id: root,
			name: 'Archive.org Sounds Panel',
			position: [0, 1.6, 4.6],
			components: [{ type: 'uiPanel', width: 1000, height: 900, worldWidth: 2.2, background: '#1a110c' }, { type: 'codeBlock', code }]
		}),
		ui('aj-title', root, 'text', { text: 'ARCHIVE.ORG SOUNDS', height: 56, fontSize: 42, fontWeight: 'bold', textAlign: 'center', color: '#fbbf24' }),
		ui('aj-sub', root, 'text', { text: 'Music from the Internet Archive (archive.org): press a song onto a disc', height: 30, fontSize: 20, textAlign: 'center', color: '#c8b08a' }),
		ui(ARCHIVE_JUKEBOX.nowId, root, 'text', { text: 'Now playing: nothing. Put a disc on the player.', height: 36, fontSize: 22, textAlign: 'center', color: '#fde68a' }),
		ui('aj-search-row', root, 'container', { width: ROW_WIDTH, height: 60, margin: 6, flexDirection: 'row', gap: 10 }),
		createSlot({
			id: ARCHIVE_JUKEBOX.inputId,
			parentId: 'aj-search-row',
			name: 'Search',
			components: [{ type: 'uiElement', kind: 'input', placeholder: 'Search music (artist, song, genre)', width: 690, height: 56, fontSize: 24 }]
		}),
		ui(ARCHIVE_JUKEBOX.searchId, 'aj-search-row', 'button', { width: 180, height: 56, text: 'Search', fontSize: 26, fontWeight: 'bold', textAlign: 'center', cornerRadius: 16, background: '#b45309' }),
		ui(ARCHIVE_JUKEBOX.statusId, root, 'text', { text: 'Type something and press Search, or Search with an empty box for the most popular music.', height: 56, fontSize: 21, textAlign: 'center', color: '#f5e6c4' })
	];
	for (let index = 0; index < rows; index++) {
		slots.push(
			ui(ARCHIVE_JUKEBOX.boxId(index), root, 'container', { width: ROW_WIDTH, height: THUMB + 10, margin: 2, flexDirection: 'row', gap: 10, visible: false }),
			ui(ARCHIVE_JUKEBOX.thumbId(index), ARCHIVE_JUKEBOX.boxId(index), 'image', { width: THUMB, height: THUMB + 4 }),
			ui(ARCHIVE_JUKEBOX.rowId(index), ARCHIVE_JUKEBOX.boxId(index), 'button', { width: ROW_WIDTH - THUMB - 10, height: THUMB + 4, text: '', fontSize: 22, textAlign: 'left', cornerRadius: 14, background: '#3b2a1e' })
		);
	}
	slots.push(
		ui('aj-nav-row', root, 'container', { width: ROW_WIDTH, height: 60, margin: 8, flexDirection: 'row', gap: 10 }),
		ui(ARCHIVE_JUKEBOX.prevId, 'aj-nav-row', 'button', { width: 200, height: 56, text: 'Previous', fontSize: 24, textAlign: 'center', cornerRadius: 16, background: '#5b4330' }),
		ui(ARCHIVE_JUKEBOX.backId, 'aj-nav-row', 'button', { width: 200, height: 56, text: 'Back to results', fontSize: 22, textAlign: 'center', cornerRadius: 16, background: '#5b4330', visible: false }),
		ui(ARCHIVE_JUKEBOX.pageId, 'aj-nav-row', 'text', { width: 200, height: 56, text: '', fontSize: 22, textAlign: 'center', color: '#94a3b8' }),
		ui(ARCHIVE_JUKEBOX.nextId, 'aj-nav-row', 'button', { width: 200, height: 56, text: 'Next', fontSize: 24, textAlign: 'center', cornerRadius: 16, background: '#5b4330' }),
		ui('aj-credit', root, 'text', { text: 'Music, covers and metadata courtesy of the Internet Archive (archive.org). Each recording belongs to its uploader and rights holder.', height: 30, fontSize: 16, textAlign: 'center', color: '#8a7455' })
	);
	return slots;
}

/** The table under the panel: a turntable (a socket that plays the disc put on it) and the tray for new discs. */
function buildTable(): Slot[] {
	const { tableTop: top, tableZ: z, playerX: x, trayX } = ARCHIVE_JUKEBOX;
	const above = (height: number) => top + height;
	const WOOD = '#4a3224';
	return [
		box('aj-table-top', 'Table Top', [0, top - 0.02, z], [2, 0.04, 0.8], WOOD, {}, true),
		box('aj-table-edge', 'Table Edge', [0, top - 0.055, z], [2.04, 0.03, 0.84], '#2b1d14'),
		...[[-0.95, -0.35], [0.95, -0.35], [-0.95, 0.35], [0.95, 0.35]].map(([dx, dz], index) => box(`aj-table-leg-${index}`, 'Table Leg', [dx, (top - 0.02) / 2, z + dz], [0.06, top - 0.02, 0.06], '#2b1d14', {}, true)),
		box('aj-table-shelf', 'Table Shelf', [0, 0.25, z], [1.9, 0.03, 0.7], '#2b1d14'),
		box('aj-player-base', 'Turntable Plinth', [x, above(0.04), z], [0.78, 0.08, 0.58], '#111827', {}, true),
		box('aj-player-trim', 'Turntable Trim', [x, above(0.081), z], [0.8, 0.004, 0.6], '#d4a017'),
		cylinder('aj-platter', 'Turntable Platter', [x, above(0.087), z], 0.36, 0.014, '#9ca3af'),
		cylinder('aj-mat', 'Turntable Mat', [x, above(0.096), z], 0.33, 0.004, '#171717'),
		cylinder('aj-spindle', 'Spindle', [x, above(0.112), z], 0.008, 0.026, '#e5e7eb'),
		cylinder('aj-arm-base', 'Tonearm Base', [x + 0.27, above(0.1), z + 0.17], 0.06, 0.035, '#d4d4d8'),
		// The arm swings on its base: parked beside the platter, and over the record while one is on.
		group(ARCHIVE_JUKEBOX.armId, 'Tonearm Pivot', [x + 0.27, above(0.122), z + 0.17]),
		box('aj-arm', 'Tonearm', [0, 0, -0.14], [0.012, 0.012, 0.3], '#e5e7eb', { parentId: ARCHIVE_JUKEBOX.armId }),
		box('aj-arm-head', 'Tonearm Head', [0, -0.004, -0.3], [0.024, 0.014, 0.04], '#27272a', { parentId: ARCHIVE_JUKEBOX.armId }),
		box('aj-arm-weight', 'Tonearm Weight', [0, 0, 0.04], [0.034, 0.034, 0.034], '#a1a1aa', { parentId: ARCHIVE_JUKEBOX.armId }),
		cylinder(ARCHIVE_JUKEBOX.ledId, 'Status LED', [x - 0.3, above(0.085), z - 0.22], 0.02, 0.01, '#22c55e'),
		cylinder('aj-knob-0', 'Turntable Knob', [x - 0.3, above(0.085), z - 0.1], 0.045, 0.02, '#d4d4d8'),
		cylinder('aj-knob-1', 'Turntable Knob', [x - 0.3, above(0.085), z], 0.045, 0.02, '#d4d4d8'),
		// The disc sits at the socket's origin, on the mat.
		createSlot({
			id: ARCHIVE_JUKEBOX.socketId,
			name: 'Record Player Socket',
			position: [x, above(0.107), z],
			components: [{ type: 'socket', accepts: ['disc'], radius: 0.25, snap: { position: [0, 0, 0], rotation: [0, 0, 0] } }]
		}),
		box('aj-tray', 'Disc Tray', [trayX, top + 0.01, z], [0.7, 0.02, 0.6], '#7c2d12', {}, true),
		box('aj-tray-rim', 'Disc Tray Rim', [trayX, top + 0.025, z + 0.29], [0.7, 0.03, 0.02], '#d4a017'),
		box('aj-tray-sign', 'Tray Label', [trayX, top + 0.021, z - 0.26], [0.5, 0.002, 0.06], '#fbbf24')
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
const NOW = '${ARCHIVE_JUKEBOX.nowId}';
const BOX_IDS = ${JSON.stringify(Array.from({ length: ARCHIVE_JUKEBOX.rows }, (_, index) => ARCHIVE_JUKEBOX.boxId(index)))};
const THUMB_IDS = ${JSON.stringify(Array.from({ length: ARCHIVE_JUKEBOX.rows }, (_, index) => ARCHIVE_JUKEBOX.thumbId(index)))};
const SOCKET = '${ARCHIVE_JUKEBOX.socketId}';
const ARM = '${ARCHIVE_JUKEBOX.armId}';
const LED = '${ARCHIVE_JUKEBOX.ledId}';
const ARM_PLAYING = 0.62;
const DISC_SPIN = 3.49;

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
let seated = '';
let armAngle = 0;
let discAngle = 0;
let ledColor = '';

/** Fills the rows: a label and a cover (an address, or '' for none) for each. */
function paintRows(labels, covers) {
  for (let i = 0; i < ROWS; i++) {
    const shown = i < labels.length;
    set(BOX_IDS[i], 'visible', shown);
    set(ROW_IDS[i], 'visible', shown);
    set(ROW_IDS[i], 'text', labels[i] || '');
    set(THUMB_IDS[i], 'src', shown ? covers[i] : '');
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
  paintRows(items.map((entry) => clip(entry.title, 40) + (entry.creator ? '  -  ' + clip(entry.creator, 22) : '')), items.map((entry) => coverUrl(entry.id)));
  const pages = Math.max(1, Math.ceil(total / ROWS));
  paintNav('Page ' + page + ' / ' + pages, page > 1, page < pages, false);
}

function showTracks() {
  mode = 'tracks';
  const from = trackPage * ROWS;
  paintRows(tracks.slice(from, from + ROWS).map((track, index) => String(from + index + 1) + '.  ' + clip(track.title, 46)), tracks.slice(from, from + ROWS).map(() => coverUrl(item.id)));
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
  for (const [token, value] of [[TOKENS.id, 'aj-disc-' + stamp], [TOKENS.title, title], [TOKENS.author, author], [TOKENS.url, fileUrl(item.id, track.name)], [TOKENS.color, color], [TOKENS.image, coverUrl(item.id)]]) {
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

function socketOccupant() {
  const slot = ctx.hierarchy.getSlot(SOCKET);
  const socket = slot && slot.components.find((c) => c.type === 'socket');
  return (socket && socket.occupantId) || '';
}

/** Says what is on the player now. */
function paintNow(id) {
  const slot = id ? ctx.hierarchy.getSlot(id) : null;
  const info = slot && slot.components.find((c) => c.type === 'recordDisc');
  set(NOW, 'text', slot ? 'Now playing: ' + clip(info && info.title ? info.title : slot.name, 40) : 'Now playing: nothing. Put a disc on the player.');
}

/** The player at work: the record spins, the arm comes down onto it and the light turns red while a disc is on. */
function playerTick(dt) {
  const occupant = socketOccupant();
  if (occupant !== seated) { seated = occupant; paintNow(occupant); }
  const target = seated ? ARM_PLAYING : 0;
  if (Math.abs(target - armAngle) > 0.002) {
    armAngle += (target - armAngle) * Math.min(1, dt * 2.5);
    ctx.world.setWorldPose(ARM, { rotation: ctx.math.quatFromAxisAngle([0, 1, 0], armAngle) }, false);
  }
  if (seated) {
    discAngle = (discAngle + dt * DISC_SPIN) % (Math.PI * 2);
    ctx.world.setWorldPose(seated, { rotation: ctx.math.quatFromAxisAngle([0, 1, 0], discAngle) }, false);
  }
  const color = seated ? '#ef4444' : '#22c55e';
  if (color !== ledColor) { ledColor = color; ctx.world.setComponentField(LED, 'meshRenderer', 'color', color, false); }
}

return {
  tick(dt) { playerTick(dt); },
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

/** The Archive.org Sounds world: the search panel and the table where the discs appear. */
export function buildArchiveJukebox(): SlotTree {
	return [
		createSlot({ id: 'aj-skybox', name: 'Skybox', components: [{ type: 'skybox', topColor: '#1c1410', horizonColor: '#4a3224', bottomColor: '#0c0806', stars: 0 }] }),
		createSlot({
			id: 'aj-floor',
			name: 'Floor',
			position: [0, -0.05, 0],
			components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'ground' }, color: '#2b1d14' }, { type: 'collider', shape: 'box' }]
		}),
		...buildPanel(ARCHIVE_JUKEBOX_SCRIPT),
		...buildTable(),
		...buildArchiveDecor(ARCHIVE_JUKEBOX.tableTop, ARCHIVE_JUKEBOX.tableZ)
	];
}
