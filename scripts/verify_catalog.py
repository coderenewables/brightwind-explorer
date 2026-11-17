"""Check every callable in public/catalog.json against an installed brightwind.

Usage (in an environment with brightwind installed): python scripts/verify_catalog.py
Exits with status 1 when a signature in the catalog no longer matches the library.
"""
import inspect
import json
import sys
from pathlib import Path

import brightwind as bw

catalog = json.loads((Path(__file__).resolve().parent.parent / 'public' / 'catalog.json').read_text(encoding='utf-8'))
print(f'catalog built for brightwind {catalog["version"]}, installed {bw.__version__}')
HIDDEN = {'LoadBrightHub.get_measurement_stations': ['return_df'],
          'LoadBrightHub.get_reanalysis': ['nearest_nodes', 'return_metadata_json']}
bad = checked = 0
for node in catalog['nodes']:
    if node['kind'] in ('attr', 'method'):
        owner = node['id'].rsplit('.', 1)[0]
        if owner == 'measurements':
            continue
        obj = bw
        try:
            for part in owner.split('.'):
                obj = getattr(obj, part)
        except AttributeError:
            print('missing class:', node['id']); bad += 1; continue
        if node['kind'] == 'attr':
            continue
        fn = getattr(obj, node['call'], None)
    else:
        fn = bw
        try:
            for part in node['call'].split('.')[1:]:
                fn = getattr(fn, part)
        except AttributeError:
            print('missing:', node['id']); bad += 1; continue
    if fn is None:
        print('missing:', node['id']); bad += 1; continue
    checked += 1
    actual = [p for p in inspect.signature(fn).parameters if p not in ('self', 'kwargs', 'sklearn_args')]
    actual = [p for p in actual if p not in HIDDEN.get(node['id'], [])]
    if actual != node['params']:
        print(f"changed: {node['id']}\n  library: {actual}\n  catalog: {node['params']}"); bad += 1
print(f'{checked} callables checked, {bad} problems')
sys.exit(1 if bad else 0)
