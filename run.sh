#!/usr/bin/env bash
# Lance la mise à jour des données puis sert le site sur http://localhost:8000
set -e; cd "$(dirname "$0")"
[ -d .venv ] || { python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt; }
.venv/bin/python -W ignore update_data.py
echo "→ http://localhost:${PORT:-8000}"; exec .venv/bin/python -m http.server "${PORT:-8000}"
