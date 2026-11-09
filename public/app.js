/* LegalTax · aplicación de una sola página (sin dependencias externas) */
'use strict';

// ───────────────────────── utilidades
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = s => new Raw(s);
function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    const one = x => (x instanceof Raw ? x.s : x === false || x === null || x === undefined ? '' : esc(x));
    out += (Array.isArray(v) ? v.map(one).join('') : one(v)) + strings[i + 1];
  });
  return raw(out);
}
const TZ = 'America/Santo_Domingo';
const money = n => 'RD$ ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fdate = d => { if (!d) return ''; if (/^\d{4}-\d{2}-\d{2}$/.test(d)) { const [y, m, x] = d.split('-'); return `${x}/${m}/${y}`; } return new Intl.DateTimeFormat('es-DO', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d)); };
const fdt = d => d ? new Intl.DateTimeFormat('es-DO', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(d)) : '';
const today = (offset = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() + offset * 864e5));
const addMonths = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1 + n, 1)); const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate(); dt.setUTCDate(Math.min(d, last)); return dt.toISOString().slice(0, 10); };
const addDays = (iso, n) => { const dt = new Date(iso + 'T12:00:00Z'); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10); };
const r2 = n => Math.round(Number(n) * 100) / 100;
const toLocalInput = d => { const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(d)); const g = t => p.find(x => x.type === t).value; return `${g('year')}-${g('month')}-${g('day')}T${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`; };

const L = {
  role: { admin: 'Administración', expedientes: 'Equipo de expedientes', cobros: 'Cobros', cliente: 'Cliente' },
  caseStatus: { abierto: 'Abierto', en_tramite: 'En trámite', en_espera: 'En espera', cerrado: 'Cerrado', archivado: 'Archivado' },
  event: { actuacion: 'Actuación', deposito: 'Depósito', notificacion: 'Notificación', decision: 'Decisión', documento: 'Documento', reunion: 'Reunión', nota: 'Nota' },
  quote: { borrador: 'Borrador', publicada: 'Pendiente de aceptación', aceptada: 'Aceptada', rechazada: 'Rechazada', anulada: 'Anulada' },
  pay: { pendiente: 'Pendiente de validar', validado: 'Validado', rechazado: 'Rechazado', anulado: 'Anulado' },
  method: { transferencia: 'Transferencia', deposito: 'Depósito bancario', efectivo: 'Efectivo', cheque: 'Cheque', tarjeta: 'Tarjeta' },
  req: { pendiente: 'Pendiente', recibida: 'Recibida', devuelta: 'Devuelta para corrección' },
  dl: { audiencia: 'Audiencia', reunion: 'Reunión', plazo: 'Plazo', tarea: 'Tarea' },
  doc: { cotizacion: 'Cotización', recibo_dinero: 'Recibo de dinero', recibo_documentos: 'Recibo de documentos', estado_cuenta: 'Estado de cuenta', informe_avance: 'Informe de avance', ficha_cliente: 'Ficha de cliente', ficha_expediente: 'Ficha de expediente', factura: 'Factura' },
  gd: { vigente: 'Vigente', reemplazado: 'Reemplazado', anulado: 'Anulado' },
  cat: { resolucion: 'Resolución', acuse: 'Acuse', constancia_deposito: 'Constancia de depósito', notificacion: 'Notificación', voucher: 'Voucher', contrato: 'Contrato', identificacion: 'Identificación', estado_financiero: 'Estado financiero', declaracion: 'Declaración', correspondencia: 'Correspondencia', otro: 'Otro' },
  idt: { cedula: 'Cédula', rnc: 'RNC', pasaporte: 'Pasaporte' },
};
const tone = {
  caseStatus: { abierto: 'info', en_tramite: 'gold', en_espera: 'warn', cerrado: 'ok', archivado: '' },
  quote: { borrador: '', publicada: 'warn', aceptada: 'ok', rechazada: 'bad', anulada: 'bad' },
  pay: { pendiente: 'warn', validado: 'ok', rechazado: 'bad', anulado: 'bad' },
  req: { pendiente: 'warn', recibida: 'ok', devuelta: 'bad' },
  gd: { vigente: 'ok', reemplazado: '', anulado: 'bad' },
  inst: { pagada: 'ok', vencida: 'bad', parcial_vencida: 'bad', parcial: 'gold', pendiente: 'warn' },
};
const badge = (map, v) => html`<span class="b ${tone[map]?.[v] || ''}">${L[map]?.[v] || v}</span>`;
const opts = (map, sel, blank) => raw((blank !== undefined ? `<option value="">${esc(blank)}</option>` : '') + Object.entries(map).map(([k, v]) => `<option value="${esc(k)}"${String(k) === String(sel ?? '') ? ' selected' : ''}>${esc(v)}</option>`).join(''));
const optList = (list, sel, blank, label = x => x.name) => raw((blank !== undefined ? `<option value="">${esc(blank)}</option>` : '') + list.map(x => `<option value="${x.id}"${String(x.id) === String(sel ?? '') ? ' selected' : ''}>${esc(label(x))}</option>`).join(''));

// ───────────────────────── API
async function api(method, url, body) {
  const o = { method, headers: {}, credentials: 'same-origin' };
  if (body instanceof FormData) o.body = body;
  else if (body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
  const r = await fetch(url, o);
  if (r.status === 401 && !url.startsWith('/api/login')) { state.me = null; go('#/login'); throw new Error('Su sesión expiró. Inicie sesión de nuevo.'); }
  const ct = r.headers.get('content-type') || '';
  if (!r.ok) { const e = ct.includes('json') ? (await r.json()).error : r.statusText; throw new Error(e || 'Error'); }
  if (ct.includes('application/pdf')) return r.blob();
  return ct.includes('json') ? r.json() : r.text();
}
const GET = u => api('GET', u), POST = (u, b) => api('POST', u, b ?? {}), PATCH = (u, b) => api('PATCH', u, b), PUT = (u, b) => api('PUT', u, b);
const qs = o => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
const formData = f => { const o = {}; new FormData(f).forEach((v, k) => { if (!(v instanceof File)) o[k] = v; }); $$('input[type=checkbox]', f).forEach(c => { if (c.name) o[c.name] = c.checked; }); return o; };

function toast(msg, err) { const root = $('#toast-root'); while (root.children.length >= 3) root.firstChild.remove(); const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; $('#toast-root').appendChild(t); setTimeout(() => t.remove(), err ? 6000 : 3500); }
const fail = e => toast(e.message || String(e), true);

// ───────────────────────── modal
function modal(title, body, { wide, submit, submitLabel = 'Guardar', footer, onMount } = {}) {
  const root = $('#modal-root');
  const el = document.createElement('div'); el.className = 'modal-bg';
  el.innerHTML = String(html`<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><form novalidate>
    <header><h2>${title}</h2><button type="button" class="x" aria-label="Cerrar">×</button></header>
    <div class="body">${raw(String(body))}</div>
    <footer>${footer ? raw(String(footer)) : ''}<button type="button" class="btn" data-close>${submit ? 'Cancelar' : 'Cerrar'}</button>${submit ? html`<button class="btn primary" type="submit">${submitLabel}</button>` : ''}</footer>
  </form></div>`);
  root.appendChild(el);
  const close = () => el.remove();
  el.addEventListener('click', e => { if (e.target === el || e.target.closest('.x') || e.target.closest('[data-close]')) close(); });
  const form = $('form', el);
  form.addEventListener('submit', async e => {
    e.preventDefault(); if (!submit) return;
    const btn = $('button[type=submit]', form); btn.disabled = true;
    try { const r = await submit(formData(form), form); if (r !== false) close(); } catch (err) { fail(err); } finally { btn.disabled = false; }
  });
  onMount && onMount(form, close);
  const first = $('input:not([type=hidden]),select,textarea', form); first && setTimeout(() => first.focus(), 30);
  return { el, close, form };
}
function viewPdf(url, title = 'Documento') {
  const dl = url.replace('inline=1', '').replace(/[?&]$/, '');
  const gid = (url.match(/gendocs\/(\d+)/) || [])[1];
  const staff = state.me && state.me.role !== 'cliente';
  const m = modal(title, html`<iframe class="pdf-frame" src="${url}" title="${title}"></iframe>
    <p class="small muted">Si su dispositivo no muestra el PDF aquí, use “Abrir” o “Descargar”.</p>`,
  { wide: true, footer: html`${gid && staff ? html`<button type="button" class="btn mail" data-mail>✉ Enviar por correo</button>` : ''}<a class="btn" href="${url}" target="_blank" rel="noopener">Abrir</a><a class="btn primary" href="${dl}" download>Descargar PDF</a>` });
  const mb = $('[data-mail]', m.el); if (mb) mb.onclick = () => emailModal({ title: 'Enviar PDF por correo', url: '/api/email/gendoc/' + gid });
}
const gdUrl = id => `/api/gendocs/${id}/pdf?inline=1`;
async function previewPdf(doc_type, params) {
  const blob = await POST('/api/gendocs/preview', { doc_type, params });
  const u = URL.createObjectURL(blob);
  modal('Vista previa', html`<iframe class="pdf-frame" src="${u}" title="Vista previa"></iframe>`, { wide: true, footer: html`<a class="btn" href="${u}" target="_blank" rel="noopener">Abrir en pestaña</a>` });
}

// ───────────────────────── envío por correo
function emailModal({ title, url, payload = {}, clientEmail, note }) {
  const inbox = state.mail?.inbox || '';
  const warn = state.mail && state.mail.configured === false
    ? html`<div class="alert warn">El correo aún no está configurado. ${state.me.role === 'admin' ? html`Configúrelo en <a href="#/admin?tab=correo">Configuración → Correo</a>.` : 'Pida a Administración que lo configure.'}</div>` : '';
  modal(title, html`${warn}${note ? html`<p class="small muted">${note}</p>` : ''}
    <label class="f">Para<input name="to" required value="${inbox}" placeholder="correo@ejemplo.com (separe varios con coma)"></label>
    <div class="chips" style="margin:6px 0 10px">${inbox ? html`<button type="button" class="chip" data-to="${inbox}">Correo del despacho</button>` : ''}${clientEmail ? html`<button type="button" class="chip" data-to="${clientEmail}">Correo del cliente</button>` : ''}</div>
    <label class="f">Copia (CC)<input name="cc" placeholder="opcional"></label>
    <label class="f" style="margin-top:8px">Asunto<input name="subject" placeholder="Se completa automáticamente si lo deja vacío"></label>
    <label class="f" style="margin-top:8px">Mensaje<textarea name="message" placeholder="Opcional"></textarea></label>`, {
    submitLabel: 'Enviar',
    onMount: f => $$('[data-to]', f).forEach(b => b.onclick = () => { f.to.value = b.dataset.to; }),
    submit: async d => { await POST(url, { ...payload, ...d }); toast('Correo enviado a ' + d.to); },
  });
}

// ───────────────────────── avisos al cliente: correo o WhatsApp
const NOTICE_TITLE = { aviso_pago: 'Aviso de pago', pago_recibido: 'Aviso de pago recibido', factura: 'Aviso de factura generada', estado_factura: 'Estado de factura', documento: 'Enviar documento al cliente', general: 'Mensaje al cliente' };
async function noticeModal(kind, clientId, ref) {
  const d = await GET('/api/notices/compose?' + qs({ kind, client_id: clientId, ref }));
  const noMail = state.mail && state.mail.configured === false;
  const m = modal(`${NOTICE_TITLE[kind]} · ${d.client.name}`, html`
    <label class="f">Mensaje (puede editarlo)<textarea name="text" rows="11">${d.text}</textarea></label>
    <p class="small muted" style="margin:4px 0 12px">Texto entre *asteriscos* sale en negrita en WhatsApp y en el correo.</p>
    <div class="grid g2">
      <div class="card" style="margin:0"><h3>✉ Correo</h3>
        ${noMail ? html`<div class="alert warn small">El correo aún no está configurado.</div>` : ''}
        <label class="f">Para<input name="to" value="${d.client.email || ''}" placeholder="correo del cliente"></label>
        <label class="f" style="margin-top:6px">CC<input name="cc" placeholder="opcional"></label>
        <label class="f" style="margin-top:6px">Asunto<input name="subject" value="${d.subject}"></label>
        ${d.attachment ? html`<label class="chk" style="margin-top:6px"><input type="checkbox" name="attach" checked> Adjuntar ${d.attachment.name}</label>` : ''}
        <button type="submit" class="btn primary" style="margin-top:10px;width:100%">Enviar por correo</button></div>
      <div class="card" style="margin:0"><h3>💬 WhatsApp</h3>
        <label class="f">Número del contacto<input name="phone" value="${d.client.phone || ''}" placeholder="809 000 0000"></label>
        ${d.client.phone ? '' : html`<label class="chk" style="margin-top:6px"><input type="checkbox" name="save_phone" checked> Guardar este número en la ficha</label>`}
        <p class="small muted">Se abre WhatsApp (app o web) con el mensaje listo; usted pulsa “Enviar”.${d.attachment ? ' El PDF no se adjunta automáticamente: el cliente lo descarga en su portal o puede adjuntarlo usted.' : ''}</p>
        <button type="button" class="btn" data-wa style="width:100%;background:#25D366;border-color:#25D366;color:#fff">Abrir WhatsApp</button>
        ${d.attachment ? html`<a class="btn sm" style="margin-top:8px;width:100%" href="/api/gendocs/${d.attachment.id}/pdf">⤓ Descargar ${d.attachment.name}</a>` : ''}</div>
    </div>`, {
    wide: true,
    submit: async x => { if (!x.to) throw new Error('Indique el correo de destino'); await POST('/api/notices/email', { kind, client_id: clientId, ref, to: x.to, cc: x.cc, subject: x.subject, text: x.text, attach: x.attach !== false }); toast('Aviso enviado por correo a ' + x.to); },
  });
  m.el.querySelector('footer [type=submit]')?.remove();
  $('[data-wa]', m.el).onclick = async () => {
    const x = formData(m.form); const w = window.open('', '_blank');
    try { const r = await POST('/api/notices/whatsapp', { kind, client_id: clientId, ref, phone: x.phone, text: x.text, save_phone: x.save_phone }); if (w) w.location = r.url; else location.href = r.url; toast('WhatsApp abierto con el mensaje'); m.close(); }
    catch (e) { if (w) w.close(); fail(e); }
  };
}
const notice = (kind, clientId, ref) => noticeModal(kind, clientId, ref).catch(fail);

// ───────────────────────── estado y enrutador
let syncLast = null;
const state = { me: null, client: null, firm: {}, staff: [] };
const go = h => { if (location.hash !== h) location.hash = h; else render(); };
const routes = [];
const route = (re, fn, roles) => routes.push({ re, fn, roles });
window.addEventListener('hashchange', () => render());

async function boot() {
  try { const r = await GET('/api/me'); state.me = r.user; state.client = r.client; state.firm = r.firm || {}; state.demo = !!r.demo; } catch (_) { state.me = null; }
  if (state.me && state.me.role !== 'cliente') {
    syncLast = (await GET('/api/sync').catch(() => ({}))).last ?? null;
    state.staff = await GET('/api/staff').catch(() => []);
    state.mail = await GET('/api/email/config').catch(() => ({}));
    state.docTypes = await GET('/api/doc-types').catch(() => []);
  }
  render();
}
async function render(opts = {}) {
  const hash = location.hash || '#/';
  if (hash.startsWith('#/invitacion/')) return viewInvite(hash.split('/')[2]);
  if (!state.me) return viewLogin();
  if (hash === '#/login') return go('#/');
  const path = hash.slice(1).split('?')[0];
  const query = Object.fromEntries(new URLSearchParams(hash.split('?')[1] || ''));
  const isClient = state.me.role === 'cliente';
  shell();
  // contenedor nuevo en cada navegación para no acumular manejadores de eventos
  const old = $('#content'); const main = old.cloneNode(false); old.replaceWith(main);
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    if (r.roles && !r.roles.includes(state.me.role)) { main.innerHTML = '<div class="card empty">No tiene permiso para ver esta sección.</div>'; return; }
    main.innerHTML = '<div class="empty">Cargando…</div>';
    try { await r.fn(main, m.slice(1), query); } catch (e) { main.innerHTML = String(html`<div class="card alert bad">${e.message}</div>`); }
    if (!opts.silent) window.scrollTo(0, 0);
    return;
  }
  main.innerHTML = '<div class="card empty">Página no encontrada.</div>';
}

function shell() {
  const me = state.me; const isClient = me.role === 'cliente';
  if ($('#shell') && $('#shell').dataset.role === me.role) { markNav(); return; }
  const staffNav = [
    ['#/', '⌂', 'Inicio'], ['#/consultas', '⌕', 'Consultas'], ['#/clientes', '◉', 'Clientes'], ['#/expedientes', '▤', 'Expedientes'], ['#/carpetas', '📁', 'Carpetas'],
    ['#/agenda', '◷', 'Agenda y vencimientos'], ['#/cotizaciones', '✎', 'Cotizaciones'], ['#/facturas', '🧾', 'Facturas'], ['#/pagos', '$', 'Vouchers y pagos'],
    ['#/solicitudes', '⇪', 'Solicitudes de documentos'], ['#/documentos', '⎙', 'Documentos PDF'],
  ];
  const clientNav = [['#/', '⌂', 'Inicio'], ['#/mis-casos', '▤', 'Mis casos'], ['#/mis-cotizaciones', '✎', 'Cotizaciones'], ['#/mis-pagos', '$', 'Cuotas y pagos'], ['#/mis-facturas', '🧾', 'Facturas'], ['#/mis-solicitudes', '⇪', 'Solicitudes'], ['#/mis-documentos', '⎙', 'Mis documentos']];
  const nav = isClient ? clientNav : staffNav;
  const brand = html`<img class="full" src="/api/firm-logo" alt="${state.firm.name || 'LegalTax Consultores SRL'}">`;
  $('#app').innerHTML = String(html`<div class="shell" id="shell" data-role="${me.role}">
    <aside class="side" id="side">
      <div class="brand">${brand}</div>
      <nav class="nav">
        ${isClient ? html`<div class="nav-sep">Portal del cliente</div>` : ''}
        ${nav.map(([h, ic, l]) => html`<a href="${h}" data-nav="${h}"><span class="ic">${ic}</span>${l}</a>`)}
        ${me.role === 'admin' ? html`<div class="nav-sep">Administración</div><a href="#/admin" data-nav="#/admin"><span class="ic">⚙</span>Configuración</a>` : ''}
      </nav>
      <div class="who"><b>${me.name}</b>${isClient ? state.client?.name : L.role[me.role]}<br><button class="btn sm" id="logout" style="margin-top:8px">Cerrar sesión</button></div>
    </aside>
    <div class="main">
      <div class="top">
        <button class="menu-btn" id="menu" aria-label="Menú">☰</button>
        ${isClient ? html`<div style="flex:1;font-weight:600;color:var(--navy)">${state.client?.name || ''}</div>` : html`<form id="gsearch" role="search"><input type="search" name="q" placeholder="Buscar por nombre, cédula/RNC, expediente, resolución, cotización…" autocomplete="off" aria-label="Buscador global"></form>`}
      </div>
      <div class="content" id="content"></div>
    </div>
  </div>`);
  $('#logout').onclick = async () => { await POST('/api/logout').catch(() => {}); state.me = null; location.hash = '#/login'; render(); };
  $('#menu').onclick = () => $('#side').classList.toggle('open');
  $('#side').addEventListener('click', e => { if (e.target.closest('a')) $('#side').classList.remove('open'); });
  const gs = $('#gsearch'); if (gs) gs.onsubmit = e => { e.preventDefault(); const q = gs.q.value.trim(); if (q) go('#/buscar?q=' + encodeURIComponent(q)); };
  markNav();
}
function markNav() {
  const p = (location.hash || '#/').split('?')[0];
  $$('[data-nav]').forEach(a => { const h = a.dataset.nav; a.classList.toggle('active', h === '#/' ? p === '#/' || p === '#' : p.startsWith(h)); });
}
const head = (title, sub, actions = '', crumbs = '') => html`<div class="page-head"><div>${crumbs ? html`<div class="crumbs">${crumbs}</div>` : ''}<h1>${title}</h1>${sub ? html`<div class="sub">${sub}</div>` : ''}</div><div class="actions">${actions}</div></div>`;
function table(cols, rows, { empty = 'Sin registros.', onRow, foot, cls = 'stack' } = {}) {
  if (!rows.length) return html`<div class="empty">${empty}</div>`;
  return html`<div style="overflow-x:auto"><table class="tbl ${cls}"><thead><tr>${cols.map(c => html`<th class="${c.num ? 'num' : ''}">${c.h}</th>`)}</tr></thead>
    <tbody>${rows.map((r, i) => html`<tr class="${onRow ? 'click' : ''}" data-i="${i}">${cols.map(c => html`<td class="${c.num ? 'num' : ''}" data-l="${c.h}">${c.v(r)}</td>`)}</tr>`)}</tbody>
    ${foot ? raw(String(foot)) : ''}</table></div>`;
}
function bindRows(root, rows, fn) { $$('tr.click', root).forEach(tr => tr.addEventListener('click', e => { if (e.target.closest('a,button,input,select')) return; fn(rows[tr.dataset.i]); })); }
function on(root, sel, ev, fn) { $$(sel, root).forEach(el => el.addEventListener(ev, e => fn(e, el))); }
function act(root, handlers) {
  root.addEventListener('click', async e => {
    const el = e.target.closest('[data-act]'); if (!el || !root.contains(el)) return;
    const h = handlers[el.dataset.act]; if (!h) return;
    e.preventDefault();
    try { await h(el.dataset, el); } catch (err) { fail(err); }
  });
}

// ───────────────────────── inicio de sesión e invitación
function viewLogin() {
  $('#app').innerHTML = String(html`<div class="login">
    <section class="hero">
      <div><span class="logo-card"><img src="/brand/logo.png" alt="LegalTax Consultores SRL"></span></div>
      <div><h1>Expedientes, cobros y documentos <span class="gold">en un solo lugar.</span></h1>
      <p>Panel interno del despacho y portal privado para clientes. República Dominicana · Montos en RD$ · Hora de Santo Domingo.</p></div>
      <div class="foot small" style="color:#8FA0BF">Acceso restringido. Toda actividad queda registrada.</div>
    </section>
    <section class="panel"><form id="lf" autocomplete="on">
      <h2>Iniciar sesión</h2>
      <label class="f">Correo electrónico<input name="email" type="email" required autocomplete="username"></label>
      <label class="f">Contraseña<input name="password" type="password" required autocomplete="current-password"></label>
      <button class="btn primary" style="width:100%;padding:11px">Entrar</button>
      ${state.demo ? html`<div class="demo-users"><b>Versión de prueba</b> — haga clic en un usuario para entrar (contraseña de todos: <code>LegalTax2026!</code>)<br>
        ${[['admin@legaltax.do', 'Administración'], ['expedientes@legaltax.do', 'Expedientes'], ['cobros@legaltax.do', 'Cobros'], ['maria.pena@example.com', 'Cliente: María Peña'], ['finanzas@caribeazul.do', 'Cliente: Constructora Caribe Azul']]
          .map(([e, l]) => html`<button type="button" class="btn link" data-email="${e}">${l}</button><br>`)}
      </div>` : html`<p class="small muted" style="margin-top:14px">¿Olvidó su contraseña? Pida a Administración un nuevo enlace de acceso.</p>`}
    </form></section></div>`);
  const f = $('#lf');
  // versión de prueba: un clic en el usuario completa correo y contraseña y entra
  on(f, '[data-email]', 'click', (e, b) => { f.email.value = b.dataset.email; f.password.value = 'LegalTax2026!'; f.requestSubmit ? f.requestSubmit() : f.onsubmit(new Event('submit')); });
  f.onsubmit = async e => {
    e.preventDefault();
    try { const r = await POST('/api/login', { email: f.email.value, password: f.password.value }); state.me = r.user; await boot(); go('#/'); }
    catch (err) { fail(err); }
  };
}
async function viewInvite(token) {
  $('#app').innerHTML = '<div class="boot">Verificando invitación…</div>';
  try {
    const inv = await GET('/api/invite/' + token);
    $('#app').innerHTML = String(html`<div class="login"><section class="hero"><div><span class="logo-card"><img src="/brand/logo.png" alt="LegalTax Consultores SRL"></span></div>
      <div><h1>Bienvenido, <span class="gold">${inv.name}</span></h1><p>Cree su contraseña para acceder de forma segura a sus expedientes, cotizaciones, pagos y documentos.</p></div><div></div></section>
      <section class="panel"><form id="if"><h2>Activar acceso</h2><p class="muted small">${inv.email}</p>
      <label class="f">Nueva contraseña (mínimo 8 caracteres)<input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
      <label class="f">Confirmar contraseña<input name="password2" type="password" required autocomplete="new-password"></label>
      <button class="btn primary" style="width:100%">Activar cuenta</button></form></section></div>`);
    $('#if').onsubmit = async e => {
      e.preventDefault(); const f = e.target;
      if (f.password.value !== f.password2.value) return toast('Las contraseñas no coinciden', true);
      try { await POST('/api/invite/' + token, { password: f.password.value }); await POST('/api/login', { email: inv.email, password: f.password.value }); location.hash = '#/'; await boot(); }
      catch (err) { fail(err); }
    };
  } catch (e) { $('#app').innerHTML = String(html`<div class="boot"><div class="card" style="max-width:420px"><h2>Invitación no válida</h2><p>${e.message}</p><a class="btn" href="#/login">Ir al inicio de sesión</a></div></div>`); }
}

// ═════════════════════════ PANEL INTERNO
const STAFF = ['admin', 'expedientes', 'cobros'];
const can = (...roles) => roles.includes(state.me.role);

route(/^\/$/, async el => {
  if (state.me.role === 'cliente') return portalHome(el);
  const d = await GET('/api/dashboard'); const k = d.kpis;
  el.innerHTML = String(html`${head('Panel de inicio', `${new Intl.DateTimeFormat('es-DO', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())} · Hola, ${state.me.name.split(' ')[0]}`, html`<button class="btn mail" data-act="daily">✉ Enviar reporte del día</button>`)}
    <div class="kpis">
      <a class="kpi" href="#/expedientes?status=activos"><div class="v">${k.active_cases}</div><div class="l">Expedientes activos</div></a>
      <a class="kpi gold" href="#/agenda?scope=proximas"><div class="v">${k.upcoming}</div><div class="l">Vencimientos próximos</div></a>
      <a class="kpi ${k.overdue ? 'bad' : ''}" href="#/agenda?scope=atrasadas"><div class="v">${k.overdue}</div><div class="l">Tareas atrasadas</div></a>
      <a class="kpi warn" href="#/cotizaciones?status=publicada"><div class="v">${k.pending_quotes}</div><div class="l">Cotizaciones pendientes</div></a>
      <a class="kpi ${k.vouchers ? 'warn' : ''}" href="#/pagos?status=pendiente"><div class="v">${k.vouchers}</div><div class="l">Vouchers por validar</div></a>
      <a class="kpi" href="#/consultas?entity=receivables"><div class="v" style="font-size:1.25rem">${money(k.receivable)}</div><div class="l">Saldo por cobrar</div></a>
      <a class="kpi" href="#/solicitudes"><div class="v">${k.requests}</div><div class="l">Solicitudes abiertas</div></a>
      <a class="kpi ${k.invoices_overdue ? 'bad' : ''}" href="#/facturas?state=vencidas"><div class="v">${k.invoices_overdue}</div><div class="l">Facturas vencidas</div></a>
    </div>
    <div class="grid g2">
      <div class="card flush"><h2>Próximos vencimientos</h2>${table([
        { h: 'Fecha', v: r => html`<span class="nowrap ${new Date(r.due_at) < new Date() ? 'b bad' : ''}">${fdt(r.due_at)}</span>` },
        { h: 'Descripción', v: r => html`<b>${r.title}</b><div class="small muted">${L.dl[r.kind]} · ${r.client_name || ''} ${r.case_code ? '· ' + r.case_code : ''}</div>` },
        { h: 'Responsable', v: r => r.responsible_name || '—' }], d.next, { empty: 'No hay vencimientos pendientes.' })}</div>
      <div class="card flush"><h2>Vouchers por validar</h2>${table([
        { h: 'Cliente', v: r => html`<b>${r.client_name}</b><div class="small muted">${r.quote_number} · ${fdate(r.paid_on)}</div>` },
        { h: 'Monto', num: true, v: r => money(r.amount_declared) },
        { h: '', v: () => html`<a class="btn sm" href="#/pagos?status=pendiente">Revisar</a>` }], d.vouchers, { empty: 'No hay comprobantes pendientes.' })}</div>
    </div>
    <div class="card flush"><h2>Actividad reciente</h2>${table([
      { h: 'Cuándo', v: r => html`<span class="nowrap small">${fdt(r.created_at)}</span>` }, { h: 'Usuario', v: r => r.user_name },
      { h: 'Acción', v: r => html`${r.action.replace(/_/g, ' ')} · <span class="muted">${r.entity.replace(/_/g, ' ')} ${r.entity_id || ''}</span>` }], d.activity)}</div>`);
  act(el, { daily: () => emailModal({ title: 'Enviar reporte del día', url: '/api/email/daily-report', note: 'Incluye indicadores, vencimientos de los próximos 7 días, vouchers pendientes, pagos validados desde ayer y un Excel con cuentas por cobrar.' }) });
});

// ───── buscador global
route(/^\/buscar$/, async (el, _, q) => {
  const term = q.q || ''; if ($('#gsearch')) $('#gsearch').q.value = term;
  const r = await GET('/api/search?' + qs({ q: term }));
  const sec = (title, rows, cols, href) => rows?.length ? html`<div class="card flush"><h2>${title} <span class="b">${rows.length}</span></h2>${table(cols, rows)}</div>`.s.replace(/<tr class="" data-i="(\d+)">/g, (m, i) => `<tr class="click" data-href="${esc(href(rows[i]))}">`) : '';
  const total = Object.values(r).reduce((s, x) => s + (x?.length || 0), 0);
  el.innerHTML = String(html`${head(`Resultados para “${term}”`, html`${total} coincidencias. Para filtros avanzados use <a href="#/consultas">Consultas</a>.`)}
    ${raw(sec('Clientes', r.clients, [{ h: 'Nombre', v: x => html`<b>${x.name}</b>` }, { h: 'Identificación', v: x => `${L.idt[x.id_type]} ${x.id_number}` }, { h: 'Tipo', v: x => x.kind === 'empresa' ? 'Empresa' : 'Persona física' }], x => '#/clientes/' + x.id))}
    ${raw(sec('Expedientes', r.cases, [{ h: 'Código', v: x => html`<b>${x.code}</b>` }, { h: 'Asunto', v: x => x.title }, { h: 'Cliente', v: x => x.client_name }, { h: 'Institución / No.', v: x => `${x.institution || ''} ${x.official_number || ''}` }, { h: 'Estado', v: x => badge('caseStatus', x.status) }], x => '#/expedientes/' + x.id))}
    ${raw(sec('Archivos y resoluciones', r.documents, [{ h: 'Documento', v: x => html`<b>${x.title}</b><div class="small muted">${x.filename}</div>` }, { h: 'No. resolución', v: x => x.resolution_number || '—' }, { h: 'Institución', v: x => x.institution || '' }, { h: 'Cliente / Exp.', v: x => `${x.client_name} ${x.case_code ? '· ' + x.case_code : ''}` }, { h: '', v: x => html`<a class="btn sm" href="/api/files/${x.id}?inline=1" target="_blank" rel="noopener">Ver</a>` }], x => x.case_id ? '#/expedientes/' + x.case_id : '#/consultas?entity=documents&resolution=' + encodeURIComponent(x.resolution_number || '')))}
    ${raw(sec('Cotizaciones', r.quotes, [{ h: 'Número', v: x => html`<b>${x.number}</b>` }, { h: 'Título', v: x => x.title }, { h: 'Cliente', v: x => x.client_name }, { h: 'Total', num: true, v: x => money(x.total) }, { h: 'Estado', v: x => badge('quote', x.status) }], x => '#/cotizaciones/' + x.id))}
    ${raw(sec('Documentos PDF emitidos', r.gendocs, [{ h: 'Número', v: x => html`<b>${x.number}</b>` }, { h: 'Tipo', v: x => L.doc[x.doc_type] }, { h: 'Título', v: x => x.title }, { h: 'Estado', v: x => badge('gd', x.status) }], x => '#/documentos/' + x.id))}
    ${raw(sec('Pagos (por referencia)', r.payments, [{ h: 'Referencia', v: x => x.reference }, { h: 'Cliente', v: x => x.client_name }, { h: 'Monto', num: true, v: x => money(x.amount_declared) }, { h: 'Estado', v: x => badge('pay', x.status) }], () => '#/pagos'))}
    ${total ? '' : html`<div class="card empty">No se encontraron resultados. Pruebe con parte del nombre, la cédula/RNC sin guiones o el número de resolución.</div>`}`);
  on(el, 'tr[data-href]', 'click', (e, tr) => { if (!e.target.closest('a')) go(tr.dataset.href); });
});

// ───── consultas avanzadas
const ENT = {
  cases: { label: 'Expedientes', filters: f => html`
      <label class="f">Texto<input name="q" value="${f.q || ''}" placeholder="Código, asunto o cliente"></label>
      <label class="f">Cédula / RNC<input name="id_number" value="${f.id_number || ''}"></label>
      <label class="f">No. de expediente<input name="code" value="${f.code || ''}"></label>
      <label class="f">No. oficial<input name="official_number" value="${f.official_number || ''}"></label>
      <label class="f">No. de resolución<input name="resolution" value="${f.resolution || ''}"></label>
      <label class="f">Institución<input name="institution" value="${f.institution || ''}" placeholder="DGII, TSA, TC…"></label>
      <label class="f">Período fiscal<input name="period" value="${f.period || ''}" placeholder="2024"></label>
      <label class="f">Estado<select name="status">${opts(L.caseStatus, f.status, 'Todos')}</select></label>
      <label class="f">Responsable<select name="responsible">${optList(state.staff, f.responsible, 'Todos')}</select></label>
      <label class="f">Apertura desde<input type="date" name="from" value="${f.from || ''}"></label>
      <label class="f">Apertura hasta<input type="date" name="to" value="${f.to || ''}"></label>`,
    cols: [{ h: 'Expediente', v: r => html`<b>${r.code}</b>` }, { h: 'Cliente', v: r => html`${r.client_name}<div class="small muted">${r.id_number}</div>` }, { h: 'Asunto', v: r => r.title },
      { h: 'Institución / No.', v: r => html`${r.institution || ''}<div class="small muted">${r.official_number || ''}</div>` }, { h: 'Períodos', v: r => r.fiscal_periods || '' }, { h: 'Estado', v: r => badge('caseStatus', r.status) }, { h: 'Responsable', v: r => r.responsible_name || '—' }],
    href: r => '#/expedientes/' + r.id },
  documents: { label: 'Archivos y resoluciones', filters: f => html`
      <label class="f">Texto<input name="q" value="${f.q || ''}"></label>
      <label class="f">No. de resolución<input name="resolution" value="${f.resolution || ''}"></label>
      <label class="f">Institución<input name="institution" value="${f.institution || ''}"></label>
      <label class="f">Tipo de documento<select name="doc_type">${typeOpts(f.doc_type, 'Todos')}</select></label>
      <label class="f">Solo escaneados<select name="scanned">${opts({ si: 'Sí' }, f.scanned, 'No')}</select></label>
      <label class="f">Categoría<select name="category">${opts(L.cat, f.category, 'Todas')}</select></label>
      <label class="f">Cédula / RNC del cliente<input name="id_number" value="${f.id_number || ''}"></label>
      <label class="f">Fecha desde<input type="date" name="from" value="${f.from || ''}"></label>
      <label class="f">Fecha hasta<input type="date" name="to" value="${f.to || ''}"></label>`,
    cols: [{ h: 'Documento', v: r => html`<b>${r.title}</b><div class="small muted">${r.filename}</div>` }, { h: 'Tipo', v: r => r.doc_type_name || L.cat[r.category] }, { h: 'No. resolución', v: r => r.resolution_number || '—' },
      { h: 'Institución', v: r => r.institution || '' }, { h: 'Fecha', v: r => fdate(r.doc_date) }, { h: 'Cliente / Exp.', v: r => html`${r.client_name}<div class="small muted">${r.case_code || ''}</div>` },
      { h: '', v: r => html`<a class="btn sm" href="/api/files/${r.id}?inline=1" target="_blank" rel="noopener">Ver</a>` }],
    href: r => r.case_id ? '#/expedientes/' + r.case_id : null },
  payments: { label: 'Pagos', roles: ['admin', 'cobros'], filters: f => html`
      <label class="f">Texto<input name="q" value="${f.q || ''}" placeholder="Cliente, referencia, cotización"></label>
      <label class="f">Estado<select name="status">${opts(L.pay, f.status, 'Todos')}</select></label>
      <label class="f">Medio<select name="method">${opts(L.method, f.method, 'Todos')}</select></label>
      <label class="f">Desde<input type="date" name="from" value="${f.from || ''}"></label><label class="f">Hasta<input type="date" name="to" value="${f.to || ''}"></label>`,
    cols: [{ h: 'Fecha', v: r => fdate(r.paid_on) }, { h: 'Cliente', v: r => r.client_name }, { h: 'Cotización', v: r => r.quote_number }, { h: 'Medio / Ref.', v: r => html`${L.method[r.method]}<div class="small muted">${r.reference || ''}</div>` },
      { h: 'Declarado', num: true, v: r => money(r.amount_declared) }, { h: 'Validado', num: true, v: r => r.amount_validated ? money(r.amount_validated) : '—' }, { h: 'Estado', v: r => badge('pay', r.status) }] },
  invoices: { label: 'Facturas', roles: ['admin', 'cobros'], filters: f => html`
      <label class="f">Texto<input name="q" value="${f.q || ''}" placeholder="NCF, cliente o concepto"></label>
      <label class="f">Emitida desde<input type="date" name="from" value="${f.from || ''}"></label><label class="f">Hasta<input type="date" name="to" value="${f.to || ''}"></label>
      <label class="f">Incluir anuladas<select name="annulled">${opts({ si: 'Sí' }, f.annulled, 'No')}</select></label>`,
    cols: [{ h: 'Número', v: r => html`<b>${r.number}</b>` }, { h: 'Emisión', v: r => fdate(r.issue_date) }, { h: 'Vence', v: r => fdate(r.due_date) }, { h: 'Cliente', v: r => r.client_name },
      { h: 'Concepto', v: r => r.description }, { h: 'ITBIS', num: true, v: r => money(r.itbis) }, { h: 'Total', num: true, v: r => money(r.total) }, { h: 'Estado', v: r => r.status }],
    href: () => '#/facturas' },
  receivables: { label: 'Cuentas por cobrar', roles: ['admin', 'cobros'], filters: f => html`<label class="f">Cliente o RNC<input name="q" value="${f.q || ''}"></label>`,
    cols: [{ h: 'Cliente', v: r => html`<b>${r.client_name}</b><div class="small muted">${r.id_number}</div>` }, { h: 'Cuotas', num: true, v: r => money(r.billed) }, { h: 'Pagado', num: true, v: r => money(r.paid) },
      { h: 'Saldo', num: true, v: r => html`<b>${money(r.balance)}</b>` }, { h: 'Vencido', num: true, v: r => r.overdue > 0 ? html`<span class="b bad">${money(r.overdue)}</span>` : money(0) }],
    href: r => '#/clientes/' + r.id + '?tab=cuenta' },
  deadlines: { label: 'Vencimientos', filters: f => html`
      <label class="f">Texto<input name="q" value="${f.q || ''}"></label>
      <label class="f">Tipo<select name="kind">${opts(L.dl, f.kind, 'Todos')}</select></label>
      <label class="f">Estado<select name="status">${opts({ pendiente: 'Pendiente', completada: 'Completada', cancelada: 'Cancelada' }, f.status, 'Todos')}</select></label>
      <label class="f">Responsable<select name="responsible">${optList(state.staff, f.responsible, 'Todos')}</select></label>
      <label class="f">Desde<input type="date" name="from" value="${f.from || ''}"></label><label class="f">Hasta<input type="date" name="to" value="${f.to || ''}"></label>`,
    cols: [{ h: 'Fecha', v: r => fdt(r.due_at) }, { h: 'Tipo', v: r => L.dl[r.kind] }, { h: 'Descripción', v: r => html`<b>${r.title}</b>` }, { h: 'Cliente / Exp.', v: r => html`${r.client_name || ''}<div class="small muted">${r.case_code || ''}</div>` },
      { h: 'Responsable', v: r => r.responsible_name || '—' }, { h: 'Estado', v: r => html`<span class="b ${r.status === 'pendiente' ? 'warn' : 'ok'}">${r.status}</span>` }],
    href: r => r.case_id ? '#/expedientes/' + r.case_id : null },
  quotes: { label: 'Cotizaciones', filters: f => html`
      <label class="f">Texto<input name="q" value="${f.q || ''}"></label><label class="f">Estado<select name="status">${opts(L.quote, f.status, 'Todos')}</select></label>
      <label class="f">Desde<input type="date" name="from" value="${f.from || ''}"></label><label class="f">Hasta<input type="date" name="to" value="${f.to || ''}"></label>`,
    cols: [{ h: 'Número', v: r => html`<b>${r.number}</b>` }, { h: 'Fecha', v: r => fdate(r.created_at) }, { h: 'Cliente', v: r => r.client_name }, { h: 'Título', v: r => r.title }, { h: 'Total', num: true, v: r => money(r.total) }, { h: 'Estado', v: r => badge('quote', r.status) }],
    href: r => '#/cotizaciones/' + r.id },
};
route(/^\/consultas$/, async (el, _, q) => {
  const entity = ENT[q.entity] && (!ENT[q.entity].roles || can(...ENT[q.entity].roles)) ? q.entity : 'cases';
  const def = ENT[entity]; const f = { ...q }; delete f.entity;
  const [data, saved] = await Promise.all([GET(`/api/query/${entity}?` + qs(f)), GET('/api/saved-queries')]);
  el.innerHTML = String(html`${head('Centro de consultas', 'Filtre, guarde consultas frecuentes y exporte los resultados a Excel.')}
    <div class="tabs">${Object.entries(ENT).filter(([, d]) => !d.roles || can(...d.roles)).map(([k, d]) => html`<a href="#/consultas?entity=${k}" class="${k === entity ? 'active' : ''}">${d.label}</a>`)}</div>
    ${saved.length ? html`<div class="chips" style="margin-bottom:12px"><span class="small muted" style="align-self:center">Consultas guardadas:</span>${saved.map(s => html`<span class="chip"><a href="#/consultas?${qs({ entity: s.entity, ...s.params })}">${s.name}</a><button class="chip x" data-act="delq" data-id="${s.id}" title="Eliminar">×</button></span>`)}</div>` : ''}
    <div class="card"><form id="qf"><div class="filters">${def.filters(f)}
      <div class="actions"><button class="btn primary">Consultar</button><a class="btn" href="#/consultas?entity=${entity}">Limpiar</a></div></div></form></div>
    <div class="card flush"><div class="page-head" style="padding:14px 18px 0;margin:0"><h2>${data.rows.length} resultado(s)</h2>
      <div class="actions"><button class="btn sm" data-act="save">☆ Guardar consulta</button><a class="btn sm gold" href="/api/query/${entity}/export?${qs(f)}">⤓ Exportar a Excel</a><button class="btn sm mail" data-act="mail">✉ Enviar por correo</button></div></div>
      ${table(def.cols, data.rows, { onRow: !!def.href, empty: 'No hay resultados con estos filtros.' })}</div>`);
  $('#qf').onsubmit = e => { e.preventDefault(); go('#/consultas?' + qs({ entity, ...formData(e.target) })); };
  if (def.href) bindRows(el, data.rows, r => { const h = def.href(r); if (h) go(h); });
  act(el, {
    save: () => modal('Guardar consulta', html`<label class="f">Nombre de la consulta<input name="name" required placeholder="Ej.: Expedientes DGII 2024"></label>`,
      { submit: async d => { await POST('/api/saved-queries', { name: d.name, entity, params: f }); toast('Consulta guardada'); render(); } }),
    delq: async d => { await api('DELETE', '/api/saved-queries/' + d.id); render(); },
    mail: () => emailModal({ title: `Enviar reporte de ${def.label}`, url: '/api/email/query/' + entity, payload: { filters: f }, note: `Se adjuntará un Excel con los ${data.rows.length} resultado(s) de esta consulta.` }),
  });
});

// ───── clientes
function clientForm(c = {}) {
  return html`<div class="row">
    <label class="f">Tipo<select name="kind">${opts({ empresa: 'Empresa', persona: 'Persona física' }, c.kind || 'empresa')}</select></label>
    <label class="f">Tipo de identificación<select name="id_type">${opts(L.idt, c.id_type || 'rnc')}</select></label>
    <label class="f">Cédula / RNC<input name="id_number" required value="${c.id_number || ''}" placeholder="1-31-12345-6"></label></div>
    <div class="row"><label class="f wide">Nombre o razón social<input name="name" required value="${c.name || ''}"></label></div>
    <div class="row"><label class="f">Nombre comercial<input name="trade_name" value="${c.trade_name || ''}"></label>
    <label class="f">Representante<input name="representative" value="${c.representative || ''}"></label>
    <label class="f">Cédula del representante<input name="representative_id" value="${c.representative_id || ''}"></label></div>
    <div class="row"><label class="f">Correo<input type="email" name="email" value="${c.email || ''}"></label><label class="f">Teléfono<input name="phone" value="${c.phone || ''}"></label>
    <label class="f">Responsable interno<select name="responsible_user_id">${optList(state.staff, c.responsible_user_id, 'Sin asignar')}</select></label></div>
    <div class="row"><label class="f wide">Dirección<input name="address" value="${c.address || ''}"></label></div>
    <div class="row"><label class="f wide">Notas internas<textarea name="notes">${c.notes || ''}</textarea></label></div>`;
}
route(/^\/clientes$/, async (el, _, q) => {
  const rows = await GET('/api/clients?' + qs({ q: q.q }));
  el.innerHTML = String(html`${head('Clientes', 'Personas físicas y empresas', can('admin', 'expedientes') ? html`<button class="btn primary" data-act="new">+ Nuevo cliente</button>` : '')}
    <div class="card"><form id="cf" class="filters"><label class="f">Buscar por nombre, cédula o RNC<input name="q" value="${q.q || ''}"></label><div><button class="btn">Buscar</button></div></form></div>
    <div class="card flush">${table([{ h: 'Cliente', v: r => html`<b>${r.name}</b>${r.trade_name ? html`<div class="small muted">${r.trade_name}</div>` : ''}` },
      { h: 'Identificación', v: r => html`<span class="nowrap">${L.idt[r.id_type]} ${r.id_number}</span>` }, { h: 'Tipo', v: r => r.kind === 'empresa' ? 'Empresa' : 'Persona física' },
      { h: 'Contacto', v: r => html`${r.phone || ''}<div class="small muted">${r.email || ''}</div>` }, { h: 'Responsable', v: r => r.responsible_name || '—' }, { h: 'Exp. activos', num: true, v: r => r.active_cases }],
    rows, { onRow: true, empty: 'Aún no hay clientes registrados.' })}</div>`);
  bindRows(el, rows, r => go('#/clientes/' + r.id));
  $('#cf').onsubmit = e => { e.preventDefault(); go('#/clientes?' + qs(formData(e.target))); };
  act(el, { new: () => modal('Nuevo cliente', clientForm(), { submit: async d => { const c = await POST('/api/clients', d); toast('Cliente registrado'); go('#/clientes/' + c.id); } }) });
});

route(/^\/clientes\/(\d+)$/, async (el, [id], q) => {
  const d = await GET('/api/clients/' + id); const c = d.client; const tab = q.tab || 'resumen'; const acc = d.account;
  const tabs = [['resumen', 'Resumen'], ['expedientes', `Expedientes (${d.cases.length})`], ['cotizaciones', `Cotizaciones (${d.quotes.length})`], ['cuenta', 'Cuotas y pagos'],
    ['facturas', 'Facturas'], ['archivos', `Archivos (${d.documents.length})`], ['solicitudes', `Solicitudes (${d.requests.length})`], ['pdf', `PDF emitidos (${d.gendocs.length})`], ['avisos', 'Avisos enviados'], ['portal', 'Acceso al portal']];
  let body = '';
  if (tab === 'resumen') body = html`<div class="grid g2"><div class="card"><h2>Datos de identificación</h2><dl class="dl">
      <div><dt>Tipo</dt><dd>${c.kind === 'empresa' ? 'Empresa' : 'Persona física'}</dd></div><div><dt>${L.idt[c.id_type]}</dt><dd>${c.id_number}</dd></div>
      <div><dt>Nombre comercial</dt><dd>${c.trade_name || '—'}</dd></div><div><dt>Representante</dt><dd>${c.representative || '—'} ${c.representative_id ? '(' + c.representative_id + ')' : ''}</dd></div>
      <div><dt>Correo</dt><dd>${c.email || '—'}</dd></div><div><dt>Teléfono</dt><dd>${c.phone || '—'}</dd></div><div><dt>Dirección</dt><dd>${c.address || '—'}</dd></div>
      <div><dt>Responsable interno</dt><dd>${c.responsible_name || 'Sin asignar'}</dd></div><div><dt>Cliente desde</dt><dd>${fdate(c.created_at)}</dd></div></dl>
      ${c.notes ? html`<div class="alert warn" style="margin-top:12px"><b>Nota interna:</b> ${c.notes}</div>` : ''}</div>
    <div class="card"><h2>Situación de cuenta</h2><dl class="dl"><div><dt>Total en cuotas</dt><dd>${money(acc.totals.billed)}</dd></div><div><dt>Pagado</dt><dd>${money(acc.totals.paid)}</dd></div>
      <div><dt>Saldo</dt><dd><b>${money(acc.totals.balance)}</b></dd></div><div><dt>Vencido</dt><dd>${acc.totals.overdue > 0 ? html`<span class="b bad">${money(acc.totals.overdue)}</span>` : money(0)}</dd></div></dl>
      <div class="actions" style="margin-top:14px"><a class="btn sm" href="#/clientes/${id}?tab=cuenta">Ver cuotas y pagos</a></div></div></div>`;
  if (tab === 'expedientes') body = html`<div class="card flush">${table([{ h: 'Código', v: r => html`<b>${r.code}</b>` }, { h: 'Asunto', v: r => r.title }, { h: 'Institución / No.', v: r => html`${r.institution || ''}<div class="small muted">${r.official_number || ''}</div>` },
    { h: 'Períodos', v: r => r.fiscal_periods || '' }, { h: 'Estado', v: r => badge('caseStatus', r.status) }, { h: 'Próxima acción', v: r => html`${r.next_action || '—'}<div class="small muted">${fdate(r.next_action_date)}</div>` }], d.cases, { onRow: true, empty: 'Sin expedientes.' })}</div>`;
  if (tab === 'cotizaciones') body = html`<div class="card flush">${table([{ h: 'Número', v: r => html`<b>${r.number}</b>` }, { h: 'Título', v: r => r.title }, { h: 'Fecha', v: r => fdate(r.created_at) }, { h: 'Total', num: true, v: r => money(r.total) }, { h: 'Estado', v: r => badge('quote', r.status) }], d.quotes, { onRow: true, empty: 'Sin cotizaciones.' })}</div>`;
  if (tab === 'cuenta') body = html`<div class="actions" style="margin-bottom:12px"><button class="btn gold" data-act="avisopago">📣 Enviar aviso de pago (correo / WhatsApp)</button></div>${accountBlock(acc, d.payments, true)}`;
  if (tab === 'facturas') { const inv = await GET('/api/invoices?client_id=' + id); body = html`${can('admin', 'cobros') ? html`<div class="actions" style="margin-bottom:12px"><button class="btn primary" data-act="newinv">🧾 Generar factura</button></div>` : ''}<div class="card flush">${invoicesTable(inv, false)}</div>`; }
  if (tab === 'avisos') { const n = await GET('/api/notices?client_id=' + id); body = html`<div class="card flush">${noticesTable(n)}</div>`; }
  if (tab === 'archivos') body = html`<div class="card flush">${docsTable(d.documents, true)}</div>`;
  if (tab === 'solicitudes') body = html`<div class="card flush">${table([{ h: 'Documento', v: r => html`<b>${r.title}</b><div class="small muted">${r.description || ''}</div>` }, { h: 'Expediente', v: r => r.case_code || '—' }, { h: 'Entrega', v: r => fdate(r.due_date) }, { h: 'Estado', v: r => badge('req', r.status) }], d.requests, { empty: 'Sin solicitudes.' })}</div>`;
  if (tab === 'pdf') body = html`<div class="card flush">${gendocsTable(d.gendocs)}</div>`;
  if (tab === 'portal') body = html`<div class="card"><h2>Usuarios del portal</h2>${table([{ h: 'Nombre', v: r => r.name }, { h: 'Correo', v: r => r.email },
    { h: 'Estado', v: r => r.activated ? html`<span class="b ok">Activo</span>` : html`<span class="b warn">Invitación enviada</span>` }, { h: 'Último acceso', v: r => fdt(r.last_login) || '—' }], d.users, { empty: 'Este cliente aún no tiene acceso al portal.' })}
    <div class="actions" style="margin-top:12px"><button class="btn primary" data-act="invite">+ Invitar al portal</button></div></div>`;
  el.innerHTML = String(html`${head(c.name, `${L.idt[c.id_type]} ${c.id_number} · ${c.kind === 'empresa' ? 'Empresa' : 'Persona física'}`,
    html`${can('admin', 'expedientes') ? html`<button class="btn" data-act="edit">Editar</button><button class="btn" data-act="newcase">+ Expediente</button>` : ''}
      <a class="btn" href="#/cotizaciones/nueva?client_id=${id}">+ Cotización</a><a class="btn" href="#/carpetas/${id}">📁 Carpeta</a><button class="btn" data-act="msg">💬 Aviso / WhatsApp</button><button class="btn gold" data-act="pdf">⎙ Generar PDF</button>`, html`<a href="#/clientes">Clientes</a> ›`)}
    <div class="tabs">${tabs.map(([k, l]) => html`<a href="#/clientes/${id}?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`)}</div>${body}`);
  if (tab === 'expedientes') bindRows(el, d.cases, r => go('#/expedientes/' + r.id));
  if (tab === 'cotizaciones') bindRows(el, d.quotes, r => go('#/cotizaciones/' + r.id));
  bindGendocs(el);
  act(el, {
    edit: () => modal('Editar cliente', clientForm(c), { submit: async x => { await PATCH('/api/clients/' + id, x); toast('Cliente actualizado'); render(); } }),
    newcase: () => caseModal({ client_id: id }),
    invite: () => modal('Invitar al portal', html`<p class="small muted">Se generará un enlace de invitación válido por 7 días. Envíelo al cliente por correo o WhatsApp.</p>
      <div class="row"><label class="f">Nombre<input name="name" required value="${c.representative || c.name}"></label><label class="f">Correo<input name="email" type="email" required value="${c.email || ''}"></label></div>`,
    { submit: async x => { const r = await POST(`/api/clients/${id}/portal-user`, x); showLink(r.invite_link); render(); } }),
    pdf: () => pdfMenu({ client_id: id }),
    msg: () => notice('general', id), avisopago: () => notice('aviso_pago', id),
    newinv: () => invoiceModal({ client_id: id }),
    ...payActs(), ...invActs(),
  });
});
function showLink(link) {
  modal('Enlace de invitación', html`<p>Comparta este enlace con el usuario. Es personal y vence en 7 días.</p><div class="copy"><input readonly value="${link}" id="lnk"><button type="button" class="btn" id="cp">Copiar</button></div>`,
    { onMount: f => { $('#cp', f).onclick = () => { $('#lnk', f).select(); navigator.clipboard?.writeText(link); toast('Enlace copiado'); }; } });
}
function accountBlock(acc, payments, staff) {
  const next = acc.installments.find(i => i.balance > 0);
  return html`<div class="kpis"><div class="kpi"><div class="v" style="font-size:1.2rem">${money(acc.totals.billed)}</div><div class="l">Total en cuotas</div></div>
    <div class="kpi"><div class="v" style="font-size:1.2rem">${money(acc.totals.paid)}</div><div class="l">Pagos validados</div></div>
    <div class="kpi gold"><div class="v" style="font-size:1.2rem" id="saldo">${money(acc.totals.balance)}</div><div class="l">Saldo pendiente</div></div>
    <div class="kpi ${acc.totals.overdue > 0 ? 'bad' : ''}"><div class="v" style="font-size:1.2rem">${money(acc.totals.overdue)}</div><div class="l">Vencido</div></div>
    ${next ? html`<div class="kpi"><div class="v" style="font-size:1.2rem">${fdate(next.due_date)}</div><div class="l">Próximo vencimiento (${money(next.balance)})</div></div>` : ''}</div>
    <div class="card flush"><h2>Cuotas</h2>${table([{ h: 'Cotización', v: r => r.quote_number }, { h: 'Cuota', v: r => '#' + r.seq }, { h: 'Vence', v: r => fdate(r.due_date) },
      { h: 'Monto', num: true, v: r => money(r.amount) }, { h: 'Abonado', num: true, v: r => money(r.paid) }, { h: 'Saldo', num: true, v: r => money(r.balance) }, { h: 'Estado', v: r => html`<span class="b ${tone.inst[r.status]}">${r.status_label}</span>` }],
    acc.installments, { empty: 'No hay cuotas de cotizaciones aceptadas.' })}</div>
    <div class="card flush"><h2>Comprobantes y pagos</h2>${paymentsTable(payments, staff)}</div>`;
}
function paymentsTable(rows, staff) {
  return table([{ h: 'Fecha', v: r => fdate(r.paid_on) }, ...(staff && rows[0]?.client_name ? [{ h: 'Cliente', v: r => r.client_name }] : []), { h: 'Cotización', v: r => r.quote_number },
    { h: 'Medio / Ref.', v: r => html`${L.method[r.method]}<div class="small muted">${r.reference || ''}</div>` }, { h: 'Declarado', num: true, v: r => money(r.amount_declared) },
    { h: 'Validado', num: true, v: r => r.amount_validated ? money(r.amount_validated) : '—' },
    { h: 'Estado', v: r => html`${badge('pay', r.status)}${r.reject_reason ? html`<div class="small" style="color:var(--bad)">${r.reject_reason}</div>` : ''}${r.void_reason ? html`<div class="small" style="color:var(--bad)">${r.void_reason}</div>` : ''}` },
    { h: '', v: r => html`<span class="actions">${r.voucher_document_id ? html`<a class="btn sm" href="/api/files/${r.voucher_document_id}?inline=1" target="_blank" rel="noopener">Voucher</a>` : ''}
      ${r.receipt_id ? html`<button class="btn sm primary" data-act="viewgd" data-id="${r.receipt_id}">Recibo PDF</button>` : ''}
      ${staff && r.status === 'validado' ? html`<button class="btn sm" data-act="paynotice" data-id="${r.id}" data-client="${r.client_id}">📣 Aviso</button>` : ''}
      ${staff && r.status === 'pendiente' && can('admin', 'cobros') ? html`<button class="btn sm gold" data-act="validate" data-id="${r.id}" data-amount="${r.amount_declared}">Validar</button><button class="btn sm danger" data-act="reject" data-id="${r.id}">Rechazar</button>` : ''}</span>` }],
  rows, { empty: 'No hay comprobantes registrados.' });
}
function payActs() {
  return {
    viewgd: d => viewPdf(gdUrl(d.id)),
    paynotice: d => notice('pago_recibido', d.client, d.id),
    validate: d => modal('Validar pago', html`<div class="alert info">Solo un pago validado reduce el saldo y genera el recibo. Si el depósito es parcial, ajuste el monto validado.</div>
      <div class="row"><label class="f">Monto validado (RD$)<input name="amount" type="number" step="0.01" min="0.01" required value="${d.amount}"></label><label class="f">Referencia bancaria (opcional)<input name="reference"></label></div>`,
    { submitLabel: 'Validar y emitir recibo', submit: async x => { const r = await POST(`/api/payments/${d.id}/validate`, { amount: Number(x.amount), reference: x.reference }); toast(`Pago validado. Recibo ${r.receipt_number} emitido. Nuevo saldo: ${money(r.balance)}`); render(); } }),
    reject: d => modal('Rechazar comprobante', html`<label class="f">Motivo del rechazo (lo verá el cliente)<textarea name="reason" required></textarea></label>`,
      { submitLabel: 'Rechazar', submit: async x => { await POST(`/api/payments/${d.id}/reject`, x); toast('Comprobante rechazado'); render(); } }),
  };
}
function docsTable(rows, staff) {
  return table([{ h: 'Documento', v: r => html`<b>${r.title}</b><div class="small muted">${r.filename}</div>` }, { h: 'Tipo', v: r => r.doc_type_name ? html`<span class="b gold">${r.doc_type_name}</span>` : (L.cat[r.category] || r.category) },
    { h: 'No. resolución', v: r => r.resolution_number || '—' }, { h: 'Fecha', v: r => fdate(r.doc_date || r.created_at) },
    ...(staff ? [{ h: 'Visibilidad', v: r => html`${r.visibility === 'cliente' ? html`<span class="b info">Compartido</span>` : html`<span class="b">Privado</span>`}${r.uploaded_by_client ? html` <span class="b gold">Subido por cliente</span>` : ''}` }] : []),
    { h: '', v: r => html`<span class="actions"><a class="btn sm" href="/api/files/${r.id}?inline=1" target="_blank" rel="noopener">Ver</a><a class="btn sm" href="/api/files/${r.id}">Descargar</a>
      ${staff && can('admin', 'expedientes') ? html`<button class="btn sm" data-act="togglevis" data-id="${r.id}" data-vis="${r.visibility === 'cliente' ? 'privado' : 'cliente'}">${r.visibility === 'cliente' ? 'Hacer privado' : 'Compartir'}</button>` : ''}</span>` }],
  rows, { empty: 'Sin archivos.' });
}
function gendocsTable(rows) {
  return table([{ h: 'Número', v: r => html`<b>${r.number}</b>${r.version > 1 ? html` <span class="b">v${r.version}</span>` : ''}` }, { h: 'Tipo', v: r => L.doc[r.doc_type] }, { h: 'Título', v: r => r.title },
    { h: 'Fecha', v: r => fdt(r.created_at) }, { h: 'Estado', v: r => html`${badge('gd', r.status)} ${r.shared ? html`<span class="b info">Compartido</span>` : ''}` },
    { h: '', v: r => html`<span class="actions"><button class="btn sm primary" data-gd="${r.id}">Ver PDF</button><a class="btn sm" href="#/documentos/${r.id}">Detalle</a></span>` }],
  rows, { empty: 'Aún no se han emitido documentos.' });
}
function bindGendocs(el) { on(el, '[data-gd]', 'click', (e, b) => viewPdf(gdUrl(b.dataset.gd))); }

// ───── generador de PDF (menú y formularios)
async function pdfMenu(ctx) {
  const types = [
    ['ficha_cliente', 'Ficha de cliente', !!ctx.client_id], ['estado_cuenta', 'Estado de cuenta', !!ctx.client_id && can('admin', 'cobros', 'expedientes')],
    ['recibo_documentos', 'Recibo de entrega / recepción de documentos', true], ['ficha_expediente', 'Ficha de expediente', !!ctx.case_id && can('admin', 'expedientes')],
    ['informe_avance', 'Informe de avance', !!ctx.case_id && can('admin', 'expedientes')],
  ].filter(t => t[2]);
  const m = modal('Generar documento PDF', html`<p class="muted small">Los datos se completan desde la base de datos. Puede previsualizar antes de archivar.</p>
    <div class="grid">${types.map(([k, l]) => html`<button type="button" class="btn" style="justify-content:flex-start;padding:12px" data-t="${k}">⎙ ${l}</button>`)}</div>`);
  on(m.el, '[data-t]', 'click', (e, b) => { m.close(); pdfForm(b.dataset.t, ctx); });
}
async function pdfForm(type, ctx) {
  let fields = '';
  let clientCases = [];
  if (ctx.client_id && type === 'recibo_documentos') clientCases = (await GET('/api/clients/' + ctx.client_id)).cases;
  const clients = !ctx.client_id && !ctx.case_id ? await GET('/api/clients') : [];
  if (type === 'estado_cuenta') fields = html`<label class="f">Fecha de corte<input type="date" name="cutoff" value="${today()}"></label>`;
  if (type === 'informe_avance') fields = html`<div class="row"><label class="f">Desde<input type="date" name="from"></label><label class="f">Hasta<input type="date" name="to"></label></div>
    <label class="chk"><input type="checkbox" name="include_internal"> Incluir actuaciones internas (no recomendado si se compartirá con el cliente)</label>
    <div class="row" style="margin-top:10px"><label class="f wide">Resumen<textarea name="summary" placeholder="Resumen ejecutivo del estado del caso"></textarea></label></div>
    <div class="row"><label class="f wide">Próximos pasos<textarea name="next_steps"></textarea></label></div>`;
  if (type === 'recibo_documentos') fields = html`
    ${clients.length ? html`<label class="f">Cliente<select name="client_id" required>${optList(clients, '', 'Seleccione…')}</select></label>` : ''}
    ${clientCases.length ? html`<label class="f">Expediente (opcional)<select name="case_id">${optList(clientCases, ctx.case_id, 'Ninguno', x => x.code + ' — ' + x.title)}</select></label>` : ''}
    <div class="row" style="margin-top:10px"><label class="f">Tipo<select name="direction"><option value="recepcion">Recepción (el cliente entrega al despacho)</option><option value="entrega">Entrega (el despacho entrega al cliente)</option></select></label>
    <label class="f">Fecha<input type="date" name="date" value="${today()}"></label></div>
    <h3>Inventario de documentos</h3><div id="inv"></div><button type="button" class="btn sm" id="addinv">+ Agregar documento</button>
    <div class="row" style="margin-top:12px"><label class="f">Entrega (nombre)<input name="delivered_by"></label><label class="f">Recibe (nombre)<input name="received_by" value="${state.me.name.replace(/ \(.*\)/, '')}"></label></div>
    <label class="f">Observaciones<textarea name="notes"></textarea></label>`;
  const collect = (d, f) => {
    const p = { ...d, client_id: d.client_id || ctx.client_id, case_id: d.case_id || ctx.case_id };
    if (type === 'recibo_documentos') p.items = $$('.invrow', f).map(r => ({ description: $('[data-k=description]', r).value, quantity: $('[data-k=quantity]', r).value, notes: $('[data-k=notes]', r).value }));
    return p;
  };
  modal(L.doc[type], html`${fields}<label class="chk" style="margin-top:12px"><input type="checkbox" name="share"> Compartir con el cliente en el portal</label>`, {
    submitLabel: 'Generar y archivar', wide: type === 'recibo_documentos',
    footer: html`<button type="button" class="btn" data-prev>Vista previa</button>`,
    onMount: f => {
      const addRow = (v = {}) => { const d = document.createElement('div'); d.className = 'row invrow'; d.innerHTML = String(html`<label class="f">Documento<input data-k="description" value="${v.description || ''}"></label><label class="f">Cantidad<input data-k="quantity" type="number" min="1" value="${v.quantity || 1}"></label><label class="f">Observaciones<input data-k="notes"></label>`); $('#inv', f).appendChild(d); };
      if ($('#inv', f)) { addRow(); addRow(); $('#addinv', f).onclick = () => addRow(); }
      $('[data-prev]', f.parentElement).onclick = () => { const d = formData(f); previewPdf(type, collect(d, f)).catch(fail); };
    },
    submit: async (d, f) => { const r = await POST('/api/gendocs', { doc_type: type, params: collect(d, f), share: d.share }); toast(`Documento ${r.number} emitido y archivado`); render(); setTimeout(() => viewPdf(gdUrl(r.id)), 150); },
  });
}

// ───── documentos escaneados del expediente
const typeOpts = (sel, blank = 'Seleccione el tipo…') => optList(state.docTypes || [], sel, blank);
const fsize = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const typeLabel = x => x.doc_type_name || (x.category === 'voucher' ? 'Vouchers de pago' : L.cat[x.category]) || 'Otros';
function scansView(scans, tipo, canUpload, opts = {}) {
  const groups = {};
  scans.forEach(x => { const k = typeLabel(x); (groups[k] = groups[k] || []).push(x); });
  const filtered = tipo ? scans.filter(x => typeLabel(x) === tipo) : scans;
  const byType = {}; filtered.forEach(x => { const k = typeLabel(x); (byType[k] = byType[k] || []).push(x); });
  return html`${canUpload ? html`<div class="card"><h2>${opts.title || 'Cargar documentos'}</h2>${opts.where ? html`<p class="small muted" style="margin:-4px 0 10px">Se guardarán en: <span class="path">${opts.where}</span></p>` : ''}
      <label class="drop" id="drop"><input type="file" id="scanfiles" multiple accept="application/pdf,image/jpeg,image/png,image/webp,.doc,.docx,.xls,.xlsx,.txt">
        <span class="big">⇪</span><b>Haga clic para elegir archivos o documentos escaneados</b><span class="small muted">o arrástrelos aquí · PDF, imágenes, Word o Excel · hasta 40 archivos de 25 MB</span></label>
      <div id="scanq" class="hidden">
        <div class="row" style="margin-top:12px"><label class="f">Aplicar a todos: tipo de documento<select id="alltype">${typeOpts('', '—')}</select></label>
          <label class="f">Aplicar a todos: visibilidad<select id="allvis"><option value="">—</option><option value="privado">Privado (solo equipo)</option><option value="cliente">Compartir con el cliente</option></select></label></div>
        <label class="chk hidden" id="mergewrap"><input type="checkbox" id="merge"> Unir todas las imágenes en <b>un solo PDF</b> de varias páginas (útil para documentos fotografiados página por página)</label>
        <div id="scanrows"></div>
        <div class="actions" style="margin-top:12px"><button type="button" class="btn primary" id="scanup">Subir documentos</button><button type="button" class="btn" id="scanclear">Limpiar</button></div>
      </div></div>` : ''}
    <div class="chips" style="margin-bottom:12px"><a class="chip" href="${location.hash.replace(/&tipo=[^&]*/, '')}" style="${tipo ? '' : 'background:var(--navy);color:#fff'}">Todos (${scans.length})</a>
      ${Object.entries(groups).sort().map(([k, v]) => html`<a class="chip" href="${location.hash.replace(/&tipo=[^&]*/, '') + '&tipo=' + encodeURIComponent(k)}" style="${tipo === k ? 'background:var(--navy);color:#fff' : ''}">${k} (${v.length})</a>`)}</div>
    ${scans.length ? Object.entries(byType).sort().map(([k, v]) => html`<div class="card flush"><h2>📁 ${k} <span class="b">${v.length}</span></h2>${table([
      { h: 'Documento', v: r => html`<b>${r.title}</b>${r.uploaded_by_client ? html` <span class="b gold">Enviado por el cliente</span>` : ''}<div class="small muted">${r.filename} · ${fsize(r.size_bytes)}${r.pages ? ` · ${r.pages} pág.` : ''}</div>${r.notes ? html`<div class="small">${r.notes}</div>` : ''}` },
      { h: 'No. / Fecha', v: r => html`${r.resolution_number || '—'}<div class="small muted">${fdate(r.doc_date)}</div>` },
      { h: 'Subido', v: r => html`${fdt(r.created_at)}<div class="small muted">${r.uploaded_by_name || ''}</div>` },
      { h: 'Visibilidad', v: r => r.visibility === 'cliente' ? html`<span class="b info">Compartido</span>` : html`<span class="b">Privado</span>` },
      { h: '', v: r => html`<span class="actions"><a class="btn sm" href="/api/files/${r.id}?inline=1" target="_blank" rel="noopener">Ver</a><a class="btn sm" href="/api/files/${r.id}">Descargar</a>
        ${canUpload ? html`<button class="btn sm" data-act="editscan" data-id="${r.id}">Editar tipo / datos</button>` : ''}</span>` }], v)}</div>`)
      : html`<div class="card empty">${opts.empty || 'Aún no hay documentos en esta carpeta.'}</div>`}`;
}
function bindScanUploader(el, uploadUrl, extra = {}) {
  const input = $('#scanfiles', el); if (!input) return;
  let queue = [];
  const isImg = f => /^image\/(jpeg|png)$/.test(f.type);
  const draw = () => {
    $('#scanq', el).classList.toggle('hidden', !queue.length);
    const merge = $('#merge', el).checked && queue.length > 1;
    $('#mergewrap', el).classList.toggle('hidden', !(queue.length > 1 && queue.every(x => isImg(x.file))));
    $('#scanrows', el).innerHTML = String(html`${merge ? html`<div class="card" style="margin:10px 0 0;background:#FAF8F5"><b>Un solo PDF con ${queue.length} páginas</b> (${queue.map(x => x.file.name).join(', ')})</div>` : ''}
      ${(merge ? queue.slice(0, 1) : queue).map((x, i) => html`<div class="scanrow" data-i="${i}">
        <div class="thumb">${x.url ? html`<img src="${x.url}" alt="">` : html`<span>PDF</span>`}</div>
        <div style="min-width:0;flex:1"><div class="small muted" style="margin-bottom:6px">${merge ? 'Datos del documento unido' : x.file.name} · ${fsize(merge ? queue.reduce((a, y) => a + y.file.size, 0) : x.file.size)}</div>
          <div class="row" style="margin:0"><label class="f">Tipo de documento *<select data-k="doc_type_id" required>${typeOpts(x.doc_type_id)}</select></label>
          <label class="f">Título<input data-k="title" value="${x.title || ''}" placeholder="Se usa el tipo si lo deja vacío"></label>
          <label class="f">No. del documento / resolución<input data-k="number" value="${x.number || ''}"></label>
          <label class="f">Institución<input data-k="institution" value="${x.institution || ''}" placeholder="DGII, TSA…"></label>
          <label class="f">Fecha del documento<input type="date" data-k="doc_date" value="${x.doc_date || ''}"></label>
          <label class="f">Visibilidad<select data-k="visibility"><option value="privado"${x.visibility !== 'cliente' ? ' selected' : ''}>Privado</option><option value="cliente"${x.visibility === 'cliente' ? ' selected' : ''}>Compartir con el cliente</option></select></label>
          <label class="f">Nota<input data-k="notes" value="${x.notes || ''}"></label></div></div>
        ${merge ? '' : html`<button type="button" class="btn sm danger" data-rm="${i}" title="Quitar">×</button>`}</div>`)}`);
    $$('#scanrows [data-k]', el).forEach(inp => inp.oninput = inp.onchange = () => { queue[inp.closest('[data-i]').dataset.i][inp.dataset.k] = inp.value; });
    $$('#scanrows [data-rm]', el).forEach(b => b.onclick = () => { queue.splice(+b.dataset.rm, 1); draw(); });
  };
  const add = files => { Array.from(files).forEach(file => queue.push({ file, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null, visibility: 'privado' })); input.value = ''; draw(); };
  input.onchange = () => add(input.files);
  const drop = $('#drop', el);
  ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => add(e.dataTransfer.files));
  $('#merge', el).onchange = draw;
  $('#alltype', el).onchange = e => { if (e.target.value) { queue.forEach(x => (x.doc_type_id = e.target.value)); draw(); } };
  $('#allvis', el).onchange = e => { if (e.target.value) { queue.forEach(x => (x.visibility = e.target.value)); draw(); } };
  $('#scanclear', el).onclick = () => { queue = []; draw(); };
  $('#scanup', el).onclick = async () => {
    const merge = $('#merge', el).checked && queue.length > 1 && queue.every(x => isImg(x.file));
    const metas = (merge ? queue.slice(0, 1) : queue).map(({ doc_type_id, title, number, institution, doc_date, visibility, notes }) => ({ doc_type_id, title, number, institution, doc_date, visibility, notes }));
    if (metas.some(m => !m.doc_type_id)) return toast('Seleccione el tipo de documento de cada archivo', true);
    const fd = new FormData(); queue.forEach(x => fd.append('files', x.file)); fd.append('meta', JSON.stringify(metas)); fd.append('merge', merge ? '1' : '0');
    Object.entries(extra).forEach(([k, v]) => v != null && fd.append(k, v));
    const b = $('#scanup', el); b.disabled = true; b.textContent = 'Subiendo…';
    try { const r = await api('POST', uploadUrl, fd); toast(`${r.created.length} documento(s) guardado(s) en la carpeta`); render(); }
    catch (e) { fail(e); b.disabled = false; b.textContent = 'Subir documentos'; }
  };
}
function editScanModal(doc) {
  modal('Editar documento', html`<div class="row"><label class="f">Tipo de documento<select name="doc_type_id">${typeOpts(doc.doc_type_id)}</select></label><label class="f">Título<input name="title" value="${doc.title}"></label></div>
    <div class="row"><label class="f">No. del documento<input name="resolution_number" value="${doc.resolution_number || ''}"></label><label class="f">Fecha<input type="date" name="doc_date" value="${doc.doc_date || ''}"></label>
    <label class="f">Visibilidad<select name="visibility">${opts({ privado: 'Privado', cliente: 'Compartir con el cliente' }, doc.visibility)}</select></label></div>
    <label class="f">Nota<input name="notes" value="${doc.notes || ''}"></label>`,
  { submit: async d => { await PATCH('/api/documents/' + doc.id, d); toast('Documento actualizado'); render(); } });
}

// ───── carpetas del sistema: Documentos LegalTax / Cliente / Expediente
const ROOT_NAME = 'Documentos LegalTax';
route(/^\/carpetas$/, async (el, _, q) => {
  const rows = await GET('/api/folders');
  const term = (q.q || '').toLowerCase();
  const list = rows.filter(r => !term || `${r.name} ${r.id_number}`.toLowerCase().includes(term));
  el.innerHTML = String(html`${head(ROOT_NAME, 'Carpeta del sistema. Cada cliente tiene su carpeta y, dentro, una carpeta por expediente. Todo el equipo ve los mismos documentos.')}
    <div class="card"><form id="ff" class="filters"><label class="f">Buscar carpeta de cliente<input name="q" value="${q.q || ''}" placeholder="Nombre, cédula o RNC"></label><div><button class="btn">Buscar</button></div></form></div>
    <p class="path" style="margin:0 0 10px">📁 ${ROOT_NAME}</p>
    <div class="folders">${list.map(r => html`<a class="folder" href="#/carpetas/${r.id}"><span class="ic">📁</span><span class="fx"><b>${r.folder_name || r.name}</b>
      <span class="small muted">${r.cases} expediente(s) · ${r.documents} documento(s) · ${r.emitidos} PDF</span><span class="small muted">Actualizada ${fdate(r.updated_at)}</span></span></a>`)}</div>
    ${list.length ? '' : html`<div class="card empty">No hay carpetas que coincidan.</div>`}`);
  $('#ff').onsubmit = e => { e.preventDefault(); go('#/carpetas?' + qs(formData(e.target))); };
});
route(/^\/carpetas\/(\d+)$/, async (el, [cid]) => {
  const d = await GET('/api/folders/' + cid); const cl = d.client;
  const card = (href, name, sub, extra = '') => html`<a class="folder" href="${href}"><span class="ic">📁</span><span class="fx"><b>${name}</b><span class="small muted">${sub}</span>${raw(String(extra))}</span></a>`;
  el.innerHTML = String(html`${head(cl.folder_name, html`<span class="path">${ROOT_NAME} / ${cl.folder_name}</span>`,
    html`<a class="btn" href="#/clientes/${cid}">Ver ficha del cliente</a><a class="btn gold" href="/api/folders/${cid}/zip">⤓ Descargar carpeta (ZIP)</a>`, html`<a href="#/carpetas">📁 ${ROOT_NAME}</a> ›`)}
    <h2 style="margin-top:4px">Expedientes</h2>
    <div class="folders">${d.cases.map(x => card(`#/carpetas/${cid}/case-${x.id}`, x.folder_name, `${x.documents} documento(s) · ${x.emitidos} PDF emitido(s)`, badge('caseStatus', x.status)))}</div>
    ${d.cases.length ? '' : html`<div class="card empty">Este cliente aún no tiene expedientes.</div>`}
    <h2 style="margin-top:18px">Carpetas del cliente</h2>
    <div class="folders">
      ${card(`#/carpetas/${cid}/general`, 'Documentos generales', `${d.counts.general} documento(s) · identificación, contratos, poderes…`)}
      ${card(`#/carpetas/${cid}/emitidos`, 'PDF emitidos', `${d.counts.emitidos} documento(s) · cotizaciones, recibos, estados de cuenta, facturas`)}
      ${card(`#/carpetas/${cid}/pagos`, 'Pagos y vouchers', `${d.counts.pagos} comprobante(s) de pago`)}
    </div>`);
});
route(/^\/carpetas\/(\d+)\/(case-\d+|general|emitidos|pagos)$/, async (el, [cid, fk], q) => {
  const d = await GET(`/api/folders/${cid}?f=${fk}`); const cl = d.client; const f = d.folder;
  const canUp = f.canUpload && can('admin', 'expedientes', 'cobros');
  el.innerHTML = String(html`${head(f.name, html`<span class="path">${ROOT_NAME} / ${cl.folder_name} / ${f.name}</span>`,
    html`${f.case ? html`<a class="btn" href="#/expedientes/${f.case.id}">Abrir expediente</a>` : ''}<a class="btn gold" href="/api/folders/${cid}/zip?f=${fk}">⤓ Descargar esta carpeta (ZIP)</a>`,
    html`<a href="#/carpetas">📁 ${ROOT_NAME}</a> › <a href="#/carpetas/${cid}">${cl.folder_name}</a> ›`)}
    ${fk === 'emitidos' || fk === 'pagos' ? '' : scansView(f.documents, q.tipo, canUp, { title: 'Cargar documentos a esta carpeta', where: `${ROOT_NAME} / ${cl.folder_name} / ${f.name}` })}
    ${fk === 'pagos' ? scansView(f.documents, q.tipo, false, { empty: 'No hay comprobantes de pago.' }) : ''}
    ${f.gendocs.length || fk === 'emitidos' ? html`<div class="card flush"><h2>📁 PDF emitidos ${f.case ? 'del expediente' : ''} <span class="b">${f.gendocs.length}</span></h2>${gendocsTable(f.gendocs)}</div>` : ''}`);
  bindGendocs(el);
  if (canUp) bindScanUploader(el, `/api/folders/${cid}/upload`, { case_id: f.case ? f.case.id : null });
  act(el, { editscan: x => editScanModal(f.documents.find(y => String(y.id) === x.id)), viewgd: x => viewPdf(gdUrl(x.id)) });
});

// ───── expedientes
function caseModal(c = {}, edit) {
  const go2 = async () => {
    const clients = edit ? [] : await GET('/api/clients');
    modal(edit ? 'Editar expediente' : 'Nuevo expediente', html`
      ${edit ? '' : html`<label class="f">Cliente<select name="client_id" required>${optList(clients, c.client_id, 'Seleccione…', x => `${x.name} (${x.id_number})`)}</select></label>`}
      <div class="row" style="margin-top:10px"><label class="f wide">Asunto<input name="title" required value="${c.title || ''}" placeholder="Ej.: Recurso de reconsideración — ITBIS 2023"></label></div>
      <div class="row"><label class="f">Materia<input name="matter" value="${c.matter || ''}" placeholder="Tributario, laboral, societario…"></label>
      <label class="f">Institución<input name="institution" value="${c.institution || ''}" placeholder="DGII, DGA, TSA, TC…"></label>
      <label class="f">No. oficial<input name="official_number" value="${c.official_number || ''}"></label>
      <label class="f">Períodos fiscales<input name="fiscal_periods" value="${c.fiscal_periods || ''}" placeholder="2023, 2024"></label></div>
      <div class="row"><label class="f">Estado interno<select name="status">${opts(L.caseStatus, c.status || 'abierto')}</select></label>
      <label class="f">Responsable<select name="responsible_user_id">${optList(state.staff, c.responsible_user_id || (state.me.role === 'expedientes' ? state.me.id : ''), 'Sin asignar')}</select></label></div>
      <div class="row"><label class="f wide">Estado publicado al cliente<input name="public_status" value="${c.public_status || ''}" placeholder="Texto que verá el cliente en el portal"></label></div>
      <div class="row"><label class="f">Próxima acción<input name="next_action" value="${c.next_action || ''}"></label><label class="f">Fecha próxima acción<input type="date" name="next_action_date" value="${c.next_action_date || ''}"></label></div>`,
    { submit: async d => { if (edit) { await PATCH('/api/cases/' + c.id, d); toast('Expediente actualizado'); render(); } else { const r = await POST('/api/cases', d); toast(`Expediente ${r.code} creado`); go('#/expedientes/' + r.id); } } });
  };
  go2().catch(fail);
}
route(/^\/expedientes$/, async (el, _, q) => {
  const f = { ...q }; let rows;
  if (f.status === 'activos') { delete f.status; rows = (await GET('/api/query/cases?' + qs(f))).rows.filter(r => ['abierto', 'en_tramite', 'en_espera'].includes(r.status)); }
  else rows = (await GET('/api/query/cases?' + qs(f))).rows;
  el.innerHTML = String(html`${head('Expedientes', `${rows.length} expediente(s)`, can('admin', 'expedientes') ? html`<button class="btn primary" data-act="new">+ Nuevo expediente</button>` : '')}
    <div class="card"><form id="ef" class="filters"><label class="f">Buscar<input name="q" value="${q.q || ''}" placeholder="Código, asunto o cliente"></label>
      <label class="f">Estado<select name="status">${opts({ activos: 'Activos', ...L.caseStatus }, q.status, 'Todos')}</select></label>
      <label class="f">Institución<input name="institution" value="${q.institution || ''}"></label>
      <label class="f">Responsable<select name="responsible">${optList(state.staff, q.responsible, 'Todos')}</select></label>
      <div class="actions"><button class="btn">Filtrar</button><a class="btn link" href="#/consultas?entity=cases">Más filtros →</a></div></form></div>
    <div class="card flush">${table(ENT.cases.cols, rows, { onRow: true, empty: 'No hay expedientes.' })}</div>`);
  bindRows(el, rows, r => go('#/expedientes/' + r.id));
  $('#ef').onsubmit = e => { e.preventDefault(); go('#/expedientes?' + qs(formData(e.target))); };
  act(el, { new: () => caseModal() });
});
route(/^\/expedientes\/(\d+)$/, async (el, [id], q) => {
  const d = await GET('/api/cases/' + id); const c = d.case;
  const tab = ['escaneados', 'archivos'].includes(q.tab) ? 'documentos' : (q.tab || 'documentos');
  const scans = d.documents.filter(x => x.category !== 'voucher');
  const tabs = [['documentos', `📂 Documentos (${scans.length})`], ['linea', 'Línea de tiempo'], ['plazos', `Plazos y agenda (${d.deadlines.filter(x => x.status === 'pendiente').length})`], ['solicitudes', `Solicitudes (${d.requests.length})`], ['pdf', `PDF (${d.gendocs.length})`]];
  const edit = can('admin', 'expedientes');
  let body = '';
  if (tab === 'linea') body = html`<div class="grid g2" style="grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)">
    <div class="card"><h2>Actuaciones</h2><div class="small muted" style="margin-bottom:10px"><span class="b info">Publicada</span> visible en el portal · <span class="b warn">Interna</span> solo para el equipo</div>
      <ul class="tl">${d.events.map(e => html`<li class="${e.visibility === 'interna' ? 'int' : ''}"><div class="meta"><span>${fdate(e.event_date)}</span><span class="b">${L.event[e.kind]}</span>
        ${e.visibility === 'cliente' ? html`<span class="b info">Publicada</span>` : html`<span class="b warn">Interna</span>`}<span>${e.author || ''}</span>
        ${edit ? html`<button class="btn link small" data-act="vis" data-id="${e.id}" data-v="${e.visibility === 'cliente' ? 'interna' : 'cliente'}">${e.visibility === 'cliente' ? 'Ocultar al cliente' : 'Publicar al cliente'}</button>` : ''}</div>
        <div class="t">${e.title}</div>${e.description ? html`<div class="d">${e.description}</div>` : ''}
        ${e.document_id ? html`<a class="small" href="/api/files/${e.document_id}?inline=1" target="_blank" rel="noopener">📎 Ver documento</a>` : ''}</li>`)}</ul>
      ${d.events.length ? '' : html`<div class="empty">Sin actuaciones.</div>`}</div>
    <div>${edit ? html`<div class="card"><h2>Registrar actuación</h2><form id="evf">
      <div class="row"><label class="f">Tipo<select name="kind">${opts(L.event, 'actuacion')}</select></label><label class="f">Fecha<input type="date" name="event_date" value="${today()}"></label></div>
      <label class="f">Título<input name="title" required></label><label class="f" style="margin-top:8px">Detalle<textarea name="description"></textarea></label>
      <label class="f" style="margin-top:8px">Visibilidad<select name="visibility"><option value="interna">Nota interna (solo equipo)</option><option value="cliente">Publicar actualización al cliente</option></select></label>
      <button class="btn primary" style="margin-top:10px">Registrar</button></form></div>` : ''}</div></div>`;
  if (tab === 'documentos') body = scansView(scans, q.tipo, edit || can('cobros'), { title: 'Cargar documentos al expediente', where: `Documentos LegalTax / ${c.client_folder || c.client_name} / ${c.folder_name || c.code}`, empty: 'Aún no hay documentos en este expediente. Cárguelos arriba.' });
  if (tab === 'plazos') body = html`<div class="actions" style="margin-bottom:12px"><button class="btn primary" data-act="newdl">+ Nuevo plazo / audiencia / tarea</button></div><div class="card flush">${deadlinesTable(d.deadlines)}</div>`;
  if (tab === 'solicitudes') body = html`<div class="actions" style="margin-bottom:12px"><button class="btn primary" data-act="newreq">+ Solicitar documento al cliente</button></div><div class="card flush">${table([{ h: 'Documento', v: r => html`<b>${r.title}</b><div class="small muted">${r.description || ''}</div>` }, { h: 'Entrega', v: r => fdate(r.due_date) }, { h: 'Estado', v: r => badge('req', r.status) }], d.requests, { empty: 'Sin solicitudes.' })}</div>`;
  if (tab === 'pdf') body = html`<div class="card flush">${gendocsTable(d.gendocs)}</div>`;
  el.innerHTML = String(html`${head(`${c.code} · ${c.title}`, html`<a href="#/clientes/${c.client_id}">${c.client_name}</a> · ${c.client_id_number}`,
    html`<a class="btn" href="#/carpetas/${c.client_id}/case-${c.id}">📁 Ver en Carpetas</a>${edit ? html`<button class="btn" data-act="edit">Editar</button>` : ''}<button class="btn gold" data-act="pdf">⎙ Generar PDF</button>`, html`<a href="#/expedientes">Expedientes</a> ›`)}
    <div class="card"><dl class="dl"><div><dt>Estado</dt><dd>${badge('caseStatus', c.status)}</dd></div><div><dt>Institución</dt><dd>${c.institution || '—'}</dd></div><div><dt>No. oficial</dt><dd>${c.official_number || '—'}</dd></div>
      <div><dt>Períodos fiscales</dt><dd>${c.fiscal_periods || '—'}</dd></div><div><dt>Responsable</dt><dd>${c.responsible_name || '—'}</dd></div><div><dt>Apertura</dt><dd>${fdate(c.opened_on)}</dd></div>
      <div><dt>Próxima acción</dt><dd>${c.next_action || '—'} ${c.next_action_date ? html`<span class="b gold">${fdate(c.next_action_date)}</span>` : ''}</dd></div>
      <div><dt>Estado visible al cliente</dt><dd>${c.public_status || html`<span class="muted">Sin publicar</span>`}</dd></div>
      ${d.quotes.length ? html`<div><dt>Cotizaciones</dt><dd>${d.quotes.map(x => html`<a href="#/cotizaciones/${x.id}">${x.number}</a> `)}</dd></div>` : ''}</dl></div>
    <div class="tabs">${tabs.map(([k, l]) => html`<a href="#/expedientes/${id}?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`)}</div>${body}`);
  bindGendocs(el);
  if (tab === 'documentos') bindScanUploader(el, `/api/cases/${id}/scans`);
  const evf = $('#evf'); if (evf) evf.onsubmit = async e => { e.preventDefault(); try { await POST(`/api/cases/${id}/events`, formData(evf)); toast('Actuación registrada'); render(); } catch (err) { fail(err); } };
  const upf = $('#upf'); if (upf) upf.onsubmit = async e => {
    e.preventDefault(); const fd = new FormData(upf); fd.append('case_id', id);
    const b = $('button', upf); b.disabled = true;
    try { const r = await api('POST', '/api/documents', fd); toast(`Archivo “${r.title}” guardado`); render(); } catch (err) { fail(err); } finally { b.disabled = false; }
  };
  act(el, {
    edit: () => caseModal(c, true), pdf: () => pdfMenu({ case_id: id, client_id: c.client_id }),
    vis: async x => { await PATCH('/api/events/' + x.id, { visibility: x.v }); render(); },
    togglevis: async x => { await PATCH('/api/documents/' + x.id, { visibility: x.vis }); render(); },
    newdl: () => deadlineModal({ case_id: id }), newreq: () => requestModal({ case_id: id }),
    editscan: x => { const doc = d.documents.find(y => String(y.id) === x.id); editScanModal(doc); },
    ...deadlineActs(),
  });
});

// ───── agenda
function deadlinesTable(rows) {
  return table([{ h: 'Fecha y hora', v: r => html`<span class="nowrap">${fdt(r.due_at)}</span>${r.status === 'pendiente' && new Date(r.due_at) < new Date() ? html` <span class="b bad">Atrasada</span>` : r.in_alert ? html` <span class="b warn">Alerta</span>` : ''}` },
    { h: 'Tipo', v: r => L.dl[r.kind] }, { h: 'Descripción', v: r => html`<b>${r.title}</b>${r.client_name ? html`<div class="small muted">${r.client_name} ${r.case_code ? '· ' + r.case_code : ''}</div>` : ''}` },
    { h: 'Responsable', v: r => r.responsible_name || '—' },
    { h: 'Fecha confirmada', v: r => r.confirmed ? html`<span class="b ok">Confirmada</span>` : html`<button class="btn sm" data-act="confirm" data-id="${r.id}">Confirmar</button>` },
    { h: 'Estado', v: r => r.status === 'pendiente' ? html`<button class="btn sm primary" data-act="done" data-id="${r.id}">Completar</button>` : html`<span class="b ok">${r.status}</span>` },
    { h: '', v: r => html`<button class="btn sm" data-act="attach" data-id="${r.id}" data-case="${r.case_id || ''}" data-client="${r.client_id || ''}">📎 Acuse${r.attachments ? ` (${r.attachments})` : ''}</button>` }],
  rows, { empty: 'No hay registros.' });
}
function deadlineActs() {
  return {
    confirm: async d => { await PATCH('/api/deadlines/' + d.id, { confirmed: true }); toast('Fecha confirmada'); render(); },
    done: async d => { await PATCH('/api/deadlines/' + d.id, { status: 'completada' }); toast('Marcado como completado'); render(); },
    attach: d => modal('Adjuntar acuse o constancia', html`<div class="row"><label class="f">Categoría<select name="category">${opts({ acuse: 'Acuse', constancia_deposito: 'Constancia de depósito', notificacion: 'Notificación', otro: 'Otro' }, 'acuse')}</select></label>
      <label class="f">Título<input name="title"></label><label class="f">No. de documento<input name="resolution_number"></label></div><label class="f">Archivo<input type="file" name="file" required></label>`,
    { submitLabel: 'Subir', submit: async (x, f) => { const fd = new FormData(f); fd.append('deadline_id', d.id); if (d.case) fd.append('case_id', d.case); if (d.client) fd.append('client_id', d.client); await api('POST', '/api/documents', fd); toast('Acuse adjuntado'); render(); } }),
  };
}
function deadlineModal(ctx = {}) {
  modal('Nuevo registro en agenda', html`<div class="row"><label class="f">Tipo<select name="kind">${opts(L.dl, 'plazo')}</select></label><label class="f">Fecha y hora límite<input type="datetime-local" name="due_at" required></label></div>
    <label class="f">Descripción<input name="title" required></label>
    <div class="row" style="margin-top:10px"><label class="f">Responsable<select name="responsible_user_id">${optList(state.staff, state.me.id)}</select></label>
    <label class="f">Alertar con (días de anticipación)<input type="number" name="alert_days" value="3" min="0" max="60"></label></div>
    <label class="chk"><input type="checkbox" name="confirmed"> Fecha límite confirmada por el equipo</label><label class="f" style="margin-top:8px">Notas<textarea name="description"></textarea></label>`,
  { submit: async d => { await POST('/api/deadlines', { ...d, ...ctx }); toast('Registrado en agenda'); render(); } });
}
route(/^\/agenda$/, async (el, _, q) => {
  const scope = q.scope || 'abiertas'; const rows = await GET('/api/deadlines?scope=' + scope);
  el.innerHTML = String(html`${head('Agenda y vencimientos', 'Audiencias, reuniones, plazos y tareas con alertas configurables.', html`<button class="btn primary" data-act="new">+ Nuevo</button>`)}
    <div class="tabs">${[['abiertas', 'Pendientes'], ['proximas', 'Próximos'], ['atrasadas', 'Atrasados'], ['todas', 'Todos']].map(([k, l]) => html`<a href="#/agenda?scope=${k}" class="${k === scope ? 'active' : ''}">${l}</a>`)}</div>
    <div class="card flush">${deadlinesTable(rows)}</div>`);
  act(el, { new: () => deadlineModal(), ...deadlineActs() });
});

// ───── cotizaciones
route(/^\/cotizaciones$/, async (el, _, q) => {
  const rows = await GET('/api/quotes?' + qs({ status: q.status }));
  el.innerHTML = String(html`${head('Cotizaciones', 'Propuestas de servicios, aceptación y plan de cuotas.', html`<a class="btn primary" href="#/cotizaciones/nueva">+ Nueva cotización</a>`)}
    <div class="tabs">${[['', 'Todas'], ['borrador', 'Borradores'], ['publicada', 'Pendientes de aceptación'], ['aceptada', 'Aceptadas'], ['rechazada', 'Rechazadas']].map(([k, l]) => html`<a href="#/cotizaciones${k ? '?status=' + k : ''}" class="${(q.status || '') === k ? 'active' : ''}">${l}</a>`)}</div>
    <div class="card flush">${table([{ h: 'Número', v: r => html`<b>${r.number}</b>` }, { h: 'Cliente', v: r => r.client_name }, { h: 'Título', v: r => html`${r.title}<div class="small muted">${r.case_code || ''}</div>` },
      { h: 'Fecha', v: r => fdate(r.created_at) }, { h: 'Total', num: true, v: r => money(r.total) }, { h: 'Pagado', num: true, v: r => money(r.paid) }, { h: 'Estado', v: r => badge('quote', r.status) }], rows, { onRow: true, empty: 'No hay cotizaciones.' })}</div>`);
  bindRows(el, rows, r => go('#/cotizaciones/' + r.id));
});
async function quoteEditor(el, q0, query) {
  const clients = await GET('/api/clients');
  const editing = !!q0;
  const st = { items: q0 ? q0.items.map(i => ({ ...i })) : [{ kind: 'honorario', description: '', amount: '' }], inst: q0 ? q0.installments.map(i => ({ due_date: i.due_date, amount: i.amount })) : [] };
  const qt = q0?.quote || { client_id: query.client_id, itbis_applies: true, valid_until: today(30) };
  el.innerHTML = String(html`${head(editing ? `Editar ${qt.number}` : 'Nueva cotización', 'Los totales y el ITBIS (18 %) se calculan automáticamente.', '', html`<a href="#/cotizaciones">Cotizaciones</a> ›`)}
    <form id="qf">
    <div class="card"><h2>Cliente y alcance</h2><div class="row">
      <label class="f">Cliente<select name="client_id" required ${editing ? 'disabled' : ''}>${optList(clients, qt.client_id, 'Seleccione…', x => `${x.name} (${x.id_number})`)}</select></label>
      <label class="f">Expediente relacionado<select name="case_id" id="qcase"><option value="">Ninguno</option></select></label>
      <label class="f">Válida hasta<input type="date" name="valid_until" value="${qt.valid_until || ''}"></label></div>
      <div class="row"><label class="f wide">Título<input name="title" required value="${qt.title || ''}" placeholder="Ej.: Representación en recurso de reconsideración ante la DGII"></label></div>
      <div class="row"><label class="f wide">Alcance de los servicios<textarea name="scope" rows="5">${qt.scope || ''}</textarea></label></div></div>
    <div class="card"><h2>Honorarios y gastos</h2><div id="items"></div><button type="button" class="btn sm" id="additem">+ Agregar concepto</button>
      <div class="row" style="margin-top:14px"><label class="f">Descuento sobre honorarios (RD$)<input type="number" step="0.01" min="0" name="discount" value="${qt.discount || 0}" id="disc"></label>
      <label class="chk" style="align-self:end"><input type="checkbox" name="itbis_applies" id="itb" ${qt.itbis_applies !== false ? 'checked' : ''}> Aplicar ITBIS 18 % a los honorarios</label></div>
      <div id="tot" class="card" style="background:#FAFBFC;margin:0"></div></div>
    <div class="card"><h2>Plan de cuotas</h2><div class="row"><label class="f">Cantidad de cuotas<input type="number" min="1" max="36" id="ncuo" value="${st.inst.length || 1}"></label>
      <label class="f">Primera fecha<input type="date" id="fcuo" value="${st.inst[0]?.due_date || today(7)}"></label>
      <label class="f">Frecuencia<select id="frcuo"><option value="m">Mensual</option><option value="q">Quincenal</option><option value="s">Semanal</option></select></label>
      <div style="align-self:end"><button type="button" class="btn" id="gencuo">Generar cuotas iguales</button></div></div>
      <div id="inst"></div><div id="instmsg" class="small"></div></div>
    <div class="actions"><button class="btn primary">${editing ? 'Guardar cambios' : 'Guardar borrador'}</button><a class="btn" href="${editing ? '#/cotizaciones/' + q0.quote.id : '#/cotizaciones'}">Cancelar</a></div>
    </form>`);
  const f = $('#qf');
  const loadCases = async cid => { const sel = $('#qcase'); if (!cid) { sel.innerHTML = '<option value="">Ninguno</option>'; return; } const d = await GET('/api/clients/' + cid); sel.innerHTML = String(optList(d.cases, qt.case_id, 'Ninguno', x => x.code + ' — ' + x.title)); };
  f.client_id.onchange = () => loadCases(f.client_id.value);
  if (qt.client_id) loadCases(qt.client_id);
  const totals = () => {
    const fees = r2(st.items.filter(i => i.kind === 'honorario').reduce((s, i) => s + Number(i.amount || 0), 0));
    const exp = r2(st.items.filter(i => i.kind === 'gasto').reduce((s, i) => s + Number(i.amount || 0), 0));
    const disc = Math.min(Number($('#disc').value || 0), fees); const sub = r2(fees - disc); const itbis = $('#itb').checked ? r2(sub * 0.18) : 0;
    return { fees, exp, disc, sub, itbis, total: r2(sub + itbis + exp) };
  };
  const drawTot = () => {
    const t = totals(); const sum = r2(st.inst.reduce((s, i) => s + Number(i.amount || 0), 0));
    $('#tot').innerHTML = String(html`<dl class="dl"><div><dt>Honorarios</dt><dd>${money(t.fees)}</dd></div><div><dt>Descuento</dt><dd>- ${money(t.disc)}</dd></div><div><dt>Subtotal</dt><dd>${money(t.sub)}</dd></div>
      <div><dt>ITBIS</dt><dd>${money(t.itbis)}</dd></div><div><dt>Gastos</dt><dd>${money(t.exp)}</dd></div><div><dt>Total</dt><dd><b style="font-size:1.15rem;color:var(--navy)">${money(t.total)}</b></dd></div></dl>`);
    $('#instmsg').innerHTML = st.inst.length ? (Math.abs(sum - t.total) < 0.01 ? String(html`<span style="color:var(--ok)">✓ Las cuotas suman ${money(sum)}</span>`) : String(html`<span style="color:var(--bad)">Las cuotas suman ${money(sum)}; deben sumar ${money(t.total)}. Use “Generar cuotas iguales” o ajuste los montos.</span>`)) : '';
  };
  const drawItems = () => {
    $('#items').innerHTML = st.items.map((it, i) => String(html`<div class="row" data-i="${i}"><label class="f">Tipo<select data-k="kind">${opts({ honorario: 'Honorario', gasto: 'Gasto' }, it.kind)}</select></label>
      <label class="f" style="grid-column:span 2">Descripción<input data-k="description" value="${it.description}"></label><label class="f">Monto (RD$)<input data-k="amount" type="number" step="0.01" min="0" value="${it.amount}"></label>
      <div style="align-self:end"><button type="button" class="btn sm danger" data-del="${i}">Quitar</button></div></div>`)).join('');
    $$('#items [data-k]').forEach(inp => inp.oninput = inp.onchange = () => { st.items[inp.closest('[data-i]').dataset.i][inp.dataset.k] = inp.value; drawTot(); });
    $$('#items [data-del]').forEach(b => b.onclick = () => { st.items.splice(+b.dataset.del, 1); drawItems(); drawTot(); });
  };
  const drawInst = () => {
    $('#inst').innerHTML = st.inst.length ? String(html`<table class="tbl"><thead><tr><th>Cuota</th><th>Vencimiento</th><th class="num">Monto (RD$)</th></tr></thead><tbody>${st.inst.map((x, i) => html`<tr data-i="${i}"><td>#${i + 1}</td><td><input type="date" data-k="due_date" value="${x.due_date}"></td><td><input type="number" step="0.01" data-k="amount" value="${x.amount}"></td></tr>`)}</tbody></table>`) : '<div class="muted small">Genere las cuotas a partir del total.</div>';
    $$('#inst [data-k]').forEach(inp => inp.oninput = () => { st.inst[inp.closest('[data-i]').dataset.i][inp.dataset.k] = inp.value; drawTot(); });
  };
  const genInst = () => {
    const n = Math.max(1, +$('#ncuo').value || 1); const t = totals().total; const base = Math.floor(t / n * 100) / 100; const fr = $('#frcuo').value; let d0 = $('#fcuo').value || today();
    st.inst = Array.from({ length: n }, (_, i) => ({ due_date: fr === 'm' ? addMonths(d0, i) : addDays(d0, i * (fr === 'q' ? 15 : 7)), amount: i === n - 1 ? r2(t - base * (n - 1)) : base }));
    drawInst(); drawTot();
  };
  $('#additem').onclick = () => { st.items.push({ kind: 'honorario', description: '', amount: '' }); drawItems(); };
  $('#gencuo').onclick = genInst; $('#disc').oninput = drawTot; $('#itb').onchange = drawTot;
  drawItems(); drawInst(); drawTot();
  f.onsubmit = async e => {
    e.preventDefault();
    if (!st.inst.length) genInst();
    const d = formData(f);
    const body = { ...d, client_id: editing ? qt.client_id : d.client_id, items: st.items, installments: st.inst, discount: Number(d.discount || 0) };
    try { const r = editing ? await PUT('/api/quotes/' + qt.id, body) : await POST('/api/quotes', body); toast(`Cotización ${r.number} guardada`); go('#/cotizaciones/' + r.id); } catch (err) { fail(err); }
  };
}
route(/^\/cotizaciones\/nueva$/, (el, _, q) => quoteEditor(el, null, q), ['admin', 'expedientes', 'cobros']);
route(/^\/cotizaciones\/(\d+)\/editar$/, async (el, [id]) => quoteEditor(el, await GET('/api/quotes/' + id), {}), ['admin', 'expedientes', 'cobros']);
route(/^\/cotizaciones\/(\d+)$/, async (el, [id]) => {
  const d = await GET('/api/quotes/' + id); const q = d.quote; const cur = d.gendocs.find(g => g.status === 'vigente');
  el.innerHTML = String(html`${head(`${q.number} · ${q.title}`, html`<a href="#/clientes/${q.client_id}">${q.client_name}</a> ${q.case_code ? html`· <a href="#/expedientes/${q.case_id}">${q.case_code}</a>` : ''} · ${badge('quote', q.status)}`,
    html`${q.status === 'borrador' ? html`<a class="btn" href="#/cotizaciones/${id}/editar">Editar</a><button class="btn" data-act="prev">Vista previa PDF</button><button class="btn primary" data-act="publish">Publicar al cliente</button>` : ''}
      ${cur ? html`<button class="btn primary" data-gd="${cur.id}">Ver PDF</button>` : ''}
      ${q.status === 'publicada' ? html`<button class="btn gold" data-act="accept">Registrar aceptación</button>` : ''}
      ${q.status === 'aceptada' && can('admin', 'cobros') ? html`<button class="btn gold" data-act="pay">+ Registrar pago</button><button class="btn" data-act="inv">🧾 Generar factura</button>` : ''}
      ${['borrador', 'publicada'].includes(q.status) && can('admin', 'cobros') ? html`<button class="btn danger" data-act="void">Anular</button>` : ''}`, html`<a href="#/cotizaciones">Cotizaciones</a> ›`)}
    ${q.status === 'borrador' ? html`<div class="alert info">Borrador: el cliente no puede verla. Al publicarla se emite el PDF y aparece en su portal para aceptarla.</div>` : ''}
    ${q.status === 'aceptada' ? html`<div class="alert ok">Aceptada por ${q.accepted_by_name || '—'} el ${fdt(q.accepted_at)}. ${q.accepted_note || ''}</div>` : ''}
    <div class="grid g2" style="grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)"><div>
      <div class="card"><h2>Alcance</h2><div style="white-space:pre-wrap">${q.scope || '—'}</div></div>
      <div class="card flush"><h2>Conceptos</h2>${table([{ h: 'Tipo', v: r => r.kind === 'gasto' ? 'Gasto' : 'Honorario' }, { h: 'Descripción', v: r => r.description }, { h: 'Monto', num: true, v: r => money(r.amount) }], d.items)}</div></div>
      <div><div class="card"><h2>Totales</h2><dl class="dl" style="grid-template-columns:1fr 1fr"><div><dt>Honorarios</dt><dd>${money(q.fees_total)}</dd></div><div><dt>Descuento</dt><dd>${money(q.discount)}</dd></div>
        <div><dt>Subtotal</dt><dd>${money(q.subtotal)}</dd></div><div><dt>ITBIS ${q.itbis_applies ? '18 %' : '(no aplica)'}</dt><dd>${money(q.itbis)}</dd></div><div><dt>Gastos</dt><dd>${money(q.expenses_total)}</dd></div>
        <div><dt>Total</dt><dd><b style="font-size:1.2rem;color:var(--navy)">${money(q.total)}</b></dd></div>
        <div><dt>Pagado</dt><dd>${money(d.balance.paid)}</dd></div><div><dt>Saldo</dt><dd><b>${money(d.balance.balance)}</b></dd></div></dl></div>
      <div class="card flush"><h2>Cuotas</h2>${table([{ h: '#', v: r => r.seq }, { h: 'Vence', v: r => fdate(r.due_date) }, { h: 'Monto', num: true, v: r => money(r.amount) }], d.installments)}</div>
      <div class="card flush"><h2>Versiones del PDF</h2>${table([{ h: 'Versión', v: r => 'v' + r.version }, { h: 'Fecha', v: r => fdt(r.created_at) }, { h: 'Estado', v: r => badge('gd', r.status) }, { h: '', v: r => html`<button class="btn sm" data-gd="${r.id}">Ver</button>` }], d.gendocs, { empty: 'Se emitirá al publicar.' })}</div></div></div>`);
  bindGendocs(el);
  act(el, {
    prev: () => previewPdf('cotizacion', { quote_id: +id }),
    publish: async () => { if (!confirm('¿Publicar la cotización? Se emitirá el PDF y el cliente podrá verla y aceptarla en su portal.')) return; await POST(`/api/quotes/${id}/publish`); toast('Cotización publicada en el portal del cliente'); render(); },
    accept: () => modal('Registrar decisión del cliente', html`<p class="small muted">Use esta opción si el cliente aceptó por otro medio (correo, firma física).</p><label class="f">Decisión<select name="decision"><option value="aceptar">Aceptada</option><option value="rechazar">Rechazada</option></select></label><label class="f" style="margin-top:8px">Nota<input name="note" placeholder="Ej.: aceptada por correo del 08/11"></label>`,
      { submit: async x => { await POST(`/api/quotes/${id}/accept`, x); toast('Decisión registrada'); render(); } }),
    void: () => modal('Anular cotización', html`<label class="f">Motivo<textarea name="reason" required></textarea></label>`, { submitLabel: 'Anular', submit: async x => { await POST(`/api/quotes/${id}/void`, x); render(); } }),
    pay: () => paymentModal({ quote_id: id, client_id: q.client_id }),
    inv: () => invoiceModal({ client_id: q.client_id, quote_id: id }),
  });
});

// ───── pagos
function paymentModal(ctx, portal) {
  const go2 = async () => {
    let quotes = ctx.quotes;
    if (!quotes && !ctx.quote_id) quotes = (await GET('/api/quotes?status=aceptada'));
    modal(portal ? 'Subir comprobante de pago' : 'Registrar pago / voucher', html`
      ${portal ? html`<div class="alert info">Su comprobante quedará <b>pendiente de validación</b>. El saldo se actualiza y el recibo se emite cuando Cobros lo valida.</div>` : ''}
      ${quotes ? html`<label class="f">Cotización<select name="quote_id" required>${optList(quotes, ctx.quote_id, 'Seleccione…', x => `${x.number} — ${x.title}${x.client_name ? ' · ' + x.client_name : ''}`)}</select></label>` : html`<input type="hidden" name="quote_id" value="${ctx.quote_id}">`}
      <div class="row" style="margin-top:10px"><label class="f">Monto pagado (RD$)<input type="number" name="amount" step="0.01" min="0.01" required value="${ctx.amount || ''}"></label>
      <label class="f">Fecha del pago<input type="date" name="paid_on" value="${today()}" required></label></div>
      <div class="row"><label class="f">Medio de pago<select name="method">${opts(L.method, 'transferencia')}</select></label><label class="f">Banco<input name="bank" placeholder="Banreservas, Popular, BHD…"></label>
      <label class="f">No. de referencia<input name="reference"></label></div>
      <label class="f">Comprobante (imagen o PDF)${portal ? '' : ' — opcional'}<input type="file" name="file" accept="image/*,application/pdf" ${portal ? 'required' : ''}></label>`,
    { submitLabel: portal ? 'Enviar comprobante' : 'Registrar', submit: async (d, f) => {
      const fd = new FormData(f); const r = await api('POST', portal ? '/api/portal/payments' : '/api/payments', fd);
      toast(portal ? 'Comprobante enviado. Le notificaremos cuando sea validado.' : 'Pago registrado como pendiente de validación'); render(); return r;
    } });
  };
  go2().catch(fail);
}
route(/^\/pagos$/, async (el, _, q) => {
  const st = q.status ?? 'pendiente'; const rows = await GET('/api/payments?' + qs({ status: st }));
  el.innerHTML = String(html`${head('Vouchers y pagos', 'Todo comprobante entra como pendiente. Solo un pago validado reduce el saldo y genera recibo.', can('admin', 'cobros') ? html`<button class="btn primary" data-act="new">+ Registrar pago</button>` : '')}
    <div class="tabs">${[['pendiente', 'Por validar'], ['validado', 'Validados'], ['rechazado', 'Rechazados'], ['anulado', 'Anulados'], ['', 'Todos']].map(([k, l]) => html`<a href="#/pagos?status=${k}" class="${st === k ? 'active' : ''}">${l}</a>`)}</div>
    <div class="card flush">${paymentsTable(rows, true)}</div>`);
  act(el, { new: () => paymentModal({}), ...payActs() });
});

// ───── solicitudes de documentos
function requestModal(ctx = {}) {
  const go2 = async () => {
    const clients = ctx.case_id ? [] : await GET('/api/clients');
    modal('Solicitar documento al cliente', html`${ctx.case_id ? '' : html`<label class="f">Cliente<select name="client_id" required>${optList(clients, ctx.client_id, 'Seleccione…')}</select></label>`}
      <label class="f" style="margin-top:8px">Documento solicitado<input name="title" required placeholder="Ej.: Estados financieros auditados 2024"></label>
      <label class="f" style="margin-top:8px">Instrucciones<textarea name="description"></textarea></label>
      <label class="f" style="margin-top:8px">Fecha de entrega<input type="date" name="due_date" value="${today(7)}"></label>`,
    { submitLabel: 'Enviar solicitud', submit: async d => { await POST('/api/requests', { ...d, ...ctx }); toast('Solicitud registrada; el cliente la verá en su portal'); render(); } });
  };
  go2().catch(fail);
}
route(/^\/solicitudes$/, async el => {
  const rows = await GET('/api/requests');
  el.innerHTML = String(html`${head('Solicitudes de documentos', 'Pida archivos a los clientes y controle su recepción.', html`<button class="btn primary" data-act="new">+ Nueva solicitud</button>`)}
    <div class="card flush">${table([{ h: 'Documento', v: r => html`<b>${r.title}</b><div class="small muted">${r.description || ''}</div>` }, { h: 'Cliente / Exp.', v: r => html`${r.client_name}<div class="small muted">${r.case_code || ''}</div>` },
      { h: 'Entrega', v: r => html`${fdate(r.due_date)}${r.status !== 'recibida' && r.due_date && r.due_date < today() ? html` <span class="b bad">Vencida</span>` : ''}` },
      { h: 'Archivos del cliente', v: r => (r.files || []).length ? html`${r.files.map(x => html`<a href="/api/files/${x.id}?inline=1" target="_blank" rel="noopener">📎 ${x.filename}</a><br>`)}${r.client_note ? html`<div class="small muted">“${r.client_note}”</div>` : ''}` : html`<span class="muted">—</span>` },
      { h: 'Estado', v: r => html`${badge('req', r.status)}${r.staff_note && r.status === 'devuelta' ? html`<div class="small">${r.staff_note}</div>` : ''}` },
      { h: '', v: r => r.status !== 'recibida' ? html`<span class="actions"><button class="btn sm primary" data-act="ok" data-id="${r.id}">Marcar recibida</button><button class="btn sm danger" data-act="back" data-id="${r.id}">Devolver</button></span>` : '' }],
    rows, { empty: 'No hay solicitudes.' })}</div>`);
  act(el, {
    new: () => requestModal(),
    ok: async d => { await PATCH('/api/requests/' + d.id, { status: 'recibida' }); toast('Marcada como recibida'); render(); },
    back: d => modal('Devolver para corrección', html`<label class="f">¿Qué debe corregir el cliente?<textarea name="staff_note" required></textarea></label>`, { submit: async x => { await PATCH('/api/requests/' + d.id, { status: 'devuelta', ...x }); render(); } }),
  });
});

// ───── documentos PDF emitidos
route(/^\/documentos$/, async (el, _, q) => {
  const rows = await GET('/api/gendocs?' + qs({ type: q.type, q: q.q }));
  el.innerHTML = String(html`${head('Documentos PDF', 'Archivo de documentos emitidos. Cada copia conserva sus datos originales.', html`<button class="btn gold" data-act="new">⎙ Generar documento</button>`)}
    <div class="card"><form id="gf" class="filters"><label class="f">Número o título<input name="q" value="${q.q || ''}"></label><label class="f">Tipo<select name="type">${opts(L.doc, q.type, 'Todos')}</select></label><div><button class="btn">Filtrar</button></div></form></div>
    <div class="card flush">${table([{ h: 'Número', v: r => html`<b>${r.number}</b>${r.version > 1 ? html` <span class="b">v${r.version}</span>` : ''}` }, { h: 'Tipo', v: r => L.doc[r.doc_type] }, { h: 'Cliente', v: r => r.client_name },
      { h: 'Emitido', v: r => html`${fdt(r.created_at)}<div class="small muted">${r.author || ''}</div>` }, { h: 'Estado', v: r => html`${badge('gd', r.status)} ${r.shared ? html`<span class="b info">Compartido</span>` : ''}` },
      { h: '', v: r => html`<span class="actions"><button class="btn sm primary" data-gd="${r.id}">Ver</button><a class="btn sm" href="#/documentos/${r.id}">Detalle</a></span>` }], rows, { empty: 'Sin documentos.' })}</div>`);
  bindGendocs(el);
  $('#gf').onsubmit = e => { e.preventDefault(); go('#/documentos?' + qs(formData(e.target))); };
  act(el, { new: async () => {
    const clients = await GET('/api/clients');
    modal('¿Para qué cliente?', html`<label class="f">Cliente<select name="client_id" required>${optList(clients, '', 'Seleccione…', x => `${x.name} (${x.id_number})`)}</select></label>`, { submitLabel: 'Continuar', submit: async d => { setTimeout(() => pdfMenu({ client_id: d.client_id }), 50); } });
  } });
});
route(/^\/documentos\/(\d+)$/, async (el, [id]) => {
  const g = await GET('/api/gendocs/' + id);
  el.innerHTML = String(html`${head(`${g.number}${g.version > 1 ? ' · versión ' + g.version : ''}`, html`${L.doc[g.doc_type]} · ${badge('gd', g.status)} ${g.shared ? html`<span class="b info">Compartido con el cliente</span>` : html`<span class="b">No compartido</span>`}`,
    html`<button class="btn primary" data-gd="${g.id}">Ver PDF</button><button class="btn mail" data-act="mail">✉ Enviar por correo</button><button class="btn" data-act="toclient">💬 Enviar al cliente</button>
      ${g.status === 'vigente' ? html`<button class="btn" data-act="share">${g.shared ? 'Dejar de compartir' : 'Compartir con el cliente'}</button>` : ''}
      ${g.status === 'vigente' && g.doc_type !== 'cotizacion' ? html`<button class="btn" data-act="nv">Corregir (nueva versión)</button>` : ''}
      ${g.status === 'vigente' && can('admin', 'cobros') ? html`<button class="btn danger" data-act="void">Anular</button>` : ''}
      ${g.status === 'anulado' ? html`<a class="btn" href="/api/gendocs/${g.id}/pdf?original=1" target="_blank" rel="noopener">Ver original sin marca</a>` : ''}`, html`<a href="#/documentos">Documentos PDF</a> ›`)}
    ${g.status === 'anulado' ? html`<div class="alert bad"><b>Anulado</b> el ${fdt(g.voided_at)} por ${g.voided_by_name}. Motivo: ${g.void_reason}</div>` : ''}
    ${g.status === 'reemplazado' ? html`<div class="alert warn">Esta versión fue reemplazada por una versión posterior.</div>` : ''}
    <div class="grid g2"><div class="card"><h2>Datos del documento</h2><dl class="dl"><div><dt>Título</dt><dd>${g.title}</dd></div><div><dt>Emitido por</dt><dd>${g.author}</dd></div>
      <div><dt>Fecha de emisión</dt><dd>${fdt(g.created_at)}</dd></div><div><dt>Cliente</dt><dd><a href="#/clientes/${g.client_id}">${g.data.client?.name}</a></dd></div>
      ${g.data.amount !== undefined ? html`<div><dt>Monto</dt><dd>${money(g.data.amount)}</dd></div>` : ''}${g.data.total !== undefined ? html`<div><dt>Total</dt><dd>${money(g.data.total)}</dd></div>` : ''}</dl>
      <p class="small muted" style="margin-top:12px">Los datos de esta copia quedaron fijados al emitirla; editar la ficha del cliente no la modifica.</p></div>
    <div class="card flush"><h2>Historial de versiones</h2>${table([{ h: 'Versión', v: r => 'v' + r.version }, { h: 'Fecha', v: r => fdt(r.created_at) }, { h: 'Autor', v: r => r.author }, { h: 'Estado', v: r => badge('gd', r.status) }, { h: '', v: r => html`<button class="btn sm" data-gd="${r.id}">Ver</button>` }], g.versions)}</div></div>`);
  bindGendocs(el);
  act(el, {
    share: async () => { await POST(`/api/gendocs/${id}/share`, { shared: !g.shared }); render(); },
    mail: () => emailModal({ title: `Enviar ${g.number} por correo`, url: '/api/email/gendoc/' + id, clientEmail: g.data.client?.email }),
    toclient: () => notice('documento', g.client_id, g.id),
    nv: () => {
      const p = g.data._params || {};
      const extra = g.doc_type === 'informe_avance' ? html`<label class="f">Resumen<textarea name="summary">${p.summary || ''}</textarea></label><label class="f" style="margin-top:8px">Próximos pasos<textarea name="next_steps">${p.next_steps || ''}</textarea></label>`
        : g.doc_type === 'estado_cuenta' ? html`<label class="f">Fecha de corte<input type="date" name="cutoff" value="${p.cutoff || today()}"></label>`
        : g.doc_type === 'recibo_dinero' ? html`<label class="f">Concepto<input name="concept" value="${g.data.concept || ''}"></label>`
        : g.doc_type === 'recibo_documentos' ? html`<label class="f">Observaciones<textarea name="notes">${p.notes || ''}</textarea></label><label class="f">Entrega<input name="delivered_by" value="${p.delivered_by || ''}"></label><label class="f">Recibe<input name="received_by" value="${p.received_by || ''}"></label>` : '';
      modal('Corregir mediante nueva versión', html`<div class="alert info">Se emitirá la versión ${g.version + 1} con el mismo número, usando los datos actuales de la base de datos. La versión anterior se conserva como “reemplazada”.</div>${extra}`,
        { submitLabel: 'Emitir nueva versión', submit: async d => { const r = await POST(`/api/gendocs/${id}/new-version`, { params: d }); toast('Nueva versión emitida'); go('#/documentos/' + r.id); } });
    },
    void: () => modal('Anular documento', html`${g.doc_type === 'recibo_dinero' ? html`<div class="alert warn">Al anular un recibo, el pago asociado también se anula y el saldo del cliente vuelve a aumentar.</div>` : ''}<label class="f">Motivo de anulación (obligatorio)<textarea name="reason" required></textarea></label>`,
      { submitLabel: 'Anular', submit: async d => { await POST(`/api/gendocs/${id}/void`, d); toast('Documento anulado'); render(); } }),
  });
});

// ───── facturas
const INV_FILTERS = [['', 'Todas'], ['pendientes', 'Pendientes'], ['vencidas', 'Vencidas'], ['pagada', 'Pagadas'], ['anulada', 'Anuladas']];
function invoicesTable(rows, showClient = true) {
  return table([{ h: 'Número', v: r => html`<b>${r.number}</b>` }, ...(showClient ? [{ h: 'Cliente', v: r => r.client_name }] : []),
    { h: 'Concepto', v: r => html`${r.description}<div class="small muted">${r.quote_number}${r.inst_seq ? ' · cuota #' + r.inst_seq : ''}</div>` },
    { h: 'Emisión / Vence', v: r => html`${fdate(r.issue_date)}<div class="small muted">vence ${fdate(r.due_date)}</div>` },
    { h: 'Total', num: true, v: r => money(r.total) }, { h: 'Pendiente', num: true, v: r => money(r.state.balance) },
    { h: 'Estado', v: r => html`<span class="b ${r.state.tone}">${r.state.label}</span>${r.void_reason ? html`<div class="small" style="color:var(--bad)">${r.void_reason}</div>` : ''}` },
    { h: '', v: r => html`<span class="actions">${r.gendoc_id ? html`<button class="btn sm primary" data-act="viewgd" data-id="${r.gendoc_id}">PDF</button>` : ''}
      ${r.status === 'emitida' ? html`<button class="btn sm" data-act="invnotice" data-id="${r.id}" data-client="${r.client_id}">📣 Aviso</button><button class="btn sm" data-act="invstate" data-id="${r.id}" data-client="${r.client_id}">Estado</button>
      ${can('admin', 'cobros') ? html`<button class="btn sm danger" data-act="invvoid" data-id="${r.id}">Anular</button>` : ''}` : ''}</span>` }],
  rows, { empty: 'No hay facturas.' });
}
function invActs() {
  return {
    viewgd: d => viewPdf(gdUrl(d.id)),
    invnotice: d => notice('factura', d.client, d.id), invstate: d => notice('estado_factura', d.client, d.id),
    invvoid: d => modal('Anular factura', html`<div class="alert warn">La factura y su PDF quedarán anulados. Si corresponde, registre la nota de crédito en el sistema de la DGII.</div><label class="f">Motivo (obligatorio)<textarea name="reason" required></textarea></label>`,
      { submitLabel: 'Anular', submit: async x => { await POST(`/api/invoices/${d.id}/void`, x); toast('Factura anulada'); render(); } }),
  };
}
async function invoiceModal(ctx = {}) {
  const clients = ctx.client_id ? [] : await GET('/api/clients');
  const cfg = state.mail || {};
  const m = modal('Generar factura', html`
    ${clients.length ? html`<label class="f">Cliente<select name="client_id" required>${optList(clients, '', 'Seleccione…', x => `${x.name} (${x.id_number})`)}</select></label>` : html`<input type="hidden" name="client_id" value="${ctx.client_id}">`}
    <label class="f" style="margin-top:8px">Cotización aceptada<select name="quote_id" required id="iq"><option value="">Cargando…</option></select></label>
    <label class="f" style="margin-top:8px">Facturar<select name="installment_id" id="ii"><option value="">Total de la cotización</option></select></label>
    <div class="row" style="margin-top:8px"><label class="f">Fecha de emisión<input type="date" name="issue_date" value="${today()}"></label><label class="f">Vencimiento (vacío = el de la cuota)<input type="date" name="due_date"></label></div>
    <label class="f">Concepto (opcional)<input name="description" placeholder="Se toma de la cotización"></label>
    <div id="ipv" class="alert info" style="margin-top:10px"></div>
    <label class="chk"><input type="checkbox" name="share" checked> Publicar en el portal del cliente</label>
    <label class="chk" style="margin-top:4px"><input type="checkbox" name="notify_client" ${cfg.client_invoices !== false ? 'checked' : ''}> Enviar aviso de factura generada al correo del cliente (con el PDF)</label>
    <p class="small muted" style="margin-top:8px">El número se toma de la secuencia NCF/e-CF configurada en Configuración → Numeración. Se avisa también al correo del despacho.</p>`,
  { submitLabel: 'Generar factura', submit: async d => {
    const r = await POST('/api/invoices', { ...d, share: d.share, notify_client: d.notify_client });
    toast(`Factura ${r.number} generada por ${money(r.total)}`); render(); setTimeout(() => viewPdf(gdUrl(r.gendoc_id), 'Factura ' + r.number), 200);
  } });
  const f = m.form; let quotes = [], detail = null;
  const loadQuotes = async cid => {
    if (!cid) return; const d = await GET('/api/clients/' + cid); quotes = d.quotes.filter(q => q.status === 'aceptada');
    $('#iq', f).innerHTML = String(optList(quotes, ctx.quote_id, quotes.length ? 'Seleccione…' : 'No hay cotizaciones aceptadas', q => `${q.number} — ${q.title} (${money(q.total)})`)); loadInst();
  };
  const loadInst = async () => {
    const qid = $('#iq', f).value; if (!qid) { $('#ii', f).innerHTML = '<option value="">Total de la cotización</option>'; preview(); return; }
    detail = await GET('/api/quotes/' + qid);
    $('#ii', f).innerHTML = String(raw('<option value="">Total de la cotización</option>' + detail.installments.map(i => `<option value="${i.id}">Cuota #${i.seq} — vence ${fdate(i.due_date)} — ${money(i.amount)}</option>`).join('')));
    preview();
  };
  const preview = () => {
    if (!detail) { $('#ipv', f).textContent = 'Seleccione una cotización.'; return; }
    const q = detail.quote; const ins = detail.installments.find(i => String(i.id) === $('#ii', f).value);
    const total = ins ? ins.amount : q.total; const itbis = r2(total * q.itbis / q.total); const exp = r2(total * q.expenses_total / q.total);
    $('#ipv', f).innerHTML = String(html`Subtotal gravado <b>${money(total - itbis - exp)}</b> · ITBIS <b>${money(itbis)}</b>${exp ? html` · Gastos <b>${money(exp)}</b>` : ''} · Total <b>${money(total)}</b>`);
  };
  if (clients.length) f.client_id.onchange = () => loadQuotes(f.client_id.value); else loadQuotes(ctx.client_id).catch(fail);
  $('#iq', f).onchange = () => loadInst().catch(fail); $('#ii', f).onchange = preview;
}
function noticesTable(rows) {
  return table([{ h: 'Fecha', v: r => html`<span class="nowrap">${fdt(r.created_at)}</span>` }, { h: 'Canal', v: r => r.channel === 'whatsapp' ? html`<span class="b ok">WhatsApp</span>` : html`<span class="b info">Correo</span>` },
    { h: 'Tipo', v: r => (NOTICE_TITLE[r.kind] || r.kind.replace(/_/g, ' ')) + (r.automatic ? ' (automático)' : '') }, { h: 'Para', v: r => r.to_addr },
    { h: 'Mensaje', v: r => html`<span class="small muted">${(r.message || '').slice(0, 140)}${(r.message || '').length > 140 ? '…' : ''}</span>` }, { h: 'Enviado por', v: r => r.sent_by_name || 'Sistema' }],
  rows, { empty: 'No se han enviado avisos.' });
}
route(/^\/facturas$/, async (el, _, q) => {
  const st = q.state || ''; const rows = await GET('/api/invoices?' + qs({ state: st }));
  const tot = rows.filter(r => r.status === 'emitida').reduce((a, r) => ({ total: a.total + r.total, pend: a.pend + r.state.balance }), { total: 0, pend: 0 });
  el.innerHTML = String(html`${head('Facturas', 'Generación de facturas, estado de pago y avisos al cliente.', can('admin', 'cobros') ? html`<button class="btn primary" data-act="new">🧾 Generar factura</button>` : '')}
    <div class="tabs">${INV_FILTERS.map(([k, l]) => html`<a href="#/facturas${k ? '?state=' + k : ''}" class="${st === k ? 'active' : ''}">${l}</a>`)}</div>
    <div class="kpis"><div class="kpi"><div class="v">${rows.length}</div><div class="l">Facturas en la vista</div></div><div class="kpi"><div class="v" style="font-size:1.2rem">${money(tot.total)}</div><div class="l">Total facturado</div></div>
      <div class="kpi gold"><div class="v" style="font-size:1.2rem">${money(tot.pend)}</div><div class="l">Pendiente de cobro</div></div></div>
    <div class="card flush">${invoicesTable(rows)}</div>
    <p class="small muted">La factura PDF es válida para fines fiscales solo si su número (NCF o e-CF) fue autorizado por la DGII. Desde 2026 la facturación electrónica (e-CF) es obligatoria: registre aquí el rango e-CF asignado o emita el e-CF oficial en su sistema autorizado y use esta factura como soporte de cobro.</p>`);
  act(el, { new: () => invoiceModal(), ...invActs() });
}, ['admin', 'cobros', 'expedientes']);
route(/^\/mis-facturas$/, async el => {
  const d = await GET('/api/portal');
  el.innerHTML = String(html`${head('Facturas', 'Estado de sus facturas con LegalTax Consultores.')}<div class="card flush">${table([{ h: 'Factura', v: r => html`<b>${r.number}</b><div class="small muted">${r.description}</div>` },
    { h: 'Emisión', v: r => fdate(r.issue_date) }, { h: 'Vence', v: r => fdate(r.due_date) }, { h: 'Total', num: true, v: r => money(r.total) }, { h: 'Pendiente', num: true, v: r => money(r.state.balance) },
    { h: 'Estado', v: r => html`<span class="b ${r.state.tone}">${r.state.label}</span>` }, { h: '', v: r => r.gendoc_id ? html`<span class="actions"><button class="btn sm" data-gd="${r.gendoc_id}">Ver</button><a class="btn sm primary" href="/api/gendocs/${r.gendoc_id}/pdf">Descargar</a></span>` : '' }],
  d.invoices, { empty: 'No tiene facturas.' })}</div>`);
  bindGendocs(el);
}, ['cliente']);

// ───── administración
route(/^\/admin$/, async (el, _, q) => {
  const tab = q.tab || 'usuarios';
  const tabs = [['usuarios', 'Usuarios y roles'], ['membrete', 'Membrete y logo'], ['plantillas', 'Plantillas'], ['numeracion', 'Numeración'], ['correo', 'Correo'], ['tipos', 'Tipos de documento'], ['auditoria', 'Auditoría'], ['respaldo', 'Copias de seguridad']];
  let body = ''; let data;
  if (tab === 'usuarios') { data = await GET('/api/users'); body = html`<div class="actions" style="margin-bottom:12px"><button class="btn primary" data-act="newuser">+ Nuevo usuario del equipo</button></div><div class="card flush">${table([
    { h: 'Nombre', v: r => html`<b>${r.name}</b><div class="small muted">${r.email}</div>` }, { h: 'Rol', v: r => html`${L.role[r.role]}${r.client_name ? html`<div class="small muted">${r.client_name}</div>` : ''}` },
    { h: 'Estado', v: r => !r.active ? html`<span class="b bad">Inactivo</span>` : r.activated ? html`<span class="b ok">Activo</span>` : html`<span class="b warn">Invitado</span>` }, { h: 'Último acceso', v: r => fdt(r.last_login) || '—' },
    { h: '', v: r => html`<span class="actions"><button class="btn sm" data-act="reinvite" data-id="${r.id}">Enlace de acceso</button>${r.role !== 'cliente' ? html`<button class="btn sm" data-act="role" data-id="${r.id}" data-role="${r.role}">Cambiar rol</button>` : ''}<button class="btn sm ${r.active ? 'danger' : ''}" data-act="active" data-id="${r.id}" data-v="${r.active ? '' : '1'}">${r.active ? 'Desactivar' : 'Activar'}</button></span>` }], data)}</div>
    <div class="card small"><h3>Permisos por rol</h3><ul style="margin:0;padding-left:18px"><li><b>Administración:</b> todo, incluidos usuarios, plantillas, membrete, numeración y auditoría.</li>
    <li><b>Equipo de expedientes:</b> clientes, expedientes, actuaciones, archivos, agenda, solicitudes, cotizaciones e informes.</li>
    <li><b>Cobros:</b> cotizaciones, validación y rechazo de vouchers, recibos, anulaciones, estados de cuenta y cuentas por cobrar.</li>
    <li><b>Cliente:</b> solo sus casos publicados, cotizaciones, cuotas, vouchers, solicitudes y PDF compartidos.</li></ul></div>`; }
  if (!['usuarios', 'auditoria', 'respaldo', 'correo', 'tipos'].includes(tab)) data = await GET('/api/settings');
  if (tab === 'tipos') {
    data = await GET('/api/doc-types?all=1');
    body = html`<div class="card"><form id="dtf" class="filters"><label class="f">Nuevo tipo de documento<input name="name" required placeholder="Ej.: Certificación de la TSS"></label>
      <label class="f">Categoría<select name="category">${opts(L.cat, 'otro')}</select></label><div><button class="btn primary">Agregar</button></div></form></div>
      <div class="card flush">${table([{ h: 'Tipo', v: r => html`<input data-k="name" value="${r.name}">` }, { h: 'Categoría', v: r => html`<select data-k="category">${opts(L.cat, r.category)}</select>` },
        { h: 'Activo', v: r => html`<input type="checkbox" data-k="active" ${r.active ? 'checked' : ''} style="width:auto">` }, { h: '', v: r => html`<button class="btn sm primary" data-act="savetype" data-id="${r.id}">Guardar</button>` }], data, { cls: '' })}</div>
      <p class="small muted">Los tipos inactivos dejan de aparecer al subir documentos, pero los documentos ya clasificados los conservan.</p>`;
  }
  if (tab === 'correo') {
    const [cfg, log] = await Promise.all([GET('/api/email/config'), GET('/api/email/log')]); state.mail = cfg;
    body = html`<div class="grid g2"><div class="card"><h2>Cuenta de envío ${cfg.configured ? html`<span class="b ok">Configurado</span>` : html`<span class="b warn">Falta la contraseña</span>`}</h2>
      ${cfg.from_env ? html`<div class="alert info">La cuenta SMTP está definida en el servidor (variables de entorno).</div>` : ''}
      <form id="mf"><div class="row"><label class="f">Correo que envía (usuario Gmail)<input name="user" value="${cfg.user}"></label><label class="f">Nombre del remitente<input name="from_name" value="${cfg.from_name}"></label></div>
      <label class="f">Contraseña de aplicación de Gmail ${cfg.has_password ? html`<span class="b ok">guardada</span>` : ''}<input name="pass" type="password" autocomplete="new-password" placeholder="${cfg.has_password ? 'Déjelo vacío para conservar la actual' : '16 caracteres, p. ej. abcd efgh ijkl mnop'}"></label>
      <details style="margin:10px 0"><summary class="small">Servidor avanzado (por defecto Gmail)</summary><div class="row" style="margin-top:8px"><label class="f">Servidor SMTP<input name="host" value="${cfg.host}"></label><label class="f">Puerto<input name="port" type="number" value="${cfg.port}"></label><label class="chk"><input type="checkbox" name="secure" ${cfg.secure ? 'checked' : ''}> SSL/TLS</label></div></details>
      <h3 style="margin-top:14px">Correo del despacho</h3>
      <label class="f">Dirección que recibe reportes y avisos<input name="inbox" value="${cfg.inbox}"></label>
      <label class="chk" style="margin-top:10px"><input type="checkbox" name="notify_events" ${cfg.notify_events ? 'checked' : ''}> Avisarme cuando un cliente sube un voucher, acepta o rechaza una cotización o envía un documento</label>
      <label class="chk" style="margin-top:6px"><input type="checkbox" name="daily_report" ${cfg.daily_report ? 'checked' : ''}> Enviar el reporte diario automáticamente (lunes a sábado)</label>
      <label class="f" style="margin-top:6px;max-width:180px">Hora del reporte diario y recordatorios<input type="time" name="daily_time" value="${cfg.daily_time}"></label>
      <h3 style="margin-top:14px">Avisos automáticos a los clientes</h3>
      <label class="chk"><input type="checkbox" name="client_receipts" ${cfg.client_receipts ? 'checked' : ''}> Aviso de pago recibido con el recibo PDF, al validar un pago</label>
      <label class="chk" style="margin-top:6px"><input type="checkbox" name="client_invoices" ${cfg.client_invoices ? 'checked' : ''}> Marcar por defecto “enviar aviso de factura generada” al facturar</label>
      <label class="chk" style="margin-top:6px"><input type="checkbox" name="client_reminders" ${cfg.client_reminders ? 'checked' : ''}> Recordatorios de pago automáticos (lunes a sábado)</label>
      <div class="row" style="margin-top:6px"><label class="f">Días antes del vencimiento<input type="number" min="0" max="30" name="reminder_days" value="${cfg.reminder_days ?? 3}"></label>
      <label class="chk" style="align-self:end"><input type="checkbox" name="overdue_reminders" ${cfg.overdue_reminders !== false ? 'checked' : ''}> Avisar también cuando una cuota se vence</label></div>
      <label class="f">Dirección pública del portal (para los enlaces en los avisos automáticos)<input name="portal_url" value="${cfg.portal_url || ''}" placeholder="https://portal.legaltax.do/"></label>
      <div class="actions" style="margin-top:12px"><button class="btn primary">Guardar</button><button type="button" class="btn" data-act="mtest">Enviar correo de prueba</button></div></form></div>
      <div class="card small"><h2>Cómo obtener la contraseña de aplicación de Gmail</h2><ol style="padding-left:18px;margin:0;line-height:1.7">
        <li>Inicie sesión en <b>legaltax.consultores@gmail.com</b>.</li><li>Active la <b>verificación en 2 pasos</b> en <i>Cuenta de Google → Seguridad</i>.</li>
        <li>Abra <i>Cuenta de Google → Seguridad → Contraseñas de aplicaciones</i> (myaccount.google.com/apppasswords).</li>
        <li>Cree una con el nombre “LegalTax” y copie los 16 caracteres.</li><li>Péguelos aquí, guarde y pulse <b>Enviar correo de prueba</b>.</li></ol>
        <p class="muted">No use la contraseña normal de Gmail: Google la rechaza para aplicaciones. La contraseña de aplicación se guarda cifrada y nunca se muestra.</p>
        <h3 style="margin-top:12px">Qué se puede enviar</h3><ul style="padding-left:18px;margin:0;line-height:1.7"><li>Cualquier PDF emitido (botón ✉ en el visor y en el detalle).</li><li>Cualquier consulta o reporte en Excel (Consultas → ✉).</li><li>El reporte del día (Inicio → ✉), manual o automático.</li><li>Avisos automáticos de la actividad de los clientes.</li><li>Avisos al cliente: pago, pago recibido, factura generada, estado de factura y documentos (por correo o WhatsApp).</li></ul></div></div>
      <div class="card flush"><h2>Correos enviados</h2>${table([{ h: 'Fecha', v: r => html`<span class="nowrap">${fdt(r.created_at)}</span>` }, { h: 'Para', v: r => html`${r.to_addr}${r.cc_addr ? html`<div class="small muted">CC: ${r.cc_addr}</div>` : ''}` },
        { h: 'Asunto', v: r => html`${r.subject}<div class="small muted">${(r.attachments || []).filter(a => a !== 'logo.png').join(', ')}</div>` }, { h: 'Enviado por', v: r => r.sent_by_name || 'Automático' },
        { h: 'Estado', v: r => r.status === 'enviado' ? html`<span class="b ok">Enviado</span>` : html`<span class="b bad">${r.status === 'error' ? 'Error' : 'No enviado'}</span><div class="small">${r.error || ''}</div>` }], log, { empty: 'Aún no se han enviado correos.' })}</div>`;
  }
  if (tab === 'membrete') { const f = data.firm; body = html`<div class="grid g2"><div class="card"><h2>Datos del membrete</h2><form id="ff">
      <label class="f">Nombre del despacho<input name="firm_name" value="${f.firm_name || ''}"></label><label class="f" style="margin-top:8px">Lema<input name="tagline" value="${f.tagline || ''}"></label>
      <div class="row" style="margin-top:8px"><label class="f">RNC<input name="rnc" value="${f.rnc || ''}"></label><label class="f">Teléfono<input name="phone" value="${f.phone || ''}"></label></div>
      <div class="row"><label class="f">Correo<input name="email" value="${f.email || ''}"></label><label class="f">Sitio web<input name="website" value="${f.website || ''}"></label></div>
      <label class="f">Dirección<input name="address" value="${f.address || ''}"></label><label class="f" style="margin-top:8px">Pie de página<textarea name="footer">${f.footer || ''}</textarea></label>
      <button class="btn primary" style="margin-top:10px">Guardar</button></form></div>
    <div class="card"><h2>Logo</h2>${f.logo_key ? html`<img src="/api/firm-logo?t=${Date.now()}" alt="Logo" style="max-width:220px;max-height:90px;border:1px solid var(--line);padding:6px;border-radius:6px">` : html`<img src="/brand/logo.png" alt="Logo" style="max-width:220px;max-height:110px"><p class="muted small">Logo oficial de LegalTax Consultores. Puede reemplazarlo subiendo otro.</p>`}
      <form id="lgf" style="margin-top:12px"><label class="f">Subir logo (PNG o JPG)<input type="file" name="file" accept="image/png,image/jpeg" required></label><div class="actions" style="margin-top:8px"><button class="btn primary">Subir</button>${f.logo_key ? html`<button type="button" class="btn danger" data-act="rmlogo">Quitar logo</button>` : ''}</div></form>
      <div class="actions" style="margin-top:16px"><button class="btn" data-act="sample">Vista previa de membrete</button></div></div></div>`; }
  if (tab === 'plantillas') body = html`<div class="alert info">Puede usar los campos <code>{cliente}</code>, <code>{expediente}</code>, <code>{numero}</code>, <code>{fecha}</code>, <code>{monto}</code> y <code>{despacho}</code>; se completan automáticamente al generar el PDF.</div>
    ${data.templates.map(t => html`<div class="card"><h2>${L.doc[t.doc_type]}</h2><form data-tpl="${t.doc_type}"><label class="f">Título del documento<input name="title" value="${t.title}"></label>
      <div class="row" style="margin-top:8px"><label class="f">Introducción<textarea name="intro">${t.intro}</textarea></label><label class="f">Cierre<textarea name="closing">${t.closing}</textarea></label>
      ${t.doc_type === 'cotizacion' ? html`<label class="f">Condiciones<textarea name="terms">${t.terms}</textarea></label>` : ''}</div><button class="btn sm primary">Guardar plantilla</button> <span class="small muted">Actualizada ${fdt(t.updated_at)}</span></form></div>`)}`;
  if (tab === 'numeracion') body = html`<div class="card flush">${table([{ h: 'Documento', v: r => r.label }, { h: 'Prefijo', v: r => html`<input data-k="prefix" value="${r.prefix}" style="max-width:110px">` },
    { h: 'Siguiente número', v: r => html`<input data-k="next_number" type="number" min="1" value="${r.next_number}" style="max-width:110px">` }, { h: 'Dígitos', v: r => html` <input data-k="padding" type="number" min="1" max="13" value="${r.padding}" style="max-width:80px">` },
    { h: 'Reinicia cada año', v: r => html`<input data-k="yearly" type="checkbox" ${r.yearly ? 'checked' : ''} style="width:auto">` },
    { h: 'Guion', v: r => html`<input data-k="sep" type="checkbox" ${r.sep !== '' ? 'checked' : ''} style="width:auto">` },
    { h: 'Autorizado hasta No.', v: r => html`<input data-k="max_number" type="number" value="${r.max_number || ''}" style="max-width:120px" placeholder="sin límite">` },
    { h: 'Vence', v: r => html`<input data-k="valid_until" type="date" value="${r.valid_until || ''}" style="max-width:150px">` },
    { h: 'Ejemplo', v: r => { const sp = r.sep ?? '-'; return `${r.prefix}${sp}${r.yearly ? new Date().getFullYear() + sp : ''}${String(r.next_number).padStart(r.padding, '0')}`; } },
    { h: '', v: r => html`<button class="btn sm primary" data-act="seq" data-t="${r.doc_type}">Guardar</button>` }], data.sequences, { cls: '' })}</div>`;
  if (tab === 'auditoria') { data = await GET('/api/audit?' + qs({ q: q.q })); body = html`<div class="card"><form id="af" class="filters"><label class="f">Usuario, acción o entidad<input name="q" value="${q.q || ''}"></label><div><button class="btn">Filtrar</button></div></form></div>
    <div class="card flush">${table([{ h: 'Fecha', v: r => html`<span class="nowrap">${fdt(r.created_at)}</span>` }, { h: 'Usuario', v: r => html`${r.user_name}<div class="small muted">${L.role[r.role] || r.role}</div>` },
      { h: 'Acción', v: r => html`<b>${r.action.replace(/_/g, ' ')}</b>` }, { h: 'Registro', v: r => `${r.entity.replace(/_/g, ' ')} ${r.entity_id || ''}` }, { h: 'Cliente', v: r => r.client_name || '' },
      { h: 'Detalle', v: r => html`<span class="small muted">${r.details ? JSON.stringify(r.details).slice(0, 160) : ''}</span>` }, { h: 'IP', v: r => html`<span class="small">${r.ip || ''}</span>` }], data)}</div>`; }
  if (tab === 'respaldo') body = html`<div class="card"><h2>Copias de seguridad</h2><p>Las copias incluyen la base de datos completa (<code>pg_dump</code>) y la carpeta privada de archivos. Se ejecutan en el servidor:</p>
    <pre style="background:#0E1D38;color:#E6EAF2;padding:12px;border-radius:8px;overflow:auto">npm run backup                 # crea backups/legaltax-AAAAMMDD-HHMM.tar.gz
npm run restore -- backups/legaltax-AAAAMMDD-HHMM.tar.gz</pre>
    <p class="small muted">Recomendación: programe <code>npm run backup</code> diariamente (cron) y copie la carpeta <code>backups/</code> a un almacenamiento externo cifrado. Pruebe la restauración al menos una vez al mes en un servidor de prueba. Ver <code>README.md</code>.</p></div>`;
  el.innerHTML = String(html`${head('Configuración', 'Solo Administración.')}<div class="tabs">${tabs.map(([k, l]) => html`<a href="#/admin?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`)}</div>${body}`);
  const ff = $('#ff'); if (ff) ff.onsubmit = async e => { e.preventDefault(); try { await PUT('/api/settings/firm', formData(ff)); toast('Membrete actualizado'); const m = await GET('/api/me'); state.firm = m.firm; } catch (err) { fail(err); } };
  const lgf = $('#lgf'); if (lgf) lgf.onsubmit = async e => { e.preventDefault(); try { await api('POST', '/api/settings/logo', new FormData(lgf)); toast('Logo actualizado'); state.firm.has_logo = true; $('#shell')?.remove(); render(); } catch (err) { fail(err); } };
  $$('[data-tpl]', el).forEach(f => f.onsubmit = async e => { e.preventDefault(); try { await PUT('/api/templates/' + f.dataset.tpl, formData(f)); toast('Plantilla guardada'); } catch (err) { fail(err); } });
  const dtf = $('#dtf'); if (dtf) dtf.onsubmit = async e => { e.preventDefault(); try { await POST('/api/doc-types', formData(dtf)); state.docTypes = await GET('/api/doc-types'); toast('Tipo agregado'); render(); } catch (err) { fail(err); } };
  const mf = $('#mf'); if (mf) mf.onsubmit = async e => { e.preventDefault(); const d = formData(mf); if (!d.pass) delete d.pass; try { await PUT('/api/email/config', d); toast('Configuración de correo guardada'); render(); } catch (err) { fail(err); } };
  const af = $('#af'); if (af) af.onsubmit = e => { e.preventDefault(); go('#/admin?tab=auditoria&' + qs(formData(af))); };
  act(el, {
    newuser: () => modal('Nuevo usuario del equipo', html`<div class="row"><label class="f">Nombre<input name="name" required></label><label class="f">Correo<input name="email" type="email" required></label></div>
      <label class="f">Rol<select name="role">${opts({ admin: 'Administración', expedientes: 'Equipo de expedientes', cobros: 'Cobros' }, 'expedientes')}</select></label>`,
    { submit: async d => { const r = await POST('/api/users', d); showLink(r.invite_link); state.staff = await GET('/api/staff'); render(); } }),
    reinvite: async d => { if (!confirm('Se generará un enlace nuevo para crear o restablecer la contraseña. ¿Continuar?')) return; const r = await POST(`/api/users/${d.id}/invite`, { reset: false }); showLink(r.invite_link); },
    role: d => modal('Cambiar rol', html`<select name="role">${opts({ admin: 'Administración', expedientes: 'Equipo de expedientes', cobros: 'Cobros' }, d.role)}</select>`, { submit: async x => { await PATCH('/api/users/' + d.id, x); render(); } }),
    active: async d => { await PATCH('/api/users/' + d.id, { active: !!d.v }); render(); },
    mtest: async () => { const to = prompt('¿A qué correo envío la prueba?', state.mail?.inbox || ''); if (!to) return; await POST('/api/email/test', { to }); toast('Correo de prueba enviado a ' + to); render(); },
    savetype: async (d, b) => { const tr = b.closest('tr'); const v = k => $(`[data-k=${k}]`, tr); await PATCH('/api/doc-types/' + d.id, { name: v('name').value, category: v('category').value, active: v('active').checked }); state.docTypes = await GET('/api/doc-types'); toast('Tipo guardado'); },
    rmlogo: async () => { await api('DELETE', '/api/settings/logo'); state.firm.has_logo = false; $('#shell')?.remove(); render(); },
    sample: async () => { const cl = (await GET('/api/clients'))[0]; if (!cl) return toast('Registre un cliente para ver la vista previa', true); previewPdf('ficha_cliente', { client_id: cl.id }); },
    seq: async (d, b) => { const tr = b.closest('tr'); const v = k => $(`[data-k=${k}]`, tr); await PUT('/api/sequences/' + d.t, { prefix: v('prefix').value, next_number: v('next_number').value, padding: v('padding').value, yearly: v('yearly').checked, sep: v('sep').checked, max_number: v('max_number').value, valid_until: v('valid_until').value }); toast('Numeración guardada'); render(); },
  });
}, ['admin']);

// ═════════════════════════ PORTAL DEL CLIENTE
async function portalHome(el) {
  const d = await GET('/api/portal'); state.portal = d;
  const acc = d.account; const next = acc.installments.find(i => i.balance > 0);
  const pendQ = d.quotes.filter(q => q.status === 'publicada'); const pendR = d.requests.filter(r => r.status !== 'recibida');
  el.innerHTML = String(html`${head(`Hola, ${state.me.name.split(' ')[0]}`, d.client.name + ' · ' + L.idt[d.client.id_type] + ' ' + d.client.id_number)}
    <div class="hero-card"><div class="row3"><div><div class="l">Saldo pendiente</div><div class="big" id="saldo">${money(acc.totals.balance)}</div></div>
      <div><div class="l">Vencido</div><div class="big" style="font-size:1.4rem">${money(acc.totals.overdue)}</div></div>
      <div><div class="l">Próxima cuota</div><div class="big" style="font-size:1.4rem">${next ? fdate(next.due_date) : '—'}</div>${next ? html`<div class="l">${money(next.balance)}</div>` : ''}</div></div>
      <div class="actions" style="margin-top:14px"><a class="btn gold" href="#/mis-pagos">Ver cuotas y subir voucher</a></div></div>
    ${pendQ.length ? html`<div class="alert warn">Tiene ${pendQ.length} cotización(es) pendiente(s) de aceptación. <a href="#/mis-cotizaciones">Revisar →</a></div>` : ''}
    ${pendR.length ? html`<div class="alert info">El despacho le ha solicitado ${pendR.length} documento(s). <a href="#/mis-solicitudes">Responder →</a></div>` : ''}
    <div class="card flush"><h2>Mis casos</h2>${d.cases.length ? html`${d.cases.map(c => html`<a class="item" href="#/mis-casos/${c.id}" style="color:inherit;text-decoration:none"><div><div class="t">${c.code} · ${c.title}</div>
      <div class="s">${c.institution || ''} ${c.official_number ? '· ' + c.official_number : ''}</div><div class="s">${c.public_status || L.caseStatus[c.status]}</div></div><div class="small muted">Actualizado ${fdate(c.last_update)}</div></a>`)}` : html`<div class="empty">No hay casos.</div>`}</div>`);
}
route(/^\/mis-casos$/, async el => {
  const d = await GET('/api/portal');
  el.innerHTML = String(html`${head('Mis casos')}<div class="card flush">${d.cases.map(c => html`<a class="item" href="#/mis-casos/${c.id}" style="color:inherit;text-decoration:none"><div><div class="t">${c.code} · ${c.title}</div><div class="s">${c.institution || ''} ${c.official_number || ''} · Períodos: ${c.fiscal_periods || '—'}</div></div><div>${c.public_status ? html`<span class="b info">${c.public_status}</span>` : badge('caseStatus', c.status)}</div></a>`)}${d.cases.length ? '' : html`<div class="empty">No hay casos.</div>`}</div>`);
}, ['cliente']);
route(/^\/mis-casos\/(\d+)$/, async (el, [id]) => {
  const d = await GET('/api/portal/cases/' + id); const c = d.case;
  el.innerHTML = String(html`${head(`${c.code} · ${c.title}`, c.public_status || L.caseStatus[c.status], '', html`<a href="#/mis-casos">Mis casos</a> ›`)}
    <div class="card"><dl class="dl"><div><dt>Institución</dt><dd>${c.institution || '—'}</dd></div><div><dt>No. oficial</dt><dd>${c.official_number || '—'}</dd></div><div><dt>Períodos fiscales</dt><dd>${c.fiscal_periods || '—'}</dd></div>
      <div><dt>Próximo paso</dt><dd>${c.next_action || '—'} ${c.next_action_date ? '(' + fdate(c.next_action_date) + ')' : ''}</dd></div></dl></div>
    <div class="grid g2"><div class="card"><h2>Actualizaciones</h2><ul class="tl">${d.events.map(e => html`<li><div class="meta">${fdate(e.event_date)} <span class="b">${L.event[e.kind]}</span></div><div class="t">${e.title}</div>${e.description ? html`<div class="d">${e.description}</div>` : ''}${e.document_id ? html`<a class="small" href="/api/files/${e.document_id}?inline=1" target="_blank" rel="noopener">📎 Ver documento</a>` : ''}</li>`)}</ul>${d.events.length ? '' : html`<div class="empty">Sin actualizaciones publicadas.</div>`}</div>
    <div><div class="card flush"><h2>Documentos del caso</h2>${docsTable(d.documents, false)}</div><div class="card flush"><h2>PDF del despacho</h2>${portalGd(d.gendocs)}</div></div></div>`);
  bindGendocs(el);
}, ['cliente']);
function portalGd(rows) {
  return table([{ h: 'Documento', v: r => html`<b>${L.doc[r.doc_type]} ${r.number}</b>${r.version > 1 ? html` <span class="b">v${r.version}</span>` : ''}<div class="small muted">${r.title}</div>` }, { h: 'Fecha', v: r => fdate(r.created_at) },
    { h: 'Estado', v: r => r.status === 'anulado' ? badge('gd', 'anulado') : '' }, { h: '', v: r => html`<span class="actions"><button class="btn sm" data-gd="${r.id}">Ver</button><a class="btn sm primary" href="/api/gendocs/${r.id}/pdf">Descargar</a></span>` }], rows, { empty: 'No hay documentos compartidos.' });
}
route(/^\/mis-cotizaciones$/, async el => {
  const d = await GET('/api/portal');
  el.innerHTML = String(html`${head('Cotizaciones', 'Revise y acepte las propuestas de servicios del despacho.')}<div class="card flush">${table([{ h: 'Número', v: r => html`<b>${r.number}</b>` }, { h: 'Servicio', v: r => r.title }, { h: 'Total', num: true, v: r => money(r.total) }, { h: 'Estado', v: r => badge('quote', r.status) }, { h: '', v: r => html`<a class="btn sm ${r.status === 'publicada' ? 'gold' : ''}" href="#/mis-cotizaciones/${r.id}">${r.status === 'publicada' ? 'Revisar y aceptar' : 'Ver'}</a>` }], d.quotes, { empty: 'No tiene cotizaciones.' })}</div>`);
}, ['cliente']);
route(/^\/mis-cotizaciones\/(\d+)$/, async (el, [id]) => {
  const d = await GET('/api/portal/quotes/' + id); const q = d.quote; const cur = d.gendocs.find(g => g.status === 'vigente') || d.gendocs[0];
  el.innerHTML = String(html`${head(`${q.number} · ${q.title}`, badge('quote', q.status), html`${cur ? html`<button class="btn" data-gd="${cur.id}">Ver PDF</button><a class="btn" href="/api/gendocs/${cur.id}/pdf">Descargar PDF</a>` : ''}`, html`<a href="#/mis-cotizaciones">Cotizaciones</a> ›`)}
    ${q.status === 'publicada' ? html`<div class="card" style="border-color:var(--gold)"><h2>¿Acepta esta propuesta?</h2><p class="small muted">Al aceptar, se activará el plan de cuotas indicado abajo. Quedará registrada la fecha, hora y usuario.</p>
      <div class="actions"><button class="btn gold" data-act="accept">✓ Aceptar cotización</button><button class="btn danger" data-act="reject">Rechazar</button></div></div>` : ''}
    ${q.status === 'aceptada' ? html`<div class="alert ok">Aceptada el ${fdt(q.accepted_at)}.</div>` : ''}
    <div class="card"><h2>Alcance</h2><div style="white-space:pre-wrap">${q.scope}</div></div>
    <div class="grid g2"><div class="card flush"><h2>Detalle</h2>${table([{ h: 'Concepto', v: r => r.description }, { h: 'Monto', num: true, v: r => money(r.amount) }], d.items, {
      foot: html`<tfoot><tr><td>Subtotal honorarios</td><td class="num">${money(q.subtotal)}</td></tr><tr><td>ITBIS</td><td class="num">${money(q.itbis)}</td></tr><tr><td>Total</td><td class="num">${money(q.total)}</td></tr></tfoot>`, cls: '' })}</div>
    <div class="card flush"><h2>Plan de cuotas</h2>${table([{ h: 'Cuota', v: r => '#' + r.seq }, { h: 'Vence', v: r => fdate(r.due_date) }, { h: 'Monto', num: true, v: r => money(r.amount) }], d.installments, { cls: '' })}</div></div>`);
  bindGendocs(el);
  act(el, {
    accept: async () => { if (!confirm(`¿Confirma la aceptación de la cotización ${q.number} por ${money(q.total)}?`)) return; await POST(`/api/portal/quotes/${id}/accept`, { decision: 'aceptar' }); toast('¡Gracias! Cotización aceptada.'); render(); },
    reject: () => modal('Rechazar cotización', html`<label class="f">Comentario (opcional)<textarea name="note"></textarea></label>`, { submitLabel: 'Rechazar', submit: async x => { await POST(`/api/portal/quotes/${id}/accept`, { decision: 'rechazar', note: x.note }); render(); } }),
  });
}, ['cliente']);
route(/^\/mis-pagos$/, async el => {
  const d = await GET('/api/portal');
  const accepted = d.quotes.filter(q => q.status === 'aceptada');
  el.innerHTML = String(html`${head('Cuotas y pagos', 'Los comprobantes quedan pendientes hasta que Cobros los valida.', accepted.length ? html`<button class="btn gold" data-act="upload">⇪ Subir voucher</button>` : '')}${accountBlock(d.account, d.payments, false)}`);
  act(el, { upload: () => paymentModal({ quotes: accepted, quote_id: accepted.length === 1 ? accepted[0].id : '' }, true), ...payActs() });
}, ['cliente']);
route(/^\/mis-solicitudes$/, async el => {
  const d = await GET('/api/portal');
  el.innerHTML = String(html`${head('Solicitudes de documentos', 'Documentos que el despacho necesita de usted.')}
    <div class="card flush">${d.requests.map(r => html`<div class="item"><div style="min-width:0;flex:1"><div class="t">${r.title} ${badge('req', r.status)}</div><div class="s">${r.description || ''}</div>
      <div class="s">Entregar antes del ${fdate(r.due_date) || '—'} ${r.case_code ? '· ' + r.case_code : ''} ${r.files ? `· ${r.files} archivo(s) enviado(s)` : ''}</div>
      ${r.status === 'devuelta' ? html`<div class="alert bad" style="margin:6px 0 0">Corrección solicitada: ${r.staff_note}</div>` : ''}</div>
      ${r.status !== 'recibida' ? html`<button class="btn sm gold" data-act="resp" data-id="${r.id}" data-t="${r.title}">⇪ Enviar documento</button>` : ''}</div>`)}${d.requests.length ? '' : html`<div class="empty">No hay solicitudes.</div>`}</div>`);
  act(el, { resp: x => modal('Enviar: ' + x.t, html`<label class="f">Archivo<input type="file" name="file" required></label><label class="f" style="margin-top:8px">Comentario (opcional)<input name="note"></label>`,
    { submitLabel: 'Enviar', submit: async (_, f) => { await api('POST', `/api/portal/requests/${x.id}/respond`, new FormData(f)); toast('Documento enviado al despacho'); render(); } }) });
}, ['cliente']);
route(/^\/mis-documentos$/, async el => {
  const d = await GET('/api/portal');
  el.innerHTML = String(html`${head('Mis documentos')}<div class="card flush"><h2>PDF emitidos por el despacho</h2>${portalGd(d.gendocs)}</div><div class="card flush"><h2>Archivos compartidos y enviados</h2>${docsTable(d.documents, false)}</div>`);
  bindGendocs(el);
}, ['cliente']);

// ── sincronización: si otra persona del equipo cambia algo, la pantalla se actualiza sola
setInterval(async () => {
  if (!state.me || state.me.role === 'cliente' || document.hidden) return;
  try {
    const r = await GET('/api/sync');
    if (syncLast !== null && r.last !== syncLast) {
      const busy = $('#modal-root').children.length || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      if (busy) return; // se reintenta en el próximo ciclo sin perder el cambio
      const y = window.scrollY; await render({ silent: true }); window.scrollTo(0, y);
    }
    syncLast = r.last;
  } catch (_) { /* sin conexión: se reintenta */ }
}, 15000);
boot();
