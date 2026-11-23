#!/usr/bin/env bash
# Restaura um backup em um banco VAZIO. Uso: DATABASE_URL=... scripts/restore.sh arquivo.dump
set -euo pipefail
: "${DATABASE_URL:?defina DATABASE_URL}"
file="${1:?informe o arquivo .dump}"
pg_restore --no-owner --exit-on-error --single-transaction --dbname="$DATABASE_URL" "$file"
echo "restauração ok: $file"
