"""Draws the materials of the ball machine (assets/balls/<id>.webp): 512x512, tileable across (they wrap round a sphere).
Run: python3 worlds/bowling/tools/makeBallMaterials.py   (needs numpy and Pillow)."""
import os
import numpy as np
from PIL import Image

N = 512
out = os.path.join(os.path.dirname(__file__), '..', 'assets', 'balls')
os.makedirs(out, exist_ok=True)
u, v = np.meshgrid(np.arange(N) / N, np.arange(N) / N)
TAU = 2 * np.pi


def hexrgb(c):
    return np.array([int(c[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float32)


def field(seed, octaves=4):
    """Smooth noise that wraps across (integer waves in u): a sum of random sinusoids."""
    r = np.random.default_rng(seed)
    f = np.zeros_like(u)
    for o in range(octaves):
        for _ in range(3):
            ku = int(r.integers(1, 3 + o * 2))
            kv = float(r.uniform(0.5, 2 + o * 2))
            f += (0.6 ** o) * np.sin(TAU * (ku * u + kv * v) + r.uniform(0, TAU))
    return f / 3


def ramp(t, palette):
    """Colours along a palette for t in 0..1 (wrapping)."""
    cols = np.array([hexrgb(c) for c in palette])
    x = (t % 1.0) * (len(cols) - 1)
    i = np.clip(x.astype(int), 0, len(cols) - 2)
    f = (x - i)[..., None]
    return cols[i] * (1 - f) + cols[i + 1] * f


def swirl(seed, palette, freq=3, warp=0.35):
    a, b, c = field(seed), field(seed + 1), field(seed + 2)
    t = 0.5 + 0.5 * np.sin(TAU * (freq * (u + warp * a) + 1.5 * (v + warp * b) + 2 * warp * c))
    return ramp(t, palette)


def save(name, rgb):
    Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).save(os.path.join(out, name + '.webp'), 'WEBP', quality=88, method=6)
    print(name)


save('midnight', swirl(1, ['#050a1e', '#1e3a8a', '#93c5fd', '#1e3a8a', '#050a1e']))
save('lava', swirl(2, ['#1a0500', '#7f1d1d', '#ea580c', '#fde047', '#ea580c', '#450a0a'], freq=2, warp=0.5))
save('ocean', swirl(3, ['#042f3a', '#0e7490', '#67e8f9', '#ffffff', '#0e7490', '#042f3a']))
stars = (np.random.default_rng(9).random((N, N)) > 0.9975).astype(np.float32)[..., None]
save('galaxy', swirl(4, ['#0b0220', '#4c1d95', '#c026d3', '#4c1d95', '#0b0220'], warp=0.5) + stars * 255)
save('candy', swirl(5, ['#ec4899', '#ffffff', '#ec4899', '#fbcfe8', '#ec4899'], freq=4, warp=0.2))
save('emerald', swirl(6, ['#022c22', '#059669', '#6ee7b7', '#059669', '#022c22']))
grain = field(7, 5)
save('gold', ramp(0.5 + 0.35 * grain, ['#7c4a03', '#ca8a04', '#fde68a', '#facc15', '#a16207']))
i, j = (u * 64).astype(int), (v * 64).astype(int)
twill = (((i + j) % 4) < 2).astype(np.float32)
fine = 0.5 + 0.5 * np.sin(TAU * (u * 128)) * np.sin(TAU * (v * 128))
save('carbon', (hexrgb('#111114')[None, None] * (0.6 + 0.4 * twill[..., None]) + 40 * fine[..., None] * twill[..., None]))
lines = np.maximum(np.abs(np.sin(np.pi * u * 16)) < 0.07, np.abs(np.sin(np.pi * v * 8)) < 0.07).astype(np.float32)
neon = np.where(((u * 16).astype(int) % 2 == 0)[..., None], hexrgb('#22d3ee'), hexrgb('#f472b6'))
save('neon', hexrgb('#05050a')[None, None] + lines[..., None] * neon)
save('pearl', swirl(8, ['#f8fafc', '#fbcfe8', '#bae6fd', '#e9d5ff', '#f8fafc'], warp=0.25))
blob = field(10, 3) + 0.5 * field(11, 3)
camo = np.empty((N, N, 3), dtype=np.float32)
camo[:] = hexrgb('#a3a35a')
for limit, colour in ((0.5, '#1f3d12'), (0.0, '#4d7c0f'), (-0.5, '#3f2f1a')):
    camo[blob < limit] = hexrgb(colour)
save('camo', camo)
check = (((u * 12).astype(int) + (v * 6).astype(int)) % 2 == 0)[..., None]
save('checker', np.where(check, hexrgb('#f4f4f5'), hexrgb('#18181b')))
