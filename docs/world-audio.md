# Audio for world scripts

Two generic primitives on `ctx.audio`, next to the synthesized `ctx.audio.play`. They know nothing about any one game: a rhythm game, a visualiser, lights that follow the beat or a karaoke world can all use them.

```js
// source: { kind: 'url', url } or { kind: 'asset', assetId }, the same shape as an audioPlayer's `source`.
const analysis = await ctx.audio.analyze(source);
// { duration, bpm, bpmConfidence, onsets: [{ t, strength, band }], energy: { hop, low, mid, high } }

const track = await ctx.audio.playTrack(source, { volume: 0.8 });
// track.time()  position in seconds on the audio clock
// track.pause() / resume() / stop() / setVolume(v); track.playing, track.ended, track.duration
```

- `onsets` are the moments something starts (a kick, a snare, a hat), sorted by `t` in seconds. `band` is `low`, `mid` or `high`; `strength` is 0-1 relative to the strongest onset of that band.
- `bpm` is 0 when no steady tempo was found. Treat it as a guess when `bpmConfidence` is below about 0.3.
- `energy.low/mid/high` are loudness curves, 0-1, one value every `hop` seconds.
- `analyze` decodes the whole track and caches the result per source (the last four), so a second call is instant. It resolves after a moment for a long track.
- `playTrack` is not positioned in the world. It runs on the peer that calls it: gate it behind `ctx.world.isHost()` when only one player should hear it. Use `track.time()` to sync gameplay, never a timer started when the call returned.

The analysis itself is `src/lib/audio/analysis.ts` (pure, tested in `tests/audioAnalysis.test.mjs`); the engine side is `src/lib/xr/scriptAudio.ts`.
