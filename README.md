# brightwind-explorer

A browser tool for exploring the [brightwind](https://github.com/brightwind-dev/brightwind) wind resource assessment library and building analysis pipelines by drag and drop. The pipeline is exported as Python (a flat script, a `run()` function, or a Jupyter notebook) to run anywhere brightwind is installed.

Live at **https://bw-explorer.coderenewables.com**, one of the tools at [CodeRenewables](https://coderenewables.com).

The page is a static site. The catalog of tools is read from the brightwind source ahead of time; pipelines are exported as Python, or run with brightwind inside the browser through [Pyodide](https://pyodide.org). Data is never uploaded.

## What it does

- **Catalog**: every public `bw.*` function, class and method in brightwind 2.8.0 (153 tools in 14 groups) plus helper nodes such as *Select column*, *File path* and *Demo dataset*. Each entry shows the signature, parameter docs, the full docstring and a link to the source line.
- **Board**: drag tools onto the canvas and wire outputs to inputs. Ports are typed (DataFrame, Series, Figure, Path, Value, and object types such as `Shear.Average` or a fitted correlation model), and only compatible ports connect. Selecting a node suggests the tools that accept its output.
- **Export**: functions that return `(plot, data)` when `return_data=True` are unpacked automatically when their data output is wired. Unconnected results are printed and figures shown. Parameters can be promoted to arguments of `run()`.
- **Examples**: site overview with a WAsP tab file, cleaning plus shear extrapolation, long-term correlation against MERRA-2, and turbulence intensity.

- **Run in the browser**: the Run view executes the pipeline with brightwind 2.8.0 on Pyodide 0.29.5 in a Web Worker, one node at a time. It shows tables, plots and printed output per step, marks nodes green or red, reads the user's own files through file pickers, and offers downloads for anything the pipeline writes.
- **Build with AI**: describe an analysis and a model wires it on the board, using your own Anthropic, OpenAI or OpenAI-compatible API key. The browser calls the provider directly; the key never touches this site. Problems the builder finds in the model's graph go back to the model to fix, up to three rounds.
- **Guide**: a full how-to at [/guide.html](https://bw-explorer.coderenewables.com/guide.html).

Pipelines autosave in the browser and can be copied out as JSON from *Save / load*.

## Layout

```
public/            the deployed site (index.html is generated; guide.html, guide/, catalog.json, py-worker.js and py/ are committed)
  py-worker.js       Web Worker that boots Pyodide and runs pipeline steps
  py/                slim brightwind wheel, colormap wheel, gzip-compressed demo datasets (built by scripts/build_py_assets.py)
src/               page source: head.html (markup and styles), app.js, runner.js (Run view), assistant.js (Build with AI)
scripts/
  build_site.py        src/ -> public/index.html
  update_catalog.sh    rebuild public/catalog.json from a brightwind git ref
  extract_api.py       static parse of the brightwind source (no import needed)
  build_catalog.py     curated port types, groups and tuple returns
  verify_catalog.py    compare catalog signatures with an installed brightwind
  build_py_assets.py   rebuild public/py/ from the brightwind and colormap wheels on PyPI
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

## How the in-browser runner works

- `public/py-worker.js` loads Pyodide **0.29.5** from jsDelivr. This version is pinned because it is the newest release that ships pandas 2.x (2.3.3); brightwind 2.8.0 requires pandas below 3.0, and Pyodide 314.x ships pandas 3.
- brightwind is installed from a slim copy of its wheel on this site (0.3 MB). The full wheel is 33 MB, over Cloudflare's 25 MiB per-file limit, because of its demo datasets. The large demo files are served gzip-compressed from `public/py/demo/` and fetched only when a pipeline uses them.
- `colormap` comes from its own wheel (Pyodide doesn't ship it). `gmaps` has no wheel, so the worker registers an empty module before importing brightwind; only `plot_meas_station_on_gmap` needs it, and the Run view blocks that node along with the BrightHub loaders.
- scikit-learn is not loaded: brightwind 2.8.0 doesn't import it.
- Each node becomes one step, run in a shared namespace. Unconnected results are rendered as tables (first 200 rows, full CSV on request), figures (PNG) or text. Files written to the working directory are offered for download.
- The four examples were checked against a native brightwind 2.8.0 install: correlation slope, offset, R² and long-term mean match to about 15 significant figures.

## Deploy

The site is a Cloudflare Worker that serves `public/` as static assets, with `bw-explorer.coderenewables.com` attached as a custom domain in `wrangler.jsonc`. The repository is connected to Cloudflare Workers Builds, so every push to `main` deploys. To deploy by hand: `npx wrangler deploy`.

## Licence

MIT, see [LICENSE](LICENSE). The catalog includes docstrings from brightwind, also MIT: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
