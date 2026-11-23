/* Runs brightwind and windkit in the browser with Pyodide, inside a Web Worker so the page stays responsive.
   Each library is loaded the first time a pipeline needs it, so a brightwind-only pipeline never downloads windkit.

   Messages in:  {type:'run', libs:['bw'|'wk'], plotly, steps:[{id, title, code, leaf:[[expr, type]]}], files:[{dir, name, buffer}], demos:[name], samples:[name]}
                 {type:'table', expr}           full CSV of a result, on request
                 {type:'netcdf', expr}          an xarray result as a netCDF file, on request
   Messages out: {type:'status', text}          progress while loading or running
                 {type:'ready', seconds, libs}
                 {type:'step', id, ok, seconds, stdout, outputs, error}
                 {type:'files', files:[{name, buffer}]}   files the pipeline wrote
                 {type:'done', ok, seconds}
                 {type:'table', expr, csv | error}
                 {type:'netcdf', expr, buffer | error}
                 {type:'fatal', error}
*/
'use strict';
const PYODIDE_VERSION = '0.29.5';
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const SITE = self.location.href.replace(/[^/]*$/, '');
const BASE_PACKAGES = ['numpy', 'pandas', 'scipy', 'matplotlib', 'requests', 'python-dateutil', 'six', 'packaging', 'micropip'];   // requests brings urllib3, which works in a worker
const LIBS = {
  bw: { name: 'brightwind 2.8.0', packages: ['jsonschema'], wheels: ['py/brightwind-2.8.0-py3-none-any.whl', 'py/colormap-1.3.0-py3-none-any.whl'] },
  // h5py is left out on purpose: loaded next to netCDF4 its HDF5 library clashes with netCDF4's, and windkit reads netCDF through netCDF4.
  wk: { name: 'windkit 2.2.0', packages: ['xarray', 'geopandas', 'shapely', 'rasterio', 'netcdf4', 'lxml', 'fiona', 'pyyaml', 'platformdirs', 'attrs'],
        wheels: ['py/windkit-2.2.0-py3-none-any.whl', 'py/rioxarray-0.20.0-py3-none-any.whl'], after: ['py/affine-3.0.1-py3-none-any.whl'] },
  plotly: { name: 'plotly 6.3.1', packages: ['narwhals'], wheels: ['py/plotly-6.3.1-py3-none-any.whl'] },
};

let py = null, ready = false, queue = Promise.resolve();
const loaded = new Set();
const status = text => self.postMessage({ type: 'status', text });

const SETUP = String.raw`
import os, sys, types, io, json, time, base64, pprint, traceback, warnings, shutil
os.environ['MPLBACKEND'] = 'Agg'
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.figure import Figure
from matplotlib.axes import Axes
import numpy as np
import pandas as pd

_bw_ns = {}
_bw_libs = []
_MAX_ROWS = 200

def _bw_imports():
    lines = ['import numpy as np', 'import pandas as pd', 'import matplotlib.pyplot as plt']
    if 'bw' in _bw_libs:
        lines.append('import brightwind as bw')
    if 'wk' in _bw_libs:
        lines += ['import xarray as xr', 'import windkit as wk']
    if 'plotly' in _bw_libs:
        lines.append('import plotly.subplots')
    return '\n'.join(lines)

def _bw_reset():
    _bw_ns.clear()
    _bw_ns['__name__'] = '__main__'
    exec(_bw_imports(), _bw_ns)
    plt.close('all')
    shutil.rmtree('/work', ignore_errors=True)
    os.makedirs('/work', exist_ok=True)
    os.chdir('/work')

def _bw_demo_paths(names):
    if 'bw' not in _bw_libs:
        return '[]'
    import brightwind as bw
    out = []
    for n in names:
        p = getattr(bw.demo_datasets, n, None)
        if isinstance(p, str) and not os.path.exists(p):
            out.append([n, p])
    return json.dumps(out)

def _bw_fig(fig, name):
    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=110, bbox_inches='tight', facecolor='white')
    return {'kind': 'figure', 'name': name, 'png': base64.b64encode(buf.getvalue()).decode()}

def _bw_fmt(x):
    if isinstance(x, float):
        return '' if x != x else f'{x:.6g}'
    return str(x)

def _bw_table(obj, name):
    head = obj.head(_MAX_ROWS)
    html = head.to_html(border=0, classes='df', float_format=_bw_fmt, max_cols=40, na_rep='')
    return {'kind': 'table', 'name': name, 'rows': int(obj.shape[0]), 'cols': int(obj.shape[1]), 'html': html}

def _bw_text(text, name, typename, kind='text'):
    if len(text) > 6000:
        text = text[:6000] + '\n...'
    return {'kind': kind, 'name': name, 'text': text, 'type': typename}

def _bw_render(obj, name, seen):
    if isinstance(obj, Axes):
        obj = obj.figure
    if isinstance(obj, Figure):
        seen.add(id(obj))
        return _bw_fig(obj, name)
    mod = type(obj).__module__ or ''
    if mod.startswith('plotly') and hasattr(obj, 'to_json'):
        spec = obj.to_json()
        if len(spec) < 4_000_000:
            return {'kind': 'plotly', 'name': name, 'json': spec}
        return _bw_text('An interactive figure too large to show here. Save it with Save interactive figure.', name, 'plotly Figure')
    if 'wk' in _bw_libs:
        import xarray as xr
        if isinstance(obj, (xr.Dataset, xr.DataArray)):
            with xr.set_options(display_width=96, display_max_rows=40):
                return _bw_text(repr(obj), name, type(obj).__name__, kind='xarray')
        try:
            import geopandas as gpd
            if isinstance(obj, gpd.GeoDataFrame):
                df = pd.DataFrame(obj.drop(columns=obj.geometry.name))
                df.insert(0, 'geometry', [f'{g.geom_type} ({len(g.coords) if hasattr(g, "coords") else len(getattr(g, "exterior", g).coords)} points)' if g is not None and not g.is_empty else '' for g in obj.geometry])
                r = _bw_table(df, name)
                r['note'] = f'GeoDataFrame, CRS {obj.crs.to_string() if obj.crs else "not set"}'
                return r
        except Exception:
            pass
    if isinstance(obj, pd.Series):
        obj = obj.to_frame()
    if isinstance(obj, pd.DataFrame):
        return _bw_table(obj, name)
    if obj is None:
        return None
    if isinstance(obj, dict):
        text = pprint.pformat(dict(obj), width=96, compact=True)
    elif mod.startswith('windkit') or isinstance(obj, np.ndarray):
        text = str(obj)
    else:
        text = pprint.pformat(obj, width=96, compact=True)
    return _bw_text(text, name, type(obj).__name__)

def _bw_hint(e):
    n = type(e).__name__
    if isinstance(e, KeyError):
        return 'No column, variable or key with that name. Names are case sensitive; check them against your data.'
    if isinstance(e, FileNotFoundError):
        return 'The file is not there. Choose it again under Your files.'
    if n == 'WindkitValidationError' or 'validate found' in str(e):
        return "The input does not have the structure this windkit tool expects. Check which tool made it, and its type on the board."
    if n in ('CRSError', 'WindkitError') and 'crs' in str(e).lower():
        return 'Check the coordinate reference system, for example EPSG:4326 for longitude and latitude or EPSG:32629 for UTM 29N.'
    return ''

def _bw_step(code, leaf_json):
    leaf = json.loads(leaf_json)
    out = io.StringIO()
    old = sys.stdout, sys.stderr
    sys.stdout = sys.stderr = out
    t0 = time.time()
    error = None
    try:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter('default')
            exec(compile(code, '<pipeline step>', 'exec'), _bw_ns)
        seen_msgs = set()
        for w in caught:
            msg = f'{w.category.__name__}: {w.message}'
            if msg not in seen_msgs:
                seen_msgs.add(msg)
                out.write(msg + '\n')
    except Exception as e:
        tb = traceback.extract_tb(e.__traceback__)
        frames = [f for f in tb if f.filename != '<pipeline step>' and ('brightwind' in f.filename or 'windkit' in f.filename)][-3:]
        where = ''.join(f'  {f.filename.split("site-packages/")[-1]}, line {f.lineno}, in {f.name}\n' for f in frames)
        error = {'message': f'{type(e).__name__}: {e}'[:2000], 'where': where, 'hint': _bw_hint(e)}
    finally:
        sys.stdout, sys.stderr = old
    outputs = []
    if error is None:
        seen = set()
        for expr, _type in leaf:
            try:
                obj = eval(expr, _bw_ns)
            except Exception:
                continue
            try:
                r = _bw_render(obj, expr, seen)
            except Exception as e:
                r = _bw_text(f'Could not display this result: {e}', expr, type(obj).__name__)
            if r:
                r['expr'] = expr
                outputs.append(r)
        for num in plt.get_fignums():
            fig = plt.figure(num)
            if id(fig) not in seen:
                outputs.append(_bw_fig(fig, 'figure'))
    plt.close('all')
    return json.dumps({'ok': error is None, 'seconds': round(time.time() - t0, 2), 'stdout': out.getvalue()[-8000:],
                       'outputs': outputs, 'error': error})

def _bw_csv(expr):
    obj = eval(expr, _bw_ns)
    if isinstance(obj, pd.Series):
        obj = obj.to_frame()
    if hasattr(obj, 'to_dataframe') and not isinstance(obj, pd.DataFrame):
        obj = obj.to_dataframe()
    return obj.to_csv()

def _bw_netcdf(expr):
    obj = eval(expr, _bw_ns)
    path = '/tmp/_result.nc'
    obj.to_netcdf(path)
    with open(path, 'rb') as f:
        data = f.read()
    os.remove(path)
    return data

def _bw_outputs():
    files = []
    for root, _, names in os.walk('/work'):
        for n in names:
            p = os.path.join(root, n)
            files.append(os.path.relpath(p, '/work'))
    return json.dumps(sorted(files))
`;

const IMPORT = {
  bw: `import sys, types, warnings
sys.modules.setdefault('gmaps', types.ModuleType('gmaps'))   # optional Google Maps plotting; no browser build
with warnings.catch_warnings():
    warnings.simplefilter('ignore')
    import brightwind`,
  wk: `import warnings
with warnings.catch_warnings():
    warnings.simplefilter('ignore')
    import windkit, xarray`,
  plotly: `import plotly.subplots, plotly.graph_objects`,
};

// windkit's downloads, adapted to a web page. requests works in this worker as it is (urllib3 2.5 sends
// browser requests from Pyodide), but a page can only read sites that allow it (CORS):
//  - tutorial data: windkit pings google.com first and then uses Zenodo's ?download=1 link, which do not
//    allow it; Zenodo's API link for the same file does.
//  - GWA map API (get_vector_map): does not allow it, so it goes through this site's relay (worker/index.js).
//  - The tutorial maps are read with engine='pyogrio', which Pyodide does not have; fiona reads them.
const WEB_ADAPTER = String.raw`
import re, sys, types, requests, pathlib
import geopandas as _gpd
import windkit.tutorial_data as _td
import windkit.integrations._gwa_map_api as _gwa

_td._check_internet_connection = lambda: None
_rec = re.search(r'records/(\d+)/files/', _td._ZENODO_BASE_URL).group(1)
def _download_tutorial_data(zip_path):
    _td._download_file(f'https://zenodo.org/api/records/{_rec}/files/{zip_path.name}/content', zip_path)
_td._download_tutorial_data = _download_tutorial_data

_relayed = types.ModuleType('requests')
_relayed.__dict__.update(requests.__dict__)
_relayed.get = lambda url, *a, **k: requests.get(url.replace('https://api.globalwindatlas.info/', _bw_site + 'relay/gwa/'), *a, **k)
_gwa.requests = _relayed

try:
    import pyogrio
except ImportError:
    _read_file = _gpd.read_file
    def _read_file_fiona(*a, engine=None, **k):
        return _read_file(*a, engine='fiona' if engine in (None, 'pyogrio') else engine, **k)
    _gpd.read_file = _read_file_fiona
`;

async function loadPackages(list, label) {
  status(`Loading ${label}…`);
  await py.loadPackage(list, { messageCallback: m => { if (/^Loading /.test(m)) status(m + '…'); }, errorCallback: () => {} });
}
async function installWheels(wheels, reinstall) {
  py.globals.set('_bw_wheels', py.toPy(wheels.map(w => SITE + w)));
  await py.runPythonAsync(`import micropip\nawait micropip.install(_bw_wheels, deps=False${reinstall ? ', reinstall=True' : ''})`);
}

// Load what a run needs and has not been loaded yet, so a brightwind run never downloads windkit's stack.
// Order matters: pyproj has to be loaded on its own before the GDAL and netCDF stacks (rasterio, fiona,
// netCDF4) or it crashes with "null function"; after numpy, pandas and matplotlib is fine.
async function ensure(need) {
  const t0 = performance.now();
  if (!py) {
    status('Downloading Python (Pyodide ' + PYODIDE_VERSION + ')…');
    importScripts(PYODIDE_URL + 'pyodide.js');
    py = await loadPyodide({ indexURL: PYODIDE_URL });
    await loadPackages(BASE_PACKAGES, 'numpy, pandas, scipy and matplotlib');
    await py.runPythonAsync(SETUP);
  }
  for (const lib of ['bw', 'wk', 'plotly']) {
    if (!need.includes(lib) || loaded.has(lib)) continue;
    const L = LIBS[lib];
    if (lib === 'wk') await loadPackages(['pyproj'], 'pyproj');
    await loadPackages(L.packages, L.name.split(' ')[0] + "'s dependencies");
    status(`Installing ${L.name}…`);
    await installWheels(L.wheels, false);
    if (L.after) await installWheels(L.after, true);   // affine 3, over the affine 2.4 that rasterio brings
    status(`Importing ${L.name.split(' ')[0]}…`);
    await py.runPythonAsync(IMPORT[lib]);
    if (lib === 'wk') { py.globals.set('_bw_site', SITE); await py.runPythonAsync(WEB_ADAPTER); }
    loaded.add(lib);
  }
  py.globals.set('_bw_libs_now', py.toPy([...loaded]));
  py.runPython('_bw_libs[:] = list(_bw_libs_now)');
  if (!ready || performance.now() - t0 > 500) self.postMessage({ type: 'ready', seconds: Math.round((performance.now() - t0) / 100) / 10, libs: [...loaded] });
  ready = true;
}

async function fetchTo(url, path, gz, label) {
  status(`Downloading ${label}…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download ${label} (${res.status}).`);
  const body = gz ? res.body.pipeThrough(new DecompressionStream('gzip')) : res.body;
  const data = new Uint8Array(await new Response(body).arrayBuffer());
  mkdirs(path.slice(0, path.lastIndexOf('/')));
  py.FS.writeFile(path, data);
}

function mkdirs(path) {
  let cur = '';
  for (const part of path.split('/').filter(Boolean)) { cur += '/' + part; try { py.FS.mkdir(cur); } catch (e) { /* exists */ } }
}

async function run(msg) {
  const need = [...new Set([...(msg.libs && msg.libs.length ? msg.libs : ['bw']), ...(msg.plotly ? ['plotly'] : [])])];
  await ensure(need);
  const t0 = performance.now();
  py.runPython('_bw_reset()');
  // inputs chosen by the user
  try { py.runPython("import shutil; shutil.rmtree('/inputs', ignore_errors=True)"); } catch (e) { /* none */ }
  for (const f of msg.files || []) {
    const path = f.dir + '/' + f.name;
    mkdirs(path.slice(0, path.lastIndexOf('/')));
    py.FS.writeFile(path, new Uint8Array(f.buffer));
  }
  // demo datasets and sample files the pipeline uses
  const missing = JSON.parse(py.globals.get('_bw_demo_paths')(py.toPy(msg.demos || [])));
  for (const [, path] of missing) { const file = path.split('/').pop(); await fetchTo(SITE + 'py/demo/' + encodeURIComponent(file) + '.gz', path, true, 'demo file ' + file); }
  for (const name of msg.samples || []) {
    const path = '/samples/' + name;
    if (!py.FS.analyzePath(path).exists) await fetchTo(SITE + 'py/samples/' + encodeURIComponent(name), path, false, 'sample file ' + name);
  }

  let ok = true;
  for (const st of msg.steps) {
    status(`Running ${st.title}…`);
    self.postMessage({ type: 'step-start', id: st.id });
    const res = JSON.parse(py.globals.get('_bw_step')(st.code, JSON.stringify(st.leaf || [])));
    self.postMessage(Object.assign({ type: 'step', id: st.id }, res));
    if (!res.ok) { ok = false; break; }
  }
  const files = JSON.parse(py.runPython('_bw_outputs()')).map(name => {
    const data = py.FS.readFile('/work/' + name);
    return { name, buffer: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
  });
  if (files.length) self.postMessage({ type: 'files', files }, files.map(f => f.buffer));
  self.postMessage({ type: 'done', ok, seconds: Math.round((performance.now() - t0) / 100) / 10 });
}

async function handle(msg) {
  try {
    if (msg.type === 'run') await run(msg);
    else if (msg.type === 'warm') await ensure(msg.libs || ['bw']);
    else if (msg.type === 'table') {
      try { self.postMessage({ type: 'table', expr: msg.expr, csv: py.globals.get('_bw_csv')(msg.expr) }); }
      catch (e) { self.postMessage({ type: 'table', expr: msg.expr, error: String(e.message || e) }); }
    } else if (msg.type === 'netcdf') {
      try {
        const data = py.globals.get('_bw_netcdf')(msg.expr).toJs();
        const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        self.postMessage({ type: 'netcdf', expr: msg.expr, buffer }, [buffer]);
      } catch (e) { self.postMessage({ type: 'netcdf', expr: msg.expr, error: String(e.message || e) }); }
    }
  } catch (e) {
    self.postMessage({ type: 'fatal', error: String((e && e.message) || e) });
  }
}
// one message at a time, so a table request never runs in the middle of a pipeline
self.onmessage = ev => { queue = queue.then(() => handle(ev.data)); };
