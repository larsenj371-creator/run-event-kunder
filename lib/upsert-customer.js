'use strict';

const { graphql } = require('./shopify-client');

const FIND_CUSTOMER = `
  query FindCustomerByEmail($query: String!) {
    customers(first: 1, query: $query) {
      edges {
        node {
          id
          tags
          metafield(namespace: "event_booking", key: "bookings") { value }
        }
      }
    }
  }
`;

const CREATE_CUSTOMER = `
  mutation CreateCustomer($input: CustomerInput!) {
    customerCreate(input: $input) {
      customer { id }
      userErrors { field message }
    }
  }
`;

const UPDATE_CUSTOMER = `
  mutation UpdateCustomer($input: CustomerInput!) {
    customerUpdate(input: $input) {
      customer { id }
      userErrors { field message }
    }
  }
`;

const SET_METAFIELDS = `
  mutation SetMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message }
    }
  }
`;

function splitName(fullName) {
  const trimmed = String(fullName).trim().replace(/\s+/g, ' ');
  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex === -1) return { firstName: trimmed, lastName: '' };
  return { firstName: trimmed.slice(0, spaceIndex), lastName: trimmed.slice(spaceIndex + 1) };
}

// Finds the customer by email if one exists, otherwise creates one, then
// records the event/slot on it. Bundled into a single JSON metafield
// (event_booking.bookings) rather than one metafield per event — intersport-dk
// is already close to Shopify's metafield-count ceiling, so per-event
// metafields would compound that problem.
//
// Accepts either a single `name` (split on the first space — used by
// event-booking-run.liquid) or explicit `firstName`/`lastName` (used by
// bokamera-event-booking.liquid, which has separate fields already).
async function upsertCustomerForBooking({
  name,
  firstName: explicitFirstName,
  lastName: explicitLastName,
  email,
  phone,
  eventId,
  eventTitle,
  slotLabel,
  notes,
}) {
  const { firstName, lastName } = explicitFirstName
    ? { firstName: explicitFirstName, lastName: explicitLastName || '' }
    : splitName(name);
  const eventTag = `event:${eventId}`;

  const found = await graphql(FIND_CUSTOMER, { query: `email:${JSON.stringify(email)}` });
  const existing = found.customers.edges[0]?.node;

  const bookingEntry = {
    event_id: eventId,
    event_title: eventTitle,
    slot: slotLabel,
    booked_at: new Date().toISOString(),
    ...(notes ? { notes } : {}),
  };

  let customerId;

  if (existing) {
    customerId = existing.id;
    const tags = Array.from(new Set([...existing.tags, 'event-booking', eventTag]));
    const result = await graphql(UPDATE_CUSTOMER, {
      input: { id: customerId, tags, phone: phone || undefined },
    });
    if (result.customerUpdate.userErrors.length) {
      throw new Error(result.customerUpdate.userErrors.map(e => e.message).join('; '));
    }

    let bookings = [];
    try {
      bookings = JSON.parse(existing.metafield?.value || '[]');
    } catch {
      bookings = [];
    }
    bookings.push(bookingEntry);

    await setBookingsMetafield(customerId, bookings);
  } else {
    const result = await graphql(CREATE_CUSTOMER, {
      input: {
        firstName,
        lastName,
        email,
        phone: phone || undefined,
        tags: ['event-booking', eventTag],
      },
    });
    if (result.customerCreate.userErrors.length) {
      const taken = result.customerCreate.userErrors.some(e => e.message.toLowerCase().includes('taken'));
      if (taken) {
        // Race: customer was created between our lookup and our create call.
        return upsertCustomerForBooking({
          name,
          firstName: explicitFirstName,
          lastName: explicitLastName,
          email,
          phone,
          eventId,
          eventTitle,
          slotLabel,
          notes,
        });
      }
      throw new Error(result.customerCreate.userErrors.map(e => e.message).join('; '));
    }
    customerId = result.customerCreate.customer.id;
    await setBookingsMetafield(customerId, [bookingEntry]);
  }

  return customerId;
}

async function setBookingsMetafield(customerId, bookings) {
  const result = await graphql(SET_METAFIELDS, {
    metafields: [
      {
        ownerId: customerId,
        namespace: 'event_booking',
        key: 'bookings',
        type: 'json',
        value: JSON.stringify(bookings),
      },
    ],
  });
  if (result.metafieldsSet.userErrors.length) {
    throw new Error(result.metafieldsSet.userErrors.map(e => e.message).join('; '));
  }
}

module.exports = { upsertCustomerForBooking };
