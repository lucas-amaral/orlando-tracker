// src/db/setup.js — Creates tables in Supabase/PostgreSQL
require('dotenv').config();
const { Pool } = require('pg');
const logger = require('../utils/logger');
const { ensureDatabaseSchema } = require('./init');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function setupDatabase() {
  const client = await pool.connect();
  try {
    await ensureDatabaseSchema(client, { log: true });
  } finally {
    client.release();
    await pool.end();
  }
}

setupDatabase().catch(err => {
  logger.error('Error setting up database:', err);
  process.exit(1);
});
