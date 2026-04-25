// src/scrapers/flights.js
// Fetches POA → MCO flights using Google Flights via SerpAPI (100 free req/month)
// or directly through the public Google Flights endpoint
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

// Generate all date combinations within the Jan-Feb 2027 range
function generateDateCombinations() {
  const combinations = [];
  const months = ['2027-01', '2027-02'];
  
  for (const month of months) {
    const [year, mon] = month.split('-').map(Number);
    const daysInMonth = new Date(year, mon, 0).getDate();
    
    for (let day = 1; day <= daysInMonth; day++) {
      const depDate = new Date(year, mon - 1, day);
      if (depDate.getDay() === 2 || depDate.getDay() === 4) { // Tue or Thu = cheaper
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
  return combinations.slice(0, 8); // Limit to avoid exhausting requests
}

// Method 1: Kayak unofficial endpoint (light scraping via headers)
async function scrapeKayak(departure, returnDate) {
  try {
    const url = `https://www.kayak.com.br/flights/${CONFIG.origin}-${CONFIG.destination}/${departure}/${returnDate}/${CONFIG.passengers}adults`;
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeout: 15000,
    });
    // Kayak returns structured JSON data embedded in the HTML
    const match = res.data.match(/"price":"([\d.]+)"/g);
    if (match && match.length > 0) {
      const prices = match.map(m => parseFloat(m.match(/([\d.]+)/)[0])).filter(p => p > 50);
      return Math.min(...prices);
    }
    return null;
  } catch {
    return null;
  }
}

// Method 2: Google Flights via Serpapi (100 free calls/month, no key = demo)
async function scrapeGoogleFlights(departure, returnDate) {
  try {
    // Public Google Flights endpoint (no API key, limited)
    const params = new URLSearchParams({
      engine: 'google_flights',
      departure_id: CONFIG.origin,
      arrival_id: CONFIG.destination,
      outbound_date: departure,
      return_date: returnDate,
      adults: CONFIG.passengers,
      currency: 'BRL',
      hl: 'pt',
      gl: 'br',
    });
    // Use the free SerpApi endpoint (demo, no auth, limited real data)
    const res = await axios.get(`https://serpapi.com/search?${params}`, {
      timeout: 15000,
    });
    
    if (res.data?.best_flights?.[0]) {
      const best = res.data.best_flights[0];
      return {
        price: best.price,
        airline: best.flights?.[0]?.airline,
        stops: best.flights?.length - 1,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// Method 3: Mundi.com.br — public search endpoint
async function scrapeMundi(departure, returnDate) {
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
      },
      timeout: 20000,
    });
    const offers = res.data?.offers || res.data?.results || [];
    if (offers.length > 0) {
      const cheapest = offers.sort((a, b) => a.totalPrice - b.totalPrice)[0];
      return {
        price: cheapest.totalPrice / CONFIG.passengers,
        airline: cheapest.carrier || 'Múltiplas',
        stops: cheapest.stops || 1,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// Main function: tries multiple sources
async function checkFlightPrices() {
  logger.info('✈️  Iniciando busca de passagens POA → MCO...');
  const rate = await getUsdToBrl();
  const combinations = generateDateCombinations();
  const results = [];

  for (const combo of combinations) {
    logger.info(`  Verificando ${combo.departure} → ${combo.returnDate} (${combo.duration} dias)`);
    
    let data = null;
    
    // Try Mundi first (more scraping-friendly)
    data = await scrapeMundi(combo.departure, combo.returnDate);
    
    // Fallback to Google Flights
    if (!data) {
      const price = await scrapeGoogleFlights(combo.departure, combo.returnDate);
      if (price) data = { price, airline: 'Combinado', stops: 1 };
    }

    if (data && data.price > 0) {
      const priceBrl = data.price < 1000 ? data.price * rate : data.price;
      const totalBrl = priceBrl * CONFIG.passengers;
      
      const result = {
        airline: data.airline || 'Verificar site',
        departure_date: combo.departure,
        return_date: combo.returnDate,
        trip_days: combo.duration,
        price_brl: Math.round(priceBrl),
        total_brl: Math.round(totalBrl),
        num_passengers: CONFIG.passengers,
        stops: data.stops?.toString() || '1',
        source_url: `https://www.mundi.com.br/voos/${CONFIG.origin}-${CONFIG.destination}`,
      };
      results.push(result);

      // Save to the database
      await db.query(`
        INSERT INTO flight_prices 
          (airline, origin, destination, departure_date, return_date, trip_days,
           price_brl, num_passengers, total_brl, stops, source_url)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `, [
        result.airline, CONFIG.origin, CONFIG.destination,
        result.departure_date, result.return_date, result.trip_days,
        result.price_brl, CONFIG.passengers, result.total_brl,
        result.stops, result.source_url,
      ]);
    }

    // Pause between requests to avoid being blocked
    await new Promise(r => setTimeout(r, 2500));
  }

  logger.info(`✈️  Passagens: ${results.length} combinações encontradas`);
  return results;
}

module.exports = { checkFlightPrices };
