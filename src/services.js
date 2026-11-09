const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { render, LABELS } = require('./pdf');
const { todayISO, amountWords } = require('./format');

const STORAGE = process.env.STORAGE_DIR || path.join(__dirname, '..', 'storage');
const FILES = path.join(STORAGE, 'files');
const BRAND_MARK = path.join(__dirname, '..', 'public', 'brand', 'mark.png');
const BRAND_LOGO = path.join(__dirname, '..', 'public', 'brand', 'logo.png');
fs.mkdirSync(FILES, { recursive: true });
fs.mkdirSync(path.join(STORAGE, 'tmp'), { recursive: true });

const CASE_STATUS = { abierto: 'Abierto', en_tramite: 'En trámite', en_espera: 'En espera', cerrado: 'Cerrado', archivado: 'Archivado' };
const EVENT_KIND = { actuacion: 'Actuación', deposito: 'Depósito', notificacion: 'Notificación', decision: 'Decisión', documento: 'Documento', reunion: 'Reunión', nota: 'Nota' };
const METHOD = { transferencia: 'Transferencia', deposito: 'Depósito bancario', efectivo: 'Efectivo', cheque: 'Cheque', tarjeta: 'Tarjeta' };
const round2 = n => Math.round(Number(n) * 100) / 100;

// ───── almacenamiento privado
function storeBuffer(buf, ext) {
  const y = new Date().getFullYear().toString();
  const dir = path.join(FILES, y); fs.mkdirSync(dir, { recursive: true });
  const key = path.join(y, crypto.randomUUID() + (ext || ''));
  fs.writeFileSync(path.join(FILES, key), buf);
  return key;
}
function storeTmp(tmpPath, originalName) {
  const y = new Date().getFullYear().toString();
  const dir = path.join(FILES, y); fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(originalName || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8);
  const key = path.join(y, crypto.randomUUID() + ext);
  fs.renameSync(tmpPath, path.join(FILES, key));
  return key;
}
const filePath = key => {
  const p = path.join(FILES, key);
  if (!p.startsWith(FILES)) throw new Error('ruta inválida');
  return p;
};

// ───── auditoría
async function audit(c, user, action, entity, entityId, clientId, details, ip) {
  await c.query(
    'INSERT INTO audit_log (user_id, user_name, role, action, entity, entity_id, client_id, details, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [user?.id || null, user?.name || 'sistema', user?.role || 'system', action, entity, entityId == null ? null : String(entityId), clientId || null, details ? JSON.stringify(details) : null, ip || null]
  );
}

// ───── numeración por tipo de documento
async function nextNumber(c, docType) {
  const { rows } = await c.query('SELECT * FROM doc_sequences WHERE doc_type = $1 FOR UPDATE', [docType]);
  if (!rows.length) throw new Error('Secuencia no configurada: ' + docType);
  const s = rows[0];
  const year = Number(todayISO().slice(0, 4));
  let n = s.next_number;
  if (s.yearly && s.year !== year) n = 1;
  if (s.max_number && n > s.max_number) throw httpError(409, `Se agotó la secuencia autorizada de ${s.label} (hasta ${s.max_number}). Administración debe registrar una nueva secuencia.`);
  if (s.valid_until && s.valid_until < todayISO()) throw httpError(409, `La secuencia de ${s.label} venció el ${s.valid_until}. Administración debe registrar una nueva.`);
  await c.query('UPDATE doc_sequences SET next_number = $2, year = $3 WHERE doc_type = $1', [docType, n + 1, year]);
  const sep = s.sep ?? '-';
  return s.yearly ? `${s.prefix}${sep}${year}${sep}${String(n).padStart(s.padding, '0')}` : `${s.prefix}${sep}${String(n).padStart(s.padding, '0')}`;
}

async function getSettings(c) {
  const { rows } = await c.query('SELECT key, value FROM settings');
  const s = {}; rows.forEach(r => (s[r.key] = r.value));
  const firm = s.firm || {};
  return { ...firm, logo_path: firm.logo_key ? filePath(firm.logo_key) : null, mark_path: BRAND_MARK };
}

// ───── estado de cuenta: cuotas de cotizaciones aceptadas menos pagos validados (FIFO por cotización)
async function account(c, clientId, cutoff) {
  const cut = cutoff || todayISO();
  const inst = (await c.query(
    `SELECT i.*, q.number AS quote_number, q.title AS quote_title FROM installments i JOIN quotes q ON q.id = i.quote_id
     WHERE i.client_id = $1 AND q.status = 'aceptada' ORDER BY q.id, i.seq`, [clientId])).rows;
  const pays = (await c.query(
    `SELECT p.*, q.number AS quote_number,
            (SELECT g.number FROM generated_docs g WHERE g.payment_id = p.id AND g.doc_type = 'recibo_dinero' AND g.status <> 'reemplazado' ORDER BY g.version DESC LIMIT 1) AS receipt_number,
            (SELECT g.id FROM generated_docs g WHERE g.payment_id = p.id AND g.doc_type = 'recibo_dinero' AND g.status <> 'reemplazado' ORDER BY g.version DESC LIMIT 1) AS receipt_id
     FROM payments p JOIN quotes q ON q.id = p.quote_id
     WHERE p.client_id = $1 AND p.status = 'validado' AND p.paid_on <= $2 ORDER BY p.paid_on, p.id`, [clientId, cut])).rows;
  const paidByQuote = {};
  pays.forEach(p => (paidByQuote[p.quote_id] = round2((paidByQuote[p.quote_id] || 0) + p.amount_validated)));
  const remaining = { ...paidByQuote };
  const installments = inst.map(i => {
    const avail = remaining[i.quote_id] || 0;
    const paid = round2(Math.min(avail, i.amount));
    remaining[i.quote_id] = round2(avail - paid);
    const balance = round2(i.amount - paid);
    const status = balance <= 0 ? 'pagada' : i.due_date < cut ? (paid > 0 ? 'parcial_vencida' : 'vencida') : paid > 0 ? 'parcial' : 'pendiente';
    const status_label = { pagada: 'Pagada', vencida: 'Vencida', parcial_vencida: 'Parcial (vencida)', parcial: 'Abono parcial', pendiente: 'Pendiente' }[status];
    return { id: i.id, quote_id: i.quote_id, quote_number: i.quote_number, quote_title: i.quote_title, seq: i.seq, due_date: i.due_date, amount: i.amount, paid, balance, status, status_label };
  });
  const billed = round2(installments.reduce((s, i) => s + i.amount, 0));
  const paid = round2(pays.reduce((s, p) => s + p.amount_validated, 0));
  const overdue = round2(installments.filter(i => i.due_date < cut).reduce((s, i) => s + i.balance, 0));
  return {
    cutoff: cut, installments,
    payments: pays.map(p => ({ id: p.id, paid_on: p.paid_on, quote_id: p.quote_id, quote_number: p.quote_number, method: p.method, method_label: METHOD[p.method], reference: p.reference, amount: p.amount_validated, receipt_number: p.receipt_number, receipt_id: p.receipt_id })),
    totals: { billed, paid, balance: round2(billed - paid), overdue },
  };
}

async function quoteBalance(c, quoteId) {
  const { rows } = await c.query(
    `SELECT q.total, coalesce((SELECT sum(amount_validated) FROM payments WHERE quote_id = q.id AND status = 'validado'), 0) AS paid FROM quotes q WHERE q.id = $1`, [quoteId]);
  if (!rows.length) return null;
  return { total: rows[0].total, paid: rows[0].paid, balance: round2(rows[0].total - rows[0].paid) };
}

// ───── cálculo de totales de cotización
function computeQuote(items, discount, itbisApplies, rate = 18) {
  const fees = round2(items.filter(i => i.kind === 'honorario').reduce((s, i) => s + Number(i.amount || 0), 0));
  const expenses = round2(items.filter(i => i.kind === 'gasto').reduce((s, i) => s + Number(i.amount || 0), 0));
  const disc = round2(Math.min(Number(discount || 0), fees));
  const subtotal = round2(fees - disc);
  const itbis = itbisApplies ? round2(subtotal * rate / 100) : 0;
  return { fees_total: fees, expenses_total: expenses, discount: disc, subtotal, itbis, total: round2(subtotal + itbis + expenses) };
}

// ───── carga de datos base
const clientSnap = async (c, id) => {
  const { rows } = await c.query('SELECT * FROM clients WHERE id = $1', [id]);
  if (!rows.length) throw httpError(404, 'Cliente no encontrado');
  const x = rows[0];
  return { id: x.id, kind: x.kind, name: x.name, trade_name: x.trade_name, id_type: x.id_type, id_number: x.id_number, representative: x.representative,
    representative_id: x.representative_id, email: x.email, phone: x.phone, address: x.address, created_at: x.created_at, responsible_user_id: x.responsible_user_id };
};
const caseSnap = async (c, id) => {
  if (!id) return null;
  const { rows } = await c.query('SELECT cs.*, u.name AS responsible_name FROM cases cs LEFT JOIN users u ON u.id = cs.responsible_user_id WHERE cs.id = $1', [id]);
  if (!rows.length) throw httpError(404, 'Expediente no encontrado');
  const x = rows[0];
  return { id: x.id, client_id: x.client_id, code: x.code, title: x.title, institution: x.institution, official_number: x.official_number, fiscal_periods: x.fiscal_periods,
    status: x.status, status_label: CASE_STATUS[x.status], public_status: x.public_status, next_action: x.next_action, next_action_date: x.next_action_date,
    opened_on: x.opened_on, responsible_name: x.responsible_name };
};

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

/** Construye la copia de datos (snapshot) para cada tipo de documento. */
async function buildData(c, docType, p, user) {
  const base = { date: p.date || todayISO(), issued_by: user.name, issued_at: new Date().toISOString(), _params: p };
  switch (docType) {
    case 'cotizacion': {
      const q = (await c.query('SELECT q.*, u.name AS accepted_by_name FROM quotes q LEFT JOIN users u ON u.id = q.accepted_by WHERE q.id = $1', [p.quote_id])).rows[0];
      if (!q) throw httpError(404, 'Cotización no encontrada');
      const items = (await c.query('SELECT kind, description, amount FROM quote_items WHERE quote_id = $1 ORDER BY position, id', [q.id])).rows;
      const installments = (await c.query('SELECT seq, due_date, amount FROM installments WHERE quote_id = $1 ORDER BY seq', [q.id])).rows;
      return { client_id: q.client_id, case_id: q.case_id, quote_id: q.id, title: `Cotización ${q.number} — ${q.title}`, fixedNumber: q.number,
        data: { ...base, number: q.number, client: await clientSnap(c, q.client_id), case: await caseSnap(c, q.case_id), title: q.title, scope: q.scope, items, installments,
          discount: q.discount, fees_total: q.fees_total, expenses_total: q.expenses_total, subtotal: q.subtotal, itbis: q.itbis, itbis_rate: q.itbis_rate, itbis_applies: q.itbis_applies,
          total: q.total, valid_until: q.valid_until, status: q.status, accepted_at: q.accepted_at, accepted_by_name: q.accepted_by_name } };
    }
    case 'recibo_dinero': {
      const pay = (await c.query(`SELECT p.*, q.number AS quote_number, q.title AS quote_title, u.name AS validated_by_name FROM payments p
        JOIN quotes q ON q.id = p.quote_id LEFT JOIN users u ON u.id = p.validated_by WHERE p.id = $1`, [p.payment_id])).rows[0];
      if (!pay) throw httpError(404, 'Pago no encontrado');
      if (pay.status !== 'validado') throw httpError(409, 'Solo un pago validado genera recibo');
      const qb = await quoteBalance(c, pay.quote_id);
      return { client_id: pay.client_id, case_id: null, quote_id: pay.quote_id, payment_id: pay.id, title: `Recibo de dinero — ${pay.quote_number}`,
        data: { ...base, date: todayISO(new Date(pay.validated_at)), client: await clientSnap(c, pay.client_id), amount: pay.amount_validated, amount_words: amountWords(pay.amount_validated),
          concept: p.concept || `Abono a la cotización ${pay.quote_number} — ${pay.quote_title}`, quote_number: pay.quote_number, method: pay.method, method_label: METHOD[pay.method],
          bank: pay.bank, reference: pay.reference, paid_on: pay.paid_on, validated_by_name: pay.validated_by_name, validated_at: pay.validated_at,
          quote_total: qb.total, paid_to_date: qb.paid, balance_after: qb.balance } };
    }
    case 'recibo_documentos': {
      const items = (p.items || []).filter(i => i.description && String(i.description).trim()).map(i => ({ description: String(i.description).trim(), quantity: Math.max(1, parseInt(i.quantity, 10) || 1), notes: i.notes || '' }));
      if (!items.length) throw httpError(400, 'Agregue al menos un documento al inventario');
      const client = await clientSnap(c, p.client_id);
      const cs = p.case_id ? await caseSnap(c, p.case_id) : null;
      if (cs && cs.client_id !== client.id) throw httpError(400, 'El expediente no pertenece al cliente');
      return { client_id: client.id, case_id: cs?.id || null, title: `Recibo de documentos (${p.direction === 'entrega' ? 'entrega' : 'recepción'}) — ${client.name}`,
        data: { ...base, client, case: cs, direction: p.direction === 'entrega' ? 'entrega' : 'recepcion', items, delivered_by: p.delivered_by || '', received_by: p.received_by || '', notes: p.notes || '' } };
    }
    case 'estado_cuenta': {
      const client = await clientSnap(c, p.client_id);
      const acc = await account(c, client.id, p.cutoff);
      return { client_id: client.id, title: `Estado de cuenta al ${acc.cutoff} — ${client.name}`,
        data: { ...base, client, cutoff: acc.cutoff, installments: acc.installments, payments: acc.payments, totals: acc.totals } };
    }
    case 'informe_avance': {
      const cs = await caseSnap(c, p.case_id);
      const client = await clientSnap(c, cs.client_id);
      const params = [cs.id]; let where = 'case_id = $1';
      if (!p.include_internal) where += " AND visibility = 'cliente'";
      if (p.from) { params.push(p.from); where += ` AND event_date >= $${params.length}`; }
      if (p.to) { params.push(p.to); where += ` AND event_date <= $${params.length}`; }
      const events = (await c.query(`SELECT event_date, kind, title, description FROM case_events WHERE ${where} ORDER BY event_date, id`, params)).rows
        .map(e => ({ ...e, kind_label: EVENT_KIND[e.kind] }));
      const dl = (await c.query("SELECT due_at, title FROM deadlines WHERE case_id = $1 AND status = 'pendiente' ORDER BY due_at", [cs.id])).rows;
      const rq = (await c.query("SELECT due_date, title FROM doc_requests WHERE case_id = $1 AND status <> 'recibida' ORDER BY due_date NULLS LAST", [cs.id])).rows;
      const pending = [...dl.map(d => ({ date: todayISO(new Date(d.due_at)), text: d.title })), ...rq.map(r => ({ date: r.due_date, text: 'Documento solicitado al cliente: ' + r.title }))];
      return { client_id: client.id, case_id: cs.id, title: `Informe de avance — ${cs.code}`,
        data: { ...base, client, case: cs, events, pending, summary: p.summary || '', next_steps: p.next_steps || '', author_name: user.name } };
    }
    case 'factura': {
      const inv = (await c.query('SELECT i.*, q.number AS quote_number, q.title AS quote_title, ins.seq AS inst_seq FROM invoices i JOIN quotes q ON q.id = i.quote_id LEFT JOIN installments ins ON ins.id = i.installment_id WHERE i.id = $1', [p.invoice_id])).rows[0];
      if (!inv) throw httpError(404, 'Factura no encontrada');
      const st = await invoiceStatus(c, inv);
      return { client_id: inv.client_id, case_id: inv.case_id, quote_id: inv.quote_id, title: `Factura ${inv.number} — ${inv.description}`, fixedNumber: inv.number,
        data: { ...base, date: inv.issue_date, number: inv.number, client: await clientSnap(c, inv.client_id), case: await caseSnap(c, inv.case_id),
          description: inv.description, quote_number: inv.quote_number, inst_seq: inv.inst_seq, issue_date: inv.issue_date, due_date: inv.due_date,
          subtotal: inv.subtotal, itbis: inv.itbis, expenses: inv.expenses, total: inv.total, paid: st.paid, balance: st.balance, status_label: st.label } };
    }
    case 'ficha_cliente': {
      const client = await clientSnap(c, p.client_id);
      const resp = client.responsible_user_id ? (await c.query('SELECT name FROM users WHERE id = $1', [client.responsible_user_id])).rows[0] : null;
      const cases = (await c.query('SELECT code, title, institution, status FROM cases WHERE client_id = $1 ORDER BY opened_on DESC', [client.id])).rows.map(x => ({ ...x, status_label: CASE_STATUS[x.status] }));
      return { client_id: client.id, title: `Ficha de cliente — ${client.name}`, data: { ...base, client, responsible_name: resp?.name, cases } };
    }
    case 'ficha_expediente': {
      const cs = await caseSnap(c, p.case_id);
      const client = await clientSnap(c, cs.client_id);
      const events = (await c.query('SELECT event_date, kind, title, description, visibility FROM case_events WHERE case_id = $1 ORDER BY event_date, id', [cs.id])).rows.map(e => ({ ...e, kind_label: EVENT_KIND[e.kind] }));
      return { client_id: client.id, case_id: cs.id, title: `Ficha de expediente — ${cs.code}`, data: { ...base, client, case: cs, events } };
    }
    default: throw httpError(400, 'Tipo de documento no soportado');
  }
}

/** Estado de una factura según los pagos validados (asignación FIFO por cotización). */
async function invoiceStatus(c, inv, acc) {
  if (inv.status === 'anulada') return { code: 'anulada', label: 'Anulada', paid: 0, balance: 0 };
  let paid;
  if (inv.installment_id) {
    acc = acc || await account(c, inv.client_id);
    paid = acc.installments.find(i => i.id === inv.installment_id)?.paid || 0;
  } else paid = (await quoteBalance(c, inv.quote_id)).paid;
  paid = round2(Math.min(paid, inv.total)); const balance = round2(inv.total - paid);
  const today = todayISO();
  const code = balance <= 0 ? 'pagada' : inv.due_date < today ? (paid > 0 ? 'parcial_vencida' : 'vencida') : paid > 0 ? 'parcial' : 'pendiente';
  const label = { pagada: 'Pagada', vencida: 'Vencida', parcial_vencida: 'Pago parcial (vencida)', parcial: 'Pago parcial', pendiente: 'Pendiente de pago' }[code];
  return { code, label, paid, balance };
}

async function templateFor(c, docType) {
  return (await c.query('SELECT * FROM templates WHERE doc_type = $1', [docType])).rows[0] || null;
}

async function renderPreview(c, docType, params, user) {
  const b = await buildData(c, docType, params, user);
  b.data.number = b.fixedNumber || b.data.number || '(sin número)';
  return render(docType, b.data, await getSettings(c), await templateFor(c, docType), { preview: true });
}

/**
 * Emite un documento: asigna número, guarda copia de datos y PDF. Si parent se indica,
 * crea una nueva versión del mismo número y marca la anterior como reemplazada.
 */
async function issueDocument(c, docType, params, user, { share = false, parent = null, ip } = {}) {
  const b = await buildData(c, docType, params, user);
  let number, version = 1;
  if (parent) {
    number = parent.number;
    version = (await c.query('SELECT max(version) AS v FROM generated_docs WHERE doc_type = $1 AND number = $2', [docType, number])).rows[0].v + 1;
    share = share || parent.shared;
  } else {
    number = b.fixedNumber || await nextNumber(c, docType);
  }
  b.data.number = number; b.data.version = version;
  const pdf = await render(docType, b.data, await getSettings(c), await templateFor(c, docType));
  const key = storeBuffer(pdf, '.pdf');
  const { rows } = await c.query(
    `INSERT INTO generated_docs (doc_type, number, version, parent_id, client_id, case_id, quote_id, payment_id, title, data, storage_key, shared, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [docType, number, version, parent?.id || null, b.client_id, b.case_id || null, b.quote_id || null, b.payment_id || null, b.title, b.data, key, !!share, user.id]);
  if (parent) await c.query("UPDATE generated_docs SET status = 'reemplazado' WHERE doc_type = $1 AND number = $2 AND id <> $3 AND status = 'vigente'", [docType, number, rows[0].id]);
  else if (b.fixedNumber) await c.query("UPDATE generated_docs SET status = 'reemplazado' WHERE doc_type = $1 AND number = $2 AND id <> $3 AND status = 'vigente'", [docType, number, rows[0].id]);
  await audit(c, user, parent ? 'nueva_version' : 'emitir', 'documento_pdf', rows[0].id, b.client_id, { doc_type: docType, number, version }, ip);
  return rows[0];
}

async function issueQuoteVersion(c, quoteId, user, opts = {}) {
  const prev = (await c.query("SELECT * FROM generated_docs WHERE doc_type = 'cotizacion' AND quote_id = $1 ORDER BY version DESC LIMIT 1", [quoteId])).rows[0];
  return issueDocument(c, 'cotizacion', { quote_id: quoteId }, user, { ...opts, parent: prev || null });
}

async function voidDocument(c, gd, reason, user, ip) {
  const settings = await getSettings(c);
  const at = new Date().toISOString();
  const pdf = await render(gd.doc_type, gd.data, settings, await templateFor(c, gd.doc_type), { voided: { reason, at } });
  const key = storeBuffer(pdf, '.pdf');
  await c.query("UPDATE generated_docs SET status = 'anulado', void_reason = $2, voided_by = $3, voided_at = $4, void_storage_key = $5 WHERE id = $1", [gd.id, reason, user.id, at, key]);
  await audit(c, user, 'anular', 'documento_pdf', gd.id, gd.client_id, { number: gd.number, reason }, ip);
}

module.exports = {
  STORAGE, FILES, BRAND_MARK, BRAND_LOGO, CASE_STATUS, EVENT_KIND, METHOD, LABELS, round2, storeBuffer, storeTmp, filePath, audit, nextNumber, getSettings,
  account, quoteBalance, invoiceStatus, computeQuote, buildData, renderPreview, issueDocument, issueQuoteVersion, voidDocument, httpError, todayISO,
};
