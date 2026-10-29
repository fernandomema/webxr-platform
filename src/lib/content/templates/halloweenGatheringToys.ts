import type { Vec3 } from '@kithin/engine/ecs/types';

/**
 * The toys the houses of the Lantern Night give away, as the scripts they carry. Their models are in `halloweenGathering.ts`.
 * None of them is worked with a button except the brush: the music box is wound by its crank, the spirit jar is shaken.
 */

/** Note names (`C#5`, `Bb4`) and lengths in beats, as written in the tunes below, turned into frequencies. A rest is `r`. */
export function parseTune(text: string): Array<[number, number]> {
	const steps: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
	return text.trim().split(/\s+/).map((token) => {
		const [name, beats] = token.split('/');
		const length = Number(beats ?? 1);
		if (name === 'r') return [0, length];
		const match = /^([A-G])([#b]?)(\d)$/.exec(name);
		if (!match) throw new Error(`Bad note "${token}"`);
		const midi = 12 * (Number(match[3]) + 1) + steps[match[1]] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
		return [Math.round(440 * 2 ** ((midi - 69) / 12) * 100) / 100, length];
	});
}

/**
 * The music box's tune, about two minutes of winding: the opening of Bach's Toccata in D minor, Grieg's Hall of the Mountain
 * King (both long in the public domain), a slow ghost waltz written for this box, and a chromatic creep down to the end.
 */
export const MUSIC_BOX_TUNE = parseTune(`
	A5/0.25 G5/0.25 A5/1.5 r/0.5 G5/0.25 F5/0.25 E5/0.25 D5/0.25 C#5/1 D5/2 r/1
	A4/0.25 G4/0.25 A4/1.5 r/0.5 E4/0.5 F4/0.5 C#4/0.5 D4/2 r/1
	B4/0.5 C#5/0.5 D5/0.5 E5/0.5 F#5/0.5 D5/0.5 F#5/1 F5/0.5 C#5/0.5 F5/1 E5/0.5 C5/0.5 E5/1
	B4/0.5 C#5/0.5 D5/0.5 E5/0.5 F#5/0.5 D5/0.5 F#5/0.5 B5/0.5 A5/0.5 F#5/0.5 D5/0.5 F#5/0.5 A5/2
	B4/0.5 C#5/0.5 D5/0.5 E5/0.5 F#5/0.5 D5/0.5 F#5/1 F5/0.5 C#5/0.5 F5/1 E5/0.5 C5/0.5 E5/1
	B4/0.5 C#5/0.5 D5/0.5 E5/0.5 F#5/0.5 D5/0.5 F#5/0.5 B5/0.5 A5/0.5 F#5/0.5 D5/0.5 F#5/0.5 B5/2 r/1
	D5 F5 A5 G#5/2 A5 Bb5 A5 G5 F5/2 E5
	D5 F5 A5 C#6/2 D6 Bb5 G5 E5 D5/3
	F5 E5 F5 G5 F5 G5 A5 G#5 A5 Bb5/2 A5
	G5 F5 E5 F5 D5 Bb4 A4 C#5 E5 D5/3
	D5 F5 A5 G#5/2 A5 Bb5 A5 G5 F5/2 E5
	A4 C#5 E5 G5/2 F5 E5 D5 C#5 D5/3 r/1
	D5/0.5 C#5/0.5 C5/0.5 B4/0.5 Bb4/0.5 A4/0.5 G#4/0.5 A4/1.5
	F5/0.5 E5/0.5 Eb5/0.5 D5/0.5 C#5/0.5 C5/0.5 B4/0.5 C#5/1.5
	D4/0.5 F4/0.5 A4/0.5 D5/0.5 F5/0.5 A5/0.5 D6/2 r/2
`);

/** Where the music box's crank turns, in the box's own coordinates: its axle points along x, and the knob you hold circles it. */
export const CRANK = { axle: [0.165, 0.1, 0] as Vec3, rest: [0.2, 0.17, 0] as Vec3, armX: 0.175 } as const;

/**
 * The music box plays nothing by itself and is not worn: you take the knob of its crank and wind it, and the tune moves on as
 * far as you wind, at the speed you wind (half a turn a beat), like a real one; the little pumpkin on top turns with it. Winding is
 * any circular movement of the hand in the plane of the crank, wherever its centre is: nobody can circle an invisible axle
 * exactly, and the knob is not held to it. The script draws the arm from the axle towards the knob and puts the knob back when
 * it is let go.
 */
export const MUSIC_BOX_SCRIPT = `
const TUNE = ${JSON.stringify(MUSIC_BOX_TUNE)};
const AXLE = ${JSON.stringify(CRANK.axle)};
const REST = ${JSON.stringify(CRANK.rest)};
const ARM_X = ${CRANK.armX};
const BEATS_PER_TURN = 2, SAMPLE = 0.05, MIN_MOVE = 0.008, MAX_ARM = 0.12;
const KNOB = ctx.self.id + '-crank', ARM = ctx.self.id + '-crank-arm', DANCER = ctx.self.id + '-dancer';
let held = false, since = 0, flushIn = 0, previous = null, heading = null;
// Where the tune is, in beats, and when its next note starts. Kept between windings: it carries on where it stopped.
let beat = 0, next = 0, index = 0, spin = 0;
function arm(y, z) {
  const dy = y - AXLE[1], dz = z - AXLE[2], reach = Math.hypot(dy, dz);
  if (reach < 0.01) return;
  const length = Math.min(MAX_ARM, reach);
  ctx.world.setLocalPose(ARM, { position: [ARM_X, AXLE[1] + dy / reach * length / 2, AXLE[2] + dz / reach * length / 2], rotation: ctx.math.quatFromAxisAngle([1, 0, 0], Math.atan2(dz, dy) - Math.PI / 2), scale: [0.012, length, 0.012] }, false);
}
function putBack() {
  ctx.world.setParent(KNOB, ctx.self.id);
  ctx.world.setLocalPose(KNOB, { position: REST, rotation: [0, 0, 0, 1] });
  ctx.world.setLocalPose(ARM, { position: [ARM_X, (REST[1] + AXLE[1]) / 2, 0], rotation: [0, 0, 0, 1], scale: [0.012, REST[1] - AXLE[1], 0.012] });
}
function play(frequency) {
  ctx.world.spawn({ name: 'Pumpkin Note', position: ctx.self.getWorldPosition(), components: [
    { type: 'impactSound', frequency, pitchDrop: 3, noiseMix: 0, durationMs: 900, volume: 0.42 },
    { type: 'particleBurst', color: index % 2 ? '#c084fc' : '#fb923c', count: 6, durationMs: 600 },
    { type: 'expires', expiresAt: Date.now() + 1300 }
  ] }, { ephemeral: true });
}
/** Moves the tune on by an angle of winding. */
function wind(angle) {
  beat += angle / (Math.PI * 2) * BEATS_PER_TURN;
  spin += angle * 0.6;
  ctx.world.setLocalPose(DANCER, { rotation: ctx.math.quatFromAxisAngle([0, 1, 0], spin) }, false);
  while (beat >= next) {
    const [frequency, length] = TUNE[index];
    if (frequency) play(frequency);
    next += length;
    index += 1;
    if (index >= TUNE.length) { index = 0; beat -= next; next = 0; }
  }
}
return {
  tick(dt) {
    if (!ctx.world.isHost()) return;
    if (!ctx.grab.isSlotHeld(KNOB)) {
      if (held) { held = false; previous = null; heading = null; putBack(); }
      return;
    }
    held = true;
    const knob = ctx.hierarchy.getWorldPose(KNOB), box = ctx.hierarchy.getWorldPose(ctx.self.id);
    if (!knob || !box) return;
    const local = ctx.math.rotateVec([-box.rotation[0], -box.rotation[1], -box.rotation[2], box.rotation[3]], ctx.math.vecSub(knob.position, box.position));
    arm(local[1], local[2]);
    flushIn -= dt;
    if (flushIn <= 0) { flushIn = 0.1; ctx.world.flush(); }
    since += dt;
    if (since < SAMPLE) return;
    since = 0;
    const here = [local[1], local[2]];
    if (!previous) { previous = here; return; }
    const move = [here[0] - previous[0], here[1] - previous[1]];
    if (Math.hypot(move[0], move[1]) < MIN_MOVE) return;
    // How far the hand turned since the last sample: the change of direction of its movement, whichever way round it goes.
    if (heading) wind(Math.abs(Math.atan2(heading[0] * move[1] - heading[1] * move[0], heading[0] * move[0] + heading[1] * move[1])));
    heading = move; previous = here;
  }
};`;

/**
 * The spirit jar: shake it and the spirit inside wakes, glows, and lets a little ghost out, which rises and drifts round you and
 * fades away. Nothing to press; it is shaken like a jar. A few ghosts at most at once, so a long shake is not a flood.
 */
export const SPIRIT_JAR_SCRIPT = `
const SPIRIT = ctx.self.id + '-spirit', LIGHT = ctx.self.id + '-light';
const SHAKE = 4.5, COOLDOWN = 0.6, MAX_GHOSTS = 5, LIFE = 4.5;
let previous = null, velocity = [0, 0, 0], shake = 0, cooldown = 0, flushIn = 0, glowing = 0, ghosts = [], clock = 0, count = 0;
function holderHaptics() {
  const holder = ctx.grab.heldBy()[0];
  if (!holder) return;
  try {
    const player = ctx.world.getPlayer(holder);
    ctx.haptics.pulse(player.id, { hand: holder.endsWith('left') ? 'left' : 'right', intensity: 0.6, durationMs: 90 });
  } catch (error) {}
}
function release() {
  const top = ctx.self.getWorldPosition();
  const id = ctx.self.id + '-ghost-' + (count++) + '-' + Math.floor(Math.random() * 1e6).toString(36);
  const base = [top[0], top[1] + 0.22, top[2]];
  ctx.world.spawn({ id, name: 'Little Ghost', position: base, components: [{ type: 'container' }, { type: 'expires', expiresAt: Date.now() + LIFE * 1000 }] });
  ctx.world.spawn({ id: id + '-body', parentId: id, name: 'Ghost Body', scale: [0.1, 0.12, 0.1], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' }, color: '#f0fdfa', unlit: true, opacity: 0.85 }] });
  ctx.world.spawn({ id: id + '-tail', parentId: id, name: 'Ghost Tail', position: [0, -0.06, 0], scale: [0.08, 0.06, 0.08], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'cylinder' }, color: '#ccfbf1', unlit: true, opacity: 0.6 }] });
  for (const side of [-1, 1]) ctx.world.spawn({ id: id + '-eye' + side, parentId: id, name: 'Ghost Eye', position: [side * 0.02, 0.015, -0.045], scale: [0.016, 0.022, 0.01], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' }, color: '#111827', unlit: true }] });
  ghosts.push({ id, base, born: clock, phase: Math.random() * Math.PI * 2, way: Math.random() < 0.5 ? -1 : 1 });
  ctx.world.spawn({ name: 'Ghost Whoo', position: base, components: [
    { type: 'impactSound', frequency: 520 + Math.random() * 120, pitchDrop: 260, noiseMix: 0.25, durationMs: 900, volume: 0.35 },
    { type: 'particleBurst', color: '#99f6e4', count: 14, durationMs: 700 },
    { type: 'expires', expiresAt: Date.now() + 1200 }
  ] }, { ephemeral: true });
  holderHaptics();
}
return {
  tick(dt) {
    if (!ctx.world.isHost()) return;
    dt = Math.min(Math.max(dt, 1e-3), 0.1);
    clock += dt; cooldown -= dt; flushIn -= dt;
    const here = ctx.self.getWorldPosition();
    if (ctx.grab.isHeld() && previous) {
      // Shaking is the hand's velocity changing back and forth: add up how much it changes (smoothed, so tracking jitter is not a shake).
      const raw = ctx.math.vecScale(ctx.math.vecSub(here, previous), 1 / dt);
      const smooth = ctx.math.vecAdd(velocity, ctx.math.vecScale(ctx.math.vecSub(raw, velocity), Math.min(1, dt * 20)));
      shake += ctx.math.vecLength(ctx.math.vecSub(smooth, velocity));
      velocity = smooth;
    } else velocity = [0, 0, 0];
    previous = here;
    shake *= Math.exp(-dt / 0.35);
    if (shake > SHAKE && cooldown <= 0 && ghosts.length < MAX_GHOSTS) { cooldown = COOLDOWN; release(); }
    // The spirit glows and trembles while it is shaken.
    const target = Math.min(1, shake / SHAKE);
    if (Math.abs(target - glowing) > 0.02) {
      glowing += (target - glowing) * Math.min(1, dt * 8);
      ctx.world.setComponentField(LIGHT, 'pointLight', 'intensity', Math.round((0.5 + glowing * 1.6) * 100) / 100, false);
      const wobble = glowing * 0.012;
      ctx.world.setLocalPose(SPIRIT, { position: [Math.sin(clock * 40) * wobble, 0.09 + Math.cos(clock * 33) * wobble, 0], scale: [0.05 + glowing * 0.015, 0.06 + glowing * 0.015, 0.05 + glowing * 0.015] }, false);
    }
    ghosts = ghosts.filter((ghost) => clock - ghost.born < LIFE && ctx.hierarchy.getSlot(ghost.id));
    for (const ghost of ghosts) {
      const t = clock - ghost.born, radius = 0.15 + t * 0.18, angle = ghost.phase + ghost.way * t * 1.6;
      const position = [ghost.base[0] + Math.sin(angle) * radius, ghost.base[1] + t * 0.3 + Math.sin(t * 5) * 0.04, ghost.base[2] + Math.cos(angle) * radius];
      ctx.world.setWorldPose(ghost.id, { position, rotation: ctx.math.quatFromAxisAngle([0, 1, 0], angle + Math.PI) }, false);
    }
    if ((ghosts.length || glowing > 0.02) && flushIn <= 0) { flushIn = 0.1; ctx.world.flush(); }
  }
};`;

/** The witchlight brush: pull the trigger and it draws a glowing star in the air where its tip is. */
export const BRUSH_SCRIPT = `
return {
  onTrigger(event) {
    if (event.phase !== 'press') return true;
    if (!ctx.world.isHost()) return true;
    ctx.haptics.pulse(event.playerId, { hand: event.hand, intensity: 0.35, durationMs: 45 });
    const pose = ctx.hierarchy.getWorldPose(ctx.self.id + '-tip');
    if (pose) {
      const points = [];
      for (let i = 0; i <= 16; i++) {
        const a = i / 16 * Math.PI * 4;
        const r = i % 2 ? 0.055 : 0.14;
        points.push(Math.sin(a) * r, Math.cos(a) * r, 0);
      }
      ctx.world.spawn({ name: 'Witchlight Drawing', position: pose.position, rotation: pose.rotation, components: [{ type: 'stroke', points, color: '#c4b5fd', width: 0.018 }] });
      ctx.particles.burst({ color: '#c4b5fd', count: 10, durationMs: 450 });
    }
    return true;
  }
};`;
