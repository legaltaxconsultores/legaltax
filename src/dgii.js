// Consulta de RNC / cédula en la DGII.
// 1) En vivo: página pública de consultas de la DGII (formulario ASP.NET).
// 2) Respaldo: padrón oficial de RNC que publica la DGII (DGII_RNC.zip), importado a la base de datos.
// Los resultados se guardan 30 días en caché para no repetir consultas.
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const RNC_URL = process.env.DGII_RNC_URL || 'https://dgii.gov.do/app/WebApps/ConsultasWeb2/ConsultasWeb/consultas/rnc.aspx';
const PADRON_URL = process.env.DGII_PADRON_URL || 'https://dgii.gov.do/app/WebApps/Consultas/RNC/DGII_RNC.zip';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const digitsOf = v => String(v || '').replace(/\D/g, '');
const decode = s => String(s || '')
  .replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/\s+/g, ' ').trim();
const norm = s => decode(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z/ ]/g, '').replace(/\s+/g, ' ').trim();
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i')); return m ? decode(m[2] ?? m[3] ?? '') : null; };

/** Campos ocultos del formulario (__VIEWSTATE, __EVENTVALIDATION, …). */
function hiddenFields(html) {
  const out = {};
  for (const tag of html.match(/<input\b[^>]*>/gi) || []) if (/type\s*=\s*["']?hidden/i.test(tag)) { const n = attr(tag, 'name'); if (n) out[n] = attr(tag, 'value') ?? ''; }
  return out;
}
/** Detecta el campo de texto del RNC y el botón "Buscar" del formulario. */
function formFields(html) {
  const inputs = (html.match(/<input\b[^>]*>/gi) || []).map(t => ({ t, name: attr(t, 'name') || '', type: (attr(t, 'type') || 'text').toLowerCase(), value: attr(t, 'value') || '' }));
  const text = inputs.find(i => i.type === 'text' && /rnc|cedula/i.test(i.name)) || inputs.find(i => i.type === 'text');
  const btn = inputs.find(i => i.type === 'submit' && /rnc/i.test(i.name)) || inputs.find(i => i.type === 'submit' && /buscar/i.test(i.name + i.value)) || inputs.find(i => i.type === 'submit');
  return { text: text?.name, button: btn?.name, buttonValue: btn?.value || 'Buscar' };
}
const LABELS = {
  'cedula/rnc': 'rnc', 'rnc/cedula': 'rnc', rnc: 'rnc', 'nombre/razon social': 'name', 'razon social': 'name', 'nombre comercial': 'trade_name', categoria: 'category',
  'regimen de pagos': 'regime', 'regimen de pago': 'regime', estado: 'status', 'actividad economica': 'activity', 'administracion local': 'local_office',
};
/** Lee la tabla de resultado de la consulta. */
function parseResult(html) {
  if (/no se encontraron|no existe|no est[aá] registrad/i.test(html.replace(/<[^>]+>/g, ' '))) return { found: false };
  const data = {};
  for (const m of html.matchAll(/<tr[^>]*>\s*<t[dh][^>]*>([\s\S]*?)<\/t[dh]>\s*<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)) {
    const key = LABELS[norm(m[1]).replace(/\s*\/\s*/g, '/')]; if (key && !data[key]) data[key] = decode(m[2]);
  }
  return data.name ? { found: true, ...data } : null; // null = no se reconoció el formato de la página
}

async function liveLookup(num) {
  const ctl = () => AbortSignal.timeout(15000);
  const r1 = await fetch(RNC_URL, { headers: { 'User-Agent': UA, 'Accept-Language': 'es-DO,es;q=0.9' }, signal: ctl() });
  if (!r1.ok) throw new Error(`La DGII respondió ${r1.status}`);
  const html1 = await r1.text();
  const cookies = (r1.headers.getSetCookie?.() || [r1.headers.get('set-cookie')].filter(Boolean)).map(c => c.split(';')[0]).join('; ');
  const f = formFields(html1); if (!f.text) throw new Error('No se reconoció el formulario de la DGII');
  const body = new URLSearchParams({ ...hiddenFields(html1), [f.text]: num });
  if (f.button) body.set(f.button, f.buttonValue);
  const r2 = await fetch(RNC_URL, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies, Referer: RNC_URL, Origin: new URL(RNC_URL).origin }, body, signal: ctl() });
  if (!r2.ok) throw new Error(`La DGII respondió ${r2.status}`);
  const res = parseResult(await r2.text());
  if (!res) throw new Error('No se reconoció la respuesta de la DGII');
  return res;
}

async function ensureTables(c) {
  await c.query(`CREATE TABLE IF NOT EXISTS dgii_cache (rnc text PRIMARY KEY, data jsonb NOT NULL, fetched_at timestamptz NOT NULL DEFAULT now())`);
  await c.query(`CREATE TABLE IF NOT EXISTS dgii_padron (rnc text PRIMARY KEY, name text, trade_name text, activity text, status text, regime text, updated_at timestamptz NOT NULL DEFAULT now())`);
}

/** Busca un RNC/cédula: caché → DGII en vivo → padrón local. */
async function lookup(c, raw) {
  const num = digitsOf(raw);
  if (num.length !== 9 && num.length !== 11) { const e = new Error('El RNC debe tener 9 dígitos y la cédula 11.'); e.status = 400; throw e; }
  const cached = (await c.query("SELECT data FROM dgii_cache WHERE rnc = $1 AND fetched_at > now() - interval '30 days'", [num])).rows[0];
  if (cached) return { ...cached.data, source: 'cache' };
  let liveError = null;
  try {
    const res = await liveLookup(num);
    if (res.found) await c.query('INSERT INTO dgii_cache (rnc, data) VALUES ($1,$2) ON CONFLICT (rnc) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()', [num, JSON.stringify(res)]);
    if (res.found) return { ...res, source: 'dgii' };
    // si la página dice que no existe, se confirma en el padrón
    liveError = null;
  } catch (e) { liveError = e; }
  const p = (await c.query('SELECT * FROM dgii_padron WHERE rnc = $1', [num])).rows[0];
  if (p) return { found: true, rnc: p.rnc, name: p.name, trade_name: p.trade_name, activity: p.activity, status: p.status, regime: p.regime, source: 'padron', padron_date: p.updated_at };
  if (liveError) {
    const padronRows = (await c.query('SELECT count(*)::int n FROM dgii_padron')).rows[0].n;
    const e = new Error(`No se pudo consultar la DGII (${liveError.message}).${padronRows ? '' : ' Tampoco hay padrón local cargado.'} Escriba el nombre manualmente.`); e.status = 502; throw e;
  }
  return { found: false, rnc: num, source: 'dgii' };
}

/** Descarga e importa el padrón oficial de RNC (DGII_RNC.zip → TXT separado por "|"). */
async function importPadron(pool, log = () => {}) {
  const yauzl = require('yauzl');
  const tmp = path.join(os.tmpdir(), `dgii-rnc-${Date.now()}.zip`);
  log('Descargando padrón de la DGII…');
  const r = await fetch(PADRON_URL, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10 * 60e3) });
  if (!r.ok) throw new Error(`La DGII respondió ${r.status} al descargar el padrón`);
  fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
  const client = await pool.connect();
  try {
    await ensureTables(client);
    // se importa en una tabla aparte; las consultas siguen funcionando con el padrón anterior hasta el intercambio final
    await client.query('DROP TABLE IF EXISTS dgii_padron_new');
    await client.query('CREATE TABLE dgii_padron_new (LIKE dgii_padron INCLUDING ALL)');
    const zip = await new Promise((res, rej) => yauzl.open(tmp, { lazyEntries: true }, (e, z) => (e ? rej(e) : res(z))));
    const entry = await new Promise((res, rej) => { zip.on('entry', en => (/\.(txt|csv)$/i.test(en.fileName) ? res(en) : zip.readEntry())); zip.on('end', () => rej(new Error('El archivo del padrón no contiene un TXT'))); zip.readEntry(); });
    const stream = await new Promise((res, rej) => zip.openReadStream(entry, (e, s) => (e ? rej(e) : res(s))));
    stream.setEncoding('latin1');
    // el lector de líneas se crea justo antes de recorrerlo (sin esperas intermedias) para no perder líneas
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let batch = [], n = 0;
    const flush = async () => {
      if (!batch.length) return;
      const vals = []; const ph = batch.map((b, i) => { vals.push(...b); const k = i * 6; return `($${k + 1},$${k + 2},$${k + 3},$${k + 4},$${k + 5},$${k + 6})`; });
      await client.query(`INSERT INTO dgii_padron_new (rnc, name, trade_name, activity, status, regime) VALUES ${ph.join(',')} ON CONFLICT (rnc) DO NOTHING`, vals);
      n += batch.length; batch = []; if (n % 100000 < 1000) log(`${n.toLocaleString('en-US')} registros…`);
    };
    for await (const line of rl) {
      const f = line.split('|').map(x => x.trim());
      const rnc = digitsOf(f[0]); if (rnc.length !== 9 && rnc.length !== 11) continue;
      const status = f.find(x => /^(ACTIVO|SUSPENDIDO|DADO DE BAJA|CESE TEMPORAL|ANULADO|RECHAZADO|INACTIVO)/i.test(x)) || null;
      batch.push([rnc, f[1] || null, f[2] || null, f[3] || null, status, f[f.length - 1] && f[f.length - 1] !== status ? f[f.length - 1] : null]);
      if (batch.length >= 1000) await flush();
    }
    await flush();
    if (!n) throw new Error('El padrón descargado está vacío; se conserva el anterior');
    await client.query('BEGIN');
    await client.query('ALTER TABLE dgii_padron RENAME TO dgii_padron_old');
    await client.query('ALTER TABLE dgii_padron_new RENAME TO dgii_padron');
    await client.query('DROP TABLE dgii_padron_old');
    await client.query('COMMIT');
    log(`Padrón importado: ${n.toLocaleString('en-US')} contribuyentes.`);
    return n;
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); await client.query('DROP TABLE IF EXISTS dgii_padron_new').catch(() => {}); throw e; }
  finally { client.release(); fs.rmSync(tmp, { force: true }); }
}

module.exports = { lookup, importPadron, ensureTables, parseResult, hiddenFields, formFields, digitsOf, RNC_URL, PADRON_URL };
