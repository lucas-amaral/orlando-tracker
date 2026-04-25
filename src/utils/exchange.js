// src/utils/exchange.js — Busca cotação USD→BRL
const axios = require('axios');
const db = require('../db/client');
const logger = require('./logger');

async function getUsdToBrl() {
  try {
    // Tenta API gratuita AwesomeAPI (sem chave necessária)
    const res = await axios.get('https://economia.awesomeapi.com.br/json/last/USD-BRL', {
      timeout: 8000,
    });
    const rate = parseFloat(res.data.USDBRL.bid);
    // Salva no banco para histórico
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
