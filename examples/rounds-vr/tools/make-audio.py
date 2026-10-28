#!/usr/bin/env python3
"""
Writes the sound of ROUNDS VR to static/content/audio: a lobby loop, a duel loop, a few jingles and the sound effects. All of it is synthesised here (saws,
pads, plucks, drums), so it is original and needs no licence. Needs numpy and scipy, and ffmpeg for the Ogg files:
    python3 tools/make-audio.py [lobby] [duel] [jingles] [sfx]
"""
import subprocess, sys, wave
from pathlib import Path
import numpy as np
from scipy.signal import lfilter, butter

SR = 32000
OUT = Path(__file__).resolve().parent.parent / 'static' / 'content' / 'audio'
rng = np.random.default_rng(7)

def midi(n): return 440.0 * 2 ** ((n - 69) / 12)

def env(n, a, d, s, r, sr=SR):
    """ADSR as an array of n samples."""
    a, d, r = int(a * sr), int(d * sr), int(r * sr)
    out = np.ones(n) * s
    a = min(a, n); out[:a] = np.linspace(0, 1, a, endpoint=False) if a else out[:a]
    d = min(d, n - a); out[a:a + d] = np.linspace(1, s, d, endpoint=False) if d else out[a:a + d]
    r = min(r, n); out[n - r:] *= np.linspace(1, 0, r) if r else 1
    return out

def saw(freq, n, detune=0.0, phase=0.0):
    t = np.arange(n) / SR
    f = freq * (1 + detune)
    return 2 * ((t * f + phase) % 1.0) - 1

def square(freq, n, width=0.5):
    t = np.arange(n) / SR
    return np.where((t * freq) % 1.0 < width, 1.0, -1.0)

def sine(freq, n):
    return np.sin(2 * np.pi * freq * np.arange(n) / SR)

def tri(freq, n):
    return 2 * np.abs(2 * ((np.arange(n) / SR * freq) % 1.0) - 1) - 1

def lowpass(x, cutoff, order=2):
    b, a = butter(order, min(0.99, cutoff / (SR / 2)), 'low')
    return lfilter(b, a, x)

def highpass(x, cutoff, order=2):
    b, a = butter(order, cutoff / (SR / 2), 'high')
    return lfilter(b, a, x)

def noise(n): return rng.uniform(-1, 1, n)

def place(track, sound, at, gain=1.0, pan=0.0):
    """Mixes a mono sound into a stereo track at a time in seconds."""
    i = int(at * SR)
    if i >= track.shape[0]: return
    n = min(len(sound), track.shape[0] - i)
    left, right = gain * (1 - max(0, pan)), gain * (1 + min(0, pan))
    track[i:i + n, 0] += sound[:n] * left
    track[i:i + n, 1] += sound[:n] * right

def kick(length=0.32):
    n = int(length * SR); t = np.arange(n) / SR
    f = 42 + 130 * np.exp(-t * 28)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9) * 1.2 + noise(n) * np.exp(-t * 90) * 0.12

def snare(length=0.22):
    n = int(length * SR); t = np.arange(n) / SR
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 28) * 0.5
    return body + highpass(noise(n), 1200) * np.exp(-t * 18) * 0.75

def hat(length=0.06, open_=False):
    n = int((0.22 if open_ else length) * SR); t = np.arange(n) / SR
    return highpass(noise(n), 7000) * np.exp(-t * (14 if open_ else 70)) * 0.45

def pluck(freq, length=0.35, bright=2600):
    n = int(length * SR)
    x = (saw(freq, n) * 0.6 + tri(freq * 2, n) * 0.4) * np.exp(-np.arange(n) / SR * 11)
    return lowpass(x, bright)

def delay(track, seconds, feedback=0.35, mix=0.35, taps=3):
    out = track.copy(); d = int(seconds * SR)
    for k in range(1, taps + 1):
        g = mix * feedback ** (k - 1)
        out[d * k:] += track[:-d * k] * g if d * k < len(track) else 0
    return out

def master(track, peak=0.82):
    track = np.tanh(track * 1.1)
    track = track / max(1e-6, np.abs(track).max()) * peak
    return track

def write(name, track):
    OUT.mkdir(parents=True, exist_ok=True)
    wav_path = OUT / f'{name}.wav'
    pcm = (np.clip(track, -1, 1) * 32767).astype('<i2')
    with wave.open(str(wav_path), 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    ogg = OUT / f'{name}.ogg'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(wav_path), '-c:a', 'libvorbis', '-q:a', '4', str(ogg)], check=True)
    wav_path.unlink()
    print(f'{ogg.name}: {len(track) / SR:.1f} s, {ogg.stat().st_size // 1024} KiB')

# ------------------------------------------------------------------------------------------------------------------ the lobby loop
def lobby():
    bpm = 100; beat = 60 / bpm; bar = beat * 4; bars = 16
    total = int(bar * bars * SR)
    mix = np.zeros((total, 2))
    # Am7 | Fmaj7 | Cmaj7 | G6, two bars each, twice over
    chords = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 55, 60, 64], [55, 59, 62, 64]]
    for index in range(bars // 2):
        chord = chords[index % 4]; start = index * 2 * bar; length = int(2 * bar * SR)
        # pad: detuned saws, soft attack
        pad = np.zeros(length)
        for note in chord:
            for d in (-0.004, 0.0, 0.004):
                pad += saw(midi(note), length, d, rng.uniform())
        pad = lowpass(pad, 1400 + 500 * (index % 2)) * env(length, 0.9, 0.4, 0.8, 0.9) * 0.05
        place(mix, pad, start, 1.0, -0.15); place(mix, lowpass(pad, 900), start, 0.6, 0.35)
        # bass: eighths on the root, with the octave on the offbeat
        root = chord[0] - 24 if chord[0] > 50 else chord[0] - 12
        for step in range(16):
            t = start + step * beat / 2
            note = root + (12 if step % 4 == 3 else 0)
            n = int(beat * 0.45 * SR)
            b = (sine(midi(note), n) * 0.8 + lowpass(saw(midi(note), n), 500) * 0.35) * env(n, 0.004, 0.08, 0.6, 0.08)
            place(mix, b, t, 0.34)
        # arp: sixteenths through the chord, an octave higher in the second half of the song
        order = [0, 1, 2, 3, 2, 1, 3, 2]
        for step in range(32):
            t = start + step * beat / 4
            note = chord[order[step % 8]] + 12 + (12 if index >= 4 and step % 8 > 4 else 0)
            place(mix, pluck(midi(note), 0.3), t, 0.16, -0.4 if step % 2 else 0.4)
    # drums
    for b in range(bars * 4):
        t = b * beat
        if b % 4 in (0, 2): place(mix, kick(), t, 0.78)
        if b % 4 in (1, 3): place(mix, snare(), t, 0.34)
        for h in range(2): place(mix, hat(open_=(b % 4 == 3 and h == 1)), t + h * beat / 2, 0.16 if h == 0 else 0.1, 0.25)
    # a little melody over the second half
    melody = [(0, 69), (1.5, 72), (2, 71), (3, 69), (4, 67), (5.5, 69), (6, 64), (7, 67)]
    for rep in range(bars // 8 - 0):
        if rep == 0: continue
        for at, note in melody:
            n = int(beat * 1.1 * SR); vib = 1 + 0.004 * sine(5.5, n)
            lead = (saw(midi(note), n) * 0.5 + square(midi(note) * 1.003, n, 0.45) * 0.3) * env(n, 0.02, 0.1, 0.7, 0.25)
            place(mix, lowpass(lead * vib, 3200), 8 * bar + rep * 0 + at * beat * 2, 0.12, 0.1)
    # side-chain the pad and the arp to the kick by ducking the whole mix lightly on each kick
    duck = np.ones(total)
    for b in range(0, bars * 4, 2):
        i = int(b * beat * SR); n = int(0.18 * SR)
        duck[i:i + n] *= np.linspace(0.62, 1, min(n, total - i))
    mix *= duck[:, None]
    mix = delay(mix, beat * 0.75, 0.4, 0.22, 3)[:total]
    mix[:int(0.01 * SR)] *= np.linspace(0, 1, int(0.01 * SR))[:, None]
    write('lobby', master(mix))

# ------------------------------------------------------------------------------------------------------------------ the duel loop
def duel():
    bpm = 136; beat = 60 / bpm; bar = beat * 4; bars = 16
    total = int(bar * bars * SR)
    mix = np.zeros((total, 2))
    chords = [[52, 55, 59, 64], [48, 52, 55, 60], [50, 54, 57, 62], [47, 50, 54, 59]]  # Em C D Bm
    for index in range(bars):
        chord = chords[index % 4]; start = index * bar
        root = chord[0] - 12
        # driving sixteenth bass
        for step in range(16):
            t = start + step * beat / 4
            note = root + (12 if step % 8 == 6 else 0)
            n = int(beat * 0.22 * SR)
            b = (lowpass(saw(midi(note), n), 900 + 700 * (step % 4 == 0)) * 0.7 + sine(midi(note), n) * 0.5) * env(n, 0.003, 0.05, 0.5, 0.05)
            place(mix, b, t, 0.3)
        # stabs on the offbeats
        for step in (2, 6, 10, 14):
            t = start + step * beat / 4
            n = int(beat * 0.3 * SR); st = np.zeros(n)
            for note in chord[1:]:
                st += saw(midi(note + 12), n, -0.003) + saw(midi(note + 12), n, 0.003)
            place(mix, lowpass(st, 2400) * env(n, 0.003, 0.08, 0.35, 0.1) * 0.05, t, 1.0, 0.2)
        # fast lead arpeggio, an octave up for the second half of each four bars
        order = [0, 2, 1, 3, 2, 3, 1, 2]
        for step in range(16):
            t = start + step * beat / 4
            note = chord[order[step % 8]] + 24 + (12 if index % 4 >= 2 and step % 4 == 3 else 0)
            place(mix, pluck(midi(note), 0.2, 4200), t, 0.1, -0.5 if step % 2 else 0.5)
    for b in range(bars * 4):
        t = b * beat
        place(mix, kick(), t, 0.95)
        if b % 2 == 1: place(mix, snare(), t, 0.5)
        for h in range(4): place(mix, hat(open_=(h == 2)), t + h * beat / 4, 0.13 if h % 2 == 0 else 0.07, 0.3)
    # riser into the loop point
    n = int(bar * SR); t = np.arange(n) / SR
    rise = highpass(noise(n), 1500) * np.linspace(0, 1, n) ** 2 * 0.22
    place(mix, rise, (bars - 1) * bar, 1.0)
    duck = np.ones(total)
    for b in range(bars * 4):
        i = int(b * beat * SR); k = int(0.12 * SR)
        duck[i:i + k] *= np.linspace(0.7, 1, min(k, total - i))
    mix *= duck[:, None]
    mix = delay(mix, beat * 0.75, 0.38, 0.18, 2)[:total]
    write('duel', master(mix))

# ------------------------------------------------------------------------------------------------------------------ jingles
def jingle(name, notes, bpm=120, wave_='saw', tail=0.8, gain=0.5):
    beat = 60 / bpm; total = int((max(a for a, _, _ in notes) * beat + tail + 1.2) * SR)
    mix = np.zeros((total, 2))
    for at, note, length in notes:
        n = int(length * beat * SR + 0.4 * SR)
        osc = saw(midi(note), n) * 0.6 + sine(midi(note), n) * 0.5 if wave_ == 'saw' else tri(midi(note), n)
        sound = lowpass(osc, 3800) * env(n, 0.01, 0.12, 0.6, 0.35)
        place(mix, sound, at * beat, gain, rng.uniform(-0.3, 0.3))
    mix = delay(mix, beat * 0.5, 0.4, 0.3, 3)[:total]
    write(name, master(mix, 0.75))

def jingles():
    # victory: a rising fanfare ending on a full chord
    jingle('victory', [(0, 60, 0.5), (0.5, 64, 0.5), (1, 67, 0.5), (1.5, 72, 1), (3, 60, 3), (3, 64, 3), (3, 67, 3), (3, 72, 3), (3, 76, 3)], 132)
    # defeat: slow and falling
    jingle('defeat', [(0, 67, 1), (1, 65, 1), (2, 63, 1), (3, 60, 3), (3, 55, 3), (3, 51, 3)], 84, 'tri', 1.2)
    # a point scored, and one lost
    jingle('point', [(0, 72, 0.5), (0.5, 79, 1.5)], 160)
    jingle('down', [(0, 64, 0.5), (0.5, 57, 1.5)], 160, 'tri', 0.5)
    # a card taken
    jingle('card', [(0, 76, 0.25), (0.25, 79, 0.25), (0.5, 83, 0.25), (0.75, 88, 1.5)], 180, 'tri', 0.6)

# ------------------------------------------------------------------------------------------------------------------ sound effects
# Short sounds that the game plays from the place where they happen (`ctx.audio.playAt`), so a shot is heard from the gun and a hit from the one hit.
def sweep(f0, f1, n, curve=6.0):
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t * curve * 10 / max(1e-3, n / SR))
    return np.sin(2 * np.pi * np.cumsum(f) / SR)

def sfx_sound(name, mono, gain=0.9):
    write(name, master(np.stack([mono, mono], axis=1), gain))

def sound_effects():
    # shot: a snap with a quick fall in pitch
    n = int(0.16 * SR); t = np.arange(n) / SR
    shot = (sweep(1500, 260, n, 5) * 0.6 + lowpass(noise(n), 5000) * 0.45) * np.exp(-t * 24)
    sfx_sound('shot', highpass(shot, 180))
    # hit: a thump and a crack of noise
    n = int(0.22 * SR); t = np.arange(n) / SR
    sfx_sound('hit', sweep(220, 70, n, 4) * np.exp(-t * 16) * 0.9 + lowpass(noise(n), 2600) * np.exp(-t * 28) * 0.8)
    # kill: bigger, longer, with a fall
    n = int(0.75 * SR); t = np.arange(n) / SR
    sfx_sound('kill', sweep(260, 40, n, 3) * np.exp(-t * 5) * 1.0 + lowpass(noise(n), 1800) * np.exp(-t * 6) * 0.9 + sweep(900, 120, n, 2) * np.exp(-t * 8) * 0.35)
    # block: a ring
    n = int(0.45 * SR); t = np.arange(n) / SR
    ring = sum(np.sin(2 * np.pi * f * t) * a for f, a in ((1100, 0.6), (1655, 0.4), (2210, 0.3), (3320, 0.15))) * np.exp(-t * 12)
    sfx_sound('block', ring + highpass(noise(n), 4000) * np.exp(-t * 80) * 0.5)
    # jump: a short rise
    n = int(0.14 * SR); t = np.arange(n) / SR
    sfx_sound('jump', sweep(780, 300, n, 2) * np.exp(-t * 18) * 0.7, 0.7)
    # land: a dull thud
    n = int(0.12 * SR); t = np.arange(n) / SR
    sfx_sound('land', sweep(150, 55, n, 4) * np.exp(-t * 26) * 0.9 + lowpass(noise(n), 900) * np.exp(-t * 40) * 0.4, 0.8)
    # reload: two clicks
    n = int(0.34 * SR); t = np.arange(n) / SR
    clicks = np.zeros(n)
    for at, g in ((0.0, 1.0), (0.2, 0.8)):
        i = int(at * SR); m = int(0.05 * SR)
        clicks[i:i + m] += highpass(noise(m), 1500) * np.exp(-np.arange(m) / SR * 80) * g + np.sin(2 * np.pi * 420 * np.arange(m) / SR) * np.exp(-np.arange(m) / SR * 90) * 0.4 * g
    sfx_sound('reload', clicks, 0.8)
    # empty: one dry click
    n = int(0.08 * SR); t = np.arange(n) / SR
    sfx_sound('empty', highpass(noise(n), 2000) * np.exp(-t * 90) * 0.8 + np.sin(2 * np.pi * 300 * t) * np.exp(-t * 100) * 0.3, 0.6)
    # bounce: a ping off a wall
    n = int(0.12 * SR); t = np.arange(n) / SR
    sfx_sound('bounce', sweep(1500, 800, n, 3) * np.exp(-t * 30) * 0.8, 0.7)
    # explosion: a long rumble
    n = int(1.0 * SR); t = np.arange(n) / SR
    sfx_sound('explosion', lowpass(noise(n), 900) * np.exp(-t * 4.5) * 1.0 + sweep(140, 35, n, 2) * np.exp(-t * 4) * 0.9, 0.95)
    # menu click
    n = int(0.07 * SR); t = np.arange(n) / SR
    sfx_sound('click', np.sin(2 * np.pi * 900 * t) * np.exp(-t * 60) * 0.7 + highpass(noise(n), 3000) * np.exp(-t * 120) * 0.2, 0.6)

if __name__ == '__main__':
    which = sys.argv[1:] or ['lobby', 'duel', 'jingles', 'sfx']
    if 'sfx' in which: sound_effects()
    if 'lobby' in which: lobby()
    if 'duel' in which: duel()
    if 'jingles' in which: jingles()
