#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  LegalTax Consultores — instalador para un servidor Ubuntu 22.04 / 24.04
#  (DigitalOcean, Akamai/Linode, Hostinger VPS, Vultr o una PC de la oficina)
#
#  Uso, conectado al servidor como root:
#    curl -fsSL https://raw.githubusercontent.com/legaltaxconsultores/legaltax/main/scripts/instalar-servidor.sh | bash
#
#  Qué hace: instala PostgreSQL, Node.js 20 y Caddy (HTTPS automático), descarga
#  LegalTax, crea la base de datos y la cuenta de Administración, deja el sistema
#  arrancando solo, abre el firewall y programa una copia de seguridad diaria.
#  Se puede volver a ejecutar sin perder datos (actualiza el sistema).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="${LEGALTAX_REPO:-https://github.com/legaltaxconsultores/legaltax.git}"
APP_DIR=/opt/legaltax
DATA_DIR=/var/lib/legaltax
ENV_FILE=/etc/legaltax.env
TEST_MODE="${LEGALTAX_TEST:-0}"   # 1 = prueba sin systemd/firewall/Caddy (uso interno)
DB_NAME="${LEGALTAX_DB:-legaltax}"; DB_USER="${LEGALTAX_DB_USER:-legaltax}"; BK_USER="${DB_USER}_backup"

c_ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
c_step() { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }
c_err()  { printf '\033[1;31m✘ %s\033[0m\n' "$*" >&2; }
ask()    { local v; read -r -p "$1" v < /dev/tty || true; printf '%s' "$v"; }
ask_pw() { local v; read -r -s -p "$1" v < /dev/tty || true; echo > /dev/tty; printf '%s' "$v"; }
rand()   { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "${1:-32}"; }

[ "$(id -u)" = 0 ] || { c_err "Ejecute este instalador como root (o con sudo)."; exit 1; }
. /etc/os-release 2>/dev/null || true
[ "${ID:-}" = ubuntu ] || c_err "Aviso: este instalador está probado en Ubuntu; su sistema es ${PRETTY_NAME:-desconocido}."

echo
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║   Instalación de LegalTax Consultores SRL     ║"
echo "  ╚══════════════════════════════════════════════╝"

# ── datos de la instalación (solo la primera vez)
FIRST_INSTALL=1; [ -f "$ENV_FILE" ] && FIRST_INSTALL=0
if [ "$FIRST_INSTALL" = 1 ]; then
  PUBLIC_IP="$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
  DEFAULT_DOMAIN="$(echo "$PUBLIC_IP" | tr '.' '-').sslip.io"
  echo
  echo "Dirección web del sistema."
  echo "  • Si tiene un dominio (ej.: sistema.legaltax.do) apuntando a este servidor, escríbalo."
  echo "  • Si no, pulse Enter y se usará: $DEFAULT_DOMAIN"
  DOMAIN="${LEGALTAX_DOMAIN:-$(ask "Dominio [$DEFAULT_DOMAIN]: ")}"; DOMAIN="${DOMAIN:-$DEFAULT_DOMAIN}"
  ADMIN_EMAIL="${LEGALTAX_ADMIN_EMAIL:-legaltax.consultores@gmail.com}"
  ADMIN_PASSWORD="${LEGALTAX_ADMIN_PASSWORD:-}"
  while [ -z "$ADMIN_PASSWORD" ]; do
    echo; echo "Contraseña para entrar como Administración (usuario: admin)."
    echo "  Mínimo 8 caracteres, con letras y números. No se mostrará al escribirla."
    p1="$(ask_pw 'Contraseña: ')"; p2="$(ask_pw 'Repítala: ')"
    if [ "$p1" != "$p2" ]; then c_err "No coinciden. Intente de nuevo."; continue; fi
    if [ "${#p1}" -lt 8 ] || ! [[ "$p1" =~ [A-Za-z] ]] || ! [[ "$p1" =~ [0-9] ]]; then c_err "Debe tener 8+ caracteres con letras y números."; continue; fi
    ADMIN_PASSWORD="$p1"
  done
fi

export DEBIAN_FRONTEND=noninteractive
c_step "Instalando programas del sistema (PostgreSQL, Git, firewall)…"
apt-get update -qq
apt-get install -y -qq curl git ca-certificates gnupg postgresql postgresql-contrib ufw cron > /dev/null
c_ok "Programas del sistema instalados"

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  c_step "Instalando Node.js 20…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null
  apt-get install -y -qq nodejs > /dev/null
fi
c_ok "Node.js $(node -v)"

if [ "$TEST_MODE" != 1 ] && ! command -v caddy >/dev/null; then
  c_step "Instalando Caddy (certificado HTTPS automático)…"
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https > /dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg --yes
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy > /dev/null
  c_ok "Caddy instalado"
fi

# memoria de intercambio en servidores pequeños (1 GB de RAM)
if [ "$TEST_MODE" != 1 ] && [ "$(free -m | awk '/Mem:/{print $2}')" -lt 1800 ] && ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
  c_ok "Memoria de intercambio de 1 GB activada"
fi

c_step "Preparando usuario y carpetas…"
id legaltax >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin legaltax
mkdir -p "$DATA_DIR/storage" "$DATA_DIR/backups"
git config --global --get-all safe.directory 2>/dev/null | grep -qx "$APP_DIR" || git config --global --add safe.directory "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q origin main
  git -C "$APP_DIR" reset -q --hard origin/main
  c_ok "Sistema actualizado a la última versión ($(git -C "$APP_DIR" log -1 --format=%h))"
else
  rm -rf "$APP_DIR"; git clone -q --depth 1 "$REPO" "$APP_DIR"
  c_ok "Sistema descargado en $APP_DIR"
fi
ln -sfn "$DATA_DIR/backups" "$APP_DIR/backups"
chown -R legaltax:legaltax "$APP_DIR" "$DATA_DIR"

c_step "Configurando la base de datos…"
service postgresql start >/dev/null 2>&1 || systemctl start postgresql
if [ "$FIRST_INSTALL" = 1 ]; then
  DB_PASS="$(rand 28)"; BK_PASS="$(rand 28)"
  su postgres -c "psql -q" <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB_USER') THEN CREATE ROLE $DB_USER LOGIN NOSUPERUSER PASSWORD '$DB_PASS';
  ELSE ALTER ROLE $DB_USER LOGIN NOSUPERUSER PASSWORD '$DB_PASS'; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$BK_USER') THEN CREATE ROLE $BK_USER LOGIN BYPASSRLS PASSWORD '$BK_PASS';
  ELSE ALTER ROLE $BK_USER LOGIN BYPASSRLS PASSWORD '$BK_PASS'; END IF;
END \$\$;
GRANT $DB_USER TO $BK_USER;
SQL
  su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$DB_NAME'\"" | grep -q 1 || su postgres -c "createdb -O $DB_USER $DB_NAME"
  umask 077
  cat > "$ENV_FILE" <<ENV
# LegalTax — configuración del servidor (no compartir: contiene contraseñas)
NODE_ENV=production
PORT=3000
DATABASE_URL=postgres://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME
BACKUP_DATABASE_URL=postgres://$BK_USER:$BK_PASS@localhost:5432/$DB_NAME
APP_DB_ROLE=$DB_USER
SESSION_SECRET=$(rand 48)
COOKIE_SECURE=1
STORAGE_DIR=$DATA_DIR/storage
PUBLIC_URL=https://$DOMAIN/
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
LEGALTAX_DOMAIN=$DOMAIN
ENV
  chown root:legaltax "$ENV_FILE"; chmod 640 "$ENV_FILE"
  c_ok "Base de datos creada"
fi
set -a; . "$ENV_FILE"; set +a
DOMAIN="${LEGALTAX_DOMAIN}"

c_step "Instalando dependencias de LegalTax (1–3 minutos)…"
su -s /bin/bash legaltax -c "cd $APP_DIR && npm ci --omit=dev --no-audit --no-fund --loglevel=error" > /dev/null
c_ok "Dependencias instaladas"

c_step "Preparando el sistema (tablas, carpetas y cuenta de Administración)…"
su -s /bin/bash legaltax -c "set -a; . $ENV_FILE; set +a; cd $APP_DIR && node src/seed.js"
# la contraseña inicial ya no hace falta en el archivo de configuración
sed -i 's/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=/' "$ENV_FILE"

# comando de actualización
cat > /usr/local/bin/legaltax-actualizar <<'UPD'
#!/usr/bin/env bash
set -e
curl -fsSL https://raw.githubusercontent.com/legaltaxconsultores/legaltax/main/scripts/instalar-servidor.sh | bash
UPD
chmod +x /usr/local/bin/legaltax-actualizar

# copia de seguridad diaria 2:40 a. m. (hora de Santo Domingo), conserva 30
cat > /etc/cron.d/legaltax-backup <<CRON
CRON_TZ=America/Santo_Domingo
40 2 * * * legaltax bash -c 'set -a; . $ENV_FILE; set +a; cd $APP_DIR && bash scripts/backup.sh' >> $DATA_DIR/backups/backup.log 2>&1
CRON
c_ok "Copia de seguridad diaria programada (2:40 a. m.) en $DATA_DIR/backups"

if [ "$TEST_MODE" = 1 ]; then
  c_ok "Modo prueba: se omiten el servicio, el firewall y HTTPS"
  exit 0
fi

c_step "Dejando LegalTax funcionando siempre (se reinicia solo)…"
cat > /etc/systemd/system/legaltax.service <<UNIT
[Unit]
Description=LegalTax Consultores
After=network.target postgresql.service
Requires=postgresql.service

[Service]
User=legaltax
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStartPre=/usr/bin/node src/seed.js
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now postgresql >/dev/null 2>&1
systemctl enable legaltax >/dev/null 2>&1
systemctl restart legaltax
c_ok "Servicio legaltax activo"

c_step "Activando HTTPS para $DOMAIN…"
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
  encode gzip
  reverse_proxy localhost:3000
}
CADDY
systemctl enable caddy >/dev/null 2>&1; systemctl reload caddy 2>/dev/null || systemctl restart caddy
c_ok "Caddy configurado"

ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
c_ok "Firewall activo (solo SSH, 80 y 443)"

# verificación final
for i in $(seq 1 30); do curl -fsS -o /dev/null http://localhost:3000/api/me && break; sleep 2; done
if curl -fsS -o /dev/null http://localhost:3000/api/me; then c_ok "LegalTax responde correctamente"; else c_err "LegalTax no respondió. Revise con: journalctl -u legaltax -n 50"; fi

echo
echo "  ════════════════════════════════════════════════════════════"
echo "   ✔ LegalTax está instalado"
echo
echo "   Dirección:   https://$DOMAIN"
echo "   Usuario:     admin   (o $ADMIN_EMAIL)"
echo "   Contraseña:  la que escribió durante la instalación"
echo
echo "   El certificado HTTPS puede tardar 1–2 minutos la primera vez."
echo "   Actualizar el sistema más adelante:   legaltax-actualizar"
echo "   Ver registros si algo falla:          journalctl -u legaltax -n 50"
echo "   Copias de seguridad:                  $DATA_DIR/backups"
echo "  ════════════════════════════════════════════════════════════"
