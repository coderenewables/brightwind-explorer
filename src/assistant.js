/* ============================================================
   Build with AI: bring-your-own-key assistant.
   The browser calls the provider directly with the viewer's key. Nothing goes through
   this site's server. The model answers with a build_pipeline tool call; the app
   checks it with the same typing rules as manual wiring and sends any problems back
   for the model to fix, up to MAX_ROUNDS times.
   ============================================================ */
const AI = {
  providers: {
    anthropic: { label: 'Anthropic (Claude)', model: 'claude-sonnet-5-5', keyHint: 'sk-ant-…', keyUrl: 'https://console.anthropic.com/settings/keys' },
    openai: { label: 'OpenAI', model: 'gpt-6.1-sol', keyHint: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys' },
    compatible: { label: 'OpenAI-compatible (OpenRouter, local, …)', model: '', keyHint: 'key, if the endpoint needs one', baseUrl: 'https://openrouter.ai/api/v1' },
  },
  MAX_ROUNDS: 3,
  settings: { provider: 'anthropic', models: {}, baseUrl: '', remember: false },
  keys: {},           // provider -> key (memory; mirrored to localStorage only when remember is on)
  history: [],        // [{role:'user'|'assistant', text}]
  busy: null,         // AbortController while a build runs
};
const AI_STORE = 'bw-ai-v1';
const EXAMPLE_PROMPTS = {
  bw: [
    'Monthly means and a frequency rose of the 80 m north anemometer on the demo mast',
    'Average shear from the 40, 60 and 80 m anemometers, then scale the 80 m speed to a 120 m hub height',
    'Correlate the 80 m speed with MERRA-2 NE using monthly ordinary least squares and synthesize the long-term series',
    'Apply the demo cleaning file, then turbulence intensity by speed and by sector, and export the TI table to csv',
  ],
  wk: [
    'Read the sample .tab wind climate, fit a Weibull per sector and show the wind rose and mean power density',
    'Plot the power and thrust curves of the sample .wtg turbine and its power at 6, 9 and 12 m/s',
    'Make a 2 km by 2 km raster of points 100 m apart at 80 m around 480000, 5882000 in EPSG:32629 and plot it',
  ],
  both: [
    'Clean the demo mast data, turn the 80 m speed and 78 m direction into a windkit time series, and write a WAsP .tab file with a wind rose',
  ],
};
const examplePrompts = () => [...(S.libs.includes('bw') && S.libs.includes('wk') ? EXAMPLE_PROMPTS.both : []), ...S.libs.flatMap(l => EXAMPLE_PROMPTS[l]).slice(0, 5)];

/* ---------- settings ---------- */
function aiLoad() {
  try {
    const d = JSON.parse(localStorage.getItem(AI_STORE) || 'null');
    if (d) { Object.assign(AI.settings, d.settings || {}); if (AI.settings.remember) AI.keys = d.keys || {}; }
  } catch (e) { /* storage unavailable */ }
}
function aiSave() {
  try { localStorage.setItem(AI_STORE, JSON.stringify({ settings: AI.settings, keys: AI.settings.remember ? AI.keys : {} })); } catch (e) { /* ignore */ }
}
const aiProv = () => AI.providers[AI.settings.provider];
const aiModel = () => AI.settings.models[AI.settings.provider] || aiProv().model;
const aiBase = () => (AI.settings.provider === 'openai' ? 'https://api.openai.com/v1'
  : AI.settings.provider === 'anthropic' ? 'https://api.anthropic.com/v1'
  : (AI.settings.baseUrl || AI.providers.compatible.baseUrl)).replace(/\/+$/, '');

/* ---------- prompt ---------- */
function aiCatalogText() {
  const lines = [];
  const sections = [[null, COMMON_GROUPS], ...S.libs.map(l => [l, l === 'bw' ? BW_GROUPS : WK_GROUPS])];
  for (const [lib, gs] of sections) for (const g of gs) {
    const defs = Object.values(DEFS).filter(d => d.group === g && libOn(d) && d.status !== 'not_implemented' && (lib ? libOf(d) === lib : true) && !(lib && COMMON_GROUPS.includes(g)));
    if (!defs.length) continue;
    lines.push(`\n# ${lib ? LIBS[lib].name + ': ' : ''}${g}`);
    for (const d of defs) {
      let s = d.summary || ''; const max = d.lib === 'wk' ? 130 : 170; if (s.length > max) s = s.slice(0, max - 3) + '...';
      lines.push(`## ${d.id} [${d.kind}${d.status === 'deprecated' ? ', deprecated' : ''}] ${s}`);
      if (d.inputs.length) lines.push('  in: ' + d.inputs.map(i => `${i.name}${i.required ? '*' : ''}:${i.types.map(t => t === '*' ? 'any' : t).join('|')}${i.self ? '(object)' : ''}`).join(', '));
      const fs = d.fields.filter(f => !f.flag).map(f => {
        if (f.mode === 'choice') return `${f.name}${f.required ? '*' : ''} one of ${f.choices.join('/')}${f.quoted ? ' (quoted string)' : ''}`;
        if (f.mode === 'bool') return `${f.name}=${f.default ?? 'False'}`;
        return `${f.name}${f.required ? '*' : ''}${f.default != null && f.default !== 'None' ? '=' + (f.default.length > 40 ? f.default.slice(0, 37) + '...' : f.default) : ''}`;
      });
      if (d.kwargs) fs.push('**' + d.kwargs);
      if (fs.length) lines.push('  params: ' + fs.join(', '));
      if (d.outputs.length) lines.push('  out: ' + d.outputs.map(o => `${o.name}:${o.types.join('|')}${o.flag ? ` (only with ${o.flag}=True; wiring it sets that)` : ''}`).join(', '));
      if (d.note) lines.push('  note: ' + d.note);
      if (d.blocked) lines.push('  needs internet: avoid unless the user asks for it');
    }
  }
  return lines.join('\n');
}
function aiWindkitText() {
  if (!S.libs.includes('wk')) return '';
  const tree = Object.entries(TYPES).filter(([, v]) => v.parent).map(([t, v]) => `${t} < ${v.parent}`).join(', ');
  return `
windkit (tool ids start with "wk.")
- windkit's data are xarray Datasets and DataArrays with a spatial structure. A type also fits any input that accepts one of its parents: ${tree}. So a PWC fits a WWC input, and every wind climate fits a Dataset input. Locations is only a parent: make locations with wk.spatial.create_point, create_stacked_point, create_raster or create_cuboid, or wk.spatial.BBox.to_grid.
- Coordinates are in the units of the crs: metres for a projected crs such as 'EPSG:32629' (UTM 29N), degrees for 'EPSG:4326' (west_east is longitude, south_north latitude). create_point takes lists: west_east [x], south_north [y], height [h].
- "Sample file" {"file": "'demo_mast_80m.tab'"} gives the path of a bundled example file: ${(WKCAT.samples || []).map(x => `${x.file} (${x.doc.replace(/\.$/, '')})`).join('; ')}. Read them with wk.read_bwc, wk.read_wtg, wk.read_elevation_map or wk.read_roughness_map.
- With no files, windkit can make synthetic data: wk.create_tswc (time series), wk.create_bwc, wk.create_wwc and wk.create_tswc_pair (a reference and a target for long-term correction) all take output_locs from create_point.
- Classes work like brightwind's: wk.ltc.LinRegMCP -> wk.ltc.LinRegMCP.fit (ds_ref, ds_target) -> wk.ltc.LinRegMCP.predict (ds_ref). Workspace methods need wk.Workspace.read_wwh first.
- windkit helpers: "Select variable" {"variable": "'wind_speed'"} takes one variable of a Dataset; "Select by coordinate" {"method": "'sel'", "selection": "height=80"}; "DataArray to Series" and "Dataset to DataFrame" turn xarray into pandas; "Save netCDF" {"file_name": "'bwc.nc'"}; "Save interactive figure" {"file_name": "'rose.html'"} for plotly figures.
- wk.plot functions return interactive plotly figures or matplotlib axes; both are shown when the script runs.
- A WAsP .tab file (wk.bwc_to_file) needs geographic coordinates (EPSG:4326).${S.libs.includes('bw') ? `
- From brightwind to windkit: load and clean with brightwind, keep the speed and direction columns with "Select columns", then wk.tswc_from_dataframe with west_east (longitude), south_north (latitude), crs "'EPSG:4326'" and height_to_columns, for example "{80.0: ('Spd80mN', 'Dir78mS')}". The demo mast is at about longitude -9.27, latitude 53.09. Back to brightwind: "Select variable" then "DataArray to Series".` : ''}
`;
}
function aiSystemPrompt() {
  const libText = S.libs.map(l => l === 'bw' ? `the brightwind Python library v${CAT.version}` : `the windkit Python library v${WKCAT.version} (DTU Wind Energy)`).join(' and ');
  return `You build wind resource analysis pipelines for the Brightwind Workflow Builder, a visual editor for ${libText}. The user describes an analysis; you answer by calling the build_pipeline tool with a graph of nodes and edges. The app turns that graph into a Python script, so every node must be a tool from the catalog below, wired with matching types.

How graphs work
- A node is one tool from the catalog, named by its exact id in "tool". Give each node a short unique "key" such as "load" or "spd80".
- An edge connects an output port to an input port: {"from": "key.output_name", "to": "key.input_name"}. Each input takes at most one edge. No loops.
- Types must match. An input lists the types it accepts; "any" accepts every type.${S.libs.includes('bw') ? ' brightwind functions that take a Series need a "Select column" node between the DataFrame and the function.' : ''}
- Required inputs and params are marked *. A required input must be wired, or given a Python literal in the node's "inputs", for example {"lat": "53.4"}.
- Methods and attributes are separate nodes that take the object on their "(object)" input. A correlation is: constructor -> .run -> .plot / .synthesize / .params, and only the output of .run (the "fitted" type) reaches the later steps. A shear class works the same way: Shear.Average -> Shear.Average.apply or .alpha.
- Some outputs, such as the data table of monthly_means or dist, only exist when return_data=True. Wiring that output turns the flag on, so do not set it yourself.
- Figures are shown and unconnected results are printed when the script runs, so do not add Print or Save figure nodes unless asked.

Param values
- Every value in "params" and "inputs" is Python source code as a string: strings quoted ("'1M'", "'Spd80mN'"), numbers ("80"), booleans ("True"), lists ("[80, 60, 40]"), None ("None").
- Only set params that are required or that the request needs to differ from the default.
- Helper nodes: ${S.libs.includes('bw') ? `"Demo dataset" {"dataset": "'demo_data'"}; ` : ''}"File path" {"path": "'C:/data/mast.csv'"}; "Select column" {"column": "'Spd80mN'"}; "Select columns" {"columns": "['Spd80mN', 'Spd60mN']"}; "Slice by date" {"date_from": "'2016-06-01'", "date_to": "'2017-05-31'"}; "Python expression" {"expression": "{a} * 1.02", "returns": "'Series'"}; "List" collects inputs a..d into a list, for example the reference speeds of Correl.MultipleLinearRegression.

${aiWindkitText()}${S.libs.includes('bw') ? `Data (brightwind)
- When the user does not name their own files, use the bundled demo data: "Demo dataset" -> load_csv.
- demo_data columns: Spd80mN, Spd80mS, Spd60mN, Spd60mS, Spd40mN, Spd40mS (mean speeds, m/s, at 80/60/40 m, north and south booms), Spd80mNStd, Spd80mSStd, Spd60mNStd, Spd60mSStd, Spd40mNStd, Spd40mSStd (standard deviations), Spd80mNMax ... Spd40mSMax (gusts), Dir78mS, Dir58mS, Dir38mS (directions at 78/58/38 m), Dir78mSStd, Dir58mSStd, Dir38mSStd, T2m (deg C), RH2m (%), P2m (hPa), PrcpTot, BattMin. 10-minute data, 2016 to 2017.
- demo_merra2_NE, demo_merra2_NW, demo_merra2_SE, demo_merra2_SW (MERRA-2 reanalysis nodes, hourly, 2000 to 2017) have columns WS50m_m/s, WD50m_deg, T2M_degC, PS_hPa.
- demo_cleaning_file is a cleaning log for demo_data, for apply_cleaning.
` : ''}
- With the user's own file, use a "File path" node. If they did not give column names, use clear placeholders such as 'WS_80m' and say so in the summary.

Style
- Keep the pipeline as small as the request allows. Give nodes whose results the user will read a short "var" name, such as "monthly_mean_80m".
- "summary" is shown to the user: one to three plain sentences on what the pipeline does and any assumption you made.
- If the request cannot be built from this catalog, say so briefly in plain text and do not call the tool.
- When the app reports problems with your graph, fix them and call build_pipeline again with the complete corrected graph.

Catalog (tool id [kind] summary; in: inputs; params; out: outputs)
${aiCatalogText()}`;
}
const AI_TOOL = {
  name: 'build_pipeline',
  description: 'Replace the board with this pipeline. Always send the complete graph.',
  schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'One to three sentences for the user.' },
      nodes: { type: 'array', items: { type: 'object', properties: {
        key: { type: 'string', description: 'Unique short id used in edges.' },
        tool: { type: 'string', description: 'Exact tool id from the catalog.' },
        var: { type: 'string', description: 'Optional Python variable name for the result.' },
        params: { type: 'object', additionalProperties: { type: 'string' }, description: 'Param name -> Python source.' },
        inputs: { type: 'object', additionalProperties: { type: 'string' }, description: 'Unwired input name -> Python literal.' },
      }, required: ['key', 'tool'] } },
      edges: { type: 'array', items: { type: 'object', properties: {
        from: { type: 'string', description: 'key.output_name' }, to: { type: 'string', description: 'key.input_name' },
      }, required: ['from', 'to'] } },
    },
    required: ['summary', 'nodes', 'edges'],
  },
};

/* ---------- board <-> plan ---------- */
function aiValueToSource(f, raw) {
  if (raw == null || raw === '') return null;
  if (f.mode === 'bool') return raw ? 'True' : 'False';
  const s = String(raw).trim(); if (!s) return null;
  if (f.mode === 'text') return s.startsWith('=') ? s.slice(1).trim() : pyStr(s);
  if (f.mode === 'list') return '[' + s.split(',').map(x => x.trim()).filter(Boolean).map(pyStr).join(', ') + ']';
  if (f.mode === 'choice') return pyStr(s);
  return s;
}
function aiBoardAsPlan() {
  return {
    nodes: S.nodes.map(n => {
      const d = def(n), params = {}, inputs = {};
      for (const f of d.fields) { const v = aiValueToSource(f, n.v[f.name]); if (v != null && !f.flag) params[f.name] = v; }
      if ((n.v.__kwargs || '').trim()) params['**' + d.kwargs] = n.v.__kwargs.trim();
      for (const [k, v] of Object.entries(n.lit || {})) if (String(v).trim()) inputs[k] = String(v).trim();
      const o = { key: n.id, tool: n.t };
      if (n.var) o.var = n.var;
      if (Object.keys(params).length) o.params = params;
      if (Object.keys(inputs).length) o.inputs = inputs;
      return o;
    }),
    edges: S.edges.map(e => ({ from: `${e.from[0]}.${e.from[1]}`, to: `${e.to[0]}.${e.to[1]}` })),
  };
}
function aiUnquote(s) { // a Python string literal -> its text, or null when s is not one
  const m = /^[rRbBuU]?(['"])([\s\S]*)\1$/.exec(s.trim());
  if (!m) return null;
  return /^[rR]/.test(s.trim()) ? m[2] : m[2].replace(/\\(['"\\])/g, '$1');
}
function aiFieldValue(d, f, raw) { // -> [value, error]
  const s = typeof raw === 'string' ? raw.trim() : raw === true ? 'True' : raw === false ? 'False' : JSON.stringify(raw);
  if (f.mode === 'bool') { if (/^true$/i.test(s)) return [true]; if (/^false$/i.test(s)) return [false]; return [null, `${f.name} must be True or False`]; }
  if (f.mode === 'choice') { const v = aiUnquote(s) ?? s; return f.choices.includes(v) ? [v] : [null, `${f.name} must be one of ${f.choices.join(', ')}`]; }
  if (f.mode === 'list') {
    if (s.startsWith('[')) { const items = [...s.matchAll(/(['"])(.*?)\1/g)].map(m => m[2]); return items.length ? [items.join(', ')] : [null, `${f.name} must be a list of column names`]; }
    return [s.split(',').map(x => aiUnquote(x.trim()) ?? x.trim()).join(', ')];
  }
  if (f.mode === 'text') {
    const u = aiUnquote(s);
    if (u != null) return [u];
    return d.kind === 'helper' ? [s] : ['=' + s];
  }
  return [s];
}
function aiApply(plan) { // builds the plan on the board; returns {problems, built}
  const problems = [], keyToId = {};
  if (!plan || !Array.isArray(plan.nodes)) return { problems: ['The tool call had no "nodes" list.'], built: 0 };
  if (!plan.nodes.length) return { problems: ['The graph has no nodes.'], built: 0 };
  S.nodes = []; S.edges = []; S.sel = null; S.peek = null; pend = null;
  const seen = new Set();
  for (const pn of plan.nodes) {
    const key = String(pn.key || '').trim(), d = DEFS[pn.tool];
    if (!key) { problems.push(`A node for "${pn.tool}" has no key.`); continue; }
    if (seen.has(key)) { problems.push(`Node key "${key}" is used twice.`); continue; }
    seen.add(key);
    if (!d) {
      const close = Object.keys(DEFS).filter(id => id.toLowerCase().includes(String(pn.tool || '').toLowerCase().split('.').pop())).slice(0, 4);
      problems.push(`Node "${key}": "${pn.tool}" is not a tool in the catalog.${close.length ? ' Did you mean ' + close.map(c => `"${c}"`).join(' or ') + '?' : ''}`);
      continue;
    }
    if (d.status === 'not_implemented') { problems.push(`Node "${key}": ${d.id} is not implemented in brightwind v${CAT.version}.`); continue; }
    if (!libOn(d)) { problems.push(`Node "${key}": ${d.id} is a ${LIBS[libOf(d)].name} tool, and only ${S.libs.map(l => LIBS[l].name).join(' and ')} is switched on. Use tools from the catalog.`); continue; }
    const n = addNode(d.id, 0, 0);
    keyToId[key] = n.id;
    if (pn.var && /^[A-Za-z_]\w*$/.test(String(pn.var).trim())) n.var = String(pn.var).trim();
    for (const [k, raw] of Object.entries(pn.params || {})) {
      const name = k.replace(/^\*\*/, '');
      if (d.kwargs && (name === d.kwargs || k.startsWith('**'))) { n.v.__kwargs = String(raw); continue; }
      const f = d.fields.find(x => x.name === name);
      const inp = d.inputs.find(x => x.name === name && !x.self);
      if (f) { if (f.flag) continue; const [v, err] = aiFieldValue(d, f, raw); if (err) problems.push(`Node "${key}" (${d.id}): ${err}.`); else n.v[f.name] = v; }
      else if (inp) n.lit[inp.name] = String(raw);
      else problems.push(`Node "${key}" (${d.id}) has no param "${name}". Its params are: ${[...d.fields.filter(x => !x.flag).map(x => x.name), ...d.inputs.filter(x => !x.self).map(x => x.name)].join(', ') || 'none'}.`);
    }
    for (const [k, raw] of Object.entries(pn.inputs || {})) {
      const inp = d.inputs.find(x => x.name === k && !x.self), f = d.fields.find(x => x.name === k);
      if (inp) n.lit[k] = String(raw);
      else if (f) { const [v, err] = aiFieldValue(d, f, raw); if (err) problems.push(`Node "${key}" (${d.id}): ${err}.`); else n.v[f.name] = v; }
      else problems.push(`Node "${key}" (${d.id}) has no input "${k}".`);
    }
  }
  for (const e of plan.edges || []) {
    const split = s => { s = String(s || ''); const i = s.lastIndexOf('.'); return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)]; };
    const [fk, fo] = split(e.from), [tk, ti] = split(e.to);
    if (!keyToId[fk] || !keyToId[tk]) { problems.push(`Edge ${e.from} -> ${e.to}: unknown node key "${!keyToId[fk] ? fk : tk}".`); continue; }
    const src = nodeById(keyToId[fk]), dst = nodeById(keyToId[tk]);
    if (!def(src).outputs.some(o => o.name === fo)) { problems.push(`Edge ${e.from} -> ${e.to}: ${def(src).id} has no output "${fo}". Its outputs are: ${def(src).outputs.map(o => o.name).join(', ') || 'none'}.`); continue; }
    if (!def(dst).inputs.some(i => i.name === ti)) { problems.push(`Edge ${e.from} -> ${e.to}: ${def(dst).id} has no input "${ti}". Its inputs are: ${def(dst).inputs.map(i => i.name).join(', ') || 'none'}.`); continue; }
    if (edgeInto(dst.id, ti)) { problems.push(`Edge ${e.from} -> ${e.to}: input "${ti}" already has an edge.`); continue; }
    const why = canConnect(src.id, fo, dst.id, ti);
    if (why) { problems.push(`Edge ${e.from} -> ${e.to}: ${why}`); continue; }
    connect(src.id, fo, dst.id, ti);
  }
  const idToKey = Object.fromEntries(Object.entries(keyToId).map(([k, v]) => [v, k]));
  for (const n of S.nodes) for (const p of nodeIssues(n)) problems.push(`Node "${idToKey[n.id]}" (${def(n).id}): ${p}.`);
  return { problems, built: S.nodes.length };
}

/* ---------- providers ---------- */
async function aiFetch(url, opts, signal) {
  let res;
  try { res = await fetch(url, Object.assign({ signal }, opts)); }
  catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error(`Could not reach ${new URL(url).host}. Check the address and your connection. Some endpoints do not accept requests from web pages.`);
  }
  let body = null; const text = await res.text();
  try { body = JSON.parse(text); } catch (e) { /* not json */ }
  if (!res.ok) {
    const msg = (body && (body.error?.message || body.message || body.error)) || text.slice(0, 300) || res.statusText;
    if (res.status === 401 || res.status === 403) throw new Error(`The provider refused the API key (${res.status}): ${msg}`);
    if (res.status === 404) throw new Error(`Not found (404). Check the model name "${aiModel()}". ${msg}`);
    if (res.status === 429) throw new Error(`Rate limited or out of credit (429): ${msg}`);
    throw new Error(`${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  return body;
}
function aiHeaders() {
  const key = AI.keys[AI.settings.provider] || '';
  if (AI.settings.provider === 'anthropic') return { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
  const h2 = { 'content-type': 'application/json' };
  if (key) h2.authorization = 'Bearer ' + key;
  if (AI.settings.provider === 'compatible') { h2['HTTP-Referer'] = location.origin; h2['X-Title'] = 'Brightwind Workflow Builder'; }
  return h2;
}
async function aiListModels() {
  const prov = AI.settings.provider;
  const url = aiBase() + (prov === 'anthropic' ? '/models?limit=100' : '/models');
  const body = await aiFetch(url, { headers: aiHeaders() });
  let ids = (body.data || body.models || []).map(m => m.id || m.name).filter(Boolean);
  if (prov === 'openai') ids = ids.filter(id => /^(gpt|o\d|chatgpt)/.test(id) && !/(audio|realtime|transcribe|tts|image|search|embedding)/.test(id));
  return ids.sort();
}
/* Each driver runs one conversation: send(userText) -> {text, plan, reply(resultText)} */
function aiDriver(signal) {
  const prov = AI.settings.provider, model = aiModel(), sys = aiSystemPrompt();
  if (prov === 'anthropic') {
    const messages = [];
    const call = async () => {
      const body = await aiFetch(aiBase() + '/messages', { method: 'POST', headers: aiHeaders(), body: JSON.stringify({
        model, max_tokens: 16000, system: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }],
        tools: [{ name: AI_TOOL.name, description: AI_TOOL.description, input_schema: AI_TOOL.schema }], messages }) }, signal);
      messages.push({ role: 'assistant', content: body.content });
      const use = body.content.find(b => b.type === 'tool_use');
      return { text: body.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(), plan: use ? use.input : null, id: use && use.id, truncated: body.stop_reason === 'max_tokens' };
    };
    return {
      start: async t => { messages.push({ role: 'user', content: t }); return call(); },
      reply: async (id, t, isError) => { messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: t, is_error: isError }] }); return call(); },
    };
  }
  if (prov === 'openai') {
    let prev = null;
    const tools = [{ type: 'function', name: AI_TOOL.name, description: AI_TOOL.description, parameters: AI_TOOL.schema }];
    const call = async input => {
      const body = await aiFetch(aiBase() + '/responses', { method: 'POST', headers: aiHeaders(), body: JSON.stringify(Object.assign({ model, instructions: sys, input, tools }, prev ? { previous_response_id: prev } : {})) }, signal);
      prev = body.id;
      const out = body.output || [];
      const fc = out.find(o => o.type === 'function_call');
      const text = out.filter(o => o.type === 'message').flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('\n').trim();
      let plan = null; if (fc) { try { plan = JSON.parse(fc.arguments); } catch (e) { plan = { __bad: fc.arguments }; } }
      return { text, plan, id: fc && fc.call_id, truncated: body.status === 'incomplete' };
    };
    return {
      start: t => call([{ role: 'user', content: t }]),
      reply: (id, t) => call([{ type: 'function_call_output', call_id: id, output: t }]),
    };
  }
  const messages = [{ role: 'system', content: sys }];
  const tools = [{ type: 'function', function: { name: AI_TOOL.name, description: AI_TOOL.description, parameters: AI_TOOL.schema } }];
  const call = async () => {
    const body = await aiFetch(aiBase() + '/chat/completions', { method: 'POST', headers: aiHeaders(), body: JSON.stringify({ model, messages, tools }) }, signal);
    const ch = (body.choices || [])[0];
    if (!ch) throw new Error('The endpoint returned no answer.');
    const msg = ch.message || {};
    messages.push(msg);
    const tc = (msg.tool_calls || [])[0];
    let plan = null; if (tc) { try { plan = JSON.parse(tc.function.arguments); } catch (e) { plan = { __bad: tc.function.arguments }; } }
    return { text: (typeof msg.content === 'string' ? msg.content : '').trim(), plan, id: tc && tc.id, truncated: ch.finish_reason === 'length' };
  };
  return {
    start: async t => { messages.push({ role: 'user', content: t }); return call(); },
    reply: async (id, t) => { messages.push({ role: 'tool', tool_call_id: id, content: t }); return call(); },
  };
}

/* ---------- run ---------- */
async function aiBuild(prompt) {
  const editing = $('#aiEdit').checked && S.nodes.length > 0;
  const before = snapshot();
  const parts = [];
  const recent = AI.history.slice(-6);
  if (recent.length) parts.push('Earlier in this conversation:\n' + recent.map(m => `${m.role === 'user' ? 'User' : 'You'}: ${m.text}`).join('\n'));
  if (editing) parts.push('The board currently holds this pipeline. Change it as asked and send the complete updated graph:\n' + JSON.stringify(aiBoardAsPlan()));
  else parts.push('Start a new pipeline. The current board will be replaced.');
  parts.push('Request: ' + prompt);
  AI.history.push({ role: 'user', text: prompt });
  aiLogAdd('user', prompt);
  const ctl = new AbortController(); AI.busy = ctl; aiRenderState();
  const drv = aiDriver(ctl.signal);
  try {
    aiStatus('Waiting for ' + aiModel() + '…');
    let r = await drv.start(parts.join('\n\n'));
    for (let round = 1; ; round++) {
      if (!r.plan) {
        const msg = r.text || (r.truncated ? 'The answer was cut off before the pipeline was complete. Try a shorter request or a model with a larger output limit.' : 'The model did not return a pipeline.');
        AI.history.push({ role: 'assistant', text: msg }); aiLogAdd('assistant', msg); restore(before); renderAll(); break;
      }
      const res = r.plan.__bad ? { problems: ['The tool arguments were not valid JSON.'], built: 0 } : aiApply(r.plan);
      if (!res.problems.length || round >= AI.MAX_ROUNDS) {
        if (!res.built) { restore(before); renderAll(); aiLogAdd('error', 'The model could not produce a pipeline that fits the catalog. The board was left as it was.\n' + res.problems.slice(0, 6).join('\n')); break; }
        tidy(); commit(); renderAll(); fit();
        const summary = (r.plan.summary || r.text || 'Pipeline built.').trim();
        AI.history.push({ role: 'assistant', text: summary });
        aiLogAdd('assistant', summary, res.problems, round);
        if (isNarrow()) setView('canvas');
        break;
      }
      restore(before);
      aiStatus(`Fixing ${res.problems.length} problem${res.problems.length > 1 ? 's' : ''} (attempt ${round + 1} of ${AI.MAX_ROUNDS})…`);
      r = await drv.reply(r.id, 'The app could not build that graph:\n- ' + res.problems.join('\n- ') + '\nFix these and call build_pipeline again with the complete graph.', true);
    }
  } catch (e) {
    restore(before); renderAll();
    if (e.name === 'AbortError') aiLogAdd('error', 'Stopped. The board was left as it was.');
    else aiLogAdd('error', e.message || String(e));
  } finally {
    AI.busy = null; aiStatus(''); aiRenderState();
  }
}

/* ---------- UI ---------- */
function aiStatus(t) { const el = $('#aiStatus'); if (el) el.textContent = t; }
function aiLogAdd(role, text, problems, rounds) {
  const log = $('#aiLog');
  $('#aiEmpty') && $('#aiEmpty').remove();
  const item = h('div', { class: 'ai-msg ' + role },
    h('div', { class: 'who', text: role === 'user' ? 'You' : role === 'error' ? 'Problem' : aiModel() }),
    h('div', { class: 'txt', text }));
  if (role === 'assistant' && problems) {
    if (problems.length) item.append(h('div', { class: 'warn', text: `Built with ${problems.length} open item${problems.length > 1 ? 's' : ''}. Nodes with a red badge need input; the Python export marks them TODO.` }));
    else item.append(h('div', { class: 'ok', text: `Built ${S.nodes.length} nodes${rounds > 1 ? ` after ${rounds - 1} correction${rounds > 2 ? 's' : ''}` : ''}. Undo restores the previous board.` }));
  }
  log.append(item); log.scrollTop = log.scrollHeight;
}
function aiRenderState() {
  const p = aiProv(), busy = !!AI.busy, hasKey = !!AI.keys[AI.settings.provider] || AI.settings.provider === 'compatible';
  $('#aiProvider').value = AI.settings.provider;
  $('#aiModel').value = aiModel();
  $('#aiModel').placeholder = p.model || 'model id, e.g. a model listed by the endpoint';
  $('#aiKey').placeholder = p.keyHint;
  $('#aiKey').value = AI.keys[AI.settings.provider] || '';
  $('#aiBaseRow').hidden = AI.settings.provider !== 'compatible';
  $('#aiBase').value = AI.settings.baseUrl || AI.providers.compatible.baseUrl;
  $('#aiRemember').checked = !!AI.settings.remember;
  const link = $('#aiKeyLink'); link.hidden = !p.keyUrl; if (p.keyUrl) link.href = p.keyUrl;
  $('#aiSetupState').textContent = hasKey && aiModel() ? `${p.label.split(' (')[0]} · ${aiModel()}` : 'Not set up';
  $('#aiSetupState').className = 'pill ' + (hasKey && aiModel() ? 'ok' : 'bad');
  $('#aiGo').hidden = busy; $('#aiStop').hidden = !busy;
  $('#aiGo').disabled = !hasKey || !aiModel();
  $('#aiPrompt').disabled = busy;
  $('#aiEditRow').hidden = !S.nodes.length;
}
function aiExamples() { // the examples follow the libraries that are switched on
  const ex = $('#aiExamples'); if (!ex) return; ex.textContent = '';
  for (const t of examplePrompts()) ex.append(h('button', { type: 'button', class: 'chip', text: t, onclick: () => { $('#aiPrompt').value = t; $('#aiEdit').checked = false; $('#aiPrompt').focus(); } }));
}
function aiOpen(open) {
  const panel = $('#ai'); panel.hidden = !open;
  if (open) aiExamples();
  $('#aiBtn').setAttribute('aria-expanded', open);
  if (open) { aiRenderState(); const ready = !$('#aiGo').disabled; $('#aiSetup').open = !ready; (ready ? $('#aiPrompt') : $('#aiKey')).focus(); }
}
function setupAssistant() {
  aiLoad();
  const btn = $('#aiBtn');
  if (window.self !== window.top) { // inside claude.ai the page cannot reach other hosts
    btn.addEventListener('click', () => toast('Build with AI works on bw-explorer.coderenewables.com, where the page can reach your AI provider.'));
    return;
  }
  const sel = $('#aiProvider');
  for (const [k, p] of Object.entries(AI.providers)) sel.append(h('option', { value: k, text: p.label }));
  btn.addEventListener('click', () => aiOpen($('#ai').hidden));
  $('#aiClose').addEventListener('click', () => aiOpen(false));
  sel.addEventListener('change', () => { AI.settings.provider = sel.value; aiSave(); aiRenderState(); $('#aiModels').textContent = ''; });
  $('#aiModel').addEventListener('change', ev => { AI.settings.models[AI.settings.provider] = ev.target.value.trim(); aiSave(); aiRenderState(); });
  $('#aiKey').addEventListener('input', ev => { AI.keys[AI.settings.provider] = ev.target.value.trim(); aiSave(); aiRenderState(); });
  $('#aiBase').addEventListener('change', ev => { AI.settings.baseUrl = ev.target.value.trim(); aiSave(); });
  $('#aiRemember').addEventListener('change', ev => { AI.settings.remember = ev.target.checked; aiSave(); });
  $('#aiForget').addEventListener('click', () => { AI.keys = {}; aiSave(); aiRenderState(); toast('API keys removed from this browser.'); });
  $('#aiList').addEventListener('click', async () => {
    const b = $('#aiList'); b.disabled = true; b.textContent = 'Loading…';
    try {
      const ids = await aiListModels(), dl = $('#aiModels'); dl.textContent = '';
      for (const id of ids) dl.append(h('option', { value: id }));
      toast(ids.length ? `${ids.length} models available. Pick one from the model field.` : 'The endpoint listed no models.');
      $('#aiModel').focus();
    } catch (e) { toast(e.message); }
    finally { b.disabled = false; b.textContent = 'List models'; }
  });
  $('#aiForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const t = $('#aiPrompt').value.trim();
    if (!t || AI.busy) return;
    $('#aiPrompt').value = '';
    aiBuild(t);
  });
  $('#aiPrompt').addEventListener('keydown', ev => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); $('#aiForm').requestSubmit(); } });
  $('#aiStop').addEventListener('click', () => AI.busy && AI.busy.abort());
  aiExamples();
  window.__bw.ai = { AI, aiApply, aiBoardAsPlan, aiSystemPrompt, aiBuild };
}
