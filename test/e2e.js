// Prueba de entrega: recorre el flujo completo en el navegador con cada rol.
// Requiere el servidor en marcha (npm start) y la base recién sembrada (npm run reset).
// Uso: BASE=http://localhost:3000 node test/e2e.js [carpeta-capturas]
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const BASE = process.env.BASE || 'http://localhost:3000';
const PASS = 'LegalTax2026!';
const OUT = process.argv[2] || path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (ok, msg) => { results.push([ok, msg]); console.log(`${ok ? '✔' : '✘'} ${msg}`); if (!ok) throw new Error('Falló: ' + msg); };

async function fixtures(browser) {
  const res = path.join(OUT, 'resolucion-RES-DGII-2026-01234.pdf');
  await new Promise(r => { const d = new PDFDocument(); const s = fs.createWriteStream(res); d.pipe(s); s.on('finish', r);
    d.fontSize(16).text('DIRECCIÓN GENERAL DE IMPUESTOS INTERNOS (documento ficticio)'); d.moveDown().fontSize(13).text('Resolución No. RES-DGII-2026-01234');
    d.moveDown().fontSize(11).text('Contribuyente: Constructora Caribe Azul, SRL — RNC 1-31-45678-9. Período fiscal 2024.'); d.end(); });
  const p = await browser.newPage({ viewport: { width: 600, height: 360 } });
  await p.setContent('<div style="font-family:Arial;padding:30px;border:2px solid #0a5;height:280px"><h2>Banco Ficticio · Comprobante de transferencia</h2><p>Monto: RD$ 20,000.00</p><p>Referencia: TRX-778812</p><p>Beneficiario: LegalTax</p></div>');
  const voucher = path.join(OUT, 'voucher-TRX-778812.png'); await p.screenshot({ path: voucher });
  const scans = [];
  for (const side of ['frente', 'reverso']) {
    await p.setContent(`<div style="font-family:Arial;padding:24px;border:2px solid #876440;height:290px;background:#F4EFE8"><h2>Cédula de identidad (ficticia) — ${side}</h2><p>Ramón Antonio Vargas · 402-2233445-1</p></div>`);
    const f = path.join(OUT, `cedula-${side}.png`); await p.screenshot({ path: f }); scans.push(f);
  }
  await p.close();
  const acta = path.join(OUT, 'acta-constitutiva.pdf');
  await new Promise(r => { const d = new PDFDocument(); const st = fs.createWriteStream(acta); d.pipe(st); st.on('finish', r);
    d.fontSize(15).text('Acta constitutiva (ficticia) — Constructora Caribe Azul, SRL'); d.addPage().text('Página 2'); d.addPage().text('Página 3'); d.end(); });
  return { res, voucher, scans, acta };
}

async function login(page, email) {
  await page.goto(BASE + '/#/login');
  await page.fill('input[name=email]', email); await page.fill('input[name=password]', PASS);
  await page.click('form#lf button.primary');
  await page.waitForSelector('#shell');
}
async function logout(page) { await page.click('#logout'); await page.waitForSelector('form#lf'); }
async function toast(page, re) { const t = page.locator('.toast').filter({ hasText: re }); await t.first().waitFor({ timeout: 10000 }); return t.first().textContent(); }
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });

(async () => {
  const browser = await chromium.launch();
  const fx = await fixtures(browser);
  const MAIL_DIR = process.env.MAIL_DIR;
  if (MAIL_DIR) { // configura el correo hacia el SMTP de prueba local (test/smtp-capture.js)
    const { request } = require('playwright'); const api = await request.newContext({ baseURL: BASE });
    await api.post('/api/login', { data: { email: 'admin@legaltax.do', password: PASS } });
    const r = await api.put('/api/email/config', { data: { host: 'localhost', port: 2525, secure: false, pass: 'prueba', notify_events: true, inbox: 'legaltax.consultores@gmail.com' } });
    check(r.ok(), 'Correo configurado hacia el servidor SMTP de prueba'); await api.dispose();
  }
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1, locale: 'es-DO', timezoneId: 'America/Santo_Domingo' });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  page.on('pageerror', e => console.log('  [error de página]', e.message));

  // ── 1. Equipo de expedientes: registra la empresa, abre expediente y adjunta resolución
  await login(page, 'expedientes@legaltax.do');
  await shot(page, '01-panel-inicio');
  await page.goto(BASE + '/#/clientes'); await page.click('text=+ Nuevo cliente');
  const m = page.locator('.modal');
  await m.locator('select[name=kind]').selectOption('empresa'); await m.locator('select[name=id_type]').selectOption('rnc');
  await m.locator('input[name=id_number]').fill('1-31-45678-9'); await m.locator('input[name=name]').fill('Constructora Caribe Azul, SRL');
  await m.locator('input[name=trade_name]').fill('Caribe Azul'); await m.locator('input[name=representative]').fill('Ramón Antonio Vargas');
  await m.locator('input[name=representative_id]').fill('402-2233445-1'); await m.locator('input[name=email]').fill('finanzas@caribeazul.do');
  await m.locator('input[name=phone]').fill('(809) 555-0188'); await m.locator('input[name=address]').fill('Av. 27 de Febrero No. 455, Santo Domingo');
  await m.locator('select[name=responsible_user_id]').selectOption({ label: 'Luis Peralta (Expedientes)' });
  await m.locator('button[type=submit]').click();
  await page.waitForURL(/#\/clientes\/\d+$/); const clientId = page.url().match(/clientes\/(\d+)/)[1];
  check(true, `Empresa registrada (cliente #${clientId})`);

  await page.click('text=+ Expediente');
  await m.locator('input[name=title]').fill('Recurso de reconsideración — Ajuste ITBIS 2024');
  await m.locator('input[name=matter]').fill('Tributario'); await m.locator('input[name=institution]').fill('DGII');
  await m.locator('input[name=official_number]').fill('REC-2026-04412'); await m.locator('input[name=fiscal_periods]').fill('2024');
  await m.locator('select[name=status]').selectOption('en_tramite');
  await m.locator('input[name=public_status]').fill('En preparación del recurso de reconsideración');
  await m.locator('input[name=next_action]').fill('Depositar recurso ante la DGII');
  await m.locator('button[type=submit]').click();
  await page.waitForURL(/#\/expedientes\/\d+$/); const caseId = page.url().match(/expedientes\/(\d+)/)[1];
  const caseCode = (await page.locator('h1').textContent()).split(' · ')[0];
  check(/^EXP-\d{4}-\d{4}$/.test(caseCode), `Expediente abierto con código ${caseCode}`);

  await page.fill('#evf input[name=title]', 'Reunión inicial con el cliente y revisión de la resolución');
  await page.selectOption('#evf select[name=visibility]', 'cliente'); await page.click('#evf button');
  await toast(page, /Actuación registrada/);
  await page.fill('#evf input[name=title]', 'Nota interna: estrategia sobre gastos no deducibles'); await page.selectOption('#evf select[name=visibility]', 'interna');
  await page.click('#evf button'); await toast(page, /Actuación registrada/);

  await page.click('.tabs >> text=Archivos');
  await page.selectOption('#upf select[name=category]', 'resolucion'); await page.fill('#upf input[name=title]', 'Resolución de ajuste ITBIS 2024');
  await page.fill('#upf input[name=resolution_number]', 'RES-DGII-2026-01234'); await page.fill('#upf input[name=doc_date]', '2026-10-15');
  await page.selectOption('#upf select[name=visibility]', 'cliente'); await page.setInputFiles('#upf input[name=file]', fx.res);
  await page.click('#upf button'); await toast(page, /guardado/);
  await page.waitForSelector('text=RES-DGII-2026-01234');
  const resolutionId = await page.locator('a[href^="/api/files/"]').first().getAttribute('href').then(h => h.match(/files\/(\d+)/)[1]);
  check(true, `Resolución RES-DGII-2026-01234 adjuntada (archivo #${resolutionId})`);

  // documentos escaneados del expediente
  await page.goto(BASE + `/#/expedientes/${caseId}?tab=escaneados`); await page.waitForSelector('#drop');
  await page.setInputFiles('#scanfiles', fx.scans);
  await page.check('#merge'); await page.selectOption('#scanrows [data-k=doc_type_id]', { label: 'Cédula de identidad' });
  await page.fill('#scanrows [data-k=title]', 'Cédula del representante (ambos lados)'); await page.fill('#scanrows [data-k=number]', '402-2233445-1');
  await page.click('#scanup'); await toast(page, /1 documento\(s\) guardado/);
  await page.setInputFiles('#scanfiles', fx.acta);
  await page.selectOption('#scanrows [data-k=doc_type_id]', { label: 'Acta constitutiva / estatutos' }); await page.selectOption('#scanrows [data-k=visibility]', 'cliente');
  await page.click('#scanup'); await toast(page, /1 documento\(s\) guardado/);
  await page.waitForSelector('h2:has-text("Acta constitutiva / estatutos")');
  const cedRow = page.locator('tr', { hasText: 'Cédula del representante' });
  check((await cedRow.textContent()).includes('2 pág.'), 'Escaneados: 2 fotos de la cédula unidas en un solo PDF de 2 páginas, tipo “Cédula de identidad”');
  check((await page.locator('tr', { hasText: 'acta-constitutiva.pdf' }).textContent()).includes('3 pág.'), 'Escaneados: PDF del acta constitutiva clasificado (3 páginas) y compartido con el cliente');
  await shot(page, '13-documentos-escaneados');
  await page.click('a.chip:has-text("Cédula de identidad")'); await page.waitForTimeout(400);
  check(await page.locator('h2:has-text("Acta constitutiva")').count() === 0, 'Filtro por tipo de documento dentro del expediente');
  await page.goto(BASE + '/#/consultas?entity=documents&scanned=si'); await page.waitForSelector('td:has-text("Cédula de identidad")');
  check(true, 'Consultas: búsqueda de escaneados por tipo de documento');
  await page.fill('#gsearch input', 'RES-DGII-2026-01234'); await page.press('#gsearch input', 'Enter');
  await page.waitForSelector('h2:has-text("Archivos y resoluciones")');
  const found = await page.locator('td:has-text("RES-DGII-2026-01234")').count();
  check(found > 0, 'El buscador global encuentra la resolución por su número');
  await shot(page, '02-busqueda-por-resolucion');
  await page.fill('#gsearch input', '131456789'); await page.press('#gsearch input', 'Enter');
  await page.waitForSelector('h2:has-text("Clientes")');
  check(await page.locator('td:has-text("Constructora Caribe Azul")').count() > 0, 'El buscador encuentra la empresa por RNC sin guiones (131456789)');
  await page.goto(BASE + `/#/expedientes/${caseId}`); await page.waitForSelector('.tl'); await shot(page, '03-expediente-linea-de-tiempo');

  // invitación al portal
  await page.goto(BASE + `/#/clientes/${clientId}?tab=portal`); await page.click('text=+ Invitar al portal');
  await m.locator('input[name=name]').fill('Ramón Vargas'); await m.locator('button[type=submit]').click();
  const inviteLink = await page.locator('#lnk').inputValue(); await page.click('.modal [data-close]');
  check(inviteLink.includes('#/invitacion/'), 'Enlace de invitación al portal generado');

  // cotización
  await page.goto(BASE + `/#/cotizaciones/nueva?client_id=${clientId}`); await page.waitForSelector('#qf');
  await page.waitForFunction(() => document.querySelectorAll('#qcase option').length > 1);
  await page.selectOption('#qcase', caseId);
  await page.fill('#qf input[name=title]', 'Representación en recurso de reconsideración ante la DGII');
  await page.fill('#qf textarea[name=scope]', 'Análisis de la resolución RES-DGII-2026-01234, preparación y depósito del recurso de reconsideración, seguimiento ante la DGII hasta la decisión y reporte de avance mensual.');
  await page.fill('#items [data-i="0"] [data-k=description]', 'Honorarios profesionales — recurso de reconsideración'); await page.fill('#items [data-i="0"] [data-k=amount]', '50000');
  await page.click('#additem'); await page.selectOption('#items [data-i="1"] [data-k=kind]', 'gasto');
  await page.fill('#items [data-i="1"] [data-k=description]', 'Gastos de notificación y traslados'); await page.fill('#items [data-i="1"] [data-k=amount]', '5000');
  await page.fill('#ncuo', '2'); await page.fill('#fcuo', new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(new Date()));
  await page.click('#gencuo');
  check((await page.locator('#tot').textContent()).includes('RD$ 64,000.00'), 'Total calculado: 50,000 + ITBIS 9,000 + gastos 5,000 = RD$ 64,000.00');
  await page.click('#qf .actions button.primary');
  await page.waitForURL(/#\/cotizaciones\/\d+$/); const quoteId = page.url().match(/cotizaciones\/(\d+)/)[1];
  const quoteNumber = (await page.locator('h1').textContent()).split(' · ')[0];
  await page.click('text=Publicar al cliente'); await toast(page, /publicada/);
  await page.waitForSelector('.b:has-text("Pendiente de aceptación")');
  check(true, `Cotización ${quoteNumber} creada y publicada (PDF emitido)`);
  await shot(page, '04-cotizacion-publicada');
  const quotePdf = await page.request.get(BASE + `/api/gendocs/${await page.locator('[data-gd]').first().getAttribute('data-gd')}/pdf`);
  fs.writeFileSync(path.join(OUT, `${quoteNumber}.pdf`), await quotePdf.body());
  check(quotePdf.headers()['content-type'] === 'application/pdf', 'PDF de cotización descargable');
  await logout(page);

  // ── 2. Cliente: activa su acceso, acepta la cotización y sube un voucher de abono
  await page.goto(inviteLink.replace(/^https?:\/\/[^/]+/, BASE));
  await page.fill('#if input[name=password]', PASS); await page.fill('#if input[name=password2]', PASS); await page.click('#if button');
  await page.waitForSelector('#shell'); check(true, 'Cliente activó su cuenta desde la invitación');
  await page.goto(BASE + '/#/mis-cotizaciones'); await page.click('text=Revisar y aceptar');
  await page.click('text=✓ Aceptar cotización'); await toast(page, /aceptada/);
  await page.waitForSelector('.alert.ok:has-text("Aceptada")'); check(true, 'Cliente aceptó la cotización desde el portal');
  await page.goto(BASE + '/#/mis-pagos'); await page.click('text=⇪ Subir voucher');
  await m.locator('input[name=amount]').fill('20000'); await m.locator('select[name=method]').selectOption('transferencia');
  await m.locator('input[name=bank]').fill('Banco Ficticio'); await m.locator('input[name=reference]').fill('TRX-778812');
  await m.locator('input[name=file]').setInputFiles(fx.voucher); await m.locator('button[type=submit]').click();
  await toast(page, /Comprobante enviado/);
  await page.waitForSelector('.b:has-text("Pendiente de validar")');
  check((await page.locator('#saldo').textContent()).trim() === 'RD$ 64,000.00', 'Con el voucher pendiente el saldo NO cambia (RD$ 64,000.00)');
  await shot(page, '05-portal-voucher-pendiente');
  await logout(page);

  // ── 3. Cobros valida el pago
  await login(page, 'cobros@legaltax.do');
  await page.goto(BASE + '/#/pagos?status=pendiente');
  const valBtn = page.locator('button[data-act=validate]').first(); const paymentId = await valBtn.getAttribute('data-id');
  await shot(page, '06-cobros-vouchers-por-validar');
  await valBtn.click(); await m.locator('button[type=submit]').click();
  const msg = await toast(page, /Pago validado/);
  check(/Nuevo saldo: RD\$ 44,000\.00/.test(msg), `Cobros validó el pago: ${msg.trim()}`);
  const again = await page.request.post(BASE + `/api/payments/${paymentId}/validate`, { data: { amount: 20000 } });
  check(again.status() === 409, `Una segunda validación del mismo voucher es rechazada (HTTP ${again.status()})`);
  await page.goto(BASE + `/#/clientes/${clientId}?tab=cuenta`); await page.waitForSelector('#saldo');
  check((await page.locator('#saldo').textContent()).trim() === 'RD$ 44,000.00', 'Ficha del cliente muestra saldo RD$ 44,000.00');
  await shot(page, '07-ficha-cliente-cuenta');
  const xlsx = await page.request.get(BASE + '/api/query/receivables/export');
  fs.writeFileSync(path.join(OUT, 'cuentas-por-cobrar.xlsx'), await xlsx.body());
  check(xlsx.ok() && xlsx.headers()['content-type'].includes('spreadsheetml'), 'Exportación a Excel de cuentas por cobrar');
  await page.goto(BASE + `/#/clientes/${clientId}`); await page.click('text=⎙ Generar PDF'); await page.click('text=⎙ Estado de cuenta');
  await m.locator('input[name=share]').check(); await m.locator('button[type=submit]').click();
  await toast(page, /emitido y archivado/); await page.click('.modal [data-close]');
  check(true, 'Estado de cuenta en PDF emitido y compartido');
  if (MAIL_DIR) {
    await page.goto(BASE + '/#/documentos?type=recibo_dinero'); await page.click('text=Detalle');
    await page.click('button[data-act=mail]'); await m.locator('button[type=submit]').click(); await toast(page, /Correo enviado/);
    await page.goto(BASE + '/#/consultas?entity=receivables'); await page.click('button[data-act=mail]'); await m.locator('button[type=submit]').click(); await toast(page, /Correo enviado/);
    await page.goto(BASE + '/#/'); await page.click('button[data-act=daily]'); await m.locator('button[type=submit]').click(); await toast(page, /Correo enviado/);
    check(true, 'Desde la app se enviaron por correo: el recibo PDF, el Excel de cuentas por cobrar y el reporte del día');
  }
  // ── facturas, avisos y WhatsApp (Cobros)
  await page.goto(BASE + `/#/cotizaciones/${quoteId}`); await page.click('button[data-act=inv]');
  await page.waitForFunction(() => document.querySelectorAll('#ii option').length > 1);
  await page.selectOption('#ii', { index: 1 });
  check((await page.locator('#ipv').textContent()).includes('Total RD$ 32,000.00'), 'Factura de la cuota #1: total RD$ 32,000.00 con ITBIS proporcional');
  await m.locator('button[type=submit]').click();
  const invMsg = await toast(page, /Factura .* generada/); const invNumber = invMsg.match(/Factura (\S+)/)[1];
  check(/^B01\d{8}$/.test(invNumber), `Factura generada con NCF ${invNumber}`);
  await page.click('.modal [data-close]');
  await page.goto(BASE + '/#/facturas'); await page.waitForSelector('td:has-text("' + invNumber + '")');
  const invRow = page.locator('tr', { hasText: invNumber });
  check((await invRow.textContent()).includes('Pago parcial'), 'Estado de la factura: “Pago parcial” (RD$ 20,000 abonados de RD$ 32,000)');
  await shot(page, '11-facturas');
  await invRow.locator('button[data-act=invstate]').click(); await page.waitForSelector('.modal textarea[name=text]');
  check((await page.locator('.modal textarea[name=text]').inputValue()).includes('Pendiente: *RD$ 12,000.00*'), 'Aviso de estado de factura redactado con el saldo pendiente');
  await page.click('.modal button[type=submit]'); await toast(page, /Aviso enviado por correo/);
  await page.goto(BASE + `/#/clientes/${clientId}?tab=cuenta`); await page.click('button[data-act=avisopago]');
  await page.waitForSelector('.modal textarea[name=text]'); await shot(page, '12-aviso-de-pago');
  await ctx.route(/wa\.me/, r => r.fulfill({ contentType: 'text/html', body: 'WhatsApp (simulado en la prueba)' }));
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('.modal [data-wa]')]);
  await popup.waitForURL(/wa\.me/, { timeout: 10000 }).catch(() => {});
  const waUrl = popup.url(); await popup.close();
  check(waUrl.startsWith('https://wa.me/18095550188?text='), `WhatsApp abre el chat del contacto registrado con el mensaje (${waUrl.slice(0, 40)}…)`);
  await page.click('button[data-act=avisopago]'); await page.waitForSelector('.modal textarea[name=text]');
  await page.click('.modal button[type=submit]'); await toast(page, /Aviso enviado por correo/);
  await page.goto(BASE + `/#/clientes/${clientId}?tab=avisos`); await page.waitForSelector('td:has-text("WhatsApp")');
  check(await page.locator('td:has-text("Aviso de pago")').count() >= 2, 'Historial de avisos registra el correo y el WhatsApp');
  await logout(page);

  await login(page, 'expedientes@legaltax.do');
  await page.goto(BASE + `/#/expedientes/${caseId}`); await page.click('text=⎙ Generar PDF'); await page.click('text=⎙ Informe de avance');
  await m.locator('textarea[name=summary]').fill('Se analizó la resolución y se definió la estrategia del recurso.'); await m.locator('textarea[name=next_steps]').fill('Depositar el recurso dentro del plazo legal.');
  await m.locator('input[name=share]').check(); await m.locator('button[type=submit]').click(); await toast(page, /emitido/); await page.click('.modal [data-close]');
  await page.click('text=⎙ Generar PDF'); await page.click('text=⎙ Recibo de entrega / recepción de documentos');
  await page.locator('.invrow [data-k=description]').nth(0).fill('Copia de la resolución RES-DGII-2026-01234'); await page.locator('.invrow [data-k=description]').nth(1).fill('Estados financieros 2024');
  await page.locator('.invrow [data-k=quantity]').nth(1).fill('2'); await m.locator('input[name=delivered_by]').fill('Ramón Antonio Vargas');
  await m.locator('button[type=submit]').click(); await toast(page, /emitido/); await page.click('.modal [data-close]');
  check(true, 'Informe de avance y recibo de documentos emitidos');
  await logout(page);

  // ── 4. Cliente descarga el recibo; cierra sesión, vuelve a entrar y verifica persistencia
  await login(page, 'finanzas@caribeazul.do');
  await page.goto(BASE + '/#/mis-pagos'); await page.waitForSelector('#saldo');
  check((await page.locator('#saldo').textContent()).trim() === 'RD$ 44,000.00', 'Portal: saldo actualizado a RD$ 44,000.00');
  const receiptId = await page.locator('button[data-act=viewgd]').first().getAttribute('data-id');
  const rec = await page.request.get(BASE + `/api/gendocs/${receiptId}/pdf`);
  const recBuf = await rec.body(); fs.writeFileSync(path.join(OUT, 'recibo-de-dinero.pdf'), recBuf);
  check(rec.ok() && recBuf.slice(0, 4).toString() === '%PDF', `Cliente descargó el recibo en PDF (${recBuf.length} bytes)`);
  await shot(page, '08-portal-cuotas-y-recibo');
  await page.goto(BASE + '/#/mis-facturas'); await page.waitForSelector('td:has-text("Pago parcial")');
  check(true, 'El cliente ve su factura y su estado en el portal');
  await logout(page);
  await login(page, 'finanzas@caribeazul.do');
  await page.goto(BASE + '/#/mis-documentos'); await page.waitForSelector('text=Recibo de dinero');
  const rec2 = await page.request.get(BASE + `/api/gendocs/${receiptId}/pdf`); const rec2Buf = await rec2.body();
  check(rec2.ok() && rec2Buf.equals(recBuf), 'Tras cerrar y abrir sesión, el recibo sigue disponible e idéntico');
  const cnt = await page.locator('td:has-text("Informe de avance")').count();
  check(cnt > 0, 'Informe de avance y estado de cuenta compartidos visibles en el portal');
  await page.goto(BASE + `/#/mis-casos/${caseId}`); await page.waitForSelector('.tl');
  const tl = await page.locator('.tl').textContent();
  check(tl.includes('Reunión inicial') && !tl.includes('Nota interna'), 'El cliente ve la actualización publicada pero no la nota interna');
  const docsTxt = await page.locator('.card', { hasText: 'Documentos del caso' }).textContent();
  check(docsTxt.includes('Acta constitutiva') && !docsTxt.includes('Cédula del representante'), 'El cliente ve el escaneado compartido (acta) pero no el privado (cédula)');
  await logout(page);

  // ── 5. Segundo cliente no puede consultar ni descargar archivos del primero
  await login(page, 'maria.pena@example.com');
  const probes = [
    ['la resolución del primer cliente', `/api/files/${resolutionId}`], ['el recibo PDF del primer cliente', `/api/gendocs/${receiptId}/pdf`],
    ['el expediente del primer cliente', `/api/portal/cases/${caseId}`], ['la cotización del primer cliente', `/api/portal/quotes/${quoteId}`],
  ];
  for (const [label, url] of probes) { const r = await page.request.get(BASE + url); check(r.status() === 404, `María no puede abrir ${label} con enlace directo (HTTP ${r.status()})`); }
  const staffApi = await page.request.get(BASE + '/api/clients'); check(staffApi.status() === 403, `María no puede usar consultas internas (HTTP ${staffApi.status()})`);
  const portal = await (await page.request.get(BASE + '/api/portal')).json();
  check(portal.cases.length === 1 && portal.cases[0].code !== caseCode && !JSON.stringify(portal).includes('Caribe Azul'), 'El portal de María solo contiene sus propios registros');
  await page.close();

  // ── capturas en celular
  const mob = await browser.newContext({ ...devices['iPhone 13'], locale: 'es-DO', timezoneId: 'America/Santo_Domingo' });
  const mp = await mob.newPage(); mp.on('dialog', d => d.accept());
  await login(mp, 'finanzas@caribeazul.do'); await shot(mp, '09-celular-portal-inicio');
  await mp.goto(BASE + '/#/mis-pagos'); await mp.waitForSelector('#saldo'); await shot(mp, '10-celular-portal-pagos');
  await mob.close();

  await browser.close();
  if (MAIL_DIR) {
    await new Promise(r => setTimeout(r, 1500));
    const { simpleParser } = require('mailparser');
    const mails = await Promise.all(fs.readdirSync(MAIL_DIR).filter(f => f.endsWith('.eml')).sort().map(async f => simpleParser(fs.readFileSync(path.join(MAIL_DIR, f)), { keepCidLinks: true })));
    const find = re => mails.find(x => re.test(x.subject));
    const att = (x, re) => (x?.attachments || []).some(a => re.test(a.filename));
    const v = find(/Nuevo voucher por validar/); check(!!v && v.to.text.includes('legaltax.consultores@gmail.com'), `Aviso automático al despacho: “${v?.subject}”`);
    const q = find(/Cotización .* aceptada por el cliente/); check(!!q, `Aviso automático: “${q?.subject}”`);
    const rp = find(/^Recibo de dinero REC-/); check(att(rp, /^REC-\d{4}-\d{4}\.pdf$/), `Correo con recibo PDF adjunto: “${rp?.subject}”`);
    const xl = find(/^Reporte de Cuentas por cobrar/); check(att(xl, /\.xlsx$/), `Correo con Excel adjunto: “${xl?.subject}”`);
    const dr = find(/^Reporte diario LegalTax/); check(att(dr, /\.xlsx$/) && /44,000\.00/.test(dr.html), `Reporte diario con resumen y Excel: “${dr?.subject}”`);
    const rc = mails.find(x => /^Pago recibido — Recibo REC-/.test(x.subject) && x.to.text.includes('finanzas@caribeazul.do'));
    check(att(rc, /^REC-.*\.pdf$/), `Aviso automático al cliente de pago recibido con recibo: “${rc?.subject}”`);
    const fi = mails.find(x => /^Factura B01\d+/.test(x.subject) && x.to.text.includes('finanzas@caribeazul.do'));
    check(att(fi, /^B01\d+\.pdf$/), `Aviso al cliente de factura generada con PDF: “${fi?.subject}”`);
    const fg = find(/^Factura generada B01/); check(!!fg, `Aviso al despacho: “${fg?.subject}”`);
    const ef = find(/^Estado de su factura/); check(!!ef && /Pago parcial/.test(ef.subject), `Estado de factura enviado: “${ef?.subject}”`);
    const ap = mails.find(x => /^Aviso de pago — /.test(x.subject)); check(!!ap && /RD\$ 44,000\.00/.test(ap.html), `Aviso de pago con saldo: “${ap?.subject}”`);
    const doc = find(/Documento recibido|Nuevo voucher/); check(/cid:logo@legaltax/.test(doc.html) && att(doc, /logo\.png/), 'Los correos llevan el logo de LegalTax');
    fs.writeFileSync(path.join(OUT, 'correo-reporte-diario.html'), dr.html.replace('cid:logo@legaltax', 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '..', 'public', 'brand', 'logo.png')).toString('base64')));
  }
  const failed = results.filter(r => !r[0]).length;
  console.log(`\n${results.length - failed}/${results.length} verificaciones correctas. Capturas y PDF en ${OUT}`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('\n✘ ERROR:', e.message); process.exit(1); });
