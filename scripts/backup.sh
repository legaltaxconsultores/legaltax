#!/usr/bin/env bash
# Copia de seguridad completa: base de datos (pg_dump) + todos los documentos
# (carpetas "Documentos LegalTax", archivos del sistema y archivos antiguos).
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${BACKUP_DATABASE_URL:-postgres://legaltax_backup:legaltax_backup@localhost:5432/legaltax}"
STORAGE="${STORAGE_DIR:-storage}"
STAMP="$(TZ=America/Santo_Domingo date +%Y%m%d-%H%M)"
mkdir -p backups; TMP="$(mktemp -d)"
pg_dump --no-owner --format=custom --file="$TMP/database.dump" "$DB"
tar -C "$STORAGE" --exclude=./tmp --exclude=./files.prev --exclude=./storage.prev -czf "$TMP/storage.tar.gz" .
echo "LegalTax backup $STAMP" > "$TMP/README.txt"
OUT="backups/legaltax-$STAMP.tar.gz"
tar -C "$TMP" -czf "$OUT" database.dump storage.tar.gz README.txt
rm -rf "$TMP"
# conservar las últimas 30 copias
ls -1t backups/legaltax-*.tar.gz | tail -n +31 | xargs -r rm --
echo "Copia creada: $OUT ($(du -h "$OUT" | cut -f1))"
