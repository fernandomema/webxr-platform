#!/usr/bin/env python3
"""Reads the cards of ROUNDS out of its own files and writes src/world/cards.json.

Each card is a prefab: a `CardInfo` (name, text, rarity) next to the `Gun`, `Block` and `CharacterStatModifiers` that say what it changes. The
values in those components are read as the game stores them (multipliers, additions, switches); nothing is converted here.

    python3 tools/extract-cards.py /path/to/ROUNDS            # needs: pip install UnityPy TypeTreeGeneratorAPI

The names and texts of cards the game translates come from its English string table (StreamingAssets/aa/...string-tables-english...).
"""
import glob, json, os, struct, sys

import UnityPy
from UnityPy.helpers.TypeTreeGenerator import TypeTreeGenerator

CLASSES = ['CardInfo', 'Gun', 'Block', 'CharacterStatModifiers']
# What a component holds when a card leaves it alone: only what differs is written.
DEFAULTS = {
    'Gun': {'damage': 1, 'reloadTime': 1, 'attackSpeed': 1, 'projectileSpeed': 1, 'gravity': 1, 'recoilMuiltiplier': 1, 'knockback': 1, 'multiplySpread': 1, 'bulletDamageMultiplier': 1, 'speedMOnBounce': 1, 'dmgMOnBounce': 1, 'dragMinSpeed': 1, 'damageAfterDistanceMultiplier': 1, 'projectielSimulatonSpeed': 1, 'shakeM': 1, 'chargeDamageMultiplier': 1, 'hitMovementMultiplier': 1, 'defaultCooldown': 1, 'attackSpeedMultiplier': 1},
    'Block': {'cooldown': 4, 'counter': 1000, 'cdMultiplier': 1},
    'CharacterStatModifiers': {'sizeMultiplier': 1, 'health': 1, 'movementSpeed': 1, 'jump': 1, 'gravity': 1, 'tasteOfBloodSpeed': 1, 'rageSpeed': 1, 'attackSpeedMultiplier': 1, 'automaticReload': 1},
}
SKIP = {'m_GameObject', 'm_Enabled', 'm_Script', 'm_Name', 'm_EditorHideFlags', 'sinceAttack', 'sinceBlock', 'isReloading', 'attackID', 'soundDisableRayHitBulletSound', 'dontAllowBeekeeperAchievement', 'isProjectileGun', 'currentCharge', 'counter', 'blockedThisFrame'}
RARITY = ['common', 'uncommon', 'rare']


def differs(cls, data):
    out = {}
    for key, value in data.items():
        if key in SKIP or isinstance(value, dict):
            continue
        if isinstance(value, list):
            if value:
                out[key + 'Count'] = len(value)
            continue
        if value == DEFAULTS.get(cls, {}).get(key, 0):
            continue
        out[key] = round(value, 4) if isinstance(value, float) else value
    return out


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('ROUNDS_DIR', '')
    data_dir = os.path.join(root, 'Rounds_Data')
    if not os.path.isdir(data_dir):
        sys.exit('usage: extract-cards.py /path/to/ROUNDS')
    files = [os.path.join(data_dir, 'globalgamemanagers'), os.path.join(data_dir, 'globalgamemanagers.assets'), os.path.join(data_dir, 'resources.assets')] + sorted(glob.glob(os.path.join(data_dir, 'sharedassets*.assets')))
    env = UnityPy.load(*files)
    generator = TypeTreeGenerator('2022.3.34f1')
    generator.load_local_dll_folder(os.path.join(data_dir, 'Managed'))
    by_file = {os.path.basename(k): v for k, v in env.files.items()}
    scripts = {}
    for name, f in by_file.items():
        for pid, o in f.objects.items():
            if o.type.name == 'MonoScript':
                try:
                    scripts[(name, pid)] = o.read().m_ClassName
                except Exception:
                    pass

    cards = {}
    for name, f in by_file.items():
        externals = [os.path.basename(e.path) for e in f.externals]
        for pid, o in f.objects.items():
            if o.type.name != 'MonoBehaviour':
                continue
            raw = o.get_raw_data()
            file_id, script_id = struct.unpack_from('<iq', raw, 16)
            target = name if file_id == 0 else (externals[file_id - 1] if file_id - 1 < len(externals) else None)
            cls = scripts.get((target, script_id))
            if cls not in CLASSES:
                continue
            go = struct.unpack_from('<iq', raw, 0)[1]
            try:
                values = o.read_typetree(nodes=generator.get_nodes_up('Assembly-CSharp.dll', cls), wrap=False)
                go_name = f.objects[go].read().m_Name
            except BaseException:
                continue
            cards.setdefault((name, go), {'go': go_name})[cls] = values

    english = {}
    for bundle in glob.glob(os.path.join(data_dir, 'StreamingAssets', 'aa', 'StandaloneWindows64', 'localization-string-tables-english*')):
        for o in UnityPy.load(bundle).objects:
            if o.type.name == 'MonoBehaviour':
                try:
                    table = o.read_typetree()
                except Exception:
                    continue
                if 'm_TableData' in table and table.get('m_Name', '').startswith('StringTableCards'):
                    for row in table['m_TableData']:
                        english[row['m_Id']] = row['m_Localized']

    out = []
    for entry in cards.values():
        info = entry.get('CardInfo')
        if not info or not (info['cardName'] or info['m_localizedCardName']['m_TableEntryReference']['m_KeyId']):
            continue
        ref = lambda field: info[field]['m_TableEntryReference']['m_KeyId']
        name = english.get(ref('m_localizedCardName')) or info['cardName']
        text = english.get(ref('m_localizedCardDescription')) or info['cardDestription']
        card = {'name': name, 'text': text.replace('\r', ''), 'rarity': RARITY[info['rarity']] if info['rarity'] < 3 else 'common',
                'lines': [{'stat': row['stat'], 'amount': row['amount'], 'positive': bool(row['positive'])} for row in info['cardStats']]}
        for cls, key in (('Gun', 'gun'), ('Block', 'block'), ('CharacterStatModifiers', 'stats')):
            if cls in entry:
                card[key] = differs(cls, entry[cls])
        out.append(card)
    out.sort(key=lambda card: card['name'].lower())
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'world', 'cards.json')
    with open(path, 'w') as f:
        json.dump(out, f, indent=1)
    print(f'{len(out)} cards -> {os.path.normpath(path)}')


main()
