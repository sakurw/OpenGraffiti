"""Shared case selection for the real-photo SNAP pipeline (no network access)."""
import json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]

def load_case():
    case_id = sys.argv[1] if len(sys.argv) > 1 else 'park-tower-west'
    if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', case_id):
        raise ValueError('Invalid SNAP case ID')
    path = ROOT / ('scripts/texture-snap-registration.json' if case_id == 'park-tower-west'
                   else f'scripts/texture-snap-cases/{case_id}.json')
    case = json.loads(path.read_text(encoding='utf-8'))
    if case['caseId'] != case_id:
        raise ValueError('SNAP case ID mismatch')
    geometry = (ROOT / case['geometryPath']).resolve()
    if not geometry.is_relative_to((ROOT / 'data/plateau').resolve()) or not geometry.is_file():
        raise ValueError('Geometry must be an existing local PLATEAU source')
    if case['areaId'] not in ('tocho', 'tokyo-tower'):
        raise ValueError('Unknown SNAP area')
    if not re.fullmatch(r'\d+', case['sourceId']):
        raise ValueError('Invalid Commons source ID')
    return case, geometry
