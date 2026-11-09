const { Pool, types } = require('pg');

// numeric → number, date → 'YYYY-MM-DD' (sin conversión de zona horaria)
types.setTypeParser(1700, v => (v === null ? null : parseFloat(v)));
types.setTypeParser(1082, v => v);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://legaltax:legaltax@localhost:5432/legaltax',
  options: '-c timezone=America/Santo_Domingo',
  max: 15,
});

/**
 * Ejecuta fn dentro de una transacción con el contexto de seguridad del usuario.
 * Las políticas RLS de PostgreSQL leen app.role / app.client_id, de modo que
 * incluso un error en el código del servidor no expone datos de otro cliente.
 */
async function withCtx(ctx, fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      "SELECT set_config('app.role', $1, true), set_config('app.client_id', $2, true), set_config('app.user_id', $3, true)",
      [ctx.role || '', ctx.client_id ? String(ctx.client_id) : '', ctx.id ? String(ctx.id) : '']
    );
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

const SYSTEM = { role: 'system', id: null, client_id: null };

module.exports = { pool, withCtx, SYSTEM };
