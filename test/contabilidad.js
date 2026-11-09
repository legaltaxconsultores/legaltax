// Prueba del módulo Contabilidad: accesos cifrados, declaraciones por mes con archivos, expediente, carpetas y reporte mensual.
// Uso: BASE=http://localhost:3000 node test/contabilidad.js [carpeta-capturas]   (servidor con datos de demostración)
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = process.argv[2] || path.join(__dirname, 'output', 'contabilidad'); fs.mkdirSync(OUT, { recursive: true });
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) process.exitCode = 1; };
const PDF = require('pdfkit');
const mkPdf = (f, text) => new Promise(r => { const d = new PDF(); const s = fs.createWriteStream(f); d.pipe(s); s.on('finish', r); d.fontSize(14).text(text); d.end(); });

(async () => {
  const f606 = path.join(OUT, 'DGII_F_606_131999998_202610.pdf'); await mkPdf(f606, 'Formato 606 octubre 2026 (ficticio)');
  const fAck = path.join(OUT, 'acuse-606-octubre.pdf'); await mkPdf(fAck, 'Acuse de recibo DGII No. 2026-ACK-55821 (ficticio)');
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  const shot = n => p.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  await p.goto(BASE + '/#/login'); await p.fill('#lf input[name=email]', 'admin'); await p.fill('#lf input[name=password]', 'LegalTax2026!'); await p.click('#lbtn'); await p.waitForSelector('#shell');
  // empresa y expediente de prueba
  const api = p.request;
  const cl = await (await api.post(BASE + '/api/clients', { data: { kind: 'empresa', name: 'Distribuidora del Cibao ' + String(Date.now()).slice(-4) + ', SRL', id_type: 'rnc', id_number: '1-31-' + String(Date.now()).slice(-5) + '-8', email: 'conta@cibao.do' } })).json();
  const cs = await (await api.post(BASE + '/api/cases', { data: { client_id: cl.id, title: 'Contabilidad mensual 2026 — DGII', institution: 'DGII' } })).json();

  await p.evaluate(id => { location.hash = '#/contabilidad/' + id + '?year=2026'; }, cl.id); await p.waitForSelector('.taxgrid');
  const codes = await p.$$eval('.taxgrid tbody tr td:first-child b', els => els.map(e => e.textContent));
  ok(['606', '607', 'IT-1'].every(c => codes.includes(c)), `Empresa nueva con formatos habituales activados: ${codes.join(', ')} (+ IR-2 anual)`);

  // accesos
  await p.click('button[data-act=newcred]');
  await p.fill('.modal input[name=username]', '131999998'); await p.fill('.modal input[name=secret]', 'ClaveOFV#2026');
  await p.fill('.modal input[name=notes]', 'Token en poder del gerente'); await p.click('.modal button[type=submit]');
  await p.waitForSelector('.cred:has-text("Oficina Virtual DGII")');
  ok((await p.textContent('.cred')).includes('••••••••'), 'Acceso de Oficina Virtual DGII guardado: la clave aparece oculta');
  await p.click('button[data-act=reveal]'); await p.waitForSelector('code:has-text("ClaveOFV#2026")');
  ok(true, '“Mostrar” revela la clave (se oculta sola a los 30 segundos)');
  const raw = await (await api.get(BASE + `/api/tax/clients/${cl.id}?year=2026`)).text();
  ok(!raw.includes('ClaveOFV#2026'), 'La clave nunca viaja en las consultas normales, solo al pulsar “Mostrar”');

  // 606 de octubre: enviado, con archivos y alimentando el expediente
  await p.click('.taxgrid tr:has-text("606") button[data-period="2026-10"]');
  await p.selectOption('.modal select[name=status]', 'enviado'); await p.fill('.modal input[name=sent_on]', '2026-11-12');
  await p.fill('.modal input[name=ack_number]', '2026-ACK-55821'); await p.fill('.modal input[name=amount]', '18,450.75');
  await p.selectOption('.modal select[name=case_id]', String(cs.id)); await p.setInputFiles('.modal input[name=files]', [f606, fAck]);
  await shot('c1-registrar-606');
  await p.click('.modal button[type=submit]'); await p.waitForSelector('.taxgrid tr:has-text("606") button.ok[data-period="2026-10"]');
  ok(await p.locator('.taxgrid tr:has-text("606") button[data-period="2026-10"] .clip').count() === 1, '606 de octubre marcado como Enviado, con sus archivos (📎)');
  // 607: sin movimiento
  await p.click('.taxgrid tr:has-text("607") button[data-period="2026-10"]'); await p.selectOption('.modal select[name=status]', 'sin_movimiento'); await p.click('.modal button[type=submit]');
  await p.waitForSelector('.taxgrid tr:has-text("607") button.info[data-period="2026-10"]'); ok(true, '607 de octubre: “Sin movimiento (en cero)”');
  ok(await p.locator('.taxgrid button.bad').count() > 0, 'Meses anteriores sin registrar aparecen como Vencidos');
  await shot('c2-ficha-contable');

  // carpeta y expediente alimentados
  const disk = (await (await api.get(BASE + `/api/folders/${cl.id}?f=contabilidad`)).json()).folder.documents;
  ok(disk.length === 2, 'Carpeta “Contabilidad” del cliente con los 2 archivos');
  const caseDocs = (await (await api.get(BASE + `/api/cases/${cs.id}`)).json());
  ok(caseDocs.documents.filter(d => d.filing_id).length === 2 && caseDocs.events.some(e => e.title.startsWith('606 Octubre 2026')), 'Los archivos alimentan el expediente y queda la actuación “606 Octubre 2026: Enviado”');
  const zip = await (await api.get(BASE + `/api/folders/${cl.id}/zip`)).body();
  ok(zip.includes(Buffer.from('Contabilidad/2026-10 Octubre/')), 'En el ZIP: Contabilidad / 2026-10 Octubre / …');

  // vista del mes y reporte
  await p.evaluate(() => { location.hash = '#/contabilidad?period=2026-10'; }); await p.waitForSelector('.tchip');
  const row = await p.textContent(`tr:has-text("Distribuidora del Cibao")`);
  ok(row.includes('606') && row.includes('Enviado') && row.includes('Sin movimiento') && row.includes('IT-1'), 'Vista del mes: estado de cada formato por empresa');
  await shot('c3-vista-mes');
  const pdf = await api.get(BASE + '/api/tax/report?period=2026-10'); const pb = await pdf.body(); fs.writeFileSync(path.join(OUT, 'reporte-contable-2026-10.pdf'), pb);
  ok(pdf.ok() && pb.slice(0, 4).toString() === '%PDF', `Reporte mensual en PDF (${Math.round(pb.length / 1024)} KB)`);
  const x = await api.get(BASE + '/api/tax/report?period=2026-10&format=xlsx'); const xb = await x.body(); fs.writeFileSync(path.join(OUT, 'reporte-contable-2026-10.xlsx'), xb);
  ok(x.ok() && xb.slice(0, 2).toString() === 'PK', 'Reporte mensual en Excel');
  await p.evaluate(() => { location.hash = '#/'; }); await p.waitForSelector('.kpi');
  ok((await p.textContent('.kpis')).includes('Declaraciones de'), 'Panel de inicio: indicador de declaraciones del mes sin enviar');
  const aud = await (await api.get(BASE + '/api/audit?q=ver_clave')).json();
  ok(aud.some(a => a.action === 'ver_clave'), 'Auditoría: queda registrado quién vio la clave y cuándo');
  ok(errs.length === 0, 'Sin errores de JavaScript' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
})().catch(e => { console.error('✘', e.message); process.exit(1); });
