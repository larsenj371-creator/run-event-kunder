'use strict';

const crypto = require('crypto');

// Separate from the app-proxy secret: this gates the admin UI/API, which is
// hit directly (not forwarded through Shopify), so it needs its own check.
function verifyAdminSecret(req) {
  const expected = process.env.ADMIN_SECRET;
  const provided = req.headers['x-admin-secret'];
  if (!expected || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { verifyAdminSecret };
