// Vercel Serverless Function: /api/funds
// Daily NAV tracker for the three selected mutual funds.
// Source: SNDUK public fund pages. The three funds are displayed with the user's codes:
// ABR = Bareeq, BMM = Beltone Meya Meya, BSB = Beltone Sabayek.

const SOURCES = {
  ABR: { url: 'https://snduk.com/eg/funds/categories/fixed-income-funds?lang=en', needle: 'Bareeq Fixed Income Fund' },
  BMM: { url: 'https://snduk.com/eg/funds/beltone-meya-100?lang=en', needle: 'Beltone Meya Meya (100/100) EGX100 Index Equity Fund' },
  BSB: { url: 'https://snduk.com/eg/funds/sabayek-fund-beltone-gold/history?lang=en', needle: 'Beltone Sabayek Gold Fund' }
};

function cleanNumber(v) {
  if (!v) return null;
  const s = String(v).replace(/,/g, '').replace(/٬/g, '').replace(/٫/g, '.').replace(/\s/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extract(html, code, needle) {
  const text = htmlToText(html);
  const codePos = text.toUpperCase().indexOf(String(needle || code).toUpperCase());
  const area = codePos >= 0 ? text.slice(Math.max(0, codePos - 700), Math.min(text.length, codePos + 700)) : text;

  // Prefer a value directly followed by EGP/ج.م. and a NAV/Latest Price label.
  const patterns = [
    /(?:Latest Price|Nav Price|Unit price|آخر سعر|سعر الوثيقة|Document Price)[^0-9]{0,80}([0-9]+(?:[.,][0-9]+)?)/i,
    /([0-9]+(?:[.,][0-9]+)?)\s*(?:EGP|ج\.م\.|جنيه)/i
  ];
  let price = null;
  for (const re of patterns) {
    const m = area.match(re);
    if (m) { price = cleanNumber(m[1]); if (price !== null) break; }
  }

  // Try the page-level title/last-updated text.
  let updated = null;
  const dateMatch = area.match(/(?:Last Updated|Updated|آخر تحديث)[^0-9]{0,40}(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  if (dateMatch) updated = dateMatch[1];

  return { price, updated };
}

export default async function handler(req, res) {
  try {
    const entries = await Promise.all(Object.entries(SOURCES).map(async ([code, cfg]) => {
      const r = await fetch(cfg.url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PortfolioTracker/1.0)' }, cache: 'no-store' });
      if (!r.ok) throw new Error(`${code} source HTTP ${r.status}`);
      const html = await r.text();
      return [code, { ...extract(html, code, cfg.needle), source: cfg.url }];
    }));

    const data = Object.fromEntries(entries);
    const missing = Object.entries(data).filter(([,v]) => !Number.isFinite(v.price)).map(([k]) => k);
    if (missing.length) {
      return res.status(502).json({ success: false, error: `Could not read NAV for: ${missing.join(', ')}`, data });
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json({ success: true, fetchedAt: new Date().toISOString(), data });
  } catch (error) {
    return res.status(500).json({ success: false, error: error?.message || 'Funds proxy error' });
  }
}
