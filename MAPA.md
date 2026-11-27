# Mapa del sistema LegalTax Consultores

**Versión 1.1 · 27 de noviembre de 2026**

Este documento describe el sistema tal como está en esta versión: qué contiene cada carpeta y archivo, cómo se organiza la información, qué rutas expone el servidor y cómo instalarlo en un servidor propio.

**Novedades de la v1.1:** papelera de facturas (eliminar, restaurar y borrar definitivamente) e instalación en la nube subiendo el paquete ZIP, sin depender de GitHub. Las instrucciones paso a paso están en **`INSTALAR.txt`**.

En GitHub, cada versión cerrada tiene su rama: **`punto-de-corte-v1.1`** (esta) y `punto-de-corte-v1.0` (la anterior). No se modifican: los cambios nuevos van a `main`. Para volver a una versión exacta: `git checkout punto-de-corte-v1.1`.

Si además quiere una etiqueta o "Release" en GitHub: entre a *Releases → Draft a new release*, escriba `v1.1` como etiqueta y elija la rama `punto-de-corte-v1.1` como destino.

---

## 1. Visión general

```
                 ┌──────────────────────────────────────────────┐
  Navegador ───► │  Caddy / Nginx (HTTPS)  →  Node.js (Express)  │
  (equipo y      │                              src/server.js   │
   clientes)     │       ▲ archivos estáticos   │               │
                 │       │ public/ (interfaz)   ▼               │
                 │                       PostgreSQL (datos, RLS)│
                 │                       /var/lib/legaltax/     │
                 │                       storage/ (documentos)  │
                 └──────────────────────────────────────────────┘
        Servicios externos: Gmail (SMTP) · DGII (consulta de RNC y padrón)
```

- **Una sola aplicación web.** El equipo y los clientes entran con el navegador; el portal de clientes es parte de la misma aplicación.
- **Un solo servidor central.** La base de datos y los documentos son compartidos: lo que sube una persona lo ven las demás, y las pantallas se actualizan solas cada 15 segundos cuando alguien hace un cambio.
- **Seguridad en tres capas:**
  1. el servidor revisa el rol en cada ruta;
  2. PostgreSQL aplica seguridad por fila (RLS): un cliente solo ve sus registros publicados;
  3. cada descarga de archivo se verifica con el usuario que la pide.
- **Tecnología:** Node.js 20+, Express, PostgreSQL 14+, PDFKit (PDF), ExcelJS (Excel), Nodemailer (correo). La interfaz está hecha en JavaScript sin dependencias externas.

---

## 2. Estructura de archivos

```
legaltax/
├── MAPA.md                  ← este documento
├── INSTALAR.txt             ← instalación en un servidor en la nube subiendo el ZIP (paso a paso)
├── instalar.sh              ← lanza el instalador desde el paquete subido: bash instalar.sh
├── README.md                ← manual de uso, instalación y funciones
├── package.json             ← dependencias del servidor y comandos npm
├── .gitignore
│
├── src/                     ← SERVIDOR
│   ├── server.js            ← todas las rutas de la API (≈116), sesiones, permisos, carga de archivos
│   ├── services.js          ← lógica común: carpetas, numeración, cuentas, emisión y anulación de PDF
│   ├── db.js                ← conexión a PostgreSQL y contexto de seguridad por petición (RLS)
│   ├── pdf.js               ← diseño de todos los PDF (membrete, tablas, marcas ANULADO / VISTA PREVIA)
│   ├── mailer.js            ← envío por Gmail/SMTP, cifrado de claves, plantilla de correo con logo
│   ├── dgii.js              ← consulta de RNC en la DGII + importación del padrón oficial
│   ├── format.js            ← montos RD$, fechas de Santo Domingo, monto en letras
│   └── seed.js              ← crea o actualiza tablas, datos iniciales y migraciones (se ejecuta al arrancar)
│
├── db/
│   └── schema.sql           ← definición de la base de datos (27 tablas) y políticas de seguridad RLS
│
├── public/                  ← INTERFAZ (lo que ve el navegador)
│   ├── index.html
│   ├── app.js               ← todas las pantallas: panel, clientes, expedientes, carpetas, contabilidad…
│   ├── styles.css           ← identidad visual (marrón #876440, gris #D9D9D9)
│   └── brand/               ← logo, monograma e íconos
│
├── scripts/                 ← OPERACIÓN DEL SERVIDOR
│   ├── instalar-servidor.sh ← instalador de un comando para Ubuntu 22.04/24.04
│   ├── backup.sh            ← copia de seguridad (base de datos + todos los documentos)
│   ├── restore.sh           ← restaurar una copia
│   ├── usuarios.js          ← cargar usuarios del equipo desde un JSON
│   └── padron-dgii.js       ← actualizar el padrón de RNC de la DGII
│
├── config/
│   └── usuarios.ejemplo.json← modelo para cargar usuarios (copiar a usuarios.json, que no se sube a GitHub)
│
├── test/                    ← PRUEBAS AUTOMÁTICAS (navegador real con Playwright)
│   ├── e2e.js               ← recorrido completo: 61 verificaciones
│   ├── contabilidad.js      ← módulo Contabilidad: 16 verificaciones
│   ├── dgii.js              ← consulta de RNC con imitación de la DGII: 11 verificaciones
│   ├── papelera.js          ← papelera de facturas: 15 verificaciones
│   └── smtp-capture.js      ← servidor de correo de prueba
│
└── desktop/                 ← (opcional) programa de escritorio Windows que abre el sistema en su ventana
```

**Carpetas que se crean al instalar y no están en GitHub:** `node_modules/` (dependencias), `storage/` (documentos), `backups/` (copias) y `entrega/` (muestras).

---

## 3. Módulos del sistema (menú)

| Menú | Qué hace | Pantallas (app.js) | Rutas principales (server.js) |
|---|---|---|---|
| **Inicio** | Indicadores del día; cada uno abre su listado | `#/` | `GET /api/dashboard` |
| **Consultas** | Buscador global, filtros avanzados, consultas guardadas, exportar a Excel | `#/buscar`, `#/consultas` | `/api/search`, `/api/query/:entidad`, `/api/saved-queries` |
| **Clientes** | Personas y empresas; ficha con todo lo relacionado; **consulta de RNC en la DGII** | `#/clientes`, `#/clientes/:id` | `/api/clients…`, `/api/dgii/rnc/:num` |
| **Expedientes** | Documentos por tipo (se abre primero), línea de tiempo, plazos, solicitudes, PDF | `#/expedientes/:id` | `/api/cases…`, `/api/cases/:id/scans` |
| **📁 Carpetas** | Documentos LegalTax / Cliente / Expediente; carga de archivos; ZIP | `#/carpetas…` | `/api/folders…` |
| **📊 Contabilidad** | Accesos cifrados (Oficina Virtual DGII, TSS…), 606/607/IT-1/IR-2 por mes, reporte mensual | `#/contabilidad…` | `/api/tax/…`, `/api/clients/:id/credentials…` |
| **Agenda** | Audiencias, plazos y tareas con alertas | `#/agenda` | `/api/deadlines…` |
| **Cotizaciones** | Honorarios + ITBIS 18 %, plan de cuotas, publicación y aceptación | `#/cotizaciones…` | `/api/quotes…` |
| **Facturas** | Facturas por cuota o total (NCF/e-CF), estado de pago, anular; **🗑 Papelera**: eliminar con motivo, restaurar y borrar definitivamente | `#/facturas`, `#/facturas?state=papelera` | `/api/invoices…`, `POST /api/invoices/:id/delete`, `POST /api/invoices/:id/restore`, `DELETE /api/invoices/:id` |
| **Vouchers y pagos** | Validar o rechazar comprobantes; recibo automático | `#/pagos` | `/api/payments…` |
| **Solicitudes** | Pedir documentos al cliente | `#/solicitudes` | `/api/requests…` |
| **Documentos PDF** | Archivo de PDF emitidos, versiones, anulación, envío | `#/documentos…` | `/api/gendocs…` |
| **Avisos** | Correo o WhatsApp: aviso de pago, factura, estado, documento | (ventana en cada ficha) | `/api/notices…`, `/api/email…` |
| **Configuración** | Usuarios, membrete, plantillas, numeración, correo, tipos de documento, formatos fiscales, consulta DGII, auditoría | `#/admin?tab=…` | `/api/users…`, `/api/settings…`, `/api/tax/formats…`, `/api/dgii/…`, `/api/audit` |
| **Inicio de sesión** | Usuario o correo, bloqueo por intentos, contraseña temporal, Mi cuenta | `#/login`, `#/invitacion/:token` | `/api/login`, `/api/account/password`, `/api/password/forgot`, `/api/invite/:token` |
| **Portal del cliente** | Casos publicados, cotizaciones, cuotas, vouchers, facturas, documentos | `#/mis-…` | `/api/portal…` |

---

## 4. Base de datos (PostgreSQL: 27 tablas, más la de sesiones)

| Área | Tablas |
|---|---|
| Personas y acceso | `users`, `clients`, `api_tokens` |
| Expedientes | `cases`, `case_events`, `deadlines`, `doc_requests` |
| Documentos | `documents`, `doc_types`, `generated_docs` (PDF emitidos, inmutables y con versiones) |
| Cobros | `quotes`, `quote_items`, `installments`, `payments`, `invoices` (papelera: columnas `deleted_at`, `deleted_by`, `delete_reason`; sus PDF se marcan con `generated_docs.deleted`) |
| Contabilidad | `tax_formats`, `client_tax_formats`, `tax_filings`, `client_credentials` (claves cifradas) |
| DGII | `dgii_cache` (consultas de 30 días), `dgii_padron` (padrón oficial) |
| Comunicación | `notices` (avisos), `email_log` |
| Configuración | `settings` (membrete, correo), `templates`, `doc_sequences` (numeración), `saved_queries` |
| Control | `audit_log` (quién hizo qué y cuándo), `session` (sesiones, la crea el sistema) |

- **Seguridad por fila:** las políticas al final de `db/schema.sql` limitan al cliente a sus propios registros y solo a lo publicado.
- **Migraciones:** `src/seed.js` aplica `schema.sql`, que solo agrega lo que falta, y reorganiza archivos antiguos. Se ejecuta en cada arranque sin borrar datos.

---

## 5. Dónde quedan los documentos

```
<STORAGE_DIR>/Documentos LegalTax/
   └── <Cliente (RNC)>/
        ├── <EXP-2026-0001 - Asunto>/         documentos del expediente
        │     └── PDF emitidos/               informes, fichas, facturas del expediente
        ├── Documentos generales/             cédulas, RNC, poderes sin expediente
        ├── PDF emitidos/                     cotizaciones, recibos, estados de cuenta
        ├── Pagos y vouchers/                 comprobantes de pago
        └── Contabilidad/
              └── 2026-10 Octubre/            606, 607, acuses, IT-1…
<STORAGE_DIR>/Sistema/                       logo subido
```

Los nombres de archivo son legibles, por ejemplo `2026-11-09 Cédula de identidad - Cédula del representante.pdf`.

---

## 6. Instalación en un servidor propio

### Opción A: Ubuntu 22.04 / 24.04 (recomendada)

**A1 — Subiendo el paquete ZIP (sin GitHub).** Paso a paso en `INSTALAR.txt`. En resumen, como `root` en el servidor, después de subir el ZIP a `/root`:

```bash
apt-get update && apt-get install -y unzip
unzip LegalTax-v1.1-servidor.zip -d /root
bash /root/LegalTax-v1.1/instalar.sh
```

El instalador copia los archivos del paquete a `/opt/legaltax`. Para actualizar más adelante, se sube el ZIP nuevo, se descomprime y se ejecuta `legaltax-actualizar /root/<carpeta nueva>`: los documentos, la base de datos y la configuración se conservan.

**A2 — Descargando desde GitHub:**

```bash
curl -fsSL https://raw.githubusercontent.com/legaltaxconsultores/legaltax/main/scripts/instalar-servidor.sh | bash
```

El instalador pide el **dominio** (Enter = uno gratuito `IP.sslip.io`) y la **contraseña de Administración**. Luego instala PostgreSQL, Node.js 20 y Caddy con HTTPS. Además:
- crea la base de datos con usuarios separados para la app y para las copias;
- configura el servicio `legaltax` para que arranque solo;
- activa el firewall (puertos 22, 80 y 443);
- programa la copia de seguridad diaria (2:40 a. m.) y el padrón DGII semanal.

Hoy `main` y `punto-de-corte-v1.1` son la misma versión. Si instaló desde GitHub y quiere fijar el servidor en este punto de corte:

```bash
git -C /opt/legaltax fetch --depth 1 origin punto-de-corte-v1.1
git -C /opt/legaltax checkout -B punto-de-corte-v1.1 FETCH_HEAD
systemctl restart legaltax
```

Tenga en cuenta que `legaltax-actualizar` sin carpeta descarga siempre la última versión de `main`.

| Dónde | Qué |
|---|---|
| `/opt/legaltax` | Código |
| `/etc/legaltax.env` | Configuración y contraseñas internas (permisos 640) |
| `/var/lib/legaltax/storage` | Documentos |
| `/var/lib/legaltax/backups` | Copias de seguridad (se conservan 30) |
| `systemctl status legaltax` / `journalctl -u legaltax -n 50` | Estado y registros |
| `legaltax-actualizar /root/<carpeta>` | Actualizar con un paquete ZIP nuevo ya descomprimido |
| `legaltax-actualizar` | Actualizar a la última versión de GitHub |

### Opción B: cualquier otro servidor (Windows Server, otra distribución Linux, macOS)

1. **Instalar:** Node.js 20 o superior y PostgreSQL 14 o superior.
2. **Crear la base de datos.** El rol de la app **no** debe ser superusuario, para que la seguridad por fila funcione:
   ```sql
   CREATE ROLE legaltax LOGIN PASSWORD 'clave-segura';
   CREATE DATABASE legaltax OWNER legaltax;
   CREATE ROLE legaltax_backup LOGIN BYPASSRLS PASSWORD 'otra-clave';
   GRANT legaltax TO legaltax_backup;
   ```
3. **Descargar el código y las dependencias:** `git clone https://github.com/legaltaxconsultores/legaltax.git` (o descomprimir el ZIP), entrar a la carpeta y ejecutar `npm ci --omit=dev`.
4. **Configurar las variables de entorno** (tabla siguiente).
5. **Primer arranque:** `node src/seed.js`. Crea las tablas y la cuenta `admin` con `ADMIN_PASSWORD`.
6. **Arrancar:** `node src/server.js`. Para que arranque solo, usar un servicio del sistema (en Windows, NSSM o el Programador de tareas; en Linux, systemd).
7. **HTTPS:** colocar delante un proxy (Caddy, Nginx o IIS) que reenvíe a `http://localhost:3000`. Si solo se usa dentro de la oficina, se puede entrar por `http://IP:3000` con `COOKIE_SECURE` sin definir.
8. **Copias:** programar `scripts/backup.sh` (Linux/macOS) o un `pg_dump` más la copia de la carpeta `STORAGE_DIR` (Windows).

| Variable | Ejemplo | Para qué |
|---|---|---|
| `DATABASE_URL` | `postgres://legaltax:clave@localhost:5432/legaltax` | Conexión de la app |
| `BACKUP_DATABASE_URL` | `postgres://legaltax_backup:clave@localhost:5432/legaltax` | Copias de seguridad |
| `NODE_ENV` | `production` | Sin datos de prueba |
| `PORT` | `3000` | Puerto interno |
| `SESSION_SECRET` | (cadena larga aleatoria) | Sesiones y cifrado de claves (no cambiarla después) |
| `COOKIE_SECURE` | `1` | Solo si se sirve con HTTPS |
| `STORAGE_DIR` | `/var/lib/legaltax/storage` | Carpeta de documentos |
| `PUBLIC_URL` | `https://sistema.legaltax.do/` | Enlaces en los correos |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `legaltax.consultores@gmail.com` / … | Cuenta inicial (solo el primer arranque) |
| `SMTP_*` (opcional) | | Correo definido en el servidor en vez de en Configuración |
| `DGII_RNC_URL`, `DGII_PADRON_URL` (opcional) | | Cambiar las direcciones de la DGII si cambian |

### Después de instalar
1. Entrar con `admin` y la contraseña elegida.
2. **Configuración → Consulta DGII → Probar consulta.**
3. **Configuración → Correo:** pegar la contraseña de aplicación de Gmail.
4. **Configuración → Numeración:** registrar el rango NCF / e-CF autorizado por la DGII.
5. **Configuración → Usuarios:** crear el equipo, o cargar `config/usuarios.json` con `node scripts/usuarios.js config/usuarios.json`.

---

## 7. Qué incluye la versión 1.1

- Inicio de sesión con usuario o correo, bloqueo por intentos, contraseña temporal con cambio obligatorio y Mi cuenta.
- Roles: Administración, Equipo de expedientes, Cobros y Cliente.
- Clientes con **consulta de RNC/cédula en la DGII** (en línea y padrón de respaldo).
- Expedientes con documentos por tipo, línea de tiempo (interna o publicada), plazos y solicitudes.
- **Carpetas** por cliente y expediente en el disco del servidor, con descarga en ZIP.
- **Contabilidad:** accesos cifrados, declaraciones mensuales y anuales con archivos y acuses, y reporte mensual en PDF y Excel.
- Cotizaciones con ITBIS y cuotas, aceptación desde el portal, vouchers con validación, recibos y facturas con estado.
- **Papelera de facturas (nuevo en v1.1):** *Eliminar* (Administración y Cobros, con motivo obligatorio) quita la factura y su PDF de listas, saldos, avisos, carpetas y portal; la cuota se puede volver a facturar con un número nuevo (el NCF no se reutiliza). *Restaurar* la devuelve, salvo que la cuota ya tenga otra factura vigente. *Borrar definitivamente* (solo Administración, escribiendo el número para confirmar) elimina la factura y sus PDF del disco. Todo queda en la auditoría.
- PDF con membrete: cotización, recibo de dinero, recibo de documentos, estado de cuenta, informe de avance, fichas, factura y reporte contable. Se pueden emitir nuevas versiones y anular.
- Correo (Gmail): PDF, reportes, reporte diario, avisos automáticos y recordatorios de pago. Avisos por WhatsApp (wa.me).
- Portal del cliente, buscador global, consultas con exportación a Excel y auditoría completa.
- Copias de seguridad y restauración probadas, e instalador para servidor Ubuntu que funciona desde el ZIP subido o desde GitHub.
- Pruebas automáticas: **103 verificaciones** (61 + 16 + 11 + 15), todas correctas al cerrar este corte.

### Pendiente o fuera de este corte
- **Consulta DGII en línea sin probar contra la DGII real:** desde el entorno de desarrollo no había acceso. Se verifica con *Probar consulta* en el servidor.
- **Facturación electrónica e-CF:** la firma y el envío a la DGII no están incluidos. La factura PDF sirve como soporte de cobro.
- **Cartas y autorizaciones en Word, biblioteca jurídica, OCR de escaneados y API oficial de WhatsApp Business:** fases siguientes.
- **Rutas `/api/mobile/*`:** son el acceso por token de la app móvil, que se retiró. No se usan; se pueden quitar en una versión futura.

---

## 8. Comandos útiles (desarrollo)

```bash
npm install                 # dependencias
npm run reset               # base de datos de demostración desde cero (BORRA TODO)
npm start                   # servidor en http://localhost:3000
npm run test:e2e            # prueba completa (61 verificaciones)
node test/contabilidad.js   # prueba de Contabilidad (16)
node test/dgii.js           # prueba de consulta DGII (11)
node test/papelera.js       # prueba de la papelera de facturas (15)
npm run backup              # copia de seguridad
```

Usuarios de demostración (solo con `npm run reset`, nunca en producción): `admin`, `expedientes`, `cobros` y `finanzas@caribeazul.do`, con la contraseña `LegalTax2026!`.
