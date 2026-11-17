#!/usr/bin/env bash
# Rebuild public/catalog.json from a brightwind release.
# Usage: scripts/update_catalog.sh [git ref, default: master]
set -euo pipefail
REF="${1:-master}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git clone --quiet --depth 1 --branch "$REF" https://github.com/brightwind-dev/brightwind "$TMP/brightwind"
COMMIT="$(git -C "$TMP/brightwind" rev-parse HEAD)"
VERSION="$(sed -n "s/^__version__ = '\(.*\)'/\1/p" "$TMP/brightwind/brightwind/__init__.py")"
python3 -I "$HERE/extract_api.py" "$TMP/brightwind/brightwind" "$TMP/raw.json"
python3 -I "$HERE/build_catalog.py" "$TMP/raw.json" "$HERE/../public/catalog.json" "$VERSION" "$COMMIT"
echo "catalog rebuilt for brightwind $VERSION ($COMMIT)"
