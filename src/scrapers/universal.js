// src/scrapers/universal.js
// Busca preços dos 3 parques da Universal (Studios, Islands of Adventure, Epic Universe)
const axios = require('axios');
const cheerio = require('cheerio');
const db = require('../db/client');
const logger = require('../utils/logger');
const { getUsdToBrl } = require('../utils/exchange');

const PARKS = ['Universal Studios Florida', 'Islands of Adventure', 'Epic Universe'];

// Fonte 1: Orlando Para Brasileiros — promoções para brasileiros
async function scrapeOrlandoParaBrasileiros() {
  try {
    const res = await axios.get('https://orlandoparabrasileiros.com/ingressos-parques-orlando/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'Referer': 'https://www.google.com.br',
      },
      timeout: 20000,
    });
    const $ = cheerio.load(res.data);
    const text = $('body').text();

    const results = [];

    // Verifica promoção "3 Park Explorer" Universal
    const has3Park = text.toLowerCase().includes('3 park explorer') ||
                     text.toLowerCase().includes('3-park');
    
    // Verifica Epic Universe (novo parque 2025)
    const hasEpic = text.toLowerCase().includes('epic universe');

    // Busca preços em BRL
    const pricePattern = /R\$\s*([\d.,]+)/g;
    const prices = [];
    let match;
    while ((match = pricePattern.exec(text)) !== null) {
      const price = parseFloat(match[1].replace(/\./g, '').replace(',', '.'));
      if (price > 800 && price < 20000) prices.push(price);
    }

    // Procura preço específico do pacote Universal
    const universalBlock = text.substring(
      Math.max(0, text.toLowerCase().indexOf('universal') - 100),
      text.toLowerCase().indexOf('universal') + 2000
    );
    const universalPrices = [];
    let um;
    const up = /R\$\s*([\d.,]+)/g;
    while ((um = up.exec(universalBlock)) !== null) {
      const price = parseFloat(um[1].replace(/\./g, '').replace(',', '.'));
      if (price > 800 && price < 15000) universalPrices.push(price);
    }

    if (universalPrices.length > 0 || prices.length > 0) {
      const bestPrice = universalPrices.length > 0
        ? Math.min(...universalPrices)
        : Math.min(...prices.filter(p => p > 1000));

      results.push({
        ticket_type: has3Park ? 'promoção' : 'avulso',
        promotion_name: has3Park
          ? `3-Park Explorer${hasEpic ? ' + Epic Universe' : ''}`
          : '3 parques — ingresso avulso',
        days: 3,
        price_brl: Math.round(bestPrice),
        total_brl: Math.round(bestPrice * 4),
        num_tickets: 4,
        park_names: PARKS,
        valid_dates: 'Jan–Fev 2027 (verificar disponibilidade)',
        source_url: 'https://orlandoparabrasileiros.com/ingressos-parques-orlando/',
        source: 'Orlando Para Brasileiros',
        has_promo: has3Park,
        has_epic: hasEpic,
      });
    }
    return results;
  } catch (err) {
    logger.warn(`Falha ao acessar OPB para Universal: ${err.message}`);
    return [];
  }
}

// Fonte 2: Site oficial Universal
async function scrapeUniversalOfficial(rate) {
  try {
    const res = await axios.get('https://www.universalorlando.com/web/en/us/tickets', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 20000,
    });
    const $ = cheerio.load(res.data);
    const text = $('body').text();

    // Procura preços em USD
    const usdMatches = text.match(/\$\s*([\d,]+\.?[\d]*)/g) || [];
    const prices = usdMatches
      .map(m => parseFloat(m.replace(/[^\d.]/g, '')))
      .filter(p => p > 80 && p < 1000);

    if (prices.length > 0) {
      const minPrice = Math.min(...prices);
      const priceBrl = minPrice * rate;
      return [{
        ticket_type: 'avulso',
        promotion_name: 'Ingresso site oficial Universal',
        days: 3,
        price_usd: minPrice,
        price_brl: Math.round(priceBrl),
        total_brl: Math.round(priceBrl * 4),
        num_tickets: 4,
        park_names: PARKS,
        valid_dates: 'Verificar no site',
        source_url: 'https://www.universalorlando.com/web/en/us/tickets',
        source: 'Universal Oficial',
        obs: 'Preço em USD + IOF (10%). Prefira comprar em BRL via revendedor.',
      }];
    }
    return [];
  } catch (err) {
    logger.warn(`Falha ao acessar Universal oficial: ${err.message}`);
    return [];
  }
}

// Fallback com estimativas históricas
function getFallbackPrices(rate) {
  // 3 Park Explorer + Epic Universe, baixa temporada Jan/Fev
  const PRICE_USD_3PARKS = 524; // baseado em dados de 2026
  const priceBrl = PRICE_USD_3PARKS * rate;
  
  return [{
    ticket_type: 'estimado',
    promotion_name: '3-Park Explorer + Epic Universe (estimativa)',
    days: 3,
    price_usd: PRICE_USD_3PARKS,
    price_brl: Math.round(priceBrl),
    total_brl: Math.round(priceBrl * 4),
    num_tickets: 4,
    park_names: PARKS,
    valid_dates: 'Jan–Fev 2027 (baixa temporada)',
    source_url: 'https://www.universalorlando.com/web/en/us/tickets',
    source: 'Estimativa histórica',
    obs: 'Epic Universe abriu em 2025. Inclui Studios, Islands of Adventure e Epic Universe.',
  }];
}

async function checkUniversalPrices() {
  logger.info('🎬 Buscando preços Universal (3 parques, 4 pax)...');
  const rate = await getUsdToBrl();

  const [opb, official] = await Promise.all([
    scrapeOrlandoParaBrasileiros(),
    scrapeUniversalOfficial(rate),
  ]);

  let allResults = [...opb, ...official];

  if (allResults.length === 0) {
    logger.warn('Usando preços estimados Universal (scrapers falharam)');
    allResults = getFallbackPrices(rate);
  }

  for (const r of allResults) {
    await db.query(`
      INSERT INTO park_prices 
        (park_brand, park_names, ticket_type, promotion_name, days,
         price_usd, price_brl, num_tickets, total_brl, valid_dates, source_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [
      'universal', r.park_names, r.ticket_type, r.promotion_name,
      r.days, r.price_usd || null, r.price_brl, r.num_tickets,
      r.total_brl, r.valid_dates, r.source_url,
    ]);
  }

  logger.info(`🎬 Universal: ${allResults.length} resultado(s) encontrado(s)`);
  return allResults;
}

module.exports = { checkUniversalPrices };
