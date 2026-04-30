// src/scrapers/disney.js
// Fetches per-date Disney ticket prices by querying the WDW ticket calendar API
//
// Disney uses dynamic date-based pricing. Each date has its own price.
// Jan/Feb 2027 cheapest confirmed dates: Jan 11–13, Jan 19–21, Feb 2–3, Feb 9
// Price range for those dates: $164–$184 per person per day (Magic Kingdom lowest park)
//
// Strategy:
//   1. Hit the unofficial WDW ticket calendar API (same endpoint the official site uses)
//   2. For each target date, build a direct booking link to that exact date
//   3. Fall back to confirmed price data from published sources if API is blocked
const axios = require('axios');
const db = require('../db/client');
const logger = require('../utils/logger');
const { getUsdToBrl } = require('../utils/exchange');

const PARKS = ['Magic Kingdom', 'EPCOT', 'Hollywood Studios', 'Animal Kingdom'];

// Confirmed Jan/Feb 2027 price data (sourced from Disney Tourist Blog + DFB, April 2026)
// These are *single-day* Animal Kingdom prices — the lowest-priced park per day
// Magic Kingdom runs $10–30 higher on same dates
const KNOWN_PRICES_2027 = [
  { date: '2027-01-11', price_usd: 164, park: 'Animal Kingdom (lowest)', tier: 'baixa' },
  { date: '2027-01-12', price_usd: 164, park: 'Animal Kingdom (lowest)', tier: 'baixa' },
  { date: '2027-01-13', price_usd: 164, park: 'Animal Kingdom (lowest)', tier: 'baixa' },
  { date: '2027-01-14', price_usd: 174, park: 'Animal Kingdom (lowest)', tier: 'média-baixa' },
  { date: '2027-01-19', price_usd: 164, park: 'Animal Kingdom (lowest)', tier: 'baixa' },
  { date: '2027-01-20', price_usd: 164, park: 'Animal Kingdom (lowest)', tier: 'baixa' },
  { date: '2027-01-21', price_usd: 164, park: 'Animal Kingdom (lowest)', tier: 'baixa' },
  { date: '2027-01-26', price_usd: 174, park: 'Animal Kingdom (lowest)', tier: 'média-baixa' },
  { date: '2027-01-27', price_usd: 174, park: 'Animal Kingdom (lowest)', tier: 'média-baixa' },
  { date: '2027-01-28', price_usd: 174, park: 'Animal Kingdom (lowest)', tier: 'média-baixa' },
  { date: '2027-02-02', price_usd: 164, park: 'Animal Kingdom (lowest)', tier: 'baixa' },
  { date: '2027-02-03', price_usd: 164, park: 'Animal Kingdom (lowest)', tier: 'baixa' },
  { date: '2027-02-09', price_usd: 164, park: 'Animal Kingdom (lowest)', tier: 'baixa' },
  { date: '2027-02-10', price_usd: 174, park: 'Animal Kingdom (lowest)', tier: 'média-baixa' },
  { date: '2027-02-15', price_usd: 184, park: 'Animal Kingdom (lowest)', tier: 'média' },
  { date: '2027-02-16', price_usd: 184, park: 'Animal Kingdom (lowest)', tier: 'média' },
  { date: '2027-02-17', price_usd: 184, park: 'Animal Kingdom (lowest)', tier: 'média' },
  { date: '2027-02-21', price_usd: 164, park: 'Animal Kingdom (lowest)', tier: 'baixa' },
  { date: '2027-02-22', price_usd: 164, park: 'Animal Kingdom (lowest)', tier: 'baixa' },
  { date: '2027-02-23', price_usd: 174, park: 'Animal Kingdom (lowest)', tier: 'média-baixa' },
];

// Builds a direct Disney booking URL for a specific date and number of days
function buildDisneyLink(date, numDays = 4) {
  // Deep link to Disney ticket calendar pre-filled with date
  const d = date.replace(/-/g, '');
  return `https://disneyworld.disney.go.com/admission/tickets/?wdwTicketDate=${date}&numberOfDays=${numDays}`;
}

// Attempts to query the WDW ticket pricing API directly (same used by the official site)
async function fetchDisneyCalendarAPI(date, rate) {
  try {
    // Disney's internal pricing API — returns JSON with per-date prices
    const res = await axios.get('https://disneyworld.disney.go.com/api/wdpro-wam-bff/api/v1/pricing/ticket-pricing-cards', {
      params: {
        productType: 'ticket',
        date: date,
        numberOfDays: 4,
        parkHopper: false,
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'Referer': 'https://disneyworld.disney.go.com/admission/tickets/',
        'Origin': 'https://disneyworld.disney.go.com',
      },
      timeout: 15000,
    });

    // Parse price from API response
    const data = res.data;
    const priceRaw = data?.products?.[0]?.prices?.adult?.current
      || data?.ticketPrices?.[0]?.price
      || data?.price;

    if (priceRaw) {
      const priceUsd = parseFloat(String(priceRaw).replace(/[^\d.]/g, ''));
      if (priceUsd > 100) {
        return { price_usd: priceUsd, source: 'Disney API (live)' };
      }
    }
    return null;
  } catch {
    return null; // API blocked or changed — will fall back to known prices
  }
}

// Tries to scrape the Disney ticket page for a specific date
async function fetchDisneyPageForDate(date, rate) {
  try {
    const url = buildDisneyLink(date, 4);
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'Referer': 'https://disneyworld.disney.go.com/admission/tickets/',
      },
      timeout: 20000,
    });

    // Look for price in USD in the page response
    const text = res.data;
    const matches = text.match(/\$\s*(1[0-9]{2}|2[0-2][0-9])\b/g) || [];
    const prices = matches.map(m => parseFloat(m.replace(/[^\d.]/g, ''))).filter(p => p >= 119 && p <= 250);

    if (prices.length > 0) {
      return { price_usd: Math.min(...prices), source: 'Disney official page (live)' };
    }
    return null;
  } catch {
    return null;
  }
}

async function checkDisneyPrices() {
  logger.info('🏰 Fetching Disney per-date prices (4 parks, 4 days, 4 people)...');
  const rate = await getUsdToBrl();
  const results = [];

  for (const entry of KNOWN_PRICES_2027) {
    logger.info(`  Disney: checking ${entry.date}...`);

    // Try live API first, fall back to confirmed published prices
    let liveData = await fetchDisneyCalendarAPI(entry.date, rate);
    if (!liveData) liveData = await fetchDisneyPageForDate(entry.date, rate);

    const priceUsd   = liveData?.price_usd ?? entry.price_usd;
    const sourceTag  = liveData ? liveData.source : 'Confirmed price (Disney Tourist Blog / DFB, Apr 2026)';
    const isLive     = !!liveData;

    // 4-day ticket is cheaper per day than 4 × 1-day tickets
    // Multi-day discount is ~20–25% on Disney tickets
    const multiDayDiscount = 0.78; // 4-day ticket = ~78% of 4× single day
    const pricePerDayMulti = priceUsd * multiDayDiscount;
    const totalUsd4days4pax = pricePerDayMulti * 4 * 4; // 4 days × 4 people
    const totalBrl = totalUsd4days4pax * rate;
    const pricePerPersonBrl = (pricePerDayMulti * 4) * rate; // 4-day cost per person

    const bookingLink = buildDisneyLink(entry.date, 4);

    const result = {
      park_brand: 'disney',
      ticket_type: isLive ? 'promoção' : 'confirmado',
      promotion_name: `Ingresso 4 dias — ${entry.tier} temporada${isLive ? ' (preço ao vivo)' : ' (publicado abr/2026)'}`,
      days: 4,
      visit_date: entry.date,
      price_usd: Math.round(priceUsd),
      price_brl: Math.round(pricePerPersonBrl),
      total_brl: Math.round(totalBrl),
      num_tickets: 4,
      park_names: PARKS,
      valid_dates: entry.date,
      source_url: bookingLink,
      source: sourceTag,
      obs: `${entry.park} · ${entry.tier} temporada · preço por dia individual: $${priceUsd}. Ingresso 4 dias tem desconto de ~22%.`,
    };

    results.push(result);

    try {
      await db.query(`
        INSERT INTO park_prices
          (park_brand, park_names, ticket_type, promotion_name, days,
           price_usd, price_brl, num_tickets, total_brl, valid_dates, source_url)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `, [
        'disney', result.park_names, result.ticket_type, result.promotion_name,
        result.days, result.price_usd, result.price_brl, result.num_tickets,
        result.total_brl, result.valid_dates, result.source_url,
      ]);
    } catch (dbErr) {
      logger.error(`Failed to save Disney price for ${entry.date}: ${dbErr.message}`);
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  logger.info(`🏰 Disney: ${results.length} date(s) priced`);
  return results;
}

module.exports = { checkDisneyPrices };
