// src/alerts/email.js
// Sends price alert emails via Gmail using nodemailer
require('dotenv').config();
const nodemailer = require('nodemailer');
const db = require('../db/client');
const logger = require('../utils/logger');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

function formatBRL(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

function buildFlightEmailHtml(flights, threshold) {
  const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const rows = flights.map(f => {
    let googleUrl = f.source_url || '';
    try {
      const raw = JSON.parse(f.raw_data || '{}');
      if (raw.google_flights_url) googleUrl = raw.google_flights_url;
    } catch {}
    if (!googleUrl) {
      googleUrl = `https://www.google.com/travel/flights?hl=pt-BR&curr=BRL#flt=POA.MCO.${f.departure_date}*MCO.POA.${f.return_date};c:BRL;e:1;sd:1;t:f`;
    }
    return `
    <tr style="border-bottom:1px solid #eee">
      <td style="padding:10px"><strong>${f.departure_date}</strong></td>
      <td style="padding:10px"><strong>${f.return_date}</strong></td>
      <td style="padding:10px">${f.trip_days} dias</td>
      <td style="padding:10px">${f.airline}</td>
      <td style="padding:10px">${f.stops === '0' ? '✅ Direto' : (f.stops || '1') + ' escala(s)'}</td>
      <td style="padding:10px">${formatBRL(f.price_brl)}/pessoa</td>
      <td style="padding:10px;font-weight:bold;color:#16a34a">${formatBRL(f.total_brl)}</td>
      <td style="padding:10px">
        <a href="${googleUrl}" style="color:#1d4ed8;font-size:12px;font-weight:600">
          Ver no Google Flights →
        </a>
      </td>
    </tr>
  `}).join('');

  return `
    <div style="font-family:sans-serif;max-width:760px;margin:0 auto">
      <div style="background:#1e3a5f;padding:24px;border-radius:8px 8px 0 0">
        <h1 style="color:#fff;margin:0;font-size:22px">✈️ Alerta de Passagem!</h1>
        <p style="color:#93c5fd;margin:8px 0 0">POA → MCO | ${flights.length} opção(ões) abaixo de ${formatBRL(threshold)} | 4 pessoas ida+volta</p>
        <p style="color:#bfdbfe;margin:4px 0 0;font-size:12px">Verificado em: ${now}</p>
      </div>
      <div style="background:#f8fafc;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#e2e8f0">
              <th style="padding:10px;text-align:left">Ida</th>
              <th style="padding:10px;text-align:left">Volta</th>
              <th style="padding:10px;text-align:left">Duração</th>
              <th style="padding:10px;text-align:left">Companhia</th>
              <th style="padding:10px;text-align:left">Escalas</th>
              <th style="padding:10px;text-align:left">Por pessoa</th>
              <th style="padding:10px;text-align:left">Total (4 pessoas)</th>
              <th style="padding:10px;text-align:left">Link</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:20px;padding:16px;background:#eff6ff;border-radius:8px;font-size:13px">
          <strong>🔗 Buscar manualmente:</strong><br>
          <a href="https://www.mundi.com.br/voos/POA-MCO" style="color:#1d4ed8">Mundi</a> ·
          <a href="https://www.kayak.com.br/flights/POA-MCO" style="color:#1d4ed8">Kayak</a> ·
          <a href="https://www.decolar.com/passagens-aereas/poa/orl" style="color:#1d4ed8">Decolar</a> ·
          <a href="https://passagens.voeazul.com.br" style="color:#1d4ed8">Azul</a> ·
          <a href="https://www.latamairlines.com/br/pt" style="color:#1d4ed8">LATAM</a>
        </div>
      </div>
    </div>
  `;
}

function buildParkEmailHtml(parks, brand, threshold) {
  const emoji = brand === 'disney' ? '🏰' : '🎬';
  const brandName = brand === 'disney' ? 'Disney' : 'Universal';
  const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const officialLink = brand === 'disney'
    ? 'https://disneyworld.disney.go.com/pt-br/admission/tickets/'
    : 'https://www.universalorlando.com/web/en/us/tickets';

  const rows = parks.map(p => {
    const visitDate = p.valid_dates && p.valid_dates.match(/^\d{4}-\d{2}-\d{2}$/)
      ? new Date(p.valid_dates + 'T12:00:00Z').toLocaleDateString('pt-BR')
      : (p.valid_dates || '—');
    return `
    <tr style="border-bottom:1px solid #eee">
      <td style="padding:10px;font-weight:600">${visitDate}</td>
      <td style="padding:10px">${p.park_names?.join(', ') || brandName}</td>
      <td style="padding:10px">
        <span style="background:${p.ticket_type === 'promoção' || p.ticket_type === 'confirmado' ? '#dcfce7' : p.ticket_type === 'estimado' ? '#fef9c3' : '#eff6ff'};
          padding:3px 8px;border-radius:12px;font-size:11px;font-weight:600">
          ${p.ticket_type === 'promoção' || p.ticket_type === 'confirmado' ? '✅ ' : ''}${p.ticket_type}
        </span>
      </td>
      <td style="padding:10px;font-size:12px">${p.promotion_name || '—'}</td>
      <td style="padding:10px">${p.days} dias</td>
      <td style="padding:10px">${formatBRL(p.price_brl)}/pessoa</td>
      <td style="padding:10px;font-weight:bold;color:#16a34a">${formatBRL(p.total_brl)}</td>
      <td style="padding:10px"><a href="${p.source_url || officialLink}" style="color:#1d4ed8;font-size:12px;font-weight:600">Comprar →</a></td>
    </tr>
  `}).join('');

  return `
    <div style="font-family:sans-serif;max-width:800px;margin:0 auto">
      <div style="background:${brand === 'disney' ? '#1d4ed8' : '#7c3aed'};padding:24px;border-radius:8px 8px 0 0">
        <h1 style="color:#fff;margin:0;font-size:22px">${emoji} Alerta de Ingresso ${brandName}!</h1>
        <p style="color:#c7d2fe;margin:8px 0 0">${parks.length} opção(ões) abaixo de ${formatBRL(threshold)} — 4 ingressos</p>
        <p style="color:#ddd6fe;margin:4px 0 0;font-size:12px">Verificado em: ${now}</p>
      </div>
      <div style="background:#f8fafc;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#e2e8f0">
              <th style="padding:10px;text-align:left">Data visita</th>
              <th style="padding:10px;text-align:left">Parques</th>
              <th style="padding:10px;text-align:left">Tipo</th>
              <th style="padding:10px;text-align:left">Produto</th>
              <th style="padding:10px;text-align:left">Dias</th>
              <th style="padding:10px;text-align:left">Por pessoa</th>
              <th style="padding:10px;text-align:left">Total (4 pessoas)</th>
              <th style="padding:10px;text-align:left">Comprar</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:20px;padding:16px;background:#f5f3ff;border-radius:8px;font-size:13px">
          <strong>🔗 Comprar com melhor preço em BRL (sem IOF):</strong><br>
          <a href="https://orlandoparabrasileiros.com/ingressos-parques-orlando/" style="color:#7c3aed">Orlando Para Brasileiros</a> ·
          <a href="https://www.decolar.com/atracoes-turisticas/d-DY_ORL" style="color:#7c3aed">Decolar</a> ·
          <a href="${officialLink}" style="color:#7c3aed">Site Oficial ${brandName}</a>
        </div>
      </div>
    </div>
  `;
}

async function checkAndSendAlerts(flightResults, disneyResults, universalResults) {
  const flightThreshold = parseFloat(process.env.FLIGHT_ALERT_THRESHOLD) || 14000;
  const disneyThreshold = parseFloat(process.env.DISNEY_ALERT_THRESHOLD) || 9000;
  const universalThreshold = parseFloat(process.env.UNIVERSAL_ALERT_THRESHOLD) || 7000;

  const alertsToSend = [];

  // Check flights
  const cheapFlights = flightResults.filter(f => f.total_brl < flightThreshold);
  if (cheapFlights.length > 0) {
    alertsToSend.push({
      type: 'flight',
      subject: `✈️ ALERTA: Passagens POA→MCO abaixo de ${formatBRL(flightThreshold)}! (${cheapFlights.length} opção)`,
      html: buildFlightEmailHtml(cheapFlights, flightThreshold),
      threshold: flightThreshold,
      actual: Math.min(...cheapFlights.map(f => f.total_brl)),
    });
  }

  // Check Disney tickets
  const cheapDisney = disneyResults.filter(d => d.total_brl < disneyThreshold);
  if (cheapDisney.length > 0) {
    alertsToSend.push({
      type: 'disney',
      subject: `🏰 ALERTA: Ingressos Disney abaixo de ${formatBRL(disneyThreshold)}! (4 pessoas, 4 parques)`,
      html: buildParkEmailHtml(cheapDisney, 'disney', disneyThreshold),
      threshold: disneyThreshold,
      actual: Math.min(...cheapDisney.map(d => d.total_brl)),
    });
  }

  // Check Universal tickets
  const cheapUniversal = universalResults.filter(u => u.total_brl < universalThreshold);
  if (cheapUniversal.length > 0) {
    alertsToSend.push({
      type: 'universal',
      subject: `🎬 ALERTA: Ingressos Universal abaixo de ${formatBRL(universalThreshold)}! (4 pessoas, 3 parques)`,
      html: buildParkEmailHtml(cheapUniversal, 'universal', universalThreshold),
      threshold: universalThreshold,
      actual: Math.min(...cheapUniversal.map(u => u.total_brl)),
    });
  }

  // Send all pending alerts
  for (const alert of alertsToSend) {
    try {
      await transporter.sendMail({
        from: `"Orlando Tracker 🌴" <${process.env.GMAIL_USER}>`,
        to: process.env.ALERT_EMAIL_TO,
        subject: alert.subject,
        html: alert.html,
      });

      // Log the alert in the database
      await db.query(
        'INSERT INTO price_alerts (alert_type, threshold_brl, actual_brl) VALUES ($1,$2,$3)',
        [alert.type, alert.threshold, alert.actual]
      );

      logger.info(`📧 Alert email sent: ${alert.type}`);
    } catch (err) {
      logger.error(`Failed to send alert email (${alert.type}): ${err.message}`);
    }
  }

  if (alertsToSend.length === 0) {
    logger.info('📧 No alerts triggered — all prices above configured thresholds');
  }

  return alertsToSend.length;
}

module.exports = { checkAndSendAlerts };
