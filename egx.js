const OANOR_BASE = 'https://api.oanor.com/egx-api';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeOne(raw, fallbackTicker) {
  if (!raw || typeof raw !== 'object') return null;
  const ticker = String(
    raw.ticker ?? raw.symbol ?? raw.code ?? raw.stock ?? raw.security ?? fallbackTicker ?? ''
  ).toUpperCase();
  const price = num(
    raw.price ?? raw.last ?? raw.last_price ?? raw.current_price ?? raw.close ??
    raw.regularMarketPrice ?? raw.marketPrice ?? raw.value
  );
  let change = num(
    raw.change_percent ?? raw.changePercent ?? raw.percent_change ?? raw.pct_change ??
    raw.changePct ?? raw.regularMarketChangePercent ?? raw.change_percentage
  );
  if (change === null) {
    const absolute = num(raw.change ?? raw.price_change ?? raw.change_value);
    const prev = num(raw.previous_close ?? raw.previousClose ?? raw.prev_close);
    if (absolute !== null && prev) change = absolute / prev * 100;
  }
  if (price === null) return null;
  return { ticker: ticker || fallbackTicker, price, change: change ?? 0, raw };
}

function collectQuotes(raw, requested) {
  const wanted = new Set(requested.map(x => x.toUpperCase()));
  const out = [];
  const seen = new Set();

  const add = (item, fallback) => {
    const q = normalizeOne(item, fallback);
    if (!q) return;
    const key = q.ticker.toUpperCase();
    if (wanted.size && !wanted.has(key) && fallback && wanted.has(fallback.toUpperCase())) {
      q.ticker = fallback.toUpperCase();
    }
    if (!wanted.size || wanted.has(q.ticker.toUpperCase())) {
      if (!seen.has(q.ticker.toUpperCase())) { seen.add(q.ticker.toUpperCase()); out.push(q); }
    }
  };

  if (Array.isArray(raw)) raw.forEach(x => add(x));
  if (Array.isArray(raw?.data)) raw.data.forEach(x => add(x));
  if (Array.isArray(raw?.quotes)) raw.quotes.forEach(x => add(x));
  if (Array.isArray(raw?.results)) raw.results.forEach(x => add(x));
  if (Array.isArray(raw?.result)) raw.result.forEach(x => add(x));

  for (const key of ['data','quotes','result','results']) {
    const obj = raw?.[key];
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      for (const [k, v] of Object.entries(obj)) add(v, k);
    }
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (['data','quotes','result','results','meta','status','source'].includes(k)) continue;
      if (v && typeof v === 'object') add(v, k);
    }
    add(raw);
  }

  return out;
}

async function upstream(path, key) {
  const res = await fetch(`${OANOR_BASE}${path}`, {
    method: 'GET',
    headers: { 'x-oanor-key': key, 'Accept': 'application/json' },
    cache: 'no-store',
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 1000) }; }
  return { res, body };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.OANOR_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'OANOR_API_KEY is not configured in Vercel.' });
  }

  const rawSymbols = String(req.query?.symbols || req.query?.symbol || '').trim();
  const requested = rawSymbols.split(',').map(x => x.trim().toUpperCase()).filter(Boolean);
  if (!requested.length) {
    return res.status(400).json({ error: 'Missing symbols query parameter.' });
  }

  // First try a single batch request. Oanor documents GET /v1/quote as supporting one or more EGX stocks.
  const attempts = [
    `/v1/quote?symbol=${encodeURIComponent(requested.join(','))}`,
    `/v1/quote?symbols=${encodeURIComponent(requested.join(','))}`,
  ];

  let lastStatus = 502;
  let lastBody = null;
  for (const path of attempts) {
    try {
      const { res: upstreamRes, body } = await upstream(path, key);
      lastStatus = upstreamRes.status;
      lastBody = body;
      if (!upstreamRes.ok) continue;
      const quotes = collectQuotes(body, requested);
      if (quotes.length) {
        res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
        return res.status(200).json({ ok: true, source: 'Oanor EGX API', quotes });
      }
    } catch (e) {
      lastBody = { error: e.message };
    }
  }

  // Fallback: one ticker per request. This is slower but keeps the integration tolerant of API query-shape changes.
  const quotes = [];
  const errors = [];
  for (const ticker of requested) {
    try {
      const { res: upstreamRes, body } = await upstream(`/v1/quote?symbol=${encodeURIComponent(ticker)}`, key);
      if (!upstreamRes.ok) { errors.push({ ticker, status: upstreamRes.status }); continue; }
      const found = collectQuotes(body, [ticker]);
      if (found[0]) quotes.push(found[0]);
      else errors.push({ ticker, status: 200, error: 'Unrecognized response shape' });
    } catch (e) {
      errors.push({ ticker, error: e.message });
    }
  }

  if (quotes.length) {
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
    return res.status(200).json({ ok: true, source: 'Oanor EGX API', quotes, errors });
  }

  const safe = typeof lastBody === 'object' ? {
    error: lastBody?.error || lastBody?.message || `Oanor returned HTTP ${lastStatus}`,
    details: lastBody?.details,
  } : { error: `Oanor returned HTTP ${lastStatus}` };
  return res.status(lastStatus >= 400 && lastStatus < 600 ? lastStatus : 502).json(safe);
};
