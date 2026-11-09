// Prueba de la consulta de RNC con una imitación local de la página de la DGII y del padrón oficial.
// Uso: node test/dgii.js   (arranca su propio servidor LegalTax en el puerto 3500 apuntando a la imitación)
const http = require('http'); const fs = require('fs'); const path = require('path'); const { spawn } = require('child_process');
const { chromium } = require('playwright');
const FAKE = 8099, APP = 3500;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) process.exitCode = 1; };
let liveUp = true, posts = 0;

// ── imitación de rnc.aspx (formulario ASP.NET con __VIEWSTATE y cookie de sesión)
const page = body => `<!DOCTYPE html><html><head><title>Consultas DGII</title></head><body><form method="post" action="./rnc.aspx" id="aspnetForm">
<input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="dDwtMTA4NzQ0NDE3Mjs7Pg==" />
<input type="hidden" name="__VIEWSTATEGENERATOR" id="__VIEWSTATEGENERATOR" value="8C2D6A8E" />
<input type="hidden" name="__EVENTVALIDATION" id="__EVENTVALIDATION" value="/wEdAAP6RkM=" />
<label>RNC o Cédula</label><input name="ctl00$cphMain$txtRNCCedula" type="text" id="ctl00_cphMain_txtRNCCedula" />
<input type="submit" name="ctl00$cphMain$btnBuscarPorRNC" value="BUSCAR" id="ctl00_cphMain_btnBuscarPorRNC" />
<input type="text" name="ctl00$cphMain$txtRazonSocial" id="ctl00_cphMain_txtRazonSocial" /><input type="submit" name="ctl00$cphMain$btnBuscarPorRazonSocial" value="BUSCAR" />
${body}</form></body></html>`;
const result = `<table id="ctl00_cphMain_dvDatosContribuyentes" class="detailview">
<tr><td class="campo">C&#233;dula/RNC</td><td>131-99999-8</td></tr>
<tr><td class="campo">Nombre/Raz&#243;n Social</td><td>DISTRIBUIDORA DEL CIBAO, SRL</td></tr>
<tr><td class="campo">Nombre Comercial</td><td>DISTRICIBAO</td></tr>
<tr><td class="campo">Categor&#237;a</td><td></td></tr>
<tr><td class="campo">R&#233;gimen de pagos</td><td>NORMAL</td></tr>
<tr><td class="campo">Estado</td><td>ACTIVO</td></tr>
<tr><td class="campo">Actividad Economica</td><td>VENTA AL POR MAYOR DE PRODUCTOS ALIMENTICIOS</td></tr>
<tr><td class="campo">Administracion Local</td><td>ADM LOCAL SANTIAGO</td></tr></table>`;
const fake = http.createServer((req, res) => {
  if (req.url.startsWith('/padron.zip')) { res.writeHead(200, { 'Content-Type': 'application/zip' }); return fs.createReadStream(path.join(__dirname, 'output', 'DGII_RNC.zip')).pipe(res); }
  if (!liveUp) { res.writeHead(503); return res.end('Servicio no disponible'); }
  if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': 'ASP.NET_SessionId=abc123; path=/; HttpOnly' }); return res.end(page('')); }
  let b = ''; req.on('data', d => (b += d)); req.on('end', () => {
    posts++; const f = new URLSearchParams(b);
    const valid = f.get('__VIEWSTATE') && f.get('__EVENTVALIDATION') && /ASP\.NET_SessionId=abc123/.test(req.headers.cookie || '') && f.get('ctl00$cphMain$btnBuscarPorRNC') === 'BUSCAR';
    if (!valid) { res.writeHead(500); return res.end('formulario incompleto'); }
    const rnc = (f.get('ctl00$cphMain$txtRNCCedula') || '').replace(/\D/g, '');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page(rnc === '131999998' ? result : '<div id="ctl00_cphMain_divAlertDanger" class="alert alert-danger">No se encontraron datos registrados.</div>'));
  });
});

(async () => {
  fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });
  // padrón de ejemplo (formato DGII: campos separados por "|", codificación latin1)
  const txt = ['101012345|CONSTRUCTORA DEL ESTE, SRL|CONSTRUESTE|CONSTRUCCION DE EDIFICIOS|||||01/02/2010|ACTIVO|NORMAL', '401556677|COMERCIAL PE\xd1A & ASOCIADOS, SRL||COMERCIO AL POR MENOR|||||05/06/2015|SUSPENDIDO|NORMAL'].join('\r\n');
  await new Promise((r, j) => { const out = fs.createWriteStream(path.join(__dirname, 'output', 'DGII_RNC.zip')); const z = require('archiver')('zip'); out.on('close', r); z.on('error', j); z.pipe(out); z.append(Buffer.from(txt, 'latin1'), { name: 'TMP/DGII_RNC.TXT' }); z.finalize(); });
  await new Promise(r => fake.listen(FAKE, r));
  const app = spawn('node', ['src/server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(APP), DGII_RNC_URL: `http://localhost:${FAKE}/rnc.aspx`, DGII_PADRON_URL: `http://localhost:${FAKE}/padron.zip` }, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 2000));
  const B = `http://localhost:${APP}`;
  try {
    const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1300, height: 860 } }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(B + '/#/login'); await p.fill('#lf input[name=email]', 'admin'); await p.fill('#lf input[name=password]', 'LegalTax2026!'); await p.click('#lbtn'); await p.waitForSelector('#shell');
    await p.request.post(B + '/api/dgii/test', { data: { rnc: '000000000' } }); // limpia
    await p.evaluate(() => { location.hash = '#/clientes'; }); await p.click('button[data-act=new]');
    await p.fill('.modal input[name=id_number]', '131999998');
    await p.waitForSelector('#dgiimsg.ok', { timeout: 10000 });
    const name = await p.inputValue('.modal input[name=name]');
    ok(name === 'DISTRIBUIDORA DEL CIBAO, SRL', `Al escribir el RNC 131999998 se completa el nombre: “${name}”`);
    ok(await p.inputValue('.modal input[name=trade_name]') === 'DISTRICIBAO' && await p.inputValue('.modal input[name=id_number]') === '1-31-99999-8', 'También el nombre comercial y el RNC con formato 1-31-99999-8');
    ok((await p.textContent('#dgiimsg')).includes('ACTIVO') && (await p.textContent('#dgiimsg')).includes('Consulta en línea'), 'Muestra estado ACTIVO y actividad económica desde la consulta en línea');
    await p.screenshot({ path: path.join(__dirname, 'output', 'dgii-nuevo-cliente.png') });
    await p.fill('.modal input[name=id_number]', '00112345678'); await p.waitForSelector('#dgiimsg.warn', { timeout: 10000 });
    ok((await p.textContent('#dgiimsg')).includes('no tiene registrado'), 'Cédula inexistente: avisa que la DGII no la tiene registrada');
    await p.click('.modal [data-close]');
    const before = posts; await p.request.get(B + '/api/dgii/rnc/131999998'); ok(posts === before, 'Una segunda consulta del mismo RNC sale de la caché (no vuelve a consultar la DGII)');
    // padrón de respaldo
    await p.request.post(B + '/api/dgii/padron'); let st; for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 500)); st = await (await p.request.get(B + '/api/dgii/status')).json(); if (!st.job.running) break; }
    ok(st.padron === 2 && !st.job.error, `Padrón oficial importado desde el ZIP: ${st.padron} contribuyentes ${st.job.error || ''}`);
    liveUp = false;
    const r1 = await (await p.request.get(B + '/api/dgii/rnc/101012345')).json();
    ok(r1.found && r1.name === 'CONSTRUCTORA DEL ESTE, SRL' && r1.source === 'padron', 'Con la página de la DGII caída, el nombre sale del padrón local');
    const r2 = await (await p.request.get(B + '/api/dgii/rnc/401556677')).json();
    ok(r2.name === 'COMERCIAL PEÑA & ASOCIADOS, SRL' && r2.status === 'SUSPENDIDO', 'Acentos y eñes correctos, y estado SUSPENDIDO detectado');
    const r3 = await p.request.get(B + '/api/dgii/rnc/130000001'); const j3 = await r3.json();
    ok(r3.status() === 502 && j3.error.includes('Escriba el nombre manualmente'), 'Si no hay página ni padrón: mensaje claro para escribir el nombre a mano' + (r3.status() === 502 ? '' : ` [${r3.status()} ${JSON.stringify(j3)}]`));
    await p.evaluate(() => { location.hash = '#/admin?tab=dgii'; }); await p.waitForSelector('#dt');
    ok((await p.textContent('#content')).includes('Contribuyentes en el padrón'), 'Configuración → Consulta DGII: estado del padrón y prueba de conexión');
    ok(errs.length === 0, 'Sin errores de JavaScript' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await b.close();
  } finally { app.kill(); fake.close(); }
})().catch(e => { console.error('✘', e.message); process.exit(1); });
