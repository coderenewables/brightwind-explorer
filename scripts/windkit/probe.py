"""Check a windkit curation spec file: schema against the real signatures, then call each function.

Usage: MPLBACKEND=Agg python -W ignore probe.py spec.json [--only path,...] [--quiet]
"""
import copy
import json
import os
import signal
import sys
import tempfile
import traceback
import warnings

warnings.simplefilter('ignore')
import numpy as np
import pandas as pd
import xarray as xr
import windkit as wk
import plotly.subplots  # windkit.plot.single_curve uses it without importing it; exports do the same
import samples

HERE = os.path.dirname(os.path.abspath(__file__))
PARENT = {
    'Axes': 'Figure',
    'TSWC': 'Dataset', 'SurfaceFields': 'TSWC', 'BWC': 'Dataset', 'WWC': 'Dataset', 'PWC': 'WWC', 'GWC': 'Dataset', 'GeoWC': 'Dataset',
    'GEWC': 'Dataset', 'PEWC': 'Dataset', 'MetFields': 'Dataset', 'SiteEffects': 'Dataset', 'V50LUT': 'Dataset', 'WTG': 'Dataset',
    'WindTurbines': 'Dataset', 'Locations': 'Dataset', 'Point': 'Locations', 'StackedPoint': 'Locations', 'Cuboid': 'Locations',
    'Raster': 'Locations', 'RasterMap': 'DataArray', 'VectorMap': 'GeoDataFrame', 'LandCoverTable': 'Dict', 'LossTable': 'DataFrame',
    'UncertaintyTable': 'DataFrame',
}
VOCAB = set(PARENT) | {'Dataset', 'DataArray', 'GeoDataFrame', 'BBox', 'DataFrame', 'Series', 'Value', 'List', 'Dict', 'Path', 'Figure', 'Axes', 'Plotly', 'Dict', 'Workspace'} | {f'wk.ltc.{c}{f}' for c in ('LinRegMCP', 'VarRatMCP') for f in ('', ' (fitted)')}
GROUPS = {'Wind climates', 'Wind', 'Weibull', 'Long-term', 'WAsP workspace', 'Spatial', 'Topography', 'Wind farm', 'Read & write', 'Checks', 'Plots', 'Data download'}
RAW = {e['path']: e for e in json.load(open(os.environ.get('WINDKIT_RAW', os.path.join(HERE, 'raw_windkit.json'))))['entries']}


def ancestors(t):
    out = [t]
    while t in PARENT:
        t = PARENT[t]
        out.append(t)
    return out


def matches(actual, declared):
    return any(a in declared for a in ancestors(actual))


def resolve(path):
    obj = wk
    for part in path.split('.')[1:]:
        obj = getattr(obj, part)
    return obj


def schema_errors(e):
    errs = []
    raw = RAW.get(e.get('path'))
    if not raw:
        return [f"unknown path {e.get('path')!r}"]
    params = {p['name'] for p in raw['params']}
    if e.get('group') not in GROUPS:
        errs.append(f"group {e.get('group')!r} is not one of the allowed groups")
    for k, types in (e.get('inputs') or {}).items():
        if k not in params:
            errs.append(f"input {k!r} is not a parameter (parameters: {sorted(params)})")
        bad = [t for t in types if t not in VOCAB]
        if bad:
            errs.append(f"input {k!r} has unknown types {bad}")
    names = []
    for o in e.get('outputs') or []:
        names.append(o.get('name'))
        bad = [t for t in o.get('types', []) if t not in VOCAB or t == 'Locations']
        if bad or not o.get('types'):
            errs.append(f"output {o.get('name')!r} has unknown or missing types {bad}")
        if o.get('flag') and o['flag'] not in params:
            errs.append(f"output {o.get('name')!r} flag {o['flag']!r} is not a parameter")
        if o.get('same') and o['same'] not in (e.get('inputs') or {}):
            errs.append(f"output {o.get('name')!r} same={o['same']!r} is not an input")
    if any(o.get('flag') for o in e.get('outputs') or []) and sorted(e.get('order') or []) != sorted(names):
        errs.append('outputs with a flag need "order" listing every output name')
    for k, f in (e.get('fields') or {}).items():
        if k not in params:
            errs.append(f"field {k!r} is not a parameter")
        if k in (e.get('inputs') or {}):
            errs.append(f"{k!r} is both an input and a field")
        if f.get('mode') not in ('bool', 'text', 'expr', 'choice'):
            errs.append(f"field {k!r} has bad mode {f.get('mode')!r}")
        if f.get('mode') == 'choice' and not f.get('choices'):
            errs.append(f"field {k!r} choice mode needs choices")
    if e.get('browser') not in ('ok', 'blocked', 'plotly'):
        errs.append('browser must be ok, blocked or plotly')
    if not e.get('probe') and not e.get('skip_probe'):
        errs.append('needs probe or skip_probe')
    return errs


class Timeout(Exception):
    pass


def _alarm(*_):
    raise Timeout()


def fresh(obj):
    if hasattr(obj, 'copy'):
        try:
            return obj.copy(deep=True)
        except TypeError:
            return obj.copy()
    return copy.deepcopy(obj)


def run_probe(e, call, S, TMP):
    fn = resolve(e['path'])
    env = {'np': np, 'pd': pd, 'xr': xr, 'wk': wk, 'S': S, 'TMP': TMP}
    if e.get('setup'):   # stand-ins for the network: the spec patches what the function downloads
        try:
            exec(e['setup'], env)
        except Exception as ex:
            return f'setup failed: {type(ex).__name__}: {ex}'
    kwargs = {}
    for k, v in call.get('args', {}).items():
        if isinstance(v, str) and v.startswith('@'):
            key = v[1:]
            if key not in S:
                return f'unknown sample {v!r} (samples: {sorted(S)})'
            kwargs[k] = fresh(S[key])
        else:
            try:
                kwargs[k] = eval(v, env) if isinstance(v, str) else v
            except Exception as ex:
                return f'could not evaluate arg {k}={v!r}: {ex}'
    # Call the way the exported code does: leading required parameters positionally, the rest by keyword.
    args = [kwargs.pop('__self__')] if '__self__' in kwargs else []   # methods: the object first
    for p in RAW[e['path']]['params']:
        if p['required'] and not p['kwonly'] and p['name'] in kwargs:
            args.append(kwargs.pop(p['name']))
        else:
            break
    signal.signal(signal.SIGALRM, _alarm)
    signal.alarm(90)
    try:
        res = fn(*args, **kwargs)
        for p, a in zip(RAW[e['path']]['params'], args[1:] if e.get('self') else args):
            kwargs[p['name']] = a
    except Timeout:
        return 'call took longer than 90 s'
    except Exception as ex:
        tb = traceback.extract_tb(ex.__traceback__)[-1]
        return f'call raised {type(ex).__name__}: {str(ex)[:300]} (at {os.path.basename(tb.filename)}:{tb.lineno})'
    finally:
        signal.alarm(0)
    outs = e.get('outputs') or []
    flagged = [o for o in outs if o.get('flag')]
    flag_on = any(bool(kwargs.get(o['flag'])) for o in flagged)
    if not outs:
        return None if res is None or isinstance(res, (bool, np.bool_)) else f'declared no outputs but returned {samples.classify(res)}'
    if e.get('attrs'):   # an object whose attributes are the outputs, e.g. load_tutorial_data's SimpleNamespace
        for o in outs:
            if not hasattr(res, o['name']):
                return f'result has no attribute {o["name"]!r}'
            t = samples.classify(getattr(res, o['name']))
            if not matches(t, o['types']):
                return f'output {o["name"]!r} is {t}, declared {o["types"]}'
        return None
    if e.get('tuple') or (flagged and flag_on):
        order = e.get('order') or [o['name'] for o in outs]
        expect = [next(o for o in outs if o['name'] == n) for n in order]
        if not isinstance(res, tuple) or len(res) != len(expect):
            return f'expected a tuple of {len(expect)} ({order}), got {samples.classify(res)}'
        for o, r in zip(expect, res):
            t = samples.classify(r)
            if not matches(t, o['types']):
                return f'output {o["name"]!r} is {t}, declared {o["types"]}'
        return None
    main = [o for o in outs if not o.get('flag')]
    if len(main) != 1:
        return 'expected exactly one output without a flag'
    t = samples.classify(res)
    if isinstance(t, list):
        return f'returned a tuple {t}; declare all elements with "tuple": true'
    if not matches(t, main[0]['types']):
        return f'output {main[0]["name"]!r} is {t}, declared {main[0]["types"]}'
    return None


def main():
    spec = json.load(open(sys.argv[1]))
    only = None
    if '--only' in sys.argv:
        only = set(sys.argv[sys.argv.index('--only') + 1].split(','))
    TMP = tempfile.mkdtemp()
    S = samples.build(TMP)
    counts = {'PASS': 0, 'FAIL': 0, 'SKIP': 0}
    for e in spec:
        if only and e.get('path') not in only:
            continue
        errs = schema_errors(e)
        if not errs and e.get('skip_probe') and not e.get('probe'):
            counts['SKIP'] += 1
            print(f"SKIP {e['path']}: {e['skip_probe']}")
            continue
        if not errs:
            for i, call in enumerate(e.get('probe') or []):
                err = run_probe(e, call, S, TMP)
                if err:
                    errs.append(f'probe {i + 1}: {err}')
        if errs:
            counts['FAIL'] += 1
            print(f"FAIL {e.get('path')}")
            for x in errs:
                print('     - ' + x)
        else:
            counts['PASS'] += 1
            if '--quiet' not in sys.argv:
                print(f"PASS {e['path']}")
    print(f"\n{len(spec)} entries: {counts['PASS']} PASS, {counts['FAIL']} FAIL, {counts['SKIP']} SKIP")
    sys.exit(1 if counts['FAIL'] else 0)


main()
