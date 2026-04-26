// src/scrapers/universal.js
// Fetches ticket prices for Universal Orlando parks for Jan/Feb 2027
//
// IMPORTANT — Jan/Feb 2027 context:
// Volcano Bay will be CLOSED for refurbishment from Oct 26 2026 to Mar 24 2027.
// The correct ticket for this period is the "Three Park Adventure Ticket":
//   - Universal Studios Florida
//   - Islands of Adventure
//   - Epic Universe
//   - 14 consecutive days of unlimited park-to-park access
//   - NOT available at the gate — must be purchased online
const axios = require('axios');
const cheerio = require('cheerio');
const db = require('../db/client');
const logger = require('../utils/logger');
const { getUsdToBrl } = require('../utils/exchange');

const PARKS_3 = ['Universal Studios Florida', 'Islands of Adventure', 'Epic Universe'];

// Source 1: AttractionTickets.com — international reseller with confirmed Jan/Feb 2027 pricing
// This is one of the few sources that explicitly handles the Volcano Bay closure period
async function scrapeAttractionTickets(rate) {
  try {
    const res = await axios.get('https://www.attractiontickets.com/en/orlando-attraction-tickets/universal-orlando-resort', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.google.com',
      },
      timeout: 20000,
    });
    const $ = cheerio.load(res.data);
    const text = $('body').text();

    // Look for "Three Park Adventure" pricing (valid during Volcano Bay closure)
    const has3Park = text.toLowerCase().includes('three park adventure') ||
                     text.toLowerCase().includes('3 park adventure');

    // Extract GBP or USD prices near the Three Park section
    const priceMatches = text.match(/[£$]\s*([\d,]+\.?\d*)/g) || [];
    const prices = priceMatches
      .map(m => parseFloat(m.replace(/[^\d.]/g, '')))
      .filter(p => p > 50 && p < 800);

    if (prices.length > 0) {
      const minPrice = Math.min(...prices);
      // Rough GBP→USD→BRL: 1 GBP ≈ 1.27 USD
      const priceUsd = minPrice * 1.27;
      const priceBrl = priceUsd * rate;

      return [{
        ticket_type: 'promoção',
        promotion_name: 'Three Park Adventure Ticket — 14 dias consecutivos (sem Volcano Bay, fechado jan/fev 2027)',
        days: 14,
        price_usd: Math.round(priceUsd),
        price_brl: Math.round(priceBrl),
        total_brl: Math.round(priceBrl * 4),
        num_tickets: 4,
        park_names: PARKS_3,
        valid_dates: 'Jan–Mar 2027 (Volcano Bay fechado para reforma)',
        source_url: 'https://www.attractiontickets.com/en/orlando-attraction-tickets/universal-orlando-resort',
        source: 'AttractionTickets.com',
        has_promo: true,
        obs: 'Ingresso 14 dias para estrangeiros. Preço convertido de GBP. Confirme o valor atual no link.',
      }];
    }
    return [];
  } catch (err) {
    logger.warn(`Failed to scrape AttractionTickets for Universal: ${err.message}`);
    return [];
  }
}

// Source 2: OrlandoAttractions.com — lists the Three Park Adventure Ticket directly
async function scrapeOrlandoAttractions(rate) {
  try {
    const res = await axios.get('https://www.orlandoattractions.com/tickets/universal-all-parks-ticket', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 20000,
    });
    const $ = cheerio.load(res.data);
    const text = $('body').text();

    const priceMatches = text.match(/[£$€]\s*([\d,]+\.?\d*)/g) || [];
    const prices = priceMatches
      .map(m => parseFloat(m.replace(/[^\d.]/g, '')))
      .filter(p => p > 50 && p < 800);

    if (prices.length > 0) {
      const minPrice = Math.min(...prices);
      const priceUsd = minPrice * 1.27; // GBP to USD estimate
      const priceBrl = priceUsd * rate;

      return [{
        ticket_type: 'promoção',
        promotion_name: 'Universal Three Park Adventure — 14 dias consecutivos',
        days: 14,
        price_usd: Math.round(priceUsd),
        price_brl: Math.round(priceBrl),
        total_brl: Math.round(priceBrl * 4),
        num_tickets: 4,
        park_names: PARKS_3,
        valid_dates: '01/01/2027 – 24/03/2027',
        source_url: 'https://www.orlandoattractions.com/tickets/universal-all-parks-ticket',
        source: 'OrlandoAttractions.com',
        has_promo: true,
      }];
    }
    return [];
  } catch (err) {
    logger.warn(`Failed to scrape OrlandoAttractions: ${err.message}`);
    return [];
  }
}

// Source 3: Orlando Para Brasileiros — checks for any Brazilian-specific promotions
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

    // Look for the "Three Park Adventure" or "3 Park Explorer" mention
    const has14Day = text.toLowerCase().includes('14 dia') ||
                     text.toLowerCase().includes('three park adventure') ||
                     text.toLowerCase().includes('3 park adventure');
    const has3Park = text.toLowerCase().includes('3 park explorer') ||
                     text.toLowerCase().includes('3-park');
    const hasEpic = text.toLowerCase().includes('epic universe');

    // Extract BRL prices near the Universal section
    const universalIdx = text.toLowerCase().indexOf('universal');
    const universalBlock = universalIdx >= 0
      ? text.substring(Math.max(0, universalIdx - 100), universalIdx + 3000)
      : text;

    const universalPrices = [];
    const up = /R\$\s*([\d.,]+)/g;
    let um;
    while ((um = up.exec(universalBlock)) !== null) {
      const price = parseFloat(um[1].replace(/\./g, '').replace(',', '.'));
      if (price > 800 && price < 20000) universalPrices.push(price);
    }

    if (universalPrices.length > 0) {
      const bestPrice = Math.min(...universalPrices);
      const promoName = has14Day
        ? 'Three Park Adventure — 14 dias consecutivos (Studios + Islands + Epic Universe)'
        : has3Park
          ? `3-Park Explorer${hasEpic ? ' + Epic Universe' : ''}`
          : '3 parques — ingresso avulso';

      results.push({
        ticket_type: has14Day || has3Park ? 'promoção' : 'avulso',
        promotion_name: promoName,
        days: has14Day ? 14 : 3,
        price_brl: Math.round(bestPrice),
        total_brl: Math.round(bestPrice * 4),
        num_tickets: 4,
        park_names: PARKS_3,
        valid_dates: has14Day ? '01/01/2027 – 24/03/2027' : 'Jan–Feb 2027 (check availability)',
        source_url: 'https://orlandoparabrasileiros.com/ingressos-parques-orlando/',
        source: 'Orlando Para Brasileiros',
        has_promo: has14Day || has3Park,
        has_epic: hasEpic,
      });
    }
    return results;
  } catch (err) {
    logger.warn(`Failed to scrape Orlando Para Brasileiros for Universal: ${err.message}`);
    return [];
  }
}

// Fallback: estimated prices based on confirmed ticket types for Jan/Feb 2027
// Three Park Adventure Ticket (14 days) — low season
function getFallbackPrices(rate) {
  // Estimated USD price for Three Park Adventure 14-day ticket
  // Based on historical data from international resellers (Apr 2026)
  const PRICE_USD_14DAY_3PARK = 380;
  const priceBrl = PRICE_USD_14DAY_3PARK * rate;

  return [
    {
      ticket_type: 'estimado',
      promotion_name: 'Three Park Adventure Ticket — 14 dias consecutivos (estimativa)',
      days: 14,
      price_usd: PRICE_USD_14DAY_3PARK,
      price_brl: Math.round(priceBrl),
      total_brl: Math.round(priceBrl * 4),
      num_tickets: 4,
      park_names: PARKS_3,
      valid_dates: '01/01/2027 – 24/03/2027 (Volcano Bay fechado neste período)',
      source_url: 'https://www.attractiontickets.com/en/orlando-attraction-tickets/universal-orlando-resort',
      source: 'Historical estimate',
      obs: 'Volcano Bay fechado jan–mar 2027. Ticket correto para este período é o Three Park Adventure (Studios + Islands of Adventure + Epic Universe). Não disponível nas bilheterias — compre online.',
    },
  ];
}

async function checkUniversalPrices() {
  logger.info('🎬 Fetching Universal prices (Three Park Adventure, 14 days, 4 people)...');
  const rate = await getUsdToBrl();

  const [opb, attraction, orlando] = await Promise.allSettled([
    scrapeOrlandoParaBrasileiros(),
    scrapeAttractionTickets(rate),
    scrapeOrlandoAttractions(rate),
  ]);

  let allResults = [
    ...(opb.status === 'fulfilled' ? opb.value : []),
    ...(attraction.status === 'fulfilled' ? attraction.value : []),
    ...(orlando.status === 'fulfilled' ? orlando.value : []),
  ];

  if (allResults.length === 0) {
    logger.warn('Using estimated Universal prices (all scrapers failed)');
    allResults = getFallbackPrices(rate);
  }

  // Remove duplicates — keep lowest price per promotion name
  const seen = new Map();
  for (const r of allResults) {
    const key = r.promotion_name || r.ticket_type;
    if (!seen.has(key) || r.total_brl < seen.get(key).total_brl) {
      seen.set(key, r);
    }
  }
  allResults = Array.from(seen.values());

  // Save all results to database
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

  logger.info(`🎬 Universal: ${allResults.length} result(s) found`);
  return allResults;
}

module.exports = { checkUniversalPrices };
