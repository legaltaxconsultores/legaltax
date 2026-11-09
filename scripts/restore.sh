#!/usr/bin/env bash
# Restaura una copia creada con backup.sh. REEMPLAZA los datos y documentos actuales.
# Uso: npm run restore -- backups/legaltax-AAAAMMDD-HHMM.tar.gz
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="${1:?Indique el archivo de copia}"
DB="${BACKUP_DATABASE_URL:-postgres://legaltax_backup:legaltax_backup@localhost:5432/legaltax}"
STORAGE="${STORAGE_DIR:-storage}"
APP_ROLE="${APP_DB_ROLE:-legaltax}"
if [ "${FORCE:-}" != "1" ]; then read -r -p "Esto reemplazará la base de datos y los documentos actuales. Escriba RESTAURAR para continuar: " ok; [ "$ok" = "RESTAURAR" ] || exit 1; fi
TMP="$(mktemp -d)"; tar -C "$TMP" -xzf "$FILE"
pg_restore --role="$APP_ROLE" --clean --if-exists --no-owner --single-transaction --dbname="$DB" "$TMP/database.dump"
PREV="$STORAGE.prev"; rm -rf "$PREV"; mkdir -p "$PREV"
find "$STORAGE" -mindepth 1 -maxdepth 1 ! -name tmp -exec mv {} "$PREV"/ \;
if [ -f "$TMP/storage.tar.gz" ]; then tar -C "$STORAGE" -xzf "$TMP/storage.tar.gz"
else tar -C "$STORAGE" -xzf "$TMP/files.tar.gz"; fi   # copias antiguas (solo carpeta files)
rm -rf "$TMP"
echo "Restauración completada desde $FILE (documentos anteriores en $PREV). Reinicie el servidor."
