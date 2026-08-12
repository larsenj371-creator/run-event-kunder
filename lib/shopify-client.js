'use strict';

const fs = require('fs');
const path = require('path');

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!match) continue;
    const key = match[1];
    let value = (match[2] || '').trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

const STORE = process.env.SHOPIFY_STORE || process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

const API_URL = STORE ? `https://${STORE}/admin/api/2024-10/graphql.json` : null;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Retries on 429s and THROTTLED cost errors, expected under normal load
// since the GraphQL Admin API has a per-shop cost budget.
async function graphql(query, variables, attempt = 1) {
  if (!STORE || !TOKEN) {
    throw new Error('Missing SHOPIFY_STORE or SHOPIFY_ACCESS_TOKEN (env var or .env file)');
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (res.status === 429) {
    if (attempt > 5) throw new Error('Rate limited after 5 retries');
    const retryAfter = Number(res.headers.get('retry-after')) || 2;
    await sleep(retryAfter * 1000);
    return graphql(query, variables, attempt + 1);
  }

  const body = await res.json();
  const throttled = body.errors?.some(e => e.extensions?.code === 'THROTTLED');
  if (throttled) {
    if (attempt > 5) throw new Error('Throttled after 5 retries');
    await sleep(2000 * attempt);
    return graphql(query, variables, attempt + 1);
  }

  if (!res.ok || body.errors) {
    throw new Error(`GraphQL error (${res.status}): ${JSON.stringify(body.errors || body)}`);
  }

  const cost = body.extensions?.cost;
  if (cost && cost.throttleStatus.currentlyAvailable < cost.throttleStatus.maximumAvailable * 0.2) {
    await sleep(500);
  }

  return body.data;
}

module.exports = { graphql, STORE };
