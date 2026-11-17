# brightwind-explorer

A browser tool for exploring the [brightwind](https://github.com/brightwind-dev/brightwind) wind resource assessment library and building analysis pipelines by drag and drop. The pipeline is exported as Python (a flat script, a `run()` function, or a Jupyter notebook) to run anywhere brightwind is installed.

Live at **https://bw-explorer.coderenewables.com**, one of the tools at [CodeRenewables](https://coderenewables.com).

Nothing runs in the browser. The page is a static site: the catalog of tools is read from the brightwind source ahead of time, and the board only writes code.

## What it does

- **Catalog**: every public `bw.*` function, class and method in brightwind 2.8.0 (153 tools in 14 groups) plus helper nodes such as *Select column*, *File path* and *Demo dataset*. Each entry shows the signature, parameter docs, the full docstring and a link to the source line.
- **Board**: drag tools onto the canvas and wire outputs to inputs. Ports are typed (DataFrame, Series, Figure, Path, Value, and object types such as `Shear.Average` or a fitted correlation model), and only compatible ports connect. Selecting a node suggests the tools that accept its output.
- **Export**: functions that return `(plot, data)` when `return_data=True` are unpacked automatically when their data output is wired. Unconnected results are printed and figures shown. Parameters can be promoted to arguments of `run()`.
- **Examples**: site overview with a WAsP tab file, cleaning plus shear extrapolation, long-term correlation against MERRA-2, and turbulence intensity.

- **Build with AI**: describe an analysis and a model wires it on the board, using your own Anthropic, OpenAI or OpenAI-compatible API key. The browser calls the provider directly; the key never touches this site. Problems the builder finds in the model's graph go back to the model to fix, up to three rounds.
- **Guide**: a full how-to at [/guide.html](https://bw-explorer.coderenewables.com/guide.html).

Pipelines autosave in the browser and can be copied out as JSON from *Save / load*.

## Layout

```
public/            the deployed site (index.html is generated; guide.html, guide/ and catalog.json are committed)
src/               page source: head.html (markup and styles), app.js, assistant.js (Build with AI)
scripts/
  build_site.py        src/ -> public/index.html
  update_catalog.sh    rebuild public/catalog.json from a brightwind git ref
  extract_api.py       static parse of the brightwind source (no import needed)
  build_catalog.py     curated port types, groups and tuple returns
  verify_catalog.py    compare catalog signatures with an installed brightwind
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

## Deploy

The site is a Cloudflare Worker that serves `public/` as static assets, with `bw-explorer.coderenewables.com` attached as a custom domain in `wrangler.jsonc`. The repository is connected to Cloudflare Workers Builds, so every push to `main` deploys. To deploy by hand: `npx wrangler deploy`.

## Licence

MIT, see [LICENSE](LICENSE). The catalog includes docstrings from brightwind, also MIT: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
