const TZ = 'America/Santo_Domingo';

const money = n => 'RD$ ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function dateStr(d) {
  if (!d) return '';
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, dd] = d.split('-');
    return `${dd}/${m}/${y}`;
  }
  return new Intl.DateTimeFormat('es-DO', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d));
}
function dateTimeStr(d) {
  if (!d) return '';
  return new Intl.DateTimeFormat('es-DO', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(d));
}
const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
function longDate(d) {
  let s = d;
  if (!(typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))) s = todayISO(d ? new Date(d) : new Date());
  const [y, m, dd] = s.split('-').map(Number);
  return `${dd} de ${MONTHS[m - 1]} de ${y}`;
}
function todayISO(date = new Date()) {
  // fecha calendario en Santo Domingo
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

// ───── Monto en letras (español) ─────
const U = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE',
  'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO',
  'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const D = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const C = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];
function under1000(n) {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';
  const c = Math.floor(n / 100), r = n % 100;
  let s = C[c];
  if (r) {
    const t = r < 30 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? ' Y ' + U[r % 10] : '');
    s = (s ? s + ' ' : '') + t;
  }
  return s;
}
function intWords(n) {
  if (n === 0) return 'CERO';
  const parts = [];
  const mill = Math.floor(n / 1e6), th = Math.floor((n % 1e6) / 1000), rest = n % 1000;
  if (mill) parts.push(mill === 1 ? 'UN MILLÓN' : intWords(mill).replace(/UNO$/, 'UN') + ' MILLONES');
  if (th) parts.push(th === 1 ? 'MIL' : under1000(th).replace(/UNO$/, 'UN') + ' MIL');
  if (rest) parts.push(under1000(rest));
  return parts.join(' ');
}
function amountWords(n) {
  const v = Math.round(Number(n) * 100);
  const ent = Math.floor(v / 100), cents = v % 100;
  let w = intWords(ent).replace(/UNO$/, 'UN');
  if (/MILL(ÓN|ONES)$/.test(w)) w += ' DE';
  return `${w} PESOS DOMINICANOS CON ${String(cents).padStart(2, '0')}/100`;
}

module.exports = { TZ, money, dateStr, dateTimeStr, longDate, todayISO, amountWords };
