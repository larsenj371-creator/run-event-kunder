'use strict';

const { sql, ensureSchema } = require('../lib/db');
const { verifyProxySignature } = require('../lib/verify-proxy');
const { upsertCustomerForBooking } = require('../lib/upsert-customer');

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  if (!verifyProxySignature(req.query)) {
    res.status(401).json({ message: 'Ugyldig signatur.' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    res.status(400).json({ message: 'Ugyldig anmodning.' });
    return;
  }

  const { name, email, phone, event_id: eventId, slot_id: slotId, privacy_consent: consent } = body;

  if (!name || !email || !phone || !eventId || !slotId) {
    res.status(400).json({ message: 'Udfyld venligst alle felter.' });
    return;
  }
  if (!consent) {
    res.status(400).json({ message: 'Du skal acceptere opbevaring af dine oplysninger.' });
    return;
  }

  try {
    await ensureSchema();

    const { rows: slotRows } = await sql`
      SELECT s.capacity, s.label, e.title
      FROM booking_slots s
      JOIN booking_events e ON e.event_id = s.event_id
      WHERE s.event_id = ${eventId} AND s.slot_id = ${slotId}
    `;
    const slot = slotRows[0];
    if (!slot) {
      res.status(404).json({ message: 'Det valgte tidspunkt findes ikke.' });
      return;
    }

    // Count-then-insert: a small race window exists under simultaneous
    // requests for the last spot in a slot, accepted here given the
    // human-scale traffic this endpoint sees (form submissions, not a
    // flash sale). The UNIQUE(event_id, slot_id, email) constraint still
    // guarantees no one is double-booked.
    const { rows: countRows } = await sql`
      SELECT COUNT(*)::int AS count FROM bookings WHERE event_id = ${eventId} AND slot_id = ${slotId}
    `;
    if (countRows[0].count >= slot.capacity) {
      res.status(409).json({ message: 'Der er desværre ikke flere ledige pladser på det valgte tidspunkt.' });
      return;
    }

    let customerId;
    try {
      customerId = await upsertCustomerForBooking({
        name,
        email,
        phone,
        eventId,
        eventTitle: slot.title,
        slotLabel: slot.label,
      });
    } catch (err) {
      console.error('Shopify customer upsert failed:', err);
      res.status(502).json({ message: 'Din booking kunne ikke gennemføres. Prøv venligst igen.' });
      return;
    }

    try {
      await sql`
        INSERT INTO bookings (event_id, slot_id, name, email, phone, shopify_customer_id)
        VALUES (${eventId}, ${slotId}, ${name}, ${email}, ${phone}, ${customerId})
      `;
    } catch (err) {
      if (String(err.message).includes('bookings_event_id_slot_id_email_key')) {
        res.status(409).json({ message: 'Du er allerede tilmeldt dette tidspunkt.' });
        return;
      }
      throw err;
    }

    res.status(200).json({ message: 'ok', customer_id: customerId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Der opstod en fejl. Prøv venligst igen.' });
  }
};
