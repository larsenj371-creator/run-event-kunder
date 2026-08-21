'use strict';

const { sql, ensureSchema } = require('../../lib/db');
const { verifyAdminSecret } = require('../../lib/verify-admin');

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
  if (!verifyAdminSecret(req)) {
    res.status(401).json({ message: 'Ugyldig adgangskode.' });
    return;
  }

  if (req.method === 'DELETE') {
    try {
      await ensureSchema();
      const { id } = await readJsonBody(req);
      if (!id) {
        res.status(400).json({ message: 'Mangler id.' });
        return;
      }
      // Only removes the internal booking record (freeing the slot's
      // capacity again) — it deliberately doesn't touch the Shopify
      // customer's tags/metafield history, same as deleting an event
      // doesn't either. The booking itself just stops counting toward
      // capacity and disappears from this list.
      await sql`DELETE FROM bookings WHERE id = ${id}`;
      res.status(200).json({ message: 'ok' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Der opstod en fejl.' });
    }
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  try {
    await ensureSchema();
    const eventId = req.query.event_id;

    const { rows } = eventId
      ? await sql`
          SELECT b.id, b.event_id, e.id AS event_number, e.title AS event_title, b.slot_id, s.label AS slot_label,
                 b.name, b.email, b.phone, b.notes, b.party_size, b.additional_names, b.created_at
          FROM bookings b
          JOIN booking_events e ON e.event_id = b.event_id
          LEFT JOIN booking_slots s ON s.event_id = b.event_id AND s.slot_id = b.slot_id
          WHERE b.event_id = ${eventId}
          ORDER BY b.created_at DESC
        `
      : await sql`
          SELECT b.id, b.event_id, e.id AS event_number, e.title AS event_title, b.slot_id, s.label AS slot_label,
                 b.name, b.email, b.phone, b.notes, b.party_size, b.additional_names, b.created_at
          FROM bookings b
          JOIN booking_events e ON e.event_id = b.event_id
          LEFT JOIN booking_slots s ON s.event_id = b.event_id AND s.slot_id = b.slot_id
          ORDER BY b.created_at DESC
        `;

    res.status(200).json({ bookings: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Der opstod en fejl.' });
  }
};
