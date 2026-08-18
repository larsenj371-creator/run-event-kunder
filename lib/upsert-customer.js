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

// Shopify's customer phone field requires E.164 (+<country code><number>),
// but the booking forms just ask for a plain Danish number like "12 34 56 78".
// Without this, every booking with a bare 8-digit number fails with
// "Phone is invalid" and the whole booking is lost.
function normalizePhone(rawPhone) {
  if (!rawPhone) return undefined;
  const digits = String(rawPhone).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (/^\d{8}$/.test(digits)) return `+45${digits}`;
  return digits;
}

function isInvalidPhoneError(userErrors) {
  return userErrors.some(e => e.field?.includes('phone') || /phone/i.test(e.message));
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
  eventNumber,
  eventTitle,
  slotLabel,
  notes,
  additionalNames,
}) {
  const { firstName, lastName } = explicitFirstName
    ? { firstName: explicitFirstName, lastName: explicitLastName || '' }
    : splitName(name);
  const eventTag = `event:${eventId}`;
  const eventNumberTag = eventNumber != null ? `event-nr:${eventNumber}` : null;
  const normalizedPhone = normalizePhone(phone);

  const found = await graphql(FIND_CUSTOMER, { query: `email:${JSON.stringify(email)}` });
  const existing = found.customers.edges[0]?.node;

  const partySize = 1 + (additionalNames?.length || 0);
  const bookingEntry = {
    event_id: eventId,
    event_number: eventNumber,
    event_title: eventTitle,
    slot: slotLabel,
    party_size: partySize,
    booked_at: new Date().toISOString(),
    ...(notes ? { notes } : {}),
    ...(additionalNames && additionalNames.length ? { additional_guests: additionalNames } : {}),
  };

  let customerId;

  if (existing) {
    customerId = existing.id;
    const tags = Array.from(new Set([...existing.tags, 'event-booking', eventTag, ...(eventNumberTag ? [eventNumberTag] : [])]));
    let result = await graphql(UPDATE_CUSTOMER, {
      input: { id: customerId, tags, phone: normalizedPhone },
    });
    if (result.customerUpdate.userErrors.length && normalizedPhone && isInvalidPhoneError(result.customerUpdate.userErrors)) {
      // Don't lose the whole booking over an unparseable phone number —
      // keep the customer/tags/booking and just skip the phone update.
      result = await graphql(UPDATE_CUSTOMER, { input: { id: customerId, tags, phone: undefined } });
    }
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

    await setBookingMetafields(customerId, bookings, bookingEntry);
  } else {
    const createTags = ['event-booking', eventTag, ...(eventNumberTag ? [eventNumberTag] : [])];
    let result = await graphql(CREATE_CUSTOMER, {
      input: {
        firstName,
        lastName,
        email,
        phone: normalizedPhone,
        tags: createTags,
      },
    });
    if (result.customerCreate.userErrors.length && normalizedPhone && isInvalidPhoneError(result.customerCreate.userErrors)) {
      result = await graphql(CREATE_CUSTOMER, {
        input: { firstName, lastName, email, phone: undefined, tags: createTags },
      });
    }
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
          eventNumber,
          eventTitle,
          slotLabel,
          notes,
          additionalNames,
        });
      }
      throw new Error(result.customerCreate.userErrors.map(e => e.message).join('; '));
    }
    customerId = result.customerCreate.customer.id;
    await setBookingMetafields(customerId, [bookingEntry], bookingEntry);
  }

  return customerId;
}

// `bookings` is the full JSON history (kept for our own admin overview);
// `latest` is the booking that was just made. Alongside the JSON field this
// also writes flat single-value fields (last_event_title, last_slot_label,
// last_party_size, last_notes) purely so a Shopify Flow workflow can use
// them directly in an email template — Flow's Liquid editor has no JSON
// parsing, so the JSON array alone isn't usable there. All fields are
// written in one mutation call, so whichever one a Flow trigger watches
// ("customer metafield updated"), the rest are already in place by the
// time the workflow runs.
async function setBookingMetafields(customerId, bookings, latest) {
  // Shopify rejects metafieldsSet with "Value can't be blank." for an empty
  // string on a single_line_text_field — last_notes must be left out of the
  // call entirely (not sent as '') whenever there are no notes, rather than
  // written as a blank value.
  const metafields = [
    {
      ownerId: customerId,
      namespace: 'event_booking',
      key: 'bookings',
      type: 'json',
      value: JSON.stringify(bookings),
    },
    {
      ownerId: customerId,
      namespace: 'event_booking',
      key: 'last_slot_label',
      type: 'single_line_text_field',
      value: latest.slot,
    },
    {
      ownerId: customerId,
      namespace: 'event_booking',
      key: 'last_party_size',
      type: 'number_integer',
      value: String(latest.party_size),
    },
    {
      ownerId: customerId,
      namespace: 'event_booking',
      key: 'last_event_title',
      type: 'single_line_text_field',
      value: latest.event_title,
    },
  ];
  if (latest.notes) {
    metafields.push({
      ownerId: customerId,
      namespace: 'event_booking',
      key: 'last_notes',
      type: 'single_line_text_field',
      value: latest.notes,
    });
  }

  const result = await graphql(SET_METAFIELDS, { metafields });
  if (result.metafieldsSet.userErrors.length) {
    throw new Error(result.metafieldsSet.userErrors.map(e => e.message).join('; '));
  }
}

module.exports = { upsertCustomerForBooking };
