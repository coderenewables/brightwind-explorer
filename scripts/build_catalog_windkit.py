"""Turn the windkit API dump and the curated specs into the typed node catalog the page loads.

Usage: python build_catalog_windkit.py raw_windkit.json SPEC_DIR ../public/catalog-windkit.json [-v]

raw_windkit.json comes from extract_api_windkit.py. SPEC_DIR holds spec_*.json files: one object per
function with its port types, outputs and group, each checked by calling the function on sample data
(see scripts/windkit/probe.py). Settings that are not ports become fields automatically.
"""
import glob, json, os, re, sys

raw_path, spec_dir, out_path = sys.argv[1:4]
VERBOSE = '-v' in sys.argv
RAW = json.load(open(raw_path))
VERSION = RAW['version']
R = {e['path']: e for e in RAW['entries']}
SAMPLES = os.path.join(os.path.dirname(os.path.abspath(out_path)), 'py', 'samples', 'index.json')   # written by windkit/make_samples.py

# Port types. A type is accepted wherever its parent is accepted.
# cat picks the colour on the board; help is shown in the type key and on hover.
TYPES = {
    'Dataset':        dict(parent=None, cat='xr', help='Any xarray Dataset.'),
    'DataArray':      dict(parent=None, cat='xr', help='Any xarray DataArray, for example one variable such as tswc["wind_speed"].'),
    'TSWC':           dict(parent='Dataset', cat='wc', help='Time series wind climate: wind speed and direction over time.'),
    'SurfaceFields':  dict(parent='TSWC', cat='wc', help='Time series wind climate with surface fields (UST, HFX, T2, PSFC).'),
    'BWC':            dict(parent='Dataset', cat='wc', help='Binned wind climate: wind speed and direction histogram by sector.'),
    'WWC':            dict(parent='Dataset', cat='wc', help='Weibull wind climate: A, k and frequency by sector.'),
    'PWC':            dict(parent='WWC', cat='wc', help='Predicted wind climate: a Weibull wind climate with the combined A, k and power density.'),
    'GWC':            dict(parent='Dataset', cat='wc', help='Generalised wind climate, by generalisation height and roughness.'),
    'GeoWC':          dict(parent='Dataset', cat='wc', help='Geostrophic wind climate.'),
    'GEWC':           dict(parent='Dataset', cat='wc', help='Generalised extreme wind climate: annual maxima by sector.'),
    'PEWC':           dict(parent='Dataset', cat='wc', help='Predicted extreme wind climate.'),
    'MetFields':      dict(parent='Dataset', cat='wc', help='Meteorological fields such as wind speed and power density.'),
    'SiteEffects':    dict(parent='Dataset', cat='wc', help='WAsP site effects: speed-ups, turnings, elevation and RIX.'),
    'V50LUT':         dict(parent='Dataset', cat='wc', help='LINCOM V50 lookup table.'),
    'WTG':            dict(parent='Dataset', cat='wtg', help='Wind turbine generator: power and thrust curves.'),
    'WindTurbines':   dict(parent='Dataset', cat='wtg', help='Turbine layout: positions, hub heights and turbine keys.'),
    'Locations':      dict(parent='Dataset', cat='loc', help='Where to calculate: a point, stacked point, raster or cuboid structure.'),
    'Point':          dict(parent='Locations', cat='loc', help='Locations as a list of points.'),
    'StackedPoint':   dict(parent='Locations', cat='loc', help='Locations as stacked points.'),
    'Cuboid':         dict(parent='Locations', cat='loc', help='Locations on a 3-D grid (several heights).'),
    'Raster':         dict(parent='Locations', cat='loc', help='Locations on a 2-D grid (one height).'),
    'BBox':           dict(parent=None, cat='loc', help='A windkit bounding box with its CRS.'),
    'RasterMap':      dict(parent='DataArray', cat='map', help='Raster map: elevation, roughness length or land cover.'),
    'GeoDataFrame':   dict(parent=None, cat='xr', help='Any geopandas GeoDataFrame.'),
    'VectorMap':      dict(parent='GeoDataFrame', cat='map', help='Vector map: elevation contours or roughness / land-cover change lines.'),
    'LandCoverTable': dict(parent='Dict', cat='map', help='Land-cover table: id to roughness, displacement and description.'),
    'LossTable':      dict(parent='DataFrame', cat='df', help='Wind farm loss table.'),
    'UncertaintyTable': dict(parent='DataFrame', cat='df', help='Uncertainty table.'),
    'Workspace':      dict(parent=None, cat='xr', help='A WAsP workspace read from a .wwh file.'),
    'Axes':           dict(parent='Figure', cat='fig', help='A matplotlib plot (axes). Leave it unconnected to show it, or wire it to Save figure.'),
    'Plotly':         dict(parent=None, cat='plotly', help='An interactive plotly figure. Leave it unconnected to show it, or wire it to Save interactive figure.'),
}
for c in ('LinRegMCP', 'VarRatMCP'):
    TYPES[f'wk.ltc.{c}'] = dict(parent=None, cat='obj', label=c, help='A long-term correction model. Fit it before predicting.')
    TYPES[f'wk.ltc.{c} (fitted)'] = dict(parent=None, cat='obj', label=c + ' (fitted)', help='A fitted long-term correction model.')
SHARED = {'DataFrame', 'Series', 'Value', 'List', 'Dict', 'Path', 'Figure'}   # brightwind's own types

GROUP_ORDER = ['Sources', 'Wind climates', 'Wind', 'Weibull', 'Long-term', 'Spatial', 'Topography', 'Wind farm',
               'Read & write', 'WAsP workspace', 'Checks', 'Plots', 'Data download']
NETWORK = {'wk.get_vector_map', 'wk.get_tutorial_data', 'wk.load_tutorial_data'}
BLOCKED_NOTE = 'Needs internet access to an outside service; the browser runner skips it. Run the exported script instead.'


def clean(s):
    return ' '.join((s or '').split())


def pdoc(entry):
    """Parameter docs keyed by bare name. numpydoc keys can be 'name', 'name : type' or 'a, b'."""
    out = {}
    for key, v in (entry['doc'].get('params') or {}).items():
        for nm in re.split(r'\s*,\s*', key.split(':')[0].strip()):
            out[nm] = dict(desc=clean(v.get('desc')), type=clean(v.get('type') or (key.split(':', 1)[1] if ':' in key else '')))
    return out


def field_mode(p, typetext):
    d = p['default']
    if d in ('True', 'False') or re.match(r'^bool\b', typetext, re.I):
        return 'bool'
    if re.match(r"^'[^']*'$", d or '') or (d in (None, 'None') and re.match(r'^(str|string)\b(?!.*\b(list|array|int|float|dict|sequence|tuple)\b)', typetext, re.I)):
        return 'text'
    return 'expr'


def summary_of(e):
    s = clean(e['doc'].get('summary'))
    m = re.match(r'(.{12,240}?[.!?])(\s|$)', s)
    return m.group(1) if m else s[:240]


def doc_text(e):
    d = e['doc']
    parts = [clean(d.get('summary')), clean(d.get('extended'))]
    return '\n\n'.join(p for p in parts if p)


def var_for(spec, outs):
    if spec.get('var'):
        return spec['var']
    if outs:
        return re.sub(r'\W', '_', outs[0]['name'])
    return spec['path'].split('.')[-1]


def make(spec):
    path = spec['path']
    e = R[path]
    kind = {'function': 'function', 'classmethod': 'function', 'method': 'method', 'property': 'attr', 'class': 'constructor'}[e['kind']]
    if spec.get('self') and kind == 'function':
        raise SystemExit(f'{path}: self given but windkit has it as a {e["kind"]}')
    docs = pdoc(e)
    hide = set(spec.get('hide', []))
    flags = {o['flag'] for o in spec['outputs'] if o.get('flag')}
    inputs, fields = [], []
    if spec.get('self'):
        inputs.append(dict(name=spec.get('self_name', 'obj' if spec['self'][0] in TYPES and TYPES[spec['self'][0]]['cat'] != 'obj' else 'model'),
                           types=spec['self'], required=True, self=True, doc='The object this is called on.', typeText=''))
    params = []
    for p in e['params']:
        nm = p['name']
        if nm in hide:
            if p['required']:
                raise SystemExit(f'{path}: cannot hide required parameter {nm}')
            continue
        params.append(nm)
        info = docs.get(nm, {})
        tt = info.get('type') or (p['ann'] or '')
        base = dict(name=nm, required=p['required'], default=p['default'], doc=info.get('desc', ''), typeText=tt[:160])
        if p['kwonly']:
            base['kwonly'] = True
        if nm in spec['inputs']:
            base['types'] = spec['inputs'][nm]
            inputs.append(base)
            continue
        ov = (spec.get('fields') or {}).get(nm, {})
        base['mode'] = 'bool' if nm in flags else ov.get('mode') or field_mode(p, tt)
        if nm in flags:
            base['flag'] = True
        if ov.get('choices'):
            base['choices'] = ov['choices']
            base['quoted'] = True   # string choices: the page quotes the picked value
        fields.append(base)
    unknown = set(spec['inputs']) - {p['name'] for p in e['params']}
    if unknown:
        raise SystemExit(f'{path}: inputs {unknown} are not parameters')
    outs = [{k: v for k, v in o.items() if k in ('name', 'types', 'flag', 'same')} for o in spec['outputs']]
    title = path[3:]
    if kind in ('method', 'attr'):
        title = path[3:]
    n = dict(id=path, call=path if kind in ('function', 'constructor') else path.rsplit('.', 1)[1], kind=kind, lib='wk',
             group=spec['group'], var=var_for(spec, outs), title=title,
             summary=spec.get('summary') or summary_of(e), doc=doc_text(e), module=e['module'], line=e['line'],
             inputs=inputs, fields=fields, outputs=outs,
             ret=clean('; '.join(r.get('desc') or '' for r in e['doc'].get('returns', [])))[:300],
             rtype=clean('; '.join(r.get('type') or '' for r in e['doc'].get('returns', [])))[:200],
             kwargs=e.get('kwarg'), params=params)
    if e.get('vararg'):
        n['vararg'] = e['vararg']
    if spec.get('tuple'):
        n['tuple'] = dict(flags=[], order=[o['name'] for o in outs], always=True)
    elif flags:
        n['tuple'] = dict(flags=sorted(flags), order=spec.get('order') or [o['name'] for o in outs])
    if spec.get('note'):
        n['note'] = spec['note']
    if spec.get('mutates'):
        n['mutates'] = True
    if spec.get('attrs'):
        n['attrs'] = True   # the outputs are attributes of the returned object: tutorial.bwc, tutorial.wtg, ...
    if spec.get('setup') or spec['path'] in NETWORK:
        n['net'] = True     # downloads at run time; in the browser through the relay or a CORS-enabled URL
    b = spec.get('browser', 'ok')
    if b == 'blocked':
        n['blocked'] = True
        n['note'] = n.get('note') or BLOCKED_NOTE
    if b == 'plotly' or any('Plotly' in o['types'] for o in outs):
        n['plotly'] = True
    if re.search(r'deprecat', (e['doc'].get('summary') or '') + ' ' + (e['doc'].get('extended') or '') + ' ' + (spec.get('note') or ''), re.I):
        n['status'] = 'deprecated'
    return n


def main():
    specs = [x for f in sorted(glob.glob(os.path.join(spec_dir, 'spec_*.json'))) for x in json.load(open(f))]
    nodes, seen, excluded = [], set(), []
    for s in specs:
        if s['path'] in seen:
            raise SystemExit('duplicate spec ' + s['path'])
        seen.add(s['path'])
        if s.get('exclude'):
            excluded.append((s['path'], s['exclude']))
            continue
        nodes.append(make(s))
    # every type used must be known
    known = set(TYPES) | SHARED
    for n in nodes:
        for p in n['inputs'] + n['outputs']:
            bad = set(p['types']) - known
            if bad:
                raise SystemExit(f"{n['id']}: unknown types {bad}")
        if n['group'] not in GROUP_ORDER:
            raise SystemExit(f"{n['id']}: unknown group {n['group']}")
    nodes.sort(key=lambda n: (GROUP_ORDER.index(n['group']), n['id'].lower()))
    for t, v in TYPES.items():
        v.setdefault('label', t)
    cat = dict(lib='wk', name='windkit', version=VERSION, docs='https://docs.wasp.dk/windkit', pypi='https://pypi.org/project/windkit/',
               license='BSD-3-Clause, DTU Wind Energy', groups=GROUP_ORDER, types=TYPES, samples=json.load(open(SAMPLES)), excluded=[dict(id=a, why=b) for a, b in excluded], nodes=nodes)
    json.dump(cat, open(out_path, 'w'), indent=None, separators=(',', ':'))
    print(f'{len(nodes)} windkit nodes ({len(excluded)} left out) -> {out_path}, {os.path.getsize(out_path) // 1024} kB')
    if VERBOSE:
        for n in nodes:
            print(f"[{n['group']}] {n['id']} ({n['kind']}) " + ', '.join(f"{i['name']}:{'/'.join(i['types'])}" for i in n['inputs'])
                  + ' -> ' + ', '.join(f"{o['name']}:{'/'.join(o['types'])}{'~' + o['same'] if 'same' in o else ''}" for o in n['outputs'])
                  + (' tuple' if n.get('tuple') else '') + (' BLOCKED' if n.get('blocked') else ''))
            if n['fields']:
                print('   fields: ' + ', '.join(f"{f['name']}{'*' if f['required'] else ''}:{f['mode']}={f['default']}" for f in n['fields']))


main()
