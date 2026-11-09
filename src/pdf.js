const PDFDocument = require('pdfkit');
const fs = require('fs');
const { money, dateStr, dateTimeStr, longDate } = require('./format');

// Identidad LegalTax Consultores: marrón #876440, gris #D9D9D9
const NAVY = '#876440', GOLD = '#876440', GRAY = '#D9D9D9', INK = '#2B2520', MUTED = '#6F665D', LINE = '#E2DED8', ZEBRA = '#F6F3EF';

const LABELS = {
  cotizacion: 'Cotización / Propuesta de servicios',
  recibo_dinero: 'Recibo de dinero',
  recibo_documentos: 'Recibo de documentos',
  estado_cuenta: 'Estado de cuenta',
  informe_avance: 'Informe de avance',
  ficha_cliente: 'Ficha de cliente',
  ficha_expediente: 'Ficha de expediente',
  factura: 'Factura',
  reporte_contable: 'Reporte contable mensual',
};

function fill(text, vars) {
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}

/**
 * Genera el PDF a partir de la copia de datos (snapshot). Devuelve Buffer.
 * opts.voided = { reason, at }   → marca de agua ANULADO
 * opts.preview = true            → marca de agua VISTA PREVIA
 */
function render(docType, data, settings, template, opts = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 50, bottom: 70, left: 54, right: 54 }, bufferPages: true,
      info: { Title: `${LABELS[docType] || docType} ${data.number || ''}`, Author: settings.firm_name || 'LegalTax', Creator: 'LegalTax' } });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const L = doc.page.margins.left;
    const vars = {
      cliente: data.client?.name, numero: data.number, fecha: longDate(data.date),
      expediente: data.case?.code, monto: data.amount !== undefined ? money(data.amount) : '', despacho: settings.firm_name,
    };
    const tpl = template || {};

    // ── utilidades de dibujo
    const ensure = h => { if (doc.y + h > doc.page.height - doc.page.margins.bottom) { doc.addPage(); } };
    const h2 = t => {
      ensure(80); doc.moveDown(0.6);
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(NAVY).text(t.toUpperCase(), L, doc.y, { characterSpacing: 0.6 });
      doc.moveTo(L, doc.y + 2).lineTo(L + W, doc.y + 2).lineWidth(0.6).strokeColor(GOLD).stroke();
      doc.moveDown(0.5); doc.fillColor(INK);
    };
    const para = (t, o = {}) => { if (!t) return; ensure(30); doc.font(o.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(o.size || 9.5).fillColor(o.color || INK).text(t, L, doc.y, { width: W, align: o.align || 'left', lineGap: 2 }); doc.moveDown(0.4); };
    const kv = (rows, cols = 2) => {
      const colW = W / cols; const items = rows.filter(r => r && r[1] !== undefined && r[1] !== null && r[1] !== '');
      for (let i = 0; i < items.length; i += cols) {
        ensure(30); const y0 = doc.y; let maxY = y0;
        for (let j = 0; j < cols && i + j < items.length; j++) {
          const [k, v] = items[i + j]; const x = L + j * colW;
          doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(k.toUpperCase(), x, y0, { width: colW - 10, characterSpacing: 0.3 });
          doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(String(v), x, doc.y + 1, { width: colW - 10 });
          maxY = Math.max(maxY, doc.y);
        }
        doc.y = maxY + 6;
      }
    };
    const table = (cols, rows, o = {}) => {
      const pad = 5; const totalW = cols.reduce((s, c) => s + c.w, 0); const scale = W / totalW;
      cols.forEach(c => (c.ww = c.w * scale));
      const header = () => {
        ensure(40); const y = doc.y;
        doc.rect(L, y, W, 18).fill(NAVY);
        let x = L; doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF');
        cols.forEach(c => { doc.text(c.label, x + pad, y + 5, { width: c.ww - 2 * pad, align: c.align || 'left' }); x += c.ww; });
        doc.y = y + 18;
      };
      header();
      if (!rows.length) { doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text(o.empty || 'Sin registros.', L + pad, doc.y + 6); doc.moveDown(0.8); return; }
      rows.forEach((r, i) => {
        doc.font('Helvetica').fontSize(8.8);
        const hts = cols.map((c, k) => doc.heightOfString(String(r[k] ?? ''), { width: c.ww - 2 * pad }));
        const h = Math.max(...hts) + 2 * pad;
        if (doc.y + h > doc.page.height - doc.page.margins.bottom) { doc.addPage(); header(); }
        const y = doc.y;
        if (i % 2 === 1) doc.rect(L, y, W, h).fill(ZEBRA);
        let x = L; doc.fillColor(INK);
        cols.forEach((c, k) => { doc.font(r.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.8).fillColor(INK).text(String(r[k] ?? ''), x + pad, y + pad, { width: c.ww - 2 * pad, align: c.align || 'left' }); x += c.ww; });
        doc.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.4).strokeColor(LINE).stroke();
        doc.y = y + h;
      });
      doc.moveDown(0.6);
    };
    const totals = rows => {
      const bw = 230, x = L + W - bw; ensure(rows.length * 18 + 10);
      rows.forEach(([k, v, strong]) => {
        const y = doc.y;
        if (strong) doc.rect(x, y - 2, bw, 20).fill(NAVY);
        doc.font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(strong ? 10.5 : 9.5).fillColor(strong ? '#FFFFFF' : INK)
          .text(k, x + 8, y + 3, { width: 120 }).text(v, x + 110, y + 3, { width: bw - 118, align: 'right' });
        doc.y = y + (strong ? 22 : 17);
      });
      doc.moveDown(0.5);
    };
    const signatures = labels => {
      ensure(90); doc.moveDown(2.5); const y = doc.y; const n = labels.length; const gap = 30; const sw = (W - gap * (n - 1)) / n;
      labels.forEach((lab, i) => {
        const x = L + i * (sw + gap);
        doc.moveTo(x, y).lineTo(x + sw, y).lineWidth(0.7).strokeColor(INK).stroke();
        doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(lab[0], x, y + 5, { width: sw, align: 'center' });
        if (lab[1]) doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(lab[1], x, doc.y + 1, { width: sw, align: 'center' });
      });
      doc.y = y + 45;
    };

    // ── membrete
    const drawLetterhead = () => {
      const top = 36; let textX = L;
      if (settings.logo_path && fs.existsSync(settings.logo_path)) {
        try { doc.image(settings.logo_path, L, top, { fit: [120, 46] }); textX = L + 130; } catch (_) { /* logo inválido */ }
      }
      if (textX === L) {
        if (settings.mark_path && fs.existsSync(settings.mark_path)) doc.image(settings.mark_path, L, top - 4, { fit: [50, 50] });
        doc.font('Helvetica-Bold').fontSize(12.5).fillColor(NAVY).text((settings.firm_name || 'LegalTax').toUpperCase(), L + 58, top + 6, { characterSpacing: 0.4, lineBreak: false });
        doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(settings.tagline || 'Asesoría legal y tributaria', L + 58, top + 25, { lineBreak: false });
      }
      const info = [settings.address, [settings.phone, settings.email].filter(Boolean).join(' · '), [settings.rnc ? 'RNC ' + settings.rnc : '', settings.website].filter(Boolean).join(' · ')].filter(Boolean);
      doc.font('Helvetica').fontSize(7.6).fillColor(MUTED);
      let iy = top + 2; const iw = 195;
      info.forEach(t => { doc.text(t, L + W - iw, iy, { width: iw, align: 'right' }); iy += doc.heightOfString(t, { width: iw }) + 1.5; });
      doc.moveTo(L, top + 54).lineTo(L + W, top + 54).lineWidth(2.2).strokeColor(NAVY).stroke();
      doc.moveTo(L, top + 57.5).lineTo(L + W, top + 57.5).lineWidth(1).strokeColor(GRAY).stroke();
      doc.y = top + 66;
    };
    drawLetterhead();

    // ── título del documento
    const title = fill(tpl.title || LABELS[docType], vars);
    doc.font('Helvetica-Bold').fontSize(15).fillColor(NAVY).text(title, L, doc.y, { width: W * 0.62 });
    const ty = doc.y;
    const meta = [['No.', data.number + (data.version > 1 ? `  (versión ${data.version})` : '')], ['Fecha', longDate(data.date)]];
    if (data.cutoff) meta.push(['Fecha de corte', longDate(data.cutoff)]);
    doc.font('Helvetica').fontSize(8.5);
    meta.forEach(([k, v], i) => {
      doc.fillColor(MUTED).text(k, L + W * 0.62, 102 + i * 12, { width: 60 });
      doc.fillColor(INK).font('Helvetica-Bold').text(v, L + W * 0.62 + 62, 102 + i * 12, { width: W * 0.38 - 62, align: 'right' }).font('Helvetica');
    });
    doc.y = Math.max(ty, 102 + meta.length * 12) + 8;

    const c = data.client || {};
    const clientBlock = (label = 'Cliente') => {
      h2(label);
      kv([
        ['Nombre / Razón social', c.name], [c.id_type === 'rnc' ? 'RNC' : c.id_type === 'pasaporte' ? 'Pasaporte' : 'Cédula', c.id_number],
        ['Representante', c.representative], ['Contacto', [c.phone, c.email].filter(Boolean).join(' · ')],
        ['Dirección', c.address],
      ]);
    };
    const caseBlock = cs => {
      if (!cs) return;
      kv([['Expediente', cs.code], ['Asunto', cs.title], ['Institución', cs.institution], ['No. oficial', cs.official_number], ['Períodos fiscales', cs.fiscal_periods], ['Estado', cs.status_label || cs.status]]);
    };

    if (tpl.intro && !['ficha_cliente', 'ficha_expediente'].includes(docType)) {
      // la introducción va después del bloque del cliente
    }

    // ── cuerpo por tipo
    switch (docType) {
      case 'cotizacion': {
        clientBlock('Preparada para');
        if (data.case) { h2('Expediente relacionado'); caseBlock(data.case); }
        if (tpl.intro) para(fill(tpl.intro, vars));
        h2(data.title || 'Alcance de los servicios');
        para(data.scope);
        const fees = data.items.filter(i => i.kind === 'honorario'), exp = data.items.filter(i => i.kind === 'gasto');
        h2('Honorarios');
        table([{ label: 'Descripción', w: 420 }, { label: 'Monto', w: 120, align: 'right' }], fees.map(i => [i.description, money(i.amount)]), { empty: 'Sin honorarios.' });
        if (exp.length) { h2('Gastos'); table([{ label: 'Descripción', w: 420 }, { label: 'Monto', w: 120, align: 'right' }], exp.map(i => [i.description, money(i.amount)])); }
        const t = [['Honorarios', money(data.fees_total)]];
        if (data.discount > 0) t.push(['Descuento', '- ' + money(data.discount)]);
        t.push(['Subtotal', money(data.subtotal)]);
        t.push([data.itbis_applies ? `ITBIS (${data.itbis_rate}%)` : 'ITBIS (no aplica)', money(data.itbis)]);
        if (data.expenses_total > 0) t.push(['Gastos', money(data.expenses_total)]);
        t.push(['TOTAL', money(data.total), true]);
        totals(t);
        if (data.installments?.length) {
          h2('Plan de pago');
          table([{ label: 'Cuota', w: 60 }, { label: 'Vencimiento', w: 200 }, { label: 'Monto', w: 140, align: 'right' }],
            data.installments.map(i => [String(i.seq), dateStr(i.due_date), money(i.amount)]));
        }
        if (data.valid_until) para(`Esta propuesta es válida hasta el ${longDate(data.valid_until)}.`, { color: MUTED, size: 8.5 });
        if (tpl.terms) { h2('Condiciones'); para(fill(tpl.terms, vars), { size: 8.5 }); }
        if (data.accepted_at) para(`Aceptada electrónicamente por ${data.accepted_by_name || 'el cliente'} el ${dateTimeStr(data.accepted_at)}`, { bold: true, color: NAVY });
        if (tpl.closing) para(fill(tpl.closing, vars));
        signatures([[settings.firm_name || 'LegalTax', 'Por el despacho'], [c.name || 'Cliente', 'Aceptación del cliente']]);
        break;
      }
      case 'recibo_dinero': {
        doc.moveDown(0.3);
        const y = doc.y; doc.roundedRect(L, y, W, 58, 4).lineWidth(1).strokeColor(GOLD).stroke();
        doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('MONTO RECIBIDO Y VALIDADO', L + 14, y + 10);
        doc.font('Helvetica-Bold').fontSize(20).fillColor(NAVY).text(money(data.amount), L + 14, y + 22);
        doc.font('Helvetica').fontSize(8).fillColor(INK).text(data.amount_words || '', L + W * 0.45, y + 14, { width: W * 0.55 - 14, align: 'right' });
        doc.y = y + 70;
        if (tpl.intro) para(fill(tpl.intro, vars));
        clientBlock('Recibimos de');
        h2('Detalle del pago');
        kv([['Concepto', data.concept], ['Cotización', data.quote_number], ['Medio de pago', data.method_label], ['Banco', data.bank],
          ['Referencia', data.reference], ['Fecha del pago', dateStr(data.paid_on)], ['Validado por', data.validated_by_name], ['Fecha de validación', dateTimeStr(data.validated_at)]]);
        h2('Situación de la cuenta');
        totals([['Total cotizado', money(data.quote_total)], ['Pagado a la fecha', money(data.paid_to_date)], ['Saldo pendiente', money(data.balance_after), true]]);
        if (tpl.closing) para(fill(tpl.closing, vars), { size: 8.5, color: MUTED });
        signatures([[data.validated_by_name || 'Cobros', settings.firm_name || 'LegalTax']]);
        break;
      }
      case 'recibo_documentos': {
        clientBlock('Cliente');
        if (data.case) { h2('Expediente'); caseBlock(data.case); }
        if (tpl.intro) para(fill(tpl.intro, vars));
        h2(data.direction === 'entrega' ? 'Documentos entregados al cliente' : 'Documentos recibidos del cliente');
        table([{ label: '#', w: 30 }, { label: 'Documento', w: 300 }, { label: 'Cant.', w: 50, align: 'center' }, { label: 'Observaciones', w: 170 }],
          data.items.map((it, i) => [String(i + 1), it.description, String(it.quantity), it.notes || '']));
        para(`Total de documentos: ${data.items.reduce((s, i) => s + Number(i.quantity || 0), 0)}`, { bold: true });
        if (data.notes) para(data.notes);
        if (tpl.closing) para(fill(tpl.closing, vars), { size: 8.5, color: MUTED });
        signatures([[data.delivered_by || '', 'Entrega'], [data.received_by || '', 'Recibe']]);
        break;
      }
      case 'estado_cuenta': {
        clientBlock('Cliente');
        if (tpl.intro) para(fill(tpl.intro, vars));
        h2('Resumen');
        totals([['Total facturado (cuotas)', money(data.totals.billed)], ['Abonos validados', money(data.totals.paid)], ['Vencido al corte', money(data.totals.overdue)], ['SALDO AL CORTE', money(data.totals.balance), true]]);
        h2('Cuotas');
        table([{ label: 'Cotización', w: 110 }, { label: 'Cuota', w: 45 }, { label: 'Vence', w: 75 }, { label: 'Monto', w: 90, align: 'right' }, { label: 'Abonado', w: 90, align: 'right' }, { label: 'Saldo', w: 90, align: 'right' }, { label: 'Estado', w: 70 }],
          data.installments.map(i => [i.quote_number, String(i.seq), dateStr(i.due_date), money(i.amount), money(i.paid), money(i.balance), i.status_label]));
        h2('Abonos recibidos');
        table([{ label: 'Fecha', w: 75 }, { label: 'Cotización', w: 110 }, { label: 'Medio', w: 90 }, { label: 'Referencia', w: 110 }, { label: 'Recibo', w: 100 }, { label: 'Monto', w: 90, align: 'right' }],
          data.payments.map(p => [dateStr(p.paid_on), p.quote_number, p.method_label, p.reference || '', p.receipt_number || '', money(p.amount)]), { empty: 'No hay abonos validados al corte.' });
        if (tpl.closing) para(fill(tpl.closing, vars), { size: 8.5, color: MUTED });
        break;
      }
      case 'informe_avance': {
        clientBlock('Cliente');
        h2('Expediente'); caseBlock(data.case);
        if (tpl.intro) para(fill(tpl.intro, vars));
        if (data.summary) { h2('Resumen'); para(data.summary); }
        h2('Actuaciones realizadas');
        table([{ label: 'Fecha', w: 75 }, { label: 'Tipo', w: 85 }, { label: 'Actuación', w: 380 }],
          data.events.map(e => [dateStr(e.event_date), e.kind_label, e.title + (e.description ? '\n' + e.description : '')]), { empty: 'Sin actuaciones registradas en el período.' });
        h2('Pendientes');
        table([{ label: 'Fecha', w: 90 }, { label: 'Pendiente', w: 450 }], data.pending.map(p => [p.date ? dateStr(p.date) : '', p.text]), { empty: 'No hay pendientes abiertos.' });
        h2('Próximos pasos');
        para(data.next_steps || data.case.next_action || 'Por definir.');
        if (tpl.closing) para(fill(tpl.closing, vars));
        signatures([[data.author_name || settings.firm_name, settings.firm_name || 'LegalTax']]);
        break;
      }
      case 'factura': {
        clientBlock('Facturado a');
        if (tpl.intro) para(fill(tpl.intro, vars));
        h2('Detalle');
        const rows = [[data.description + (data.inst_seq ? `\nCuota #${data.inst_seq} de la cotización ${data.quote_number}` : `\nCotización ${data.quote_number}`), money(data.subtotal)]];
        if (data.expenses > 0) rows.push(['Gastos reembolsables (no gravados)', money(data.expenses)]);
        table([{ label: 'Concepto', w: 420 }, { label: 'Monto', w: 120, align: 'right' }], rows);
        totals([['Subtotal gravado', money(data.subtotal)], ['ITBIS (18%)', money(data.itbis)], ...(data.expenses > 0 ? [['Gastos', money(data.expenses)]] : []), ['TOTAL A PAGAR', money(data.total), true]]);
        kv([['Fecha de emisión', dateStr(data.issue_date)], ['Fecha de vencimiento', dateStr(data.due_date)], ['Expediente', data.case?.code], ['Estado al emitir', data.status_label]], 4);
        if (tpl.terms) { h2('Forma de pago'); para(fill(tpl.terms, vars), { size: 8.5 }); }
        if (tpl.closing) para(fill(tpl.closing, vars), { size: 8, color: MUTED });
        break;
      }
      case 'reporte_contable': {
        h2(`Declaraciones de ${data.period_label}`);
        const t = data.totals;
        kv([['Empresas', String(data.rows.length)], ['Declaraciones', String(t.total)], ['Enviadas', String(t.enviado)], ['Sin movimiento', String(t.sin_movimiento)],
          ['Pendientes', String(t.pendiente)], ['Vencidas', String(t.vencido)], ['No aplica', String(t.no_aplica)], ['Monto declarado', money(t.amount)]], 4);
        para('Incluye los formatos mensuales del período y las declaraciones anuales que vencen en este mes. “Vencida” significa que pasó la fecha límite sin registrarse como enviada.', { size: 8, color: MUTED });
        if (!data.rows.length) para('No hay empresas con formatos fiscales configurados.');
        data.rows.forEach(r => {
          h2(`${r.client.name} · ${r.client.id_number}`);
          table([{ label: 'Formato', w: 60 }, { label: 'Período', w: 85 }, { label: 'Vence', w: 62 }, { label: 'Estado', w: 92 }, { label: 'Envío', w: 62 }, { label: 'No. acuse', w: 90 }, { label: 'Monto', w: 80, align: 'right' }],
            r.items.map(i => [i.code, i.period_label, dateStr(i.due), (i.state_code === 'vencido' ? '⚠ ' : '') + i.state + (i.files ? ` · ${i.files} arch.` : ''), dateStr(i.sent_on), i.ack || '', i.amount != null ? money(i.amount) : '']));
        });
        break;
      }
      case 'ficha_cliente': {
        h2('Identificación');
        kv([['Tipo', c.kind === 'empresa' ? 'Empresa' : 'Persona física'], ['Nombre / Razón social', c.name], ['Nombre comercial', c.trade_name],
          [c.id_type === 'rnc' ? 'RNC' : 'Cédula / Pasaporte', c.id_number], ['Cliente desde', dateStr(c.created_at)]]);
        h2('Representante y contacto');
        kv([['Representante', c.representative], ['Cédula del representante', c.representative_id], ['Teléfono', c.phone], ['Correo', c.email], ['Dirección', c.address]]);
        h2('Responsable interno');
        kv([['Responsable', data.responsible_name || 'Sin asignar']]);
        h2('Expedientes');
        table([{ label: 'Código', w: 100 }, { label: 'Asunto', w: 230 }, { label: 'Institución', w: 120 }, { label: 'Estado', w: 90 }], (data.cases || []).map(x => [x.code, x.title, x.institution || '', x.status_label]));
        break;
      }
      case 'ficha_expediente': {
        h2('Datos del expediente'); caseBlock(data.case);
        kv([['Cliente', c.name], ['Identificación', c.id_number], ['Responsable', data.case.responsible_name], ['Apertura', dateStr(data.case.opened_on)]]);
        h2('Próxima acción');
        para(data.case.next_action ? `${data.case.next_action}${data.case.next_action_date ? ' — ' + longDate(data.case.next_action_date) : ''}` : 'Sin próxima acción registrada.');
        h2('Actuaciones');
        table([{ label: 'Fecha', w: 75 }, { label: 'Tipo', w: 85 }, { label: 'Actuación', w: 300 }, { label: 'Visible', w: 70 }],
          data.events.map(e => [dateStr(e.event_date), e.kind_label, e.title + (e.description ? '\n' + e.description : ''), e.visibility === 'cliente' ? 'Cliente' : 'Interna']));
        break;
      }
      default:
        para(JSON.stringify(data, null, 2));
    }

    // ── marcas de agua, pie y numeración
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0; // permite escribir el pie sin crear páginas nuevas
      const stamp = opts.voided ? 'ANULADO' : opts.preview ? 'VISTA PREVIA' : null;
      if (stamp) {
        doc.save(); doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
        doc.font('Helvetica-Bold').fontSize(opts.voided ? 96 : 72).fillColor(opts.voided ? '#C0392B' : '#999999').fillOpacity(0.18)
          .text(stamp, 0, doc.page.height / 2 - 50, { width: doc.page.width, align: 'center', lineBreak: false });
        doc.restore(); doc.fillOpacity(1);
      }
      if (opts.voided && i === range.start) {
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#C0392B')
          .text(`Documento anulado el ${dateTimeStr(opts.voided.at)}. Motivo: ${opts.voided.reason}`, L, 24, { width: W, align: 'center', lineBreak: false });
      }
      const fy = doc.page.height - 50;
      doc.moveTo(L, fy - 6).lineTo(L + W, fy - 6).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.font('Helvetica').fontSize(7).fillColor(MUTED)
        .text(settings.footer || '', L, fy, { width: W - 90, lineBreak: false, height: 10 })
        .text(`${data.number || ''} · Página ${i - range.start + 1} de ${range.count}`, L + W - 160, fy, { width: 160, align: 'right', lineBreak: false });
      doc.text(`Emitido por ${data.issued_by || 'LegalTax'} · ${dateTimeStr(data.issued_at || new Date())} (hora de Santo Domingo)`, L, fy + 10, { width: W, lineBreak: false });
    }
    doc.end();
  });
}

module.exports = { render, LABELS };
