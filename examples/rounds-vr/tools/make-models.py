#!/usr/bin/env python3
"""
Writes the 3D models of ROUNDS VR to static/content/models/*.glb. Each one is described as a signed distance field (rounded boxes, capsules,
ellipsoids, smooth unions), meshed with marching cubes, simplified and exported with PBR materials: that is what gives them soft, bevelled
edges instead of the sharp corners of primitives. Needs numpy, trimesh, scikit-image and fast_simplification:
    python3 tools/make-models.py [name ...]
Models are authored the way the engine shows them: metres, +Y up, the front toward +Z; the glTF file is written mirrored in z, which is what
Babylon undoes when it loads a glTF.
"""
import sys
from pathlib import Path
import numpy as np
import trimesh
from skimage.measure import marching_cubes
import fast_simplification

OUT = Path(__file__).resolve().parent.parent / 'static' / 'content' / 'models'

# ---------------------------------------------------------------------------------------------------------------------------- distance fields
def length(v): return np.sqrt(np.sum(v * v, axis=-1))

def round_box(p, c, half, r=0.0):
    q = np.abs(p - c) - (np.array(half) - r)
    return length(np.maximum(q, 0)) + np.minimum(np.max(q, axis=-1), 0) - r

def sphere(p, c, r): return length(p - c) - r

def ellipsoid(p, c, radii):
    radii = np.array(radii); k = length((p - c) / radii)
    return (k - 1.0) * np.min(radii)

def capsule(p, a, b, r, squash=(1, 1, 1)):
    a, b = np.array(a, float), np.array(b, float); q = (p - a) * np.array(squash)
    ba = (b - a) * np.array(squash); h = np.clip(np.sum(q * ba, -1) / np.sum(ba * ba), 0, 1)
    return length(q - ba * h[..., None]) - r

def cylinder_z(p, c, r, half_len, rnd=0.0):
    d = np.stack([length((p - c)[..., :2]) - r + rnd, np.abs((p - c)[..., 2]) - half_len + rnd], -1)
    return np.minimum(np.maximum(d[..., 0], d[..., 1]), 0) + length(np.maximum(d, 0)) - rnd

def cylinder_y(p, c, r, half_h, rnd=0.0):
    q = p - c
    d = np.stack([np.sqrt(q[..., 0] ** 2 + q[..., 2] ** 2) - r + rnd, np.abs(q[..., 1]) - half_h + rnd], -1)
    return np.minimum(np.maximum(d[..., 0], d[..., 1]), 0) + length(np.maximum(d, 0)) - rnd

def torus_z(p, c, major, minor):
    q = p - c
    return np.sqrt((np.sqrt(q[..., 0] ** 2 + q[..., 1] ** 2) - major) ** 2 + q[..., 2] ** 2) - minor

def torus_y(p, c, major, minor):
    q = p - c
    return np.sqrt((np.sqrt(q[..., 0] ** 2 + q[..., 2] ** 2) - major) ** 2 + q[..., 1] ** 2) - minor

def torus_x(p, c, major, minor):
    q = p - c
    return np.sqrt((np.sqrt(q[..., 1] ** 2 + q[..., 2] ** 2) - major) ** 2 + q[..., 0] ** 2) - minor

def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)

def subtract(a, b): return np.maximum(a, -b)
def rot(angle, axis):
    c, s = np.cos(angle), np.sin(angle)
    return {'x': np.array([[1, 0, 0], [0, c, -s], [0, s, c]]), 'y': np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]]), 'z': np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])}[axis]

# ---------------------------------------------------------------------------------------------------------------------------- meshing
class Part:
    """A signed distance field and the material it is made of."""
    def __init__(self, fn, material): self.fn, self.material = fn, material

def material(name, color, metal=0.0, rough=0.6, emissive=None):
    return trimesh.visual.material.PBRMaterial(name=name, baseColorFactor=[*(int(color[i:i + 2], 16) for i in (1, 3, 5)), 255], metallicFactor=metal, roughnessFactor=rough,
                                                emissiveFactor=[int(emissive[i:i + 2], 16) / 255 for i in (1, 3, 5)] if emissive else [0, 0, 0])

def build(name, parts, lo, hi, voxel, faces=6000, smooth=0.0):
    """Meshes the union of the parts over the box lo..hi, gives each triangle the material of the part nearest to it, and writes the GLB."""
    lo, hi = np.array(lo, float), np.array(hi, float)
    dims = np.ceil((hi - lo) / voxel).astype(int) + 1
    axes = [lo[i] + np.arange(dims[i]) * voxel for i in range(3)]
    grid = np.stack(np.meshgrid(*axes, indexing='ij'), -1)
    fields = [part.fn(grid) for part in parts]
    solid = fields[0]
    for f in fields[1:]: solid = smin(solid, f, smooth) if smooth else np.minimum(solid, f)
    pad = np.pad(solid, 1, constant_values=1.0)
    verts, tri, normals, _ = marching_cubes(pad, level=0.0, spacing=(voxel, voxel, voxel))
    verts = verts - voxel + lo
    mesh = trimesh.Trimesh(verts, tri, vertex_normals=normals, process=False)
    if len(mesh.faces) > faces:
        v, f = fast_simplification.simplify(mesh.vertices, mesh.faces, target_reduction=1 - faces / len(mesh.faces))
        mesh = trimesh.Trimesh(v, f, process=True)
    centers = mesh.vertices[mesh.faces].mean(axis=1)
    owner = np.argmin(np.stack([part.fn(centers) for part in parts], 0), 0)
    scene = trimesh.Scene()
    used = {}
    for index, part in enumerate(parts):
        sel = owner == index
        if not sel.any(): continue
        key = part.material.name
        used.setdefault(key, []).append(mesh.faces[sel])
    for key, chunks in used.items():
        part = next(p for p in parts if p.material.name == key)
        faces_ = np.concatenate(chunks, 0)
        sub = trimesh.Trimesh(mesh.vertices, faces_, process=False)
        sub.remove_unreferenced_vertices()
        sub.fix_normals()
        # Babylon mirrors z when it loads a glTF: write the model mirrored, with the triangles turned round.
        v = sub.vertices.copy(); v[:, 2] *= -1
        flipped = trimesh.Trimesh(v, sub.faces[:, ::-1], process=False)
        flipped.visual = trimesh.visual.TextureVisuals(material=part.material)
        scene.add_geometry(flipped, geom_name=key)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f'{name}.glb'
    scene.export(str(path))
    print(f'{name}: {sum(len(g.faces) for g in scene.geometry.values())} triangles, {path.stat().st_size // 1024} KiB')

BLUE, ORANGE = '#38bdf8', '#fb923c'
STEEL = lambda: material('steel', '#aab4c0', 1.0, 0.28)
GUNMETAL = lambda: material('gunmetal', '#2b3038', 0.85, 0.38)
POLYMER = lambda: material('polymer', '#15171c', 0.0, 0.7)
GOLD = lambda: material('gold', '#fbbf24', 1.0, 0.3)

# ---------------------------------------------------------------------------------------------------------------------------- the models
def pistol(team, accent):
    gunmetal, polymer, steel, glow = GUNMETAL(), POLYMER(), STEEL(), material(f'glow-{team}', accent, 0.0, 0.4, accent)
    c = lambda *a: np.array(a, float)
    parts = [
        Part(lambda p: round_box(p, c(0, 0.034, 0.09), (0.0195, 0.021, 0.106), 0.009), gunmetal),
        Part(lambda p: round_box(p, c(0, 0.0, 0.07), (0.0165, 0.013, 0.084), 0.006), polymer),
        Part(lambda p: capsule(p, (0, -0.002, -0.018), (0, -0.108, -0.05), 0.0205, (1.28, 1, 1)), polymer),
        Part(lambda p: round_box(p, c(0, -0.117, -0.053), (0.0185, 0.006, 0.026), 0.004), gunmetal),
        Part(lambda p: torus_x(p, c(0, -0.022, 0.044), 0.022, 0.0036) + 0 * p[..., 0], polymer),
        Part(lambda p: capsule(p, (0, -0.012, 0.038), (0, -0.032, 0.034), 0.0042), steel),
        Part(lambda p: cylinder_z(p, c(0, 0.034, 0.204), 0.0105, 0.012, 0.003), steel),
        Part(lambda p: round_box(p, c(0, 0.059, 0.178), (0.0028, 0.0045, 0.004), 0.001), glow),
        Part(lambda p: round_box(p, c(0, 0.059, 0.004), (0.0075, 0.0045, 0.004), 0.001), glow),
        Part(lambda p: round_box(p, c(0.02, 0.034, 0.105), (0.0016, 0.0045, 0.055), 0.0008), glow),
        Part(lambda p: round_box(p, c(-0.02, 0.034, 0.105), (0.0016, 0.0045, 0.055), 0.0008), glow),
    ]
    build(f'pistol-{team}', parts, (-0.04, -0.14, -0.1), (0.04, 0.08, 0.23), 0.0016, faces=7000, smooth=0.004)

def shield(team, accent, dark):
    plate, steel, gold, leather = material(f'enamel-{team}', dark, 0.35, 0.42), STEEL(), GOLD(), material('leather', '#3a2412', 0.0, 0.9)
    glow = material(f'inlay-{team}', accent, 0.0, 0.4, accent)
    c = lambda *a: np.array(a, float)
    def dome(p):
        d = cylinder_z(p, c(0, 0, 0.03), 0.205, 0.008, 0.004)
        cap = ellipsoid(p, c(0, 0, 0.03), (0.2, 0.2, 0.038))
        return np.minimum(d, np.maximum(cap, -(p[..., 2] - 0.03) * -1 - 0.0 + 0.0))
    parts = [
        Part(dome, plate),
        Part(lambda p: torus_z(p, c(0, 0, 0.03), 0.205, 0.0125), steel),
        Part(lambda p: torus_z(p, c(0, 0, 0.052), 0.12, 0.0035), glow),
        Part(lambda p: ellipsoid(p, c(0, 0, 0.066), (0.052, 0.052, 0.028)), gold),
    ]
    for k in range(8):
        a = k * np.pi / 4
        parts.append(Part(lambda p, a=a: sphere(p, c(0.158 * np.cos(a), 0.158 * np.sin(a), 0.046), 0.0105), gold))
    parts += [
        Part(lambda p: capsule(p, (-0.07, 0, -0.012), (0.07, 0, -0.012), 0.012), leather),
        Part(lambda p: capsule(p, (-0.09, -0.06, 0.0), (-0.07, 0, -0.012), 0.006), leather),
        Part(lambda p: capsule(p, (0.09, -0.06, 0.0), (0.07, 0, -0.012), 0.006), leather),
    ]
    build(f'shield-{team}', parts, (-0.23, -0.23, -0.05), (0.23, 0.23, 0.1), 0.003, faces=7000, smooth=0.002)

def blob(team, color, dark):
    skin, shoe, mitt = material(f'blob-{team}', color, 0.0, 0.5), material('shoe', '#1b1c1e', 0.0, 0.6), material(f'mitt-{team}', dark, 0.0, 0.6)
    c = lambda *a: np.array(a, float)
    parts = [
        Part(lambda p: ellipsoid(p, c(0, 0.7, 0), (0.5, 0.7, 0.5)), skin),
        Part(lambda p: ellipsoid(p, c(-0.2, 0.06, 0.05), (0.16, 0.08, 0.24)), shoe),
        Part(lambda p: ellipsoid(p, c(0.2, 0.06, 0.05), (0.16, 0.08, 0.24)), shoe),
        Part(lambda p: sphere(p, c(-0.5, 0.58, 0.18), 0.12), mitt),
        Part(lambda p: sphere(p, c(0.5, 0.58, 0.18), 0.12), mitt),
    ]
    build(f'blob-{team}', parts, (-0.7, -0.05, -0.5), (0.7, 1.45, 0.55), 0.016, faces=5000, smooth=0.05)

def plant():
    pot, soil, leaf, leaf2 = material('pot', '#b45309', 0.0, 0.75), material('soil', '#2b1d12', 0.0, 0.95), material('leaf', '#22a355', 0.0, 0.55), material('leaf2', '#157f3d', 0.0, 0.55)
    c = lambda *a: np.array(a, float)
    def pot_sdf(p):
        body = cylinder_y(p, c(0, 0.22, 0), 0.2, 0.22, 0.02)
        taper = np.maximum(body, (length(p[..., [0, 2]]) - (0.17 + 0.06 * (p[..., 1] / 0.45))))
        inner = cylinder_y(p, c(0, 0.36, 0), 0.17, 0.12, 0.0)
        rim = torus_y = np.sqrt((length(p[..., [0, 2]]) - 0.24) ** 2 + (p[..., 1] - 0.44) ** 2) - 0.03
        return np.minimum(subtract(taper, inner), rim)
    parts = [Part(pot_sdf, pot), Part(lambda p: cylinder_y(p, c(0, 0.4, 0), 0.19, 0.012, 0.004), soil)]
    for k in range(11):
        yaw = k * 2.399963; lean = 0.55 + 0.45 * ((k * 7) % 5) / 5; size = 0.26 + 0.1 * ((k * 3) % 4) / 4
        R = rot(yaw, 'y') @ rot(lean, 'z')
        def blade(p, R=R, size=size):
            q = (p - c(0, 0.41, 0)) @ R
            # a blade bends over as it grows: lift the far end back down
            q = q + np.stack([0 * q[..., 0], 0.5 * np.maximum(q[..., 0] - 0.05, 0) ** 2 * 1.6, 0 * q[..., 0]], -1)
            return ellipsoid(q, c(size, 0.0, 0.0), (size, 0.016, size * 0.38))
        parts.append(Part(blade, leaf if k % 2 == 0 else leaf2))
    build('plant', parts, (-0.62, -0.02, -0.62), (0.62, 1.05, 0.62), 0.008, faces=7000, smooth=0.004)

def trophy():
    gold, base = GOLD(), material('marble', '#1f1147', 0.0, 0.35)
    c = lambda *a: np.array(a, float)
    def cup(p):
        outer = sphere(p, c(0, 0.2, 0), 0.13); inner = sphere(p, c(0, 0.205, 0), 0.118)
        bowl = np.maximum(subtract(outer, inner), p[..., 1] - 0.2 + 0.0 * p[..., 0] - 0.0)
        bowl = np.maximum(bowl, -(p[..., 1] - 0.2) * -1) if False else bowl
        return subtract(np.maximum(outer, 0 * outer), np.maximum(inner, -(p[..., 1] - 0.205)))
    parts = [
        Part(lambda p: round_box(p, c(0, 0.015, 0), (0.1, 0.015, 0.1), 0.01), base),
        Part(lambda p: cylinder_y(p, c(0, 0.05, 0), 0.07, 0.015, 0.006), gold),
        Part(lambda p: capsule(p, (0, 0.06, 0), (0, 0.15, 0), 0.016), gold),
        Part(lambda p: sphere(p, c(0, 0.1, 0), 0.03), gold),
        Part(lambda p: np.maximum(subtract(sphere(p, c(0, 0.22, 0), 0.13), sphere(p, c(0, 0.235, 0), 0.118)), p[..., 1] - 0.285), gold),
        Part(lambda p: torus_z(p, c(0.145, 0.25, 0), 0.05, 0.0085) + 0 * p[..., 0], gold),
        Part(lambda p: torus_z(p, c(-0.145, 0.25, 0), 0.05, 0.0085) + 0 * p[..., 0], gold),
    ]
    build('trophy', parts, (-0.24, -0.01, -0.14), (0.24, 0.32, 0.14), 0.0035, faces=6000, smooth=0.004)

def lamp():
    shade, glassy, cord = material('shade', '#f59e0b', 0.4, 0.35), material('shade-inside', '#fff1c2', 0.0, 0.5, '#ffd48a'), material('cord', '#1a1033', 0.0, 0.8)
    c = lambda *a: np.array(a, float)
    shell = lambda p: np.maximum(subtract(sphere(p, c(0, 0, 0), 0.34), sphere(p, c(0, 0, 0), 0.322)), -p[..., 1])
    parts = [
        Part(shell, shade),
        Part(lambda p: np.maximum(sphere(p, c(0, 0, 0), 0.3), np.maximum(-p[..., 1], p[..., 1] - 0.02)), glassy),
        Part(lambda p: torus_y(p, c(0, 0.0, 0), 0.331, 0.012), shade),
        Part(lambda p: cylinder_y(p, c(0, 0.36, 0), 0.032, 0.03, 0.008), shade),
        Part(lambda p: capsule(p, (0, 0.38, 0), (0, 0.95, 0), 0.006), cord),
    ]
    build('lamp', parts, (-0.4, -0.05, -0.4), (0.4, 1.0, 0.4), 0.007, faces=5000, smooth=0.003)

def beanbag(name, color):
    fabric = material(f'fabric-{name}', color, 0.0, 0.95)
    c = lambda *a: np.array(a, float)
    def bag(p):
        q = p - c(0, 0.0, 0)
        base = length(q / np.array([0.62, 0.4, 0.58])) - 1.0
        wobble = 0.03 * (np.sin(q[..., 0] * 9) * np.sin(q[..., 2] * 8) + 0.6 * np.sin(q[..., 0] * 17 + q[..., 2] * 5))
        top = 0.05 * np.exp(-((q[..., 0] + 0.15) ** 2 + (q[..., 2] - 0.1) ** 2) / 0.05) * (q[..., 1] > 0)
        return (base + wobble * 0.7 - top * 2) * 0.4
    build(f'beanbag-{name}', [Part(bag, fabric)], (-0.7, -0.45, -0.66), (0.7, 0.5, 0.66), 0.012, faces=5000)

def crate():
    wood, dark, metal = material('wood', '#c8975a', 0.0, 0.85), material('wood-dark', '#8a5f33', 0.0, 0.9), material('bracket', '#6b7280', 0.9, 0.45)
    c = lambda *a: np.array(a, float)
    h = 0.4
    parts = [Part(lambda p: round_box(p, c(0, 0, 0), (h - 0.02, h - 0.02, h - 0.02), 0.01), dark)]
    for sx in (-1, 1):
        for sz in (-1, 1):
            parts.append(Part(lambda p, sx=sx, sz=sz: round_box(p, c(sx * (h - 0.04), 0, sz * (h - 0.04)), (0.04, h, 0.04), 0.008), dark))
    for sy in (-1, 1):
        for sz in (-1, 1):
            parts.append(Part(lambda p, sy=sy, sz=sz: round_box(p, c(0, sy * (h - 0.04), sz * (h - 0.04)), (h, 0.04, 0.04), 0.008), dark))
        for sx in (-1, 1):
            parts.append(Part(lambda p, sy=sy, sx=sx: round_box(p, c(sx * (h - 0.04), sy * (h - 0.04), 0), (0.04, 0.04, h), 0.008), dark))
    for k in range(4):
        y = -0.3 + k * 0.2
        for sz in (-1, 1): parts.append(Part(lambda p, y=y, sz=sz: round_box(p, c(0, y, sz * (h - 0.012)), (h - 0.05, 0.085, 0.012), 0.006), wood))
        for sx in (-1, 1): parts.append(Part(lambda p, y=y, sx=sx: round_box(p, c(sx * (h - 0.012), y, 0), (0.012, 0.085, h - 0.05), 0.006), wood))
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                parts.append(Part(lambda p, sx=sx, sy=sy, sz=sz: sphere(p, c(sx * (h - 0.01), sy * (h - 0.01), sz * (h - 0.01)), 0.03), metal))
    build('crate', parts, (-h - 0.03, -h - 0.03, -h - 0.03), (h + 0.03, h + 0.03, h + 0.03), 0.008, faces=7000)

def pedestal(team, accent):
    stone, glow = material('stone', '#241758', 0.0, 0.4), material(f'ring-{team}', accent, 0.0, 0.4, accent)
    c = lambda *a: np.array(a, float)
    parts = [
        Part(lambda p: cylinder_y(p, c(0, 0.1, 0), 0.55, 0.1, 0.03), stone),
        Part(lambda p: cylinder_y(p, c(0, 0.3, 0), 0.46, 0.1, 0.03), stone),
        Part(lambda p: cylinder_y(p, c(0, 0.5, 0), 0.52, 0.06, 0.02), stone),
        Part(lambda p: np.maximum(cylinder_y(p, c(0, 0.58, 0), 0.5, 0.012, 0.004), -cylinder_y(p, c(0, 0.58, 0), 0.43, 0.02)), glow),
    ]
    build(f'pedestal-{team}', parts, (-0.6, -0.01, -0.6), (0.6, 0.62, 0.6), 0.012, faces=4500, smooth=0.01)

MODELS = {
    'pistol-blue': lambda: pistol('blue', BLUE), 'pistol-orange': lambda: pistol('orange', ORANGE),
    'shield-blue': lambda: shield('blue', BLUE, '#0c4a6e'), 'shield-orange': lambda: shield('orange', ORANGE, '#7c2d12'),
    'blob-blue': lambda: blob('blue', '#2f9be0', '#0c4a6e'), 'blob-orange': lambda: blob('orange', '#f5833a', '#7c2d12'),
    'plant': plant, 'trophy': trophy, 'lamp': lamp,
    'beanbag-violet': lambda: beanbag('violet', '#7c3aed'), 'beanbag-pink': lambda: beanbag('pink', '#ec4899'),
    'crate': crate,
    'pedestal-blue': lambda: pedestal('blue', BLUE), 'pedestal-orange': lambda: pedestal('orange', ORANGE),
}

if __name__ == '__main__':
    for name in (sys.argv[1:] or list(MODELS)):
        MODELS[name]()
