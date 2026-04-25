// src/index.js — Main entry point
require('dotenv').config();
const cron = require('node-cron');
const express = require('express');
const logger = require('./utils/logger');
const { checkFlightPrices } = require('./scrapers/flights');
const { checkDisneyPrices } = require('./scrapers/disney');
const { checkUniversalPrices } = require('./scrapers/universal');
const { checkAndSendAlerts } = require('./alerts/email');
const db = require('./db/client');
const { ensureDatabaseSchema } = require('./db/init');

const app = express();
app.use(express.json());

// ====================================================
//  WEB DASHBOARD — http://localhost:3000
// ====================================================
app.get('/', async (req, res) => {
  try {
    // Latest flights
    const flights = await db.query(`
      SELECT * FROM flight_prices
      ORDER BY total_brl ASC, checked_at DESC
      LIMIT 20
    `);
    // Latest tickets
    const parks = await db.query(`
      SELECT * FROM park_prices
      ORDER BY park_brand, total_brl ASC, checked_at DESC
      LIMIT 20
    `);
    // Latest exchange rate
    const rate = await db.query(`
      SELECT usd_to_brl, checked_at FROM exchange_rates
      ORDER BY checked_at DESC LIMIT 1
    `);
    // Last check
    const lastCheck = await db.query(`
      SELECT MAX(checked_at) as last_check FROM flight_prices
    `);
    // Sent alerts
    const alerts = await db.query(`
      SELECT * FROM price_alerts ORDER BY sent_at DESC LIMIT 10
    `);

    const formatBRL = v => v ? `R$ ${parseFloat(v).toLocaleString('pt-BR', { minimumFractionDigits: 0 })}` : '—';
    const formatDate = d => d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';
    const formatDay = d => d ? new Date(d + 'T12:00:00Z').toLocaleDateString('pt-BR') : '—';

    const flightRows = flights.rows.map(f => `
      <tr>
        <td>${formatDay(f.departure_date)}</td>
        <td>${formatDay(f.return_date)}</td>
        <td>${f.trip_days}d</td>
        <td>${f.airline}</td>
        <td>${f.stops === '0' ? 'Direto' : f.stops + ' escala'}</td>
        <td>${formatBRL(f.price_brl)}/pax</td>
        <td class="highlight">${formatBRL(f.total_brl)}</td>
        <td class="small">${formatDate(f.checked_at)}</td>
      </tr>
    `).join('');

    const parkRows = parks.rows.map(p => `
      <tr>
        <td>${p.park_brand === 'disney' ? '🏰 Disney' : '🎬 Universal'}</td>
        <td>
          <span class="badge ${p.ticket_type === 'promoção' ? 'badge-promo' : p.ticket_type === 'estimado' ? 'badge-est' : 'badge-normal'}">
            ${p.ticket_type}
          </span>
        </td>
        <td class="small">${p.promotion_name || '—'}</td>
        <td>${p.days}d</td>
        <td>${formatBRL(p.price_brl)}/ing.</td>
        <td class="highlight">${formatBRL(p.total_brl)}</td>
        <td class="small">${formatDate(p.checked_at)}</td>
      </tr>
    `).join('');

    const alertRows = alerts.rows.map(a => `
      <tr>
        <td>${formatDate(a.sent_at)}</td>
        <td>${a.alert_type}</td>
        <td>${formatBRL(a.threshold_brl)}</td>
        <td class="highlight">${formatBRL(a.actual_brl)}</td>
      </tr>
    `).join('');

    res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>🌴 Orlando Tracker</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #f1f5f9; color: #1e293b; }
    header { background: linear-gradient(135deg, #1e3a5f 0%, #1d4ed8 100%); color: #fff; padding: 24px 32px; }
    header h1 { font-size: 26px; }
    header p { opacity: 0.8; margin-top: 4px; font-size: 14px; }
    .stats { display: flex; gap: 16px; padding: 24px 32px; flex-wrap: wrap; }
    .stat { background: #fff; border-radius: 12px; padding: 20px; min-width: 180px; flex: 1;
            border-left: 4px solid #1d4ed8; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
    .stat .label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: .05em; }
    .stat .value { font-size: 24px; font-weight: 700; margin-top: 4px; }
    .section { padding: 0 32px 32px; }
    .section h2 { font-size: 18px; margin-bottom: 12px; color: #1e293b; }
    table { width: 100%; background: #fff; border-radius: 12px; border-collapse: collapse;
            box-shadow: 0 1px 3px rgba(0,0,0,.1); overflow: hidden; }
    th { background: #f8fafc; padding: 12px 14px; text-align: left; font-size: 12px;
         text-transform: uppercase; letter-spacing: .05em; color: #64748b; border-bottom: 1px solid #e2e8f0; }
    td { padding: 10px 14px; font-size: 14px; border-bottom: 1px solid #f1f5f9; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #f8fafc; }
    .highlight { font-weight: 700; color: #16a34a; }
    .small { font-size: 12px; color: #64748b; }
    .badge { padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; }
    .badge-promo { background: #dcfce7; color: #166534; }
    .badge-normal { background: #eff6ff; color: #1e40af; }
    .badge-est { background: #fef9c3; color: #854d0e; }
    .empty { padding: 32px; text-align: center; color: #94a3b8; font-size: 14px; }
    .btn { display: inline-block; margin: 0 32px 24px; padding: 12px 24px; background: #1d4ed8;
           color: #fff; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600; }
    .thresholds { display: flex; gap: 12px; padding: 0 32px 20px; flex-wrap: wrap; }
    .threshold { background: #fff; border-radius: 8px; padding: 12px 16px; font-size: 13px;
                 border: 1px solid #e2e8f0; }
    .threshold span { font-weight: 700; color: #dc2626; }
  </style>
  <meta http-equiv="refresh" content="300">
</head>
<body>
  <header>
    <h1>🌴 Orlando Tracker — POA → MCO, Jan/Fev 2027</h1>
    <p>4 pessoas · 4 parques Disney · 3 parques Universal · 12–18 dias · Última atualização: ${formatDate(lastCheck.rows[0]?.last_check)}</p>
  </header>

  <div class="stats">
    <div class="stat">
      <div class="label">Cotação USD</div>
      <div class="value">R$ ${rate.rows[0]?.usd_to_brl ? parseFloat(rate.rows[0].usd_to_brl).toFixed(2) : '—'}</div>
    </div>
    <div class="stat">
      <div class="label">Mín passagens (total)</div>
      <div class="value">${formatBRL(flights.rows[0]?.total_brl)}</div>
    </div>
    <div class="stat">
      <div class="label">Mín Disney (4 pax)</div>
      <div class="value">${formatBRL(parks.rows.find(p => p.park_brand === 'disney')?.total_brl)}</div>
    </div>
    <div class="stat">
      <div class="label">Mín Universal (4 pax)</div>
      <div class="value">${formatBRL(parks.rows.find(p => p.park_brand === 'universal')?.total_brl)}</div>
    </div>
  </div>

   <div class="thresholds">
     <div class="threshold">✈️ Flights alert: <span>${formatBRL(process.env.FLIGHT_ALERT_THRESHOLD)}</span></div>
     <div class="threshold">🏰 Disney alert: <span>${formatBRL(process.env.DISNEY_ALERT_THRESHOLD)}</span></div>
     <div class="threshold">🎬 Universal alert: <span>${formatBRL(process.env.UNIVERSAL_ALERT_THRESHOLD)}</span></div>
   </div>

   <a class="btn" href="/run-check">▶ Run check now</a>

   <div class="section">
     <h2>✈️ Flights (cheapest first)</h2>
     ${flights.rows.length > 0 ? `
     <table>
       <thead><tr><th>Departure</th><th>Return</th><th>Duration</th><th>Airline</th><th>Stops</th><th>Per pax</th><th>Total (4 pax)</th><th>Checked at</th></tr></thead>
       <tbody>${flightRows}</tbody>
     </table>` : '<div class="empty">No data yet — run a check</div>'}
   </div>

   <div class="section">
     <h2>🎡 Park tickets (cheapest first)</h2>
     ${parks.rows.length > 0 ? `
     <table>
       <thead><tr><th>Brand</th><th>Type</th><th>Promotion</th><th>Days</th><th>Per ticket</th><th>Total (4 pax)</th><th>Checked at</th></tr></thead>
       <tbody>${parkRows}</tbody>
     </table>` : '<div class="empty">No data yet — run a check</div>'}
   </div>

   <div class="section">
     <h2>🔔 Sent alerts history</h2>
     ${alerts.rows.length > 0 ? `
     <table>
       <thead><tr><th>Date</th><th>Type</th><th>Threshold</th><th>Price found</th></tr></thead>
       <tbody>${alertRows}</tbody>
     </table>` : '<div class="empty">No alerts sent yet</div>'}
  </div>
</body>
</html>`);
  } catch (err) {
    logger.error('Erro no dashboard:', err.message);
    res.status(500).send('Erro ao carregar dashboard. Verifique se o banco de dados está configurado.');
  }
});

// Endpoint to trigger a manual check
app.get('/run-check', async (req, res) => {
  logger.info('🔄 Verificação manual acionada via web');
  res.redirect('/?check=triggered');
  runCheck().catch(err => logger.error('Erro na verificação manual:', err.message));
});

// Health check (so Render does not shut down the service)
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ====================================================
//  MAIN CHECK FUNCTION
// ====================================================
async function runCheck() {
  logger.info('');
  logger.info('===========================================');
  logger.info(`  VERIFICAÇÃO INICIADA — ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
  logger.info('===========================================');

  const [flights, disney, universal] = await Promise.allSettled([
    checkFlightPrices(),
    checkDisneyPrices(),
    checkUniversalPrices(),
  ]);

  const flightResults = flights.status === 'fulfilled' ? flights.value : [];
  const disneyResults = disney.status === 'fulfilled' ? disney.value : [];
  const universalResults = universal.status === 'fulfilled' ? universal.value : [];

  if (flights.status === 'rejected') logger.error('Passagens falhou:', flights.reason?.message);
  if (disney.status === 'rejected') logger.error('Disney falhou:', disney.reason?.message);
  if (universal.status === 'rejected') logger.error('Universal falhou:', universal.reason?.message);

  await checkAndSendAlerts(flightResults, disneyResults, universalResults);

  logger.info('===========================================');
  logger.info('  VERIFICAÇÃO CONCLUÍDA');
  logger.info('===========================================');
  logger.info('');
}

// ====================================================
//  CRON JOBS
// ====================================================
const SCHEDULE_1 = process.env.CRON_SCHEDULE_1 || '0 10 * * *'; // 7 AM Brasilia time
const SCHEDULE_2 = process.env.CRON_SCHEDULE_2 || '0 22 * * *'; // 7 PM Brasilia time

cron.schedule(SCHEDULE_1, () => {
  logger.info('⏰ Cron job 1 acionado');
  runCheck().catch(err => logger.error('Erro no cron 1:', err.message));
}, { timezone: 'UTC' });

cron.schedule(SCHEDULE_2, () => {
  logger.info('⏰ Cron job 2 acionado');
  runCheck().catch(err => logger.error('Erro no cron 2:', err.message));
}, { timezone: 'UTC' });

// ====================================================
//  STARTUP
// ====================================================
const PORT = process.env.PORT || 3000;

async function start() {
  await ensureDatabaseSchema(db, { log: true });

  app.listen(PORT, () => {
    logger.info('');
    logger.info('🌴 Orlando Tracker iniciado!');
    logger.info(`   Dashboard: http://localhost:${PORT}`);
    logger.info(`   Cron 1: ${SCHEDULE_1} (UTC)`);
    logger.info(`   Cron 2: ${SCHEDULE_2} (UTC)`);
    logger.info(`   Alerta passagens: R$ ${process.env.FLIGHT_ALERT_THRESHOLD}`);
    logger.info(`   Alerta Disney: R$ ${process.env.DISNEY_ALERT_THRESHOLD}`);
    logger.info(`   Alerta Universal: R$ ${process.env.UNIVERSAL_ALERT_THRESHOLD}`);
    logger.info('');
  });

  // Run once on startup (useful for the first test)
  if (process.env.RUN_ON_START === 'true') {
    setTimeout(() => {
      logger.info('🚀 Executando verificação inicial...');
      runCheck().catch(err => logger.error('Erro na verificação inicial:', err.message));
    }, 5000);
  }
}

start().catch(err => {
  logger.error(`Fatal startup error: ${err.message}`);
  process.exit(1);
});
