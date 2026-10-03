import type { Slot } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';
import { BEAT_TURNTABLE, BLUE, RED, box, group, sphere } from './beatTurntableParts.ts';

/**
 * The look of the Beat Turntable stage: a night sky, a lit floor and a tunnel of frames, equaliser towers, sweeping
 * lasers and a sun around the lane. All of it is plain slots that the world's script animates to the song, using only
 * `ctx.audio.analyze` data (band energy and onsets) and `ctx.world.setWorldPose` / `setComponentField`. It only moves while
 * the song plays: before and after, everything settles to rest and the script stops touching the slots.
 */
export const STAGE = {
	frames: 9,
	frameGap: 3,
	frameNear: 4.5,
	frameHalfWidth: 3.2,
	frameHeight: 4.4,
	barsPerSide: 10,
	barX: 4.8,
	barZ0: 5,
	barGap: 2.1,
	lasers: 4,
	laserZ: 27,
	gridLines: 10,
	gridGap: 2.7
} as const;

export const stageIds = {
	frame: (i: number) => `bt-fx-frame-${i}`,
	bar: (side: number, k: number) => `bt-fx-bar-${side}-${k}`,
	laser: (i: number) => `bt-fx-laser-${i}`,
	grid: (i: number) => `bt-fx-grid-${i}`,
	sun: 'bt-fx-sun',
	hitLine: 'bt-hit-line'
} as const;

const DARK = '#0b1026';
/** Where a tower rests: the script's height at silence, `round((0.25 - 3) * 25) / 25`, so it has nothing to move at rest. */
const BAR_REST_Y = Math.round((0.25 - 3) * 25) / 25;
/** The first palette the script cycles through: the stage rests in its colours, dimmed, until a song plays. */
const REST_PALETTE = ['#38bdf8', '#818cf8'] as const;

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number): string => {
	const [x, y] = [channels(a), channels(b)];
	return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
};
const accent = (p: number) => mix(REST_PALETTE[0], REST_PALETTE[1], p);

function buildFrames(): Slot[] {
	const { frames, frameGap, frameNear, frameHalfWidth: w, frameHeight: h } = STAGE;
	const slots: Slot[] = [];
	for (let i = 0; i < frames; i++) {
		const id = stageIds.frame(i);
		const rest = mix(DARK, accent(i / (frames - 1)), 0.28);
		slots.push(
			// The engine moves it (a `velocity` the script sets while the song plays), so it costs the script nothing per frame.
			{ ...group(id, `Tunnel Frame ${i}`, [0, 0, frameNear + i * frameGap]), components: [{ type: 'container' }, { type: 'velocity', linear: [0, 0, 0] }] },
			box(`${id}-l`, 'Frame Left', [-w, h / 2, 0], [0.1, h, 0.1], rest, { parentId: id }),
			box(`${id}-r`, 'Frame Right', [w, h / 2, 0], [0.1, h, 0.1], rest, { parentId: id }),
			box(`${id}-t`, 'Frame Top', [0, h, 0], [w * 2 + 0.1, 0.1, 0.1], rest, { parentId: id }),
			box(`${id}-b`, 'Frame Floor', [0, 0.04, 0], [w * 2 + 0.1, 0.05, 0.1], rest, { parentId: id })
		);
	}
	return slots;
}

function buildBars(): Slot[] {
	const slots: Slot[] = [];
	for (const side of [0, 1]) {
		for (let k = 0; k < STAGE.barsPerSide; k++) {
			// Six metres tall and mostly under the floor: the script slides it up and down.
			slots.push(box(stageIds.bar(side, k), `Equaliser ${side}-${k}`, [side === 0 ? -STAGE.barX : STAGE.barX, BAR_REST_Y, STAGE.barZ0 + k * STAGE.barGap], [0.5, 6, 0.5], mix(DARK, accent(side === 0 ? k / (STAGE.barsPerSide - 1) : 1 - k / (STAGE.barsPerSide - 1)), 0.3)));
		}
	}
	return slots;
}

function buildLasers(): Slot[] {
	const slots: Slot[] = [];
	const xs = [-2.6, -1.1, 1.1, 2.6];
	for (let i = 0; i < STAGE.lasers; i++) {
		const id = stageIds.laser(i);
		slots.push(group(id, `Laser ${i}`, [xs[i], 4.2, STAGE.laserZ]), box(`${id}-beam`, 'Laser Beam', [0, 0, -12], [0.06, 0.06, 24], mix(DARK, accent(i / (STAGE.lasers - 1)), 0.15), { parentId: id }));
	}
	return slots;
}

function buildGrid(): Slot[] {
	return Array.from({ length: STAGE.gridLines }, (_, i) =>
		box(stageIds.grid(i), `Floor Line ${i}`, [0, 0.012, 3.2 + i * STAGE.gridGap], [14, 0.01, 0.04], mix(DARK, accent(0), 0.2), { components: [{ type: 'velocity', linear: [0, 0, 0] }] })
	);
}

/** Sky, floor, lane, lights and every animated part of the background. */
export function buildStageSlots(): Slot[] {
	const { hitZ, hudZ } = BEAT_TURNTABLE;
	const laneCentre = 14;
	return [
		createSlot({
			id: 'bt-sky',
			name: 'Night Sky',
			components: [{ type: 'skybox', topColor: '#03010a', horizonColor: '#5b21b6', bottomColor: '#0a0f24', stars: 0.9, ambientIntensity: 0.85 }]
		}),
		createSlot({
			id: 'bt-floor',
			name: 'Floor',
			position: [0, -0.05, 10],
			scale: [3, 1, 3],
			components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'ground' }, color: '#080b16' }, { type: 'collider', shape: 'box' }]
		}),
		box('bt-lane', 'Lane', [0, 0.004, laneCentre], [1.8, 0.008, 24], '#141c3a'),
		box('bt-rail-0', 'Lane Rail Left', [-0.9, 0.02, laneCentre], [0.04, 0.04, 24], BLUE),
		box('bt-rail-1', 'Lane Rail Right', [0.9, 0.02, laneCentre], [0.04, 0.04, 24], RED),
		box(stageIds.hitLine, 'Hit Line', [0, 0.02, hitZ], [1.9, 0.012, 0.04], '#e5e7eb'),
		createSlot({ id: 'bt-light-0', name: 'Blue Light', position: [-1.8, 2.4, hitZ + 1.5], components: [{ type: 'pointLight', color: '#60a5fa', intensity: 0.55, range: 12 }] }),
		createSlot({ id: 'bt-light-1', name: 'Red Light', position: [1.8, 2.4, hitZ + 1.5], components: [{ type: 'pointLight', color: '#f87171', intensity: 0.55, range: 12 }] }),
		// A huge sun at the end of the lane.
		sphere(stageIds.sun, 'Sun', [0, 9, hudZ + 70], 34, mix('#6b21a8', accent(0.5), 0.25)),
		...buildFrames(),
		...buildBars(),
		...buildLasers(),
		...buildGrid()
	];
}

/** The effects the player can switch off (see `STAGE_FX_SOURCE`), with the slots each one is. */
export const STAGE_EFFECTS = ['tunnel', 'towers', 'lasers', 'grid', 'sun', 'glow', 'sparks', 'lights'] as const;
export type StageEffect = (typeof STAGE_EFFECTS)[number];

/**
 * The stage's animation, as script source embedded in the world's code block. It uses the script's `analysis` (the result of
 * `ctx.audio.analyze`, or null), `track` (the `ctx.audio.playTrack` handle, or null), `state` and the `set` helper.
 * `fxTick(dt)` runs every frame and animates only while a song is playing (the stage settles and goes quiet otherwise);
 * `fxHit(hand)` flashes the hit line; `fxRestart()` rewinds the beat tracking for a new song.
 *
 * Built to be light on a headset: what flows (the tunnel, the floor lines) is moved by the engine's `velocity`, the script only
 * wraps it round now and then; towers, lasers and colours are updated 30 times a second, not every frame, and a colour is
 * only written when it really changes. Every effect can be switched off (`fx.on`, `fxApplyEffects()`): its slots are hidden
 * and it costs nothing. `sparks` is read by the script's hit effects, `glow` by its note and saber halos.
 */
export const STAGE_FX_SOURCE = `
const FX = ${JSON.stringify({ ...STAGE })};
const FX_DARK = '${DARK}';
const FX_PALETTES = [['#38bdf8', '#818cf8'], ['#fb7185', '#f59e0b'], ['#34d399', '#22d3ee'], ['#e879f9', '#60a5fa']];
const FX_COLOR_STEPS = 4;
const FX_STEP = 1 / 30;
const FX_BAR_REST = ${BAR_REST_Y};
const FX_LASER_YAW = [0.28, 0.1, -0.1, -0.28];
const FX_EFFECTS = ${JSON.stringify([...STAGE_EFFECTS])};

function fxRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function fxMix(a, b, t) {
  const x = fxRgb(a), y = fxRgb(b);
  const c = (i) => Math.round(x[i] + (y[i] - x[i]) * t);
  return '#' + ((1 << 24) | (c(0) << 16) | (c(1) << 8) | c(2)).toString(16).slice(1);
}
const fxStep = (v) => Math.round(Math.max(0, Math.min(1, v)) * FX_COLOR_STEPS) / FX_COLOR_STEPS;

const fxIds = {
  tunnel: Array.from({ length: FX.frames }, (_, i) => 'bt-fx-frame-' + i),
  grid: Array.from({ length: FX.gridLines }, (_, i) => 'bt-fx-grid-' + i),
  towers: [].concat(...[0, 1].map((side) => Array.from({ length: FX.barsPerSide }, (_, k) => 'bt-fx-bar-' + side + '-' + k))),
  lasers: Array.from({ length: FX.lasers }, (_, i) => 'bt-fx-laser-' + i),
  sun: ['bt-fx-sun'],
  lights: ['bt-light-0', 'bt-light-1'],
  glow: ['bt-saber-0-halo', 'bt-saber-1-halo']
};

const fx = { clock: 0, acc: 0, bands: [0, 0, 0], flash: 0, onset: 0, history: [], frameZ: [], gridZ: [], barH: [], barY: [], colors: {}, hit: 0, hitColor: '#e5e7eb', speed: -1, on: {} };
for (const name of FX_EFFECTS) fx.on[name] = true;
for (let i = 0; i < FX.frames; i++) fx.frameZ.push(FX.frameNear + i * FX.frameGap);
for (let i = 0; i < FX.gridLines; i++) fx.gridZ.push(3.2 + i * FX.gridGap);
for (let i = 0; i < FX.barsPerSide * 2; i++) { fx.barH.push(0); fx.barY.push(FX_BAR_REST); }

function fxColor(id, hex) {
  if (fx.colors[id] === hex) return;
  fx.colors[id] = hex;
  set(id, 'meshRenderer', 'color', hex, false);
}

/** Shows or hides the slots of every effect, as the switches say. */
function fxApplyEffects() {
  for (const name of Object.keys(fxIds)) for (const id of fxIds[name]) ctx.world.setSlotEnabled(id, !!fx.on[name], false);
  fx.speed = -1;
}

function fxRestart() {
  fx.onset = 0;
  fx.flash = 0;
}

function fxHit(hand) {
  fx.hit = 0.14;
  fx.hitColor = hand === 0 ? '#60a5fa' : '#f87171';
}

/** The level some seconds ago: lets a pulse travel down the tunnel. */
function fxDelayed(seconds) {
  const wanted = fx.clock - seconds;
  for (let i = fx.history.length - 1; i >= 0; i--) if (fx.history[i][0] <= wanted) return fx.history[i][1];
  return fx.history.length ? fx.history[0][1] : 0;
}

function fxBands(now, dt) {
  let raw = [0, 0, 0];
  if (now !== null && analysis && analysis.energy && analysis.energy.low.length) {
    const e = analysis.energy;
    const index = Math.max(0, Math.min(e.low.length - 1, Math.floor(now / e.hop)));
    raw = [e.low[index], e.mid[index], e.high[index]];
    const onsets = analysis.onsets;
    while (fx.onset < onsets.length && onsets[fx.onset].t <= now) {
      if (onsets[fx.onset].band === 'low' && onsets[fx.onset].strength >= 0.5) fx.flash = 1;
      fx.onset += 1;
    }
  }
  for (let i = 0; i < 3; i++) fx.bands[i] = raw[i] > fx.bands[i] ? raw[i] : Math.max(raw[i], fx.bands[i] - dt * 2.2);
}

/** What flows is moved by the engine: the script sets the speed when it changes and wraps what has gone by. */
function fxFlow(speed, dt) {
  // Hidden or not, they keep flowing, so switching an effect back on finds them where the others are.
  if (speed !== fx.speed) {
    fx.speed = speed;
    for (const id of fxIds.tunnel.concat(fxIds.grid)) set(id, 'velocity', 'linear', [0, 0, -speed], false);
  }
  if (speed <= 0) return;
  const frameSpan = FX.frames * FX.frameGap;
  for (let i = 0; i < FX.frames; i++) {
    fx.frameZ[i] -= speed * dt;
    if (fx.frameZ[i] < FX.frameNear) {
      fx.frameZ[i] += frameSpan;
      ctx.world.setWorldPose(fxIds.tunnel[i], { position: [0, 0, fx.frameZ[i]] }, false);
    }
  }
  const gridSpan = FX.gridLines * FX.gridGap;
  for (let i = 0; i < FX.gridLines; i++) {
    fx.gridZ[i] -= speed * dt;
    if (fx.gridZ[i] < 2.4) {
      fx.gridZ[i] += gridSpan;
      ctx.world.setWorldPose(fxIds.grid[i], { position: [0, 0.012, fx.gridZ[i]] }, false);
    }
  }
}

function fxTick(dt) {
  const now = state === 'playing' && track && !track.ended ? track.time() : null;
  // The stage's own clock runs with the song, so what sweeps stops where it is when the music does.
  if (now !== null) fx.clock += dt;
  const bpm = analysis && analysis.bpm ? analysis.bpm : 110;
  fxFlow(now === null ? 0 : 2.5 + (bpm / 120) * 3, dt);
  if (fx.hit > 0) fx.hit -= dt;
  fxColor('bt-hit-line', fx.hit > 0 ? fx.hitColor : '#e5e7eb');

  // Everything else changes at 30 Hz: a headset frame is too short to spend on a tower that moves a centimetre.
  fx.acc += dt;
  if (fx.acc < FX_STEP) return;
  const step = fx.acc;
  fx.acc = 0;
  fxBands(now, step);
  fx.flash = Math.max(0, fx.flash - step * 3.5);
  const level = Math.max(0, Math.min(1, fx.bands[0] * 0.65 + fx.bands[1] * 0.3 + fx.flash * 0.45));
  fx.history.push([fx.clock, level]);
  while (fx.history.length > 1 && fx.clock - fx.history[0][0] > 1.2) fx.history.shift();
  const palette = FX_PALETTES[Math.floor(fx.clock / 24) % FX_PALETTES.length];
  const accent = (p) => fxMix(palette[0], palette[1], p);

  if (fx.on.tunnel) {
    for (let i = 0; i < FX.frames; i++) {
      const colour = fxMix(FX_DARK, accent(i / (FX.frames - 1)), 0.28 + 0.72 * fxStep(fxDelayed(i * 0.07)));
      for (const part of ['l', 'r', 't', 'b']) fxColor(fxIds.tunnel[i] + '-' + part, colour);
    }
  }

  if (fx.on.grid) for (const id of fxIds.grid) fxColor(id, fxMix(FX_DARK, accent(0), 0.2 + 0.6 * fxStep(fxDelayed(0.05))));

  if (fx.on.towers) {
    for (let side = 0; side < 2; side++) {
      for (let k = 0; k < FX.barsPerSide; k++) {
        const index = side * FX.barsPerSide + k;
        const p = k / (FX.barsPerSide - 1);
        const raw = p < 0.5 ? fx.bands[0] + (fx.bands[1] - fx.bands[0]) * p * 2 : fx.bands[1] + (fx.bands[2] - fx.bands[1]) * (p - 0.5) * 2;
        const target = now === null ? 0 : Math.max(0, Math.min(1, raw * 1.15 + 0.05 * Math.sin(fx.clock * 3 + k + side * 2) + fx.flash * 0.15));
        const rate = target > fx.barH[index] ? 14 : 5;
        fx.barH[index] += (target - fx.barH[index]) * Math.min(1, step * rate);
        const y = Math.round((0.25 + fx.barH[index] * 3.6 - 3) * 25) / 25;
        const id = fxIds.towers[index];
        if (y !== fx.barY[index]) {
          fx.barY[index] = y;
          ctx.world.setWorldPose(id, { position: [side === 0 ? -FX.barX : FX.barX, y, FX.barZ0 + k * FX.barGap] }, false);
        }
        fxColor(id, fxMix(FX_DARK, accent(side === 0 ? p : 1 - p), 0.3 + 0.7 * fxStep(fx.barH[index])));
      }
    }
  }

  if (fx.on.lasers) {
    const sweep = 0.5 + (bpm / 120) * 0.6;
    for (let i = 0; i < FX.lasers; i++) {
      if (now !== null) {
        const yaw = FX_LASER_YAW[i] + 0.38 * Math.sin(fx.clock * sweep + i * 1.7);
        const pitch = -0.17 + 0.05 * Math.sin(fx.clock * sweep * 0.7 + i);
        ctx.world.setWorldPose(fxIds.lasers[i], { rotation: ctx.math.quatMultiply(ctx.math.quatFromAxisAngle([0, 1, 0], yaw), ctx.math.quatFromAxisAngle([1, 0, 0], pitch)) }, false);
      }
      fxColor(fxIds.lasers[i] + '-beam', fxMix(FX_DARK, accent(i / (FX.lasers - 1)), 0.15 + 0.85 * fxStep(level)));
    }
  }

  if (fx.on.sun) fxColor('bt-fx-sun', fxMix('#6b21a8', accent(0.5), 0.25 + 0.6 * fxStep(level)));
}
`;
