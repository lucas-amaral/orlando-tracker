// src/scrapers/universal.js
// Fetches Universal ticket prices for Jan/Feb 2027 with per-date links
//
// Jan/Feb 2027 context:
//   Volcano Bay CLOSED Oct 26 2026 – Mar 24 2027 (refurbishment)
//   Correct ticket: Three Park Adventure Ticket
//     - Universal Studios Florida
//     - Islands of Adventure
//     - Epic Universe (opened May 2025)
//     - 14 consecutive days unlimited park-to-park
//     - NOT sold at the gate — online only
//
// Universal does NOT have per-date dynamic pricing like Disney.
// The Three Park Adventure Ticket has a fixed price regardless of visit date,
// but the *start date* must be selected at booking time.
// We generate one entry per target start date with a direct booking link.
const axios = require('axios');
const cheerio = require('cheerio');
const db = require('../db/client');
const logger = require('../utils/logger');
const { getUsdToBrl } = require('../utils/exchange');

const PARKS_3 = ['Universal Studios Florida', 'Islands of Adventure', 'Epic Universe'];

// Target start dates for the trip — one entry per potential first park day
// These map to the same departure windows we check for flights
const TARGET_DATES = [
  '2027-01-05', '2027-01-07', '2027-01-12', '2027-01-14',
  '2027-01-19', '2027-01-21', '2027-01-26',
  '2027-02-02', '2027-02-04', '2027-02-09',
];

// Build a direct booking link to AttractionTickets.com for a specific start date
// This is the most reliable reseller for the Three Park Adventure Ticket for Jan/Feb 2027
function buildUniversalLink(startDate) {
  // AttractionTickets.com supports date parameter in query string
  const encoded = encodeURIComponent(startDate);
  return `https://www.attractiontickets.com/en/orlando-attraction-tickets/universal-orlando-resort?startDate=${encoded}`;
}

// Build direct link to OrlandoAttractions.com for a specific date
function buildOrlandoAttractionsLink(startDate) {
  return `https://www.orlandoattractions.com/tickets/universal-all-parks-ticket?date=${startDate}`;
}

// Fetches the current Three Park Adventure Ticket price from AttractionTickets.com
async function fetchPriceFromAttractionTickets(rate) {
  try {
    const res = await axios.get(
      'https://www.attractiontickets.com/en/orlando-attraction-tickets/universal-orlando-resort',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0',
          'Accept-Language': 'en-GB,en;q=0.9',
          'Referer': 'https://www.google.co.uk',
        },
        timeout: 20000,
      }
    );
    const $ = cheerio.load(res.data);
    const text = $('body').text();

    // Look for Three Park Adventure pricing block
    const adventureIdx = text.toLowerCase().indexOf('three park adventure');
    const block = adventureIdx >= 0
      ? text.substring(adventureIdx, adventureIdx + 1000)
      : text;

    // Extract GBP prices — site prices in GBP for international visitors
    const gbpMatches = block.match(/£\s*([\d,]+\.?\d*)/g) || [];
    const prices = gbpMatches
      .map(m => parseFloat(m.replace(/[£,\s]/g, '')))
      .filter(p => p > 50 && p < 600);

    if (prices.length > 0) {
      const gbpPrice = Math.min(...prices);
      const usdPrice = gbpPrice * 1.27; // approximate GBP→USD
      return { price_usd: Math.round(usdPrice), price_gbp: gbpPrice, source: 'AttractionTickets.com (live)' };
    }
    return null;
  } catch (err) {
    logger.warn(`AttractionTickets fetch failed: ${err.message}`);
    return null;
  }
}

// Fetches price from OrlandoAttractions.com as fallback
async function fetchPriceFromOrlandoAttractions(rate) {
  try {
    const res = await axios.get(
      'https://www.orlandoattractions.com/tickets/universal-all-parks-ticket',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 20000,
      }
    );
    const $ = cheerio.load(res.data);
    const text = $('body').text();

    const priceMatches = text.match(/[£$]\s*([\d,]+\.?\d*)/g) || [];
    const prices = priceMatches
      .map(m => parseFloat(m.replace(/[£$,\s]/g, '')))
      .filter(p => p > 50 && p < 600);

    if (prices.length > 0) {
      const rawPrice = Math.min(...prices);
      // If it looks like GBP (< 400), convert; if USD, use as-is
      const usdPrice = rawPrice < 400 ? rawPrice * 1.27 : rawPrice;
      return { price_usd: Math.round(usdPrice), source: 'OrlandoAttractions.com (live)' };
    }
    return null;
  } catch (err) {
    logger.warn(`OrlandoAttractions fetch failed: ${err.message}`);
    return null;
  }
}

async function checkUniversalPrices() {
  logger.info('🎬 Fetching Universal Three Park Adventure prices (14 days, 4 people)...');
  const rate = await getUsdToBrl();

  // Fetch the price once — it's fixed regardless of date
  logger.info('  Fetching current Three Park Adventure Ticket price...');
  let priceData = await fetchPriceFromAttractionTickets(rate);
  if (!priceData) priceData = await fetchPriceFromOrlandoAttractions(rate);

  // Fallback: last confirmed price from research (April 2026)
  // Source: attractiontickets.com Three Park Adventure Ticket for Jan/Feb 2027
  if (!priceData) {
    logger.warn('Using confirmed fallback price for Universal Three Park Adventure Ticket');
    priceData = {
      price_usd: 395,
      source: 'Confirmed price — AttractionTickets.com (pesquisa abr/2026)',
    };
  }

  const priceUsd = priceData.price_usd;
  const priceBrl = priceUsd * rate;
  const totalBrl4 = priceBrl * 4;
  const isLive = priceData.source.includes('live');

  const results = [];

  // Generate one row per target start date, each with its own direct booking link
  for (const startDate of TARGET_DATES) {
    const bookingLink = buildUniversalLink(startDate);
    const fallbackLink = buildOrlandoAttractionsLink(startDate);

    const result = {
      park_brand: 'universal',
      ticket_type: isLive ? 'promoção' : 'confirmado',
      promotion_name: `Three Park Adventure — 14 dias a partir de ${startDate}`,
      days: 14,
      visit_date: startDate,
      price_usd: priceUsd,
      price_brl: Math.round(priceBrl),
      total_brl: Math.round(totalBrl4),
      num_tickets: 4,
      park_names: PARKS_3,
      valid_dates: startDate,
      source_url: bookingLink,
      fallback_url: fallbackLink,
      source: priceData.source,
      obs: 'Volcano Bay fechado jan–mar 2027. Inclui Studios FL + Islands of Adventure + Epic Universe. Não vendido na bilheteria.',
    };

    results.push(result);

    try {
      await db.query(`
        INSERT INTO park_prices
          (park_brand, park_names, ticket_type, promotion_name, days,
           price_usd, price_brl, num_tickets, total_brl, valid_dates, source_url)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `, [
        'universal', result.park_names, result.ticket_type, result.promotion_name,
        result.days, result.price_usd, result.price_brl, result.num_tickets,
        result.total_brl, result.valid_dates, result.source_url,
      ]);
    } catch (dbErr) {
      logger.error(`Failed to save Universal price for ${startDate}: ${dbErr.message}`);
    }
  }

  logger.info(`🎬 Universal: ${results.length} date(s) generated (price: $${priceUsd} / R$${Math.round(priceBrl)} per person)`);
  return results;
}

module.exports = { checkUniversalPrices };
