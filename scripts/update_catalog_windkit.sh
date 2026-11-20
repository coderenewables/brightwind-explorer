#!/usr/bin/env bash
# Rebuild public/catalog-windkit.json for the installed windkit, and check every curated node by
# calling it on sample data. Needs a Python with windkit, geopandas, rioxarray and plotly:
#   pip install windkit rioxarray plotly brightwind   (brightwind for the .tab sample made from its demo mast)
set -euo pipefail
cd "$(dirname "$0")"
PY=${PYTHON:-python}
RAW=$(mktemp -d)/raw_windkit.json
MPLBACKEND=Agg $PY -W ignore extract_api_windkit.py "$RAW"
fail=0
for f in windkit/specs/spec_*.json; do
  WINDKIT_RAW="$RAW" MPLBACKEND=Agg $PY -W ignore windkit/probe.py "$f" --quiet || fail=1
done
MPLBACKEND=Agg $PY -W ignore windkit/make_samples.py
$PY build_catalog_windkit.py "$RAW" windkit/specs ../public/catalog-windkit.json
[ $fail = 0 ] || { echo "Some probes failed; see above." >&2; exit 1; }
