/* ============================================================
   Run in the browser: executes the pipeline with brightwind and windkit on Pyodide,
   in a Web Worker (public/py-worker.js). Inputs stay on this computer.
   ============================================================ */
const RUN = {
  worker: null, ready: false, busy: false,
  inputs: {},        // File path node id -> {kind:'file'|'folder', files:[File], label}
  results: [],       // [{id, title, ok, seconds, stdout, outputs, error}]
  outFiles: [],      // [{name, url, size}]
  status: '', stale: false, snapshot: null, lastSeconds: null, bootSeconds: null,
  pendingTables: {}, pendingNc: {}, codes: {}, libsLoaded: [],
};
let RUNMARKS = {};    // node id -> 'busy' | 'ok' | 'err' (read by renderCanvas)
const BLOCKED = d => d.blocked || d.id.startsWith('LoadBrightHub.') || d.id.startsWith('LoadBrightdata.') || d.id === 'plot_meas_station_on_gmap';
const fmtBytes = b => b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : b > 1e3 ? Math.round(b / 1e3) + ' kB' : b + ' B';

function runInvalidate() {
  if (RUN.busy) return;
  if (Object.keys(RUNMARKS).length) RUNMARKS = {};
  if (RUN.results.length && RUN.snapshot !== snapshotGraph()) RUN.stale = true;
}
function snapshotGraph() { return JSON.stringify({ n: S.nodes.map(n => [n.id, n.t, n.v, n.lit, n.var]), e: S.edges.map(e => [e.from, e.to]) }); }

function runChecks() {
  const problems = [];
  if (!S.nodes.length) problems.push({ text: 'The board is empty. Add tools or load an example first.' });
  for (const n of S.nodes) {
    const d = def(n), iss = nodeIssues(n);
    if (iss.length) problems.push({ id: n.id, text: `${d.title}: ${iss.join('; ')}` });
    if (BLOCKED(d)) problems.push({ id: n.id, text: `${d.title} needs network access to an outside service, which the browser runner doesn't support. Run the exported script instead.` });
  }
  for (const n of S.nodes) if (n.t === 'File path' && !RUN.inputs[n.id]) problems.push({ id: n.id, text: `Choose the file or folder for File path "${n.v.path || '(empty)'}".` });
  return problems;
}

function workerFor() {
  if (RUN.worker) return RUN.worker;
  const w = new Worker('py-worker.js');
  w.onmessage = ev => runMessage(ev.data);
  w.onerror = ev => { runFail('The Python worker stopped: ' + (ev.message || 'unknown error')); };
  RUN.worker = w;
  return w;
}
function runFail(text) {
  RUN.busy = false; RUN.status = text; RUN.statusBad = true;
  for (const k of Object.keys(RUNMARKS)) if (RUNMARKS[k] === 'busy') delete RUNMARKS[k];
  renderRun(); renderCanvas();
}
function runMessage(m) {
  if (m.type === 'status') { RUN.status = m.text; RUN.statusBad = false; renderRunStatus(); }
  else if (m.type === 'ready') { RUN.ready = true; RUN.bootSeconds = m.seconds; RUN.libsLoaded = m.libs || []; }
  else if (m.type === 'step-start') { RUNMARKS[m.id] = 'busy'; renderCanvas(); }
  else if (m.type === 'step') {
    const n = nodeById(m.id);
    RUN.results.push(Object.assign({ title: n ? def(n).title : m.id }, m));
    RUNMARKS[m.id] = m.ok ? 'ok' : 'err';
    renderCanvas(); renderRunResults();
  }
  else if (m.type === 'files') {
    RUN.outFiles = m.files.map(f => ({ name: f.name, size: f.buffer.byteLength, url: URL.createObjectURL(new Blob([f.buffer])) }));
  }
  else if (m.type === 'done') {
    RUN.busy = false; RUN.lastSeconds = m.seconds;
    const failed = RUN.results.find(r => !r.ok);
    RUN.status = failed ? `Stopped at ${failed.title}. Fix it and run again.` : `Finished ${RUN.results.length} step${RUN.results.length === 1 ? '' : 's'} in ${m.seconds} s.`;
    RUN.statusBad = !!failed;
    renderRun(); renderStatus();
    if (failed) { S.sel = { kind: 'node', id: failed.id }; renderCanvas(); renderDetails(); }
  }
  else if (m.type === 'table') {
    const cb = RUN.pendingTables[m.expr]; delete RUN.pendingTables[m.expr];
    if (cb) cb(m);
  }
  else if (m.type === 'netcdf') {
    const cb = RUN.pendingNc[m.expr]; delete RUN.pendingNc[m.expr];
    if (cb) cb(m);
  }
  else if (m.type === 'fatal') runFail('Python could not start or stopped unexpectedly: ' + m.error + ' Check your connection and press Run again.');
}

async function runStart() {
  if (RUN.busy) return;
  const problems = runChecks();
  if (problems.length) { renderRun(); return; }
  const paths = {}, files = [];
  for (const n of S.nodes.filter(x => x.t === 'File path')) {
    const inp = RUN.inputs[n.id], dir = '/inputs/' + n.id;
    if (inp.kind === 'folder') {
      paths[n.id] = dir;
      for (const f of inp.files) files.push({ dir, name: (f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name, file: f });
    } else {
      paths[n.id] = dir + '/' + inp.files[0].name;
      files.push({ dir, name: inp.files[0].name, file: inp.files[0] });
    }
  }
  const gen = generate('run', { paths });
  RUN.codes = Object.fromEntries(gen.steps.map(s => [s.id, s.code.replace(/'\/inputs\/[^']*'/g, m => m)]));
  const demos = [...new Set(gen.steps.flatMap(s => [...s.code.matchAll(/bw\.demo_datasets\.(\w+)/g)].map(m => m[1])))];
  const samples = [...new Set(gen.steps.flatMap(s => [...s.code.matchAll(/'\/samples\/([\w.-]+)'/g)].map(m => m[1])))];
  const libs = gen.libs.length ? gen.libs : S.libs.slice(0, 1);
  const newLibs = [...libs, ...(gen.plotly ? ['plotly'] : [])].filter(l => !RUN.libsLoaded.includes(l));
  RUN.busy = true; RUN.results = []; RUN.stale = false; RUN.snapshot = snapshotGraph(); RUNMARKS = {};
  RUN.outFiles.forEach(f => URL.revokeObjectURL(f.url)); RUN.outFiles = [];
  const mb = (RUN.ready ? 0 : 25) + (newLibs.includes('bw') ? 5 : 0) + (newLibs.includes('wk') ? 40 : 0) + (newLibs.includes('plotly') ? 6 : 0);
  RUN.status = !newLibs.length ? 'Starting…' : `${RUN.ready ? 'Loading ' + newLibs.map(l => ({ bw: 'brightwind', wk: 'windkit', plotly: 'plotly' })[l]).join(' and ') : 'Starting Python'}. This downloads about ${mb} MB the first time, which your browser then keeps.`;
  RUN.statusBad = false;
  renderRun(); renderCanvas();
  const payload = [];
  for (const f of files) payload.push({ dir: f.dir, name: f.name, buffer: await f.file.arrayBuffer() });
  workerFor().postMessage({ type: 'run', libs, plotly: gen.plotly, steps: gen.steps, files: payload, demos, samples }, payload.map(p => p.buffer));
}
function runStop() {
  if (RUN.worker) RUN.worker.terminate();
  RUN.worker = null; RUN.ready = false; RUN.libsLoaded = [];
  runFail('Stopped. Python will start again on the next run.');
}
function runTableCsv(expr, name) {
  if (!RUN.worker || !RUN.ready) { toast('Run the pipeline again to download this table.'); return; }
  RUN.pendingTables[expr] = m => {
    if (m.error) { toast('Could not export the table: ' + m.error); return; }
    saveBlob(new Blob([m.csv], { type: 'text/csv' }), (name || 'table').replace(/[^\w.-]+/g, '_') + '.csv');
  };
  RUN.worker.postMessage({ type: 'table', expr });
}
function runNetcdf(expr, name) {
  if (!RUN.worker || !RUN.ready) { toast('Run the pipeline again to download this result.'); return; }
  RUN.pendingNc[expr] = m => {
    if (m.error) { toast('Could not write netCDF: ' + m.error); return; }
    saveBlob(new Blob([m.buffer], { type: 'application/x-netcdf' }), (name || 'result').replace(/[^\w.-]+/g, '_') + '.nc');
  };
  RUN.worker.postMessage({ type: 'netcdf', expr });
}
// plotly.js (4.8 MB) is fetched the first time a run returns an interactive figure
let plotlyJs = null;
function loadPlotly() {
  if (window.Plotly) return Promise.resolve(window.Plotly);
  plotlyJs = plotlyJs || new Promise((ok, bad) => { const sc = h('script', { src: 'py/plotly.min.js' }); sc.onload = () => ok(window.Plotly); sc.onerror = () => { plotlyJs = null; bad(new Error('plotly.js did not load')); }; document.head.append(sc); });
  return plotlyJs;
}
function plotlyCard(o, title) {
  const box = h('div', { class: 'rs-plotly', role: 'img', 'aria-label': 'Interactive figure from ' + title, text: 'Loading the interactive figure…' });
  const fname = (o.name === 'figure' ? title : o.name).replace(/[^\w.-]+/g, '_');
  const dl = h('button', { class: 'btn small', disabled: true, onclick: () => window.Plotly && window.Plotly.downloadImage(box, { format: 'png', filename: fname, width: 1100, height: 700 }) }, 'Download PNG');
  loadPlotly().then(P => {
    const fig = JSON.parse(o.json); box.textContent = '';
    const layout = Object.assign({}, fig.layout, { autosize: true, margin: Object.assign({ t: 40, r: 20, b: 40, l: 50 }, (fig.layout || {}).margin) });
    P.newPlot(box, fig.data, layout, { responsive: true, displaylogo: false }); dl.disabled = false;
  }).catch(e => { box.textContent = 'The interactive figure could not be drawn: ' + e.message; });
  return h('figure', { class: 'rs-fig' }, box, h('figcaption', {}, h('span', { class: 'mono', text: o.name }), dl));
}
function saveBlob(blob, filename) {
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------- rendering ---------- */
function renderRunStatus() {
  const el = $('#runStatus'); if (!el) return;
  el.textContent = RUN.status || 'Python runs inside this browser tab. Your files are read here and never uploaded.';
  el.className = 'run-status' + (RUN.statusBad ? ' bad' : '') + (RUN.busy ? ' busy' : '');
  $('#runGo').hidden = RUN.busy; $('#runStop').hidden = !RUN.busy;
}
function renderRun() {
  const body = $('#runBody'); if (!body) return;
  renderRunStatus();
  body.textContent = '';
  if (window.self !== window.top) {
    body.append(h('p', { class: 'note', text: 'Running pipelines works on bw-explorer.coderenewables.com, where the page can start Python.' }));
    $('#runGo').disabled = true; return;
  }
  const problems = runChecks();
  $('#runGo').disabled = RUN.busy || problems.length > 0;
  const fileNodes = S.nodes.filter(n => n.t === 'File path');
  if (fileNodes.length) {
    const sec = h('section', { class: 'run-sec' }, h('h3', {}, 'Your files'),
      h('p', { class: 'dc', text: 'Choose the file or folder each File path node points to. It is read by this browser only.' }));
    for (const n of fileNodes) {
      const inp = RUN.inputs[n.id];
      const fi = h('input', { type: 'file', id: 'rf-' + n.id, class: 'sr', onchange: ev => { if (ev.target.files.length) { RUN.inputs[n.id] = { kind: 'file', files: [...ev.target.files], label: ev.target.files[0].name }; renderRun(); } } });
      const fo = h('input', { type: 'file', id: 'rd-' + n.id, class: 'sr', webkitdirectory: true, multiple: true, onchange: ev => { const fs = [...ev.target.files]; if (fs.length) { RUN.inputs[n.id] = { kind: 'folder', files: fs, label: (fs[0].webkitRelativePath || '').split('/')[0] + ` (${fs.length} files)` }; renderRun(); } } });
      sec.append(h('div', { class: 'run-file' + (inp ? '' : ' need') },
        h('div', { class: 'rf-name' }, h('span', { class: 'mono', text: n.v.path || 'File path' }), inp ? h('span', { class: 'rf-pick', text: '→ ' + inp.label + ' · ' + fmtBytes(inp.files.reduce((a, f) => a + f.size, 0)) }) : h('span', { class: 'rf-pick none', text: 'not chosen' })),
        h('div', { class: 'acts' }, fi, fo, h('label', { class: 'btn small', for: 'rf-' + n.id }, 'Choose file'), h('label', { class: 'btn small', for: 'rd-' + n.id }, 'Choose folder'))));
    }
    body.append(sec);
  }
  const blocking = problems.filter(p => !(p.text.startsWith('Choose the file') && fileNodes.length));
  if (blocking.length) {
    body.append(h('section', { class: 'run-sec' }, h('h3', {}, 'Before you can run'),
      h('ul', { class: 'issues' }, ...blocking.map(p => h('li', {}, p.id ? h('a', { href: '#canvas', onclick: ev => { ev.preventDefault(); S.sel = { kind: 'node', id: p.id }; setView('canvas'); renderAll(); } }, p.text) : p.text)))));
  }
  const res = h('section', { class: 'run-sec', id: 'runResults' });
  body.append(res);
  renderRunResults();
}
function renderRunResults() {
  const res = $('#runResults'); if (!res) return;
  res.textContent = '';
  if (!RUN.results.length && !RUN.busy) {
    res.append(h('h3', {}, 'Results'), h('div', { class: 'run-empty' },
      h('p', {}, 'Press ', h('strong', {}, 'Run pipeline'), ` to execute every step with ${S.libs.map(l => l === 'bw' ? 'brightwind ' + CAT.version : 'windkit ' + WKCAT.version).join(' and ')} in this browser. Tables, figures and anything printed appear here, step by step, and each node on the board turns green or red.`),
      h('p', { class: 'dc' }, 'The first run downloads Python and the scientific libraries and takes a little while: about 30 MB for brightwind, and about 40 MB more the first time a pipeline uses windkit. Later runs start straight away. Demo datasets and sample files are fetched only when a pipeline uses them.')));
    return;
  }
  res.append(h('h3', {}, 'Results', RUN.stale ? h('span', { class: 'flag warn', text: 'board changed since this run' }) : null));
  for (const r of RUN.results) {
    const card = h('article', { class: 'run-step ' + (r.ok ? 'ok' : 'err') },
      h('header', {}, h('span', { class: 'dot' }), h('a', { href: '#canvas', class: 'rs-title', onclick: ev => { ev.preventDefault(); S.sel = { kind: 'node', id: r.id }; setView('canvas'); renderAll(); }, text: r.title }), h('span', { class: 'rs-time', text: r.seconds + ' s' })));
    if (r.error) card.append(h('div', { class: 'rs-err' }, h('strong', { text: r.error.message }), r.error.hint ? h('p', { text: r.error.hint }) : null, r.error.where ? h('pre', { text: 'Where:\n' + r.error.where }) : null));
    if (r.stdout && r.stdout.trim()) card.append(h('pre', { class: 'rs-out', text: r.stdout.trim() }));
    for (const o of r.outputs || []) {
      if (o.kind === 'figure') card.append(h('figure', { class: 'rs-fig' }, h('img', { src: 'data:image/png;base64,' + o.png, alt: 'Figure from ' + r.title, loading: 'lazy' }),
        h('figcaption', {}, h('span', { class: 'mono', text: o.name }), h('a', { href: 'data:image/png;base64,' + o.png, download: (o.name === 'figure' ? r.title : o.name).replace(/[^\w.-]+/g, '_') + '.png' }, 'Download PNG'))));
      else if (o.kind === 'table') {
        const wrap = h('div', { class: 'rs-table' }); wrap.innerHTML = o.html;
        card.append(h('div', { class: 'rs-thead' }, h('span', { class: 'mono', text: o.name }), h('span', { class: 'dc', text: `${o.note ? o.note + ', ' : ''}${o.rows.toLocaleString()} rows × ${o.cols} columns${o.rows > 200 ? ', first 200 shown' : ''}` }),
          h('button', { class: 'btn small', onclick: () => runTableCsv(o.expr, o.name) }, 'Download CSV')), wrap);
      } else if (o.kind === 'plotly') card.append(plotlyCard(o, r.title));
      else if (o.kind === 'xarray') card.append(h('div', { class: 'rs-thead' }, h('span', { class: 'mono', text: o.name }), h('span', { class: 'dc', text: 'xarray ' + o.type }),
          h('button', { class: 'btn small', onclick: () => runNetcdf(o.expr, o.name) }, 'Download netCDF'), h('button', { class: 'btn small', onclick: () => runTableCsv(o.expr, o.name) }, 'Download CSV')), h('pre', { class: 'rs-out', text: o.text }));
      else if (o.kind === 'text') card.append(h('div', { class: 'rs-thead' }, h('span', { class: 'mono', text: o.name }), h('span', { class: 'dc', text: o.type })), h('pre', { class: 'rs-out', text: o.text }));
    }
    if (r.ok && !(r.outputs || []).length && !(r.stdout || '').trim()) card.append(h('p', { class: 'dc', text: 'Done. Its result feeds the next step.' }));
    if (RUN.codes[r.id]) card.append(h('details', { class: 'rs-code' }, h('summary', {}, 'Code'), h('pre', { text: RUN.codes[r.id] })));
    res.append(card);
  }
  if (RUN.busy) res.append(h('div', { class: 'run-step busy' }, h('header', {}, h('span', { class: 'dot' }), h('span', { class: 'rs-title', text: RUN.status }))));
  if (RUN.outFiles.length) res.append(h('div', { class: 'run-files' }, h('h3', {}, 'Files the pipeline wrote'),
    ...RUN.outFiles.map(f => h('a', { class: 'btn small', href: f.url, download: f.name.split('/').pop() }, `${f.name} · ${fmtBytes(f.size)}`))));
}
