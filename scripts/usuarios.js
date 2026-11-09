// Carga o actualiza los usuarios del equipo desde un archivo JSON.
// Uso: node scripts/usuarios.js config/usuarios.json
// Cada usuario entra la primera vez con su contraseña temporal y el sistema le obliga a cambiarla.
// Roles válidos: admin (Administración), expedientes (Equipo de expedientes), cobros (Cobros).
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { pool, withCtx, SYSTEM } = require('../src/db');
const S = require('../src/services');

const ROLES = { admin: 'admin', administracion: 'admin', 'administración': 'admin', expedientes: 'expedientes', cobros: 'cobros' };
(async () => {
  const file = process.argv[2]; if (!file) throw new Error('Indique el archivo, por ejemplo: node scripts/usuarios.js config/usuarios.json');
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = [];
  await withCtx(SYSTEM, async c => {
    for (const [i, x] of list.entries()) {
      const name = String(x.nombre || '').trim(); const email = String(x.correo || '').trim().toLowerCase();
      const username = x.usuario ? String(x.usuario).trim().toLowerCase() : null; const role = ROLES[String(x.rol || '').trim().toLowerCase()];
      const pw = String(x.contrasena_temporal || '');
      const err = !name ? 'falta el nombre' : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? 'correo inválido' : !role ? `rol inválido "${x.rol}" (use admin, expedientes o cobros)`
        : username && !/^[a-z0-9._-]{3,30}$/.test(username) ? 'usuario inválido (letras sin acentos, números, punto, guion; 3 a 30)'
        : pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw) ? 'la contraseña temporal debe tener 8+ caracteres con letras y números' : null;
      if (err) { out.push(`✘ Fila ${i + 1} (${name || email}): ${err}`); continue; }
      const r = await c.query(`INSERT INTO users (email, name, username, role, password_hash, must_change_password) VALUES ($1,$2,$3,$4,$5,true)
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, username = EXCLUDED.username, role = EXCLUDED.role, password_hash = EXCLUDED.password_hash,
          must_change_password = true, active = true, failed_logins = 0, locked_until = NULL
        RETURNING (xmax = 0) AS created`, [email, name, username, role, await bcrypt.hash(pw, 10)]);
      await S.audit(c, { name: 'carga de usuarios', role: 'system' }, r.rows[0].created ? 'crear' : 'actualizar', 'usuario', email, null, { role, username }, null);
      out.push(`✔ ${r.rows[0].created ? 'Creado' : 'Actualizado'}: ${name} · ${username || email} · ${role}`);
    }
  });
  console.log(out.join('\n'));
  await pool.end();
})().catch(e => { console.error('✘', e.message); process.exit(1); });
