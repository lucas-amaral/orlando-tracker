// src/utils/exchange.js — Fetches the USD→BRL exchange rate
const axios = require('axios');
const db = require('../db/client');
const logger = require('./logger');

async function getUsdToBrl() {
  try {
    // Try the free AwesomeAPI endpoint (no key required)
    const res = await axios.get('https://economia.awesomeapi.com.br/json/last/USD-BRL', {
      timeout: 8000,
    });
    const rate = parseFloat(res.data.USDBRL.bid);
    // Store in the database for historical tracking
    await db.query(
      'INSERT INTO exchange_rates (usd_to_brl) VALUES ($1)',
      [rate]
    );
    logger.info(`Cotação USD→BRL: R$ ${rate.toFixed(4)}`);
    return rate;
  } catch (err) {
    logger.warn('Falha ao buscar cotação, usando valor fallback 5.8');
    return 5.8;
  }
}

module.exports = { getUsdToBrl };
