# Probe windkit inside Pyodide

Runs every spec in `../specs/` with `../probe.py` inside the browser's Python, to catch differences between the
library versions Pyodide ships and a native install.

1. Make a folder with `probe.html`, the wheels from `public/py/` (windkit, rioxarray, affine, plotly), and a `wkp/`
   folder holding `probe.py`, `samples.py`, `raw_windkit.json` (from `extract_api_windkit.py`), the spec files and a
   `list.txt` naming the spec files.
2. Serve it (`python3 -m http.server 8790`) and open `probe.html` in a browser. Results appear on the page and in
   `window.OUT`. Each spec ends with a line like `23 entries: 23 PASS, 0 FAIL, 0 SKIP`.
