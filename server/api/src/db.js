'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { env } = require('./env');

if (!env.databaseUrl) throw new Error('DATABASE_URL is required');

const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: env.databaseSsl ? { rejectUnauthorized: true } : false,
  max: Math.max(2, env.dbPoolMax),
  idleTimeoutMillis: 30000,
  statement_timeout: 15000,
  application_name: 'ege-history-api',
});

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function runMigrations() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter(name => /^\d+.*\.sql$/.test(name)).sort();
  for (const file of files) {
    const done = await pool.query('SELECT 1 FROM schema_migrations WHERE version=$1', [file]);
    if (done.rowCount) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations(version) VALUES($1) ON CONFLICT DO NOTHING', [file]);
  }
}

module.exports = { pool, tx, runMigrations };
