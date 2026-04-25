// src/alerts/email.js
// Sends price alerts through Gmail (nodemailer)
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
  const rows = flights.map(f => `
    <tr style="border-bottom:1px solid #eee">
      <td style="padding:10px">${f.departure_date}</td>
      <td style="padding:10px">${f.return_date}</td>
      <td style="padding:10px">${f.trip_days} dias</td>
      <td style="padding:10px">${f.airline}</td>
      <td style="padding:10px">${formatBRL(f.price_brl)}/pax</td>
      <td style="padding:10px;font-weight:bold;color:#16a34a">${formatBRL(f.total_brl)} total</td>
    </tr>
  `).join('');

  return `
    <div style="font-family:sans-serif;max-width:700px;margin:0 auto">
      <div style="background:#1e3a5f;padding:24px;border-radius:8px 8px 0 0">
        <h1 style="color:#fff;margin:0;font-size:22px">✈️ Alerta de Passagem!</h1>
        <p style="color:#93c5fd;margin:8px 0 0">POA → MCO | ${flights.length} opção(ões) abaixo de ${formatBRL(threshold)}</p>
      </div>
      <div style="background:#f8fafc;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead>
            <tr style="background:#e2e8f0">
              <th style="padding:10px;text-align:left">Ida</th>
              <th style="padding:10px;text-align:left">Volta</th>
              <th style="padding:10px;text-align:left">Duração</th>
              <th style="padding:10px;text-align:left">Cia</th>
              <th style="padding:10px;text-align:left">Por pessoa</th>
              <th style="padding:10px;text-align:left">Total (4 pax)</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="margin-top:20px;font-size:13px;color:#64748b">
          🔗 <a href="https://www.mundi.com.br/voos/POA-MCO">Verificar disponibilidade no Mundi</a> |
          <a href="https://www.kayak.com.br/flights/POA-MCO">Kayak</a>
        </p>
      </div>
    </div>
  `;
}

function buildParkEmailHtml(parks, brand, threshold) {
  const emoji = brand === 'disney' ? '🏰' : '🎬';
  const brandName = brand === 'disney' ? 'Disney' : 'Universal';
  
  const rows = parks.map(p => `
    <tr style="border-bottom:1px solid #eee">
      <td style="padding:10px">${p.park_names?.join(', ') || brandName}</td>
      <td style="padding:10px">
        <span style="background:${p.ticket_type === 'promoção' ? '#dcfce7' : '#fef9c3'};
          padding:3px 8px;border-radius:12px;font-size:12px;color:#166534">
          ${p.ticket_type === 'promoção' ? '🎉 ' : ''}${p.ticket_type}
        </span>
      </td>
      <td style="padding:10px">${p.promotion_name || '—'}</td>
      <td style="padding:10px">${p.days} dias</td>
      <td style="padding:10px">${formatBRL(p.price_brl)}/ingresso</td>
      <td style="padding:10px;font-weight:bold;color:#16a34a">${formatBRL(p.total_brl)} total</td>
    </tr>
  `).join('');

  return `
    <div style="font-family:sans-serif;max-width:700px;margin:0 auto">
      <div style="background:${brand === 'disney' ? '#1d4ed8' : '#7c3aed'};padding:24px;border-radius:8px 8px 0 0">
        <h1 style="color:#fff;margin:0;font-size:22px">${emoji} Alerta de Ingresso ${brandName}!</h1>
        <p style="color:#c7d2fe;margin:8px 0 0">${parks.length} opção(ões) abaixo de ${formatBRL(threshold)} — 4 ingressos</p>
      </div>
      <div style="background:#f8fafc;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead>
            <tr style="background:#e2e8f0">
              <th style="padding:10px;text-align:left">Parques</th>
              <th style="padding:10px;text-align:left">Tipo</th>
              <th style="padding:10px;text-align:left">Promoção</th>
              <th style="padding:10px;text-align:left">Dias</th>
              <th style="padding:10px;text-align:left">Por ingresso</th>
              <th style="padding:10px;text-align:left">Total (4 pax)</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="margin-top:20px;font-size:13px;color:#64748b">
          🔗 <a href="https://orlandoparabrasileiros.com/ingressos-parques-orlando/">Orlando Para Brasileiros</a> |
          ${brand === 'disney'
            ? '<a href="https://disneyworld.disney.go.com/pt-br/admission/tickets/">Site Oficial Disney</a>'
            : '<a href="https://www.universalorlando.com/web/en/us/tickets">Site Oficial Universal</a>'}
        </p>
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
       subject: `✈️ ALERT: Flights POA→MCO below ${formatBRL(flightThreshold)}! (${cheapFlights.length} option)`,
       html: buildFlightEmailHtml(cheapFlights, flightThreshold),
       threshold: flightThreshold,
       actual: Math.min(...cheapFlights.map(f => f.total_brl)),
     });
   }

   // Check Disney
   const cheapDisney = disneyResults.filter(d => d.total_brl < disneyThreshold);
   if (cheapDisney.length > 0) {
     alertsToSend.push({
       type: 'disney',
       subject: `🏰 ALERT: Disney tickets below ${formatBRL(disneyThreshold)}! (4 pax, 4 parks)`,
       html: buildParkEmailHtml(cheapDisney, 'disney', disneyThreshold),
       threshold: disneyThreshold,
       actual: Math.min(...cheapDisney.map(d => d.total_brl)),
     });
   }

   // Check Universal
   const cheapUniversal = universalResults.filter(u => u.total_brl < universalThreshold);
   if (cheapUniversal.length > 0) {
     alertsToSend.push({
       type: 'universal',
       subject: `🎬 ALERT: Universal tickets below ${formatBRL(universalThreshold)}! (4 pax, 3 parks)`,
       html: buildParkEmailHtml(cheapUniversal, 'universal', universalThreshold),
       threshold: universalThreshold,
       actual: Math.min(...cheapUniversal.map(u => u.total_brl)),
     });
   }

   // Send emails
   for (const alert of alertsToSend) {
     try {
       await transporter.sendMail({
         from: `"Orlando Tracker 🌴" <${process.env.GMAIL_USER}>`,
         to: process.env.ALERT_EMAIL_TO,
         subject: alert.subject,
         html: alert.html,
       });

       // Log in database
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
     logger.info('📧 No alerts triggered — prices above configured thresholds');
   }

   return alertsToSend.length;
}

module.exports = { checkAndSendAlerts };
