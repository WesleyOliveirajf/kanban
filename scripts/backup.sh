#!/usr/bin/env bash
# Backup lógico do Postgres. Uso: DATABASE_URL=... scripts/backup.sh [diretório] [dias-de-retenção]
set -euo pipefail
: "${DATABASE_URL:?defina DATABASE_URL}"
dir="${1:-backups}"; keep="${2:-30}"
mkdir -p "$dir"
file="$dir/kanban-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --no-owner --file="$file.tmp" "$DATABASE_URL"
mv "$file.tmp" "$file"
pg_restore --list "$file" >/dev/null   # confirma que o arquivo é legível
find "$dir" -name 'kanban-*.dump' -mtime +"$keep" -delete
echo "backup ok: $file"
