'use strict';
/* ============================================================
   Brightwind Workflow Builder
   Catalog (catalog.json) is extracted statically from brightwind v2.8.0.
   ============================================================ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

/* ---------- types ---------- */
const TYPE_CLASS = { DataFrame: 'c-df', Series: 'c-series', Figure: 'c-fig', Path: 'c-path', Value: 'c-val', List: 'c-val', Dict: 'c-val' };
// windkit's types come with catalog-windkit.json: {name: {parent, cat, label, help}}. A type is accepted
// wherever one of its ancestors is, so a PWC feeds an input that takes a WWC and a BWC one that takes a Dataset.
let TYPES = {};
const CAT_CLASS = { wc: 'c-wc', loc: 'c-loc', map: 'c-map', wtg: 'c-wtg', xr: 'c-xr', df: 'c-df', fig: 'c-fig', plotly: 'c-fig', obj: 'c-obj' };
const tClass = t => TYPE_CLASS[t] || (TYPES[t] && CAT_CLASS[TYPES[t].cat]) || (t === '*' ? 'c-val' : 'c-obj');
const tLabel = t => t === '*' ? 'anything' : TYPES[t] ? TYPES[t].label : t.replace('Correl.', '').replace('OrdinaryLeastSquares', 'OLS').replace('OrthogonalLeastSquares', 'Orthogonal').replace('MultipleLinearRegression', 'MLR');
function anc(t) { const out = [t]; for (let p = TYPES[t] && TYPES[t].parent; p && !out.includes(p); p = TYPES[p] && TYPES[p].parent) out.push(p); return out; }
const isA = (t, list) => anc(t).some(a => list.includes(a));
const WK_TYPE_HELP = [
  ['TSWC', 'Wind climates: time series (TSWC), binned (BWC), Weibull (WWC), generalised (GWC) and more. A predicted climate (PWC) also fits a Weibull input.'],
  ['Point', 'Locations to calculate at: point, stacked point, raster or cuboid. BBox is a bounding box.'],
  ['RasterMap', 'Maps: raster maps, vector maps and land-cover tables.'],
  ['WTG', 'Turbines: a power and thrust curve (WTG) or a layout (WindTurbines).'],
  ['Dataset', 'Any xarray Dataset or DataArray, or a GeoDataFrame. Every wind climate is also a Dataset.'],
  ['Plotly', 'An interactive plotly figure. Axes, from windkit\'s matplotlib plots, are figures too.'],
];
const TYPE_HELP = [
  ['DataFrame', 'A pandas table of timeseries columns, as returned by the load functions.'],
  ['Series', 'One column. Use Select column to take one from a DataFrame.'],
  ['Figure', 'A plot. Leave it unconnected to show it, or wire it to Save figure.'],
  ['Path', 'A file or folder path, from a File path or Demo dataset node.'],
  ['Value', 'A single number or text value. Lists and dicts share this colour.'],
  ['Shear.Average', 'An object such as a shear result, a correlation model or a measurement station.'],
];
const typeChip = t => h('span', { class: 'ty ' + tClass(t), text: tLabel(t) });

/* ---------- helper nodes (not brightwind functions) ---------- */
const pyStr = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const RET_TYPES = ['Series', 'DataFrame', 'Value', 'List', 'Dict', 'Figure', 'Object'];
const XR = ['Dataset', 'DataArray'];
const WK_RET_TYPES = ['Dataset', 'DataArray', 'TSWC', 'BWC', 'WWC', 'GWC', 'GeoDataFrame', 'Plotly'];
// Narrowing selections (one height, one point) keep the wind climate type but not the spatial structure.
const SEL_TYPES = ['TSWC', 'SurfaceFields', 'BWC', 'WWC', 'PWC', 'GWC', 'GeoWC', 'GEWC', 'PEWC', 'MetFields', 'SiteEffects', 'WTG', 'WindTurbines', 'RasterMap', 'Dataset', 'DataArray'];
function helperDefs(cat, wk) {
  const mk = d => Object.assign({ kind: 'helper', title: d.id, doc: d.summary, module: null, fields: [], inputs: [], outputs: [], kwargs: null, lib: null }, d);
  const wkHelpers = !wk ? [] : [
    mk({ id: 'Sample file', lib: 'wk', group: 'Sources', var: 'sample_path', inline: true, isArg: true, argBase: v => (v.file || 'sample').replace(/\W+/g, '_') + '_path',
      summary: 'One of the small example files for windkit: a turbine .wtg, a binned wind climate .tab, an elevation raster and a roughness .map. The exported script downloads it once.',
      fields: [{ name: 'file', mode: 'choice', choices: wk.samples.map(s => s.file), default: wk.samples[0].file, doc: wk.samples.map(s => `${s.file}: ${s.doc}`).join(' ') }],
      outputs: [{ name: 'path', types: ['Path'] }], code: v => `sample_file(${pyStr(v.file || wk.samples[0].file)})` }),
    mk({ id: 'Select variable', lib: 'wk', group: 'Helpers', var: 'da', inline: true, summary: "Take one variable of an xarray Dataset as a DataArray, for example tswc['wind_speed'].",
      inputs: [{ name: 'ds', types: ['Dataset'], required: true }],
      fields: [{ name: 'variable', mode: 'text', required: true, default: null, doc: 'The variable name, for example wind_speed, wsfreq, A or k.' }],
      outputs: [{ name: 'da', types: ['DataArray'] }], code: (v, i) => `${i.ds}[${pyStr(v.variable || '')}]` }),
    mk({ id: 'Select by coordinate', lib: 'wk', group: 'Helpers', var: 'selected', summary: 'Pick part of an xarray object by coordinate value with .sel(), for example height=80, or by position with .isel(), for example point=0.',
      inputs: [{ name: 'obj', types: XR, required: true }],
      fields: [{ name: 'method', mode: 'choice', choices: ['sel', 'isel'], default: 'sel', doc: 'sel picks by coordinate value, isel by position from 0.' },
               { name: 'selection', mode: 'code', required: true, default: null, doc: 'Keyword arguments, for example height=80 or point=0, sector=slice(0, 6).' }],
      outputs: [{ name: 'obj', same: 'obj', sameNarrow: true, types: SEL_TYPES }],
      code: (v, i) => `${i.obj}.${v.method || 'sel'}(${String(v.selection || '').trim()})` }),
    mk({ id: 'DataArray to Series', lib: 'wk', group: 'Helpers', var: 'series', inline: true, summary: 'Turn a DataArray into a pandas Series with .to_series(), for brightwind tools that take a column.',
      inputs: [{ name: 'da', types: ['DataArray'], required: true }], outputs: [{ name: 'series', types: ['Series'] }], code: (v, i) => `${i.da}.to_series()` }),
    mk({ id: 'Dataset to DataFrame', lib: 'wk', group: 'Helpers', var: 'df', summary: 'Turn an xarray Dataset into a pandas DataFrame with .to_dataframe().',
      inputs: [{ name: 'ds', types: ['Dataset'], required: true }], outputs: [{ name: 'data', types: ['DataFrame'] }], code: (v, i) => `${i.ds}.to_dataframe()` }),
    mk({ id: 'Save netCDF', lib: 'wk', group: 'Helpers', var: 'to_netcdf', summary: 'Write an xarray object to a netCDF file with .to_netcdf().',
      inputs: [{ name: 'obj', types: XR, required: true }],
      fields: [{ name: 'file_name', mode: 'text', required: true, default: null, doc: 'For example bwc.nc.' }],
      stmt: true, code: (v, i) => `${i.obj}.to_netcdf(${pyStr(v.file_name || 'result.nc')})` }),
    mk({ id: 'Save interactive figure', lib: 'wk', group: 'Helpers', var: 'write_html', summary: 'Save a plotly figure as a web page with fig.write_html().',
      inputs: [{ name: 'figure', types: ['Plotly'], required: true }],
      fields: [{ name: 'file_name', mode: 'text', required: true, default: null, doc: 'For example wind_rose.html.' }],
      stmt: true, code: (v, i) => `${i.figure}.write_html(${pyStr(v.file_name || 'figure.html')}, include_plotlyjs='cdn')` }),
  ];
  return [...wkHelpers,
    mk({ id: 'Demo dataset', lib: 'bw', group: 'Sources', var: 'demo_path', inline: true, isArg: true, argBase: v => (v.dataset || 'demo_data') + '_path', summary: 'Path to one of the example files bundled with brightwind (bw.demo_datasets).',
      fields: [{ name: 'dataset', mode: 'choice', choices: cat.demo_datasets, default: 'demo_data', doc: 'Which bundled file to use.' }],
      outputs: [{ name: 'path', types: ['Path'] }], code: v => 'bw.demo_datasets.' + (v.dataset || 'demo_data') }),
    mk({ id: 'File path', group: 'Sources', var: 'file_path', inline: true, isArg: true, summary: 'A file or folder on the machine that runs the exported script. Becomes an argument of run() in the function export.',
      fields: [{ name: 'path', mode: 'text', required: true, default: null, doc: 'For example C:\\data\\mast.csv or /data/mast.csv.' }],
      outputs: [{ name: 'path', types: ['Path'] }], code: v => 'r' + pyStr(v.path || '').replace(/\\\\/g, '\\') }),
    mk({ id: 'Select column', group: 'Helpers', var: 'series', inline: true, summary: "Take one column from a DataFrame as a Series, for example data['Spd80mN'].",
      inputs: [{ name: 'data', types: ['DataFrame'], required: true }],
      fields: [{ name: 'column', mode: 'text', required: true, default: null, doc: 'The column name, exactly as it appears in the data.' }],
      outputs: [{ name: 'series', types: ['Series'] }], code: (v, i) => `${i.data}[${pyStr(v.column || '')}]` }),
    mk({ id: 'Select columns', group: 'Helpers', var: 'columns', inline: true, summary: "Keep several columns of a DataFrame, for example data[['Spd80mN', 'Spd60mN']].",
      inputs: [{ name: 'data', types: ['DataFrame'], required: true }],
      fields: [{ name: 'columns', mode: 'list', required: true, default: null, doc: 'Column names separated by commas.' }],
      outputs: [{ name: 'data', types: ['DataFrame'] }],
      code: (v, i) => `${i.data}[[${String(v.columns || '').split(',').map(s => s.trim()).filter(Boolean).map(pyStr).join(', ')}]]` }),
    mk({ id: 'Slice by date', group: 'Helpers', var: 'data_slice', summary: "Keep the rows between two timestamps, using data.loc['from':'to'].",
      inputs: [{ name: 'data', types: ['DataFrame', 'Series'], required: true }],
      fields: [{ name: 'date_from', mode: 'text', default: null, doc: 'Start, for example 2016-06-01. Leave empty for the start of the data.' },
               { name: 'date_to', mode: 'text', default: null, doc: 'End, for example 2017-05-31. Leave empty for the end of the data.' }],
      outputs: [{ name: 'data', same: 'data', types: ['DataFrame', 'Series'] }],
      code: (v, i) => `${i.data}.loc[${v.date_from ? pyStr(v.date_from) : ''}:${v.date_to ? pyStr(v.date_to) : ''}]` }),
    mk({ id: 'List', group: 'Helpers', var: 'items', inline: true, summary: 'Collect up to four inputs into a Python list, for example the reference speeds of a multiple linear regression.',
      inputs: ['a', 'b', 'c', 'd'].map((n, k) => ({ name: n, types: ['*'], required: k === 0 })),
      outputs: [{ name: 'list', types: ['List'] }], code: (v, i) => '[' + ['a', 'b', 'c', 'd'].map(n => i[n]).filter(x => x != null).join(', ') + ']' }),
    mk({ id: 'Python expression', group: 'Helpers', var: 'result', summary: 'Any Python expression. Write {a} and {b} where the connected inputs go, for example {a} - {b}.',
      inputs: [{ name: 'a', types: ['*'] }, { name: 'b', types: ['*'] }],
      fields: [{ name: 'expression', mode: 'code', required: true, default: null, doc: 'Use {a} and {b} for the inputs.' },
               { name: 'returns', mode: 'choice', choices: wk ? [...RET_TYPES, ...WK_RET_TYPES] : RET_TYPES, default: 'Series', doc: 'What the expression produces. This decides where the output can be wired.' }],
      outputs: [{ name: 'result', typesFrom: 'returns', types: ['Series'] }],
      code: (v, i) => String(v.expression || '').replace(/\{a\}/g, i.a ?? 'None').replace(/\{b\}/g, i.b ?? 'None') }),
    mk({ id: 'Print', group: 'Helpers', var: 'print', summary: 'Print a result when the script runs.',
      inputs: [{ name: 'value', types: ['*'], required: true }], stmt: true, code: (v, i) => `print(${i.value})` }),
    mk({ id: 'Save figure', group: 'Helpers', var: 'savefig', summary: 'Save a matplotlib figure to an image file with fig.savefig().',
      inputs: [{ name: 'figure', types: ['Figure'], required: true }],
      fields: [{ name: 'file_name', mode: 'text', required: true, default: null, doc: 'For example monthly_means.png.' }, { name: 'dpi', mode: 'expr', default: '150', doc: 'Resolution in dots per inch.' }],
      stmt: true, code: (v, i, ty) => `${i.figure}${(ty.figure || []).includes('Axes') ? '.figure' : ''}.savefig(${pyStr(v.file_name || 'figure.png')}, dpi=${v.dpi || 150}, bbox_inches='tight')` }),
  ];
}
const BW_GROUPS = ['Load', 'Clean', 'Transform', 'Statistics', 'Distributions', 'Turbulence', 'Shear', 'Correlation', 'Atmosphere', 'Plot', 'Station', 'BrightHub', 'Export', 'Utilities'];
let WK_GROUPS = [];
const COMMON_GROUPS = ['Sources', 'Helpers'];
const GROUP_ORDER = () => [...COMMON_GROUPS, ...BW_GROUPS, ...WK_GROUPS];
const groupRank = d => { const i = GROUP_ORDER().indexOf(d.group); return (d.lib === 'wk' && COMMON_GROUPS.includes(d.group) ? 0.5 : 0) + (i < 0 ? 99 : i); };
const LIBS = { bw: { name: 'brightwind' }, wk: { name: 'windkit' } };
const libOf = d => d.lib || (d.kind === 'helper' ? null : 'bw');
const gslug = g => g.replace(/[^A-Za-z]+/g, '-');
const VAR_OVERRIDE = { 'LoadBrightHub.get_reanalysis': { station: 'reanalysis_station', data: 'reanalysis_data' } };

/* ---------- state ---------- */
let CAT = null, WKCAT = null, DEFS = {};
const S = { nodes: [], edges: [], view: { x: 40, y: 60, k: 1 }, sel: null, peek: null, fmt: 'flat', opts: { show: true, print: true }, seq: 1, libs: ['bw'] };
let pend = null;            // pending wire {node, port, dir, x, y, armed}
const hist = { stack: [], at: -1 };
const def = n => DEFS[n.t];
const nodeById = id => S.nodes.find(n => n.id === id);
const snapshot = () => JSON.stringify({ nodes: S.nodes, edges: S.edges, seq: S.seq });
function commit() {
  if (typeof runInvalidate === 'function') runInvalidate();
  hist.stack.length = hist.at + 1; hist.stack.push(snapshot()); if (hist.stack.length > 120) hist.stack.shift(); hist.at = hist.stack.length - 1;
  try { localStorage.setItem('bw-builder-v1', JSON.stringify({ nodes: S.nodes, edges: S.edges, seq: S.seq, view: S.view })); } catch (e) { /* storage unavailable */ }
}
function restore(json) { const d = JSON.parse(json); S.nodes = d.nodes; S.edges = d.edges; S.seq = d.seq; if (S.sel && S.sel.kind === 'node' && !nodeById(S.sel.id)) S.sel = null; if (S.sel && S.sel.kind === 'edge') S.sel = null; ensureLibs(); }
function undo() { if (hist.at > 0) { hist.at--; restore(hist.stack[hist.at]); renderAll(); } }
function redo() { if (hist.at < hist.stack.length - 1) { hist.at++; restore(hist.stack[hist.at]); renderAll(); } }

/* ---------- graph logic ---------- */
const edgeInto = (nid, port) => S.edges.find(e => e.to[0] === nid && e.to[1] === port);
const edgesFrom = (nid, port) => S.edges.filter(e => e.from[0] === nid && (port == null || e.from[1] === port));
function outTypes(n, outName, seen = new Set()) {
  const d = def(n), o = d.outputs.find(x => x.name === outName);
  if (!o) return [];
  if (o.typesFrom) return [n.v[o.typesFrom] || d.fields.find(f => f.name === o.typesFrom).default];
  if (o.same && !seen.has(n.id)) {
    seen.add(n.id);
    const e = edgeInto(n.id, o.same);
    if (e) {
      const src = nodeById(e.from[0]), st = outTypes(src, e.from[1], seen);
      // sameNarrow: the closest listed ancestor (a Cuboid sliced to one height is no longer a Cuboid); otherwise keep the input's own type
      const t = [...new Set(o.sameNarrow ? st.map(x => anc(x).find(a => o.types.includes(a))).filter(Boolean) : st.filter(x => isA(x, o.types)))];
      if (t.length) return t;
    }
  }
  return o.types;
}
const accepts = (inp, types) => inp.types.includes('*') || types.some(t => isA(t, inp.types));
function reaches(fromId, toId) { // is toId downstream of fromId
  const stack = [fromId], seen = new Set();
  while (stack.length) { const c = stack.pop(); if (c === toId) return true; if (seen.has(c)) continue; seen.add(c); for (const e of S.edges) if (e.from[0] === c) stack.push(e.to[0]); }
  return false;
}
function canConnect(srcId, outName, dstId, inName) {
  const s = nodeById(srcId), t = nodeById(dstId);
  if (!s || !t) return 'Missing node.';
  if (srcId === dstId) return 'A node cannot feed itself.';
  const inp = def(t).inputs.find(i => i.name === inName), types = outTypes(s, outName);
  if (!inp) return 'No such input.';
  if (!def(s).outputs.some(o => o.name === outName)) return `${def(s).title} has no output called ${outName}.`;
  if (!accepts(inp, types)) return `${def(t).title} · ${inName} accepts ${inp.types.map(tLabel).join(' or ')}. This output is ${types.map(tLabel).join(' or ')}.`;
  if (reaches(dstId, srcId)) return 'That connection would create a loop.';
  return null;
}
function connect(srcId, outName, dstId, inName) {
  const why = canConnect(srcId, outName, dstId, inName);
  if (why) { toast(why); return false; }
  S.edges = S.edges.filter(e => !(e.to[0] === dstId && e.to[1] === inName));
  S.edges.push({ id: 'e' + (S.seq++), from: [srcId, outName], to: [dstId, inName] });
  const t = nodeById(dstId); if (t.lit) delete t.lit[inName];
  return true;
}
function addNode(t, x, y, init) {
  const d = DEFS[t];
  if (!d) return null;
  if (d.status === 'not_implemented') { toast(d.note || 'Not implemented in this version.'); return null; }
  const n = Object.assign({ id: 'n' + (S.seq++), t, x: Math.round(x), y: Math.round(y), v: {}, lit: {}, args: {} }, init || {});
  for (const f of d.fields) if (f.mode === 'choice' && n.v[f.name] == null) n.v[f.name] = f.quoted ? choiceDefault(f) : f.default;
  S.nodes.push(n);
  return n;
}
function removeNode(id) { S.nodes = S.nodes.filter(n => n.id !== id); S.edges = S.edges.filter(e => e.from[0] !== id && e.to[0] !== id); if (S.sel && S.sel.id === id) S.sel = null; }
function nodeIssues(n) {
  const d = def(n), out = [];
  for (const i of d.inputs) {
    const e = edgeInto(n.id, i.name);
    if (e) {
      const src = nodeById(e.from[0]);
      if (!accepts(i, outTypes(src, e.from[1]))) out.push(`${i.name}: connected output is ${outTypes(src, e.from[1]).map(tLabel).join(' or ')}, expected ${i.types.map(tLabel).join(' or ')}`);
    } else if (i.required && !(n.lit[i.name] || '').trim()) out.push(`${i.name}: connect an input or type a value`);
  }
  for (const f of d.fields) if (f.required && !String(n.v[f.name] ?? '').trim()) out.push(`${f.name}: required`);
  return out;
}
function topo() {
  const indeg = new Map(S.nodes.map(n => [n.id, 0]));
  for (const e of S.edges) indeg.set(e.to[0], indeg.get(e.to[0]) + 1);
  const byPos = (a, b) => (a.x - b.x) || (a.y - b.y);
  const ready = S.nodes.filter(n => indeg.get(n.id) === 0).sort(byPos), order = [];
  while (ready.length) {
    const n = ready.shift(); order.push(n);
    const next = [];
    for (const e of S.edges) if (e.from[0] === n.id) { const c = indeg.get(e.to[0]) - 1; indeg.set(e.to[0], c); if (c === 0) next.push(nodeById(e.to[0])); }
    ready.push(...next); ready.sort(byPos);
  }
  return order;
}

/* ---------- code generation ---------- */
const unq = x => String(x ?? '').replace(/^(['"])(.*)\1$/, '$2');
// windkit's string choices: start on the default when it is one of them, else on the first (required) or on "default"
const choiceDefault = f => f.choices.includes(unq(f.default)) ? unq(f.default) : f.required ? f.choices[0] : '';
function fieldPy(f, raw) { // -> python source or null when unset / equal to default
  if (f.mode === 'bool') { const def_ = f.default === 'True'; const val = raw == null ? def_ : !!raw; return val === def_ && !f.required ? null : (val ? 'True' : 'False'); }
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (f.mode === 'text') { if (s.startsWith('=')) return s.slice(1).trim() || null; const py = pyStr(s); return f.default && f.default.replace(/"/g, "'") === py ? null : py; }
  if (f.mode === 'list') return '[' + s.split(',').map(x => x.trim()).filter(Boolean).map(pyStr).join(', ') + ']';
  if (f.mode === 'choice') { if (!f.quoted) return s; const py = pyStr(s); return f.default && f.default.replace(/"/g, "'") === py ? null : py; }
  return s === f.default ? null : s;
}
function flagOn(n, flagName) {
  const d = def(n);
  if (n.v[flagName]) return true;
  return d.outputs.some(o => o.flag === flagName && edgesFrom(n.id, o.name).length);
}
function isTuple(n) { const t = def(n).tuple; return !!t && (t.always || t.flags.some(f => flagOn(n, f))); }
function generate(fmt, ctx = {}) {
  const order = topo(), used = new Set(['bw', 'wk', 'plt', 'np', 'pd', 'xr', 'os', 'run', 'results', 'print', 'sample_file']), names = new Map(), exprs = new Map(), issues = [];
  const uniq = base => { base = (base || 'x').replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1'); let nm = base, k = 2; while (used.has(nm)) nm = base + '_' + (k++); used.add(nm); return nm; };
  const args = [];          // run() arguments: {name, default}
  const steps = [];         // {node, lines:[...], echo: expr|null}
  const figures = [], plotlys = [];
  let anyFigure = false;
  const libsUsed = new Set(order.map(n => libOf(def(n))).filter(Boolean));
  const key = (id, out) => id + '\u0000' + out;
  const consumed = (n, o) => edgesFrom(n.id, o).length > 0;
  const PRINTABLE = t => !isA(t, ['Figure', 'Path', 'Plotly']);

  for (const n of order) {
    const d = def(n), probs = nodeIssues(n);
    if (probs.length) issues.push({ id: n.id, title: d.title, probs });
    // inputs -> expressions
    const inx = {}, inty = {};
    for (const i of d.inputs) {
      const ie = edgeInto(n.id, i.name); if (ie) inty[i.name] = outTypes(nodeById(ie.from[0]), ie.from[1]);
      const e = edgeInto(n.id, i.name);
      if (e) inx[i.name] = exprs.get(key(e.from[0], e.from[1])) ?? '...';
      else if ((n.lit[i.name] || '').trim()) inx[i.name] = n.lit[i.name].trim();
      else inx[i.name] = i.required ? '...' : null;
    }
    const todo = probs.length ? ['# TODO ' + d.title + ': ' + probs.join('; ')] : [];
    const base = n.var || (d.argBase ? d.argBase(n.v) : d.var);

    if (d.kind === 'helper') {
      let code = d.code(n.v, inx, inty);
      if (fmt === 'run' && d.id === 'File path') code = pyStr(ctx.paths && ctx.paths[n.id] || '');
      if (fmt === 'run' && d.id === 'Sample file') code = pyStr('/samples/' + (n.v.file || d.fields[0].default));
      if (d.isArg && fmt === 'func') { const a = uniq(base); args.push({ name: a, def: code }); code = a; }
      if (d.stmt) { steps.push({ node: n, lines: [...todo, code] }); continue; }
      const o = d.outputs[0];
      if (d.inline) {
        exprs.set(key(n.id, o.name), code);
        if (todo.length) steps.push({ node: n, lines: todo });
        continue;
      }
      const nm = uniq(base); names.set(key(n.id, o.name), nm); exprs.set(key(n.id, o.name), nm);
      steps.push({ node: n, lines: [...todo, `${nm} = ${code}`], leaf: consumed(n, o.name) ? [] : [[nm, outTypes(n, o.name)[0]]] });
      continue;
    }
    const recvIn = d.inputs.find(i => i.self), recv = recvIn ? inx[recvIn.name] : null;
    if (d.kind === 'attr') {
      const code = `${recv}.${d.call}`, o = d.outputs[0];
      exprs.set(key(n.id, o.name), code);
      if (isA(outTypes(n, o.name)[0], ['Figure'])) anyFigure = true;
      const st = { node: n, lines: todo, leaf: consumed(n, o.name) ? [] : [[code, outTypes(n, o.name)[0]]] };
      if (st.lines.length || st.leaf.length) steps.push(st);
      continue;
    }
    // call arguments in signature order
    const parts = []; let positional = true;
    for (const pn of d.params || []) {
      const inp = d.inputs.find(i => i.name === pn), fld = d.fields.find(f => f.name === pn);
      let val = null, required = false;
      if (inp) { val = inx[pn]; required = inp.required; }
      else if (fld) {
        required = fld.required;
        if (fld.flag) val = flagOn(n, pn) ? 'True' : null;
        else val = fieldPy(fld, n.v[pn]);
        if (val == null && required) val = '...';
        if (fmt === 'func' && n.args[pn] && !fld.flag) {
          const dflt = val ?? fld.default ?? 'None';
          const a = uniq(pn); args.push({ name: a, def: /^[\w.'"\-\[\](), ]*$/.test(dflt) && !/[A-Z_]{4,}/.test(dflt) ? dflt : 'None' }); val = a;
        }
      }
      if (val == null) { positional = false; continue; }
      if (positional && required) parts.push(val); else { positional = false; parts.push(`${pn}=${val}`); }
    }
    if (d.kwargs && (n.v.__kwargs || '').trim()) parts.push(n.v.__kwargs.trim());
    const callee = d.kind === 'method' ? `${recv}.${d.call}` : d.call;
    let call = `${callee}(${parts.join(', ')})`;
    if (call.length > 96 && parts.length > 1) call = `${callee}(\n    ${parts.join(',\n    ')},\n)`;

    if (d.mutates) { // e.g. model.run(): same object carries on
      for (const o of d.outputs) exprs.set(key(n.id, o.name), recv);
      steps.push({ node: n, lines: [...todo, call] }); continue;
    }
    if (!d.outputs.length) { steps.push({ node: n, lines: [...todo, call] }); continue; }
    const primary = d.outputs.find(o => !o.flag) || d.outputs[0];
    const nameFor = o => {
      const ov = VAR_OVERRIDE[d.id] && !n.var ? VAR_OVERRIDE[d.id][o.name] : null;
      if (ov) return ov;
      if (base.endsWith(o.name)) return base;
      if (o === primary && o.name !== 'plot') return base;
      return base + '_' + o.name;
    };
    const leaf = [];
    const reg = o => { const nm = uniq(nameFor(o)); names.set(key(n.id, o.name), nm); exprs.set(key(n.id, o.name), nm);
      const t = outTypes(n, o.name)[0]; if (isA(t, ['Figure'])) { anyFigure = true; figures.push(nm); }
      if (!consumed(n, o.name)) { leaf.push([nm, t]); if (t === 'Plotly') plotlys.push(nm); } return nm; };
    if (d.attrs) { // one object, each output an attribute of it: tutorial = wk.load_tutorial_data(...); tutorial.bwc
      const nm = uniq(base); names.set(key(n.id, '__obj'), nm);
      for (const o of d.outputs) { const ex = `${nm}.${o.name}`; exprs.set(key(n.id, o.name), ex);
        const t = outTypes(n, o.name)[0]; if (isA(t, ['Figure'])) anyFigure = true; if (!consumed(n, o.name)) { leaf.push([ex, t]); if (t === 'Plotly') plotlys.push(ex); } }
      steps.push({ node: n, lines: [...todo, `${nm} = ${call}`], leaf });
    } else if (isTuple(n)) {
      const lhs = d.tuple.order.map(on => reg(d.outputs.find(o => o.name === on)));
      steps.push({ node: n, lines: [...todo, `${lhs.join(', ')} = ${call}`], leaf });
    } else {
      const nm = reg(primary);
      steps.push({ node: n, lines: [...todo, `${nm} = ${call}`], leaf });
    }
    if (d.kind === 'constructor' && d.group === 'Shear') anyFigure = true;
  }

  if (fmt === 'run') return { issues, libs: [...libsUsed], plotly: order.some(n => def(n).plotly), steps: steps.map(st => ({ id: st.node.id, title: def(st.node).title, code: st.lines.filter(l => !l.startsWith('# TODO')).join('\n'), leaf: st.leaf || [] })) };
  const body = [];
  const allText = () => steps.flatMap(s => s.lines).join('\n') + args.map(a => a.def).join('\n');
  const libs = libsUsed.size ? [...libsUsed].sort() : S.libs.slice();
  const usesPlotly = order.some(n => def(n).plotly), usesSample = order.some(n => n.t === 'Sample file');
  const imports = () => { const t = allText(), im = [];
    if (usesSample) im.push('import os', 'import urllib.request');
    if (libs.includes('bw')) im.push('import brightwind as bw');
    if (libs.includes('wk')) im.push('import windkit as wk');
    if (usesPlotly) im.push("import plotly.subplots  # windkit's plotly helpers expect it loaded");
    if (/\bnp\./.test(t)) im.push('import numpy as np'); if (/\bpd\./.test(t)) im.push('import pandas as pd'); if (/\bxr\./.test(t)) im.push('import xarray as xr');
    if (anyFigure && S.opts.show && fmt !== 'nb') im.push('import matplotlib.pyplot as plt'); return im; };
  const SAMPLE_FN = ['', '', 'def sample_file(name):', '    """Download one of the Workflow Builder\'s windkit sample files (once) and return its path."""',
    "    path = os.path.join(os.path.expanduser('~'), '.bw-explorer-samples', name)", '    if not os.path.exists(path):', '        os.makedirs(os.path.dirname(path), exist_ok=True)',
    "        urllib.request.urlretrieve('https://bw-explorer.coderenewables.com/py/samples/' + name, path)", '    return path'];
  const libText = libs.map(l => l === 'bw' ? `brightwind v${CAT.version}` : `windkit v${WKCAT.version}`).join(' and ');
  const pip = [...(libs.includes('bw') ? ['brightwind'] : []), ...(libs.includes('wk') ? ['windkit'] : []), ...(usesPlotly ? ['plotly'] : []), ...(libs.includes('wk') && anyFigure ? ['matplotlib'] : [])];
  const head = [`# Built with Brightwind Workflow Builder for ${libText}.`, `# Run it in a Python environment that has ${libs.map(l => LIBS[l].name).join(' and ')} installed: pip install ${pip.join(' ')}`];
  const leafPrints = st => (S.opts.print ? (st.leaf || []).filter(([, t]) => PRINTABLE(t)).map(([e]) => `print(${e})`) : []);
  const leafShows = st => (S.opts.show && fmt === 'flat' ? (st.leaf || []).filter(([, t]) => t === 'Plotly').map(([e]) => `${e}.show()`) : []);
  const base = libs.length > 1 ? 'brightwind_windkit_workflow' : libs[0] === 'wk' ? 'windkit_workflow' : 'brightwind_workflow';
  const label = st => '# ' + def(st.node).title;

  if (fmt === 'nb') {
    const cells = [{ cell_type: 'markdown', metadata: {}, source: [`# ${libs.map(l => LIBS[l].name).join(' and ')} workflow\n`, `Built with Brightwind Workflow Builder for ${libText}.`] },
      { cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source: [...imports(), ...(usesSample ? SAMPLE_FN : [])].join('\n').split(/(?<=\n)/) }];
    for (const st of steps) {
      const lines = [label(st), ...st.lines];
      const echo = (st.leaf || []).filter(([, t]) => PRINTABLE(t) || (t === 'Plotly' && S.opts.show)).map(([e]) => e);
      if (echo.length) lines.push(echo[echo.length - 1]);
      if (lines.length > 1) cells.push({ cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source: lines.join('\n').split(/(?<=\n)/) });
    }
    const nb = { cells, metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, language_info: { name: 'python' } }, nbformat: 4, nbformat_minor: 5 };
    const preview = cells.map((c, i) => `# %% [${c.cell_type === 'markdown' ? 'markdown' : 'cell ' + i}]\n` + (c.cell_type === 'markdown' ? c.source.join('').split('\n').map(l => '# ' + l).join('\n') : c.source.join(''))).join('\n\n');
    return { text: JSON.stringify(nb, null, 1), preview, issues, filename: base + '.ipynb' };
  }
  for (const st of steps) { const lines = [...st.lines, ...leafPrints(st), ...leafShows(st)]; if (lines.length) body.push('', label(st), ...lines); }
  if (!steps.length) body.push('', '# The canvas is empty. Add tools to build a pipeline.');
  let out;
  if (fmt === 'func') {
    const sig = args.map(a => `${a.name}=${a.def}`).join(', ');
    const res = [...names.values()];
    const ind = l => l.split('\n').map(x => (x ? '    ' + x : x)).join('\n');
    out = [...head, '', ...imports(), ...(usesSample ? SAMPLE_FN : []), '', '', `def run(${sig}):`, '    """Run the workflow and return its results by name."""',
      ...(body.length ? body.slice(1).map(ind) : ['    pass']), '',
      '    return {' + (res.length ? '\n' + res.map(r => `        ${pyStr(r)}: ${r},`).join('\n') + '\n    }' : '}'), '', '',
      "if __name__ == '__main__':", '    results = run()', ...(S.opts.show ? plotlys.map(x => `    results[${pyStr(x)}].show()`) : []), ...(anyFigure && S.opts.show ? ['    plt.show()'] : [])];
  } else {
    out = [...head, '', ...imports(), ...(usesSample ? SAMPLE_FN : []), ...body, ...(anyFigure && S.opts.show ? ['', 'plt.show()'] : [])];
  }
  const text = out.join('\n') + '\n';
  return { text, preview: text, issues, filename: fmt === 'func' ? base + '_run.py' : base + '.py' };
}

/* ---------- layout ---------- */
function nodeHeight(n) { const d = def(n), ps = paramSummary(n); return 50 + 24 * (d.inputs.length + d.outputs.length) + (ps ? 13 + 13 * Math.ceil(Math.min(ps.length, 90) / 40) : 0); }
function tidy() {
  const depth = new Map();
  for (const n of topo()) { let dmax = 0; for (const e of S.edges) if (e.to[0] === n.id) dmax = Math.max(dmax, (depth.get(e.from[0]) ?? 0) + 1); depth.set(n.id, dmax); }
  const cols = [];
  for (const n of S.nodes) (cols[depth.get(n.id) ?? 0] ||= []).push(n);
  const yOf = new Map();
  cols.forEach((col, ci) => {
    if (!col) return;
    const bary = n => { const ps = S.edges.filter(e => e.to[0] === n.id).map(e => yOf.get(e.from[0]) ?? 0); return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : n.y; };
    col.sort((a, b) => bary(a) - bary(b));
    let y = 0;
    for (const n of col) { const want = ci ? bary(n) - nodeHeight(n) / 2 : y; y = Math.max(y, want); n.x = ci * 300; n.y = Math.round(y); yOf.set(n.id, y + nodeHeight(n) / 2); y += nodeHeight(n) + 22; }
  });
}
function fit() {
  const c = $('#canvas').getBoundingClientRect();
  if (!S.nodes.length || !c.width) { S.view = { x: 40, y: 60, k: 1 }; applyView(); return; }
  const x0 = Math.min(...S.nodes.map(n => n.x)), y0 = Math.min(...S.nodes.map(n => n.y));
  const x1 = Math.max(...S.nodes.map(n => n.x + 236)), y1 = Math.max(...S.nodes.map(n => n.y + nodeHeight(n)));
  const ai = $('#ai'), cover = ai && !ai.hidden && !isNarrow() ? Math.max(0, c.right - ai.getBoundingClientRect().left) : 0, w = c.width - cover;
  const k = Math.max(0.2, Math.min(1, (w - 60) / (x1 - x0), (c.height - 110) / (y1 - y0)));
  S.view = { k, x: (w - (x1 - x0) * k) / 2 - x0 * k, y: Math.max(52, (c.height - (y1 - y0) * k) / 2) - y0 * k };
  applyView();
}
function applyView() {
  const { x, y, k } = S.view;
  $('#world').style.transform = `translate(${x}px, ${y}px) scale(${k})`;
  const c = $('#canvas'); c.style.backgroundSize = `${22 * k}px ${22 * k}px`; c.style.backgroundPosition = `${x}px ${y}px`;
}
function zoomAt(cx, cy, factor) {
  const k = Math.max(0.25, Math.min(1.8, S.view.k * factor)), r = k / S.view.k;
  S.view = { k, x: cx - (cx - S.view.x) * r, y: cy - (cy - S.view.y) * r }; applyView();
}
const toWorld = (cx, cy) => { const r = $('#canvas').getBoundingClientRect(); return { x: (cx - r.left - S.view.x) / S.view.k, y: (cy - r.top - S.view.y) / S.view.k }; };

/* ---------- canvas rendering ---------- */
const shortId = d => d.lib === 'wk' && d.title ? d.title : d.id.replace('Correl.', '');
function shortTitle(d) {
  if (d.kind === 'method' || d.kind === 'attr') { const id = shortId(d), i = id.lastIndexOf('.'); return { ov: id.slice(0, i), tt: '.' + id.slice(i + 1) + (d.kind === 'method' ? '()' : '') }; }
  return { ov: (S.libs.length > 1 && d.lib === 'wk' ? 'windkit · ' : '') + d.group, tt: shortId(d) };
}
function paramSummary(n) {
  const d = def(n), bits = [];
  for (const f of d.fields) {
    if (f.flag) continue;
    const py = f.mode === 'choice' && !f.quoted ? n.v[f.name] : f.mode === 'list' || f.mode === 'code' ? (String(n.v[f.name] ?? '').trim() || null) : fieldPy(f, n.v[f.name]);
    if (py != null) bits.push(d.kind === 'helper' && d.fields.length === 1 ? String(py) : `${f.name}=${py}`);
  }
  return bits.join(', ');
}
const portPos = new Map();
function renderCanvas() {
  const host = $('#nodes'); host.textContent = '';
  $('#empty').hidden = S.nodes.length > 0;
  for (const n of S.nodes) {
    const d = def(n), t = shortTitle(d), probs = nodeIssues(n);
    const rows = h('div', { class: 'rows' });
    for (const i of d.inputs) {
      const e = edgeInto(n.id, i.name), lit = (n.lit[i.name] || '').trim();
      rows.append(h('div', { class: 'row in' + (!i.required && !e && !lit ? ' dim' : '') },
        h('span', { class: `port in ${tClass(i.types[0])}${e ? ' full' : ''}`, 'data-node': n.id, 'data-port': i.name, 'data-dir': 'in', title: 'Accepts ' + i.types.map(tLabel).join(' or ') }),
        h('span', { class: 'pn', text: i.name }), i.required && !e && !lit ? h('span', { class: 'req', text: '*' }) : null,
        !e && lit ? h('span', { class: 'lit', text: '= ' + lit }) : null));
    }
    for (const o of d.outputs) {
      const ty = outTypes(n, o.name), on = edgesFrom(n.id, o.name).length > 0;
      rows.append(h('div', { class: 'row out' + (o.flag && !on && !n.v[o.flag] ? ' dim' : '') },
        h('span', { class: 'pn', text: o.name }),
        h('span', { class: `port out ${tClass(ty[0])}${on ? ' full' : ''}`, 'data-node': n.id, 'data-port': o.name, 'data-dir': 'out', title: ty.map(tLabel).join(' or ') })));
    }
    const ps = paramSummary(n);
    const el = h('div', { class: `node g-${gslug(d.group)}${d.lib === 'wk' ? ' lib-wk' : ''}${S.sel && S.sel.kind === 'node' && S.sel.id === n.id ? ' sel' : ''}${probs.length ? ' bad' : ''}${typeof RUNMARKS !== 'undefined' && RUNMARKS[n.id] ? ' run-' + RUNMARKS[n.id] : ''}`, 'data-id': n.id, style: `left:${n.x}px;top:${n.y}px` },
      h('div', { class: 'nh' }, h('div', { class: 'ov' }, t.ov), h('div', { class: 'tt', text: t.tt }),
        probs.length ? h('span', { class: 'iss', text: probs.length, title: probs.join('\n') }) : null),
      rows, ps ? h('div', { class: 'nparams', text: ps.length > 90 ? ps.slice(0, 88) + '…' : ps }) : null);
    host.append(el);
  }
  measurePorts(); renderWires(); markPorts();
}
function measurePorts() {
  portPos.clear();
  for (const el of $$('#nodes .node')) {
    const n = nodeById(el.dataset.id);
    for (const p of $$('.port', el)) {
      const row = p.parentElement;
      portPos.set(`${n.id}|${p.dataset.dir}|${p.dataset.port}`, { dx: p.dataset.dir === 'in' ? 0 : el.offsetWidth, dy: row.offsetTop + row.offsetHeight / 2 });
    }
  }
}
function pp(nid, dir, port) { const n = nodeById(nid), o = portPos.get(`${nid}|${dir}|${port}`) || { dx: 0, dy: 20 }; return { x: n.x + o.dx, y: n.y + o.dy }; }
const curve = (a, b) => { const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5); return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`; };
function svg(tag, attrs) { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; }
function renderWires() {
  const g = $('#wires'); g.textContent = '';
  $$('.edge-x').forEach(x => x.remove());
  for (const e of S.edges) {
    const a = pp(e.from[0], 'out', e.from[1]), b = pp(e.to[0], 'in', e.to[1]), dpath = curve(a, b);
    const src = nodeById(e.from[0]), dst = nodeById(e.to[0]);
    const ty = outTypes(src, e.from[1]), inp = def(dst).inputs.find(i => i.name === e.to[1]);
    const bad = !inp || !accepts(inp, ty), sel = S.sel && S.sel.kind === 'edge' && S.sel.id === e.id;
    g.append(svg('path', { d: dpath, class: `w ${tClass(ty[0])}${bad ? ' badw' : ''}${sel ? ' sel' : ''}` }), svg('path', { d: dpath, class: 'hit', 'data-edge': e.id }));
    if (sel) $('#world').append(h('button', { class: 'edge-x', style: `left:${(a.x + b.x) / 2}px;top:${(a.y + b.y) / 2}px`, 'aria-label': 'Remove connection', title: 'Remove connection', 'data-del-edge': e.id, text: '×' }));
  }
  if (pend && pend.x != null) {
    const fixed = pp(pend.node, pend.dir, pend.port), free = { x: pend.x, y: pend.y };
    g.append(svg('path', { d: pend.dir === 'out' ? curve(fixed, free) : curve(free, fixed), class: 'pend' }));
  }
}
function markPorts() {
  for (const p of $$('#nodes .port')) {
    p.classList.remove('ok', 'no', 'src');
    if (!pend) continue;
    if (p.dataset.node === pend.node && p.dataset.port === pend.port && p.dataset.dir === pend.dir) { p.classList.add('src'); continue; }
    const ok = p.dataset.dir !== pend.dir && (pend.dir === 'out' ? !canConnect(pend.node, pend.port, p.dataset.node, p.dataset.port) : !canConnect(p.dataset.node, p.dataset.port, pend.node, pend.port));
    p.classList.add(ok ? 'ok' : 'no');
  }
  $('#hint').textContent = pend ? (pend.dir === 'out' ? 'Pick a highlighted input to connect this output. Tap empty space to cancel.' : 'Pick a highlighted output to feed this input. Tap empty space to cancel.') : '';
}
function finishWire(target) {
  if (!pend || !target || target.dataset.dir === pend.dir) return false;
  const ok = pend.dir === 'out' ? connect(pend.node, pend.port, target.dataset.node, target.dataset.port) : connect(target.dataset.node, target.dataset.port, pend.node, pend.port);
  if (ok) { pend = null; commit(); renderAll(); }
  return ok;
}

/* ---------- canvas interaction ---------- */
function setupCanvas() {
  const cv = $('#canvas'), pts = new Map();
  let drag = null; // {kind:'node'|'pan'|'wire'|'pinch', ...}
  cv.addEventListener('pointerdown', ev => {
    if (ev.button > 0) return;
    const t = ev.target;
    if (t.closest('[data-del-edge]')) return;
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pts.size === 2) { const [a, b] = [...pts.values()]; drag = { kind: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; return; }
    cv.setPointerCapture(ev.pointerId);
    const port = t.closest('.port'), nodeEl = t.closest('.node'), hit = t.closest('.hit');
    if (port) {
      if (pend && pend.armed && port.dataset.dir !== pend.dir) { finishWire(port); drag = null; return; }
      const w = toWorld(ev.clientX, ev.clientY);
      pend = { node: port.dataset.node, port: port.dataset.port, dir: port.dataset.dir, x: w.x, y: w.y, armed: false };
      drag = { kind: 'wire', sx: ev.clientX, sy: ev.clientY, moved: false }; markPorts(); renderWires();
    } else if (nodeEl) {
      const n = nodeById(nodeEl.dataset.id);
      if (pend) { pend = null; markPorts(); }
      drag = { kind: 'node', n, el: nodeEl, sx: ev.clientX, sy: ev.clientY, ox: n.x, oy: n.y, moved: false };
    } else if (hit) {
      S.sel = { kind: 'edge', id: hit.dataset.edge }; S.peek = null; drag = null; renderAll();
    } else {
      drag = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, ox: S.view.x, oy: S.view.y, moved: false }; cv.classList.add('panning');
    }
  });
  cv.addEventListener('pointermove', ev => {
    if (pts.has(ev.pointerId)) pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (!drag) { if (pend && pend.armed) { const w = toWorld(ev.clientX, ev.clientY); pend.x = w.x; pend.y = w.y; renderWires(); } return; }
    if (drag.kind === 'pinch' && pts.size === 2) {
      const [a, b] = [...pts.values()], dist = Math.hypot(a.x - b.x, a.y - b.y), r = cv.getBoundingClientRect();
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      S.view.x += cx - drag.cx; S.view.y += cy - drag.cy;
      zoomAt(cx - r.left, cy - r.top, dist / drag.d); drag.d = dist; drag.cx = cx; drag.cy = cy; return;
    }
    const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    if (drag.kind === 'node') { drag.n.x = Math.round(drag.ox + dx / S.view.k); drag.n.y = Math.round(drag.oy + dy / S.view.k); drag.el.style.left = drag.n.x + 'px'; drag.el.style.top = drag.n.y + 'px'; renderWires(); }
    else if (drag.kind === 'pan') { S.view.x = drag.ox + dx; S.view.y = drag.oy + dy; applyView(); }
    else if (drag.kind === 'wire') { const w = toWorld(ev.clientX, ev.clientY); pend.x = w.x; pend.y = w.y; renderWires(); }
  });
  const up = ev => {
    pts.delete(ev.pointerId);
    cv.classList.remove('panning');
    const d = drag; drag = null;
    if (!d || d.kind === 'pinch') return;
    if (d.kind === 'node') {
      if (d.moved) { commit(); }
      S.sel = { kind: 'node', id: d.n.id }; S.peek = null; renderAll();
    } else if (d.kind === 'pan') {
      if (!d.moved) { const had = S.sel || pend || S.peek; pend = null; S.sel = null; if (had) renderAll(); }
    } else if (d.kind === 'wire') {
      if (!d.moved) { pend.armed = true; pend.x = null; renderWires(); return; }
      const under = document.elementFromPoint(ev.clientX, ev.clientY), port = under && under.closest('.port');
      if (!(port && finishWire(port))) { pend = null; markPorts(); renderWires(); }
    }
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('click', ev => { const b = ev.target.closest('[data-del-edge]'); if (b) { S.edges = S.edges.filter(e => e.id !== b.dataset.delEdge); S.sel = null; commit(); renderAll(); } });
  cv.addEventListener('wheel', ev => {
    ev.preventDefault();
    const r = cv.getBoundingClientRect();
    const mouseWheel = ev.deltaMode !== 0 || (ev.deltaX === 0 && Math.abs(ev.deltaY) >= 50 && Number.isInteger(ev.deltaY));
    if (ev.ctrlKey || mouseWheel) zoomAt(ev.clientX - r.left, ev.clientY - r.top, Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015)));
    else { S.view.x -= ev.deltaX; S.view.y -= ev.deltaY; applyView(); }
  }, { passive: false });
}

/* ---------- catalog ---------- */
const openGroups = new Set(['Sources', 'Load', 'Helpers', 'wk:Wind climates']);
function matches(d, q, tf) {
  if (tf) {
    const [dir, ty] = tf.split(':');
    // Accepts T: an input that T can be wired into. Returns T: an output that is a T or a more specific type.
    if (dir === 'in' ? !d.inputs.some(p => !p.types.includes('*') && isA(ty, p.types)) : !d.outputs.some(p => p.types.some(t => isA(t, [ty])))) return false;
  }
  if (!q) return true;
  const hay = (d.id + ' ' + d.summary + ' ' + d.group + ' ' + (d.params || []).join(' ') + ' ' + d.doc).toLowerCase();
  return q.split(/\s+/).every(w => hay.includes(w));
}
const libOn = d => { const l = libOf(d); return !l || S.libs.includes(l); };
function renderCatalog() {
  const q = $('#q').value.trim().toLowerCase(), tf = $('#tf').value, list = $('#catList');
  list.textContent = '';
  let shown = 0, total = 0, groups = 0;
  const sections = [[null, COMMON_GROUPS], ...S.libs.map(l => [l, l === 'bw' ? BW_GROUPS : WK_GROUPS])];
  for (const [lib, gs] of sections) {
    const all = Object.values(DEFS).filter(d => libOn(d) && (lib ? libOf(d) === lib && !COMMON_GROUPS.includes(d.group) : COMMON_GROUPS.includes(d.group)));
    total += all.length;
    let head = lib && S.libs.length > 1 ? h('div', { class: 'lib-head lib-' + lib }, LIBS[lib].name, h('span', { class: 'n', text: 'v' + (lib === 'bw' ? CAT.version : WKCAT.version) })) : null;
    for (const g of gs) {
      const items = all.filter(d => d.group === g && matches(d, q, tf)).sort((a, b) => groupRank(a) - groupRank(b));
      if (!items.length) continue;
      if (head) { list.append(head); head = null; }
      shown += items.length; groups++;
      const key = (lib === 'wk' ? 'wk:' : '') + g;
      const det = h('details', { class: 'grp', open: q || tf ? true : openGroups.has(key) }, h('summary', {}, g, h('span', { class: 'n', text: items.length })));
      det.addEventListener('toggle', () => { if (!$('#q').value && !$('#tf').value) det.open ? openGroups.add(key) : openGroups.delete(key); });
      for (const d of items) {
        det.append(h('button', { class: 'item' + (S.peek === d.id ? ' on' : '') + (d.status === 'not_implemented' ? ' off' : ''), 'data-def': d.id },
          h('div', { class: 'nm' }, shortId(d), d.status === 'deprecated' ? h('span', { class: 'flag warn', text: 'deprecated' }) : null, d.status === 'not_implemented' ? h('span', { class: 'flag bad', text: 'not implemented' }) : null,
            d.blocked ? h('span', { class: 'flag', text: 'internet', title: d.note }) : d.net ? h('span', { class: 'flag', text: 'downloads', title: d.note }) : null, d.plotly ? h('span', { class: 'flag', text: 'interactive' }) : null),
          h('div', { class: 'sm', text: d.summary })));
      }
      list.append(det);
    }
  }
  $('#catCount').textContent = shown === total ? `${total} tools in ${groups} groups. Drag one onto the board.` : `${shown} of ${total} tools`;
}
const TF_TYPES = { bw: ['DataFrame', 'Series', 'Figure', 'Path', 'Value', 'List', 'Dict', 'Station'],
  wk: ['TSWC', 'BWC', 'WWC', 'GWC', 'Locations', 'BBox', 'RasterMap', 'VectorMap', 'WTG', 'WindTurbines', 'Dataset', 'DataArray', 'GeoDataFrame', 'Plotly'] };
function fillTypeFilter() {
  const sel = $('#tf'), cur = sel.value; sel.textContent = '';
  sel.append(h('option', { value: '', text: 'Any data type' }));
  const ts = [...new Set(S.libs.flatMap(l => l === 'wk' ? ['DataFrame', 'Series', 'Figure', 'Path', 'Value', ...TF_TYPES.wk] : TF_TYPES.bw))];
  for (const [dir, lab] of [['in', 'Accepts'], ['out', 'Returns']]) for (const t of ts) sel.append(h('option', { value: `${dir}:${t}`, text: `${lab} ${tLabel(t)}` }));
  sel.value = [...sel.options].some(o => o.value === cur) ? cur : '';
}
function setupCatalog() {
  const sel = $('#tf');
  fillTypeFilter();
  $('#q').addEventListener('input', renderCatalog); sel.addEventListener('change', renderCatalog);
  const list = $('#catList');
  let dg = null;
  list.addEventListener('pointerdown', ev => { const it = ev.target.closest('.item'); if (!it || ev.pointerType === 'touch') return; dg = { id: it.dataset.def, sx: ev.clientX, sy: ev.clientY, ghost: null }; });
  window.addEventListener('pointermove', ev => {
    if (!dg) return;
    if (!dg.ghost && Math.abs(ev.clientX - dg.sx) + Math.abs(ev.clientY - dg.sy) > 6) { dg.ghost = h('div', { class: 'ghost-drag', text: dg.id }); document.body.append(dg.ghost); }
    if (dg.ghost) { dg.ghost.style.left = ev.clientX + 10 + 'px'; dg.ghost.style.top = ev.clientY + 8 + 'px'; ev.preventDefault(); }
  });
  window.addEventListener('pointerup', ev => {
    if (!dg) return;
    const d = dg; dg = null;
    if (!d.ghost) return;
    d.ghost.remove(); d.dropped = true; list.dataset.justDragged = '1'; setTimeout(() => delete list.dataset.justDragged, 0);
    const r = $('#canvas').getBoundingClientRect();
    if (document.body.dataset.view === 'canvas' && ev.clientX > r.left && ev.clientX < r.right && ev.clientY > r.top && ev.clientY < r.bottom) {
      const w = toWorld(ev.clientX, ev.clientY), n = addNode(d.id, w.x - 118, w.y - 20);
      if (n) { S.sel = { kind: 'node', id: n.id }; S.peek = null; commit(); renderAll(); }
    }
  });
  list.addEventListener('click', ev => { const it = ev.target.closest('.item'); if (!it || list.dataset.justDragged) return; S.peek = it.dataset.def; S.sel = null; renderAll(); if (isNarrow()) setView('details'); });
}
function addAtCentre(id) {
  const r = $('#canvas').getBoundingClientRect();
  if (!S.nodes.length) { S.view = { x: 30, y: 90, k: isNarrow() ? 0.85 : 1 }; applyView(); }
  let pos = S.nodes.length === 0 ? { x: 0, y: 0 } : r.width ? toWorld(r.left + r.width / 2 - 118 * S.view.k, r.top + r.height / 2 - 60 * S.view.k) : { x: 0, y: 0 };
  const hits = p => S.nodes.some(n => Math.abs(n.x - p.x) < 250 && p.y < n.y + nodeHeight(n) + 14 && n.y < p.y + 120);
  if (hits(pos) && S.nodes.length) { const last = S.nodes[S.nodes.length - 1]; pos = { x: last.x + 290, y: last.y }; while (hits(pos)) pos.y += 60; }
  const n = addNode(id, pos.x, pos.y);
  if (n && r.width) { // keep the new node in view
    const sx = n.x * S.view.k + S.view.x, sy = n.y * S.view.k + S.view.y, w = 236 * S.view.k;
    if (sx < 8 || sx + w > r.width - 8) S.view.x += r.width / 2 - (sx + w / 2);
    if (sy < 50 || sy + 120 * S.view.k > r.height - 60) S.view.y += r.height / 2 - (sy + 60 * S.view.k);
    applyView();
  }
  return n;
}

/* ---------- inspector ---------- */
const srcUrl = d => d.lib === 'wk' ? WKCAT.docs : d.module ? `${CAT.repo}/blob/${CAT.commit}/brightwind/${d.module}#L${d.line}` : null;
function signature(d) {
  if (d.kind === 'helper') return null;
  if (d.kind === 'attr') return `<${d.inputs[0].name}>.${d.call}`;
  const ps = (d.params || []).map(p => { const x = d.inputs.find(i => i.name === p) || d.fields.find(f => f.name === p); return x.required ? p : `${p}=${x.default}`; });
  if (d.kwargs) ps.push('**' + d.kwargs);
  return `${d.kind === 'method' ? '<' + d.inputs[0].name + '>.' + d.call : d.call}(${ps.join(', ')})`;
}
function docBlock(d) {
  const url = srcUrl(d);
  return h('div', { class: 'sec' }, h('h3', {}, 'Documentation'),
    d.note ? h('p', { class: 'note' + (d.status === 'not_implemented' ? ' bad' : ''), text: d.note, style: 'margin-bottom:8px' }) : null,
    d.doc && d.doc !== d.summary ? h('details', {}, h('summary', { style: 'cursor:pointer;margin-bottom:6px' }, 'Full docstring'), h('pre', { class: 'doc', text: d.doc })) : null,
    url && d.lib === 'wk' ? h('p', { style: 'margin-top:6px' }, `Source: ${d.module}, line ${d.line} · `, h('a', { href: url, target: '_blank', rel: 'noopener' }, 'windkit documentation')) :
    url ? h('p', { style: 'margin-top:6px' }, h('a', { href: url, target: '_blank', rel: 'noopener' }, `Source: brightwind/${d.module}, line ${d.line}`)) : null);
}
function nextSteps(types, limit = 8) {
  // tools that take this type at a specific input (not one that accepts anything or any Dataset)
  const GENERIC = ['Dataset', 'DataArray', 'GeoDataFrame', 'Locations'];
  const specific = i => !i.types.includes('*') && !i.self && types.some(t => i.types.some(x => anc(t).includes(x) && (x === t || !GENERIC.includes(x))));
  return Object.values(DEFS).filter(d => libOn(d) && d.status !== 'not_implemented' && !d.blocked && d.inputs.some(i => specific(i) || (i.self && types.some(t => isA(t, i.types)))))
    .sort((a, b) => (a.kind === 'helper' ? -1 : 0) - (b.kind === 'helper' ? -1 : 0) || (a.inputs.some(i => i.self) ? -1 : 0) - (b.inputs.some(i => i.self) ? -1 : 0) || groupRank(a) - groupRank(b));
}
function headBlock(d) {
  const sig = signature(d);
  return [h('div', {}, h('div', { class: 'ov' }, (d.lib === 'wk' ? 'windkit · ' : '') + d.group, h('span', { class: 'flag', text: d.kind === 'attr' ? 'attribute' : d.kind }),
      d.status === 'deprecated' ? h('span', { class: 'flag warn', text: 'deprecated' }) : null, d.status === 'not_implemented' ? h('span', { class: 'flag bad', text: 'not implemented' }) : null),
    h('h2', { text: d.lib === 'wk' ? d.id.replace(/^wk\./, 'windkit.') : d.id })), h('p', { class: 'lead', text: d.summary }), sig ? h('div', { class: 'sig', text: sig }) : null];
}
function renderDetails() {
  const box = $('#details'); box.textContent = '';
  const ins = h('div', { class: 'ins' }); box.append(ins);
  const n = S.sel && S.sel.kind === 'node' ? nodeById(S.sel.id) : null;
  if (S.peek && DEFS[S.peek] && !n) {
    const d = DEFS[S.peek];
    ins.append(...headBlock(d),
      h('div', { class: 'acts' }, h('button', { class: 'btn primary', disabled: d.status === 'not_implemented', onclick: () => { const nn = addAtCentre(d.id); if (nn) { S.sel = { kind: 'node', id: nn.id }; S.peek = null; commit(); renderAll(); if (isNarrow()) setView('canvas'); } } }, 'Add to canvas')),
      d.inputs.length ? h('div', { class: 'sec' }, h('h3', {}, 'Inputs to wire'), ...d.inputs.map(i => h('div', { class: 'fld' }, h('div', { class: 'lb' }, h('span', { class: 'k', text: i.name + (i.required ? ' *' : '') }), ...i.types.map(typeChip)), i.doc ? h('div', { class: 'dc', text: i.doc }) : null))) : null,
      d.fields.length ? h('div', { class: 'sec' }, h('h3', {}, 'Parameters'), ...d.fields.map(f => h('div', { class: 'fld' }, h('div', { class: 'lb' }, h('span', { class: 'k', text: f.name + (f.required ? ' *' : '') }), f.default != null ? h('span', { class: 'tt', text: '= ' + f.default }) : null), f.doc ? h('div', { class: 'dc', text: f.doc }) : null))) : null,
      d.outputs.length ? h('div', { class: 'sec' }, h('h3', {}, 'Outputs'), ...d.outputs.map(o => h('div', { class: 'fld' }, h('div', { class: 'lb' }, h('span', { class: 'k', text: o.name }), ...o.types.map(typeChip)), o.flag ? h('div', { class: 'dc', text: `Returned when ${o.flag}=True. Wiring this output switches it on.` }) : null))) : null,
      docBlock(d));
    return;
  }
  if (!n) {
    const e = S.sel && S.sel.kind === 'edge' ? S.edges.find(x => x.id === S.sel.id) : null;
    if (e) ins.append(h('div', {}, h('div', { class: 'ov' }, 'Connection'), h('h2', { text: `${def(nodeById(e.from[0])).title} · ${e.from[1]} → ${def(nodeById(e.to[0])).title} · ${e.to[1]}` })),
      h('div', { class: 'acts' }, h('button', { class: 'btn danger', onclick: () => { S.edges = S.edges.filter(x => x.id !== e.id); S.sel = null; commit(); renderAll(); } }, 'Remove connection')));
    else {
      const all = S.nodes.map(x => [x, nodeIssues(x)]).filter(([, p]) => p.length);
      ins.append(h('div', {}, h('div', { class: 'ov' }, 'Pipeline'), h('h2', { text: `${S.nodes.length} nodes, ${S.edges.length} connections` })),
        h('p', { class: 'lead' }, 'Select a node to set its parameters, or a tool in the list to read its documentation. Ports only connect when their data types match. ', h('a', { href: 'guide.html', target: '_blank', rel: 'noopener' }, 'Read the guide')),
        all.length ? h('div', { class: 'sec' }, h('h3', {}, 'To fix before exporting'), h('ul', { class: 'issues' }, ...all.map(([x, p]) => h('li', {}, h('a', { href: '#canvas', onclick: ev => { ev.preventDefault(); S.sel = { kind: 'node', id: x.id }; renderAll(); } }, def(x).title), ': ' + p.join('; ')))))
          : (S.nodes.length ? h('p', { class: 'note', style: 'border-left-color:var(--good)' }, 'Every required input is set. Open Python to export the pipeline.') : null),
        h('div', { class: 'sec' }, h('h3', {}, 'Port colours'), h('div', { class: 'legend' }, ...[...(S.libs.includes('bw') || !WKCAT ? TYPE_HELP : TYPE_HELP.filter(([t]) => t !== 'Shear.Average')), ...(S.libs.includes('wk') ? WK_TYPE_HELP : [])].map(([t, txt]) => h('div', {}, t === 'Shear.Average' ? h('span', { class: 'ty c-obj', text: 'Object' }) : typeChip(t), h('span', {}, txt))))),
        h('div', { class: 'sec' }, h('h3', {}, 'About'), h('p', { class: 'dc', style: 'font-size:12.5px;color:var(--muted)' }, `The tool list is read from the brightwind v${CAT.version} source (MIT licence, commit ${CAT.commit.slice(0, 7)})${WKCAT ? ` and from windkit v${WKCAT.version} by DTU Wind Energy (BSD 3-Clause licence)` : ''}. Export the pipeline as Python, or press Run to execute it in this browser. Your data is never uploaded. `, h('a', { href: CAT.repo, target: '_blank', rel: 'noopener' }, 'brightwind repository'), ' · ', WKCAT ? h('a', { href: WKCAT.docs, target: '_blank', rel: 'noopener' }, 'windkit documentation') : null, WKCAT ? ' · ' : null, h('a', { href: 'guide.html', target: '_blank', rel: 'noopener' }, 'How to use'), ' · ', h('a', { href: 'https://coderenewables.com', target: '_blank', rel: 'noopener' }, 'CodeRenewables'), ' · ', h('a', { href: 'https://github.com/coderenewables/brightwind-explorer', target: '_blank', rel: 'noopener' }, 'Source of this page'))));
    }
    return;
  }
  const d = def(n), probs = nodeIssues(n), rerender = () => { commit(); renderCanvas(); renderStatus(); };
  ins.append(...headBlock(d));
  if (probs.length) ins.append(h('ul', { class: 'issues' }, ...probs.map(p => h('li', { text: p }))));
  ins.append(h('div', { class: 'acts' },
    h('button', { class: 'btn small', onclick: () => { const c = addNode(n.t, n.x + 30, n.y + 30, { v: { ...n.v }, lit: { ...n.lit }, args: { ...n.args }, var: n.var }); S.sel = { kind: 'node', id: c.id }; commit(); renderAll(); } }, 'Duplicate'),
    h('button', { class: 'btn small danger', onclick: () => { removeNode(n.id); commit(); renderAll(); } }, 'Delete node')));
  const hasVar = d.outputs.length && !d.inline && !d.mutates && d.kind !== 'attr' && !d.stmt;
  if (hasVar || d.isArg) ins.append(h('div', { class: 'sec' }, h('h3', {}, d.isArg ? 'Argument name in run()' : 'Variable name in the script'),
    h('input', { class: 'var', id: 'f-var', type: 'text', value: n.var || '', placeholder: d.var, 'aria-label': 'Variable name', oninput: ev => { n.var = ev.target.value.trim().replace(/[^A-Za-z0-9_]/g, '_') || undefined; }, onchange: rerender })));
  if (d.inputs.length) {
    const sec = h('div', { class: 'sec' }, h('h3', {}, 'Inputs'));
    for (const i of d.inputs) {
      const e = edgeInto(n.id, i.name), src = e && nodeById(e.from[0]);
      sec.append(h('div', { class: 'fld' },
        h('div', { class: 'lb' }, h('label', { for: 'p-' + i.name, text: i.name + (i.required ? ' *' : '') }), ...i.types.map(typeChip)),
        e ? h('div', { class: 'conn' }, h('span', { class: 'src', text: `from ${def(src).title} · ${e.from[1]}` }), h('button', { class: 'btn small', onclick: () => { S.edges = S.edges.filter(x => x.id !== e.id); commit(); renderAll(); } }, 'Disconnect'))
          : i.self ? h('div', { class: 'dc', text: 'Connect the object this is called on.' })
          : h('input', { type: 'text', id: 'p-' + i.name, class: i.required && !(n.lit[i.name] || '').trim() ? 'miss' : '', value: n.lit[i.name] || '', placeholder: i.default != null ? `not connected: uses ${i.default}` : 'connect a port, or type a Python value',
              oninput: ev => { n.lit[i.name] = ev.target.value; ev.target.classList.toggle('miss', i.required && !ev.target.value.trim()); }, onchange: rerender }),
        i.doc ? h('div', { class: 'dc clamp', text: i.doc, onclick: ev => ev.target.classList.toggle('clamp') }) : null));
    }
    ins.append(sec);
  }
  if (d.fields.length || d.kwargs) {
    const sec = h('div', { class: 'sec' }, h('h3', {}, 'Parameters'));
    for (const f of d.fields) {
      const id = 'f-' + f.name; let ctl;
      if (f.mode === 'bool') {
        const forced = f.flag && d.outputs.some(o => o.flag === f.name && edgesFrom(n.id, o.name).length);
        const cur = forced ? true : n.v[f.name] == null ? f.default === 'True' : !!n.v[f.name];
        ctl = h('label', { class: 'chk' }, h('input', { type: 'checkbox', id, checked: cur, disabled: forced, onchange: ev => { n.v[f.name] = ev.target.checked; rerender(); renderDetails(); } }), forced ? 'On, because its output is connected' : `Default ${f.default}`);
      } else if (f.mode === 'choice') {
        const extra = f.quoted && !f.required && !f.choices.includes(unq(f.default)) ? [h('option', { value: '', text: `default (${f.default})`, selected: !n.v[f.name] })] : [];
        ctl = h('select', { id, onchange: ev => { n.v[f.name] = ev.target.value; if (d.outputs.some(o => o.typesFrom === f.name)) S.edges = S.edges.filter(e => !(e.from[0] === n.id && canConnectExisting(e))); commit(); renderAll(); } }, ...extra, ...f.choices.map(c => h('option', { value: c, text: c, selected: (n.v[f.name] ?? f.default) === c })));
      } else {
        const ph = f.mode === 'text' ? (f.default && f.default !== 'None' ? f.default.replace(/^'|'$/g, '') : 'text, no quotes needed') : f.mode === 'list' ? 'Spd80mN, Spd60mN' : f.mode === 'code' ? '{a} - {b}' : (f.default ?? 'Python value');
        ctl = h('input', { type: 'text', id, class: f.required && !String(n.v[f.name] ?? '').trim() ? 'miss' : '', value: n.v[f.name] ?? '', placeholder: ph,
          oninput: ev => { n.v[f.name] = ev.target.value; ev.target.classList.toggle('miss', !!f.required && !ev.target.value.trim()); }, onchange: rerender });
      }
      const canArg = d.kind !== 'helper' && !f.flag;
      sec.append(h('div', { class: 'fld' },
        h('div', { class: 'lb' }, h('label', { for: id, text: f.name + (f.required ? ' *' : '') }), f.typeText ? h('span', { class: 'tt', text: f.typeText.length > 46 ? f.typeText.slice(0, 44) + '…' : f.typeText }) : null),
        ctl,
        f.mode === 'text' && d.kind !== 'helper' ? h('div', { class: 'tt', text: 'Plain text is quoted for you. Start with = to pass a Python expression.' }) : null,
        f.doc ? h('div', { class: 'dc clamp', text: f.doc, onclick: ev => ev.target.classList.toggle('clamp') }) : null,
        canArg ? h('label', { class: 'chk' }, h('input', { type: 'checkbox', id: 'a-' + f.name, checked: !!n.args[f.name], onchange: ev => { n.args[f.name] = ev.target.checked; commit(); } }), 'Make this an argument of run()') : null));
    }
    if (d.kwargs) sec.append(h('div', { class: 'fld' }, h('div', { class: 'lb' }, h('label', { for: 'f-kw', text: '**' + d.kwargs })),
      h('input', { type: 'text', id: 'f-kw', value: n.v.__kwargs || '', placeholder: 'extra keyword arguments, e.g. skiprows=2', oninput: ev => { n.v.__kwargs = ev.target.value; }, onchange: rerender })));
    ins.append(sec);
  }
  if (d.outputs.length) {
    const sec = h('div', { class: 'sec' }, h('h3', {}, 'Outputs and next steps'));
    for (const o of d.outputs) {
      const ty = outTypes(n, o.name), opts = nextSteps(ty), box2 = h('div', { class: 'next' });
      const fill = all => { box2.textContent = ''; for (const t of all ? opts : opts.slice(0, 8)) box2.append(h('button', { title: t.summary, onclick: () => {
          const nn = addNode(t.id, n.x + 300, n.y + edgesFrom(n.id).length * 70); if (!nn) return;
          const inp = t.inputs.find(i => !i.types.includes('*') && ty.some(x => isA(x, i.types)));
          connect(n.id, o.name, nn.id, inp.name); S.sel = { kind: 'node', id: nn.id }; commit(); renderAll(); if (isNarrow()) setView('canvas'); } }, shortId(t)));
        if (!all && opts.length > 8) box2.append(h('button', { onclick: () => fill(true) }, `+${opts.length - 8} more`)); };
      fill(false);
      sec.append(h('div', { class: 'fld' }, h('div', { class: 'lb' }, h('span', { class: 'k', text: o.name }), ...ty.map(typeChip)),
        o.flag ? h('div', { class: 'dc', text: `Returned when ${o.flag}=True. Wiring it switches that on.` }) : null,
        opts.length ? box2 : h('div', { class: 'dc', text: 'Use Print or Python expression to work with this value.' })));
    }
    ins.append(sec);
  }
  ins.append(docBlock(d));
}
function canConnectExisting(e) { const s = nodeById(e.from[0]), t = nodeById(e.to[0]); const inp = def(t).inputs.find(i => i.name === e.to[1]); return !accepts(inp, outTypes(s, e.from[1])); }

/* ---------- code view ---------- */
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function highlight(src) {
  return src.split('\n').map(line => {
    if (/^# %% \[/.test(line)) return `<span class="c cellmark">${esc(line)}</span>`;
    return esc(line).replace(/(#.*$)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|\b(import|as|def|return|if|None|True|False|pass|print)\b|\b((?:bw|wk)(?:\.\w+)+)/g,
      (m, c, s, k, f) => c ? `<span class="c">${c}</span>` : s ? `<span class="s">${s}</span>` : k ? `<span class="k">${k}</span>` : `<span class="f">${f}</span>`);
  }).join('\n');
}
let lastGen = null, dlMode = null;
function renderCode() {
  for (const b of $$('#codeView [data-fmt]')) b.setAttribute('aria-pressed', b.dataset.fmt === S.fmt);
  lastGen = generate(S.fmt);
  $('#codeOut').innerHTML = highlight(lastGen.preview);
  $('#codeIssues').textContent = lastGen.issues.length ? `${lastGen.issues.length} node${lastGen.issues.length > 1 ? 's' : ''} still need input (marked TODO below): ` + lastGen.issues.map(i => i.title).join(', ') : '';
  $('#copyBtn').textContent = S.fmt === 'nb' ? 'Copy .ipynb JSON' : 'Copy';
  const dlb = $('#dlBtn');
  dlb.textContent = dlMode === 'zip' ? 'Download all (.zip)' : 'Download ' + lastGen.filename.slice(lastGen.filename.lastIndexOf('.'));
  dlb.title = dlMode === 'zip' ? 'A zip with the script, the run() version and the notebook' : 'Save ' + lastGen.filename;
}
function renderStatus() {
  const bad = S.nodes.filter(n => nodeIssues(n).length).length, st = $('#status');
  st.className = 'status ' + (bad ? 'bad' : 'ok');
  st.textContent = !S.nodes.length ? 'Empty' : bad ? `${bad} to fix` : 'Ready to export';
  $('#undoBtn').disabled = hist.at <= 0; $('#redoBtn').disabled = hist.at >= hist.stack.length - 1;
}
function renderSelbar() {
  const bar = $('#selbar'), n = S.sel && S.sel.kind === 'node' ? nodeById(S.sel.id) : null;
  bar.textContent = ''; bar.hidden = !n;
  if (n) bar.append(h('span', { class: 'nm', text: def(n).title }), h('button', { class: 'btn small', onclick: () => setView('details') }, 'Details'), h('button', { class: 'btn small danger', onclick: () => { removeNode(n.id); commit(); renderAll(); } }, 'Delete'));
}
function renderAll() { renderCanvas(); renderDetails(); renderStatus(); renderSelbar(); if (document.body.dataset.view === 'run') renderRun(); $$('#catList .item').forEach(i => i.classList.toggle('on', i.dataset.def === S.peek)); if (document.body.dataset.view === 'code') renderCode(); }

/* ---------- views, dialogs ---------- */
const isNarrow = () => window.matchMedia('(max-width: 899px)').matches;
function setView(v, fromHash) {
  if (!isNarrow() && (v === 'tools' || v === 'details')) v = 'canvas';
  document.body.dataset.view = v;
  $('#vCanvas').setAttribute('aria-pressed', v === 'canvas' || v === 'tools' || v === 'details'); $('#vCode').setAttribute('aria-pressed', v === 'code'); $('#vRun').setAttribute('aria-pressed', v === 'run');
  for (const b of $$('.tabs button')) b.setAttribute('aria-pressed', b.dataset.tab === v);
  if (v === 'code') renderCode();
  if (v === 'run') renderRun();
  if (v === 'canvas') { measurePorts(); renderWires(); }
  if (!fromHash) { try { history.replaceState(null, '', '#' + v); } catch (e) { location.hash = v; } }
}
let toastT = null;
function toast(msg) { $$('.toast').forEach(t => t.remove()); const t = h('div', { class: 'toast', role: 'status', text: msg }); document.body.append(t); clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 4200); }
function dialog(title, build) {
  const scrim = h('div', { class: 'scrim' }), close = () => scrim.remove();
  const dlg = h('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', { text: title }));
  build(dlg, close); scrim.append(dlg); scrim.addEventListener('pointerdown', ev => { if (ev.target === scrim) close(); }); document.body.append(scrim);
  (dlg.querySelector('textarea, button') || dlg).focus();
}
async function copyText(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch (e) { dialog('Copy this text', (d, close) => { const ta = h('textarea', { readonly: true, id: 'copy-ta' }); ta.value = text; d.append(h('p', { text: 'Clipboard access was refused. Select all of the text below and copy it.' }), ta, h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: close }, 'Close'))); setTimeout(() => ta.select(), 0); }); }
}

/* ---------- templates ---------- */
const TEMPLATES = [
  { name: 'Site overview: stats, monthly means, tab file', libs: ['bw'],
    nodes: [['src', 'Demo dataset', { dataset: 'demo_data' }], ['load', 'load_csv'], ['stats', 'basic_stats'], ['spd', 'Select column', { column: 'Spd80mN' }], ['dir', 'Select column', { column: 'Dir78mS' }],
      ['mm', 'monthly_means'], ['ft', 'freq_table'], ['tab', 'export_tab_file', { height: '80', file_name: 'demo_site_80m' }, { lit: { lat: '53.0', long: '-7.5' } }]],
    edges: ['src.path>load.filepath_or_folder', 'load.data>stats.data', 'load.data>spd.data', 'load.data>dir.data', 'spd.series>mm.data', 'spd.series>ft.var_series', 'dir.series>ft.direction_series', 'ft.data>tab.freq_tab'] },
  { name: 'Clean the data, then shear to hub height', libs: ['bw'],
    nodes: [['src', 'Demo dataset', { dataset: 'demo_data' }], ['load', 'load_csv'], ['cf', 'Demo dataset', { dataset: 'demo_cleaning_file' }], ['clean', 'apply_cleaning'],
      ['anems', 'Select columns', { columns: 'Spd80mN, Spd60mN, Spd40mN' }], ['shear', 'Shear.Average', { heights: '[80, 60, 40]' }], ['alpha', 'Shear.Average.alpha'], ['pr', 'Print'],
      ['top', 'Select column', { column: 'Spd80mN' }], ['apply', 'Shear.Average.apply', { height: '80', shear_to: '120' }, { var: 'wspd_120m' }], ['mm', 'monthly_means']],
    edges: ['src.path>load.filepath_or_folder', 'load.data>clean.data', 'cf.path>clean.cleaning_file_or_df', 'clean.data>anems.data', 'anems.data>shear.wspds', 'shear.shear>alpha.shear', 'alpha.alpha>pr.value',
      'clean.data>top.data', 'shear.shear>apply.shear', 'top.series>apply.wspds', 'apply.wspd>mm.data'] },
  { name: 'Long-term correlation against MERRA-2', libs: ['bw'],
    nodes: [['src', 'Demo dataset', { dataset: 'demo_data' }], ['load', 'load_csv'], ['msrc', 'Demo dataset', { dataset: 'demo_merra2_NE' }], ['mload', 'load_csv', {}, { var: 'm2_ne' }],
      ['tgt', 'Select column', { column: 'Spd80mN' }], ['ref', 'Select column', { column: 'WS50m_m/s' }],
      ['ols', 'Correl.OrdinaryLeastSquares', { averaging_prd: '1M', coverage_threshold: '0.95' }], ['run', 'Correl.OrdinaryLeastSquares.run'], ['plot', 'Correl.OrdinaryLeastSquares.plot'],
      ['syn', 'Correl.OrdinaryLeastSquares.synthesize', {}, { var: 'long_term_wspd' }], ['momm', 'momm', {}, { var: 'long_term_momm' }]],
    edges: ['src.path>load.filepath_or_folder', 'msrc.path>mload.filepath_or_folder', 'load.data>tgt.data', 'mload.data>ref.data', 'ref.series>ols.ref_spd', 'tgt.series>ols.target_spd', 'ols.model>run.model',
      'run.model>plot.model', 'run.model>syn.model', 'syn.data>momm.data'] },
  { name: 'Turbulence intensity by speed, sector and time of day', libs: ['bw'],
    nodes: [['src', 'Demo dataset', { dataset: 'demo_data' }], ['load', 'load_csv'], ['spd', 'Select column', { column: 'Spd80mN' }], ['std', 'Select column', { column: 'Spd80mNStd' }], ['dir', 'Select column', { column: 'Dir78mS' }],
      ['bs', 'TI.by_speed'], ['bsec', 'TI.by_sector'], ['t24', 'TI.twelve_by_24'], ['csv', 'export_csv', { file_name: 'ti_by_speed' }]],
    edges: ['src.path>load.filepath_or_folder', 'load.data>spd.data', 'load.data>std.data', 'load.data>dir.data', 'spd.series>bs.wspd', 'std.series>bs.wspd_std', 'spd.series>bsec.wspd', 'std.series>bsec.wspd_std', 'dir.series>bsec.wdir',
      'spd.series>t24.wspd', 'std.series>t24.wspd_std', 'bs.data>csv.data'] },
  { name: 'windkit: wind climate at a site, Weibull fit and wind rose', libs: ['wk'],
    nodes: [['pt', 'wk.spatial.create_point', { west_east: '[480000.0]', south_north: '[5882200.0]', height: '[80.0]', crs: 'EPSG:32629' }, { var: 'site' }],
      ['ts', 'wk.create_tswc', { date_range: "pd.date_range('2021-01-01', '2022-01-01', freq='1h')" }], ['bwc', 'wk.bwc_from_tswc'], ['wwc', 'wk.weibull_fit'],
      ['rose', 'wk.plot.wind_rose', { wind_speed_bins: "'IEC_II'" }], ['hist', 'wk.plot.histogram', { style: 'combined' }],
      ['ws', 'wk.mean_wind_speed'], ['pd', 'wk.mean_power_density'], ['pws', 'Print'], ['ppd', 'Print']],
    edges: ['pt.point>ts.output_locs', 'ts.tswc>bwc.ts', 'bwc.bwc>wwc.bwc', 'bwc.bwc>rose.ds', 'bwc.bwc>hist.ds', 'wwc.wwc>ws.wc_obj', 'wwc.wwc>pd.wc_obj', 'ws.mean_wind_speed>pws.value', 'pd.mean_power_density>ppd.value'] },
  { name: 'windkit: read a .tab wind climate and a .wtg turbine', libs: ['wk'],
    nodes: [['tabf', 'Sample file', { file: 'demo_mast_80m.tab' }], ['bwc', 'wk.read_bwc'], ['wwc', 'wk.weibull_fit'], ['rose', 'wk.plot.wind_rose'], ['ws', 'wk.mean_wind_speed', { bysector: true }], ['pws', 'Print'],
      ['wtgf', 'Sample file', { file: 'demo_turbine_3MW.wtg' }], ['wtg', 'wk.read_wtg'], ['curves', 'wk.plot.power_ct_curves'], ['pw', 'wk.wtg_power', { ws: '[4.0, 8.0, 12.0, 16.0]' }], ['ppw', 'Print']],
    edges: ['tabf.path>bwc.filename', 'bwc.bwc>wwc.bwc', 'bwc.bwc>rose.ds', 'wwc.wwc>ws.wc_obj', 'ws.mean_wind_speed>pws.value', 'wtgf.path>wtg.wtg_file', 'wtg.wtg>curves.ds', 'wtg.wtg>pw.wtg', 'pw.power>ppw.value'] },
  { name: 'windkit: terrain and roughness maps', libs: ['wk'],
    nodes: [['tif', 'Sample file', { file: 'demo_elevation.tif' }], ['dem', 'wk.read_elevation_map', {}, { var: 'elevation' }], ['rplot', 'wk.plot.raster_plot', { plot_title: 'Elevation (m)' }],
      ['mapf', 'Sample file', { file: 'demo_elevation.map' }], ['lines', 'wk.read_elevation_map', {}, { var: 'contours' }], ['eplot', 'wk.plot.elevation_map'],
      ['rouf', 'Sample file', { file: 'demo_roughness.map' }], ['rou', 'wk.read_roughness_map'], ['lplot', 'wk.plot.landcover_map'], ['bbox', 'wk.spatial.BBox.from_ds'], ['pb', 'Print']],
    edges: ['tif.path>dem.filename', 'dem.elevation_map>rplot.da', 'mapf.path>lines.filename', 'lines.elevation_map>eplot.gdf', 'rouf.path>rou.filename', 'rou.roughness_map>lplot.gdf', 'dem.elevation_map>bbox.ds', 'bbox.bbox>pb.value'] },
  { name: 'windkit: long-term correction with linear regression MCP', libs: ['wk'],
    nodes: [['pt', 'wk.spatial.create_point', { west_east: '[480000.0]', south_north: '[5882200.0]', height: '[80.0]', crs: 'EPSG:32629' }, { var: 'site' }],
      ['pair', 'wk.create_tswc_pair', { date_range: "pd.date_range('2020-01-01', '2021-01-01', freq='1h')" }, { var: 'reference' }],
      ['mcp', 'wk.ltc.LinRegMCP'], ['fit', 'wk.ltc.LinRegMCP.fit'], ['pred', 'wk.ltc.LinRegMCP.predict', {}, { var: 'predicted' }],
      ['scores', 'wk.ltc.calc_scores', { name: 'linreg' }], ['ps', 'Print'], ['bwc', 'wk.bwc_from_tswc'], ['rose', 'wk.plot.wind_rose']],
    edges: ['pt.point>pair.output_locs', 'pair.tswc_1>fit.ds_ref', 'pair.tswc_2>fit.ds_target', 'mcp.model>fit.model', 'fit.model>pred.model', 'pair.tswc_1>pred.ds_ref',
      'pair.tswc_2>scores.ds_target', 'pred.tswc>scores.ds_pred', 'scores.scores>ps.value', 'pred.tswc>bwc.ts', 'bwc.bwc>rose.ds'] },
  { name: 'windkit: Serra Santa Luzia tutorial site (downloads 4.6 MB)', libs: ['wk'],
    nodes: [['tut', 'wk.load_tutorial_data'], ['rose', 'wk.plot.wind_rose', { wind_speed_bins: "'IEC_II'" }], ['wwc', 'wk.weibull_fit'], ['ws', 'wk.mean_wind_speed', { bysector: true }], ['pws', 'Print'],
      ['curves', 'wk.plot.power_ct_curves'], ['pt', 'Print'], ['emap', 'wk.plot.elevation_map']],
    edges: ['tut.bwc>rose.ds', 'tut.bwc>wwc.bwc', 'wwc.wwc>ws.wc_obj', 'ws.mean_wind_speed>pws.value', 'tut.wtg>curves.ds', 'tut.turbines>pt.value', 'tut.elev>emap.gdf'] },
  { name: 'brightwind + windkit: mast data to a WAsP .tab file', libs: ['bw', 'wk'],
    nodes: [['src', 'Demo dataset', { dataset: 'demo_data' }], ['load', 'load_csv'], ['cf', 'Demo dataset', { dataset: 'demo_cleaning_file' }], ['clean', 'apply_cleaning'],
      ['cols', 'Select columns', { columns: 'Spd80mN, Dir78mS' }],
      ['ts', 'wk.tswc_from_dataframe', { west_east: '-9.26877', south_north: '53.08896', crs: "'EPSG:4326'", height_to_columns: "{80.0: ('Spd80mN', 'Dir78mS')}" }, { var: 'tswc' }],
      ['bwc', 'wk.bwc_from_tswc'], ['tab', 'wk.bwc_to_file', { filename: 'mast_80m.tab' }], ['rose', 'wk.plot.wind_rose', { wind_speed_bins: "'IEC_II'" }],
      ['wwc', 'wk.weibull_fit'], ['pd', 'wk.mean_power_density', { bysector: true }], ['ppd', 'Print'], ['spd', 'Select column', { column: 'Spd80mN' }], ['mm', 'monthly_means']],
    edges: ['src.path>load.filepath_or_folder', 'load.data>clean.data', 'cf.path>clean.cleaning_file_or_df', 'clean.data>cols.data', 'cols.data>ts.pd_df', 'ts.tswc>bwc.ts', 'bwc.bwc>tab.bwc', 'bwc.bwc>rose.ds',
      'bwc.bwc>wwc.bwc', 'wwc.wwc>pd.wc_obj', 'pd.mean_power_density>ppd.value', 'clean.data>spd.data', 'spd.series>mm.data'] },
];
const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
function fillTemplates() {
  const sel = $('#tplSel'); sel.textContent = '';
  sel.append(h('option', { value: '', text: 'Examples…' }));
  TEMPLATES.forEach((t, i) => { if (t.libs.every(l => S.libs.includes(l))) sel.append(h('option', { value: i, text: t.name })); });
}
function loadTemplate(i) {
  const t = TEMPLATES[i];
  if (t.libs.some(l => !S.libs.includes(l))) setLibs([...S.libs, ...t.libs]);
  S.nodes = []; S.edges = []; S.sel = null; S.peek = null; pend = null;
  const ids = {};
  for (const [key, defId, v, extra] of t.nodes) ids[key] = addNode(defId, 0, 0, Object.assign({ v: { ...(v || {}) } }, extra || {})).id;
  for (const e of t.edges) { const [a, b] = e.split('>'), [an, ao] = a.split('.'), [bn, bi] = b.split('.'); if (!connect(ids[an], ao, ids[bn], bi)) console.warn('template edge failed', e); }
  measureAndTidy(); commit(); renderAll(); fit();
}
function measureAndTidy() { tidy(); }

/* ---------- libraries ---------- */
function setLibs(libs) {
  S.libs = ['bw', 'wk'].filter(l => libs.includes(l) && (l === 'bw' || WKCAT));
  if (!S.libs.length) S.libs = ['bw'];
  try { localStorage.setItem('bw-builder-libs', JSON.stringify(S.libs)); } catch (e) { /* storage unavailable */ }
  $('#ver').textContent = S.libs.map(l => l === 'bw' ? 'brightwind v' + CAT.version : 'windkit v' + WKCAT.version).join(' · ');
  document.body.dataset.libs = S.libs.join(' ');
  renderLibs(); fillTypeFilter(); fillTemplates(); renderCatalog();
  if (S.peek && DEFS[S.peek] && !libOn(DEFS[S.peek])) S.peek = null;
}
function libsInUse() { return new Set(S.nodes.map(n => libOf(def(n))).filter(Boolean)); }
function ensureLibs() { const need = [...libsInUse()].filter(l => !S.libs.includes(l)); if (need.length) setLibs([...S.libs, ...need]); }
function renderLibs() {
  const box = $('#libs'); if (!box) return; box.textContent = '';
  box.append(h('span', { class: 'lb', text: 'Libraries' }));
  for (const l of ['bw', 'wk']) {
    const on = S.libs.includes(l);
    box.append(h('button', { class: 'lib-btn lib-' + l, 'aria-pressed': String(on), disabled: l === 'wk' && !WKCAT,
      title: on ? `Hide the ${LIBS[l].name} tools` : `Show the ${LIBS[l].name} tools`,
      onclick: () => {
        if (on && S.libs.length === 1) { toast('Keep at least one library switched on.'); return; }
        if (on && libsInUse().has(l)) { toast(`The board uses ${LIBS[l].name} tools. Remove them first, or keep ${LIBS[l].name} on.`); return; }
        setLibs(on ? S.libs.filter(x => x !== l) : [...S.libs, l]); renderAll();
      } }, LIBS[l].name));
  }
  box.append(h('button', { class: 'lib-more', title: 'What each library is for', 'aria-label': 'Choose libraries', onclick: () => chooseLibs(false) }, '?'));
}
function chooseLibs(first) {
  dialog('What do you want to build with?', (d, close) => {
    const pick = libs => {
      setLibs(libs); close();
      if (first || !S.nodes.length) { const t = TEMPLATES.findIndex(x => sameSet(x.libs, S.libs)); if (t >= 0) loadTemplate(t); }
      renderAll();
    };
    const card = (libs, title, ver, text) => h('button', { class: 'lib-card' + (sameSet(libs, S.libs) && !first ? ' on' : ''), onclick: () => pick(libs) },
      h('strong', {}, title), ver ? h('span', { class: 'v', text: ver }) : null, h('span', { class: 'tx', text }));
    d.append(h('p', { text: 'Choose a library, or both. Only its tools appear in the list, and the board, export and Run use it. You can change this at any time with the Libraries buttons above the tool list.' }),
      h('div', { class: 'lib-choice' },
        card(['bw'], 'brightwind', 'v' + CAT.version, 'Measured wind data: load mast and lidar files, clean, shear, turbulence intensity, long-term correlation and export.'),
        WKCAT ? card(['wk'], 'windkit', 'v' + WKCAT.version + ' · DTU Wind Energy', 'Wind climates and maps: time series, binned and Weibull wind climates, terrain and roughness maps, turbines and WAsP files.') : null,
        WKCAT ? card(['bw', 'wk'], 'Both', '', 'Load and clean measurements with brightwind, then build windkit wind climates and WAsP files from them.') : null));
  });
}

/* ---------- zip (stored, no compression) ---------- */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zipStore(files) {
  const enc = new TextEncoder(), chunks = [], central = []; let off = 0;
  for (const [fname, text] of files) {
    const name = enc.encode(fname), data = enc.encode(text), crc = crc32(data);
    const lh = new Uint8Array(30 + name.length), lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true); lv.setUint16(10, 0, true); lv.setUint16(12, 0x21, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true); lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, off, true); ch.set(name, 46);
    chunks.push(lh, data); central.push(ch); off += lh.length + data.length;
  }
  const csize = central.reduce((a, c) => a + c.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, csize, true); ev.setUint32(16, off, true);
  const out = new Uint8Array(off + csize + 22); let p = 0; for (const c of [...chunks, ...central, end]) { out.set(c, p); p += c.length; }
  return out;
}

/* ---------- boot ---------- */
async function boot() {
  const [bwRes, wkRes] = await Promise.allSettled([fetch('catalog.json').then(r => r.json()), fetch('catalog-windkit.json').then(r => r.json())]);
  if (bwRes.status !== 'fulfilled') { $('#details').append(h('div', { class: 'ins' }, h('p', { class: 'note bad', text: 'The tool catalog (catalog.json) could not be loaded. Reload the page to try again.' }))); return; }
  CAT = bwRes.value;
  if (wkRes.status === 'fulfilled') { WKCAT = wkRes.value; TYPES = WKCAT.types; WK_GROUPS = WKCAT.groups.filter(g => !COMMON_GROUPS.includes(g)); }
  for (const d of [...helperDefs(CAT, WKCAT), ...CAT.nodes, ...(WKCAT ? WKCAT.nodes : [])]) DEFS[d.id] = d;
  let savedLibs = null;
  try { savedLibs = JSON.parse(localStorage.getItem('bw-builder-libs') || 'null'); } catch (e) { /* ignore */ }
  setupCatalog(); setupCanvas();
  setLibs(Array.isArray(savedLibs) ? savedLibs : ['bw']);

  let loaded = false;
  try { const saved = JSON.parse(localStorage.getItem('bw-builder-v1') || 'null');
    if (saved && saved.nodes && saved.nodes.length && saved.nodes.every(n => DEFS[n.t])) { S.nodes = saved.nodes; S.edges = saved.edges; S.seq = saved.seq; if (saved.view) S.view = saved.view; loaded = true; } } catch (e) { /* ignore */ }
  const startView = (location.hash || '').slice(1);
  setView(['canvas', 'code', 'run', 'tools', 'details'].includes(startView) ? startView : 'canvas', true);
  if (loaded) { ensureLibs(); commit(); applyView(); renderAll(); } else loadTemplate(TEMPLATES.findIndex(t => sameSet(t.libs, S.libs)));
  if (!Array.isArray(savedLibs) && WKCAT && window.self === window.top && !/[?&]nochooser\b/.test(location.search)) chooseLibs(!loaded);

  $('#tplSel').addEventListener('change', ev => { if (ev.target.value !== '') { loadTemplate(+ev.target.value); ev.target.value = ''; if (isNarrow()) setView('canvas'); } });
  $('#undoBtn').addEventListener('click', undo); $('#redoBtn').addEventListener('click', redo);
  $('#tidyBtn').addEventListener('click', () => { tidy(); commit(); renderAll(); fit(); });
  $('#fitBtn').addEventListener('click', fit);
  const mid = () => { const r = $('#canvas').getBoundingClientRect(); return [r.width / 2, r.height / 2]; };
  $('#zoomIn').addEventListener('click', () => zoomAt(...mid(), 1.25)); $('#zoomOut').addEventListener('click', () => zoomAt(...mid(), 0.8));
  $('#vCanvas').addEventListener('click', () => setView('canvas')); $('#vCode').addEventListener('click', () => setView('code')); $('#vRun').addEventListener('click', () => setView('run'));
  $('#runGo').addEventListener('click', runStart); $('#runStop').addEventListener('click', runStop); $('#codeRun').addEventListener('click', () => { setView('run'); runStart(); });
  for (const b of $$('.tabs button')) b.addEventListener('click', () => setView(b.dataset.tab));
  for (const b of $$('#codeView [data-fmt]')) b.addEventListener('click', () => { S.fmt = b.dataset.fmt; renderCode(); });
  $('#optShow').addEventListener('change', ev => { S.opts.show = ev.target.checked; renderCode(); });
  $('#optPrint').addEventListener('change', ev => { S.opts.print = ev.target.checked; renderCode(); });
  $('#copyBtn').addEventListener('click', () => copyText(lastGen.text, S.fmt === 'nb' ? 'Notebook JSON copied. Save it as a .ipynb file.' : 'Python copied.'));
  $('#clearBtn').addEventListener('click', () => { if (!S.nodes.length) return; dialog('Clear the canvas?', (d, close) => d.append(h('p', { text: 'This removes every node and connection. Undo brings them back.' }),
    h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: close }, 'Keep'), h('button', { class: 'btn danger', onclick: () => { S.nodes = []; S.edges = []; S.sel = null; commit(); renderAll(); close(); } }, 'Clear canvas')))); });
  $('#jsonBtn').addEventListener('click', () => dialog('Save or load a pipeline', (d, close) => {
    const ta = h('textarea', { id: 'json-ta', 'aria-label': 'Pipeline JSON' }); ta.value = JSON.stringify({ app: 'brightwind-workflow-builder', libs: S.libs, brightwind: CAT.version, ...(WKCAT ? { windkit: WKCAT.version } : {}), nodes: S.nodes, edges: S.edges, seq: S.seq });
    d.append(h('p', { text: 'This text is the whole pipeline. Copy it somewhere safe to keep it, or paste a saved one here and load it.' }), ta,
      h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: close }, 'Close'), h('button', { class: 'btn', onclick: () => copyText(ta.value, 'Pipeline copied.') }, 'Copy'),
        h('button', { class: 'btn primary', onclick: () => { try { const p = JSON.parse(ta.value); if (!Array.isArray(p.nodes) || !p.nodes.every(n => DEFS[n.t])) throw new Error('unknown tool');
          S.nodes = p.nodes; S.edges = (p.edges || []).filter(e => nodeById(e.from[0]) && nodeById(e.to[0])); S.seq = p.seq || 1000; S.sel = null; ensureLibs(); commit(); renderAll(); fit(); close(); }
          catch (e) { toast('That text is not a pipeline saved from this page.'); } } }, 'Load pasted pipeline'))); }));
  window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (['canvas', 'code', 'run', 'tools', 'details'].includes(v)) setView(v, true); });
  window.addEventListener('resize', () => { setView(document.body.dataset.view, true); });
  window.addEventListener('keydown', ev => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (ev.key === 'Escape') { if ($('.scrim')) $('.scrim').remove(); else if ($('#ai') && !$('#ai').hidden) aiOpen(false); else if (pend) { pend = null; markPorts(); renderWires(); } return; }
    if (typing) return;
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && S.sel) { if (S.sel.kind === 'node') removeNode(S.sel.id); else S.edges = S.edges.filter(e => e.id !== S.sel.id); S.sel = null; commit(); renderAll(); ev.preventDefault(); }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.shiftKey ? redo() : undo(); ev.preventDefault(); }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') { redo(); ev.preventDefault(); }
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measurePorts(); renderWires(); });

  // Download. Inside claude.ai the host only saves some file types, so the three exports go in one zip there.
  // On its own site the page downloads the selected format directly.
  const dl = $('#dlBtn');
  const bundle = () => zipStore(['flat', 'func', 'nb'].map(f => { const g = generate(f); return [g.filename, g.text]; }));
  if (window.self === window.top) {
    dl.hidden = false; dlMode = 'file';
    dl.addEventListener('click', () => {
      const a = h('a', { href: URL.createObjectURL(new Blob([lastGen.text], { type: 'text/plain' })), download: lastGen.filename });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
    renderCode();
  } else if (window.claude && typeof window.claude.use === 'function') {
    window.claude.use('downloads').then(dlc => { if (!dlc) return; dl.hidden = false; dlMode = 'zip'; renderCode();
      dl.addEventListener('click', async () => { try { await dlc.save({ filename: 'brightwind_workflow.zip', data: new Blob([bundle()]) }); }
        catch (e) { if (!e || e.code !== 'declined') toast('The file could not be saved here. Use Copy instead.'); } }); }).catch(() => {});
  }
  window.__bw = { RUN, get RUNMARKS() { return RUNMARKS; }, runStart, zipStore, S, DEFS, generate, loadTemplate, TEMPLATES, addNode, connect, canConnect, nodeIssues, renderAll, commit, tidy, fit, setLibs, chooseLibs, accepts, outTypes, isA, get WKCAT() { return WKCAT; } };
  if (typeof setupAssistant === 'function') setupAssistant();
}
boot();
