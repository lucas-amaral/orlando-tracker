// src/db/client.js — PostgreSQL connection pool
require('dotenv').config();
const dns = require('dns');
const { Pool } = require('pg');

// Force IPv4 — Render free tier does not support IPv6
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
