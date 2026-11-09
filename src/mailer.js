// Envío de correo (Gmail u otro SMTP). La contraseña de aplicación se guarda cifrada (AES-256-GCM).
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { withCtx, SYSTEM } = require('./db');

const KEY = crypto.createHash('sha256').update((process.env.SESSION_SECRET || 'cambie-este-secreto-en-produccion') + '|legaltax-mail').digest();
const encrypt = t => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', KEY, iv); const e = Buffer.concat([c.update(t, 'utf8'), c.final()]); return [iv, c.getAuthTag(), e].map(b => b.toString('base64')).join('.'); };
const decrypt = s => { try { const [iv, tag, e] = s.split('.').map(x => Buffer.from(x, 'base64')); const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv); d.setAuthTag(tag); return Buffer.concat([d.update(e), d.final()]).toString('utf8'); } catch (_) { return null; } };

const DEFAULTS = {
  host: 'smtp.gmail.com', port: 465, secure: true, user: 'legaltax.consultores@gmail.com', from_name: 'LegalTax Consultores SRL',
  inbox: 'legaltax.consultores@gmail.com', notify_events: true, daily_report: false, daily_time: '07:30', last_daily: null,
  client_receipts: true, client_invoices: true, client_reminders: false, reminder_days: 3, overdue_reminders: true, portal_url: '',
};

async function getConfig(c) {
  const row = (await c.query("SELECT value FROM settings WHERE key = 'mail'")).rows[0];
  const cfg = { ...DEFAULTS, ...(row?.value || {}) };
  // variables de entorno tienen prioridad (útil en servidores)
  if (process.env.SMTP_HOST) Object.assign(cfg, { host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 465), secure: process.env.SMTP_SECURE !== '0', user: process.env.SMTP_USER || cfg.user });
  cfg.pass = process.env.SMTP_PASS || (cfg.pass_enc ? decrypt(cfg.pass_enc) : null);
  cfg.configured = !!(cfg.host && cfg.user && (cfg.pass || process.env.SMTP_NOAUTH === '1'));
  return cfg;
}
function publicConfig(cfg) { const { pass, pass_enc, ...rest } = cfg; return { ...rest, has_password: !!pass, from_env: !!process.env.SMTP_HOST }; }

async function saveConfig(c, patch) {
  const cur = (await c.query("SELECT value FROM settings WHERE key = 'mail'")).rows[0]?.value || {};
  const next = { ...cur, ...patch };
  if (patch.pass !== undefined) { delete next.pass; if (patch.pass) next.pass_enc = encrypt(String(patch.pass).replace(/\s+/g, '')); }
  await c.query("INSERT INTO settings (key, value) VALUES ('mail', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify(next)]);
}

const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());
const splitEmails = v => String(v || '').split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);

/** Envía y registra en email_log. Lanza error legible si falla. */
async function send(c, user, { to, cc, subject, html, text, attachments = [], kind, ref, clientId }) {
  const cfg = await getConfig(c);
  const toL = splitEmails(to), ccL = splitEmails(cc);
  if (!toL.length || ![...toL, ...ccL].every(isEmail)) { const e = new Error('Revise las direcciones de correo'); e.status = 400; throw e; }
  const log = async (status, error) => c.query(
    `INSERT INTO email_log (kind, ref, client_id, to_addr, cc_addr, subject, attachments, status, error, sent_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [kind || 'otro', ref ? String(ref) : null, clientId || null, toL.join(', '), ccL.join(', ') || null, subject, JSON.stringify(attachments.map(a => a.filename)), status, error || null, user?.id || null]);
  if (!cfg.configured) {
    await log('no_enviado', 'Correo no configurado');
    const e = new Error('El correo aún no está configurado. Administración debe ingresar la contraseña de aplicación de Gmail en Configuración → Correo.'); e.status = 409; throw e;
  }
  const transport = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: cfg.pass ? { user: cfg.user, pass: cfg.pass } : undefined,
    tls: process.env.SMTP_INSECURE_TLS === '1' ? { rejectUnauthorized: false } : undefined, connectionTimeout: 15000 });
  try {
    await transport.sendMail({ from: `"${cfg.from_name}" <${cfg.user}>`, replyTo: cfg.inbox, to: toL, cc: ccL.length ? ccL : undefined, subject, html, text, attachments });
    await log('enviado');
  } catch (err) {
    await log('error', err.message.slice(0, 500));
    const e = new Error('No se pudo enviar el correo: ' + (err.responseCode === 535 ? 'Gmail rechazó el usuario o la contraseña de aplicación.' : err.message)); e.status = 502; throw e;
  }
}

/** Plantilla HTML con la identidad de LegalTax. */
function layout(title, bodyHtml, firm = {}) {
  return `<!doctype html><html><body style="margin:0;background:#F3F1EE;font-family:Arial,Helvetica,sans-serif;color:#2B2520">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F1EE;padding:24px 0"><tr><td align="center">
  <table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #E4DED6">
    <tr><td style="background:#fff;padding:18px 24px;border-bottom:4px solid #876440"><img src="cid:logo@legaltax" alt="LegalTax Consultores SRL" height="64" style="display:block"></td></tr>
    <tr><td style="padding:22px 24px"><h2 style="margin:0 0 12px;color:#876440;font-size:18px">${title}</h2>${bodyHtml}</td></tr>
    <tr><td style="padding:14px 24px;background:#F7F5F2;color:#7A6E62;font-size:12px;line-height:1.5">${firm.firm_name || 'LegalTax Consultores SRL'} · ${firm.address || ''}<br>${firm.phone || ''} · ${firm.email || ''}<br>Este mensaje y sus adjuntos son confidenciales.</td></tr>
  </table></td></tr></table></body></html>`;
}
const logoAttachment = path => ({ filename: 'logo.png', path, cid: 'logo@legaltax' });

// Notificaciones automáticas al correo del despacho (no bloquean la operación si fallan)
async function notifyFirm(subject, bodyHtml, firm, logoPath) {
  try {
    await withCtx(SYSTEM, async c => {
      const cfg = await getConfig(c);
      if (!cfg.configured || !cfg.notify_events || !cfg.inbox) return;
      await send(c, null, { to: cfg.inbox, subject, html: layout(subject, bodyHtml, firm), attachments: [logoAttachment(logoPath)], kind: 'aviso' });
    });
  } catch (e) { console.warn('Aviso por correo no enviado:', e.message); }
}

module.exports = { getConfig, publicConfig, saveConfig, send, layout, logoAttachment, notifyFirm, isEmail, DEFAULTS };
