import { neon } from '@neondatabase/serverless';

function send(res, code, payload) {
  res.status(code).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const fields = ['price','gst','cogs','pack','ref','closing','ship','other','ret','retloss','tacos','orders'];
function number(value, key) {
  if (value === null || value === undefined || String(value).trim() === '') throw Error('Complete every SKU field, including the Amazon fees.');
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100000000) throw Error('Invalid value for ' + key + '.');
  if (['gst','ref','ret','tacos'].includes(key) && n > 100) throw Error(key + ' must be 0–100%.');
  if (key === 'orders' && (!Number.isSafeInteger(n) || n > 10000000)) throw Error('Orders must be a whole number.');
  return n;
}
function estimate(raw) {
  const sku = String(raw?.sku || '').trim();
  if (!sku || sku.length > 120) throw Error('Enter a SKU name of up to 120 characters.');
  const n = Object.fromEntries(fields.map(k => [k, number(raw[k], k)]));
  if (n.price <= 0) throw Error('Price must be greater than zero.');
  const keep = 1 - n.ret / 100, revenue = n.price / (1 + n.gst / 100);
  const contribution = keep * (revenue - n.cogs - n.pack - n.ref / 100 * n.price - n.closing - n.ship - n.other)
    - n.ret / 100 * n.retloss - n.tacos / 100 * n.price;
  return { input: { sku, ...n }, result: {
    contributionPerPlacedOrder: Number(contribution.toFixed(2)),
    monthlyContribution: Number((contribution * n.orders).toFixed(2)),
    breakEvenAdPercent: Number(Math.max(0, (contribution + n.tacos / 100 * n.price) / n.price * 100).toFixed(2))
  }};
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Method not allowed.' });
  }
  if (!process.env.DATABASE_URL) return send(res, 503, { error: 'Secure saving has not been connected yet.' });
  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) return send(res, 403, { error: 'Invalid origin.' }); }
    catch { return send(res, 403, { error: 'Invalid origin.' }); }
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    if (JSON.stringify(body).length > 300000) return send(res, 413, { error: 'Submission is too large.' });
    if (body.website) return send(res, 200, { saved: true });
    if (body.consent !== true) return send(res, 400, { error: 'Consent to save the calculation is required.' });
    const sellerName = String(body.sellerName || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    if (sellerName.length < 2 || sellerName.length > 100) return send(res, 400, { error: 'Enter a valid seller name.' });
    if (!emailPattern.test(email) || email.length > 254) return send(res, 400, { error: 'Enter a valid email.' });
    if (!['single','bulk'].includes(body.mode)) return send(res, 400, { error: 'Invalid calculator mode.' });
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 1000 ||
        (body.mode === 'single' && body.items.length !== 1)) return send(res, 400, { error: 'Enter 1–1,000 SKUs.' });
    const fixedCost = number(body.fixedCost, 'fixedCost');
    const calculated = body.items.map(estimate);
    const monthlyContribution = calculated.reduce((sum, x) => sum + x.result.monthlyContribution, 0);
    const summary = { count: calculated.length, monthlyContribution: Number(monthlyContribution.toFixed(2)),
      afterFixedCosts: Number((monthlyContribution - fixedCost).toFixed(2)), fixedCost };
    const sql = neon(process.env.DATABASE_URL);
    await sql`CREATE TABLE IF NOT EXISTS amazon_calculator_submissions (
      id BIGSERIAL PRIMARY KEY,
      seller_name VARCHAR(100) NOT NULL,
      email VARCHAR(254) NOT NULL,
      mode VARCHAR(10) NOT NULL,
      items JSONB NOT NULL,
      summary JSONB NOT NULL,
      consent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      marketing_consent BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS amazon_calculator_submissions_email_created_idx ON amazon_calculator_submissions(email, created_at)`;
    const recent = await sql`SELECT 1 FROM amazon_calculator_submissions WHERE email = ${email}
      AND created_at > NOW() - INTERVAL '30 seconds' LIMIT 1`;
    if (recent.length) return send(res, 429, { error: 'Please wait 30 seconds before saving again.' });
    const items = JSON.stringify(calculated);
    await sql`INSERT INTO amazon_calculator_submissions
      (seller_name, email, mode, items, summary, marketing_consent)
      VALUES (${sellerName}, ${email}, ${body.mode}, ${items}::jsonb, ${JSON.stringify(summary)}::jsonb, ${body.marketingConsent === true})`;
    return send(res, 201, { saved: true, summary });
  } catch (error) {
    if (error instanceof SyntaxError || (error.message && /Invalid|Complete|Enter|Price|Orders|must be/.test(error.message)))
      return send(res, 400, { error: error.message });
    console.error('Calculator saving failed', error);
    return send(res, 500, { error: 'The calculation could not be saved. Please try again.' });
  }
}
