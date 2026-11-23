# brightwind-explorer

A browser tool for exploring two open-source wind resource libraries, [brightwind](https://github.com/brightwind-dev/brightwind) and [windkit](https://docs.wasp.dk/windkit) (DTU Wind Energy), and building analysis pipelines with either or both by drag and drop. The pipeline is exported as Python (a flat script, a `run()` function, or a Jupyter notebook) to run anywhere the libraries are installed.

Live at **https://bw-explorer.coderenewables.com**, one of the tools at [CodeRenewables](https://coderenewables.com).

The page is a static site, plus a small relay for one map API (see Notes). The catalogs of tools are built from the libraries ahead of time; pipelines are exported as Python, or run inside the browser through [Pyodide](https://pyodide.org). Data is never uploaded.

## What it does

- **Libraries**: the first visit asks whether to build with brightwind, windkit or both; buttons above the tool list change it. Only the switched-on libraries appear in the list, examples, type filter and AI assistant, and exports import only what they use.
- **Catalog**: every public `bw.*` function, class and method in brightwind 2.8.0 (153 tools in 14 groups), 200 windkit 2.2.0 functions, classes and methods (`wk.*`, `wk.spatial`, `wk.weibull`, `wk.ltc`, `wk.plot`, in 12 groups), and 16 helper nodes such as *Select column*, *File path*, *Demo dataset*, *Sample file* and *Select variable*. Each entry shows the signature, parameter docs, the full docstring and a link to the source line or the windkit documentation.
- **Board**: drag tools onto the canvas and wire outputs to inputs. Ports are typed (DataFrame, Series, Figure, Path, Value, object types such as `Shear.Average` or a fitted correlation model, and windkit's structures: wind climates such as `TSWC`, `BWC` and `WWC`, locations, raster and vector maps, turbines, xarray and geopandas data, plotly figures), and only compatible ports connect. windkit types form a hierarchy, so a `PWC` fits a `WWC` input and every wind climate fits a `Dataset` input. Selecting a node suggests the tools that accept its output.
- **Export**: functions that return `(plot, data)` when `return_data=True` are unpacked automatically when their data output is wired. Unconnected results are printed and figures shown. Parameters can be promoted to arguments of `run()`.
- **Examples**: brightwind: site overview with a WAsP tab file, cleaning plus shear extrapolation, long-term correlation against MERRA-2, and turbulence intensity. windkit: a wind climate with Weibull fit and wind rose, reading `.tab` and `.wtg` files, the Serra Santa Luzia tutorial site, terrain and roughness maps, and long-term correction with `LinRegMCP`. Both: mast data cleaned with brightwind and written as a WAsP `.tab` file by windkit.

- **Run in the browser**: the Run view executes the pipeline with brightwind 2.8.0 and windkit 2.2.0 on Pyodide 0.29.5 in a Web Worker, one node at a time. It shows tables, plots, interactive plotly figures, xarray summaries (with netCDF and CSV downloads) and printed output per step, marks nodes green or red, reads the user's own files through file pickers, and offers downloads for anything the pipeline writes. Each library and its dependencies load only when a pipeline first uses them.
- **Build with AI**: describe an analysis and a model wires it on the board, using your own Anthropic, OpenAI or OpenAI-compatible API key. The browser calls the provider directly; the key never touches this site. Problems the builder finds in the model's graph go back to the model to fix, up to three rounds.
- **Guide**: a full how-to at [/guide.html](https://bw-explorer.coderenewables.com/guide.html).

Pipelines autosave in the browser and can be copied out as JSON from *Save / load*.

## Layout

```
public/            the deployed site (index.html is generated; guide.html, guide/, catalog.json, py-worker.js and py/ are committed)
  py-worker.js       Web Worker that boots Pyodide and runs pipeline steps
  catalog-windkit.json  the windkit catalog, with its type hierarchy and sample file list
  py/                slim brightwind wheel, colormap wheel, gzip-compressed demo datasets, windkit, rioxarray and affine wheels,
                     a slim plotly wheel and plotly.min.js (built by scripts/build_py_assets.py)
  py/samples/        small windkit example files (built by scripts/windkit/make_samples.py)
worker/index.js      relay for data APIs a web page may not call directly (only /relay/* reaches it)
src/               page source: head.html (markup and styles), app.js, runner.js (Run view), assistant.js (Build with AI)
scripts/
  build_site.py        src/ -> public/index.html
  update_catalog.sh    rebuild public/catalog.json from a brightwind git ref
  extract_api.py       static parse of the brightwind source (no import needed)
  build_catalog.py     curated port types, groups and tuple returns
  verify_catalog.py    compare catalog signatures with an installed brightwind
  build_py_assets.py   rebuild public/py/ from the wheels on PyPI
  extract_api_windkit.py   introspect an installed windkit: signatures and numpydoc docstrings
  build_catalog_windkit.py curated windkit specs -> public/catalog-windkit.json
  update_catalog_windkit.sh extract, probe every spec, rebuild the windkit catalog
  windkit/             curation of the windkit catalog: specs/ (one JSON object per tool: port types, outputs, group),
                       probe.py (calls every tool on sample data and checks the declared types), samples.py, SPEC.md,
                       TYPES.md, make_samples.py
  guide_screenshots.py regenerate public/guide/*.jpg from a running dev server
wrangler.jsonc     Cloudflare Worker (static assets) and custom domain
```

## Develop

```bash
python3 scripts/build_site.py   # after editing src/
npm install
npm run dev                     # http://localhost:8787
```

## Update for a new brightwind release

```bash
scripts/update_catalog.sh v2.9.0          # any tag or branch of brightwind-dev/brightwind
pip install brightwind==2.9.0
python3 scripts/verify_catalog.py         # lists signatures that changed
```

New or renamed functions need an entry in `scripts/build_catalog.py`, which assigns port types and groups.

For the in-browser runner, also run `python3 scripts/build_py_assets.py 2.9.0` and update the wheel name in `public/py-worker.js`.

## Update for a new windkit release

```bash
pip install windkit==2.3.0 rioxarray plotly brightwind
PYTHON=python3 scripts/update_catalog_windkit.sh
```

The script extracts the API from the installed windkit, calls every curated tool on sample data (`scripts/windkit/probe.py`) and rebuilds `public/catalog-windkit.json`. A probe failure means windkit changed a signature or a return type: fix the spec in `scripts/windkit/specs/`, following `scripts/windkit/SPEC.md` and `TYPES.md`. New functions need a spec before they appear. Then update `WINDKIT` in `scripts/build_py_assets.py` and the wheel name in `public/py-worker.js`.

## How the in-browser runner works

- `public/py-worker.js` loads Pyodide **0.29.5** from jsDelivr. This version is pinned because it is the newest release that ships pandas 2.x (2.3.3); brightwind 2.8.0 requires pandas below 3.0, and Pyodide 314.x ships pandas 3.
- brightwind is installed from a slim copy of its wheel on this site (0.3 MB). The full wheel is 33 MB, over Cloudflare's 25 MiB per-file limit, because of its demo datasets. The large demo files are served gzip-compressed from `public/py/demo/` and fetched only when a pipeline uses them.
- `colormap` comes from its own wheel (Pyodide doesn't ship it). `gmaps` has no wheel, so the worker registers an empty module before importing brightwind; only `plot_meas_station_on_gmap` needs it, and the Run view blocks that node along with the BrightHub loaders.
- scikit-learn is not loaded: brightwind 2.8.0 doesn't import it.
- Each node becomes one step, run in a shared namespace. Unconnected results are rendered as tables (first 200 rows, full CSV on request), figures (PNG) or text. Files written to the working directory are offered for download.
- The four examples were checked against a native brightwind 2.8.0 install: correlation slope, offset, R² and long-term mean match to about 15 significant figures.
- windkit needs xarray, geopandas, rasterio, netCDF4, pyproj, lxml and fiona from Pyodide, plus rioxarray 0.20.0 (the last release that works with Pyodide's rasterio 1.4) and affine 3.0.1 (installed over the affine 2.4 that rasterio brings) from this site. pyproj is loaded on its own before rasterio, fiona and netCDF4; loaded together with them it crashes. h5py is not loaded, because its HDF5 library clashes with netCDF4's.
- plotly comes from a slim wheel on this site, and the page fetches `plotly.min.js` the first time a run returns an interactive figure. windkit's `plot.single_curve` uses `plotly.subplots` without importing it, so the runner and the exported scripts import it whenever a pipeline has plotly plots.
- Every windkit spec probe also passes inside Pyodide, so the browser's library versions return the same types.
- windkit's downloads in the browser: `requests` works in the worker as it is (urllib3 2.5 has a Pyodide backend), but a page can only read sites that allow it (CORS). Tutorial data comes from Zenodo's API file link, which allows it; the worker swaps it in for windkit's `?download=1` link and skips windkit's connection check against google.com. The Global Wind Atlas map API does not allow it, so `get_vector_map` goes through `worker/index.js`, a relay on this site that forwards only that one endpoint (GET, no credentials) and caches answers for a day. The tutorial maps are GeoPackages that windkit reads with pyogrio, which Pyodide lacks, so the worker falls back to fiona. `scripts/windkit/offline.py` stands in for both services in the probe.

## Deploy

The site is a Cloudflare Worker that serves `public/` as static assets and runs `worker/index.js` for `/relay/*` only, with `bw-explorer.coderenewables.com` attached as a custom domain in `wrangler.jsonc`. The repository is connected to Cloudflare Workers Builds, so every push to `main` deploys. To deploy by hand: `npx wrangler deploy`.

## Licence

MIT, see [LICENSE](LICENSE). The catalogs include docstrings from brightwind (MIT) and windkit (BSD 3-Clause, DTU Wind Energy), and `public/py/` redistributes several wheels: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
