import type { SlotTree } from '$lib/ecs/types';
import { createSlot } from '$lib/ecs/types';
import lobby from './lobby.json';
import workshop from './workshop.json';
import popUpStore from './popUpStore.json';
import pulse from './pulse.json';
import avatarShowcase from './avatarShowcase.json';

/** The worlds that ship with the app: always there to go to, and the starting points for the Studio's world templates. */
export interface BuiltinWorld {
	id: 'lobby' | 'workshop' | 'pop-up-store' | 'pulse' | 'avatarShowcase' | 'archive-film-test';
	name: string;
	description: string;
	scene: SlotTree;
}

export const BUILTIN_WORLDS: readonly BuiltinWorld[] = [
	{
		id: 'archive-film-test',
		name: 'Archive.org Film Test',
		description: 'Watch Night of the Living Dead (1968), streamed from Internet Archive.',
		scene: [
			createSlot({
				id: 'archive-film-floor',
				name: 'Floor',
				position: [0, -0.05, 0],
				components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'ground' }, color: '#27272a' }, { type: 'collider', shape: 'box' }]
			}),
			createSlot({
				id: 'archive-film-room',
				name: 'Film screen',
				position: [0, 1.65, -2.4],
				components: [
					{ type: 'uiPanel', width: 1280, height: 800, worldWidth: 3.2, background: '#09090b' },
					{ type: 'uiElement', kind: 'container', flexDirection: 'column', gap: 0, padding: 0, width: 1130, height: 688 },
					{ type: 'codeBlock', code: `
const VIDEO = 'archive-film-video';
const set = (id, field, value, broadcast = true) => ctx.world.setComponentField(id, 'uiElement', field, value, broadcast);
let volume = 1;
let muted = true;
let elapsed = 0;
function clock(value) {
  if (!Number.isFinite(value) || value < 0) return '--:--';
  const seconds = Math.floor(value);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours ? hours + ':' + String(minutes).padStart(2, '0') + ':' + String(remainder).padStart(2, '0') : minutes + ':' + String(remainder).padStart(2, '0');
}
return {
  tick(dt) {
    elapsed += dt;
    if (elapsed < 1) return;
    elapsed = 0;
    const media = ctx.ui.getMedia(VIDEO);
    if (!media) return;
    const duration = media.duration || 0;
    const current = media.currentTime || 0;
    set('archive-film-play-pause', 'text', media.paused ? 'Play' : 'Pause', false);
    set('archive-film-mute', 'text', muted ? 'Unmute' : 'Mute', false);
    set('archive-film-time', 'text', clock(current) + ' / ' + clock(duration), false);
    set('archive-film-seek-slider', 'value', current, false);
    set('archive-film-volume', 'text', Math.round(volume * 100) + '%', false);
  },
  onUIEvent(event) {
    if (event.type === 'submit' && event.slotId === 'archive-film-seek-slider' && Number.isFinite(event.value)) {
      const media = ctx.ui.getMedia(VIDEO);
      if (media?.duration) {
        const target = Math.max(0, Math.min(media.duration, event.value));
        set(VIDEO, 'currentTime', target);
        set('archive-film-seek-slider', 'value', target);
        set('archive-film-status', 'text', 'Seeking to ' + clock(target) + '.');
      }
      return;
    }
    if (event.type !== 'press') return;
    const media = ctx.ui.getMedia(VIDEO);
    if (!media) return;
    let target = media.currentTime;
    if (event.slotId === 'archive-film-play-pause') {
      if (media.paused || media.ended) {
        if (media.ended) set(VIDEO, 'currentTime', 0);
        set(VIDEO, 'muted', muted);
        set(VIDEO, 'playing', true);
        set('archive-film-status', 'text', 'Playing.');
      } else {
        set(VIDEO, 'playing', false);
        set('archive-film-status', 'text', 'Paused.');
      }
    } else if (event.slotId === 'archive-film-restart') {
      set(VIDEO, 'currentTime', 0);
      set(VIDEO, 'playing', true);
      set('archive-film-status', 'text', 'Restarted.');
    } else if (event.slotId === 'archive-film-back-10' || event.slotId === 'archive-film-back-60') {
      target = Math.max(0, target - (event.slotId.endsWith('10') ? 10 : 60));
      set(VIDEO, 'currentTime', target);
    } else if (event.slotId === 'archive-film-forward-10' || event.slotId === 'archive-film-forward-60') {
      target = Math.min(media.duration || target + 10, target + (event.slotId.endsWith('10') ? 10 : 60));
      set(VIDEO, 'currentTime', target);
    } else if (event.slotId === 'archive-film-mute') {
      muted = !muted;
      set(VIDEO, 'muted', muted);
      set('archive-film-mute', 'text', muted ? 'Unmute' : 'Mute');
      set('archive-film-status', 'text', muted ? 'Muted.' : 'Sound enabled.');
    } else if (event.slotId === 'archive-film-volume-down' || event.slotId === 'archive-film-volume-up') {
      volume = Math.max(0, Math.min(1, volume + (event.slotId.endsWith('up') ? 0.1 : -0.1)));
      muted = false;
      set(VIDEO, 'volume', volume);
      set(VIDEO, 'muted', false);
      set('archive-film-status', 'text', 'Volume ' + Math.round(volume * 100) + '%.');
    }
  }
};
` }
				]
			}),
			createSlot({
				id: 'archive-film-video',
				parentId: 'archive-film-room',
				name: 'Night of the Living Dead',
				components: [{ type: 'uiElement', kind: 'video', width: 1130, height: 688, src: 'https://cors.archive.org/cors/Night.Of.The.Living.Dead_1080p/NightOfTheLivingDead_iPhone_512kb.mp4', playing: false, muted: true, volume: 1 }]
			}),
			createSlot({
				id: 'archive-film-controls-overlay',
				parentId: 'archive-film-room',
				name: 'Playback controls',
				components: [{ type: 'uiElement', kind: 'container', overlayBottom: true, flexDirection: 'column', gap: 6, padding: 10, background: '#111827', width: 1130, height: 168 }]
			}),
			createSlot({
				id: 'archive-film-controls',
				parentId: 'archive-film-controls-overlay',
				name: 'Playback buttons',
				components: [{ type: 'uiElement', kind: 'container', flexDirection: 'row', gap: 8, width: 1110, height: 48 }]
			}),
			...[
				['archive-film-play-pause', 'Play', 130], ['archive-film-back-10', '−10 s', 110], ['archive-film-forward-10', '+10 s', 110],
				['archive-film-back-60', '−1 min', 110], ['archive-film-forward-60', '+1 min', 110], ['archive-film-restart', 'Restart', 120], ['archive-film-mute', 'Unmute', 120]
			].map(([id, label, width]) => createSlot({
				id: String(id), parentId: 'archive-film-controls', name: String(label),
				components: [{ type: 'uiElement', kind: 'button', width: Number(width), height: 48, text: String(label), fontSize: 21, background: '#374151' }]
			})),
			createSlot({
				id: 'archive-film-timeline-row',
				parentId: 'archive-film-controls-overlay',
				name: 'Timeline and volume',
				components: [{ type: 'uiElement', kind: 'container', flexDirection: 'row', gap: 8, width: 1110, height: 32 }]
			}),
			createSlot({
				id: 'archive-film-time',
				parentId: 'archive-film-timeline-row',
				name: 'Playback time',
				components: [{ type: 'uiElement', kind: 'text', width: 180, height: 32, text: '--:-- / --:--', fontSize: 18, color: '#f4f4f5' }]
			}),
			createSlot({
				id: 'archive-film-seek-slider',
				parentId: 'archive-film-timeline-row',
				name: 'Seek',
				components: [{ type: 'uiElement', kind: 'slider', width: 650, height: 28, minValue: 0, maxValue: 5706, step: 1, value: 0, color: '#a78bfa', background: '#52525b' }]
			}),
			...[
				['archive-film-volume-down', '−', 60], ['archive-film-volume-up', '+', 60]
			].map(([id, label, width]) => createSlot({
				id: String(id), parentId: 'archive-film-timeline-row', name: String(label),
				components: [{ type: 'uiElement', kind: 'button', width: Number(width), height: 32, text: String(label), fontSize: 21, background: '#374151' }]
			})),
			createSlot({
				id: 'archive-film-volume',
				parentId: 'archive-film-timeline-row',
				name: 'Volume level',
				components: [{ type: 'uiElement', kind: 'text', width: 70, height: 32, text: '100%', fontSize: 18, color: '#f4f4f5' }]
			}),
			createSlot({
				id: 'archive-film-status',
				parentId: 'archive-film-controls-overlay',
				name: 'Playback status',
				components: [{ type: 'uiElement', kind: 'text', width: 1110, height: 24, text: 'Press Play to load the Archive.org stream.', fontSize: 16, color: '#d4d4d8' }]
			}),
			createSlot({
				id: 'archive-film-info',
				name: 'Film information',
				position: [0, 0.35, -2.35],
				components: [{ type: 'textDisplay', title: 'Night of the Living Dead (1968)', lines: ['Directed by George A. Romero · Archive.org lists Public Domain', 'Source: archive.org/details/Night.Of.The.Living.Dead_1080p'], color: '#f4f4f5', scale: 0.75 }]
			})
		]
	},
	{ id: 'lobby', name: 'Lobby', description: 'A glowing spawn pad, a welcome sign, a mirror, a paint brush and a record player.', scene: lobby as SlotTree },
	{
		id: 'workshop',
		name: 'Workshop',
		description: 'A large hall to build in: work bays along the walls, an open build floor and a showcase stage.',
		scene: workshop as SlotTree
	},
	{
		id: 'pop-up-store',
		name: 'Pop Up Store',
		description: 'An open store to showcase objects and tools, with shelves, display islands and a featured gallery. Everything is free.',
		scene: popUpStore as SlotTree
	},
	{ id: 'avatarShowcase', name: 'avatarShowcase', description: 'Explore a compact indoor world with its original room geometry and materials.', scene: avatarShowcase as SlotTree },
	{
		id: 'pulse',
		name: 'Feedback Center',
		description: 'An indoor feedback center: vote ideas and bugs up or down, send suggestions and share how you feel.',
		scene: pulse as SlotTree
	}
];

export const getBuiltinWorld = (id: string): BuiltinWorld | undefined => BUILTIN_WORLDS.find((world) => world.id === id);
