# Curation spec for windkit functions

Each windkit function becomes a node in the builder. A spec file is a list of objects,
one per function. Every claim is checked by calling the function with probe.py.

## Object format

```json
{
  "path": "wk.bwc_from_tswc",
  "group": "Wind climates",
  "inputs": {"tswc": ["TSWC"]},
  "outputs": [{"name": "bwc", "types": ["BWC"]}],
  "fields": {"normalize": {"mode": "bool"}},
  "browser": "ok",
  "note": "",
  "probe": [{"args": {"tswc": "@TSWC", "n_sectors": "12"}}]
}
```

- `path`: exactly as given in the chunk.
- `group`: one of: "Wind climates", "Wind", "Weibull", "Spatial", "Topography", "Wind farm", "Read & write", "Checks", "Plots", "Data download".
  - read_* and *_to_file go to "Read & write"; is_*, validate_*, check_* go to "Checks"; wk.plot.* go to "Plots";
    functions that download data from the internet (get_era5, get_raster_map, get_vector_map, get_tutorial_data, load_tutorial_data) go to "Data download".
- `inputs`: ONLY the parameters that carry data objects (types from TYPES.md). Every other parameter is a field automatically.
  Keys must be real parameter names from the signature. Do not list *args/**kwargs.
- `outputs`: what the function returns, in order.
  - Single return value: one item. Name it in snake_case after what it is (e.g. "bwc", "map", "power").
  - Returns None (only writes a file or validates): `"outputs": []`.
  - Always returns a tuple: list each element in order and add `"tuple": true` at the top level.
  - Returns a tuple only when a flag parameter is True (e.g. `return_lctable=True` returns `(map, table)`):
    give the extra output `"flag": "<param name>"` and add `"order": ["map", "table"]` (tuple order when the flag is on).
  - `types` may list several types if the result genuinely depends on the input (e.g. same type as input). Prefer one.
    If the output always has the same type as a given input, add `"same": "<input name>"` and list the possible types.
- `fields`: OPTIONAL overrides for how a setting is edited. Default rules are applied automatically:
  default True/False -> checkbox; default a quoted string -> text box; anything else -> Python value box.
  Override only when useful:
  - `{"mode": "choice", "choices": ["elevation", "roughness", "landcover"]}` for a fixed set of strings (check the source for the allowed values);
  - `{"mode": "text"}` for a free-text string parameter whose default is None (e.g. a file name to write).
- `browser`: "ok" normally; "blocked" if it needs internet access or an external service; "plotly" if it returns a plotly figure.
- `note`: OPTIONAL, one plain-English sentence for the user when something is not obvious (e.g. "Needs internet access; not available in the browser runner."). Usually empty.
- `probe`: list of one or more test calls. Each `args` maps parameter names to either
  - `"@Type"` (or a sample key like `"@TSWC_2heights"`, `"@RasterMap_roughness"`, `"@VectorMap_roughness"`) for a sample object, or
  - a Python expression string evaluated with `np`, `pd`, `xr`, `wk`, `S` (all samples) and `TMP` (a temp folder path) available,
    e.g. `"12"`, `"'elevation'"`, `"[50.0, 100.0]"`, `"'EPSG:32629'"`, `"TMP + '/out.tab'"`, `"S['WTG']"`.
  The probe calls the function, classifies the result, and checks it against `outputs`. If you list several input types,
  add one probe per type when feasible to prove each is accepted.
- `skip_probe`: use instead of `probe` ONLY for functions that need the internet ("Data download") or files you cannot create.
  Give the reason. Read functions CAN be probed: write a file first with the matching *_to_file function in an earlier
  probe, or pass a file the samples can produce (e.g. `"args": {"filename": "TMP + '/bwc.tab'"}` after a probe of bwc_to_file
  wrote it; probes in one file run in order and share TMP).

## How to work

1. Read the chunk file you were given (signatures + docstrings).
2. For anything unclear, read the source: /home/claude/wkenv/lib/python3.13/site-packages/<module path from the chunk>.
   Validation decorators like `_tswc_validate_wrapper`, `_bwc_validate_wrapper`, `_wwc_validate_wrapper`, `_gwc_validate_wrapper`
   tell you the input type.
3. Write your JSON file.
4. Run the probe: `cd /home/claude/wkcat && MPLBACKEND=Agg /home/claude/wkenv/bin/python -W ignore probe.py <your file>`
5. Fix every FAIL (wrong types, bad probe args, wrong parameter names) and rerun until all PASS or are explained skips.
   Do not weaken a type just to pass: if a function really returns a WWC, say WWC.
