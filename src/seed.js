// Crea el esquema, la configuración inicial y los usuarios de demostración.
// Uso: node src/seed.js            (idempotente: no duplica datos)
//      node src/seed.js --reset    (BORRA todos los datos y archivos y vuelve a sembrar)
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool, withCtx, SYSTEM } = require('./db');
const S = require('./services');

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'LegalTax2026!';
// Modo demostración: usuarios y clientes ficticios. En producción (NODE_ENV=production) no se crean, salvo SEED_DEMO=1.
const DEMO = process.env.SEED_DEMO ? process.env.SEED_DEMO === '1' : process.env.NODE_ENV !== 'production';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'legaltax.consultores@gmail.com').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

async function main() {
  if (process.argv.includes('--reset')) {
    await pool.query(`DROP TABLE IF EXISTS notices, invoices, email_log, doc_types, audit_log, saved_queries, generated_docs, doc_requests, payments, installments, quote_items, quotes, documents,
      deadlines, case_events, cases, templates, doc_sequences, settings, users, clients, session CASCADE`);
    fs.rmSync(S.FILES, { recursive: true, force: true }); fs.mkdirSync(S.FILES, { recursive: true });
    console.log('Base de datos y archivos reiniciados.');
  }
  await pool.query(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));

  await withCtx(SYSTEM, async c => {
    await c.query(`INSERT INTO settings (key, value) VALUES ('firm', $1) ON CONFLICT (key) DO NOTHING`, [JSON.stringify({
      firm_name: 'LegalTax Consultores SRL', tagline: 'Asesoría legal y tributaria', rnc: '1-33-19505-4',
      address: 'Av. Rómulo Betancourt No. 517, Santo Domingo, República Dominicana',
      phone: '(809) 363-9979', email: 'legaltax.consultores@gmail.com', website: '',
      footer: 'LegalTax Consultores SRL · RNC 1-33-19505-4 · Av. Rómulo Betancourt No. 517, Santo Domingo · (809) 363-9979 · legaltax.consultores@gmail.com',
    })]);
    await c.query(`INSERT INTO settings (key, value) VALUES ('mail', $1) ON CONFLICT (key) DO NOTHING`, [JSON.stringify(require('./mailer').DEFAULTS)]);
    const seqs = [
      ['expediente', 'Expediente', 'EXP'], ['cotizacion', 'Cotización', 'COT'], ['recibo_dinero', 'Recibo de dinero', 'REC'],
      ['recibo_documentos', 'Recibo de documentos', 'RDOC'], ['estado_cuenta', 'Estado de cuenta', 'EC'], ['informe_avance', 'Informe de avance', 'INF'],
      ['ficha_cliente', 'Ficha de cliente', 'FCL'], ['ficha_expediente', 'Ficha de expediente', 'FEX'],
    ];
    await c.query(`INSERT INTO doc_sequences (doc_type, label, prefix, padding, yearly, sep) VALUES ('factura','Factura (NCF / e-CF)','B01',8,false,'') ON CONFLICT DO NOTHING`);
    for (const [t, l, p] of seqs) await c.query('INSERT INTO doc_sequences (doc_type, label, prefix) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [t, l, p]);
    const tpls = [
      ['cotizacion', 'Propuesta de servicios profesionales',
        'Estimados señores de {cliente}: conforme a lo conversado, sometemos a su consideración la siguiente propuesta de servicios profesionales.',
        'Quedamos a su disposición para cualquier aclaración. Atentamente, {despacho}.',
        'Los honorarios no incluyen tasas, impuestos ni gastos ante instituciones, salvo que se indiquen expresamente. Las cuotas deben pagarse en las fechas indicadas mediante transferencia o depósito a las cuentas del despacho. El inicio de los trabajos está sujeto a la aceptación de esta propuesta y al pago de la primera cuota.'],
      ['recibo_dinero', 'Recibo de dinero', '', 'Este recibo se emite únicamente sobre montos validados por el área de Cobros. Conserve este documento como constancia de pago.', ''],
      ['recibo_documentos', 'Recibo de entrega y recepción de documentos', 'Por medio del presente se hace constar la entrega y recepción de los documentos que se detallan a continuación:', 'Las partes firman en señal de conformidad.', ''],
      ['estado_cuenta', 'Estado de cuenta', 'A continuación, el detalle de cuotas y abonos de {cliente} a la fecha de corte indicada.', 'Si tiene alguna diferencia con este estado de cuenta, comuníquese con el área de Cobros.', ''],
      ['informe_avance', 'Informe de avance', 'Presentamos a {cliente} el estado actualizado del expediente {expediente}.', 'Quedamos atentos a sus comentarios.', ''],
      ['factura', 'Factura', '', 'Comprobante válido para fines fiscales solo si el número NCF/e-CF fue autorizado por la DGII.',
        'Pague mediante transferencia o depósito a nombre de LegalTax Consultores SRL y suba el comprobante en el portal de clientes o envíelo a legaltax.consultores@gmail.com. Indique el número de factura como referencia.'],
      ['ficha_cliente', 'Ficha de cliente', '', '', ''],
      ['ficha_expediente', 'Ficha de expediente', '', '', ''],
    ];
    for (const [t, title, intro, closing, terms] of tpls) await c.query('INSERT INTO templates (doc_type, title, intro, closing, terms) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [t, title, intro, closing, terms]);

    const types = [['Cédula de identidad', 'identificacion'], ['Pasaporte', 'identificacion'], ['Certificado de RNC', 'identificacion'], ['Registro mercantil', 'identificacion'],
      ['Acta constitutiva / estatutos', 'contrato'], ['Acta de asamblea', 'contrato'], ['Poder de representación', 'contrato'], ['Contrato', 'contrato'],
      ['Resolución', 'resolucion'], ['Sentencia', 'resolucion'], ['Notificación', 'notificacion'], ['Acto de alguacil', 'notificacion'], ['Requerimiento de información', 'notificacion'],
      ['Acuse de recibo / depósito', 'acuse'], ['Recurso / escrito depositado', 'acuse'],
      ['Declaración jurada IR-1 / IR-2', 'declaracion'], ['Declaración IT-1 (ITBIS)', 'declaracion'], ['Formato 606 / 607', 'declaracion'], ['Estados financieros', 'estado_financiero'],
      ['Factura / comprobante fiscal', 'otro'], ['Estado de cuenta bancario', 'otro'], ['Recibo de pago', 'otro'], ['Correspondencia', 'correspondencia'], ['Otro', 'otro']];
    for (const [i, [n, cat]] of types.entries()) await c.query('INSERT INTO doc_types (name, category, position) VALUES ($1,$2,$3) ON CONFLICT (name) DO NOTHING', [n, cat, i]);
    if (!DEMO) {
      // Producción: solo la cuenta de Administración del despacho (la contraseña sale de ADMIN_PASSWORD).
      const exists = (await c.query('SELECT 1 FROM users WHERE lower(email) = $1', [ADMIN_EMAIL])).rowCount;
      if (!exists) {
        if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) throw new Error('Defina ADMIN_PASSWORD (mínimo 8 caracteres) para crear la cuenta de Administración');
        await c.query("INSERT INTO users (email, name, role, password_hash) VALUES ($1, 'Administración LegalTax', 'admin', $2)", [ADMIN_EMAIL, await bcrypt.hash(ADMIN_PASSWORD, 10)]);
        console.log('Cuenta de Administración creada:', ADMIN_EMAIL);
      }
      return;
    }
    const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const staff = [
      ['admin@legaltax.do', 'Ana Martínez (Administración)', 'admin'],
      ['expedientes@legaltax.do', 'Luis Peralta (Expedientes)', 'expedientes'],
      ['cobros@legaltax.do', 'Carmen Rosario (Cobros)', 'cobros'],
    ];
    for (const [e, n, r] of staff) await c.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING', [e, n, r, hash]);
    const exp = (await c.query("SELECT id FROM users WHERE email = 'expedientes@legaltax.do'")).rows[0].id;

    // Cliente ficticio 2 (persona física) con un expediente y una resolución privada.
    // El cliente ficticio 1 (empresa) se registra durante el recorrido de prueba.
    let c2 = (await c.query("SELECT id FROM clients WHERE id_type = 'cedula' AND id_number = '001-1234567-8'")).rows[0];
    if (!c2) {
      c2 = (await c.query(`INSERT INTO clients (kind, name, id_type, id_number, email, phone, address, responsible_user_id)
        VALUES ('persona','María Fernanda Peña Gómez','cedula','001-1234567-8','maria.pena@example.com','(829) 555-0144','C/ El Conde No. 54, Zona Colonial, Santo Domingo',$1) RETURNING id`, [exp])).rows[0];
      const code = await S.nextNumber(c, 'expediente');
      const cs = (await c.query(`INSERT INTO cases (code, client_id, title, matter, institution, official_number, fiscal_periods, status, public_status, responsible_user_id, next_action, next_action_date)
        VALUES ($1,$2,'Reconsideración de estimación de oficio IR-1','Tributario','DGII','EST-2026-00871','2024','en_tramite','Recurso depositado; en espera de respuesta de la DGII',$3,'Dar seguimiento a la respuesta de la DGII', current_date + 20) RETURNING id`, [code, c2.id, exp])).rows[0];
      await c.query(`INSERT INTO case_events (case_id, client_id, kind, title, description, event_date, visibility, created_by) VALUES
        ($1,$2,'actuacion','Apertura del expediente',NULL,current_date - 15,'cliente',$3),
        ($1,$2,'deposito','Depósito del recurso de reconsideración','Depositado en la DGII, sede central. Acuse No. 2026-55102.',current_date - 8,'cliente',$3),
        ($1,$2,'nota','Nota interna: revisar criterio de gastos no admitidos','Pendiente de análisis con el socio.',current_date - 7,'interna',$3)`, [cs.id, c2.id, exp]);
      // archivo privado (resolución) — sirve para probar que otro cliente no puede abrirlo
      const PDFDocument = require('pdfkit');
      const buf = await new Promise(res => { const d = new PDFDocument(); const ch = []; d.on('data', x => ch.push(x)); d.on('end', () => res(Buffer.concat(ch)));
        d.fontSize(16).text('Resolución de Estimación de Oficio EST-2026-00871'); d.moveDown().fontSize(11).text('Documento ficticio de demostración — María Fernanda Peña Gómez.'); d.end(); });
      const key = S.storeBuffer(buf, '.pdf');
      await c.query(`INSERT INTO documents (client_id, case_id, category, title, resolution_number, institution, doc_date, storage_key, filename, mime, size_bytes, visibility, uploaded_by)
        VALUES ($1,$2,'resolucion','Resolución de estimación de oficio','EST-2026-00871','DGII',current_date - 20,$3,'resolucion-EST-2026-00871.pdf','application/pdf',$4,'cliente',$5)`, [c2.id, cs.id, key, buf.length, exp]);
      await c.query(`INSERT INTO deadlines (case_id, client_id, kind, title, due_at, confirmed, confirmed_by, responsible_user_id, alert_days, created_by)
        VALUES ($1,$2,'plazo','Seguimiento de respuesta DGII — reconsideración', now() + interval '5 days', true, $3, $3, 7, $3)`, [cs.id, c2.id, exp]);
      await c.query("INSERT INTO users (email, name, role, client_id, password_hash) VALUES ('maria.pena@example.com','María Fernanda Peña','cliente',$1,$2) ON CONFLICT DO NOTHING", [c2.id, hash]);
    }
  });
  console.log(DEMO ? `Esquema y datos de demostración listos. Contraseña de demostración: ${DEMO_PASSWORD}` : 'Esquema listo (modo producción, sin datos de prueba).');
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
