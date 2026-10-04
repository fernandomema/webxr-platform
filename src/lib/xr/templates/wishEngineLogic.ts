import { WISH, WISH_INITIAL, wishObjects } from './wishEngineConfig.ts';

/** Shared progression and authored cues. Visual scripts use this state on every peer. */
export const WISH_ENGINE_SCRIPT = `
const INITIAL = ${JSON.stringify(WISH_INITIAL)};
const OBJECTS = ${JSON.stringify(wishObjects())};
const LAMPS = ${JSON.stringify(WISH.lamps)};
const DURATIONS = ${JSON.stringify(WISH.durations)};
const ROOT = '${WISH.director}';
const NEXT = { awakening: 'light', lightReveal: 'time', timeReveal: 'sky', skyReveal: 'release', finale: 'afterglow' };
const COPY = {
  idle: ['THE WISH ENGINE', 'A small coin. An impossible sky.', 'Take the coin from the tray and place it in the brass slot.'],
  awakening: ['I · THE AWAKENING', 'One coin. One wish. What would you like to see?', 'The machine is remembering. Stay a moment.'],
  light: ['II · BORROWED LIGHT', 'Then help me remember the sky.', 'Carry the spark to the three lanterns, or touch their seals.'],
  lightReveal: ['THE FIRST SEAL OPENS', 'There was a sky here, once.', 'Look up. Let the room unfold.'],
  time: ['III · THE STILL HOUR', 'Even time has forgotten how to move.', 'Turn each brass dial until its bright hand points upward.'],
  timeReveal: ['THE SECOND SEAL OPENS', 'Listen. The hours are returning.', 'The observatory is waking beyond these walls.'],
  sky: ['IV · THE LOST CONSTELLATION', 'A star is only a wish that found its way home.', 'Match the three fragments to their colored sockets, or touch their seals.'],
  skyReveal: ['THE THIRD SEAL OPENS', 'I remember. I remember everything.', 'Follow the stars beyond the machine.'],
  release: ['V · THE LAST WISH', 'This time, the wish is yours to give.', 'Place the returned coin in the wishing bowl to set the genie free.'],
  finale: ['THE SKY IS YOURS', 'Keep a little of the impossible.', 'Watch the light travel across the sky.'],
  afterglow: ['A LITTLE OF THE IMPOSSIBLE', 'Some wishes leave a light behind.', 'The coin is yours to hold. Stay a while, or begin again.']
};
let state = null, tickTime = 0, publishTime = 0, initialized = false, resetUntil = 0, lifetime = 0;
let audioKey = '', audioToken = 0, tracks = [];
let displayed = '';
function component(id, type) {
  const slot = ctx.hierarchy.getSlot(id);
  return slot && slot.components.find((c) => c.type === type);
}
function shared() { return component(ROOT, 'scriptState')?.data || INITIAL; }
function set(id, type, field, value, broadcast = false) {
  const c = component(id, type);
  if (c && JSON.stringify(c[field]) !== JSON.stringify(value)) ctx.world.setComponentField(id, type, field, value, broadcast);
}
function enabled(id, value) { ctx.world.setSlotEnabled(id, value, false); }
// One snapshot carries a chapter's complete visual changes, rather than one full scene per field.
function publish() { set(ROOT, 'scriptState', 'data', JSON.parse(JSON.stringify(state)), true); publishTime = 0; }
function occupant(id, expected) {
  const s = component(id, 'socket');
  const slot = s && s.occupantId && ctx.hierarchy.getSlot(s.occupantId);
  return !!slot && slot.id === expected && slot.parentId === id;
}
function clearSockets() {
  for (const id of ['we-coin-slot','we-wish-bowl','we-star-socket-0','we-star-socket-1','we-star-socket-2']) set(id, 'socket', 'occupantId', undefined);
}
function restoreObject(id) {
  const definition = OBJECTS.find((item) => item.id === id);
  if (!definition) return;
  // Recreate with its authored parent: a previously socketed object otherwise remains inside the socket.
  ctx.world.deleteSlot(id);
  ctx.world.spawn(JSON.parse(JSON.stringify(definition)));
}
function recall() {
  if (state.phase === 'idle' || state.phase === 'release' || state.phase === 'afterglow') {
    clearSockets(); restoreObject('we-coin');
    if (state.phase === 'afterglow') {
      set('we-coin','meshRenderer','color','#b9eeff');
      set('we-coin','stroke','color','#edfcff');
    }
  }
  if (state.phase === 'light') restoreObject('we-spark');
  if (state.phase === 'sky') for (let i=0;i<3;i++) if (!state.stars[i]) {
    set('we-star-socket-'+i,'socket','occupantId',undefined); restoreObject('we-fragment-'+i);
  }
}
function sound(position, frequency, color, count = 26) {
  ctx.world.spawn({ name: 'Wish Resonance', position, components: [
    ...(state.muted ? [] : [{type:'impactSound', frequency, pitchDrop: 0, noiseMix:0.03, durationMs:1500, volume:0.3}]),
    ...(state.gentle ? [] : [{type:'particleBurst',color,count,durationMs:1500}]),
    {type:'expires',expiresAt:Date.now()+2200}
  ]});
}
function enter(phase) {
  state.phase = phase; state.time = 0;
  if (phase === 'release' || phase === 'afterglow') recall();
  draw(true); publish();
}
function restart() {
  const run = state.run + 1, gentle = state.gentle, muted = state.muted;
  state = JSON.parse(JSON.stringify(INITIAL));
  Object.assign(state, {run,gentle,muted});
  resetUntil = 0; clearSockets();
  for (const object of OBJECTS) restoreObject(object.id);
  set(ROOT,'scriptState','request',null);
  draw(true); publish();
}
function light(index) {
  if (state.phase !== 'light' || state.lights[index]) return;
  state.lights[index] = true;
  sound(LAMPS[index], [440,554.37,659.25][index], '${WISH.gold}');
  if (state.lights.every(Boolean)) enter('lightReveal'); else { draw(true); publish(); }
}
function turn(index) {
  if (state.phase !== 'time') return;
  state.rings[index] = (state.rings[index] + 1) % 4;
  sound([3,1.6,5.8], state.rings[index] === 0 ? 660 : 220 + index * 55, '${WISH.teal}', 10);
  if (state.rings.every((value) => value === 0)) enter('timeReveal'); else { draw(true); publish(); }
}
function star(index) {
  if (state.phase !== 'sky' || state.stars[index]) return;
  state.stars[index] = true;
  sound(${JSON.stringify(WISH.starSockets)}[index], [523.25,659.25,783.99][index], ['${WISH.gold}','${WISH.teal}','${WISH.violet}'][index]);
  if (state.stars.every(Boolean)) enter('skyReveal'); else { draw(true); publish(); }
}
function action(id) {
  if (!ctx.world.isHost() || !state) return;
  if (id === 'we-start' && state.phase === 'idle') { sound([0,1.1,6.05],880,'${WISH.gold}'); enter('awakening'); }
  else if (id === 'we-release' && state.phase === 'release') { sound([0,1.1,4.8],220,'${WISH.pale}',60); enter('finale'); }
  else if (id === 'we-again' && state.phase === 'afterglow') restart();
  else if (id === 'we-recall') { recall(); draw(true); publish(); }
  else if (id === 'we-reset') {
    if (resetUntil > lifetime) restart();
    else { resetUntil = lifetime + 5; set('we-reset','uiElement','text','Confirm restart',true); }
  }
  else if (id === 'we-gentle') { state.gentle = !state.gentle; draw(true); publish(); }
  else if (id === 'we-sound') { state.muted = !state.muted; draw(true); publish(); }
  else if (/^we-kindle-[0-2]$/.test(id)) light(Number(id.slice(-1)));
  else if (/^we-turn-[0-2]$/.test(id)) turn(Number(id.slice(-1)));
  else if (/^we-place-[0-2]$/.test(id)) star(Number(id.slice(-1)));
}
function draw(force) {
  const signature = JSON.stringify([state.phase,state.lights,state.rings,state.stars,state.gentle,state.muted,state.time > 25]);
  if (!force && signature === displayed) return;
  displayed = signature;
  const text = COPY[state.phase] || COPY.idle;
  set('we-chapter','uiElement','text',text[0]);
  set('we-voice','uiElement','text',text[1]);
  let hint = text[2];
  if (state.time > 25 && state.phase === 'light') hint = 'The lantern seals also answer a touch or a click. Each one holds a little light.';
  if (state.time > 25 && state.phase === 'time') hint = 'Touch Turn beneath each dial. All three bright hands must point to the top jewel.';
  set('we-instruction','uiElement','text',hint);
  for (const [id, phase] of [['we-start','idle'],['we-release','release'],['we-again','afterglow']]) set(id,'uiElement','visible',state.phase === phase);
  set('we-recall','uiElement','visible',['idle','light','sky','release','afterglow'].includes(state.phase));
  set('we-sound','uiElement','text',state.muted ? 'Sound: off' : 'Sound: on');
  set('we-gentle','uiElement','text',state.gentle ? 'Effects: gentle' : 'Effects: full');
  if (!resetUntil) set('we-reset','uiElement','text','Restart journey');
  const phases = ['idle','awakening','light','lightReveal','time','timeReveal','sky','skyReveal','release','finale','afterglow'];
  const n = phases.indexOf(state.phase);
  enabled('we-coin', ['idle','release','afterglow'].includes(state.phase));
  enabled('we-spark', state.phase === 'light');
  enabled('we-time-controls', state.phase === 'time');
  enabled('we-star-controls', state.phase === 'sky');
  enabled('we-bowl-light', state.phase === 'release' || state.phase === 'afterglow');
  enabled('we-keepsake', state.phase === 'afterglow');
  enabled('we-genie-eyes', n > 0 && n < 10);
  enabled('we-genie', n < 10);
  enabled('we-freed-stars', n >= 9);
  for (let i=0;i<3;i++) {
    enabled('we-lamp-controls-'+i,state.phase === 'light');
    enabled('we-light-ribbon-'+i,state.lights[i]);
    enabled('we-fragment-'+i,state.phase === 'sky' && !state.stars[i]);
    set('we-lamp-fire-'+i,'meshRenderer','color',state.lights[i] ? '${WISH.pale}' : '#443551');
    set('we-lamp-light-'+i,'pointLight','intensity',state.lights[i] ? 1.2 : 0);
    set('we-kindle-'+i,'uiElement','text',state.lights[i] ? 'Awakened' : 'Kindle');
    set('we-turn-'+i,'uiElement','text',state.rings[i] === 0 ? 'Aligned · Turn' : 'Turn');
    set('we-place-'+i,'uiElement','text',state.stars[i] ? 'Restored' : ['Dawn','Moon','Dusk'][i]);
    set('we-seal-'+i,'stroke','color',n > [2,4,6][i] ? '${WISH.pale}' : '#655170');
  }
  set('we-sky','skybox','topColor',n >= 9 ? '#14213e' : n >= 5 ? '#130e38' : '#050711');
  set('we-sky','skybox','horizonColor',n >= 9 ? '#564060' : n >= 3 ? '#332751' : '#181421');
  set('we-sky','skybox','stars',n >= 3 ? 1 : 0.15);
  set('we-machine-light','pointLight','intensity',n === 0 ? 0.65 : 1.5);
  set('we-mist','particleEmitter','active',n > 0 && n < 10);
  set('we-mist','particleEmitter','rate',state.gentle ? 5 : 16);
  set('we-dust','particleEmitter','rate',state.gentle ? 3 : 14);
  set('we-cosmos-dust','particleEmitter','active',n >= 7);
  set('we-cosmos-dust','particleEmitter','rate',state.gentle ? 4 : 22);
}
function poll() {
  const request = component(ROOT,'scriptState')?.request;
  if (request) {
    set(ROOT,'scriptState','request',null);
    if (request.run === state.run) action(request.action);
  }
  if (state.phase === 'idle' && occupant('we-coin-slot','we-coin')) action('we-start');
  if (state.phase === 'release' && occupant('we-wish-bowl','we-coin')) action('we-release');
  if (state.phase === 'light') {
    const spark = ctx.hierarchy.getWorldPose('we-spark');
    if (spark) LAMPS.forEach((at,i) => { if (Math.hypot(...at.map((v,j) => v-spark.position[j])) < 0.5) light(i); });
  }
  if (state.phase === 'sky') for (let i=0;i<3;i++) if (occupant('we-star-socket-'+i,'we-fragment-'+i)) star(i);
  // A dropped object outside the room always returns; a held object is never moved by this recovery.
  for (const object of OBJECTS) {
    const slot = ctx.hierarchy.getSlot(object.id);
    if (!slot || slot.disabled || slot.parentId) continue;
    const pose = ctx.hierarchy.getWorldPose(object.id);
    if (pose && (pose.position[1] < -1 || Math.hypot(pose.position[0],pose.position[2]-6) > 24)) ctx.world.setWorldPose(object.id,{position:object.position,rotation:object.rotation});
  }
}
function audio(s) {
  const phase = s.phase;
  const key = s.run + ':' + phase + ':' + s.muted;
  if (key === audioKey) return;
  audioKey = key;
  const token = ++audioToken;
  tracks.forEach((track) => track.stop()); tracks = [];
  if (s.muted || phase === 'idle') return;
  const layer = phase === 'finale' ? 'release' : ['sky','skyReveal','release','afterglow'].includes(phase) ? 'sky' : ['time','timeReveal'].includes(phase) ? 'time' : 'light';
  ctx.audio.playTrack({kind:'url',url:'/audio/wish-engine/'+layer+'.ogg'}, {volume:phase === 'afterglow' ? 0.22 : 0.48,loop:phase !== 'finale',offset:(s.time || 0) % (layer === 'release' ? 28 : 24)})
    .then((track) => { if (token !== audioToken) track.stop(); else tracks.push(track); })
    .catch((error) => ctx.log('Wish music unavailable:',error.message || error));
}
return {
  tick(dt) {
    dt = Math.min(Math.max(dt,0),0.25);
    lifetime += dt;
    if (!initialized) { state = JSON.parse(JSON.stringify(shared())); initialized = true; if (ctx.world.isHost()) draw(true); }
    if (!ctx.world.isHost()) { audio(shared()); return; }
    state.time += dt; tickTime += dt; publishTime += dt;
    if (resetUntil && lifetime > resetUntil) { resetUntil = 0; set('we-reset','uiElement','text','Restart journey',true); }
    const duration = DURATIONS[state.phase];
    if (duration && state.time >= duration) enter(NEXT[state.phase]);
    if (tickTime >= 0.1) { tickTime = 0; poll(); draw(false); }
    if (publishTime >= 0.5 && state.phase !== 'idle') publish();
    audio(state);
  },
  onUIEvent(event) {
    if (!initialized) { state = JSON.parse(JSON.stringify(shared())); initialized = true; }
    if (event.type === 'press') action(event.slotId);
  }
};
`;
