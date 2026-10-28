#!/usr/bin/env python3
"""Reads the maps of ROUNDS out of its own files and writes src/world/maps.json.

Every map of the game is a Unity scene (Rounds_Data/levelN) of boxes, circles and spawn points. This takes the colliders as they are placed
in the scene (parents, rotations and scales applied), the spawn points, and nothing else: it is the geometry the 2D game plays on.

    python3 tools/extract-maps.py /path/to/ROUNDS            # needs: pip install UnityPy

The list of levels kept is CHOSEN below: the maps made of static blocks (the ones with hazards, ropes or hundreds of loose physics boxes are left out).
"""
import json, math, os, sys

import UnityPy

LEVELS = [2, 3, 4, 5, 6, 8, 11, 13, 14, 15, 16, 18, 19, 20, 21, 22, 23, 38, 39, 40, 45, 49, 66, 71]


def rotation_z(q):
    """Degrees about z of a quaternion (the game is 2D: nothing turns about another axis)."""
    return math.degrees(2 * math.atan2(q.z, q.w))


def read_level(root, n):
    ggm = [os.path.join(root, 'Rounds_Data', 'globalgamemanagers'), os.path.join(root, 'Rounds_Data', 'globalgamemanagers.assets')]
    env = UnityPy.load(os.path.join(root, 'Rounds_Data', f'level{n}'), *ggm)
    scene = next(v for k, v in env.files.items() if os.path.basename(k) == f'level{n}')
    objs = scene.objects
    go, tr = {}, {}
    for pid, o in objs.items():
        if o.type.name == 'GameObject':
            g = o.read()
            go[pid] = {'name': g.m_Name, 'active': g.m_IsActive, 'comps': [(c.component if hasattr(c, 'component') else c).m_PathID for c in g.m_Components]}
        elif o.type.name == 'Transform':
            t = o.read()
            tr[t.m_GameObject.m_PathID] = {'pos': (t.m_LocalPosition.x, t.m_LocalPosition.y), 'rot': rotation_z(t.m_LocalRotation), 'scale': (t.m_LocalScale.x, t.m_LocalScale.y), 'father': t.m_Father.m_PathID, 'pid': pid}
    owner = {v['pid']: k for k, v in tr.items()}

    def world(gid):
        t = tr[gid]
        if t['father'] == 0 or t['father'] not in owner:
            return (t['pos'][0], t['pos'][1], t['rot'], t['scale'][0], t['scale'][1], go[gid]['active'])
        px, py, pa, psx, psy, pact = world(owner[t['father']])
        lx, ly = t['pos'][0] * psx, t['pos'][1] * psy
        c, s = math.cos(math.radians(pa)), math.sin(math.radians(pa))
        return (px + lx * c - ly * s, py + lx * s + ly * c, pa + t['rot'], psx * t['scale'][0], psy * t['scale'][1], pact and go[gid]['active'])

    boxes, circles, spawns = [], [], {}
    for gid, g in go.items():
        if gid not in tr:
            continue
        x, y, a, sx, sy, active = world(gid)
        if g['name'].startswith('SPAWN POINT') and active:
            spawns[g['name'][-1]] = [round(x, 3), round(y, 3)]
        for cid in g['comps']:
            o = objs.get(cid)
            if o is None or not active:
                continue
            if o.type.name == 'BoxCollider2D':
                b = o.read()
                if b.m_IsTrigger or not b.m_Enabled:
                    continue
                c, s = math.cos(math.radians(a)), math.sin(math.radians(a))
                ox, oy = b.m_Offset.x * sx, b.m_Offset.y * sy
                angle = (a + 180) % 360 - 180
                boxes.append([round(x + ox * c - oy * s, 3), round(y + ox * s + oy * c, 3), round(abs(b.m_Size.x * sx), 3), round(abs(b.m_Size.y * sy), 3), round(angle, 2)])
            elif o.type.name == 'CircleCollider2D':
                b = o.read()
                if b.m_IsTrigger or not b.m_Enabled:
                    continue
                circles.append([round(x + b.m_Offset.x * sx, 3), round(y + b.m_Offset.y * sy, 3), round(b.m_Radius * max(abs(sx), abs(sy)), 3)])
    return {'level': n, 'boxes': boxes, 'circles': circles, 'spawns': spawns}


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('ROUNDS_DIR', '')
    if not os.path.isdir(os.path.join(root, 'Rounds_Data')):
        sys.exit('usage: extract-maps.py /path/to/ROUNDS')
    maps = []
    for n in LEVELS:
        m = read_level(root, n)
        print(f"level{n}: {len(m['boxes'])} boxes, {len(m['circles'])} circles, spawns {sorted(m['spawns'])}")
        maps.append(m)
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'world', 'maps.json')
    with open(out, 'w') as f:
        json.dump({'bounds': {'x': 35.56, 'y': 20}, 'maps': maps}, f, separators=(',', ':'))
    print('wrote', os.path.normpath(out))


main()
