// src/check.js — Executa uma verificação imediata sem iniciar o servidor
require('dotenv').config();
const logger = require('./utils/logger');
const { checkFlightPrices } = require('./scrapers/flights');
const { checkDisneyPrices } = require('./scrapers/disney');
const { checkUniversalPrices } = require('./scrapers/universal');
const { checkAndSendAlerts } = require('./alerts/email');

async function main() {
  logger.info('🔍 Iniciando verificação manual...');
  
  const [flights, disney, universal] = await Promise.allSettled([
    checkFlightPrices(),
    checkDisneyPrices(),
    checkUniversalPrices(),
  ]);

  const fr = flights.status === 'fulfilled' ? flights.value : [];
  const dr = disney.status === 'fulfilled' ? disney.value : [];
  const ur = universal.status === 'fulfilled' ? universal.value : [];

  logger.info('\n--- RESUMO ---');
  logger.info(`✈️  Passagens: ${fr.length} resultados`);
  if (fr.length > 0) {
    const best = fr.sort((a, b) => a.total_brl - b.total_brl)[0];
    logger.info(`   Melhor: R$ ${best.total_brl} (${best.departure_date} → ${best.return_date}, ${best.airline})`);
  }
  
  logger.info(`🏰 Disney: ${dr.length} resultados`);
  if (dr.length > 0) {
    const best = dr.sort((a, b) => a.total_brl - b.total_brl)[0];
    logger.info(`   Melhor: R$ ${best.total_brl} (${best.ticket_type}${best.promotion_name ? ' – ' + best.promotion_name : ''})`);
  }
  
  logger.info(`🎬 Universal: ${ur.length} resultados`);
  if (ur.length > 0) {
    const best = ur.sort((a, b) => a.total_brl - b.total_brl)[0];
    logger.info(`   Melhor: R$ ${best.total_brl} (${best.ticket_type}${best.promotion_name ? ' – ' + best.promotion_name : ''})`);
  }

  await checkAndSendAlerts(fr, dr, ur);
  logger.info('\n✅ Verificação concluída!');
  process.exit(0);
}

main().catch(err => {
  logger.error('Erro fatal:', err);
  process.exit(1);
});
