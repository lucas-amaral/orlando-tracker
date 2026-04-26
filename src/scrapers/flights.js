// src/scrapers/flights.js
// Searches for round-trip flights POA → MCO for Jan/Feb 2027
//
// STRATEGY — multiple sources in order of reliability:
//   1. Amadeus Flight Offers API (free tier, 2000 calls/month) — most reliable
//   2. Skyscanner unofficial browse endpoint — no key needed
//   3. Mundi.com.br public API — Brazilian aggregator
//
// HOW TO GET AMADEUS FREE API KEY:
//   1. Go to https://developers.amadeus.com and create a free account
//   2. Go to My Apps → Create new app
//   3. Copy the API Key and API Secret to your .env file as:
//      AMADEUS_API_KEY=xxxx
//      AMADEUS_API_SECRET=xxxx
//   Without a key the scraper falls back to other sources.
const axios = require('axios');
const db = require('../db/client');
const logger = require('../utils/logger');
const { getUsdToBrl } = require('../utils/exchange');

const CONFIG = {
  origin: process.env.ORIGIN_AIRPORT || 'POA',
  destination: process.env.DESTINATION_AIRPORT || 'MCO',
  passengers: parseInt(process.env.NUM_PASSENGERS) || 4,
  minDays: parseInt(process.env.MIN_TRIP_DAYS) || 12,
  maxDays: parseInt(process.env.MAX_TRIP_DAYS) || 18,
};

// Generates date combinations within Jan–Feb 2027
// Prefers Tuesdays and Thursdays — typically cheapest days to fly
function generateDateCombinations() {
  const combinations = [];
  const months = ['2027-01', '2027-02'];

  for (const month of months) {
    const [year, mon] = month.split('-').map(Number);
    const daysInMonth = new Date(year, mon, 0).getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const depDate = new Date(year, mon - 1, day);
      // Day 2 = Tuesday, Day 4 = Thursday
      if (depDate.getDay() === 2 || depDate.getDay() === 4) {
        for (let duration = CONFIG.minDays; duration <= CONFIG.maxDays; duration += 3) {
          const retDate = new Date(depDate);
          retDate.setDate(retDate.getDate() + duration);
          combinations.push({
            departure: depDate.toISOString().split('T')[0],
            returnDate: retDate.toISOString().split('T')[0],
            duration,
          });
        }
      }
    }
  }

  // Limit to 6 combinations to avoid exhausting free tier API quota
  return combinations.slice(0, 6);
}

// Source 1: Amadeus Flight Offers Search API (free tier — most reliable)
// Register at: https://developers.amadeus.com
let amadeusToken = null;
let amadeusTokenExpiry = 0;

async function getAmadeusToken() {
  // Reuse token if still valid
  if (amadeusToken && Date.now() < amadeusTokenExpiry) return amadeusToken;

  const key = process.env.AMADEUS_API_KEY;
  const secret = process.env.AMADEUS_API_SECRET;
  if (!key || !secret) return null;

  try {
    const res = await axios.post(
      'https://test.api.amadeus.com/v1/security/oauth2/token',
      new URLSearchParams({ grant_type: 'client_credentials', client_id: key, client_secret: secret }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
    );
    amadeusToken = res.data.access_token;
    amadeusTokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000;
    logger.info('Amadeus token refreshed successfully');
    return amadeusToken;
  } catch (err) {
    logger.warn(`Failed to get Amadeus token: ${err.message}`);
    return null;
  }
}

async function searchAmadeus(departure, returnDate) {
  const token = await getAmadeusToken();
  if (!token) return null;

  try {
    const res = await axios.get('https://test.api.amadeus.com/v2/shopping/flight-offers', {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        originLocationCode: CONFIG.origin,
        destinationLocationCode: CONFIG.destination,
        departureDate: departure,
        returnDate: returnDate,
        adults: CONFIG.passengers,
        currencyCode: 'BRL',
        max: 5,
        nonStop: false,
      },
      timeout: 20000,
    });

    const offers = res.data?.data;
    if (!offers || offers.length === 0) return null;

    // Sort by price and return the cheapest offer
    offers.sort((a, b) => parseFloat(a.price.grandTotal) - parseFloat(b.price.grandTotal));
    const best = offers[0];

    const outbound = best.itineraries[0];
    const inbound = best.itineraries[1];
    const firstSegment = outbound?.segments?.[0];
    const stops = (outbound?.segments?.length || 1) - 1;

    // Build airline name from carrier codes
    const carrierCodes = [...new Set(
      [...(outbound?.segments || []), ...(inbound?.segments || [])]
        .map(s => s.carrierCode)
    )];
    const airlineNames = {
      LA: 'LATAM', JJ: 'LATAM', AD: 'Azul', G3: 'GOL',
      AA: 'American', UA: 'United', DL: 'Delta', IB: 'Iberia', TP: 'TAP',
    };
    const airline = carrierCodes.map(c => airlineNames[c] || c).join(' + ');

    return {
      price: parseFloat(best.price.grandTotal) / CONFIG.passengers,
      totalPrice: parseFloat(best.price.grandTotal),
      airline,
      stops,
      source: 'Amadeus API',
    };
  } catch (err) {
    logger.warn(`Amadeus search failed for ${departure}: ${err.response?.data?.errors?.[0]?.detail || err.message}`);
    return null;
  }
}

// Source 2: Skyscanner browse prices (no key required, returns indicative prices)
async function searchSkyscanner(departure) {
  try {
    const depMonth = departure.substring(0, 7).replace('-', '-');
    const res = await axios.get(
      `https://partners.api.skyscanner.net/apiservices/browseroutes/v1.0/BR/BRL/pt-BR/${CONFIG.origin}/${CONFIG.destination}/${depMonth}`,
      {
        headers: {
          'apikey': 'prtl6749387986743898559646983194',  // public demo key
          'User-Agent': 'Mozilla/5.0',
        },
        timeout: 15000,
      }
    );

    const routes = res.data?.Routes;
    if (!routes || routes.length === 0) return null;

    const cheapest = routes.sort((a, b) => a.Price - b.Price)[0];
    const carrierMap = {};
    (res.data?.Carriers || []).forEach(c => { carrierMap[c.CarrierId] = c.Name; });
    const airline = cheapest.QuoteIds
      .map(qid => {
        const q = (res.data?.Quotes || []).find(q => q.QuoteId === qid);
        return (q?.OutboundLeg?.CarrierIds || []).map(id => carrierMap[id] || id).join('+');
      }).join(' / ') || 'Multiple airlines';

    return {
      price: cheapest.Price / CONFIG.passengers,
      totalPrice: cheapest.Price,
      airline: airline || 'Multiple airlines',
      stops: 1, // Skyscanner browse doesn't return stops count
      source: 'Skyscanner',
      indicative: true, // Browse prices are indicative, not bookable directly
    };
  } catch (err) {
    logger.warn(`Skyscanner search failed: ${err.message}`);
    return null;
  }
}

// Source 3: Mundi.com.br public API (Brazilian aggregator)
async function searchMundi(departure, returnDate) {
  try {
    const res = await axios.get('https://www.mundi.com.br/api/v1/flights/search', {
      params: {
        origin: CONFIG.origin,
        destination: CONFIG.destination,
        departureDate: departure,
        returnDate: returnDate,
        adults: CONFIG.passengers,
        cabin: 'Y',
        currency: 'BRL',
      },
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://www.mundi.com.br',
        'Origin': 'https://www.mundi.com.br',
      },
      timeout: 20000,
    });

    const offers = res.data?.offers || res.data?.results || [];
    if (offers.length === 0) return null;

    const cheapest = offers.sort((a, b) => a.totalPrice - b.totalPrice)[0];
    return {
      price: cheapest.totalPrice / CONFIG.passengers,
      totalPrice: cheapest.totalPrice,
      airline: cheapest.carrier || cheapest.airlines?.join(' + ') || 'Multiple airlines',
      stops: cheapest.stops ?? 1,
      source: 'Mundi.com.br',
    };
  } catch {
    return null;
  }
}

// Builds a direct search link for the user to verify and book
function buildSearchLinks(departure, returnDate) {
  const dep = departure.replace(/-/g, '');
  const ret = returnDate.replace(/-/g, '');
  const n = CONFIG.passengers;
  return {
    kayak: `https://www.kayak.com.br/flights/${CONFIG.origin}-${CONFIG.destination}/${departure}/${returnDate}/${n}adults`,
    google: `https://www.google.com/travel/flights?q=Voos+${CONFIG.origin}+${CONFIG.destination}+${departure}+volta+${returnDate}&hl=pt-BR`,
    mundi: `https://www.mundi.com.br/passagens-aereas/${CONFIG.origin.toLowerCase()}-${CONFIG.destination.toLowerCase()}/${departure}/${returnDate}/${n}-adultos`,
    decolar: `https://www.decolar.com/passagens-aereas/${CONFIG.origin}-${CONFIG.destination}/${departure}/${returnDate}/${n}/0/0/SIM`,
  };
}

// Main function — tries all sources for each date combination
async function checkFlightPrices() {
  logger.info('✈️  Starting flight search POA → MCO...');
  const rate = await getUsdToBrl();
  const combinations = generateDateCombinations();
  const results = [];

  const hasAmadeus = !!(process.env.AMADEUS_API_KEY && process.env.AMADEUS_API_SECRET);
  if (!hasAmadeus) {
    logger.warn('Amadeus API keys not configured — falling back to Skyscanner/Mundi. Add AMADEUS_API_KEY and AMADEUS_API_SECRET to .env for better results.');
  }

  for (const combo of combinations) {
    logger.info(`  Checking ${combo.departure} → ${combo.returnDate} (${combo.duration} days)`);

    let data = null;

    // Try sources in order of reliability
    if (hasAmadeus) {
      data = await searchAmadeus(combo.departure, combo.returnDate);
    }
    if (!data) {
      data = await searchMundi(combo.departure, combo.returnDate);
    }
    if (!data) {
      data = await searchSkyscanner(combo.departure);
    }

    if (data && data.price > 0) {
      // Convert to BRL if price looks like USD (< 5000)
      const priceBrl = data.price < 5000 && rate > 1 ? data.price * rate : data.price;
      const totalBrl = data.totalPrice
        ? (data.totalPrice < 5000 * CONFIG.passengers ? data.totalPrice * rate : data.totalPrice)
        : priceBrl * CONFIG.passengers;

      const links = buildSearchLinks(combo.departure, combo.returnDate);

      const result = {
        airline: data.airline || 'Multiple airlines',
        departure_date: combo.departure,
        return_date: combo.returnDate,
        trip_days: combo.duration,
        price_brl: Math.round(priceBrl),
        total_brl: Math.round(totalBrl),
        num_passengers: CONFIG.passengers,
        stops: data.stops?.toString() ?? '1',
        // Store all search links in source_url as a JSON string
        source_url: links.kayak,
        raw_data: { links, source: data.source, indicative: data.indicative || false },
      };
      results.push(result);

      // Save to database
      await db.query(`
        INSERT INTO flight_prices
          (airline, origin, destination, departure_date, return_date, trip_days,
           price_brl, num_passengers, total_brl, stops, source_url, raw_data)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      `, [
        result.airline, CONFIG.origin, CONFIG.destination,
        result.departure_date, result.return_date, result.trip_days,
        result.price_brl, CONFIG.passengers, result.total_brl,
        result.stops, result.source_url, JSON.stringify(result.raw_data),
      ]);
    }

    // Pause between requests to avoid rate limiting
    await new Promise(r => setTimeout(r, 2000));
  }

  logger.info(`✈️  Flights: ${results.length} combination(s) found`);
  return results;
}

module.exports = { checkFlightPrices };
