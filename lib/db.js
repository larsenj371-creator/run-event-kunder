'use strict';

const { sql } = require('@vercel/postgres');

async function ensureSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS booking_events (
      id SERIAL PRIMARY KEY,
      event_id TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS booking_slots (
      id SERIAL PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES booking_events(event_id) ON DELETE CASCADE,
      slot_id TEXT NOT NULL,
      label TEXT NOT NULL,
      capacity INT NOT NULL,
      UNIQUE (event_id, slot_id)
    )
  `;

  // One row per confirmed signup. The unique index blocks the same email
  // double-booking the same slot; capacity is enforced separately in
  // api/bookings.js with a row lock so two concurrent requests can't both
  // slip in past a nearly-full slot.
  await sql`
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      event_id TEXT NOT NULL,
      slot_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      shopify_customer_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (event_id, slot_id, email)
    )
  `;

  // Added after the bookings table already existed in production
  // (bokamera-event-booking.liquid's allergies field), so it's a migration
  // rather than part of the CREATE TABLE above.
  await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS notes TEXT`;

  // booking_events.id is already a stable, sequential integer — exposed to
  // admins/customers as the "event number" alongside the text event_id,
  // rather than adding a second auto-increment column.
  //
  // max_guests: how many *additional* people (beyond the person filling in
  // the form) a single booking may bring along for this event. 0 = no
  // plus-ones. party_size on a booking counts everyone (booker + guests),
  // and is what capacity checks sum — a party of 4 uses 4 seats.
  await sql`ALTER TABLE booking_events ADD COLUMN IF NOT EXISTS max_guests INT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS party_size INT NOT NULL DEFAULT 1`;
  await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS additional_names TEXT`;
}

module.exports = { sql, ensureSchema };
