// src/utils/exchange.js — Fetches current USD to BRL exchange rate
const axios = require('axios');
const db = require('../db/client');
const logger = require('./logger');

async function getUsdToBrl() {
  try {
    // AwesomeAPI is free and requires no API key
    const res = await axios.get('https://economia.awesomeapi.com.br/json/last/USD-BRL', {
      timeout: 8000,
    });
    const rate = parseFloat(res.data.USDBRL.bid);

    // Save to database for historical tracking
    await db.query('INSERT INTO exchange_rates (usd_to_brl) VALUES ($1)', [rate]);
    logger.info(`Exchange rate USD→BRL: R$ ${rate.toFixed(4)}`);
    return rate;
  } catch (err) {
    logger.warn('Failed to fetch exchange rate, using fallback value 5.8');
    return 5.8;
  }
}

module.exports = { getUsdToBrl };
