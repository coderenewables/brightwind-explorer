"""Turn the raw API dump from extract_api.py into the typed node catalog the page loads.

Usage: python build_catalog.py raw.json ../public/catalog.json VERSION COMMIT [-v]

Port types, tuple returns and groups are curated below. When brightwind adds or renames a public
function, add it here; scripts/verify_catalog.py reports signatures that no longer match.
"""
import json, re, sys, textwrap
raw = json.load(open(sys.argv[1]))
VERSION, COMMIT = sys.argv[3], sys.argv[4]
DF, S, FIG, PATH, VAL, LIST, DICT, OBJ, STN, MEAS = 'DataFrame', 'Series', 'Figure', 'Path', 'Value', 'List', 'Dict', 'Object', 'Station', 'Measurements'
DATA = [DF, S]

def parse_doc(doc):
    doc = textwrap.dedent(doc or '').strip()
    params, types, ret, rtype = {}, {}, '', ''
    parts = re.split(r'\n\s*(?=:(?:param|type|return|returns|rtype)\b)', '\n' + doc)
    cut = lambda s: re.split(r'\n\s*\*\*Example|\n\s*\n', s)[0]
    for p in parts[1:]:
        p = p.strip()
        m = re.match(r':param\s+(\w+)\s*:(.*)', p, re.S)
        if m: params[m.group(1)] = ' '.join(re.split(r'\n\s*\*\*Example', m.group(2))[0].split()); continue
        m = re.match(r':type\s+(\w+)\s*:(.*)', p, re.S)
        if m: types[m.group(1)] = ' '.join(cut(m.group(2)).split()); continue
        m = re.match(r':returns?\s*:(.*)', p, re.S)
        if m: ret = ' '.join(cut(m.group(1)).split()); continue
        m = re.match(r':rtype\s*:(.*)', p, re.S)
        if m: rtype = ' '.join(cut(m.group(1)).split()); continue
    return params, types, ret, rtype

def summary(doc):
    doc = textwrap.dedent(doc or '').strip()
    para = re.split(r'\n\s*\n|\n\s*:(?:param|type|return)', doc)[0]
    para = ' '.join(para.split())
    m = re.match(r'(.{20,220}?[.!?])(\s|$)', para)
    s = m.group(1) if m else para[:220]
    return s

def auto_types(t):
    out = []
    if re.search(r'data\s*frame', t, re.I): out.append(DF)
    if re.search(r'series', t, re.I): out.append(S)
    if 'MeasurementStation' in t: out.append(STN)
    if '_Measurements' in t: out.append(MEAS)
    if out and re.search(r'\b(float|int)\b', t): out.append(VAL)
    return out

def field_mode(p):
    t = (p['type'] or '').strip()
    d = p['default']
    if d in ('True', 'False') or re.match(r'^bool\b', t, re.I): return 'bool'
    if re.match(r'^(str|string)(\s*,\s*default.*|\s*(,|or)\s*None)?\.?$', t, re.I) and (d is None or d == 'None' or re.match(r"^'[^']*'$", d or '')):
        return 'text'
    return 'expr'

NODES = []
def find_fn(mod, name):
    return next(f for f in raw[mod]['functions'] if f['name'] == name)
def find_cls(mod, path):
    names = path.split('.')
    c = next(c for c in raw[mod]['classes'] if c['name'] == names[0])
    for n in names[1:]:
        c = next(k for k in c['classes'] if k['name'] == n)
    return c

def make(id_, call, f, mod, group, var, outs, ports=None, fields_only=(), tuple_=None, kind='function',
         self_=None, extra_doc=None, status=None, note=None, mutates=False, hide=()):
    ports = ports or {}
    pdoc, ptype = {}, {}
    if extra_doc:
        a, b, _, _ = parse_doc(extra_doc); pdoc.update(a); ptype.update(b)
    inputs, fields = [], []
    if self_:
        inputs.append(dict(name=self_[0], types=self_[1], required=True, self=True, doc='The object this is called on.', typeText=''))
    flags = set(tuple_['flags']) if tuple_ else set()
    for p in f['params']:
        if p['name'] in hide: continue
        doc = p['doc'] or pdoc.get(p['name'], '')
        tt = p['type'] or ptype.get(p['name'], '') or (p['ann'] or '')
        pp = dict(p, type=tt)
        base = dict(name=p['name'], required=p['required'], default=p['default'], doc=doc, typeText=tt)
        if p['name'] in ports: types = ports[p['name']]
        elif p['name'] in fields_only: types = None
        else: types = auto_types(tt) or None
        if types:
            base['types'] = types; inputs.append(base)
        else:
            base['mode'] = 'bool' if p['name'] in flags else field_mode(pp)
            if p['name'] in flags: base['flag'] = True
            fields.append(base)
    doc = textwrap.dedent(f['doc'] or '').strip()
    if extra_doc and len(extra_doc) > len(doc): doc = textwrap.dedent(extra_doc).strip()
    n = dict(id=id_, call=call, kind=kind, group=group, var=var, title=id_, summary=summary(doc), doc=doc,
             module=mod, line=f['line'], inputs=inputs, fields=fields,
             outputs=[dict(name=o[0], **(o[1] if isinstance(o[1], dict) else dict(types=o[1])), **(dict(flag=o[2]) if len(o) > 2 else {})) for o in outs],
             ret=f['ret'], rtype=f['rtype'][:300], kwargs=f['kwarg'], params=[p['name'] for p in f['params'] if p['name'] not in hide])
    if tuple_: n['tuple'] = tuple_
    if status: n['status'] = status
    if note: n['note'] = note
    if mutates: n['mutates'] = True
    NODES.append(n)
    return n

def F(mod, name, group, var, outs, **kw):
    return make(name, 'bw.' + name, find_fn(mod, name), mod, group, var, outs, **kw)

same = lambda p, fallback=DATA: dict(same=p, types=fallback)
RD = dict(flags=['return_data'], order=['plot', 'data'])
def plot_data(dtype=[DF]): return [('plot', [FIG]), ('data', dtype, 'return_data')]

A, TR, SC, LD, PL, EX, GIS = 'analyse/analyse.py', 'transform/transform.py', 'transform/scale.py', 'load/load.py', 'analyse/plot.py', 'export/export.py', 'utils/gis.py'

# ---- Load
for n in ['load_csv', 'load_excel', 'load_campbell_scientific']:
    F(LD, n, 'Load', 'data', [('data', [DF])], ports={'filepath_or_folder': [PATH]})
F(LD, 'load_windographer_txt', 'Load', 'data', [('data', [DF])], ports={'filepath': [PATH]})
# ---- Clean
F(LD, 'load_cleaning_file', 'Clean', 'cleaning_log', [('cleaning_log', [DF])], ports={'filepath': [PATH]})
F(LD, 'apply_cleaning', 'Clean', 'data_clean', [('data', [DF])], ports={'data': [DF], 'cleaning_file_or_df': [PATH, DF]})
F(LD, 'apply_cleaning_rules', 'Clean', 'data_clean', [('data', [DF])], ports={'data': [DF], 'cleaning_rules_file_or_list': [PATH, LIST]})
F(LD, 'apply_cleaning_windographer', 'Clean', 'data_clean', [('data', [DF])], ports={'data': [DF], 'windog_cleaning_file': [PATH]})
# ---- Transform
F(TR, 'average_data_by_period', 'Transform', 'data_avg', [('data', [DF]), ('coverage', [DF], 'return_coverage')],
  tuple_=dict(flags=['return_coverage'], order=['data', 'coverage']))
F(TR, 'merge_datasets_by_period', 'Transform', 'data_merged', [('data', [DF])])
F(TR, 'average_wdirs', 'Transform', 'wdir_avg', [('wdir', [S, VAL])], ports={'wdirs': [DF, S, LIST], 'wspds': [DF, S, LIST]})
F(TR, 'adjust_slope_offset', 'Transform', 'wspd_adj', [('wspd', same('wspd'))])
F(TR, 'apply_wspd_slope_offset_adj', 'Transform', 'data_adj', [('data', same('data'))], ports={'data': DATA, 'measurements': [MEAS, LIST, DICT]})
F(TR, 'scale_wind_speed', 'Transform', 'wspd_scaled', [('wspd', same('spd'))])
F(TR, 'offset_wind_direction', 'Transform', 'wdir_offset', [('wdir', same('wdir'))], ports={'wdir': [DF, S, VAL]})
F(TR, 'apply_wind_vane_deadband_offset', 'Transform', 'data_adj', [('data', same('data')), ('results', [DF], 'return_results_table')],
  ports={'data': DATA, 'measurements': [MEAS, LIST, DICT]}, fields_only=('return_results_table',), tuple_=dict(flags=['return_results_table'], order=['data', 'results']))
F(TR, 'selective_avg', 'Transform', 'wspd_sel_avg', [('wspd', [S])])
F(TR, 'offset_timestamps', 'Transform', 'data_shifted', [('data', same('data'))], ports={'data': DATA})
F(TR, 'apply_device_orientation_offset', 'Transform', 'data_adj', [('data', same('data')), ('results', [DF], 'return_results_table')],
  ports={'data': DATA, 'measurement_station': [STN]}, tuple_=dict(flags=['return_results_table'], order=['data', 'results']))
F(SC, 'apply_scale_factor', 'Transform', 'data_scaled', [('data', same('data', [DF, S, VAL]))])
F(SC, 'linear_transform', 'Transform', 'y_target', [('y_target', same('x_target', [S, VAL]))])
# ---- Statistics
F(A, 'basic_stats', 'Statistics', 'stats', [('stats', [DF])])
F(A, 'coverage', 'Statistics', 'coverage', [('coverage', [DF])])
F(A, 'time_continuity_gaps', 'Statistics', 'gaps', [('gaps', [DF])])
F(A, 'monthly_means', 'Statistics', 'monthly_means', plot_data(),
  tuple_=dict(flags=['return_data', 'return_coverage'], order=['plot', 'data']))
F(A, 'momm', 'Statistics', 'momm', [('momm', [DF, VAL])], note='Returns a single value for a Series input and a table for a DataFrame input.')
# ---- Distributions
F(A, 'dist', 'Distributions', 'dist', plot_data([DF, S]), tuple_=RD)
F(A, 'dist_of_wind_speed', 'Distributions', 'wspd_dist', plot_data([DF, S]), tuple_=RD)
F(A, 'freq_distribution', 'Distributions', 'freq_dist', plot_data([DF, S]), ports={'wspd': [S]}, tuple_=RD)
F(A, 'dist_by_dir_sector', 'Distributions', 'dist_by_sector', plot_data([DF, S]), tuple_=RD)
F(A, 'dist_matrix', 'Distributions', 'dist_matrix', plot_data(), tuple_=RD)
F(A, 'dist_matrix_by_dir_sector', 'Distributions', 'dist_matrix_sector', plot_data(), tuple_=RD)
F(A, 'dist_12x24', 'Distributions', 'dist_12x24', plot_data(), tuple_=RD)
F(A, 'freq_table', 'Distributions', 'freq_table', plot_data(), tuple_=RD)
F(A, 'sector_ratio', 'Distributions', 'sector_ratio', plot_data(), ports={'wspd_1': [S, DF], 'wspd_2': [S, DF], 'wdir': [S, DF]}, tuple_=RD)
# ---- Turbulence
ti = find_cls(A, 'TI')
def TI(name, var, outs, **kw):
    f = next(m for m in ti['methods'] if m['name'] == name)
    return make('TI.' + name, 'bw.TI.' + name, f, A, 'Turbulence', var, outs, **kw)
TI('calc', 'ti', [('ti', [S])], ports={'wspd': [S], 'wspd_std': [S]})
TI('by_speed', 'ti_by_speed', plot_data(), ports={'IEC_class': [DF]}, tuple_=RD)
TI('by_sector', 'ti_by_sector', plot_data(), tuple_=RD)
TI('twelve_by_24', 'ti_12x24', plot_data(), ports={'wspd': [S], 'wspd_std': [S]}, tuple_=dict(flags=['return_data'], order=['data', 'plot']),
   note='With return_data=True this function returns (table, plot), the reverse of the other analyse functions. The exported code unpacks it in that order.')
# ---- Atmosphere
F(A, 'calc_air_density', 'Atmosphere', 'air_density', [('air_density', same('temperature', [S, VAL]))])
F(A, 'calc_rel_humidity_from_dew_point', 'Atmosphere', 'rel_humidity', [('rel_humidity', same('air_temperature_degC', [S, VAL]))])
F(SC, 'scale_air_density_to_height', 'Atmosphere', 'air_density_scaled', [('air_density', same('ref_air_density_kg_m3', [S, VAL]))])
F(SC, 'scale_air_temperature_to_height', 'Atmosphere', 'air_temp_scaled', [('air_temperature', same('ref_air_temperature', [S, VAL]))])
F(SC, 'scale_air_pressure_to_height', 'Atmosphere', 'air_pressure_scaled', [('air_pressure', same('ref_air_pressure_hPa', [S, VAL]))],
  fields_only=('ref_height_m', 'target_height_m', 'ref_air_temp_height_m'))
# ---- Shear
SH = 'analyse/shear.py'
sh = find_cls(SH, 'Shear')
alpha_t = {'TimeSeries': [S], 'TimeOfDay': [DF], 'Average': [VAL], 'BySector': [S]}
for cn in ['TimeSeries', 'TimeOfDay', 'Average', 'BySector']:
    c = find_cls(SH, 'Shear.' + cn)
    T = 'Shear.' + cn
    init = next(m for m in c['methods'] if m['name'] == '__init__')
    make(T, 'bw.' + T, init, SH, 'Shear', 'shear_' + re.sub(r'(?<!^)(?=[A-Z])', '_', cn).lower(), [('shear', [T])], kind='constructor',
         ports=dict({'wspds': [DF, LIST]}, **({'wdir': [S, DF]} if cn == 'BySector' else {})), extra_doc=c['doc'])
    ap = next(m for m in c['methods'] if m['name'] == 'apply')
    make(T + '.apply', 'apply', ap, SH, 'Shear', 'wspd_sheared', [('wspd', [S])], kind='method', self_=('shear', [T]),
         ports=dict({'wspds': [S]}, **({'wdir': [S]} if cn == 'BySector' else {})))
    for attr, doc in [('alpha', 'The calculated shear exponent (alpha). Only set when calc_method is power_law.'),
                      ('roughness', 'The calculated roughness coefficient. Only set when calc_method is log_law.'),
                      ('plot', 'The plot produced when the shear object was created.'),
                      ('info', 'Input and output information for this shear calculation.')]:
        t = alpha_t[cn] if attr in ('alpha', 'roughness') else [FIG] if attr == 'plot' else [OBJ]
        if attr == 'plot' and cn == 'BySector': pass
        NODES.append(dict(id=T + '.' + attr, call=attr, kind='attr', group='Shear', var=attr if attr != 'plot' else 'shear_plot', title=T + '.' + attr,
                          summary=doc, doc=doc, module=SH, line=c['line'],
                          inputs=[dict(name='shear', types=[T], required=True, self=True, doc='The shear object.', typeText='')],
                          fields=[], outputs=[dict(name=attr, types=t)], ret='', rtype='', kwargs=None))
make('Shear.scale', 'bw.Shear.scale', next(m for m in sh['methods'] if m['name'] == 'scale'), SH, 'Shear', 'wspd_scaled',
     [('wspd', [S, VAL])], ports={'wspd': [S, VAL], 'alpha': [VAL], 'roughness': [VAL]})
# ---- Correlation
CO = 'analyse/correlation.py'
base = find_cls(CO, 'CorrelBase')
def correl(cn, var, ports, fit_extra=()):
    c = find_cls(CO, cn)
    T = 'Correl.' + cn; TF = T + ' (fitted)'
    ms = {m['name']: m for m in base['methods']} if 'CorrelBase' in c['bases'] else {}
    ms.update({m['name']: m for m in c['methods']})
    make(T, 'bw.' + T, ms['__init__'] if '__init__' in {m['name'] for m in c['methods']} else ms['__init__'], CO, 'Correlation', var,
         [('model', [T])], kind='constructor', ports=ports, extra_doc=c['doc'])
    make(T + '.run', 'run', ms['run'], CO, 'Correlation', var, [('model', [TF])], kind='method', self_=('model', [T]), mutates=True,
         extra_doc='Fit the correlation. Run this before plotting, reading the parameters or synthesizing.\n\n:param show_params: Print the fitted parameters after the run.\n:type show_params: bool')
    def meth(name, v, outs, **kw):
        if name in ms: make(T + '.' + name, name, ms[name], CO, 'Correlation', v, outs, kind='method', self_=('model', [TF]), **kw)
    return T, TF, meth, c
def attr_node(T, TF, c, attr, types, doc, var):
    NODES.append(dict(id=T + '.' + attr, call=attr, kind='attr', group='Correlation', var=var, title=T + '.' + attr, summary=doc, doc=doc,
                      module=CO, line=c['line'], inputs=[dict(name='model', types=[TF], required=True, self=True, doc='The fitted model.', typeText='')],
                      fields=[], outputs=[dict(name=attr, types=types)], ret='', rtype='', kwargs=None))
for cn, var in [('OrdinaryLeastSquares', 'ols_cor'), ('OrthogonalLeastSquares', 'orthog_cor')]:
    T, TF, meth, c = correl(cn, var, {'ref_spd': [S], 'target_spd': [S], 'ref_dir': [S]})
    meth('plot', var + '_plot', [('plot', [FIG])])
    meth('synthesize', 'synthesized', [('data', DATA)], ports={'ext_input': [S, DF]})
    meth('show_params', var, [])
    attr_node(T, TF, c, 'params', [DICT], 'The fitted parameters, for example slope, offset, r2 and the number of data points.', var + '_params')
    attr_node(T, TF, c, 'data', [DF], 'The merged and aggregated reference and target data used in the correlation.', var + '_data')
T, TF, meth, c = correl('MultipleLinearRegression', 'mul_cor', {'ref_spd': [LIST], 'target_spd': [S]})
meth('synthesize', 'synthesized', [('data', DATA)])
meth('show_params', 'mul_cor', [])
meth('get_r2', 'r2', [('r2', [VAL])])
attr_node(T, TF, c, 'params', [DICT], 'The fitted parameters: one slope per reference dataset and the offset.', 'mul_cor_params')
attr_node(T, TF, c, 'data', [DF], 'The merged and aggregated reference and target data used in the correlation.', 'mul_cor_data')
T, TF, meth, c = correl('SimpleSpeedRatio', 'ssr_cor', {'ref_spd': [S], 'target_spd': [S]})
meth('show_params', 'ssr_cor', [])
attr_node(T, TF, c, 'params', [DICT], 'The fitted parameters, including the speed ratio and the concurrent period used.', 'ssr_params')
T, TF, meth, c = correl('SpeedSort', 'ss_cor', {'ref_spd': [S], 'ref_dir': [S], 'target_spd': [S], 'target_dir': [S]})
meth('plot', 'ss_plot', [('plot', [FIG])])
meth('plot_wind_directions', 'ss_wdir_plot', [('plot', [FIG])])
meth('synthesize', 'synthesized', [('data', [DF])], ports={'input_spd': [S], 'input_dir': [S]})
meth('get_result_table', 'ss_results', [('table', [DF])])
meth('show_params', 'ss_cor', [])
attr_node(T, TF, c, 'params', [DICT], 'The fitted parameters for each direction sector.', 'ss_params')
attr_node(T, TF, c, 'data', [DF], 'The merged and aggregated reference and target data used in the correlation.', 'ss_data')
# ---- Plot
F(PL, 'plot_timeseries', 'Plot', 'timeseries_plot', [('plot', [FIG])])
F(PL, 'plot_scatter', 'Plot', 'scatter_plot', [('plot', [FIG])], ports={'x': [S, LIST], 'y': [S, LIST], 'trendline_y': [S, LIST], 'trendline_x': [S, LIST]})
F(PL, 'plot_scatter_wspd', 'Plot', 'scatter_wspd_plot', [('plot', [FIG])])
F(PL, 'plot_scatter_wdir', 'Plot', 'scatter_wdir_plot', [('plot', [FIG])])
F(PL, 'plot_scatter_by_sector', 'Plot', 'scatter_sector_plot', [('plot', [FIG])])
F(PL, 'plot_sector_ratio', 'Plot', 'sector_ratio_plot', [('plot', [FIG])], ports={'sec_ratio': [S, DICT], 'wdir': [S, DICT], 'sec_ratio_dist': [S, DICT]})
F(GIS, 'plot_meas_station_on_gmap', 'Plot', 'station_map', [('plot', [FIG])], ports={'meas_station': [STN]},
  note='Needs the optional gmaps package and a Google Maps API key.')
# ---- Station
ST = 'load/station.py'
ms = find_cls(ST, 'MeasurementStation')
make('MeasurementStation', 'bw.MeasurementStation', next(m for m in ms['methods'] if m['name'] == '__init__'), ST, 'Station', 'station',
     [('station', [STN])], kind='constructor', ports={'wra_data_model': [PATH, DICT]}, extra_doc=ms['doc'])
sprops = {'name': [VAL], 'lat': [VAL], 'long': [VAL], 'type': [VAL], 'data_model': [DICT], 'schema': [DICT], 'properties': [LIST],
          'measurements': [MEAS], 'header': [OBJ], 'logger_main_configs': [OBJ], 'mast_section_geometry': [OBJ]}
def cls_members(c, prefix, group, recv, recv_types, members, varpfx):
    for m in c['methods']:
        if m['name'] not in members: continue
        t = members[m['name']]
        if 'property' in m['decorators']:
            if any(n['id'] == prefix + '.' + m['name'] for n in NODES): continue
            d = textwrap.dedent(m['doc'] or '').strip() or f"The {m['name'].replace('_', ' ')} of this {recv}."
            NODES.append(dict(id=prefix + '.' + m['name'], call=m['name'], kind='attr', group=group, var=varpfx + m['name'], title=prefix + '.' + m['name'],
                              summary=summary(d), doc=d, module=ST, line=m['line'],
                              inputs=[dict(name=recv, types=recv_types, required=True, self=True, doc='', typeText='')],
                              fields=[], outputs=[dict(name=m['name'], types=t)], ret=m['ret'], rtype=m['rtype'], kwargs=None))
        else:
            make(prefix + '.' + m['name'], m['name'], m, ST, group, varpfx + m['name'].replace('get_', ''), [(m['name'].replace('get_', ''), t)], kind='method', self_=(recv, recv_types))
cls_members(ms, 'MeasurementStation', 'Station', 'station', [STN], dict(sprops, get_table=[DF]), 'station_')
me = find_cls(ST, '_Measurements')
cls_members(me, 'measurements', 'Station', 'measurements', [MEAS],
            dict(names=[LIST], wspd_names=[LIST], wspd_heights=[LIST], wdir_names=[LIST], wdir_heights=[LIST], wspds=[DICT], wdirs=[DICT],
                 properties=[LIST], data_model=[LIST], get_table=[DF], get_names=[LIST], get_heights=[LIST]), 'meas_')
# ---- BrightHub
bh = find_cls(LD, 'LoadBrightHub')
def BH(name, var, outs, **kw):
    make('LoadBrightHub.' + name, 'bw.LoadBrightHub.' + name, next(m for m in bh['methods'] if m['name'] == name), LD, 'BrightHub', var, outs,
         note=kw.pop('note', 'Needs a BrightHub account and network access when the exported script runs.'), **kw)
BH('get_plants', 'plants', [('plants', [DF])])
BH('get_measurement_stations', 'stations', [('stations', [DF])], hide=('return_df',))
BH('get_start_end_dates', 'start_end_dates', [('dates', [DICT])])
BH('get_data_model', 'data_model', [('data_model', [DICT])])
BH('get_data', 'data', [('data', [DF])])
BH('get_cleaning_log', 'cleaning_log', [('cleaning_log', [DF])])
BH('get_cleaning_rules', 'cleaning_rules', [('rules', [LIST])])
n = BH('get_reanalysis', 'reanalysis', [('station', [STN]), ('data', [DF])], hide=('nearest_nodes', 'return_metadata_json'),
   note='Wired here for the single nearest node, which returns (MeasurementStation, DataFrame). Needs a BrightHub account and network access.')
NODES[-1]['tuple'] = dict(flags=[], order=['station', 'data'], always=True)
bd = find_cls(LD, 'LoadBrightdata')
for m in bd['methods']:
    make('LoadBrightdata.' + m['name'], 'bw.LoadBrightdata.' + m['name'], m, LD, 'BrightHub', 'bd_' + m['name'], [('nodes', [LIST])],
         status='deprecated', note='BrightDATA was deprecated in v2.4.0 and will be removed in v3.0.0.')
# ---- Export
F(EX, 'export_csv', 'Export', 'export_csv', [], ports={'data': DATA + [LIST]})
F(EX, 'export_tab_file', 'Export', 'export_tab', [], ports={'freq_tab': [DF], 'lat': [VAL], 'long': [VAL]})
F(EX, 'export_tws_file', 'Export', 'export_tws', [])
# ---- Utilities
F(GIS, 'distance_between_points_haversine', 'Utilities', 'distance_km', [('distance', [VAL])],
  ports={'lat1': [VAL], 'lon1': [VAL], 'lat2': [VAL], 'lon2': [VAL]})
# SVR placeholder (raises NotImplementedError upstream)
svr = find_cls(CO, 'SVR')
make('Correl.SVR', 'bw.Correl.SVR', svr['methods'][0], CO, 'Correlation', 'svr_cor', [], kind='constructor', status='not_implemented',
     ports={'ref_spd': [S], 'target_spd': [S]}, note='The constructor raises NotImplementedError in v2.8.0, so it cannot be added to a pipeline.',
     extra_doc='Support Vector Regression correlation. Not implemented in v2.8.0.')
make('Correl.MultipleLinearRegression.plot', 'plot', next(m for m in find_cls(CO, 'MultipleLinearRegression')['methods'] if m['name'] == 'plot'), CO,
     'Correlation', 'mul_plot', [], kind='method', self_=('model', ['Correl.MultipleLinearRegression (fitted)']), status='not_implemented',
     note='Raises NotImplementedError in v2.8.0, so it cannot be added to a pipeline.', extra_doc='Plot for the multiple linear regression. Not implemented in v2.8.0.')

FALLBACK = {
 'TI.calc': 'Calculate turbulence intensity as the wind speed standard deviation divided by the mean wind speed, for speeds above min_speed.',
 'TI.twelve_by_24': 'Turbulence intensity averaged by hour of day and month, shown as a 12x24 plot.',
 'Correl.MultipleLinearRegression.synthesize': 'Synthesize the target wind speed from the reference datasets, spliced before the measured target data.',
 'Correl.MultipleLinearRegression.show_params': 'Print the fitted slopes and offset.',
 'Correl.MultipleLinearRegression.get_r2': 'The coefficient of determination (R squared) of the fit.',
 'Correl.SpeedSort.get_result_table': 'A table of the fitted SpeedSort parameters for each direction sector.',
 'Correl.SimpleSpeedRatio.show_params': 'Print the fitted speed ratio parameters.',
}
for n in NODES:
    if not n['summary']:
        n['summary'] = FALLBACK.get(n['id'], '')
        if not n['doc']: n['doc'] = n['summary']
demo = raw['demo_datasets/__init__.py']['all']
cat = dict(version=VERSION, commit=COMMIT, repo='https://github.com/brightwind-dev/brightwind', demo_datasets=demo, nodes=NODES)
json.dump(cat, open(sys.argv[2], 'w'), separators=(',', ':'), ensure_ascii=False)
if '-v' in sys.argv[5:]:
    print(len(NODES), 'nodes')
    for n in NODES:
        print(f"\n[{n['group']}] {n['id']} ({n['kind']}{' '+n.get('status','') if n.get('status') else ''}) -> " + ', '.join(f"{o['name']}:{'/'.join(o['types'])}{'~'+o['same'] if 'same' in o else ''}" for o in n['outputs']))
        print('   ports : ' + ', '.join(f"{i['name']}{'*' if i['required'] else ''}<{'/'.join(i['types'])}>" for i in n['inputs']))
        print('   fields: ' + ', '.join(f"{i['name']}{'*' if i['required'] else ''}:{i['mode']}={i['default']}" for i in n['fields']))
        if not n['summary']: print('   !! no summary')
