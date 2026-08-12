'use strict';

const { sql, ensureSchema } = require('../lib/db');
const { verifyProxySignature } = require('../lib/verify-proxy');

module.exports = async function handler(req, res) {
  if (!verifyProxySignature(req.query)) {
    res.status(401).json({ message: 'Ugyldig signatur.' });
    return;
  }

  const eventId = req.query.event_id;
  if (!eventId) {
    res.status(400).json({ message: 'Mangler event_id.' });
    return;
  }

  try {
    await ensureSchema();

    const { rows } = await sql`
      SELECT
        s.slot_id AS id,
        s.label,
        s.capacity - COUNT(b.id)::int AS remaining
      FROM booking_slots s
      LEFT JOIN bookings b ON b.event_id = s.event_id AND b.slot_id = s.slot_id
      WHERE s.event_id = ${eventId}
      GROUP BY s.slot_id, s.label, s.capacity, s.id
      HAVING s.capacity - COUNT(b.id)::int > 0
      ORDER BY s.id
    `;

    res.status(200).json({ slots: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Der opstod en fejl.' });
  }
};
