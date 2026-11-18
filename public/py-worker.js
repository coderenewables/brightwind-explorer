/* Runs brightwind in the browser with Pyodide, inside a Web Worker so the page stays responsive.

   Messages in:  {type:'run', steps:[{id, title, code, leaf:[[expr, type]]}], files:[{dir, name, buffer}], demos:[name]}
                 {type:'table', expr}           full CSV of a result, on request
   Messages out: {type:'status', text}          progress while loading or running
                 {type:'ready', seconds}
                 {type:'step', id, ok, seconds, stdout, outputs, error}
                 {type:'files', files:[{name, buffer}]}   files the pipeline wrote
                 {type:'done', ok, seconds}
                 {type:'table', expr, csv | error}
                 {type:'fatal', error}
*/
'use strict';
const PYODIDE_VERSION = '0.29.5';
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const SITE = self.location.href.replace(/[^/]*$/, '');
const WHEELS = ['py/brightwind-2.8.0-py3-none-any.whl', 'py/colormap-1.3.0-py3-none-any.whl'];
const PACKAGES = ['numpy', 'pandas', 'scipy', 'matplotlib', 'requests', 'python-dateutil', 'six', 'jsonschema', 'packaging', 'micropip'];

let py = null, booting = null, ready = false;
const status = text => self.postMessage({ type: 'status', text });

const SETUP = String.raw`
import os, sys, types, io, json, time, base64, pprint, traceback, warnings, shutil
os.environ['MPLBACKEND'] = 'Agg'
sys.modules.setdefault('gmaps', types.ModuleType('gmaps'))   # optional Google Maps plotting; no browser build
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.figure import Figure
import numpy as np
import pandas as pd
with warnings.catch_warnings():
    warnings.simplefilter('ignore')
    import brightwind as bw

_bw_ns = {}
_MAX_ROWS = 200

def _bw_reset():
    _bw_ns.clear()
    _bw_ns['__name__'] = '__main__'
    exec('import brightwind as bw\nimport numpy as np\nimport pandas as pd\nimport matplotlib.pyplot as plt', _bw_ns)
    plt.close('all')
    shutil.rmtree('/work', ignore_errors=True)
    os.makedirs('/work', exist_ok=True)
    os.chdir('/work')

def _bw_demo_paths(names):
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

def _bw_render(obj, name, seen):
    if isinstance(obj, Figure):
        seen.add(id(obj))
        return _bw_fig(obj, name)
    if isinstance(obj, pd.Series):
        obj = obj.to_frame()
    if isinstance(obj, pd.DataFrame):
        head = obj.head(_MAX_ROWS)
        html = head.to_html(border=0, classes='df', float_format=_bw_fmt, max_cols=40, na_rep='')
        return {'kind': 'table', 'name': name, 'rows': int(obj.shape[0]), 'cols': int(obj.shape[1]), 'html': html}
    if obj is None:
        return None
    text = pprint.pformat(obj, width=96, compact=True)
    if len(text) > 6000:
        text = text[:6000] + '\n...'
    return {'kind': 'text', 'name': name, 'text': text, 'type': type(obj).__name__}

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
        frames = [f for f in tb if f.filename != '<pipeline step>' and 'brightwind' in f.filename][-3:]
        where = ''.join(f'  {f.filename.split("site-packages/")[-1]}, line {f.lineno}, in {f.name}\n' for f in frames)
        hint = ''
        if isinstance(e, KeyError):
            hint = 'No column or key with that name. Column names are case sensitive; check them against your data.'
        elif isinstance(e, FileNotFoundError):
            hint = 'The file is not there. Choose it again under Your files.'
        error = {'message': f'{type(e).__name__}: {e}', 'where': where, 'hint': hint}
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
            r = _bw_render(obj, expr, seen)
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
    return obj.to_csv()

def _bw_outputs():
    files = []
    for root, _, names in os.walk('/work'):
        for n in names:
            p = os.path.join(root, n)
            files.append(os.path.relpath(p, '/work'))
    return json.dumps(sorted(files))
`;

async function boot() {
  const t0 = performance.now();
  status('Downloading Python (Pyodide ' + PYODIDE_VERSION + ')…');
  importScripts(PYODIDE_URL + 'pyodide.js');
  py = await loadPyodide({ indexURL: PYODIDE_URL });
  status('Loading numpy, pandas, scipy and matplotlib…');
  await py.loadPackage(PACKAGES, { messageCallback: m => { if (/^Loading /.test(m)) status(m.replace(/, /g, ', ') + '…'); }, errorCallback: () => {} });
  status('Installing brightwind 2.8.0…');
  py.globals.set('_bw_wheels', py.toPy(WHEELS.map(w => SITE + w)));
  await py.runPythonAsync('import micropip\nawait micropip.install(_bw_wheels, deps=False)');
  status('Importing brightwind…');
  await py.runPythonAsync(SETUP);
  ready = true;
  self.postMessage({ type: 'ready', seconds: Math.round((performance.now() - t0) / 100) / 10 });
}

async function fetchDemo(name, path) {
  const file = path.split('/').pop();
  status(`Downloading demo file ${file}…`);
  const res = await fetch(SITE + 'py/demo/' + encodeURIComponent(file) + '.gz');
  if (!res.ok) throw new Error(`Could not download the demo file ${file} (${res.status}).`);
  const data = new Uint8Array(await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  py.FS.writeFile(path, data);
}

function mkdirs(path) {
  let cur = '';
  for (const part of path.split('/').filter(Boolean)) { cur += '/' + part; try { py.FS.mkdir(cur); } catch (e) { /* exists */ } }
}

async function run(msg) {
  if (!booting) booting = boot();
  await booting;
  const t0 = performance.now();
  py.runPython('_bw_reset()');
  // inputs chosen by the user
  try { py.runPython("import shutil; shutil.rmtree('/inputs', ignore_errors=True)"); } catch (e) { /* none */ }
  for (const f of msg.files || []) {
    const path = f.dir + '/' + f.name;
    mkdirs(path.slice(0, path.lastIndexOf('/')));
    py.FS.writeFile(path, new Uint8Array(f.buffer));
  }
  // demo datasets the pipeline uses
  const missing = JSON.parse(py.globals.get('_bw_demo_paths')(py.toPy(msg.demos || [])));
  for (const [name, path] of missing) await fetchDemo(name, path);

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

self.onmessage = async ev => {
  const msg = ev.data;
  try {
    if (msg.type === 'run') await run(msg);
    else if (msg.type === 'warm') { if (!booting) booting = boot(); await booting; }
    else if (msg.type === 'table') {
      try { self.postMessage({ type: 'table', expr: msg.expr, csv: py.globals.get('_bw_csv')(msg.expr) }); }
      catch (e) { self.postMessage({ type: 'table', expr: msg.expr, error: String(e.message || e) }); }
    }
  } catch (e) {
    if (!ready) booting = null;
    self.postMessage({ type: 'fatal', error: String((e && e.message) || e) });
  }
};
