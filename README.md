# LegalTax Consultores SRL: plataforma interna y portal de clientes

**LegalTax Consultores SRL** · RNC 1-33-19505-4 · Av. Rómulo Betancourt No. 517, Santo Domingo · (809) 363-9979 · legaltax.consultores@gmail.com

Identidad visual: marrón `#876440`, gris `#D9D9D9` y blanco. El logo está en `public/brand/logo.png` y el monograma en `public/brand/mark.png`.

Aplicación web privada para un despacho de asesoría legal y tributaria en República Dominicana. Tiene un panel interno, un portal de clientes, una base de datos PostgreSQL y un generador de PDF integrado. Está en español, con montos en RD$ y la hora de Santo Domingo (`America/Santo_Domingo`). Funciona en el celular y en la computadora.

## Arquitectura

| Capa | Tecnología |
|---|---|
| Servidor | Node.js 18+ y Express (`src/server.js`) |
| Base de datos | PostgreSQL 14+ relacional (`db/schema.sql`) con **seguridad a nivel de fila (RLS)** |
| Sesiones | Se guardan en PostgreSQL y persisten aunque se reinicie el servidor |
| Archivos | Carpeta privada `storage/files`. Nunca se sirven de forma pública: toda descarga pasa por `/api/files/:id` o `/api/gendocs/:id/pdf`, que verifican los permisos |
| PDF | PDFKit (`src/pdf.js`), con membrete, logo, pie de página, numeración y marcas de agua "VISTA PREVIA" y "ANULADO" |
| Excel | ExcelJS (exportación de consultas) |
| Interfaz | Aplicación de una página en JavaScript puro (`public/`), sin compilación |

### Seguridad en tres capas
1. **Servidor:** cada ruta exige un rol (`auth('admin','cobros')`, etc.).
2. **Base de datos:** en cada petición el servidor fija `app.role` y `app.client_id`. Las políticas RLS de PostgreSQL (con `FORCE ROW LEVEL SECURITY`) limitan al cliente a sus propios registros y solo a lo publicado: no ve borradores, notas internas, archivos privados ni PDF no compartidos. Aunque el código del servidor tuviera un error, la base de datos no devolvería datos ajenos.
3. **Descarga de archivos:** la búsqueda del archivo se hace con el contexto del usuario. Un enlace directo a un documento ajeno responde 404 y el intento queda en la auditoría como `acceso_denegado`.

Además: las contraseñas se guardan con bcrypt, la cookie de sesión es `httpOnly`, hay un límite de intentos de inicio de sesión, cabeceras de seguridad (CSP) y una **bitácora de auditoría** de cada cambio relevante (quién, qué, cuándo e IP).

## Instalación

```bash
# 1. Crear el rol y la base (el rol de la app NO debe ser superusuario, para que RLS aplique)
sudo -u postgres psql -c "CREATE ROLE legaltax LOGIN PASSWORD 'cambie-esto';" -c "CREATE DATABASE legaltax OWNER legaltax;"
# Rol solo para copias de seguridad (salta RLS para poder respaldar todo)
sudo -u postgres psql -c "CREATE ROLE legaltax_backup LOGIN BYPASSRLS PASSWORD 'cambie-esto-tambien';" -c "GRANT legaltax TO legaltax_backup;"

# 2. Dependencias, esquema y datos iniciales
npm install
export DATABASE_URL=postgres://legaltax:cambie-esto@localhost:5432/legaltax
npm run seed          # idempotente; `npm run reset` borra TODO y vuelve a sembrar

# 3. Iniciar
SESSION_SECRET=una-cadena-larga-aleatoria PORT=3000 npm start
```

Variables de entorno: `DATABASE_URL`, `BACKUP_DATABASE_URL`, `SESSION_SECRET`, `PORT`, `STORAGE_DIR`, `COOKIE_SECURE=1` (si se sirve detrás de HTTPS), `PUBLIC_URL` (dirección del portal para los avisos automáticos) y `DEMO_PASSWORD`.

Opcionalmente, la cuenta de correo puede definirse en el servidor con `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` y `SMTP_PASS`. Si no, se configura desde la app.

## Correo (Gmail)

En *Configuración → Correo*:
1. En la cuenta legaltax.consultores@gmail.com, activar la verificación en 2 pasos.
2. Crear una **contraseña de aplicación** en myaccount.google.com/apppasswords y pegarla en la app. Se guarda cifrada con AES-256-GCM, derivada de `SESSION_SECRET`; si cambia `SESSION_SECRET`, hay que volver a ingresarla.
3. Pulsar *Enviar correo de prueba*.

Qué se puede enviar al correo del despacho o a cualquier dirección:
- cualquier PDF emitido;
- cualquier consulta en Excel;
- el **reporte del día**: indicadores, vencimientos de 7 días, vouchers pendientes, pagos validados y Excel de cuentas por cobrar. Se envía manualmente o de forma automática de lunes a sábado a la hora configurada.

Avisos automáticos **al despacho**: cuando un cliente sube un voucher, acepta o rechaza una cotización, envía un documento solicitado, o cuando se genera una factura.

Avisos **al cliente**:
- pago recibido, con el recibo PDF, al validar el pago;
- factura generada, con el PDF;
- recordatorios de cuotas X días antes del vencimiento y al vencerse (una sola vez por cuota).

Todo queda en el historial de *Correos enviados* y en la ficha del cliente → *Avisos enviados*.

## Avisos por WhatsApp

Desde la ficha del cliente, cada pago, cada factura y cada PDF hay un botón **📣 Aviso / 💬 WhatsApp**. Abre una ventana con el mensaje ya redactado y editable para:
- aviso de pago, con las cuotas y el saldo;
- pago recibido;
- factura generada;
- estado de factura;
- envío de un documento;
- un mensaje libre.

Se puede enviar por correo (con el PDF adjunto) o abrir **WhatsApp** al número registrado del contacto. A los números 809, 829 y 849 se les agrega el código 1 automáticamente. WhatsApp se abre en el celular o en WhatsApp Web con el texto listo, y el usuario pulsa *Enviar*.

Este método (wa.me) no requiere cuenta de la API de Meta, pero no adjunta el PDF automáticamente: el cliente lo descarga del portal. Para envíos 100 % automáticos por WhatsApp se puede integrar más adelante la *WhatsApp Business Cloud API*, que requiere cuenta verificada en Meta y plantillas aprobadas.

## Facturas

En *Facturas* (y desde la cotización o la ficha del cliente → *Generar factura*):
- se factura una cuota o el total de una cotización aceptada;
- el ITBIS y los gastos se calculan de forma proporcional;
- el número sale de la secuencia **NCF / e-CF** de *Configuración → Numeración*, con prefijo (B01, E31…), número siguiente, "autorizado hasta" y fecha de vencimiento. La app bloquea la emisión si la secuencia se agota o vence;
- una cuota no puede facturarse dos veces.

El **estado** de cada factura se calcula con los pagos validados: Pendiente de pago, Pago parcial, Vencida o Pagada (o Anulada). El cliente lo ve en su portal (*Facturas*).

> Importante: desde 2026 la facturación electrónica (e-CF, Ley 32-23) es obligatoria. La factura PDF de LegalTax solo es válida para fines fiscales si el número fue autorizado por la DGII. Registre en la secuencia el rango e-CF asignado, o emita el e-CF oficial en su sistema autorizado (Facturador Gratuito de la DGII o un proveedor certificado) y use esta factura como soporte de cobro. La firma digital y el envío del e-CF a la DGII no están incluidos.

## Documentos escaneados por expediente

Cada expediente tiene la pestaña **📂 Documentos escaneados**:
- **Subir:** se toman fotos con la cámara del celular o se arrastran varios archivos (PDF, JPG o PNG; hasta 40 de 25 MB). A cada uno se le asigna su **tipo de documento** (cédula, RNC, registro mercantil, poder, resolución, acto de alguacil, IR-2, IT-1, estados financieros, etc.), título, número, fecha, nota y visibilidad.
- **Unir fotos:** varias fotos de un mismo documento pueden **unirse en un solo PDF** de varias páginas.
- **Consultar:** los documentos se muestran agrupados por tipo, con filtro por tipo, y se puede cambiar el tipo después. También aparecen en el buscador y en *Consultas → Archivos* (filtros "Tipo de documento" y "Solo escaneados").
- **Tipos:** la lista se administra en *Configuración → Tipos de documento*.
- **Privacidad:** los documentos privados no son visibles para el cliente; los marcados "Compartir con el cliente" aparecen en su portal.

En producción hay que servir la app detrás de HTTPS (Nginx o Caddy) y cambiar las contraseñas de demostración.

## Copias de seguridad y restauración

```bash
npm run backup                                           # backups/legaltax-AAAAMMDD-HHMM.tar.gz (BD + archivos); conserva las últimas 30
npm run restore -- backups/legaltax-AAAAMMDD-HHMM.tar.gz # pide escribir RESTAURAR; luego reinicie el servidor
```

Procedimiento recomendado:
1. Programar `npm run backup` todos los días con cron, por ejemplo: `40 2 * * * cd /srv/legaltax && npm run backup`.
2. Copiar `backups/` a un almacenamiento externo cifrado.
3. Una vez al mes, restaurar la última copia en un servidor de prueba y verificar el acceso.

La restauración reemplaza la base y los archivos. Los archivos anteriores se guardan en `storage/files.prev`.

## Aplicación de escritorio (Windows)

El sistema se usa **desde computadoras**. Cada persona del equipo instala la aplicación **LegalTax Consultores** (carpeta `desktop/`, hecha con Electron). Todas las instalaciones se conectan al **mismo servidor central**, así que comparten la base de datos y los documentos:

```
 Computadora 1 ─┐
 Computadora 2 ─┼──► Servidor LegalTax ──► PostgreSQL + documentos
 Computadora 3 ─┘    (Render en internet, o una PC de la oficina)
```

- Lo que sube o registra una persona lo ven las demás. Las pantallas se actualizan solas cada 15 segundos cuando alguien hace un cambio.
- La primera vez, la aplicación pide la **dirección del servidor**. Se puede cambiar en *Archivo → Cambiar servidor*.
- Recuerda el servidor y la sesión, y abre en su propia ventana con menú en español.
- Las descargas se guardan en `Descargas\LegalTax`, con aviso al terminar (clic para abrir).
- Los enlaces de WhatsApp y correo se abren en los programas del sistema.

**Instalador:** `LegalTax-Escritorio-Setup-1.0.0.exe`, en la sección *Releases* del repositorio en GitHub. Al no estar firmado digitalmente, Windows puede mostrar "Windows protegió su PC": pulse *Más información → Ejecutar de todas formas*.

**Generar el instalador de nuevo:**

```bash
cd desktop
npm install
npm run build:win
```

En Linux, este paso requiere Wine.

**Servidor en una computadora de la oficina (alternativa a Render):** instale Node.js 20+ y PostgreSQL en una PC que permanezca encendida. Luego ejecute `npm install`, `node src/seed.js` y `npm start` (con `NODE_ENV=production` y `ADMIN_PASSWORD`). Las demás computadoras se conectan a `http://IP-de-esa-PC:3000`. Este servidor solo es accesible dentro de la red de la oficina.

## Inicio de sesión y usuarios

- **Cómo se entra:** con el **nombre de usuario** (por ejemplo `jperez`) o con el **correo**, más la contraseña. Hay un botón 👁 para ver lo escrito y un aviso si Bloq Mayús está activado.
- **"Mantener la sesión iniciada en esta computadora":** la sesión dura 30 días; sin marcarlo, 8 horas.
- **Mensajes de error claros:** usuario inexistente, contraseña incorrecta (con los intentos que quedan), cuenta desactivada o sin activar.
- **Bloqueo por intentos:** tras **5 intentos fallidos**, el usuario queda bloqueado 15 minutos. Administración puede desbloquearlo desde *Configuración → Usuarios*.
- **Contraseña temporal:** al crear un usuario, Administración le asigna una contraseña temporal. En el primer ingreso el sistema **obliga a cambiarla** por una personal (mínimo 8 caracteres, con letras y números) y no deja usar nada más hasta hacerlo.
- **"Mi cuenta":** en el menú lateral, para cambiar la propia contraseña cuando se quiera.
- **"¿Olvidó su contraseña?":** envía un enlace por correo si el correo está configurado; si no, indica que hay que pedirlo a Administración.

**Cargar los usuarios del despacho:** copie `config/usuarios.ejemplo.json` a `config/usuarios.json` con los datos reales (nombre, correo, usuario, rol `admin` / `expedientes` / `cobros`, contraseña temporal) y ejecute:

```bash
node scripts/usuarios.js config/usuarios.json
```

En Render se ejecuta desde la pestaña **Shell** del servicio. También se pueden crear uno por uno desde *Configuración → Usuarios*. No suba `config/usuarios.json` a GitHub, porque contiene contraseñas.

## Usuarios de la versión de prueba

Todos usan la contraseña **`LegalTax2026!`**

| Rol | Correo |
|---|---|
| Administración | admin@legaltax.do |
| Equipo de expedientes | expedientes@legaltax.do |
| Cobros | cobros@legaltax.do |
| Cliente 2 (persona física, ficticio) | maria.pena@example.com |
| Cliente 1 (empresa, ficticio) | finanzas@caribeazul.do. Se crea durante el recorrido mediante una invitación |

En la versión de prueba, Constructora Caribe Azul ya tiene datos del recorrido automático: expediente, documentos escaneados, cotización aceptada, abono validado, factura B0100000001 y avisos.

## Recorrido de prueba por rol

**Equipo de expedientes** (`expedientes@legaltax.do`)
1. *Clientes → + Nuevo cliente*: crear la empresa "Constructora Caribe Azul, SRL", RNC 1-31-45678-9.
2. En la ficha, *+ Expediente*: "Recurso de reconsideración — Ajuste ITBIS 2024", institución DGII.
3. En el expediente:
   - *Línea de tiempo*: registrar una actuación publicada al cliente y otra interna.
   - *Archivos*: adjuntar la resolución con el número `RES-DGII-2026-01234` y visibilidad "Compartir con el cliente".
4. Escribir `RES-DGII-2026-01234` en el buscador superior: aparece la resolución. Buscar `131456789` (RNC sin guiones): aparece la empresa.
5. Ficha del cliente → *Acceso al portal → + Invitar al portal*: copiar el enlace.
6. *+ Cotización*: honorarios de 50,000 y gastos de 5,000, ITBIS 18 % (total RD$ 64,000.00), 2 cuotas. Guardar y luego *Publicar al cliente*. Se emite el PDF.

**Cliente** (abrir el enlace de invitación y crear la contraseña)
7. *Cotizaciones → Revisar y aceptar → Aceptar cotización*.
8. *Cuotas y pagos → Subir voucher*: RD$ 20,000, transferencia, con una imagen o PDF. El comprobante queda **pendiente** y el saldo sigue en RD$ 64,000.00.

**Cobros** (`cobros@legaltax.do`)
9. *Vouchers y pagos → Validar*: se puede ajustar el monto si el abono es parcial. Se emite el recibo `REC-…` y el saldo baja a RD$ 44,000.00. Validar de nuevo el mismo voucher devuelve un error (no se registra dos veces).
10. Para anular un recibo, ir a *Documentos PDF → detalle → Anular* (con motivo obligatorio). El pago se anula y el saldo se restablece.

**Cliente otra vez**
11. *Cuotas y pagos*: muestra el saldo de RD$ 44,000.00 y el botón *Recibo PDF*. Cerrar sesión, volver a entrar y comprobar que el recibo sigue ahí.

**Segundo cliente** (`maria.pena@example.com`)
12. Solo ve su propio expediente. Al abrir `/api/files/<id de la resolución de Caribe Azul>` o `/api/gendocs/<id del recibo>/pdf` recibe **404**.

**Administración** (`admin@legaltax.do`), en *Configuración*:
- usuarios y roles, con enlaces de invitación o restablecimiento;
- membrete y logo;
- plantillas, con los campos `{cliente}`, `{expediente}`, `{numero}`, `{fecha}`, `{monto}` y `{despacho}`;
- numeración por tipo de documento;
- auditoría;
- copias de seguridad.

### Prueba automática
```bash
npm run reset && npm start   # en otra terminal:
npm run test:e2e             # recorre todo lo anterior en el navegador y guarda capturas y PDF en test/output
# con verificación de correos (54 verificaciones): servidor SMTP local de prueba
node test/smtp-capture.js test/output/mail &
MAIL_DIR=test/output/mail npm run test:e2e
```

## Qué incluye esta primera versión

- **Inicio de sesión, roles y portal por invitación.** Cada invitación vence en 7 días.
- **Panel de inicio** con indicadores que abren su listado: expedientes activos, vencimientos próximos, tareas atrasadas, cotizaciones pendientes, vouchers por validar, saldo por cobrar y solicitudes abiertas.
- **Clientes** (personas físicas y empresas). Cada ficha muestra sus expedientes, cotizaciones, cuotas y pagos, archivos, solicitudes, PDF emitidos y usuarios del portal.
- **Expedientes** con una línea de tiempo que separa las notas internas de las actualizaciones publicadas al cliente. Incluyen archivos (resoluciones con número e institución), plazos y solicitudes.
- **Agenda:** audiencias, reuniones, plazos y tareas, con responsable, fecha confirmada, días de alerta y acuses adjuntos.
- **Cotizaciones:**
  - ITBIS del 18 % calculado sobre los honorarios menos el descuento;
  - gastos sin ITBIS;
  - cuotas configurables (mensual, quincenal o semanal, editables);
  - flujo de borrador, publicación, aceptación desde el portal o registrada por el equipo, y anulación.
- **Vouchers y pagos:**
  - los comprobantes entran como pendientes;
  - Cobros los valida o los rechaza con motivo;
  - se admiten abonos parciales y se bloquea el pago que exceda el saldo;
  - la misma validación no puede registrarse dos veces (bloqueo de fila e índice único por recibo).
- **Solicitudes de documentos** con estados pendiente, recibida y devuelta para corrección, y respuesta del cliente con archivo.
- **Buscador global** por nombre, cédula o RNC (con o sin guiones), código de expediente, número oficial, número de resolución, institución, período, cotización, número de PDF y referencia de pago.
- **Centro de consultas** con filtros para expedientes, archivos, pagos, cuentas por cobrar, vencimientos y cotizaciones. Permite guardar consultas frecuentes y exportar a Excel (la exportación queda en la auditoría).
- **PDF:**
  - documentos: cotización, recibo de dinero, recibo de entrega o recepción de documentos, estado de cuenta, informe de avance, ficha de cliente y ficha de expediente;
  - permite vista previa, archivo, compartir con el cliente, nuevas versiones con el mismo número y anulación con motivo;
  - **cada copia emitida guarda sus datos tal como se emitió** (copia inmutable), así que editar la ficha del cliente no la altera.

## Pendiente para fases siguientes
- Cartas, autorizaciones y solicitudes con descarga en Word (la dependencia `docx` ya está instalada) y el reporte interno en PDF.
- Biblioteca jurídica y tributaria, con permisos separados para documentos públicos de referencia.
- Búsqueda en el texto de los PDF y OCR para expedientes escaneados.
- Envío automático de la invitación al portal por correo (hoy el enlace se copia y se comparte manualmente).
- WhatsApp Business Cloud API para envíos automáticos con adjuntos.
- Emisión y firma del e-CF directamente ante la DGII.
