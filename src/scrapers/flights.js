// src/scrapers/flights.js
// Searches for round-trip flights POA → MCO using Google Flights via SerpApi
//
// HOW TO GET YOUR FREE SERPAPI KEY:
//   1. Go to https://serpapi.com and click "Register"
//   2. Confirm your email
//   3. Go to https://serpapi.com/manage-api-key and copy your API key
//   4. Add SERPAPI_KEY=your_key to your .env / Render environment variables
//
// Free tier: 100 searches/month — enough for 2 checks/day on a small date set
// Each check runs ~6 date combinations = 6 API calls
// Monthly usage at 2x/day: ~360 calls — upgrade to $50/month plan if needed
//
// The API returns the same data shown in google.com/travel/flights,
// including airline, stops, departure/arrival times, and a direct Google Flights link.
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
// Prefers Tuesdays and Thursdays — typically the cheapest days to depart
function generateDateCombinations() {
  const combinations = [];
  const months = ['2027-01', '2027-02'];

  for (const month of months) {
    const [year, mon] = month.split('-').map(Number);
    const daysInMonth = new Date(year, mon, 0).getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const depDate = new Date(year, mon - 1, day);
      // 2 = Tuesday, 4 = Thursday
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

  // Limit to 6 per run to stay within free tier (100 calls/month)
  return combinations.slice(0, 6);
}

// Builds a direct Google Flights URL for the user to open and book
// This is the same URL that SerpApi returns in search_metadata.google_flights_url
function buildGoogleFlightsUrl(departure, returnDate, passengers) {
  const params = new URLSearchParams({
    hl: 'pt-BR',
    gl: 'br',
    curr: 'BRL',
  });
  // Google Flights uses a compact tfs param — use the readable fallback URL
  return `https://www.google.com/travel/flights/search?q=voos+${CONFIG.origin}+${CONFIG.destination}&hl=pt-BR&curr=BRL#flt=${CONFIG.origin}.${CONFIG.destination}.${departure}*${CONFIG.destination}.${CONFIG.origin}.${returnDate};c:BRL;e:1;sd:1;t:f;tt:o`;
}

// Calls the SerpApi Google Flights endpoint for a specific date pair
async function searchGoogleFlights(departure, returnDate) {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    logger.warn('SERPAPI_KEY not set — skipping Google Flights search');
    return null;
  }

  try {
    // SerpApi Google Flights API — returns structured JSON matching google.com/travel/flights
    const res = await axios.get('https://serpapi.com/search', {
      params: {
        engine: 'google_flights',
        api_key: apiKey,
        departure_id: CONFIG.origin,
        arrival_id: CONFIG.destination,
        outbound_date: departure,
        return_date: returnDate,
        adults: CONFIG.passengers,
        type: 1,           // 1 = round trip
        travel_class: 1,   // 1 = economy
        currency: 'BRL',
        hl: 'pt',
        gl: 'br',
        deep_search: true, // matches exact browser results
      },
      timeout: 30000,
    });

    const data = res.data;

    // SerpApi returns best_flights (top picks) and other_flights
    const allOffers = [
      ...(data.best_flights || []),
      ...(data.other_flights || []),
    ];

    if (allOffers.length === 0) {
      logger.warn(`  No flights found for ${departure} → ${returnDate}`);
      return null;
    }

    // Sort by price and take the cheapest option
    allOffers.sort((a, b) => (a.price || Infinity) - (b.price || Infinity));
    const best = allOffers[0];

    // Extract airline names from all flight segments (outbound + return)
    const airlineNames = [...new Set(
      (best.flights || []).map(f => f.airline).filter(Boolean)
    )];
    const airline = airlineNames.join(' + ') || 'Multiple airlines';

    // Count layovers from the outbound leg
    const stops = (best.layovers || []).length;

    // SerpApi provides the exact Google Flights URL for this search
    const googleUrl = data.search_metadata?.google_flights_url
      || buildGoogleFlightsUrl(departure, returnDate, CONFIG.passengers);

    // SerpApi returns the TOTAL price for all passengers combined, not per person
    const totalBrl = best.price;
    const pricePerPerson = Math.round(totalBrl / CONFIG.passengers);

    return {
      price_brl: pricePerPerson,
      total_brl: totalBrl,
      airline,
      stops,
      google_flights_url: googleUrl,
      source: 'Google Flights (SerpApi)',
    };
  } catch (err) {
    const status = err.response?.status;
    const message = err.response?.data?.error || err.message;

    if (status === 401) {
      logger.error('SerpApi: invalid API key — check SERPAPI_KEY in environment variables');
    } else if (status === 429) {
      logger.warn('SerpApi: monthly quota reached — upgrade plan at serpapi.com/pricing');
    } else {
      logger.warn(`SerpApi search failed for ${departure}: ${message}`);
    }
    return null;
  }
}

// Main function — searches all date combinations and saves results to database
async function checkFlightPrices() {
  logger.info('✈️  Starting flight search POA → MCO via Google Flights (SerpApi)...');
  const rate = await getUsdToBrl();
  const combinations = generateDateCombinations();
  const results = [];

  if (!process.env.SERPAPI_KEY) {
    logger.error('SERPAPI_KEY is not configured. Add it to your environment variables.');
    logger.error('Get a free key at: https://serpapi.com/manage-api-key');
    return results;
  }

  for (const combo of combinations) {
    logger.info(`  Searching ${combo.departure} → ${combo.returnDate} (${combo.duration} days)...`);

    const data = await searchGoogleFlights(combo.departure, combo.returnDate);

    if (data && data.price_brl > 0) {
      const result = {
        airline: data.airline,
        departure_date: combo.departure,
        return_date: combo.returnDate,
        trip_days: combo.duration,
        price_brl: data.price_brl,       // per person
        total_brl: data.total_brl,       // all passengers combined (already correct from SerpApi)
        num_passengers: CONFIG.passengers,
        stops: data.stops?.toString() ?? '1',
        source_url: data.google_flights_url,
        raw_data: {
          source: data.source,
          google_flights_url: data.google_flights_url,
        },
      };

      results.push(result);
      logger.info(`    → R$ ${data.total_brl} total / R$ ${data.price_brl} per person (${data.airline}, ${data.stops} stop(s))`);

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

    // Pause 1s between requests to respect SerpApi rate limits
    await new Promise(r => setTimeout(r, 1000));
  }

  logger.info(`✈️  Flights: ${results.length} result(s) found`);
  return results;
}

module.exports = { checkFlightPrices };
