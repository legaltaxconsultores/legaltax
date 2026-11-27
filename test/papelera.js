// Prueba de la papelera de facturas: eliminar (con motivo), ocultar en listas y portal, refacturar, restaurar y borrar definitivamente.
// Uso: BASE=http://localhost:3000 node test/papelera.js   (servidor con datos de demostración)
const { chromium, request } = require('playwright');
const fs = require('fs'); const path = require('path');
const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = path.join(__dirname, 'output', 'papelera'); fs.mkdirSync(OUT, { recursive: true });
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) process.exitCode = 1; };
const toast = async (p, re) => (await p.locator('.toast').filter({ hasText: re }).first().waitFor({ timeout: 10000 }), true);

(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE + '/#/login'); await p.fill('#lf input[name=email]', 'admin'); await p.fill('#lf input[name=password]', 'LegalTax2026!'); await p.click('#lbtn'); await p.waitForSelector('#shell');
  const api = p.request; const J = async r => { const j = await r.json(); if (!r.ok()) throw new Error(j.error); return j; };

  // cliente, cotización aceptada en dos cuotas y factura de la cuota 1
  const tag = String(Date.now()).slice(-5);
  const cl = await J(await api.post(BASE + '/api/clients', { data: { kind: 'empresa', name: 'Papelería del Ozama ' + tag + ', SRL', id_type: 'rnc', id_number: '1-30-' + tag + '-1', email: 'pagos@ozama.do' } }));
  const q = await J(await api.post(BASE + '/api/quotes', { data: { client_id: cl.id, title: 'Registro de marca', itbis_applies: false, items: [{ kind: 'honorario', description: 'Honorarios', amount: 10000 }],
    installments: [{ due_date: '2026-12-15', amount: 5000 }, { due_date: '2027-01-15', amount: 5000 }] } }));
  await J(await api.post(`${BASE}/api/quotes/${q.id}/publish`)); await J(await api.post(`${BASE}/api/quotes/${q.id}/accept`, { data: { decision: 'aceptar' } }));
  const qd = await J(await api.get(`${BASE}/api/quotes/${q.id}`)); const ins1 = qd.installments[0].id;
  const inv1 = await J(await api.post(BASE + '/api/invoices', { data: { quote_id: q.id, installment_id: ins1, share: true } }));

  // eliminar desde la pantalla de Facturas
  await p.evaluate(() => { location.hash = '#/facturas'; }); await p.waitForSelector(`button[data-act=invdel][data-id="${inv1.id}"]`);
  await p.click(`button[data-act=invdel][data-id="${inv1.id}"]`);
  ok((await p.textContent('.modal')).includes('papelera'), 'Al eliminar se explica que va a la papelera y que el NCF no se reutiliza');
  await p.click('.modal button[type=submit]'); ok(await p.locator('.modal textarea[name=reason]').count() === 1, 'El motivo es obligatorio');
  await p.fill('.modal textarea[name=reason]', 'Generada por error'); await p.click('.modal button[type=submit]'); await toast(p, /papelera/);
  await p.waitForFunction(id => !document.querySelector(`button[data-act=invdel][data-id="${id}"]`), inv1.id);
  ok(true, `Factura ${inv1.number} movida a la papelera y quitada de la lista`);
  const all = await J(await api.get(BASE + '/api/invoices')); ok(!all.some(x => x.id === inv1.id), 'No aparece en /api/invoices');
  const det = await J(await api.get(`${BASE}/api/clients/${cl.id}`)); ok(!det.gendocs.some(g => g.number === inv1.number), 'Su PDF no aparece en los documentos del cliente');

  // se puede volver a facturar la misma cuota
  const inv2 = await J(await api.post(BASE + '/api/invoices', { data: { quote_id: q.id, installment_id: ins1 } }));
  ok(inv2.number !== inv1.number, `La cuota se vuelve a facturar con un número nuevo (${inv2.number}); el anterior no se reutiliza`);
  const r409 = await api.post(`${BASE}/api/invoices/${inv1.id}/restore`);
  ok(r409.status() === 409 && (await r409.json()).error.includes(inv2.number), 'Restaurar choca con la factura vigente de la misma cuota: lo impide con mensaje claro');

  // papelera en pantalla
  await J(await api.post(`${BASE}/api/invoices/${inv2.id}/delete`, { data: { reason: 'Prueba' } }));
  await p.evaluate(() => { location.hash = '#/facturas?state=papelera'; }); await p.waitForSelector(`button[data-act=invrestore][data-id="${inv1.id}"]`);
  ok((await p.textContent('#content')).includes('Generada por error'), 'La papelera muestra quién, cuándo y por qué se eliminó');
  await p.screenshot({ path: path.join(OUT, 'papelera.png'), fullPage: true });
  await p.click(`button[data-act=invrestore][data-id="${inv1.id}"]`); await toast(p, /restaurada/);
  const back = await J(await api.get(BASE + '/api/invoices')); ok(back.some(x => x.id === inv1.id && x.state.code), 'Restaurada: vuelve a la lista con su estado de pago');

  // Cobros no borra definitivamente
  const cob = await request.newContext(); await cob.post(BASE + '/api/login', { data: { email: 'cobros', password: 'LegalTax2026!' } });
  ok((await cob.delete(`${BASE}/api/invoices/${inv2.id}`, { data: { confirm: inv2.number } })).status() === 403, 'Cobros no puede borrar definitivamente (solo Administración)');
  await cob.dispose();

  // borrado definitivo con confirmación del número
  await p.evaluate(() => { location.hash = '#/facturas?state=papelera&r=1'; }); await p.waitForSelector(`button[data-act=invpurge][data-id="${inv2.id}"]`);
  await p.click(`button[data-act=invpurge][data-id="${inv2.id}"]`); await p.fill('.modal input[name=confirm]', 'OTRA'); await p.click('.modal button[type=submit]');
  await toast(p, /escriba el número/); ok(true, 'Si no se escribe el número exacto, no borra');
  await p.fill('.modal input[name=confirm]', inv2.number); await p.click('.modal button[type=submit]'); await toast(p, /definitivamente/);
  ok((await api.get(`${BASE}/api/gendocs/${inv2.gendoc_id}/pdf`)).status() === 404, 'El PDF de la factura borrada ya no existe');
  const trash = await J(await api.get(BASE + '/api/invoices?state=papelera')); ok(!trash.some(x => x.id === inv2.id), 'Ya no está en la papelera');
  const aud = await J(await api.get(BASE + '/api/audit?q=factura'));
  ok(['eliminar', 'restaurar', 'borrar_definitivo'].every(a => aud.some(x => x.action === a)), 'Auditoría registra eliminar, restaurar y borrado definitivo (con copia de los datos)');
  ok(errs.length === 0, 'Sin errores de JavaScript' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
})().catch(e => { console.error('✘', e.message); process.exit(1); });
