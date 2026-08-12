'use strict';

const crypto = require('crypto');

// Shopify App Proxy signs the forwarded query string (shop, path_prefix,
// timestamp, logged_in_customer_id, ...) with the app's API secret. This is
// a different algorithm than webhook HMAC verification: params are sorted,
// joined as key=value with NO separator, then HMAC-SHA256 hex (not base64).
// https://shopify.dev/docs/apps/build/online-store/display-dynamic-data#verify-the-request
function verifyProxySignature(query) {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) throw new Error('Missing SHOPIFY_API_SECRET');

  const { signature, ...rest } = query;
  if (!signature) return false;

  const message = Object.keys(rest)
    .sort()
    .map(key => `${key}=${Array.isArray(rest[key]) ? rest[key].join(',') : rest[key]}`)
    .join('');

  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex');

  const a = Buffer.from(digest);
  const b = Buffer.from(String(signature));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { verifyProxySignature };
