// src/scrapers/disney.js
// Fetches prices for the 4 Disney parks for Jan/Feb 2027
// Primary source: orlandoparabrasileiros.com (prices in BRL, active promotions)
// Secondary source: official Disney site
const axios = require('axios');
const cheerio = require('cheerio');
const db = require('../db/client');
const logger = require('../utils/logger');
const { getUsdToBrl } = require('../utils/exchange');

const PARKS = ['Magic Kingdom', 'EPCOT', 'Hollywood Studios', 'Animal Kingdom'];

// Source 1: Orlando Para Brasileiros — checks the "4-Park Magic Ticket" promotion
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
    const results = [];

    // Look for BRL prices listed on the page
    const pricePattern = /R\$\s*([\d.,]+)/g;
    const pageText = $('body').text();
    const prices = [];
    let match;
    while ((match = pricePattern.exec(pageText)) !== null) {
      const price = parseFloat(match[1].replace(/\./g, '').replace(',', '.'));
      if (price > 500 && price < 20000) prices.push(price);
    }

    // Check the "4-Park Magic Ticket" promotion (4 parks for the price of 3)
    const hasPromo = pageText.toLowerCase().includes('4-park magic') ||
                     pageText.toLowerCase().includes('4 parques pelo preço de 3') ||
                     pageText.toLowerCase().includes('magic disney');
    
    // Look for discounted 4-day prices
    const promoMatch = pageText.match(/4.Park.*?R\$\s*([\d.,]+)/i) ||
                       pageText.match(/4 parques.*?R\$\s*([\d.,]+)/i);
    
    if (promoMatch || prices.length > 0) {
      const bestPrice = promoMatch
        ? parseFloat(promoMatch[1].replace(/\./g, '').replace(',', '.'))
        : Math.min(...prices.filter(p => p > 1000));

      results.push({
        ticket_type: hasPromo ? 'promoção' : 'avulso',
        promotion_name: hasPromo ? '4-Park Magic Ticket (4 parques / 3 dias)' : null,
        days: 4,
        price_brl: bestPrice,
        total_brl: bestPrice * 4, // 4 people
        num_tickets: 4,
        park_names: PARKS,
        valid_dates: 'Jan–Fev 2027 (verificar disponibilidade)',
        source_url: 'https://orlandoparabrasileiros.com/ingressos-parques-orlando/',
        source: 'Orlando Para Brasileiros',
        has_promo: hasPromo,
      });
    }
    return results;
  } catch (err) {
    logger.warn(`Falha ao acessar Orlando Para Brasileiros: ${err.message}`);
    return [];
  }
}

// Source 2: Official Disney site — prices in converted USD
async function scrapeDisneyOfficial(rate) {
  try {
    const res = await axios.get('https://disneyworld.disney.go.com/pt-br/admission/tickets/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
      timeout: 20000,
    });
    const $ = cheerio.load(res.data);
    const results = [];

    // Look for USD or BRL prices on the page
    const text = $('body').text();
    
    // Current promo: "Enjoy multiple parks from USD 436"
    const usdMatch = text.match(/USD\s*([\d,]+)/gi);
    if (usdMatch && usdMatch.length > 0) {
      const prices = usdMatch
        .map(m => parseFloat(m.replace(/[^\d.]/g, '')))
        .filter(p => p > 100 && p < 2000);
      
      if (prices.length > 0) {
        const minPrice = Math.min(...prices);
        const priceBrl = minPrice * rate;
        results.push({
          ticket_type: 'promoção',
          promotion_name: 'Ingresso Multi-Park (site oficial)',
          days: 4,
          price_usd: minPrice,
          price_brl: Math.round(priceBrl),
          total_brl: Math.round(priceBrl * 4),
          num_tickets: 4,
          park_names: PARKS,
          valid_dates: 'Verificar disponibilidade no site',
          source_url: 'https://disneyworld.disney.go.com/pt-br/admission/tickets/',
          source: 'Disney Oficial',
          has_promo: true,
          obs: 'Preço em USD + IOF (10%). Prefira comprar em BRL via revendedor.',
        });
      }
    }
    return results;
  } catch (err) {
    logger.warn(`Falha ao acessar Disney oficial: ${err.message}`);
    return [];
  }
}

// Source 3: Fallback with estimated prices based on historical data
function getFallbackPrices(rate) {
  // Based on Jan 2026 data + an estimated 5% increase for 2027
  // Source: research performed in April 2026
  const PRICE_USD_4DAYS_ADULT = 400; // ~average low-season Jan/Feb price
  const priceBrl = PRICE_USD_4DAYS_ADULT * rate;
  
  return [{
    ticket_type: 'estimado',
    promotion_name: 'Estimativa baseada em dados históricos',
    days: 4,
    price_usd: PRICE_USD_4DAYS_ADULT,
    price_brl: Math.round(priceBrl),
    total_brl: Math.round(priceBrl * 4),
    num_tickets: 4,
    park_names: PARKS,
    valid_dates: 'Jan–Fev 2027 (baixa temporada — mais barato)',
    source_url: 'https://disneyworld.disney.go.com/pt-br/admission/tickets/',
    source: 'Estimativa histórica',
    has_promo: false,
    obs: 'Preço estimado. Confirme no site oficial ou em orlandoparabrasileiros.com',
  }];
}

async function checkDisneyPrices() {
  logger.info('🏰 Buscando preços Disney (4 parques, 4 dias, 4 pax)...');
  const rate = await getUsdToBrl();
  
  const [opb, official] = await Promise.all([
    scrapeOrlandoParaBrasileiros(),
    scrapeDisneyOfficial(rate),
  ]);

  let allResults = [...opb, ...official];
  
  if (allResults.length === 0) {
    logger.warn('Usando preços estimados Disney (scrapers falharam)');
    allResults = getFallbackPrices(rate);
  }

  // Save to the database
  for (const r of allResults) {
    await db.query(`
      INSERT INTO park_prices 
        (park_brand, park_names, ticket_type, promotion_name, days,
         price_usd, price_brl, num_tickets, total_brl, valid_dates, source_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [
      'disney', r.park_names, r.ticket_type, r.promotion_name,
      r.days, r.price_usd || null, r.price_brl, r.num_tickets,
      r.total_brl, r.valid_dates, r.source_url,
    ]);
  }

  logger.info(`🏰 Disney: ${allResults.length} resultado(s) encontrado(s)`);
  return allResults;
}

module.exports = { checkDisneyPrices };
