'use strict';

// Upserts an event and its bookable slots from a JSON file into Postgres.
// Usage: node scripts/sync-event.js events/run-event-2026.json
//
// File format:
// {
//   "event_id": "run-event-2026",
//   "title": "Løbeevent september 2026",
//   "slots": [
//     { "slot_id": "2026-09-12-1700", "label": "12. sep kl. 17:00", "capacity": 25 },
//     { "slot_id": "2026-09-12-1830", "label": "12. sep kl. 18:30", "capacity": 25 }
//   ]
// }

const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { sql, ensureSchema } = require('../lib/db');

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/sync-event.js <event.json>');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  if (!data.event_id || !data.title || !Array.isArray(data.slots)) {
    console.error('File must have event_id, title, and a slots array.');
    process.exit(1);
  }

  await ensureSchema();

  await sql`
    INSERT INTO booking_events (event_id, title)
    VALUES (${data.event_id}, ${data.title})
    ON CONFLICT (event_id) DO UPDATE SET title = EXCLUDED.title
  `;

  for (const slot of data.slots) {
    await sql`
      INSERT INTO booking_slots (event_id, slot_id, label, capacity)
      VALUES (${data.event_id}, ${slot.slot_id}, ${slot.label}, ${slot.capacity})
      ON CONFLICT (event_id, slot_id) DO UPDATE SET label = EXCLUDED.label, capacity = EXCLUDED.capacity
    `;
  }

  console.log(`Synced "${data.event_id}" with ${data.slots.length} slot(s).`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
