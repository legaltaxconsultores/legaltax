process.env.TZ = 'America/Santo_Domingo';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const multer = require('multer');
const ExcelJS = require('exceljs');
const { pool, withCtx, SYSTEM } = require('./db');
const S = require('./services');
const M = require('./mailer');
const { money, dateStr, dateTimeStr } = require('./format');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-src 'self' blob:; object-src 'self' blob:" });
  next();
});
app.use(express.json({ limit: '2mb' }));
app.use(session({
  store: new PgStore({ pool, createTableIfMissing: true }),
  name: 'lt.sid',
  secret: process.env.SESSION_SECRET || 'cambie-este-secreto-en-produccion',
  resave: false, saveUninitialized: false, rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === '1', maxAge: 1000 * 60 * 60 * 8 },
}));
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));
// App móvil del equipo: autenticación con token "Bearer" por dispositivo (se guarda cifrado en el teléfono)
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
app.use('/api', async (req, res, next) => {
  const h = req.get('authorization') || '';
  if (!h.startsWith('Bearer ')) return next();
  try {
    const r = await pool.query(`UPDATE api_tokens t SET last_used = now() FROM users u
      WHERE t.token_hash = $1 AND NOT t.revoked AND t.expires_at > now() AND u.id = t.user_id AND u.active
      RETURNING u.id, u.name, u.email, u.role, u.client_id`, [sha(h.slice(7).trim())]);
    if (r.rows[0]) req.tokenUser = r.rows[0];
  } catch (_) { /* token inválido: se trata como sin sesión */ }
  next();
});


const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain'];
const upload = multer({ dest: path.join(S.STORAGE, 'tmp'), limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (req, f, cb) => cb(ALLOWED_MIME.includes(f.mimetype) ? null : S.httpError(415, 'Tipo de archivo no permitido. Use PDF, imagen u Office.'), ALLOWED_MIME.includes(f.mimetype)) });

// ───────── utilidades
const STAFF = ['admin', 'expedientes', 'cobros'];
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const auth = (...roles) => (req, res, next) => {
  const u = req.session.user || req.tokenUser;
  if (!u) return res.status(401).json({ error: 'Sesión no iniciada' });
  if (u.must_change) return res.status(403).json({ error: 'Debe cambiar su contraseña temporal antes de continuar.', must_change: true });
  if (roles.length && !roles.includes(u.role)) return res.status(403).json({ error: 'No tiene permiso para esta acción' });
  req.user = u; next();
};
const db = (req, fn) => withCtx(req.user, fn);
const A = (c, req, action, entity, id, clientId, details) => S.audit(c, req.user, action, entity, id, clientId, details, req.ip);
const int = v => (v === undefined || v === null || v === '' ? null : parseInt(v, 10));
const str = v => (v === undefined || v === null ? null : String(v).trim() || null);
const need = (cond, msg, status = 400) => { if (!cond) throw S.httpError(status, msg); };
const pick = (o, keys) => keys.reduce((r, k) => (o[k] !== undefined ? ((r[k] = o[k] === '' ? null : o[k]), r) : r), {});
async function updateRow(c, table, id, fields) {
  const keys = Object.keys(fields); if (!keys.length) return null;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  return (await c.query(`UPDATE ${table} SET ${sets} WHERE id = $1 RETURNING *`, [id, ...keys.map(k => fields[k])])).rows[0];
}
function sendFile(res, abs, filename, mime, inline) {
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Archivo no disponible' });
  res.set('Content-Type', mime);
  const ascii = String(filename).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.set('Cache-Control', 'private, no-store');
  fs.createReadStream(abs).pipe(res);
}

// ───────── autenticación
const attempts = new Map();
// ───────── inicio de sesión: por correo o nombre de usuario, con mensajes claros y bloqueo temporal
const MAX_FAILS = 5, LOCK_MIN = 15;
const findUser = id => pool.query('SELECT * FROM users WHERE lower(email) = $1 OR lower(username) = $1 ORDER BY (lower(email) = $1) DESC LIMIT 1', [id]).then(r => r.rows[0]);
const passwordProblem = pw => (pw.length < 8 ? 'La contraseña debe tener al menos 8 caracteres.' : !/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(pw) || !/\d/.test(pw) ? 'La contraseña debe combinar letras y números.' : null);
const hhmm = d => new Intl.DateTimeFormat('es-DO', { timeZone: 'America/Santo_Domingo', hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
app.post('/api/login', wrap(async (req, res) => {
  const id = String(req.body.email || req.body.identifier || '').trim().toLowerCase();
  const ipKey = 'ip|' + req.ip; const a = attempts.get(ipKey) || { n: 0, t: Date.now() };
  if (a.n >= 30 && Date.now() - a.t < 15 * 60e3) return res.status(429).json({ error: 'Demasiados intentos desde esta conexión. Espere 15 minutos.' });
  const fail = (status, error, extra = {}) => { attempts.set(ipKey, { n: a.n + 1, t: a.n === 0 ? Date.now() : a.t }); return res.status(status).json({ error, ...extra }); };
  if (!id || !req.body.password) return res.status(400).json({ error: 'Escriba su usuario o correo y su contraseña.', field: !id ? 'email' : 'password' });
  const u = await findUser(id);
  if (!u) return fail(401, 'No existe ningún usuario con ese correo o nombre de usuario. Revise que esté bien escrito.', { field: 'email' });
  if (!u.active) return fail(403, 'Su usuario está desactivado. Contacte a Administración.', { field: 'email' });
  if (u.locked_until && new Date(u.locked_until) > new Date()) return fail(429, `Por seguridad, su usuario está bloqueado hasta las ${hhmm(new Date(u.locked_until))} por varios intentos fallidos. Si olvidó su contraseña, pida a Administración que la restablezca.`, { field: 'password' });
  if (!u.password_hash) return fail(403, 'Su cuenta todavía no está activada. Abra el enlace de invitación que le enviaron o pida uno nuevo a Administración.', { field: 'email' });
  if (!(await bcrypt.compare(String(req.body.password), u.password_hash))) {
    const n = (u.failed_logins || 0) + 1;
    if (n >= MAX_FAILS) {
      await pool.query(`UPDATE users SET failed_logins = 0, locked_until = now() + interval '${LOCK_MIN} minutes' WHERE id = $1`, [u.id]);
      await withCtx(SYSTEM, c => S.audit(c, { id: u.id, name: u.name, role: u.role }, 'bloqueo_por_intentos', 'usuario', u.id, u.client_id, null, req.ip));
      return fail(429, `Contraseña incorrecta. Por seguridad, su usuario quedó bloqueado ${LOCK_MIN} minutos. Si olvidó su contraseña, pida a Administración que la restablezca.`, { field: 'password' });
    }
    await pool.query('UPDATE users SET failed_logins = $2 WHERE id = $1', [u.id, n]);
    return fail(401, `Contraseña incorrecta. Le ${MAX_FAILS - n === 1 ? 'queda 1 intento' : `quedan ${MAX_FAILS - n} intentos`} antes de un bloqueo temporal. Recuerde que distingue mayúsculas y minúsculas.`, { field: 'password' });
  }
  attempts.delete(ipKey);
  await pool.query('UPDATE users SET last_login = now(), failed_logins = 0, locked_until = NULL WHERE id = $1', [u.id]);
  const clientName = u.client_id ? (await withCtx(SYSTEM, c => c.query('SELECT name FROM clients WHERE id = $1', [u.client_id]))).rows[0]?.name : null;
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Error de sesión' });
    req.session.user = { id: u.id, name: u.name, email: u.email, username: u.username, role: u.role, client_id: u.client_id, must_change: !!u.must_change_password };
    req.session.clientName = clientName;
    // "Mantener la sesión iniciada": 30 días; si no, 8 horas
    req.session.cookie.maxAge = req.body.remember ? 30 * 864e5 : 8 * 3600e3;
    withCtx(req.session.user, c => S.audit(c, req.session.user, 'inicio_sesion', 'usuario', u.id, u.client_id, null, req.ip)).catch(() => {});
    res.json({ user: req.session.user });
  });
}));
// Cambiar la propia contraseña (obligatorio en el primer ingreso con contraseña temporal)
app.post('/api/account/password', (req, res, next) => (req.session.user || req.tokenUser ? next() : res.status(401).json({ error: 'Sesión no iniciada' })), wrap(async (req, res) => {
  const me = req.session.user || req.tokenUser;
  const u = (await pool.query('SELECT * FROM users WHERE id = $1', [me.id])).rows[0];
  need(u && (await bcrypt.compare(String(req.body.current || ''), u.password_hash || '')), 'La contraseña actual no es correcta.');
  const pw = String(req.body.password || ''); const prob = passwordProblem(pw); need(!prob, prob);
  need(pw !== req.body.current, 'La nueva contraseña debe ser distinta de la actual.');
  await pool.query('UPDATE users SET password_hash = $2, must_change_password = false, password_changed_at = now() WHERE id = $1', [u.id, await bcrypt.hash(pw, 10)]);
  if (req.session.user) req.session.user.must_change = false;
  await withCtx(SYSTEM, c => S.audit(c, { id: u.id, name: u.name, role: u.role }, 'cambiar_contrasena', 'usuario', u.id, u.client_id, null, req.ip));
  res.json({ ok: true, user: req.session.user });
}));
// ¿Olvidó su contraseña?: envía un enlace por correo si el correo está configurado
app.post('/api/password/forgot', wrap(async (req, res) => {
  const id = String(req.body.identifier || '').trim().toLowerCase(); need(id, 'Escriba su usuario o correo.');
  const u = await findUser(id);
  const generic = { ok: true, message: 'Si el usuario existe y tiene correo registrado, le enviamos un enlace para crear una nueva contraseña. Revise su bandeja de entrada (y el correo no deseado).' };
  if (!u || !u.active) return res.json(generic);
  const sent = await withCtx(SYSTEM, async c => {
    const cfg = await M.getConfig(c); if (!cfg.configured) return false;
    const token = crypto.randomBytes(24).toString('hex');
    await c.query("UPDATE users SET invite_token = $2, invite_expires = now() + interval '1 hour' WHERE id = $1", [u.id, token]);
    const firm = (await c.query("SELECT value FROM settings WHERE key = 'firm'")).rows[0]?.value || {};
    const link = `${req.protocol}://${req.get('host')}/#/invitacion/${token}`;
    await M.send(c, null, { to: u.email, subject: 'Restablecer su contraseña de LegalTax', kind: 'restablecer', attachments: [M.logoAttachment(S.BRAND_LOGO)],
      html: M.layout('Restablecer contraseña', `<p>Hola, ${esc(u.name)}.</p><p>Recibimos una solicitud para restablecer su contraseña. Use este enlace (válido por 1 hora):</p><p><a href="${link}" style="background:#876440;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">Crear nueva contraseña</a></p><p style="color:#7A6E62;font-size:13px">Si usted no lo solicitó, ignore este mensaje.</p>`, firm) });
    await S.audit(c, { id: u.id, name: u.name, role: u.role }, 'solicitar_restablecer', 'usuario', u.id, u.client_id, null, req.ip);
    return true;
  }).catch(() => false);
  res.json(sent ? generic : { ok: false, message: 'El envío por correo aún no está configurado. Pida a Administración que restablezca su contraseña (Configuración → Usuarios).' });
}));
// Marcador de cambios: todas las apps consultan aquí y recargan cuando alguien modifica algo
app.get('/api/sync', auth(), wrap(async (req, res) => {
  const r = await db(req, c => c.query('SELECT coalesce(max(id),0)::text AS last FROM audit_log'));
  res.json({ last: r.rows[0]?.last || '0', at: new Date().toISOString() });
}));
app.post('/api/mobile/login', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const key = req.ip + '|' + email; const a = attempts.get(key) || { n: 0, t: Date.now() };
  if (a.n >= 8 && Date.now() - a.t < 15 * 60e3) return res.status(429).json({ error: 'Demasiados intentos. Espere 15 minutos.' });
  const u = (await pool.query('SELECT * FROM users WHERE lower(email) = $1 AND active', [email])).rows[0];
  if (!u || !u.password_hash || !(await bcrypt.compare(String(req.body.password || ''), u.password_hash))) {
    attempts.set(key, { n: a.n + 1, t: a.n === 0 ? Date.now() : a.t });
    return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
  }
  if (u.role === 'cliente') return res.status(403).json({ error: 'La app móvil es solo para el equipo de LegalTax. Los clientes usan el portal web.' });
  attempts.delete(key);
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('INSERT INTO api_tokens (user_id, token_hash, device) VALUES ($1,$2,$3)', [u.id, sha(token), String(req.body.device || 'móvil').slice(0, 80)]);
  await pool.query('UPDATE users SET last_login = now() WHERE id = $1', [u.id]);
  const user = { id: u.id, name: u.name, email: u.email, role: u.role, client_id: null };
  await withCtx(user, c => S.audit(c, user, 'inicio_sesion_movil', 'usuario', u.id, null, { device: req.body.device }, req.ip));
  const firm = (await pool.query("SELECT value FROM settings WHERE key = 'firm'")).rows[0]?.value || {};
  res.json({ token, user, firm: { name: firm.firm_name } });
}));
app.post('/api/mobile/logout', wrap(async (req, res) => {
  const h = req.get('authorization') || '';
  if (h.startsWith('Bearer ')) await pool.query('UPDATE api_tokens SET revoked = true WHERE token_hash = $1', [sha(h.slice(7).trim())]);
  res.json({ ok: true });
}));
app.get('/api/mobile/devices', auth('admin'), wrap(async (req, res) => {
  res.json((await pool.query(`SELECT t.id, u.name, u.email, t.device, t.created_at, t.last_used FROM api_tokens t JOIN users u ON u.id = t.user_id
    WHERE NOT t.revoked AND t.expires_at > now() ORDER BY t.last_used DESC NULLS LAST`)).rows);
}));
app.post('/api/mobile/devices/:id/revoke', auth('admin'), wrap(async (req, res) => {
  await pool.query('UPDATE api_tokens SET revoked = true WHERE id = $1', [int(req.params.id)]);
  await db(req, c => A(c, req, 'revocar_dispositivo', 'usuario', req.params.id, null, null)); res.json({ ok: true });
}));
app.post('/api/logout', (req, res) => req.session.destroy(() => { res.clearCookie('lt.sid'); res.json({ ok: true }); }));
app.get('/api/me', wrap(async (req, res) => {
  const u = req.session.user || req.tokenUser;
  const demo = process.env.SEED_DEMO ? process.env.SEED_DEMO === '1' : process.env.NODE_ENV !== 'production';
  if (!u) return res.json({ user: null, demo });
  const s = (await pool.query("SELECT value FROM settings WHERE key = 'firm'")).rows[0]?.value || {};
  let client = null;
  if (u.client_id) client = (await withCtx(u, c => c.query('SELECT id, name, id_number FROM clients WHERE id = $1', [u.client_id]))).rows[0];
  res.json({ user: u, client, firm: { name: s.firm_name, tagline: s.tagline, has_logo: !!s.logo_key } });
}));
app.get('/api/invite/:token', wrap(async (req, res) => {
  const u = (await pool.query('SELECT name, email, username, invite_expires, (password_hash IS NOT NULL) AS has_pw FROM users WHERE invite_token = $1 AND active', [req.params.token])).rows[0];
  if (!u || new Date(u.invite_expires) < new Date()) return res.status(404).json({ error: 'El enlace no es válido o ya venció. Pida uno nuevo a Administración.' });
  res.json({ name: u.name, email: u.email, username: u.username, reset: u.has_pw });
}));
app.post('/api/invite/:token', wrap(async (req, res) => {
  const pw = String(req.body.password || ''); const prob = passwordProblem(pw); need(!prob, prob);
  const u = (await pool.query('SELECT * FROM users WHERE invite_token = $1 AND active', [req.params.token])).rows[0];
  if (!u || new Date(u.invite_expires) < new Date()) return res.status(404).json({ error: 'El enlace no es válido o ya venció. Pida uno nuevo a Administración.' });
  await pool.query('UPDATE users SET password_hash = $2, invite_token = NULL, invite_expires = NULL, must_change_password = false, password_changed_at = now(), failed_logins = 0, locked_until = NULL WHERE id = $1', [u.id, await bcrypt.hash(pw, 10)]);
  await withCtx(SYSTEM, c => S.audit(c, { id: u.id, name: u.name, role: u.role }, 'activar_cuenta', 'usuario', u.id, u.client_id, null, req.ip));
  res.json({ ok: true, email: u.email });
}));
app.get('/api/firm-logo', wrap(async (req, res) => {
  const s = (await pool.query("SELECT value FROM settings WHERE key = 'firm'")).rows[0]?.value || {};
  if (!s.logo_key) return sendFile(res, S.BRAND_LOGO, 'logo.png', 'image/png', true);
  sendFile(res, S.filePath(s.logo_key), 'logo', s.logo_mime || 'image/png', true);
}));

// ───────── panel de inicio
app.get('/api/dashboard', auth(...STAFF), wrap(async (req, res) => {
  const r = await db(req, async c => {
    const one = async (sql, p = []) => (await c.query(sql, p)).rows[0];
    const k = {
      active_cases: (await one("SELECT count(*)::int n FROM cases WHERE status IN ('abierto','en_tramite','en_espera')")).n,
      upcoming: (await one("SELECT count(*)::int n FROM deadlines WHERE status = 'pendiente' AND due_at >= now() AND due_at <= now() + make_interval(days => greatest(alert_days, 7))")).n,
      overdue: (await one("SELECT count(*)::int n FROM deadlines WHERE status = 'pendiente' AND due_at < now()")).n,
      pending_quotes: (await one("SELECT count(*)::int n FROM quotes WHERE status = 'publicada'")).n,
      vouchers: (await one("SELECT count(*)::int n FROM payments WHERE status = 'pendiente'")).n,
      requests: (await one("SELECT count(*)::int n FROM doc_requests WHERE status <> 'recibida'")).n,
      invoices_overdue: (await invoiceList(c, "i.status = 'emitida' AND i.due_date < current_date", [])).filter(x => x.state.balance > 0).length,
    };
    const rec = await one(`SELECT coalesce(sum(i.amount),0) AS billed FROM installments i JOIN quotes q ON q.id = i.quote_id WHERE q.status = 'aceptada'`);
    const paid = await one("SELECT coalesce(sum(amount_validated),0) AS paid FROM payments p JOIN quotes q ON q.id = p.quote_id WHERE p.status = 'validado' AND q.status = 'aceptada'");
    k.receivable = S.round2(rec.billed - paid.paid);
    const next = (await c.query(`SELECT d.*, cs.code AS case_code, cl.name AS client_name, u.name AS responsible_name FROM deadlines d
      LEFT JOIN cases cs ON cs.id = d.case_id LEFT JOIN clients cl ON cl.id = coalesce(d.client_id, cs.client_id) LEFT JOIN users u ON u.id = d.responsible_user_id
      WHERE d.status = 'pendiente' ORDER BY d.due_at LIMIT 8`)).rows;
    const vouchers = (await c.query(`SELECT p.*, cl.name AS client_name, q.number AS quote_number FROM payments p JOIN clients cl ON cl.id = p.client_id
      JOIN quotes q ON q.id = p.quote_id WHERE p.status = 'pendiente' ORDER BY p.created_at LIMIT 6`)).rows;
    const activity = (await c.query('SELECT * FROM audit_log ORDER BY id DESC LIMIT 10')).rows;
    return { kpis: k, next, vouchers, activity };
  });
  res.json(r);
}));

// ───────── usuarios
app.get('/api/staff', auth(...STAFF), wrap(async (req, res) => {
  res.json((await pool.query("SELECT id, name, role FROM users WHERE role <> 'cliente' AND active ORDER BY name")).rows);
}));
app.get('/api/users', auth('admin'), wrap(async (req, res) => {
  res.json((await pool.query(`SELECT u.id, u.name, u.email, u.username, u.role, u.client_id, u.active, u.last_login, u.invite_expires, (u.password_hash IS NOT NULL) AS activated, c.name AS client_name,
      u.must_change_password, (u.locked_until > now()) AS locked
    FROM users u LEFT JOIN clients c ON c.id = u.client_id ORDER BY u.role, u.name`)).rows);
}));
function inviteLink(req, token) { return `${req.protocol}://${req.get('host')}/#/invitacion/${token}`; }
app.post('/api/users', auth('admin'), wrap(async (req, res) => {
  const b = req.body; need(STAFF.includes(b.role), 'Rol inválido'); need(str(b.email) && str(b.name), 'Nombre y correo son obligatorios');
  const username = str(b.username) ? String(b.username).trim().toLowerCase() : null;
  if (username) need(/^[a-z0-9._-]{3,30}$/.test(username), 'El usuario solo puede tener letras sin acentos, números, punto, guion o guion bajo (3 a 30).');
  const temp = str(b.temp_password);
  if (temp) { const prob = passwordProblem(temp); need(!prob, prob); }
  const token = temp ? null : crypto.randomBytes(24).toString('hex');
  const u = await db(req, async c => {
    const u = (await c.query(`INSERT INTO users (email, name, username, role, password_hash, must_change_password, invite_token, invite_expires)
      VALUES (lower($1),$2,$3,$4,$5,$6,$7, CASE WHEN $7::text IS NULL THEN NULL ELSE now() + interval '7 days' END) RETURNING id, email, name, username, role`,
    [b.email.trim(), b.name.trim(), username, b.role, temp ? await bcrypt.hash(temp, 10) : null, !!temp, token])).rows[0];
    await A(c, req, 'crear', 'usuario', u.id, null, { role: b.role, email: u.email, username });
    return u;
  });
  res.json({ ...u, invite_link: token ? inviteLink(req, token) : null, temp_password: temp || null });
}));
app.patch('/api/users/:id', auth('admin'), wrap(async (req, res) => {
  const f = pick(req.body, ['name', 'role', 'active', 'username']);
  if (f.username) { f.username = String(f.username).trim().toLowerCase(); need(/^[a-z0-9._-]{3,30}$/.test(f.username), 'Usuario inválido (letras sin acentos, números, punto, guion; 3 a 30).'); }
  if (f.role) need(STAFF.includes(f.role), 'Rol inválido');
  need(!(int(req.params.id) === req.user.id && (f.active === false || (f.role && f.role !== 'admin'))), 'No puede desactivar o quitar Administración a su propio usuario');
  const u = await db(req, async c => { const u = await updateRow(c, 'users', int(req.params.id), f); await A(c, req, 'editar', 'usuario', req.params.id, u?.client_id, f); return u; });
  if (f.active === false) await pool.query('UPDATE api_tokens SET revoked = true WHERE user_id = $1', [u.id]);
  res.json({ id: u.id });
}));
app.post('/api/users/:id/temp-password', auth('admin'), wrap(async (req, res) => {
  const pw = String(req.body.password || ''); const prob = passwordProblem(pw); need(!prob, prob);
  await db(req, async c => {
    const r = await c.query('UPDATE users SET password_hash = $2, must_change_password = true, failed_logins = 0, locked_until = NULL, invite_token = NULL WHERE id = $1 RETURNING id', [int(req.params.id), await bcrypt.hash(pw, 10)]);
    need(r.rowCount, 'Usuario no encontrado', 404);
    await A(c, req, 'restablecer_contrasena', 'usuario', req.params.id, null, null);
  });
  await pool.query('UPDATE api_tokens SET revoked = true WHERE user_id = $1', [int(req.params.id)]).catch(() => {});
  res.json({ ok: true });
}));
app.post('/api/users/:id/unlock', auth('admin'), wrap(async (req, res) => {
  await db(req, async c => { await c.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [int(req.params.id)]); await A(c, req, 'desbloquear', 'usuario', req.params.id, null, null); });
  res.json({ ok: true });
}));
app.post('/api/users/:id/invite', auth('admin'), wrap(async (req, res) => {
  const token = crypto.randomBytes(24).toString('hex');
  await db(req, async c => {
    await c.query("UPDATE users SET invite_token = $2, invite_expires = now() + interval '7 days', password_hash = CASE WHEN $3 THEN NULL ELSE password_hash END WHERE id = $1", [int(req.params.id), token, !!req.body.reset]);
    await A(c, req, 'reenviar_invitacion', 'usuario', req.params.id, null, null);
  });
  res.json({ invite_link: inviteLink(req, token) });
}));

// ───────── clientes
app.get('/api/clients', auth(...STAFF), wrap(async (req, res) => {
  const q = str(req.query.q);
  const rows = await db(req, async c => (await c.query(`SELECT cl.*, u.name AS responsible_name,
      (SELECT count(*)::int FROM cases WHERE client_id = cl.id AND status NOT IN ('cerrado','archivado')) AS active_cases
    FROM clients cl LEFT JOIN users u ON u.id = cl.responsible_user_id
    WHERE ($1::text IS NULL OR cl.name ILIKE '%'||$1||'%' OR cl.trade_name ILIKE '%'||$1||'%' OR cl.id_digits ILIKE '%'||regexp_replace($1,'[^0-9A-Za-z]','','g')||'%')
    ORDER BY cl.name LIMIT 500`, [q])).rows);
  res.json(rows);
}));
const CLIENT_FIELDS = ['kind', 'name', 'trade_name', 'id_type', 'id_number', 'representative', 'representative_id', 'email', 'phone', 'address', 'responsible_user_id', 'notes'];
app.post('/api/clients', auth('admin', 'expedientes'), wrap(async (req, res) => {
  const f = pick(req.body, CLIENT_FIELDS);
  need(f.name && f.id_number && f.kind && f.id_type, 'Complete tipo, nombre e identificación');
  const row = await db(req, async c => {
    const keys = Object.keys(f);
    const r = (await c.query(`INSERT INTO clients (${keys.join(',')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, keys.map(k => f[k]))).rows[0];
    await S.docFolder(c, { clientId: r.id });
    await A(c, req, 'crear', 'cliente', r.id, r.id, { name: r.name, id_number: r.id_number });
    return r;
  });
  res.json(row);
}));
app.patch('/api/clients/:id', auth('admin', 'expedientes'), wrap(async (req, res) => {
  const f = pick(req.body, CLIENT_FIELDS);
  const row = await db(req, async c => { const r = await updateRow(c, 'clients', int(req.params.id), f); need(r, 'Cliente no encontrado', 404); await A(c, req, 'editar', 'cliente', r.id, r.id, f); return r; });
  res.json(row);
}));
app.get('/api/clients/:id', auth(...STAFF), wrap(async (req, res) => {
  const id = int(req.params.id);
  const r = await db(req, async c => {
    const client = (await c.query('SELECT cl.*, u.name AS responsible_name FROM clients cl LEFT JOIN users u ON u.id = cl.responsible_user_id WHERE cl.id = $1', [id])).rows[0];
    need(client, 'Cliente no encontrado', 404);
    const q = async (sql) => (await c.query(sql, [id])).rows;
    return {
      client,
      cases: await q(`SELECT cs.*, u.name AS responsible_name FROM cases cs LEFT JOIN users u ON u.id = cs.responsible_user_id WHERE cs.client_id = $1 ORDER BY cs.opened_on DESC`),
      quotes: await q('SELECT * FROM quotes WHERE client_id = $1 ORDER BY created_at DESC'),
      payments: await q(`SELECT p.*, q.number AS quote_number, (SELECT id FROM generated_docs g WHERE g.payment_id = p.id AND g.doc_type='recibo_dinero' AND g.status <> 'reemplazado' ORDER BY version DESC LIMIT 1) AS receipt_id
                         FROM payments p JOIN quotes q ON q.id = p.quote_id WHERE p.client_id = $1 ORDER BY p.created_at DESC`),
      documents: await q('SELECT d.*, cs.code AS case_code FROM documents d LEFT JOIN cases cs ON cs.id = d.case_id WHERE d.client_id = $1 ORDER BY d.created_at DESC'),
      requests: await q('SELECT r.*, cs.code AS case_code FROM doc_requests r LEFT JOIN cases cs ON cs.id = r.case_id WHERE r.client_id = $1 ORDER BY r.created_at DESC'),
      gendocs: await q("SELECT id, doc_type, number, version, title, status, shared, created_at, case_id FROM generated_docs WHERE client_id = $1 AND status <> 'reemplazado' ORDER BY created_at DESC"),
      users: await q('SELECT id, name, email, active, last_login, (password_hash IS NOT NULL) AS activated, invite_expires FROM users WHERE client_id = $1'),
      account: await S.account(c, id),
    };
  });
  res.json(r);
}));
app.post('/api/clients/:id/portal-user', auth('admin', 'expedientes', 'cobros'), wrap(async (req, res) => {
  const id = int(req.params.id); need(str(req.body.email) && str(req.body.name), 'Nombre y correo son obligatorios');
  const token = crypto.randomBytes(24).toString('hex');
  await db(req, async c => {
    need((await c.query('SELECT 1 FROM clients WHERE id = $1', [id])).rowCount, 'Cliente no encontrado', 404);
    const u = (await c.query("INSERT INTO users (email, name, role, client_id, invite_token, invite_expires) VALUES (lower($1),$2,'cliente',$3,$4, now() + interval '7 days') RETURNING id",
      [req.body.email.trim(), req.body.name.trim(), id, token])).rows[0];
    await A(c, req, 'invitar_portal', 'usuario', u.id, id, { email: req.body.email });
  });
  res.json({ invite_link: inviteLink(req, token) });
}));

// ───────── expedientes
app.post('/api/cases', auth('admin', 'expedientes'), wrap(async (req, res) => {
  const f = pick(req.body, ['client_id', 'title', 'matter', 'institution', 'official_number', 'fiscal_periods', 'status', 'public_status', 'responsible_user_id', 'next_action', 'next_action_date', 'opened_on']);
  need(f.client_id && f.title, 'Cliente y asunto son obligatorios');
  const row = await db(req, async c => {
    f.code = await S.nextNumber(c, 'expediente');
    const keys = Object.keys(f);
    const r = (await c.query(`INSERT INTO cases (${keys.join(',')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, keys.map(k => f[k]))).rows[0];
    await c.query("INSERT INTO case_events (case_id, client_id, kind, title, visibility, created_by) VALUES ($1,$2,'actuacion','Apertura del expediente','cliente',$3)", [r.id, r.client_id, req.user.id]);
    await S.docFolder(c, { clientId: r.client_id, caseId: r.id });
    await A(c, req, 'crear', 'expediente', r.id, r.client_id, { code: r.code });
    return r;
  });
  res.json(row);
}));
app.patch('/api/cases/:id', auth('admin', 'expedientes'), wrap(async (req, res) => {
  const f = pick(req.body, ['title', 'matter', 'institution', 'official_number', 'fiscal_periods', 'status', 'public_status', 'responsible_user_id', 'next_action', 'next_action_date', 'closed_on']);
  const row = await db(req, async c => { const r = await updateRow(c, 'cases', int(req.params.id), f); need(r, 'Expediente no encontrado', 404); await A(c, req, 'editar', 'expediente', r.id, r.client_id, f); return r; });
  res.json(row);
}));
app.get('/api/cases/:id', auth(...STAFF), wrap(async (req, res) => {
  const id = int(req.params.id);
  res.json(await db(req, async c => {
    const cs = (await c.query(`SELECT cs.*, cl.name AS client_name, cl.id_number AS client_id_number, cl.folder_name AS client_folder, u.name AS responsible_name FROM cases cs
      JOIN clients cl ON cl.id = cs.client_id LEFT JOIN users u ON u.id = cs.responsible_user_id WHERE cs.id = $1`, [id])).rows[0];
    need(cs, 'Expediente no encontrado', 404);
    const q = async sql => (await c.query(sql, [id])).rows;
    return {
      case: cs,
      events: await q('SELECT e.*, u.name AS author FROM case_events e LEFT JOIN users u ON u.id = e.created_by WHERE case_id = $1 ORDER BY event_date DESC, id DESC'),
      documents: await q(`SELECT d.*, t.name AS doc_type_name, u.name AS uploaded_by_name FROM documents d LEFT JOIN doc_types t ON t.id = d.doc_type_id LEFT JOIN users u ON u.id = d.uploaded_by
        WHERE d.case_id = $1 ORDER BY d.created_at DESC`),
      deadlines: await q('SELECT d.*, u.name AS responsible_name FROM deadlines d LEFT JOIN users u ON u.id = d.responsible_user_id WHERE case_id = $1 ORDER BY due_at'),
      requests: await q('SELECT * FROM doc_requests WHERE case_id = $1 ORDER BY created_at DESC'),
      quotes: await q('SELECT id, number, title, total, status FROM quotes WHERE case_id = $1'),
      gendocs: await q("SELECT id, doc_type, number, version, title, status, shared, created_at FROM generated_docs WHERE case_id = $1 AND status <> 'reemplazado' ORDER BY created_at DESC"),
    };
  }));
}));
app.post('/api/cases/:id/events', auth('admin', 'expedientes'), wrap(async (req, res) => {
  const b = req.body; need(str(b.title), 'Indique la actuación');
  res.json(await db(req, async c => {
    const cs = (await c.query('SELECT id, client_id FROM cases WHERE id = $1', [int(req.params.id)])).rows[0]; need(cs, 'Expediente no encontrado', 404);
    const r = (await c.query('INSERT INTO case_events (case_id, client_id, kind, title, description, event_date, visibility, document_id, created_by) VALUES ($1,$2,$3,$4,$5,coalesce($6::date,current_date),$7,$8,$9) RETURNING *',
      [cs.id, cs.client_id, b.kind || 'actuacion', b.title.trim(), str(b.description), str(b.event_date), b.visibility === 'cliente' ? 'cliente' : 'interna', int(b.document_id), req.user.id])).rows[0];
    await A(c, req, 'registrar_actuacion', 'expediente', cs.id, cs.client_id, { title: r.title, visibility: r.visibility });
    return r;
  }));
}));
app.patch('/api/events/:id', auth('admin', 'expedientes'), wrap(async (req, res) => {
  const f = pick(req.body, ['visibility', 'title', 'description', 'event_date', 'kind']);
  res.json(await db(req, async c => { const r = await updateRow(c, 'case_events', int(req.params.id), f); need(r, 'No encontrado', 404); await A(c, req, 'editar_actuacion', 'expediente', r.case_id, r.client_id, f); return r; }));
}));

// ───────── agenda y vencimientos
app.get('/api/deadlines', auth(...STAFF), wrap(async (req, res) => {
  const scope = req.query.scope || 'abiertas';
  const where = { abiertas: "d.status = 'pendiente'", atrasadas: "d.status = 'pendiente' AND d.due_at < now()",
    proximas: "d.status = 'pendiente' AND d.due_at >= now() AND d.due_at <= now() + make_interval(days => greatest(d.alert_days, 7))", todas: 'true' }[scope] || 'true';
  res.json(await db(req, async c => (await c.query(`SELECT d.*, cs.code AS case_code, cl.name AS client_name, u.name AS responsible_name,
      (d.status = 'pendiente' AND d.due_at < now()) AS is_overdue, (d.status='pendiente' AND d.due_at >= now() AND d.due_at <= now() + make_interval(days => d.alert_days)) AS in_alert,
      (SELECT count(*)::int FROM documents WHERE deadline_id = d.id) AS attachments
    FROM deadlines d LEFT JOIN cases cs ON cs.id = d.case_id LEFT JOIN clients cl ON cl.id = coalesce(d.client_id, cs.client_id) LEFT JOIN users u ON u.id = d.responsible_user_id
    WHERE ${where} ORDER BY d.due_at LIMIT 500`)).rows));
}));
app.post('/api/deadlines', auth(...STAFF), wrap(async (req, res) => {
  const b = req.body; need(str(b.title) && str(b.due_at), 'Título y fecha son obligatorios');
  res.json(await db(req, async c => {
    let clientId = int(b.client_id);
    if (b.case_id) clientId = (await c.query('SELECT client_id FROM cases WHERE id = $1', [int(b.case_id)])).rows[0]?.client_id;
    const r = (await c.query(`INSERT INTO deadlines (case_id, client_id, kind, title, description, due_at, confirmed, confirmed_by, responsible_user_id, alert_days, created_by)
      VALUES ($1,$2,$3,$4,$5,($6::timestamp AT TIME ZONE 'America/Santo_Domingo'),$7,$8,$9,$10,$11) RETURNING *`,
    [int(b.case_id), clientId, b.kind || 'plazo', b.title.trim(), str(b.description), b.due_at, !!b.confirmed, b.confirmed ? req.user.id : null, int(b.responsible_user_id), int(b.alert_days) ?? 3, req.user.id])).rows[0];
    await A(c, req, 'crear', 'vencimiento', r.id, clientId, { title: r.title, due_at: r.due_at });
    return r;
  }));
}));
app.patch('/api/deadlines/:id', auth(...STAFF), wrap(async (req, res) => {
  const b = req.body; const f = pick(b, ['title', 'description', 'responsible_user_id', 'alert_days', 'status', 'kind']);
  if (b.confirmed !== undefined) { f.confirmed = !!b.confirmed; f.confirmed_by = b.confirmed ? req.user.id : null; }
  if (f.status === 'completada') f.completed_at = new Date();
  res.json(await db(req, async c => {
    let r = await updateRow(c, 'deadlines', int(req.params.id), f);
    if (b.due_at) r = (await c.query("UPDATE deadlines SET due_at = ($2::timestamp AT TIME ZONE 'America/Santo_Domingo') WHERE id = $1 RETURNING *", [int(req.params.id), b.due_at])).rows[0];
    need(r, 'No encontrado', 404); await A(c, req, 'editar', 'vencimiento', r.id, r.client_id, b); return r;
  }));
}));

// ───────── archivos
app.post('/api/documents', auth(...STAFF), upload.single('file'), wrap(async (req, res) => {
  need(req.file, 'Adjunte un archivo');
  const b = req.body;
  try {
    const row = await db(req, async c => {
      let clientId = int(b.client_id);
      const caseId = int(b.case_id);
      if (caseId) clientId = (await c.query('SELECT client_id FROM cases WHERE id = $1', [caseId])).rows[0]?.client_id;
      need(clientId, 'Indique el cliente o expediente');
      const key = await S.saveUpload(c, req.file.path, req.file.originalname, { clientId, caseId, label: { resolucion: 'Resolución', acuse: 'Acuse', constancia_deposito: 'Constancia de depósito', notificacion: 'Notificación', contrato: 'Contrato', identificacion: 'Identificación', estado_financiero: 'Estado financiero', declaracion: 'Declaración', correspondencia: 'Correspondencia' }[b.category] || null });
      const r = (await c.query(`INSERT INTO documents (client_id, case_id, deadline_id, request_id, category, title, resolution_number, institution, doc_date, storage_key, filename, mime, size_bytes, visibility, uploaded_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [clientId, caseId, int(b.deadline_id), int(b.request_id), b.category || 'otro', str(b.title) || req.file.originalname, str(b.resolution_number), str(b.institution), str(b.doc_date),
        key, req.file.originalname, req.file.mimetype, req.file.size, b.visibility === 'cliente' ? 'cliente' : 'privado', req.user.id])).rows[0];
      if (caseId && b.add_event !== '0') {
        const kind = { resolucion: 'decision', acuse: 'deposito', constancia_deposito: 'deposito', notificacion: 'notificacion' }[r.category] || 'documento';
        await c.query('INSERT INTO case_events (case_id, client_id, kind, title, event_date, visibility, document_id, created_by) VALUES ($1,$2,$3,$4,coalesce($5::date,current_date),$6,$7,$8)',
          [caseId, clientId, kind, `Documento: ${r.title}${r.resolution_number ? ' (No. ' + r.resolution_number + ')' : ''}`, r.doc_date, r.visibility === 'cliente' ? 'cliente' : 'interna', r.id, req.user.id]);
      }
      await A(c, req, 'subir_archivo', 'archivo', r.id, clientId, { title: r.title, resolution_number: r.resolution_number, visibility: r.visibility });
      return r;
    });
    res.json(row);
  } finally { if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); }
}));
app.patch('/api/documents/:id', auth('admin', 'expedientes'), wrap(async (req, res) => {
  const f = pick(req.body, ['title', 'category', 'resolution_number', 'institution', 'doc_date', 'visibility', 'doc_type_id', 'notes']);
  if (f.visibility) need(['privado', 'cliente'].includes(f.visibility), 'Visibilidad inválida');
  res.json(await db(req, async c => {
    if (f.doc_type_id) { const t = (await c.query('SELECT category FROM doc_types WHERE id = $1', [int(f.doc_type_id)])).rows[0]; need(t, 'Tipo de documento inválido'); f.category = t.category; }
    const r = await updateRow(c, 'documents', int(req.params.id), f); need(r, 'No encontrado', 404); await A(c, req, 'editar', 'archivo', r.id, r.client_id, f); return r; }));
}));
// Descarga: la consulta se hace con el contexto del usuario, por lo que RLS impide abrir archivos ajenos aunque se conozca el enlace.
app.get('/api/files/:id', auth(), wrap(async (req, res) => {
  const d = await db(req, async c => {
    const d = (await c.query('SELECT * FROM documents WHERE id = $1', [int(req.params.id)])).rows[0];
    if (d) await A(c, req, 'descargar', 'archivo', d.id, d.client_id, null);
    else await A(c, req, 'acceso_denegado', 'archivo', req.params.id, null, null);
    return d;
  });
  if (!d) return res.status(404).json({ error: 'Documento no encontrado o sin autorización' });
  sendFile(res, S.filePath(d.storage_key), d.filename, d.mime, req.query.inline === '1');
}));

// ───────── cotizaciones
function normalizeQuote(b) {
  const items = (b.items || []).filter(i => str(i.description)).map((i, k) => ({ kind: i.kind === 'gasto' ? 'gasto' : 'honorario', description: String(i.description).trim(), amount: S.round2(i.amount || 0), position: k }));
  need(items.length, 'Agregue al menos un concepto de honorarios o gastos');
  const t = S.computeQuote(items, b.discount, b.itbis_applies !== false, 18);
  const inst = (b.installments || []).filter(i => i.due_date && Number(i.amount) > 0).map((i, k) => ({ seq: k + 1, due_date: i.due_date, amount: S.round2(i.amount) }));
  need(inst.length, 'Defina al menos una cuota');
  const sum = S.round2(inst.reduce((s, i) => s + i.amount, 0));
  need(Math.abs(sum - t.total) < 0.01, `La suma de las cuotas (${money(sum)}) debe ser igual al total (${money(t.total)})`);
  return { items, t, inst };
}
async function saveQuoteChildren(c, quoteId, clientId, items, inst) {
  await c.query('DELETE FROM quote_items WHERE quote_id = $1', [quoteId]);
  await c.query('DELETE FROM installments WHERE quote_id = $1', [quoteId]);
  for (const i of items) await c.query('INSERT INTO quote_items (quote_id, client_id, kind, description, amount, position) VALUES ($1,$2,$3,$4,$5,$6)', [quoteId, clientId, i.kind, i.description, i.amount, i.position]);
  for (const i of inst) await c.query('INSERT INTO installments (quote_id, client_id, seq, due_date, amount) VALUES ($1,$2,$3,$4,$5)', [quoteId, clientId, i.seq, i.due_date, i.amount]);
}
app.get('/api/quotes', auth(...STAFF), wrap(async (req, res) => {
  const st = str(req.query.status);
  res.json(await db(req, async c => (await c.query(`SELECT q.*, cl.name AS client_name, cs.code AS case_code,
      coalesce((SELECT sum(amount_validated) FROM payments WHERE quote_id = q.id AND status='validado'),0) AS paid
    FROM quotes q JOIN clients cl ON cl.id = q.client_id LEFT JOIN cases cs ON cs.id = q.case_id
    WHERE ($1::text IS NULL OR q.status = $1) ORDER BY q.created_at DESC LIMIT 500`, [st])).rows));
}));
app.post('/api/quotes', auth('admin', 'expedientes', 'cobros'), wrap(async (req, res) => {
  const b = req.body; need(int(b.client_id) && str(b.title), 'Cliente y título son obligatorios');
  const { items, t, inst } = normalizeQuote(b);
  res.json(await db(req, async c => {
    const caseId = int(b.case_id);
    if (caseId) need((await c.query('SELECT 1 FROM cases WHERE id = $1 AND client_id = $2', [caseId, int(b.client_id)])).rowCount, 'El expediente no pertenece al cliente');
    const number = await S.nextNumber(c, 'cotizacion');
    const q = (await c.query(`INSERT INTO quotes (number, client_id, case_id, title, scope, discount, itbis_applies, fees_total, expenses_total, subtotal, itbis, total, valid_until, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [number, int(b.client_id), caseId, b.title.trim(), b.scope || '', t.discount, b.itbis_applies !== false, t.fees_total, t.expenses_total, t.subtotal, t.itbis, t.total, str(b.valid_until), req.user.id])).rows[0];
    await saveQuoteChildren(c, q.id, q.client_id, items, inst);
    await A(c, req, 'crear', 'cotizacion', q.id, q.client_id, { number, total: t.total });
    return q;
  }));
}));
app.put('/api/quotes/:id', auth('admin', 'expedientes', 'cobros'), wrap(async (req, res) => {
  const b = req.body; const { items, t, inst } = normalizeQuote(b);
  res.json(await db(req, async c => {
    const q0 = (await c.query('SELECT * FROM quotes WHERE id = $1 FOR UPDATE', [int(req.params.id)])).rows[0];
    need(q0, 'No encontrada', 404); need(q0.status === 'borrador', 'Solo se pueden editar cotizaciones en borrador', 409);
    const q = (await c.query(`UPDATE quotes SET case_id=$2, title=$3, scope=$4, discount=$5, itbis_applies=$6, fees_total=$7, expenses_total=$8, subtotal=$9, itbis=$10, total=$11, valid_until=$12 WHERE id=$1 RETURNING *`,
      [q0.id, int(b.case_id), b.title.trim(), b.scope || '', t.discount, b.itbis_applies !== false, t.fees_total, t.expenses_total, t.subtotal, t.itbis, t.total, str(b.valid_until)])).rows[0];
    await saveQuoteChildren(c, q.id, q.client_id, items, inst);
    await A(c, req, 'editar', 'cotizacion', q.id, q.client_id, { total: t.total });
    return q;
  }));
}));
async function quoteDetail(c, id) {
  const q = (await c.query(`SELECT q.*, cl.name AS client_name, cs.code AS case_code, u.name AS accepted_by_name FROM quotes q JOIN clients cl ON cl.id = q.client_id
    LEFT JOIN cases cs ON cs.id = q.case_id LEFT JOIN users u ON u.id = q.accepted_by WHERE q.id = $1`, [id])).rows[0];
  if (!q) return null;
  return {
    quote: q,
    items: (await c.query('SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY position', [id])).rows,
    installments: (await c.query('SELECT * FROM installments WHERE quote_id = $1 ORDER BY seq', [id])).rows,
    balance: await S.quoteBalance(c, id),
    gendocs: (await c.query("SELECT id, number, version, status, shared, created_at FROM generated_docs WHERE quote_id = $1 AND doc_type = 'cotizacion' ORDER BY version DESC", [id])).rows,
  };
}
app.get('/api/quotes/:id', auth(...STAFF), wrap(async (req, res) => {
  const r = await db(req, c => quoteDetail(c, int(req.params.id)));
  if (!r) return res.status(404).json({ error: 'No encontrada' });
  res.json(r);
}));
app.post('/api/quotes/:id/publish', auth('admin', 'expedientes', 'cobros'), wrap(async (req, res) => {
  res.json(await db(req, async c => {
    const q = (await c.query('SELECT * FROM quotes WHERE id = $1 FOR UPDATE', [int(req.params.id)])).rows[0];
    need(q, 'No encontrada', 404); need(q.status === 'borrador', 'La cotización ya fue publicada', 409);
    await c.query("UPDATE quotes SET status = 'publicada', published_at = now() WHERE id = $1", [q.id]);
    const gd = await S.issueQuoteVersion(c, q.id, req.user, { share: true, ip: req.ip });
    await A(c, req, 'publicar', 'cotizacion', q.id, q.client_id, { number: q.number });
    return { ok: true, gendoc_id: gd.id };
  }));
}));
async function acceptQuote(c, req, quoteId, decision, note) {
  const q = (await c.query('SELECT * FROM quotes WHERE id = $1', [quoteId])).rows[0];
  need(q, 'Cotización no encontrada', 404); need(q.status === 'publicada', 'Esta cotización ya no está pendiente de aceptación', 409);
  const status = decision === 'rechazar' ? 'rechazada' : 'aceptada';
  const r = await c.query('UPDATE quotes SET status = $2, accepted_at = now(), accepted_by = $3, accepted_note = $4 WHERE id = $1 RETURNING id', [q.id, status, req.user.id, str(note)]);
  need(r.rowCount, 'No autorizado', 403);
  await A(c, req, status === 'aceptada' ? 'aceptar' : 'rechazar', 'cotizacion', q.id, q.client_id, { number: q.number, note });
  if (status === 'aceptada') {
    // nueva versión del PDF con constancia de aceptación (la emite el sistema)
    await c.query("SELECT set_config('app.role','system',true)");
    await S.issueQuoteVersion(c, q.id, { id: req.user.id, name: req.user.name, role: req.user.role }, { share: true, ip: req.ip });
  }
  return { status };
}
app.post('/api/quotes/:id/accept', auth('admin', 'expedientes', 'cobros'), wrap(async (req, res) => {
  res.json(await db(req, c => acceptQuote(c, req, int(req.params.id), req.body.decision, req.body.note)));
}));
app.post('/api/quotes/:id/void', auth('admin', 'cobros'), wrap(async (req, res) => {
  need(str(req.body.reason), 'Indique el motivo');
  res.json(await db(req, async c => {
    const q = (await c.query('SELECT * FROM quotes WHERE id = $1', [int(req.params.id)])).rows[0]; need(q, 'No encontrada', 404);
    need(!(await c.query("SELECT 1 FROM payments WHERE quote_id = $1 AND status IN ('pendiente','validado')", [q.id])).rowCount, 'La cotización tiene pagos registrados; anule primero los recibos', 409);
    await c.query("UPDATE quotes SET status = 'anulada' WHERE id = $1", [q.id]);
    await A(c, req, 'anular', 'cotizacion', q.id, q.client_id, { reason: req.body.reason });
    return { ok: true };
  }));
}));

// ───────── pagos y vouchers
app.get('/api/payments', auth(...STAFF), wrap(async (req, res) => {
  const st = str(req.query.status);
  res.json(await db(req, async c => (await c.query(`SELECT p.*, cl.name AS client_name, q.number AS quote_number, us.name AS submitted_by_name, uv.name AS validated_by_name,
      (SELECT id FROM generated_docs g WHERE g.payment_id = p.id AND g.doc_type='recibo_dinero' AND g.status <> 'reemplazado' ORDER BY version DESC LIMIT 1) AS receipt_id
    FROM payments p JOIN clients cl ON cl.id = p.client_id JOIN quotes q ON q.id = p.quote_id LEFT JOIN users us ON us.id = p.submitted_by LEFT JOIN users uv ON uv.id = p.validated_by
    WHERE ($1::text IS NULL OR p.status = $1) ORDER BY (p.status = 'pendiente') DESC, p.created_at DESC LIMIT 500`, [st])).rows));
}));
async function insertPayment(c, req, b, file, clientIdForce) {
  const quoteId = int(b.quote_id); need(quoteId, 'Seleccione la cotización');
  const q = (await c.query('SELECT * FROM quotes WHERE id = $1', [quoteId])).rows[0];
  need(q && (!clientIdForce || q.client_id === clientIdForce), 'Cotización no encontrada', 404);
  need(q.status === 'aceptada', 'Solo se registran pagos de cotizaciones aceptadas', 409);
  const amount = S.round2(b.amount); need(amount > 0, 'Indique el monto pagado');
  need(['transferencia', 'deposito', 'efectivo', 'cheque', 'tarjeta'].includes(b.method), 'Seleccione el medio de pago');
  let docId = null;
  if (file) {
    const key = await S.saveUpload(c, file.path, file.originalname, { clientId: q.client_id, sub: 'pagos', label: `Voucher ${q.number}` });
    docId = (await c.query(`INSERT INTO documents (client_id, case_id, category, title, storage_key, filename, mime, size_bytes, visibility, uploaded_by, uploaded_by_client)
      VALUES ($1,$2,'voucher',$3,$4,$5,$6,$7,'cliente',$8,$9) RETURNING id`,
    [q.client_id, q.case_id, `Voucher ${q.number} — ${money(amount)}`, key, file.originalname, file.mimetype, file.size, req.user.id, req.user.role === 'cliente'])).rows[0].id;
  }
  const p = (await c.query(`INSERT INTO payments (client_id, quote_id, amount_declared, method, bank, reference, paid_on, voucher_document_id, submitted_by)
    VALUES ($1,$2,$3,$4,$5,$6,coalesce($7::date,current_date),$8,$9) RETURNING *`,
  [q.client_id, q.id, amount, b.method, str(b.bank), str(b.reference), str(b.paid_on), docId, req.user.id])).rows[0];
  await A(c, req, 'registrar_voucher', 'pago', p.id, q.client_id, { amount, quote: q.number });
  return p;
}
app.post('/api/payments', auth('admin', 'cobros'), upload.single('file'), wrap(async (req, res) => {
  try { res.json(await db(req, c => insertPayment(c, req, req.body, req.file))); }
  finally { if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); }
}));
app.post('/api/payments/:id/validate', auth('admin', 'cobros'), wrap(async (req, res) => {
  const out = await db(req, async c => {
    // FOR UPDATE + condición de estado: dos validaciones simultáneas no pueden registrar el pago dos veces
    const p = (await c.query('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [int(req.params.id)])).rows[0];
    need(p, 'Pago no encontrado', 404);
    need(p.status === 'pendiente', `Este comprobante ya fue ${p.status === 'validado' ? 'validado' : 'procesado'}; no se registrará de nuevo`, 409);
    const amount = S.round2(req.body.amount ?? p.amount_declared); need(amount > 0, 'Monto inválido');
    const qb = await S.quoteBalance(c, p.quote_id);
    need(amount <= qb.balance + 0.001, `El monto validado (${money(amount)}) excede el saldo pendiente de la cotización (${money(qb.balance)})`, 409);
    await c.query("UPDATE payments SET status = 'validado', amount_validated = $2, validated_by = $3, validated_at = now(), reference = coalesce($4, reference) WHERE id = $1", [p.id, amount, req.user.id, str(req.body.reference)]);
    await A(c, req, 'validar', 'pago', p.id, p.client_id, { amount });
    const gd = await S.issueDocument(c, 'recibo_dinero', { payment_id: p.id }, req.user, { share: true, ip: req.ip });
    return { ok: true, receipt_id: gd.id, receipt_number: gd.number, balance: S.round2(qb.balance - amount), client_id: p.client_id, payment_id: p.id };
  });
  res.json(out);
  autoClientNotice('client_receipts', 'pago_recibido', out.client_id, out.payment_id, req);
}));
app.post('/api/payments/:id/reject', auth('admin', 'cobros'), wrap(async (req, res) => {
  need(str(req.body.reason), 'Indique el motivo del rechazo');
  res.json(await db(req, async c => {
    const r = await c.query("UPDATE payments SET status = 'rechazado', reject_reason = $2, validated_by = $3, validated_at = now() WHERE id = $1 AND status = 'pendiente' RETURNING client_id", [int(req.params.id), req.body.reason.trim(), req.user.id]);
    need(r.rowCount, 'El comprobante ya fue procesado', 409);
    await A(c, req, 'rechazar', 'pago', req.params.id, r.rows[0].client_id, { reason: req.body.reason });
    return { ok: true };
  }));
}));

// ───────── solicitudes de documentos
app.get('/api/requests', auth(...STAFF), wrap(async (req, res) => {
  res.json(await db(req, async c => (await c.query(`SELECT r.*, cl.name AS client_name, cs.code AS case_code,
    (SELECT json_agg(json_build_object('id', d.id, 'title', d.title, 'filename', d.filename, 'created_at', d.created_at) ORDER BY d.id) FROM documents d WHERE d.request_id = r.id) AS files
    FROM doc_requests r JOIN clients cl ON cl.id = r.client_id LEFT JOIN cases cs ON cs.id = r.case_id ORDER BY (r.status = 'recibida'), r.due_date NULLS LAST LIMIT 500`)).rows));
}));
app.post('/api/requests', auth(...STAFF), wrap(async (req, res) => {
  const b = req.body; need(str(b.title), 'Indique el documento solicitado');
  res.json(await db(req, async c => {
    let clientId = int(b.client_id);
    if (b.case_id) clientId = (await c.query('SELECT client_id FROM cases WHERE id = $1', [int(b.case_id)])).rows[0]?.client_id;
    need(clientId, 'Indique el cliente');
    const r = (await c.query('INSERT INTO doc_requests (client_id, case_id, title, description, due_date, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [clientId, int(b.case_id), b.title.trim(), str(b.description), str(b.due_date), req.user.id])).rows[0];
    await A(c, req, 'solicitar_documento', 'solicitud', r.id, clientId, { title: r.title });
    return r;
  }));
}));
app.patch('/api/requests/:id', auth(...STAFF), wrap(async (req, res) => {
  const b = req.body; need(['pendiente', 'recibida', 'devuelta'].includes(b.status), 'Estado inválido');
  if (b.status === 'devuelta') need(str(b.staff_note), 'Indique qué debe corregir el cliente');
  res.json(await db(req, async c => {
    const r = (await c.query('UPDATE doc_requests SET status = $2, staff_note = coalesce($3, staff_note), updated_at = now() WHERE id = $1 RETURNING *', [int(req.params.id), b.status, str(b.staff_note)])).rows[0];
    need(r, 'No encontrada', 404); await A(c, req, 'marcar_' + b.status, 'solicitud', r.id, r.client_id, { note: b.staff_note }); return r;
  }));
}));

// ───────── documentos PDF generados
app.get('/api/gendocs', auth(...STAFF), wrap(async (req, res) => {
  const p = [str(req.query.type), int(req.query.client_id), str(req.query.q)];
  res.json(await db(req, async c => (await c.query(`SELECT g.id, g.doc_type, g.number, g.version, g.title, g.status, g.shared, g.created_at, g.void_reason, g.client_id, cl.name AS client_name, u.name AS author
    FROM generated_docs g JOIN clients cl ON cl.id = g.client_id LEFT JOIN users u ON u.id = g.created_by
    WHERE ($1::text IS NULL OR g.doc_type = $1) AND ($2::int IS NULL OR g.client_id = $2) AND ($3::text IS NULL OR g.number ILIKE '%'||$3||'%' OR g.title ILIKE '%'||$3||'%')
    ORDER BY g.created_at DESC LIMIT 500`, p)).rows));
}));
const GEN_ROLES = { cotizacion: ['admin', 'expedientes', 'cobros'], recibo_documentos: STAFF, estado_cuenta: ['admin', 'cobros', 'expedientes'], informe_avance: ['admin', 'expedientes'],
  ficha_cliente: STAFF, ficha_expediente: ['admin', 'expedientes'], recibo_dinero: ['admin', 'cobros'], factura: ['admin', 'cobros'] };
app.post('/api/gendocs/preview', auth(...STAFF), wrap(async (req, res) => {
  const { doc_type, params } = req.body; need(GEN_ROLES[doc_type]?.includes(req.user.role), 'No autorizado para este documento', 403);
  const pdf = await db(req, c => S.renderPreview(c, doc_type, params || {}, req.user));
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="vista-previa.pdf"', 'Cache-Control': 'no-store' }).send(pdf);
}));
app.post('/api/gendocs', auth(...STAFF), wrap(async (req, res) => {
  const { doc_type, params, share } = req.body;
  need(GEN_ROLES[doc_type]?.includes(req.user.role), 'No autorizado para este documento', 403);
  need(doc_type !== 'recibo_dinero', 'Los recibos de dinero se emiten al validar un pago');
  need(doc_type !== 'factura', 'Las facturas se emiten desde el módulo de Facturas');
  const gd = await db(req, c => doc_type === 'cotizacion' ? S.issueQuoteVersion(c, int(params.quote_id), req.user, { share, ip: req.ip }) : S.issueDocument(c, doc_type, params || {}, req.user, { share, ip: req.ip }));
  res.json({ id: gd.id, number: gd.number, version: gd.version });
}));
app.get('/api/gendocs/:id', auth(...STAFF), wrap(async (req, res) => {
  const r = await db(req, async c => {
    const g = (await c.query('SELECT g.*, u.name AS author, v.name AS voided_by_name FROM generated_docs g LEFT JOIN users u ON u.id = g.created_by LEFT JOIN users v ON v.id = g.voided_by WHERE g.id = $1', [int(req.params.id)])).rows[0];
    if (!g) return null;
    g.versions = (await c.query('SELECT g.id, g.version, g.status, g.created_at, u.name AS author FROM generated_docs g LEFT JOIN users u ON u.id = g.created_by WHERE doc_type = $1 AND number = $2 ORDER BY version', [g.doc_type, g.number])).rows;
    return g;
  });
  if (!r) return res.status(404).json({ error: 'No encontrado' });
  res.json(r);
}));
app.get('/api/gendocs/:id/pdf', auth(), wrap(async (req, res) => {
  const g = await db(req, async c => {
    const g = (await c.query('SELECT id, client_id, number, version, doc_type, storage_key, void_storage_key, status FROM generated_docs WHERE id = $1', [int(req.params.id)])).rows[0];
    await A(c, req, g ? 'descargar' : 'acceso_denegado', 'documento_pdf', req.params.id, g?.client_id, null);
    return g;
  });
  if (!g) return res.status(404).json({ error: 'Documento no encontrado o sin autorización' });
  const key = g.status === 'anulado' && g.void_storage_key && req.query.original !== '1' ? g.void_storage_key : g.storage_key;
  sendFile(res, S.filePath(key), `${g.number}${g.version > 1 ? '-v' + g.version : ''}${g.status === 'anulado' ? '-ANULADO' : ''}.pdf`, 'application/pdf', req.query.inline === '1');
}));
app.post('/api/gendocs/:id/share', auth(...STAFF), wrap(async (req, res) => {
  res.json(await db(req, async c => {
    const g = (await c.query('UPDATE generated_docs SET shared = $2 WHERE id = $1 RETURNING id, client_id, number', [int(req.params.id), !!req.body.shared])).rows[0];
    need(g, 'No encontrado', 404); await A(c, req, req.body.shared ? 'compartir' : 'dejar_de_compartir', 'documento_pdf', g.id, g.client_id, { number: g.number }); return { ok: true };
  }));
}));
app.post('/api/gendocs/:id/new-version', auth(...STAFF), wrap(async (req, res) => {
  res.json(await db(req, async c => {
    const g = (await c.query('SELECT * FROM generated_docs WHERE id = $1 FOR UPDATE', [int(req.params.id)])).rows[0];
    need(g, 'No encontrado', 404); need(g.status === 'vigente', 'Solo se corrige la versión vigente', 409);
    need(GEN_ROLES[g.doc_type]?.includes(req.user.role), 'No autorizado', 403);
    const params = { ...(g.data._params || {}), ...(req.body.params || {}) };
    const nv = await S.issueDocument(c, g.doc_type, params, req.user, { parent: g, ip: req.ip });
    return { id: nv.id, version: nv.version };
  }));
}));
app.post('/api/gendocs/:id/void', auth('admin', 'cobros'), wrap(async (req, res) => {
  const reason = str(req.body.reason); need(reason, 'El motivo de anulación es obligatorio');
  res.json(await db(req, async c => {
    const g = (await c.query('SELECT * FROM generated_docs WHERE id = $1 FOR UPDATE', [int(req.params.id)])).rows[0];
    need(g, 'No encontrado', 404); need(g.status === 'vigente', 'Este documento ya no está vigente', 409);
    await S.voidDocument(c, g, reason, req.user, req.ip);
    if (g.doc_type === 'recibo_dinero' && g.payment_id) {
      await c.query("UPDATE payments SET status = 'anulado', void_reason = $2 WHERE id = $1 AND status = 'validado'", [g.payment_id, reason]);
      await A(c, req, 'anular', 'pago', g.payment_id, g.client_id, { reason, receipt: g.number });
    }
    return { ok: true };
  }));
}));

// ───────── buscador global y consultas
app.get('/api/search', auth(...STAFF), wrap(async (req, res) => {
  const q = str(req.query.q); if (!q || q.length < 2) return res.json({});
  const like = '%' + q + '%'; const dig = '%' + q.replace(/[^0-9A-Za-z]/g, '') + '%';
  res.json(await db(req, async c => ({
    clients: (await c.query(`SELECT id, name, id_type, id_number, kind FROM clients WHERE name ILIKE $1 OR trade_name ILIKE $1 OR (length($2) > 3 AND id_digits ILIKE $2) OR email ILIKE $1 ORDER BY name LIMIT 20`, [like, dig])).rows,
    cases: (await c.query(`SELECT cs.id, cs.code, cs.title, cs.institution, cs.official_number, cs.status, cl.name AS client_name FROM cases cs JOIN clients cl ON cl.id = cs.client_id
      WHERE cs.code ILIKE $1 OR cs.official_number ILIKE $1 OR cs.title ILIKE $1 OR cs.institution ILIKE $1 OR cs.fiscal_periods ILIKE $1 OR cs.matter ILIKE $1 ORDER BY cs.opened_on DESC LIMIT 20`, [like])).rows,
    documents: (await c.query(`SELECT d.id, d.title, d.resolution_number, d.institution, d.category, d.filename, d.doc_date, d.case_id, cs.code AS case_code, cl.name AS client_name FROM documents d
      JOIN clients cl ON cl.id = d.client_id LEFT JOIN cases cs ON cs.id = d.case_id
      LEFT JOIN doc_types t ON t.id = d.doc_type_id
      WHERE d.resolution_number ILIKE $1 OR d.title ILIKE $1 OR d.filename ILIKE $1 OR d.institution ILIKE $1 OR t.name ILIKE $1 ORDER BY d.created_at DESC LIMIT 20`, [like])).rows,
    quotes: (await c.query(`SELECT q.id, q.number, q.title, q.total, q.status, cl.name AS client_name FROM quotes q JOIN clients cl ON cl.id = q.client_id WHERE q.number ILIKE $1 OR q.title ILIKE $1 LIMIT 20`, [like])).rows,
    gendocs: (await c.query(`SELECT g.id, g.doc_type, g.number, g.version, g.title, g.status FROM generated_docs g WHERE (g.number ILIKE $1 OR g.title ILIKE $1) AND g.status <> 'reemplazado' LIMIT 20`, [like])).rows,
    payments: (await c.query(`SELECT p.id, p.reference, p.amount_declared, p.status, cl.name AS client_name FROM payments p JOIN clients cl ON cl.id = p.client_id WHERE p.reference ILIKE $1 LIMIT 20`, [like])).rows,
  })));
}));

// Consultas con filtros (misma función para pantalla y exportación a Excel)
const QUERIES = {
  cases: {
    label: 'Expedientes',
    build(f) {
      const w = [], p = []; const add = (sql, v) => { p.push(v); w.push(sql.replace(/\?/g, '$' + p.length)); };
      if (f.q) add("(cs.code ILIKE '%'||?||'%' OR cs.title ILIKE '%'||?||'%' OR cl.name ILIKE '%'||?||'%')", f.q);
      if (f.id_number) add("cl.id_digits ILIKE '%'||regexp_replace(?,'[^0-9A-Za-z]','','g')||'%'", f.id_number);
      if (f.code) add("cs.code ILIKE '%'||?||'%'", f.code);
      if (f.official_number) add("cs.official_number ILIKE '%'||?||'%'", f.official_number);
      if (f.resolution) add("EXISTS (SELECT 1 FROM documents d WHERE d.case_id = cs.id AND d.resolution_number ILIKE '%'||?||'%')", f.resolution);
      if (f.institution) add("cs.institution ILIKE '%'||?||'%'", f.institution);
      if (f.period) add("cs.fiscal_periods ILIKE '%'||?||'%'", f.period);
      if (f.status) add('cs.status = ?', f.status);
      if (f.responsible) add('cs.responsible_user_id = ?::int', f.responsible);
      if (f.from) add('cs.opened_on >= ?::date', f.from);
      if (f.to) add('cs.opened_on <= ?::date', f.to);
      return { sql: `SELECT cs.id, cs.code, cl.name AS client_name, cl.id_number, cs.title, cs.institution, cs.official_number, cs.fiscal_periods, cs.status, u.name AS responsible_name, cs.opened_on, cs.next_action, cs.next_action_date
        FROM cases cs JOIN clients cl ON cl.id = cs.client_id LEFT JOIN users u ON u.id = cs.responsible_user_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY cs.opened_on DESC, cs.id DESC`, p };
    },
    cols: [['code', 'Expediente', 16], ['client_name', 'Cliente', 30], ['id_number', 'Cédula/RNC', 14], ['title', 'Asunto', 34], ['institution', 'Institución', 16], ['official_number', 'No. oficial', 16],
      ['fiscal_periods', 'Períodos', 14], ['status', 'Estado', 12], ['responsible_name', 'Responsable', 18], ['opened_on', 'Apertura', 12, 'date'], ['next_action', 'Próxima acción', 30], ['next_action_date', 'Fecha próx. acción', 14, 'date']],
  },
  documents: {
    label: 'Archivos',
    build(f) {
      const w = [], p = []; const add = (sql, v) => { p.push(v); w.push(sql.replace(/\?/g, '$' + p.length)); };
      if (f.q) add("(d.title ILIKE '%'||?||'%' OR d.filename ILIKE '%'||?||'%' OR cl.name ILIKE '%'||?||'%')", f.q);
      if (f.resolution) add("d.resolution_number ILIKE '%'||?||'%'", f.resolution);
      if (f.institution) add("d.institution ILIKE '%'||?||'%'", f.institution);
      if (f.category) add('d.category = ?', f.category);
      if (f.doc_type) add('d.doc_type_id = ?::int', f.doc_type);
      if (f.scanned === 'si') w.push('d.scanned');
      if (f.id_number) add("cl.id_digits ILIKE '%'||regexp_replace(?,'[^0-9A-Za-z]','','g')||'%'", f.id_number);
      if (f.from) add('coalesce(d.doc_date, d.created_at::date) >= ?::date', f.from);
      if (f.to) add('coalesce(d.doc_date, d.created_at::date) <= ?::date', f.to);
      return { sql: `SELECT d.id, d.title, t.name AS doc_type_name, d.category, d.resolution_number, d.institution, d.doc_date, cl.name AS client_name, cs.code AS case_code, d.case_id, d.visibility, d.filename, d.created_at
        FROM documents d JOIN clients cl ON cl.id = d.client_id LEFT JOIN cases cs ON cs.id = d.case_id LEFT JOIN doc_types t ON t.id = d.doc_type_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY d.created_at DESC`, p };
    },
    cols: [['title', 'Documento', 34], ['doc_type_name', 'Tipo de documento', 22], ['category', 'Categoría', 14], ['resolution_number', 'No. resolución', 18], ['institution', 'Institución', 16], ['doc_date', 'Fecha doc.', 12, 'date'],
      ['client_name', 'Cliente', 30], ['case_code', 'Expediente', 16], ['visibility', 'Visibilidad', 10], ['filename', 'Archivo', 30]],
  },
  payments: {
    label: 'Pagos',
    build(f) {
      const w = [], p = []; const add = (sql, v) => { p.push(v); w.push(sql.replace(/\?/g, '$' + p.length)); };
      if (f.q) add("(cl.name ILIKE '%'||?||'%' OR p.reference ILIKE '%'||?||'%' OR q.number ILIKE '%'||?||'%')", f.q);
      if (f.status) add('p.status = ?', f.status);
      if (f.method) add('p.method = ?', f.method);
      if (f.from) add('p.paid_on >= ?::date', f.from);
      if (f.to) add('p.paid_on <= ?::date', f.to);
      return { sql: `SELECT p.id, p.paid_on, cl.name AS client_name, q.number AS quote_number, p.method, p.reference, p.amount_declared, p.amount_validated, p.status, p.reject_reason, uv.name AS validated_by_name
        FROM payments p JOIN clients cl ON cl.id = p.client_id JOIN quotes q ON q.id = p.quote_id LEFT JOIN users uv ON uv.id = p.validated_by ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY p.paid_on DESC, p.id DESC`, p };
    },
    cols: [['paid_on', 'Fecha', 12, 'date'], ['client_name', 'Cliente', 30], ['quote_number', 'Cotización', 16], ['method', 'Medio', 14], ['reference', 'Referencia', 18],
      ['amount_declared', 'Declarado', 14, 'money'], ['amount_validated', 'Validado', 14, 'money'], ['status', 'Estado', 12], ['validated_by_name', 'Validado por', 18], ['reject_reason', 'Motivo rechazo', 30]],
  },
  receivables: {
    label: 'Cuentas por cobrar',
    build(f) {
      const p = []; let w = '';
      if (f.q) { p.push(f.q); w = "AND (cl.name ILIKE '%'||$1||'%' OR cl.id_digits ILIKE '%'||regexp_replace($1,'[^0-9A-Za-z]','','g')||'%')"; }
      return { sql: `WITH b AS (
          SELECT q.client_id, sum(i.amount) AS billed, sum(i.amount) FILTER (WHERE i.due_date < current_date) AS due FROM installments i JOIN quotes q ON q.id = i.quote_id WHERE q.status = 'aceptada' GROUP BY q.client_id),
        pp AS (SELECT p.client_id, sum(p.amount_validated) AS paid FROM payments p JOIN quotes q ON q.id = p.quote_id WHERE p.status = 'validado' AND q.status = 'aceptada' GROUP BY p.client_id)
        SELECT cl.id, cl.name AS client_name, cl.id_number, coalesce(b.billed,0) AS billed, coalesce(pp.paid,0) AS paid, coalesce(b.billed,0) - coalesce(pp.paid,0) AS balance,
               greatest(coalesce(b.due,0) - coalesce(pp.paid,0), 0) AS overdue
        FROM clients cl JOIN b ON b.client_id = cl.id LEFT JOIN pp ON pp.client_id = cl.id WHERE true ${w} ORDER BY balance DESC`, p };
    },
    cols: [['client_name', 'Cliente', 34], ['id_number', 'Cédula/RNC', 16], ['billed', 'Cuotas', 16, 'money'], ['paid', 'Pagado', 16, 'money'], ['balance', 'Saldo', 16, 'money'], ['overdue', 'Vencido', 16, 'money']],
  },
  deadlines: {
    label: 'Vencimientos',
    build(f) {
      const w = [], p = []; const add = (sql, v) => { p.push(v); w.push(sql.replace(/\?/g, '$' + p.length)); };
      if (f.q) add("(d.title ILIKE '%'||?||'%' OR cl.name ILIKE '%'||?||'%' OR cs.code ILIKE '%'||?||'%')", f.q);
      if (f.status) add('d.status = ?', f.status);
      if (f.kind) add('d.kind = ?', f.kind);
      if (f.responsible) add('d.responsible_user_id = ?::int', f.responsible);
      if (f.from) add("d.due_at >= (?::date)::timestamp AT TIME ZONE 'America/Santo_Domingo'", f.from);
      if (f.to) add("d.due_at < ((?::date) + 1)::timestamp AT TIME ZONE 'America/Santo_Domingo'", f.to);
      return { sql: `SELECT d.id, d.due_at, d.kind, d.title, cl.name AS client_name, cs.code AS case_code, d.case_id, u.name AS responsible_name, d.confirmed, d.status
        FROM deadlines d LEFT JOIN cases cs ON cs.id = d.case_id LEFT JOIN clients cl ON cl.id = coalesce(d.client_id, cs.client_id) LEFT JOIN users u ON u.id = d.responsible_user_id
        ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY d.due_at`, p };
    },
    cols: [['due_at', 'Fecha', 18, 'datetime'], ['kind', 'Tipo', 12], ['title', 'Descripción', 40], ['client_name', 'Cliente', 30], ['case_code', 'Expediente', 16], ['responsible_name', 'Responsable', 18], ['confirmed', 'Confirmada', 10], ['status', 'Estado', 12]],
  },
  invoices: {
    label: 'Facturas',
    build(f) {
      const w = [], p = []; const add = (sql, v) => { p.push(v); w.push(sql.replace(/\?/g, '$' + p.length)); };
      if (f.q) add("(i.number ILIKE '%'||?||'%' OR cl.name ILIKE '%'||?||'%' OR i.description ILIKE '%'||?||'%')", f.q);
      if (f.from) add('i.issue_date >= ?::date', f.from);
      if (f.to) add('i.issue_date <= ?::date', f.to);
      if (f.annulled !== 'si') w.push("i.status = 'emitida'");
      return { sql: `SELECT i.id, i.number, i.issue_date, i.due_date, cl.name AS client_name, cl.id_number, i.description, i.subtotal, i.itbis, i.expenses, i.total, i.status,
          (SELECT number FROM quotes WHERE id = i.quote_id) AS quote_number
        FROM invoices i JOIN clients cl ON cl.id = i.client_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY i.issue_date DESC, i.id DESC`, p };
    },
    cols: [['number', 'NCF / Número', 16], ['issue_date', 'Emisión', 12, 'date'], ['due_date', 'Vence', 12, 'date'], ['client_name', 'Cliente', 30], ['id_number', 'RNC/Cédula', 14],
      ['description', 'Concepto', 34], ['subtotal', 'Subtotal', 14, 'money'], ['itbis', 'ITBIS', 12, 'money'], ['expenses', 'Gastos', 12, 'money'], ['total', 'Total', 14, 'money'], ['status', 'Estado', 12], ['quote_number', 'Cotización', 16]],
  },
  quotes: {
    label: 'Cotizaciones',
    build(f) {
      const w = [], p = []; const add = (sql, v) => { p.push(v); w.push(sql.replace(/\?/g, '$' + p.length)); };
      if (f.q) add("(q.number ILIKE '%'||?||'%' OR q.title ILIKE '%'||?||'%' OR cl.name ILIKE '%'||?||'%')", f.q);
      if (f.status) add('q.status = ?', f.status);
      if (f.from) add('q.created_at::date >= ?::date', f.from);
      if (f.to) add('q.created_at::date <= ?::date', f.to);
      return { sql: `SELECT q.id, q.number, q.created_at, cl.name AS client_name, q.title, q.total, q.status, q.accepted_at
        FROM quotes q JOIN clients cl ON cl.id = q.client_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY q.created_at DESC`, p };
    },
    cols: [['number', 'Número', 16], ['created_at', 'Fecha', 12, 'date'], ['client_name', 'Cliente', 30], ['title', 'Título', 36], ['total', 'Total', 16, 'money'], ['status', 'Estado', 12], ['accepted_at', 'Aceptada', 14, 'date']],
  },
};
const QUERY_ROLES = { invoices: ['admin', 'cobros'], payments: ['admin', 'cobros'], receivables: ['admin', 'cobros'], quotes: ['admin', 'cobros', 'expedientes'] };
function queryFor(req) {
  const def = QUERIES[req.params.entity]; need(def, 'Consulta no válida', 404);
  need(!QUERY_ROLES[req.params.entity] || QUERY_ROLES[req.params.entity].includes(req.user.role), 'No autorizado para esta consulta', 403);
  const f = {}; Object.entries(req.query).forEach(([k, v]) => { if (str(v)) f[k] = String(v).trim(); });
  return { def, f };
}
app.get('/api/query/:entity', auth(...STAFF), wrap(async (req, res) => {
  const { def, f } = queryFor(req); const { sql, p } = def.build(f);
  res.json({ cols: def.cols, rows: await db(req, async c => (await c.query(sql + ' LIMIT 1000', p)).rows) });
}));
function addSheet(wb, def, rows, title) {
  const ws = wb.addWorksheet((title || def.label).slice(0, 31));
  ws.columns = def.cols.map(([key, header, width, type]) => ({ key, header, width, style: type === 'money' ? { numFmt: '"RD$" #,##0.00' } : {} }));
  rows.forEach(r => ws.addRow(Object.fromEntries(def.cols.map(([k, , , t]) => [k, t === 'date' ? dateStr(r[k]) : t === 'datetime' ? dateTimeStr(r[k]) : typeof r[k] === 'boolean' ? (r[k] ? 'Sí' : 'No') : r[k]]))));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF876440' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: def.cols.length } };
  return ws;
}
async function queryRows(c, entity, f) { const { sql, p } = QUERIES[entity].build(f); return (await c.query(sql + ' LIMIT 20000', p)).rows; }
async function xlsxBuffer(sheets) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'LegalTax Consultores SRL';
  sheets.forEach(sh => addSheet(wb, QUERIES[sh.entity], sh.rows, sh.title));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
app.get('/api/query/:entity/export', auth(...STAFF), wrap(async (req, res) => {
  const { f } = queryFor(req);
  const rows = await db(req, async c => { const r = await queryRows(c, req.params.entity, f); await A(c, req, 'exportar_excel', 'consulta', req.params.entity, null, { filtros: f, filas: r.length }); return r; });
  const buf = await xlsxBuffer([{ entity: req.params.entity, rows }]);
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="LegalTax-${req.params.entity}-${S.todayISO()}.xlsx"` }).send(buf);
}));
app.get('/api/saved-queries', auth(...STAFF), wrap(async (req, res) => {
  res.json(await db(req, async c => (await c.query('SELECT * FROM saved_queries WHERE user_id = $1 ORDER BY name', [req.user.id])).rows));
}));
app.post('/api/saved-queries', auth(...STAFF), wrap(async (req, res) => {
  need(str(req.body.name) && QUERIES[req.body.entity], 'Nombre y tipo de consulta son obligatorios');
  res.json(await db(req, async c => (await c.query('INSERT INTO saved_queries (user_id, name, entity, params) VALUES ($1,$2,$3,$4) RETURNING *', [req.user.id, req.body.name.trim(), req.body.entity, req.body.params || {}])).rows[0]));
}));
app.delete('/api/saved-queries/:id', auth(...STAFF), wrap(async (req, res) => {
  await db(req, c => c.query('DELETE FROM saved_queries WHERE id = $1 AND user_id = $2', [int(req.params.id), req.user.id])); res.json({ ok: true });
}));

// ───────── administración: membrete, plantillas, numeración, auditoría
app.get('/api/settings', auth(...STAFF), wrap(async (req, res) => {
  const r = await db(req, async c => ({
    firm: (await c.query("SELECT value FROM settings WHERE key = 'firm'")).rows[0]?.value || {},
    templates: (await c.query('SELECT * FROM templates ORDER BY doc_type')).rows,
    sequences: (await c.query('SELECT * FROM doc_sequences ORDER BY doc_type')).rows,
  }));
  res.json(r);
}));
app.put('/api/settings/firm', auth('admin'), wrap(async (req, res) => {
  const f = pick(req.body, ['firm_name', 'tagline', 'rnc', 'address', 'phone', 'email', 'website', 'footer']);
  await db(req, async c => {
    await c.query("UPDATE settings SET value = value || $1::jsonb WHERE key = 'firm'", [JSON.stringify(f)]);
    await A(c, req, 'editar', 'membrete', 'firm', null, f);
  });
  res.json({ ok: true });
}));
app.post('/api/settings/logo', auth('admin'), upload.single('file'), wrap(async (req, res) => {
  need(req.file && ['image/png', 'image/jpeg'].includes(req.file.mimetype), 'El logo debe ser PNG o JPG');
  const key = S.saveSystemFile(req.file.path, 'logo' + path.extname(req.file.originalname || '.png'));
  await db(req, async c => {
    await c.query("UPDATE settings SET value = value || $1::jsonb WHERE key = 'firm'", [JSON.stringify({ logo_key: key, logo_mime: req.file.mimetype })]);
    await A(c, req, 'cambiar_logo', 'membrete', 'firm', null, null);
  });
  res.json({ ok: true });
}));
app.delete('/api/settings/logo', auth('admin'), wrap(async (req, res) => {
  await db(req, async c => { await c.query("UPDATE settings SET value = value - 'logo_key' WHERE key = 'firm'"); await A(c, req, 'quitar_logo', 'membrete', 'firm', null, null); });
  res.json({ ok: true });
}));
app.put('/api/templates/:type', auth('admin'), wrap(async (req, res) => {
  const f = pick(req.body, ['title', 'intro', 'closing', 'terms']);
  res.json(await db(req, async c => {
    const r = (await c.query('UPDATE templates SET title = coalesce($2,title), intro = coalesce($3,intro), closing = coalesce($4,closing), terms = coalesce($5,terms), updated_by = $6, updated_at = now() WHERE doc_type = $1 RETURNING *',
      [req.params.type, f.title, f.intro ?? '', f.closing ?? '', f.terms ?? '', req.user.id])).rows[0];
    need(r, 'Plantilla no encontrada', 404); await A(c, req, 'editar', 'plantilla', req.params.type, null, null); return r;
  }));
}));
app.put('/api/sequences/:type', auth('admin'), wrap(async (req, res) => {
  const b = req.body; need(/^[A-Z0-9-]{1,10}$/i.test(b.prefix || ''), 'Prefijo inválido'); need(int(b.next_number) >= 1, 'Número inválido');
  res.json(await db(req, async c => {
    const r = (await c.query(`UPDATE doc_sequences SET prefix = upper($2), next_number = $3, padding = $4, yearly = $5, year = CASE WHEN $5 THEN extract(year FROM now())::int ELSE year END,
        sep = coalesce($6, sep), max_number = $7, valid_until = $8 WHERE doc_type = $1 RETURNING *`,
      [req.params.type, b.prefix, int(b.next_number), Math.min(13, Math.max(1, int(b.padding) || 4)), !!b.yearly, b.sep === undefined ? null : (b.sep ? '-' : ''), int(b.max_number), str(b.valid_until)])).rows[0];
    need(r, 'No encontrada', 404); await A(c, req, 'editar', 'numeracion', req.params.type, null, b); return r;
  }));
}));
app.get('/api/audit', auth('admin'), wrap(async (req, res) => {
  const p = [int(req.query.client_id), str(req.query.q)];
  res.json(await db(req, async c => (await c.query(`SELECT a.*, cl.name AS client_name FROM audit_log a LEFT JOIN clients cl ON cl.id = a.client_id
    WHERE ($1::int IS NULL OR a.client_id = $1) AND ($2::text IS NULL OR a.user_name ILIKE '%'||$2||'%' OR a.action ILIKE '%'||$2||'%' OR a.entity ILIKE '%'||$2||'%')
    ORDER BY a.id DESC LIMIT 500`, p)).rows));
}));

// ───────── portal de clientes (todas las consultas pasan por RLS con app.client_id)
app.get('/api/portal', auth('cliente'), wrap(async (req, res) => {
  res.json(await db(req, async c => {
    const cid = req.user.client_id;
    return {
      client: (await c.query('SELECT id, name, id_type, id_number, email, phone FROM clients WHERE id = $1', [cid])).rows[0],
      cases: (await c.query(`SELECT cs.id, cs.code, cs.title, cs.institution, cs.official_number, cs.fiscal_periods, cs.status, cs.public_status, cs.next_action, cs.next_action_date,
          (SELECT max(event_date) FROM case_events e WHERE e.case_id = cs.id) AS last_update FROM cases cs ORDER BY cs.opened_on DESC`)).rows,
      quotes: (await c.query('SELECT id, number, title, total, status, published_at, accepted_at, valid_until FROM quotes ORDER BY published_at DESC')).rows,
      payments: (await c.query(`SELECT p.id, p.quote_id, p.amount_declared, p.amount_validated, p.method, p.reference, p.paid_on, p.status, p.reject_reason, p.created_at, q.number AS quote_number,
          (SELECT id FROM generated_docs g WHERE g.payment_id = p.id AND g.doc_type = 'recibo_dinero' ORDER BY version DESC LIMIT 1) AS receipt_id
        FROM payments p JOIN quotes q ON q.id = p.quote_id ORDER BY p.created_at DESC`)).rows,
      requests: (await c.query(`SELECT r.id, r.title, r.description, r.due_date, r.status, r.staff_note, r.client_note, r.updated_at, cs.code AS case_code,
          (SELECT count(*)::int FROM documents d WHERE d.request_id = r.id) AS files FROM doc_requests r LEFT JOIN cases cs ON cs.id = r.case_id ORDER BY (r.status = 'recibida'), r.due_date NULLS LAST`)).rows,
      gendocs: (await c.query('SELECT id, doc_type, number, version, title, status, created_at FROM generated_docs ORDER BY created_at DESC')).rows,
      documents: (await c.query('SELECT id, title, category, filename, created_at, uploaded_by_client, case_id FROM documents ORDER BY created_at DESC')).rows,
      account: await S.account(c, cid),
      invoices: await invoiceList(c, 'i.client_id = $1', [cid]),
    };
  }));
}));
app.get('/api/portal/cases/:id', auth('cliente'), wrap(async (req, res) => {
  const r = await db(req, async c => {
    const cs = (await c.query('SELECT id, code, title, institution, official_number, fiscal_periods, status, public_status, next_action, next_action_date, opened_on FROM cases WHERE id = $1', [int(req.params.id)])).rows[0];
    if (!cs) return null;
    return { case: cs,
      events: (await c.query('SELECT id, kind, title, description, event_date, document_id FROM case_events WHERE case_id = $1 ORDER BY event_date DESC, id DESC', [cs.id])).rows,
      documents: (await c.query('SELECT d.id, d.title, d.category, d.filename, d.created_at, d.doc_date, t.name AS doc_type_name FROM documents d LEFT JOIN doc_types t ON t.id = d.doc_type_id WHERE d.case_id = $1 ORDER BY d.created_at DESC', [cs.id])).rows,
      gendocs: (await c.query('SELECT id, doc_type, number, version, title, status, created_at FROM generated_docs WHERE case_id = $1 ORDER BY created_at DESC', [cs.id])).rows };
  });
  if (!r) return res.status(404).json({ error: 'Expediente no encontrado' });
  res.json(r);
}));
app.get('/api/portal/quotes/:id', auth('cliente'), wrap(async (req, res) => {
  const r = await db(req, c => quoteDetail(c, int(req.params.id)));
  if (!r) return res.status(404).json({ error: 'Cotización no encontrada' });
  res.json(r);
}));
app.post('/api/portal/quotes/:id/accept', auth('cliente'), wrap(async (req, res) => {
  const r = await db(req, async c => ({ ...(await acceptQuote(c, req, int(req.params.id), req.body.decision, req.body.note)), q: (await c.query('SELECT q.number, q.title, q.total, cl.name FROM quotes q JOIN clients cl ON cl.id = q.client_id WHERE q.id = $1', [int(req.params.id)])).rows[0] }));
  notify(`Cotización ${r.q.number} ${r.status} por el cliente`, `<p><b>${esc(r.q.name)}</b> marcó la cotización <b>${esc(r.q.number)}</b> (${esc(r.q.title)}) como <b>${r.status}</b>.</p><p>Total: <b>${money(r.q.total)}</b>${req.body.note ? '<br>Comentario: ' + esc(req.body.note) : ''}</p>`);
  res.json({ status: r.status });
}));
app.post('/api/portal/payments', auth('cliente'), upload.single('file'), wrap(async (req, res) => {
  try {
    need(req.file, 'Adjunte el comprobante (imagen o PDF)');
    const p = await db(req, c => insertPayment(c, req, req.body, req.file, req.user.client_id));
    notify(`Nuevo voucher por validar — ${state(req).client} — ${money(p.amount_declared)}`, `<p><b>${esc(state(req).client)}</b> subió un comprobante de pago que está <b>pendiente de validación</b>.</p>
      <p>Monto declarado: <b>${money(p.amount_declared)}</b><br>Medio: ${esc(p.method)} ${p.bank ? '· ' + esc(p.bank) : ''}<br>Referencia: ${esc(p.reference || '—')}<br>Fecha del pago: ${dateStr(p.paid_on)}</p>
      <p>Ingrese a LegalTax → Vouchers y pagos para validarlo o rechazarlo.</p>`);
    res.json(p);
  } finally { if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); }
}));
app.post('/api/portal/requests/:id/respond', auth('cliente'), upload.single('file'), wrap(async (req, res) => {
  try {
    need(req.file, 'Adjunte el documento solicitado');
    res.json(await db(req, async c => {
      const r = (await c.query('SELECT * FROM doc_requests WHERE id = $1', [int(req.params.id)])).rows[0];
      need(r, 'Solicitud no encontrada', 404); need(r.status !== 'recibida', 'Esta solicitud ya fue recibida', 409);
      const key = await S.saveUpload(c, req.file.path, req.file.originalname, { clientId: r.client_id, caseId: r.case_id, label: 'Enviado por el cliente' });
      await c.query(`INSERT INTO documents (client_id, case_id, request_id, category, title, storage_key, filename, mime, size_bytes, visibility, uploaded_by, uploaded_by_client)
        VALUES ($1,$2,$3,'otro',$4,$5,$6,$7,$8,'cliente',$9,true)`, [r.client_id, r.case_id, r.id, r.title, key, req.file.originalname, req.file.mimetype, req.file.size, req.user.id]);
      await c.query("UPDATE doc_requests SET status = 'pendiente', client_note = $2, updated_at = now() WHERE id = $1", [r.id, str(req.body.note)]);
      await A(c, req, 'responder_solicitud', 'solicitud', r.id, r.client_id, { file: req.file.originalname });
      notify(`Documento recibido del cliente — ${r.title}`, `<p><b>${esc(state(req).client)}</b> envió el documento solicitado <b>${esc(r.title)}</b> (archivo: ${esc(req.file.originalname)}).</p>${req.body.note ? '<p>Comentario: ' + esc(req.body.note) + '</p>' : ''}<p>Revíselo en LegalTax → Solicitudes de documentos.</p>`);
      return { ok: true };
    }));
  } finally { if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); }
}));

// ───────── correo
const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const state = req => ({ client: req.session.clientName || req.user.name });
async function firmSettings() { return (await pool.query("SELECT value FROM settings WHERE key = 'firm'")).rows[0]?.value || {}; }
function notify(subject, html) { firmSettings().then(f => M.notifyFirm(subject, html, f, S.BRAND_LOGO)).catch(() => {}); }
const msgBlock = m => (m ? `<p style="white-space:pre-wrap">${esc(m)}</p>` : '');

app.get('/api/email/config', auth(...STAFF), wrap(async (req, res) => {
  const cfg = await db(req, c => M.getConfig(c));
  const pub = M.publicConfig(cfg);
  res.json(req.user.role === 'admin' ? pub : { inbox: pub.inbox, configured: pub.configured });
}));
app.put('/api/email/config', auth('admin'), wrap(async (req, res) => {
  const f = pick(req.body, ['host', 'port', 'secure', 'user', 'from_name', 'inbox', 'notify_events', 'daily_report', 'daily_time', 'pass',
    'client_receipts', 'client_invoices', 'client_reminders', 'reminder_days', 'overdue_reminders', 'portal_url']);
  if (f.reminder_days !== undefined) f.reminder_days = Math.min(30, Math.max(0, int(f.reminder_days) || 0));
  if (f.inbox) need(M.isEmail(f.inbox), 'Correo del despacho inválido');
  if (f.user) need(M.isEmail(f.user), 'Usuario SMTP inválido');
  if (f.port) f.port = int(f.port);
  if (f.daily_time) need(/^\d{2}:\d{2}$/.test(f.daily_time), 'Hora inválida');
  await db(req, async c => { await M.saveConfig(c, f); await A(c, req, 'editar', 'correo', 'smtp', null, { ...f, pass: f.pass ? '***' : undefined }); });
  res.json({ ok: true });
}));
app.post('/api/email/test', auth('admin'), wrap(async (req, res) => {
  const firm = await firmSettings();
  await db(req, async c => { const cfg = await M.getConfig(c);
    await M.send(c, req.user, { to: req.body.to || cfg.inbox, subject: 'Prueba de correo — LegalTax', kind: 'prueba', attachments: [M.logoAttachment(S.BRAND_LOGO)],
      html: M.layout('Correo configurado correctamente', `<p>Este es un mensaje de prueba enviado desde LegalTax por ${esc(req.user.name)}.</p>`, firm) }); });
  res.json({ ok: true });
}));
app.get('/api/email/log', auth(...STAFF), wrap(async (req, res) => {
  res.json(await db(req, async c => (await c.query('SELECT e.*, u.name AS sent_by_name FROM email_log e LEFT JOIN users u ON u.id = e.sent_by ORDER BY e.id DESC LIMIT 300')).rows));
}));
// Enviar un PDF emitido
app.post('/api/email/gendoc/:id', auth(...STAFF), wrap(async (req, res) => {
  const firm = await firmSettings();
  await db(req, async c => {
    const g = (await c.query('SELECT * FROM generated_docs WHERE id = $1', [int(req.params.id)])).rows[0]; need(g, 'Documento no encontrado', 404);
    const key = g.status === 'anulado' && g.void_storage_key ? g.void_storage_key : g.storage_key;
    const fname = `${g.number}${g.version > 1 ? '-v' + g.version : ''}${g.status === 'anulado' ? '-ANULADO' : ''}.pdf`;
    const label = S.LABELS[g.doc_type] || 'Documento';
    await M.send(c, req.user, { to: req.body.to, cc: req.body.cc, kind: 'pdf', ref: g.number, clientId: g.client_id,
      subject: str(req.body.subject) || `${label} ${g.number} — ${g.data.client?.name || ''}`,
      html: M.layout(`${label} ${g.number}`, `${msgBlock(req.body.message)}<p>Adjunto encontrará el documento <b>${esc(g.title)}</b>${g.status === 'anulado' ? ' <b style="color:#B3261E">(ANULADO)</b>' : ''}.</p>`, firm),
      attachments: [{ filename: fname, path: S.filePath(key), contentType: 'application/pdf' }, M.logoAttachment(S.BRAND_LOGO)] });
    await A(c, req, 'enviar_correo', 'documento_pdf', g.id, g.client_id, { to: req.body.to, cc: req.body.cc });
  });
  res.json({ ok: true });
}));
// Enviar el resultado de una consulta en Excel
app.post('/api/email/query/:entity', auth(...STAFF), wrap(async (req, res) => {
  req.query = req.body.filters || {}; const { def, f } = queryFor(req);
  const firm = await firmSettings();
  await db(req, async c => {
    const rows = await queryRows(c, req.params.entity, f);
    const buf = await xlsxBuffer([{ entity: req.params.entity, rows }]);
    const filtros = Object.entries(f).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(' · ') || 'sin filtros';
    await M.send(c, req.user, { to: req.body.to, cc: req.body.cc, kind: 'excel', ref: req.params.entity,
      subject: str(req.body.subject) || `Reporte de ${def.label} — ${dateStr(S.todayISO())}`,
      html: M.layout(`Reporte: ${def.label}`, `${msgBlock(req.body.message)}<p>Se adjunta el reporte en Excel con <b>${rows.length}</b> registro(s).</p><p style="color:#7A6E62;font-size:13px">Filtros: ${filtros}</p>`, firm),
      attachments: [{ filename: `LegalTax-${req.params.entity}-${S.todayISO()}.xlsx`, content: buf }, M.logoAttachment(S.BRAND_LOGO)] });
    await A(c, req, 'enviar_correo', 'consulta', req.params.entity, null, { to: req.body.to, filas: rows.length });
  });
  res.json({ ok: true });
}));
// Reporte del día (resumen + Excel con varias hojas)
async function dailyReport(c) {
  const one = async sql => (await c.query(sql)).rows[0];
  const k = {
    active: (await one("SELECT count(*)::int n FROM cases WHERE status IN ('abierto','en_tramite','en_espera')")).n,
    overdue: (await one("SELECT count(*)::int n FROM deadlines WHERE status = 'pendiente' AND due_at < now()")).n,
    vouchers: (await one("SELECT count(*)::int n FROM payments WHERE status = 'pendiente'")).n,
    quotes: (await one("SELECT count(*)::int n FROM quotes WHERE status = 'publicada'")).n,
  };
  const recv = await queryRows(c, 'receivables', {});
  const dls = (await queryRows(c, 'deadlines', { status: 'pendiente', to: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(new Date(Date.now() + 7 * 864e5)) }));
  const pays = await queryRows(c, 'payments', { status: 'pendiente' });
  const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(new Date(Date.now() - 864e5));
  const validated = await queryRows(c, 'payments', { status: 'validado', from: yesterday });
  const total = S.round2(recv.reduce((s2, r) => s2 + Number(r.balance), 0)), overdueAmt = S.round2(recv.reduce((s2, r) => s2 + Number(r.overdue), 0));
  const td = 'style="padding:6px 8px;border-bottom:1px solid #EEE"';
  const tile = (v, l) => `<td style="padding:10px;background:#F7F5F2;border-radius:6px;text-align:center"><div style="font-size:20px;font-weight:bold;color:#876440">${v}</div><div style="font-size:12px;color:#7A6E62">${l}</div></td>`;
  const html = `<table width="100%" cellspacing="6"><tr>${tile(k.active, 'Expedientes activos')}${tile(k.overdue, 'Tareas atrasadas')}${tile(k.vouchers, 'Vouchers por validar')}${tile(k.quotes, 'Cotizaciones pendientes')}</tr></table>
    <p><b>Saldo por cobrar:</b> ${money(total)} · <b>Vencido:</b> <span style="color:#B3261E">${money(overdueAmt)}</span></p>
    <h3 style="color:#876440;font-size:15px">Vencimientos de los próximos 7 días</h3>
    ${dls.length ? `<table width="100%" style="border-collapse:collapse;font-size:13px">${dls.slice(0, 25).map(d => `<tr><td ${td}>${dateTimeStr(d.due_at)}</td><td ${td}><b>${esc(d.title)}</b><br><span style="color:#7A6E62">${esc(d.client_name || '')} ${esc(d.case_code || '')}</span></td><td ${td}>${esc(d.responsible_name || '')}</td></tr>`).join('')}</table>` : '<p style="color:#7A6E62">Sin vencimientos.</p>'}
    <h3 style="color:#876440;font-size:15px">Vouchers pendientes de validar</h3>
    ${pays.length ? `<table width="100%" style="border-collapse:collapse;font-size:13px">${pays.map(p => `<tr><td ${td}>${dateStr(p.paid_on)}</td><td ${td}>${esc(p.client_name)}<br><span style="color:#7A6E62">${esc(p.quote_number)} · ${esc(p.reference || '')}</span></td><td ${td} align="right">${money(p.amount_declared)}</td></tr>`).join('')}</table>` : '<p style="color:#7A6E62">No hay vouchers pendientes.</p>'}
    <h3 style="color:#876440;font-size:15px">Pagos validados desde ayer</h3>
    ${validated.length ? `<table width="100%" style="border-collapse:collapse;font-size:13px">${validated.map(p => `<tr><td ${td}>${esc(p.client_name)}</td><td ${td}>${esc(p.quote_number)}</td><td ${td} align="right">${money(p.amount_validated)}</td></tr>`).join('')}</table>` : '<p style="color:#7A6E62">Ninguno.</p>'}
    <p style="font-size:13px;color:#7A6E62">Se adjunta el Excel con cuentas por cobrar, vencimientos y vouchers pendientes.</p>`;
  const buf = await xlsxBuffer([{ entity: 'receivables', rows: recv }, { entity: 'deadlines', rows: dls, title: 'Vencimientos 7 días' }, { entity: 'payments', rows: pays, title: 'Vouchers pendientes' }]);
  return { html, buf };
}
async function sendDaily(c, user, to) {
  const firm = await firmSettings(); const cfg = await M.getConfig(c);
  const { html, buf } = await dailyReport(c);
  const d = S.todayISO();
  await M.send(c, user, { to: to || cfg.inbox, kind: 'reporte_diario', ref: d, subject: `Reporte diario LegalTax — ${dateStr(d)}`,
    html: M.layout(`Reporte del día · ${dateStr(d)}`, html, firm), attachments: [{ filename: `LegalTax-reporte-${d}.xlsx`, content: buf }, M.logoAttachment(S.BRAND_LOGO)] });
}
app.post('/api/email/daily-report', auth('admin', 'cobros', 'expedientes'), wrap(async (req, res) => {
  await db(req, async c => { await sendDaily(c, req.user, str(req.body.to)); await A(c, req, 'enviar_correo', 'reporte_diario', S.todayISO(), null, { to: req.body.to }); });
  res.json({ ok: true });
}));
// Envío automático del reporte diario (lunes a sábado, a la hora configurada, hora de Santo Domingo)
let dailyBusy = false;
async function dailyTick() {
  if (dailyBusy) return; dailyBusy = true;
  try {
    await withCtx(SYSTEM, async c => {
      const cfg = await M.getConfig(c); if (!cfg.configured || (!cfg.daily_report && !cfg.client_reminders)) return;
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
      const g = t => parts.find(x => x.type === t).value; const now = `${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`;
      const today = S.todayISO();
      if (g('weekday') === 'Sun' || now < cfg.daily_time) return;
      if (cfg.daily_report && cfg.last_daily !== today) { await M.saveConfig(c, { last_daily: today }); await sendDaily(c, null, cfg.inbox); }
      if (cfg.client_reminders && cfg.last_reminders !== today) { await M.saveConfig(c, { last_reminders: today }); await clientReminders(c, cfg); }
    });
  } catch (e) { console.warn('Reporte diario no enviado:', e.message); } finally { dailyBusy = false; }
}

// ───────── documentos escaneados por expediente
const PDFKit = require('pdfkit');
const uploadMany = multer({ dest: path.join(S.STORAGE, 'tmp'), limits: { fileSize: 25 * 1024 * 1024, files: 40 },
  fileFilter: (req, f, cb) => cb(ALLOWED_MIME.includes(f.mimetype) ? null : S.httpError(415, `Tipo de archivo no permitido: ${f.originalname}`), ALLOWED_MIME.includes(f.mimetype)) });
app.get('/api/doc-types', auth(...STAFF), wrap(async (req, res) => {
  res.json((await pool.query(`SELECT * FROM doc_types ${req.query.all ? '' : 'WHERE active'} ORDER BY position, name`)).rows);
}));
app.post('/api/doc-types', auth('admin'), wrap(async (req, res) => {
  need(str(req.body.name), 'Indique el nombre del tipo');
  const r = (await pool.query('INSERT INTO doc_types (name, category, position) VALUES ($1, $2, (SELECT coalesce(max(position),0)+1 FROM doc_types)) RETURNING *', [req.body.name.trim(), req.body.category || 'otro'])).rows[0];
  await db(req, c => A(c, req, 'crear', 'tipo_documento', r.id, null, { name: r.name })); res.json(r);
}));
app.patch('/api/doc-types/:id', auth('admin'), wrap(async (req, res) => {
  const f = pick(req.body, ['name', 'category', 'active', 'position']);
  const keys = Object.keys(f); need(keys.length, 'Sin cambios');
  const r = (await pool.query(`UPDATE doc_types SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [int(req.params.id), ...keys.map(k => f[k])])).rows[0];
  need(r, 'No encontrado', 404); await db(req, c => A(c, req, 'editar', 'tipo_documento', r.id, null, f)); res.json(r);
}));
function imagesToPdf(files) {
  return new Promise((resolve, reject) => {
    const doc = new PDFKit({ autoFirstPage: false, info: { Title: 'Documento escaneado', Creator: 'LegalTax' } }); const ch = [];
    doc.on('data', x => ch.push(x)); doc.on('end', () => resolve(Buffer.concat(ch))); doc.on('error', reject);
    try {
      for (const f of files) {
        doc.addPage({ size: 'LETTER', margin: 18 });
        doc.image(f.path, 18, 18, { fit: [doc.page.width - 36, doc.page.height - 36], align: 'center', valign: 'center' });
      }
      doc.end();
    } catch (e) { reject(S.httpError(400, 'No se pudo leer una de las imágenes (use JPG o PNG): ' + e.message)); }
  });
}
const cleanTmp = files => files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
/** Subida de documentos (uno o varios, con su tipo) a la carpeta de un expediente o a "Documentos generales" del cliente. */
async function handleDocsUpload(req, res, getTarget) {
  const files = req.files || [];
  try {
    need(files.length, 'Seleccione al menos un archivo');
    let meta; try { meta = JSON.parse(req.body.meta || '[]'); } catch (_) { meta = []; }
    const merge = req.body.merge === '1' && files.length > 1;
    if (merge) need(files.every(f => ['image/jpeg', 'image/png'].includes(f.mimetype)), 'Para unir en un solo PDF, todas las páginas deben ser imágenes JPG o PNG');
    const out = await db(req, async c => {
      const target = await getTarget(c); // { clientId, caseId, code }
      const types = Object.fromEntries((await c.query('SELECT * FROM doc_types')).rows.map(t => [t.id, t]));
      const items = merge ? [{ meta: meta[0] || {}, files }] : files.map((f, i) => ({ meta: meta[i] || {}, files: [f] }));
      const created = [];
      for (const it of items) {
        const t = types[int(it.meta.doc_type_id)]; need(t, `Seleccione el tipo de documento${merge ? '' : ' de ' + it.files[0].originalname}`);
        const title = str(it.meta.title) || t.name;
        let key, filename, mime, size, pages = null;
        if (merge) {
          const buf = await imagesToPdf(it.files); size = buf.length; mime = 'application/pdf'; pages = it.files.length;
          filename = `${S.safeName(title, 80)}.pdf`;
          key = await S.saveBuffer(c, buf, `${S.todayISO()} ${S.safeName(t.name, 50)} - ${S.safeName(title, 70)}.pdf`, target);
        } else {
          const f = it.files[0]; filename = f.originalname; mime = f.mimetype; size = f.size;
          key = await S.saveUpload(c, f.path, f.originalname, { ...target, label: t.name });
          if (mime === 'application/pdf') { try { pages = (fs.readFileSync(S.filePath(key), 'latin1').match(/\/Type\s*\/Page[^s]/g) || []).length || null; } catch (_) { /* sin conteo */ } }
          else if (mime.startsWith('image/')) pages = 1;
        }
        const d = (await c.query(`INSERT INTO documents (client_id, case_id, category, doc_type_id, scanned, pages, notes, title, resolution_number, institution, doc_date, storage_key, filename, mime, size_bytes, visibility, uploaded_by)
          VALUES ($1,$2,$3,$4,true,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id, title, visibility`,
        [target.clientId, target.caseId || null, t.category, t.id, pages, str(it.meta.notes), title, str(it.meta.number), str(it.meta.institution), str(it.meta.doc_date),
          key, filename, mime, size, it.meta.visibility === 'cliente' ? 'cliente' : 'privado', req.user.id])).rows[0];
        created.push({ ...d, type: t.name });
      }
      if (target.caseId) {
        const summary = created.map(x => `${x.type}: ${x.title}`).join('\n');
        const allPublic = created.every(x => x.visibility === 'cliente');
        await c.query(`INSERT INTO case_events (case_id, client_id, kind, title, description, visibility, document_id, created_by) VALUES ($1,$2,'documento',$3,$4,$5,$6,$7)`,
          [target.caseId, target.clientId, `${created.length} documento(s) cargado(s)`, summary, allPublic ? 'cliente' : 'interna', created.length === 1 ? created[0].id : null, req.user.id]);
      }
      await A(c, req, 'subir_documentos', target.caseId ? 'expediente' : 'cliente', target.caseId || target.clientId, target.clientId, { documentos: created.map(x => ({ id: x.id, tipo: x.type })), unidos: merge });
      return { created };
    });
    res.json(out);
  } finally { cleanTmp(files); }
}
const UPLOADERS = ['admin', 'expedientes', 'cobros'];
app.post('/api/cases/:id/scans', auth(...UPLOADERS), uploadMany.array('files', 40), wrap((req, res) => handleDocsUpload(req, res, async c => {
  const cs = (await c.query('SELECT id, client_id FROM cases WHERE id = $1', [int(req.params.id)])).rows[0]; need(cs, 'Expediente no encontrado', 404);
  return { clientId: cs.client_id, caseId: cs.id };
})));
app.post('/api/folders/:clientId/upload', auth(...UPLOADERS), uploadMany.array('files', 40), wrap((req, res) => handleDocsUpload(req, res, async c => {
  const clientId = int(req.params.clientId); const caseId = int(req.body.case_id);
  need((await c.query('SELECT 1 FROM clients WHERE id = $1', [clientId])).rowCount, 'Cliente no encontrado', 404);
  if (caseId) need((await c.query('SELECT 1 FROM cases WHERE id = $1 AND client_id = $2', [caseId, clientId])).rowCount, 'El expediente no pertenece al cliente');
  return { clientId, caseId };
})));

// ───────── carpetas del sistema: Documentos LegalTax / Cliente / Expediente
const DOC_COLS = `d.id, d.title, d.filename, d.mime, d.size_bytes, d.pages, d.category, d.doc_type_id, t.name AS doc_type_name, d.resolution_number, d.institution, d.doc_date,
  d.visibility, d.uploaded_by_client, d.notes, d.case_id, d.created_at, d.storage_key, u.name AS uploaded_by_name`;
app.get('/api/folders', auth(...STAFF), wrap(async (req, res) => {
  res.json(await db(req, async c => (await c.query(`SELECT cl.id, cl.name, cl.id_type, cl.id_number, cl.kind, cl.folder_name,
      (SELECT count(*)::int FROM cases WHERE client_id = cl.id) AS cases,
      (SELECT count(*)::int FROM documents WHERE client_id = cl.id) AS documents,
      (SELECT count(*)::int FROM generated_docs WHERE client_id = cl.id AND status <> 'reemplazado') AS emitidos,
      greatest((SELECT max(created_at) FROM documents WHERE client_id = cl.id), (SELECT max(created_at) FROM generated_docs WHERE client_id = cl.id), cl.created_at) AS updated_at
    FROM clients cl ORDER BY cl.name`)).rows));
}));
async function folderContents(c, clientId, f) {
  const client = (await c.query('SELECT id, name, id_type, id_number, email, phone, folder_name FROM clients WHERE id = $1', [clientId])).rows[0];
  need(client, 'Cliente no encontrado', 404);
  if (!client.folder_name) client.folder_name = await S.clientFolder(c, clientId);
  const cases = (await c.query(`SELECT cs.id, cs.code, cs.title, cs.status, cs.folder_name,
      (SELECT count(*)::int FROM documents d WHERE d.case_id = cs.id AND d.category <> 'voucher') AS documents,
      (SELECT count(*)::int FROM generated_docs g WHERE g.case_id = cs.id AND g.status <> 'reemplazado') AS emitidos
    FROM cases cs WHERE cs.client_id = $1 ORDER BY cs.opened_on DESC, cs.id DESC`, [clientId])).rows;
  for (const cs of cases) if (!cs.folder_name) cs.folder_name = await S.caseFolder(c, cs.id);
  const counts = (await c.query(`SELECT
      (SELECT count(*)::int FROM documents WHERE client_id = $1 AND case_id IS NULL AND category <> 'voucher') AS general,
      (SELECT count(*)::int FROM documents WHERE client_id = $1 AND category = 'voucher') AS pagos,
      (SELECT count(*)::int FROM generated_docs WHERE client_id = $1 AND case_id IS NULL AND status <> 'reemplazado') AS emitidos`, [clientId])).rows[0];
  const out = { root: S.DOCROOT_NAME, client, cases, counts };
  if (!f) return out;
  const docs = q => c.query(`SELECT ${DOC_COLS} FROM documents d LEFT JOIN doc_types t ON t.id = d.doc_type_id LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.client_id = $1 AND ${q} ORDER BY d.created_at DESC`, [clientId]).then(r => r.rows);
  const gds = q => c.query(`SELECT g.id, g.doc_type, g.number, g.version, g.title, g.status, g.shared, g.created_at, u.name AS author FROM generated_docs g LEFT JOIN users u ON u.id = g.created_by
    WHERE g.client_id = $1 AND g.status <> 'reemplazado' AND ${q} ORDER BY g.created_at DESC`, [clientId]).then(r => r.rows);
  const m = /^case-(\d+)$/.exec(f);
  if (m) {
    const cs = cases.find(x => x.id === Number(m[1])); need(cs, 'Carpeta no encontrada', 404);
    return { ...out, folder: { key: f, name: cs.folder_name, case: cs, canUpload: true, documents: await docs(`d.case_id = ${cs.id} AND d.category <> 'voucher'`), gendocs: await gds(`g.case_id = ${cs.id}`) } };
  }
  if (f === 'general') return { ...out, folder: { key: f, name: S.SUB.general, canUpload: true, documents: await docs(`d.case_id IS NULL AND d.category <> 'voucher'`), gendocs: [] } };
  if (f === 'emitidos') return { ...out, folder: { key: f, name: S.SUB.emitidos, canUpload: false, documents: [], gendocs: await gds('g.case_id IS NULL') } };
  if (f === 'pagos') return { ...out, folder: { key: f, name: S.SUB.pagos, canUpload: false, documents: await docs(`d.category = 'voucher'`), gendocs: [] } };
  throw S.httpError(404, 'Carpeta no encontrada');
}
app.get('/api/folders/:clientId', auth(...STAFF), wrap(async (req, res) => {
  const r = await db(req, c => folderContents(c, int(req.params.clientId), str(req.query.f)));
  if (r.folder) r.folder.documents.forEach(d => delete d.storage_key);
  res.json(r);
}));
// Descargar una carpeta completa (cliente o expediente) en un archivo ZIP con la misma estructura
app.get('/api/folders/:clientId/zip', auth(...STAFF), wrap(async (req, res) => {
  const clientId = int(req.params.clientId); const only = str(req.query.f);
  const entries = await db(req, async c => {
    const base = await folderContents(c, clientId);
    const keys = only ? [only] : [...base.cases.map(x => 'case-' + x.id), 'general', 'emitidos', 'pagos'];
    const list = [];
    for (const k of keys) {
      const r = await folderContents(c, clientId, k);
      const caseDir = r.folder.case ? r.folder.case.folder_name : null;
      for (const d of r.folder.documents) list.push({ file: S.filePath(d.storage_key), name: [caseDir || r.folder.name, path.basename(d.storage_key)].join('/') });
      for (const g of r.folder.gendocs) {
        const full = (await c.query('SELECT storage_key, void_storage_key, status FROM generated_docs WHERE id = $1', [g.id])).rows[0];
        const key = full.status === 'anulado' && full.void_storage_key ? full.void_storage_key : full.storage_key;
        list.push({ file: S.filePath(key), name: [caseDir, S.SUB.emitidos, path.basename(key)].filter(Boolean).join('/') });
      }
    }
    await A(c, req, 'descargar_carpeta', 'cliente', clientId, clientId, { carpeta: only || 'completa', archivos: list.length });
    return { list, client: base.client };
  });
  const zipName = `${entries.client.folder_name}${only ? ' - ' + (only.startsWith('case-') ? 'expediente' : S.SUB[only] || only) : ''}.zip`;
  const ascii = zipName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(zipName)}`, 'Cache-Control': 'private, no-store' });
  const archiver = require('archiver'); const zip = archiver('zip', { zlib: { level: 6 } });
  zip.on('error', () => res.destroy()); zip.pipe(res);
  const root = `${S.DOCROOT_NAME}/${entries.client.folder_name}`;
  for (const e of entries.list) if (fs.existsSync(e.file)) zip.file(e.file, { name: `${root}/${e.name}` });
  if (!entries.list.length) zip.append('Carpeta sin documentos.\n', { name: `${root}/LEEME.txt` });
  await zip.finalize();
}));

// ───────── facturas
const INV_TONE = { pagada: 'ok', vencida: 'bad', parcial_vencida: 'bad', parcial: 'gold', pendiente: 'warn', anulada: 'bad' };
async function invoiceList(c, where, params) {
  const rows = (await c.query(`SELECT i.*, cl.name AS client_name, cl.email AS client_email, cl.phone AS client_phone, q.number AS quote_number, ins.seq AS inst_seq
    FROM invoices i JOIN clients cl ON cl.id = i.client_id JOIN quotes q ON q.id = i.quote_id LEFT JOIN installments ins ON ins.id = i.installment_id
    WHERE ${where} ORDER BY i.issue_date DESC, i.id DESC LIMIT 1000`, params)).rows;
  const accs = {};
  for (const r of rows) {
    if (r.installment_id && !accs[r.client_id]) accs[r.client_id] = await S.account(c, r.client_id);
    r.state = await S.invoiceStatus(c, r, accs[r.client_id]); r.state.tone = INV_TONE[r.state.code];
  }
  return rows;
}
app.get('/api/invoices', auth(...STAFF), wrap(async (req, res) => {
  const p = []; let w = 'true';
  if (int(req.query.client_id)) { p.push(int(req.query.client_id)); w = 'i.client_id = $1'; }
  let rows = await db(req, c => invoiceList(c, w, p));
  const st = str(req.query.state);
  if (st === 'pendientes') rows = rows.filter(r => ['pendiente', 'parcial'].includes(r.state.code));
  else if (st === 'vencidas') rows = rows.filter(r => ['vencida', 'parcial_vencida'].includes(r.state.code));
  else if (st) rows = rows.filter(r => r.state.code === st);
  res.json(rows);
}));
app.post('/api/invoices', auth('admin', 'cobros'), wrap(async (req, res) => {
  const b = req.body; const quoteId = int(b.quote_id); need(quoteId, 'Seleccione la cotización');
  const out = await db(req, async c => {
    const q = (await c.query('SELECT * FROM quotes WHERE id = $1', [quoteId])).rows[0];
    need(q, 'Cotización no encontrada', 404); need(q.status === 'aceptada', 'Solo se facturan cotizaciones aceptadas', 409);
    const instId = int(b.installment_id); let total, itbis, expenses, defDue, desc;
    if (instId) {
      const ins = (await c.query('SELECT * FROM installments WHERE id = $1 AND quote_id = $2', [instId, quoteId])).rows[0]; need(ins, 'Cuota no encontrada', 404);
      total = ins.amount; itbis = S.round2(total * q.itbis / q.total); expenses = S.round2(total * q.expenses_total / q.total); defDue = ins.due_date;
      desc = `${q.title} — cuota #${ins.seq}`;
    } else { total = q.total; itbis = q.itbis; expenses = q.expenses_total; defDue = (await c.query('SELECT max(due_date) d FROM installments WHERE quote_id = $1', [quoteId])).rows[0].d; desc = q.title; }
    const number = await S.nextNumber(c, 'factura');
    const inv = (await c.query(`INSERT INTO invoices (number, client_id, quote_id, installment_id, case_id, description, issue_date, due_date, subtotal, itbis, expenses, total, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,coalesce($7::date,current_date),$8,$9,$10,$11,$12,$13) RETURNING *`,
    [number, q.client_id, q.id, instId, q.case_id, str(b.description) || desc, str(b.issue_date), str(b.due_date) || defDue, S.round2(total - itbis - expenses), itbis, expenses, total, req.user.id])).rows[0];
    const gd = await S.issueDocument(c, 'factura', { invoice_id: inv.id }, req.user, { share: b.share !== false, ip: req.ip });
    await c.query('UPDATE invoices SET gendoc_id = $2 WHERE id = $1', [inv.id, gd.id]);
    await A(c, req, 'emitir', 'factura', inv.id, inv.client_id, { number, total });
    const cl = (await c.query('SELECT name FROM clients WHERE id = $1', [inv.client_id])).rows[0];
    return { id: inv.id, number, total, gendoc_id: gd.id, client_id: inv.client_id, client_name: cl.name, due_date: inv.due_date };
  });
  res.json(out);
  notify(`Factura generada ${out.number} — ${out.client_name} — ${money(out.total)}`, `<p>Se generó la factura <b>${esc(out.number)}</b> para <b>${esc(out.client_name)}</b> por <b>${money(out.total)}</b>, con vencimiento el ${dateStr(out.due_date)}.</p><p>Generada por ${esc(req.user.name)}.</p>`);
  if (b.notify_client) autoClientNotice(null, 'factura', out.client_id, out.id, req);
}));
app.post('/api/invoices/:id/void', auth('admin', 'cobros'), wrap(async (req, res) => {
  const reason = str(req.body.reason); need(reason, 'El motivo de anulación es obligatorio');
  res.json(await db(req, async c => {
    const inv = (await c.query("SELECT * FROM invoices WHERE id = $1 AND status = 'emitida' FOR UPDATE", [int(req.params.id)])).rows[0]; need(inv, 'Factura no encontrada o ya anulada', 404);
    await c.query("UPDATE invoices SET status = 'anulada', void_reason = $2 WHERE id = $1", [inv.id, reason]);
    const g = (await c.query("SELECT * FROM generated_docs WHERE doc_type = 'factura' AND number = $1 AND status = 'vigente'", [inv.number])).rows[0];
    if (g) await S.voidDocument(c, g, reason, req.user, req.ip);
    await A(c, req, 'anular', 'factura', inv.id, inv.client_id, { number: inv.number, reason });
    return { ok: true };
  }));
}));

// ───────── avisos al cliente (correo y WhatsApp)
const waPhone = ph => { let d = String(ph || '').replace(/\D/g, ''); if (d.length === 10 && /^(809|829|849)/.test(d)) d = '1' + d; return d.length >= 10 ? d : null; };
const portalUrl = (req, cfg) => (req ? `${req.protocol}://${req.get('host')}/` : (cfg?.portal_url || process.env.PUBLIC_URL || ''));
const first = n => String(n || '').split(/[ ,]/)[0];
/** Redacta el mensaje (texto con *negritas* estilo WhatsApp) y el PDF adjunto según el tipo de aviso. */
async function composeNotice(c, kind, clientId, ref, purl) {
  const cl = (await c.query('SELECT * FROM clients WHERE id = $1', [clientId])).rows[0]; need(cl, 'Cliente no encontrado', 404);
  const firm = (await c.query("SELECT value FROM settings WHERE key = 'firm'")).rows[0]?.value || {};
  const hello = `Saludos, ${cl.kind === 'empresa' ? (cl.representative ? first(cl.representative) : cl.name) : first(cl.name)}.`;
  const sign = `\n\n${firm.firm_name || 'LegalTax Consultores SRL'}\n${firm.phone || ''}${purl ? `\nPortal de clientes: ${purl}` : ''}`;
  let subject, body, attach = null;
  if (kind === 'aviso_pago' || kind === 'recordatorio_previo' || kind === 'recordatorio_vencido') {
    const acc = await S.account(c, clientId); const today = S.todayISO();
    let pend = acc.installments.filter(i => i.balance > 0);
    if (kind === 'recordatorio_vencido') pend = pend.filter(i => i.due_date < today);
    const lines = pend.map(i => `• ${i.quote_number} cuota #${i.seq} — vence ${dateStr(i.due_date)} — *${money(i.balance)}*${i.due_date < today ? ' (VENCIDA)' : ''}`).join('\n');
    subject = kind === 'recordatorio_vencido' ? `Cuota vencida — ${cl.name}` : kind === 'recordatorio_previo' ? `Recordatorio de pago próximo — ${cl.name}` : `Aviso de pago — ${cl.name}`;
    body = `${hello}\n\n${kind === 'recordatorio_vencido' ? 'Le informamos que tiene cuota(s) vencida(s) pendiente(s) de pago:' : 'Le recordamos el estado de sus cuotas con LegalTax:'}\n${lines || '• No tiene cuotas pendientes.'}\n\nSaldo total pendiente: *${money(acc.totals.balance)}*${acc.totals.overdue > 0 ? `\nVencido: *${money(acc.totals.overdue)}*` : ''}\n\nPuede pagar por transferencia o depósito y subir el comprobante en el portal de clientes. Si ya realizó el pago, por favor ignore este mensaje.`;
  } else if (kind === 'pago_recibido') {
    const p = (await c.query(`SELECT p.*, q.number AS quote_number, (SELECT id FROM generated_docs g WHERE g.payment_id = p.id AND g.doc_type='recibo_dinero' AND g.status <> 'reemplazado' ORDER BY version DESC LIMIT 1) AS gid
      FROM payments p JOIN quotes q ON q.id = p.quote_id WHERE p.id = $1 AND p.client_id = $2`, [int(ref), clientId])).rows[0]; need(p && p.status === 'validado', 'Pago validado no encontrado', 404);
    const g = (await c.query('SELECT * FROM generated_docs WHERE id = $1', [p.gid])).rows[0];
    const acc = await S.account(c, clientId);
    subject = `Pago recibido — Recibo ${g?.number || ''}`;
    body = `${hello}\n\nConfirmamos la recepción y validación de su pago de *${money(p.amount_validated)}* (referencia ${p.reference || '—'}) aplicado a la cotización ${p.quote_number}.\n\nRecibo: *${g?.number || ''}*\nSaldo pendiente: *${money(acc.totals.balance)}*\n\n¡Gracias por su pago!`;
    attach = g;
  } else if (kind === 'factura' || kind === 'estado_factura') {
    const inv = (await invoiceList(c, 'i.id = $1 AND i.client_id = $2', [int(ref), clientId]))[0]; need(inv, 'Factura no encontrada', 404);
    attach = (await c.query("SELECT * FROM generated_docs WHERE doc_type = 'factura' AND number = $1 AND status <> 'reemplazado' ORDER BY version DESC LIMIT 1", [inv.number])).rows[0];
    if (kind === 'factura') {
      subject = `Factura ${inv.number} — ${money(inv.total)}`;
      body = `${hello}\n\nLe compartimos la factura *${inv.number}* por *${money(inv.total)}* (${inv.description}).\nFecha de vencimiento: *${dateStr(inv.due_date)}*.\n\nPuede descargarla en el portal de clientes. Al pagar, indique el número de factura como referencia.`;
    } else {
      subject = `Estado de su factura ${inv.number}: ${inv.state.label}`;
      body = `${hello}\n\nEstado de la factura *${inv.number}* (${inv.description}):\n• Total: ${money(inv.total)}\n• Pagado: ${money(inv.state.paid)}\n• Pendiente: *${money(inv.state.balance)}*\n• Vence: ${dateStr(inv.due_date)}\n• Estado: *${inv.state.label}*`;
    }
  } else if (kind === 'documento') {
    const g = (await c.query('SELECT * FROM generated_docs WHERE id = $1 AND client_id = $2', [int(ref), clientId])).rows[0]; need(g, 'Documento no encontrado', 404);
    subject = `${S.LABELS[g.doc_type]} ${g.number}`;
    body = `${hello}\n\nLe compartimos el documento *${S.LABELS[g.doc_type]} ${g.number}*${g.shared ? ', disponible también en su portal de clientes' : ''}.`;
    attach = g;
  } else {
    subject = `Información de LegalTax Consultores`;
    body = `${hello}\n\n`;
  }
  return { client: { id: cl.id, name: cl.name, email: cl.email, phone: cl.phone }, wa_phone: waPhone(cl.phone), subject, text: body + sign,
    attachment: attach ? { id: attach.id, name: `${attach.number}${attach.version > 1 ? '-v' + attach.version : ''}${attach.status === 'anulado' ? '-ANULADO' : ''}.pdf` } : null, _attach: attach };
}
const textToHtml = t => esc(t).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
async function deliverEmail(c, user, { kind, clientId, ref, to, cc, subject, text, attach, installmentId, automatic }) {
  const firm = (await c.query("SELECT value FROM settings WHERE key = 'firm'")).rows[0]?.value || {};
  const atts = [M.logoAttachment(S.BRAND_LOGO)];
  if (attach) atts.unshift({ filename: `${attach.number}${attach.version > 1 ? '-v' + attach.version : ''}.pdf`, path: S.filePath(attach.status === 'anulado' && attach.void_storage_key ? attach.void_storage_key : attach.storage_key), contentType: 'application/pdf' });
  await M.send(c, user, { to, cc, subject, html: M.layout(subject, textToHtml(text), firm), text: text.replace(/\*/g, ''), attachments: atts, kind: 'aviso_' + kind, ref, clientId });
  await c.query('INSERT INTO notices (client_id, channel, kind, ref, installment_id, to_addr, message, automatic, sent_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [clientId, 'email', kind, ref ? String(ref) : null, installmentId || null, to, text, !!automatic, user?.id || null]);
}
const NOTICE_KINDS = ['aviso_pago', 'pago_recibido', 'factura', 'estado_factura', 'documento', 'general'];
app.get('/api/notices/compose', auth(...STAFF), wrap(async (req, res) => {
  need(NOTICE_KINDS.includes(req.query.kind), 'Tipo de aviso inválido');
  const r = await db(req, c => composeNotice(c, req.query.kind, int(req.query.client_id), req.query.ref, portalUrl(req)));
  delete r._attach; res.json(r);
}));
app.post('/api/notices/email', auth(...STAFF), wrap(async (req, res) => {
  const b = req.body; need(NOTICE_KINDS.includes(b.kind), 'Tipo de aviso inválido'); need(str(b.text), 'Escriba el mensaje');
  await db(req, async c => {
    const comp = await composeNotice(c, b.kind, int(b.client_id), b.ref, portalUrl(req));
    await deliverEmail(c, req.user, { kind: b.kind, clientId: int(b.client_id), ref: b.ref, to: b.to, cc: b.cc, subject: str(b.subject) || comp.subject, text: b.text, attach: b.attach === false ? null : comp._attach });
    await A(c, req, 'aviso_correo', 'cliente', b.client_id, int(b.client_id), { kind: b.kind, to: b.to });
  });
  res.json({ ok: true });
}));
// WhatsApp: se abre en el teléfono/computadora del usuario (wa.me); aquí solo se registra el envío
app.post('/api/notices/whatsapp', auth(...STAFF), wrap(async (req, res) => {
  const b = req.body; const phone = waPhone(b.phone); need(phone, 'Número de WhatsApp inválido. Use 809/829/849 + 7 dígitos.');
  await db(req, async c => {
    await c.query("INSERT INTO notices (client_id, channel, kind, ref, to_addr, message, sent_by) VALUES ($1,'whatsapp',$2,$3,$4,$5,$6)", [int(b.client_id), b.kind || 'general', b.ref ? String(b.ref) : null, phone, b.text, req.user.id]);
    if (b.save_phone) await c.query('UPDATE clients SET phone = $2 WHERE id = $1', [int(b.client_id), b.phone]);
    await A(c, req, 'aviso_whatsapp', 'cliente', b.client_id, int(b.client_id), { kind: b.kind, phone });
  });
  res.json({ url: `https://wa.me/${phone}?text=${encodeURIComponent(b.text || '')}` });
}));
app.get('/api/notices', auth(...STAFF), wrap(async (req, res) => {
  res.json(await db(req, async c => (await c.query(`SELECT n.*, cl.name AS client_name, u.name AS sent_by_name FROM notices n JOIN clients cl ON cl.id = n.client_id LEFT JOIN users u ON u.id = n.sent_by
    WHERE ($1::int IS NULL OR n.client_id = $1) ORDER BY n.id DESC LIMIT 300`, [int(req.query.client_id)])).rows));
}));
// avisos automáticos al cliente por correo (no bloquean la operación)
function autoClientNotice(flag, kind, clientId, ref, req) {
  withCtx(SYSTEM, async c => {
    const cfg = await M.getConfig(c); if (!cfg.configured || (flag && !cfg[flag])) return;
    const comp = await composeNotice(c, kind, clientId, ref, portalUrl(req, cfg));
    if (!comp.client.email) return;
    await deliverEmail(c, null, { kind, clientId, ref, to: comp.client.email, subject: comp.subject, text: comp.text, attach: comp._attach, automatic: true });
  }).catch(e => console.warn('Aviso al cliente no enviado:', e.message));
}
async function clientReminders(c, cfg) {
  const today = S.todayISO(); const target = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(new Date(Date.now() + (cfg.reminder_days ?? 3) * 864e5));
  const clients = (await c.query("SELECT DISTINCT i.client_id FROM installments i JOIN quotes q ON q.id = i.quote_id JOIN clients cl ON cl.id = i.client_id WHERE q.status = 'aceptada' AND cl.email IS NOT NULL")).rows;
  let sent = 0;
  for (const { client_id } of clients) {
    const acc = await S.account(c, client_id);
    for (const [kind, list] of [['recordatorio_previo', acc.installments.filter(i => i.balance > 0 && i.due_date === target)],
      ['recordatorio_vencido', cfg.overdue_reminders === false ? [] : acc.installments.filter(i => i.balance > 0 && i.due_date < today)]]) {
      const fresh = [];
      for (const i of list) if (!(await c.query('SELECT 1 FROM notices WHERE installment_id = $1 AND kind = $2', [i.id, kind])).rowCount) fresh.push(i);
      if (!fresh.length) continue;
      const comp = await composeNotice(c, kind, client_id, null, portalUrl(null, cfg));
      try {
        await deliverEmail(c, null, { kind, clientId: client_id, to: comp.client.email, subject: comp.subject, text: comp.text, installmentId: fresh[0].id, automatic: true });
        for (const [k, i] of fresh.entries()) if (k > 0) await c.query("INSERT INTO notices (client_id, channel, kind, installment_id, to_addr, automatic) VALUES ($1,'email',$2,$3,$4,true)", [client_id, kind, i.id, comp.client.email]);
        sent++;
      } catch (e) { console.warn('Recordatorio no enviado:', e.message); }
    }
  }
  return sent;
}

// ───────── errores
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
app.use((err, req, res, next) => {
  let status = err.status || 500; let msg = err.message;
  if (err.code === 'LIMIT_FILE_SIZE') { status = 413; msg = 'El archivo excede 20 MB'; }
  else if (err.code === '23505') { status = 409; msg = 'Ya existe un registro con esos datos (duplicado)'; }
  else if (err.code === '42501') { status = 403; msg = 'No autorizado'; }
  else if (err.code === '23514' || err.code === '22P02' || err.code === '22007' || err.code === '22008') { status = 400; msg = 'Datos inválidos: revise los campos'; }
  if (status >= 500) { console.error(err); msg = 'Error interno del servidor'; }
  res.status(status).json({ error: msg });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) { app.listen(PORT, () => console.log(`LegalTax en http://localhost:${PORT}`)); setInterval(dailyTick, 60e3); }
module.exports = app;
module.exports.dailyTick = dailyTick;
module.exports.clientReminders = clientReminders;
