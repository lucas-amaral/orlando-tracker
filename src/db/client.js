// src/db/client.js
require('dotenv').config();
const { Pool } = require('pg');
const dns = require('dns');

// Força IPv4 — o plano free do Render não suporta IPv6
dns.setDefaultResultOrder('ipv4first');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
