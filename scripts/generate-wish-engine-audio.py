"""Render the original Wish Engine score. Requires Python 3 and ffmpeg; no downloaded samples."""
from array import array
from math import sin, cos, exp, pi, tanh
from pathlib import Path
import subprocess
import tempfile
import wave

RATE = 22050
OUTPUT = Path(__file__).resolve().parents[1] / "static/audio/wish-engine"
TAU = 2 * pi


def render(name, duration, warmth, bells, resolve=False):
    frames = int(duration * RATE)
    channels = [array("f", [0.0]) * frames, array("f", [0.0]) * frames]
    chords = [[110, 164.8138, 220, 261.6256], [87.3071, 130.8128, 174.6141, 220],
              [130.8128, 195.9977, 261.6256, 329.6276], [97.9989, 146.8324, 195.9977, 246.9417]]
    for bar, chord in enumerate(chords):
        start = bar * 6
        length = 10 if bar < 3 else duration - start
        for voice, frequency in enumerate(chord):
            for i in range(int(length * RATE)):
                at = int(start * RATE) + i
                if at >= frames:
                    break
                t = i / RATE
                envelope = min(1, t / 2.6) * min(1, (length - t) / 3)
                phase = TAU * frequency * t
                pad = (sin(phase) + .27 * sin(phase * 2.002) + warmth * .13 * sin(phase * 3))
                breath = .85 + .15 * sin(t * .6 + voice)
                sample = pad * envelope * breath * .041
                pan = .32 + voice * .12
                channels[0][at] += sample * (1 - pan)
                channels[1][at] += sample * pan
    notes = [440, 659.255, 523.251, 783.991, 587.330, 880, 659.255, 1046.502]
    step = 3 if name == "light" else 1.5
    for hit in range(int((duration - 2) / step)):
        start = 1 + hit * step
        frequency = notes[(hit * 3) % len(notes)]
        for i in range(int(3 * RATE)):
            at = int(start * RATE) + i
            if at >= frames:
                break
            t = i / RATE
            envelope = min(1, t * 100) * exp(-t * 1.65)
            bell = sin(TAU * frequency * t) + .3 * sin(TAU * frequency * 2.756 * t) * exp(-t * 3)
            sample = bell * envelope * .08 * bells
            pan = .2 if hit % 2 else .8
            channels[0][at] += sample * pan
            channels[1][at] += sample * (1 - pan)
    # Soft stereo echoes, kept below the direct sound.
    for channel in channels:
        delay = int(.43 * RATE)
        for i in range(delay, frames):
            channel[i] += channel[i - delay] * .19
    pcm = array("h")
    for i in range(frames):
        t = i / RATE
        envelope = min(1, t / 1.5, (duration - t) / (4 if resolve else 1.5))
        for channel in channels:
            pcm.append(round(tanh(channel[i] * 2.2) * envelope * 30000))
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="wish-score-") as directory:
        source = Path(directory) / (name + ".wav")
        with wave.open(str(source), "wb") as output:
            output.setnchannels(2)
            output.setsampwidth(2)
            output.setframerate(RATE)
            output.writeframes(pcm.tobytes())
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
                        "-c:a", "libvorbis", "-q:a", "4", "-metadata", "title=The Wish Engine - " + name,
                        str(OUTPUT / (name + ".ogg"))], check=True)
    print("Rendered", name)


if __name__ == "__main__":
    render("light", 24, .3, .65)
    render("time", 24, .7, .55)
    render("sky", 24, 1.4, .8)
    render("release", 28, 1.8, 1, True)
