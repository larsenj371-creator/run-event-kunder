'use strict';

const { sql, ensureSchema } = require('../../lib/db');
const { verifyAdminSecret } = require('../../lib/verify-admin');

module.exports = async function handler(req, res) {
  if (!verifyAdminSecret(req)) {
    res.status(401).json({ message: 'Ugyldig adgangskode.' });
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
          SELECT b.id, b.event_id, e.title AS event_title, b.slot_id, s.label AS slot_label,
                 b.name, b.email, b.phone, b.notes, b.created_at
          FROM bookings b
          JOIN booking_events e ON e.event_id = b.event_id
          LEFT JOIN booking_slots s ON s.event_id = b.event_id AND s.slot_id = b.slot_id
          WHERE b.event_id = ${eventId}
          ORDER BY b.created_at DESC
        `
      : await sql`
          SELECT b.id, b.event_id, e.title AS event_title, b.slot_id, s.label AS slot_label,
                 b.name, b.email, b.phone, b.notes, b.created_at
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
