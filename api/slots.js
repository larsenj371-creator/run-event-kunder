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

    const { rows: eventRows } = await sql`
      SELECT id AS event_number, title, max_guests FROM booking_events WHERE event_id = ${eventId}
    `;
    if (!eventRows[0]) {
      res.status(404).json({ message: 'Eventet findes ikke.' });
      return;
    }

    const { rows: slots } = await sql`
      SELECT
        s.slot_id AS id,
        s.label,
        s.capacity - COALESCE(SUM(b.party_size), 0)::int AS remaining
      FROM booking_slots s
      LEFT JOIN bookings b ON b.event_id = s.event_id AND b.slot_id = s.slot_id
      WHERE s.event_id = ${eventId}
      GROUP BY s.slot_id, s.label, s.capacity, s.id
      HAVING s.capacity - COALESCE(SUM(b.party_size), 0)::int > 0
      ORDER BY s.id
    `;

    res.status(200).json({
      event_number: eventRows[0].event_number,
      title: eventRows[0].title,
      max_guests: eventRows[0].max_guests,
      slots,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Der opstod en fejl.' });
  }
};
