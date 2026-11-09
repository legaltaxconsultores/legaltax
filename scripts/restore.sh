#!/usr/bin/env bash
# Restaura una copia creada con backup.sh. REEMPLAZA los datos y archivos actuales.
# Uso: npm run restore -- backups/legaltax-AAAAMMDD-HHMM.tar.gz
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="${1:?Indique el archivo de copia}"
DB="${BACKUP_DATABASE_URL:-postgres://legaltax_backup:legaltax_backup@localhost:5432/legaltax}"
STORAGE="${STORAGE_DIR:-storage}"
if [ "${FORCE:-}" != "1" ]; then read -r -p "Esto reemplazará la base de datos y los archivos actuales. Escriba RESTAURAR para continuar: " ok; [ "$ok" = "RESTAURAR" ] || exit 1; fi
TMP="$(mktemp -d)"; tar -C "$TMP" -xzf "$FILE"
pg_restore --role=legaltax --clean --if-exists --no-owner --single-transaction --dbname="$DB" "$TMP/database.dump"
rm -rf "$STORAGE/files.prev"; [ -d "$STORAGE/files" ] && mv "$STORAGE/files" "$STORAGE/files.prev"
tar -C "$STORAGE" -xzf "$TMP/files.tar.gz"
rm -rf "$TMP"
echo "Restauración completada desde $FILE (archivos anteriores en $STORAGE/files.prev). Reinicie el servidor."
