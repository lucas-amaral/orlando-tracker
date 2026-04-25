// src/db/setup.js — Cria tabelas no Supabase/PostgreSQL
require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function setupDatabase() {
  const client = await pool.connect();
  try {
    logger.info('Criando tabelas no banco de dados...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS flight_prices (
        id SERIAL PRIMARY KEY,
        checked_at TIMESTAMPTZ DEFAULT NOW(),
        airline TEXT,
        origin TEXT,
        destination TEXT,
        departure_date DATE,
        return_date DATE,
        trip_days INTEGER,
        price_usd NUMERIC(10,2),
        price_brl NUMERIC(10,2),
        num_passengers INTEGER,
        total_brl NUMERIC(10,2),
        stops TEXT,
        source_url TEXT,
        raw_data JSONB
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS park_prices (
        id SERIAL PRIMARY KEY,
        checked_at TIMESTAMPTZ DEFAULT NOW(),
        park_brand TEXT,       -- 'disney' ou 'universal'
        park_names TEXT[],     -- ex: ARRAY['Magic Kingdom','EPCOT',...]
        ticket_type TEXT,      -- 'avulso' ou 'promoção'
        promotion_name TEXT,   -- ex: '4-Park Magic Ticket'
        days INTEGER,
        price_usd NUMERIC(10,2),
        price_brl NUMERIC(10,2),
        num_tickets INTEGER,
        total_brl NUMERIC(10,2),
        valid_dates TEXT,
        source_url TEXT,
        raw_data JSONB
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS price_alerts (
        id SERIAL PRIMARY KEY,
        sent_at TIMESTAMPTZ DEFAULT NOW(),
        alert_type TEXT,       -- 'flight', 'disney', 'universal'
        threshold_brl NUMERIC(10,2),
        actual_brl NUMERIC(10,2),
        details JSONB
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS exchange_rates (
        id SERIAL PRIMARY KEY,
        checked_at TIMESTAMPTZ DEFAULT NOW(),
        usd_to_brl NUMERIC(8,4)
      );
    `);

    logger.info('✅ Banco de dados configurado com sucesso!');
  } finally {
    client.release();
    await pool.end();
  }
}

setupDatabase().catch(err => {
  logger.error('Erro ao configurar banco:', err);
  process.exit(1);
});
