// Actualiza el padrón oficial de RNC de la DGII en la base de datos (respaldo de la consulta en vivo).
// Uso: node scripts/padron-dgii.js   (el instalador lo programa cada domingo)
const { pool } = require('../src/db');
const DGII = require('../src/dgii');
DGII.importPadron(pool, m => console.log(new Date().toISOString(), m))
  .then(() => pool.end()).catch(e => { console.error('✘', e.message); process.exit(1); });
