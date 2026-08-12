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

  try {
    await ensureSchema();

    if (req.method === 'GET') {
      const { rows: events } = await sql`SELECT event_id, title, created_at FROM booking_events ORDER BY created_at DESC`;
      const { rows: slots } = await sql`
        SELECT s.event_id, s.slot_id, s.label, s.capacity, COUNT(b.id)::int AS booked
        FROM booking_slots s
        LEFT JOIN bookings b ON b.event_id = s.event_id AND b.slot_id = s.slot_id
        GROUP BY s.id, s.event_id, s.slot_id, s.label, s.capacity
        ORDER BY s.id
      `;
      const byEvent = new Map(events.map(e => [e.event_id, { ...e, slots: [] }]));
      slots.forEach(s => byEvent.get(s.event_id)?.slots.push(s));
      res.status(200).json({ events: Array.from(byEvent.values()) });
      return;
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const { event_id: eventId, title, slots } = body;
      if (!eventId || !title || !Array.isArray(slots) || !slots.length) {
        res.status(400).json({ message: 'Udfyld event-ID, titel og mindst ét tidspunkt.' });
        return;
      }
      for (const slot of slots) {
        if (!slot.slot_id || !slot.label || !Number.isFinite(Number(slot.capacity)) || Number(slot.capacity) < 1) {
          res.status(400).json({ message: 'Hvert tidspunkt skal have et ID, en label og en kapacitet på mindst 1.' });
          return;
        }
      }

      await sql`
        INSERT INTO booking_events (event_id, title)
        VALUES (${eventId}, ${title})
        ON CONFLICT (event_id) DO UPDATE SET title = EXCLUDED.title
      `;

      const keepIds = slots.map(s => s.slot_id);
      await sql`
        DELETE FROM booking_slots
        WHERE event_id = ${eventId} AND slot_id <> ALL(${keepIds})
      `;

      for (const slot of slots) {
        await sql`
          INSERT INTO booking_slots (event_id, slot_id, label, capacity)
          VALUES (${eventId}, ${slot.slot_id}, ${slot.label}, ${Number(slot.capacity)})
          ON CONFLICT (event_id, slot_id) DO UPDATE SET label = EXCLUDED.label, capacity = EXCLUDED.capacity
        `;
      }

      res.status(200).json({ message: 'ok' });
      return;
    }

    if (req.method === 'DELETE') {
      const body = await readJsonBody(req);
      const { event_id: eventId } = body;
      if (!eventId) {
        res.status(400).json({ message: 'Mangler event_id.' });
        return;
      }
      await sql`DELETE FROM booking_events WHERE event_id = ${eventId}`;
      res.status(200).json({ message: 'ok' });
      return;
    }

    res.status(405).json({ message: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Der opstod en fejl.' });
  }
};
