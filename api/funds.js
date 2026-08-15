// Vercel Serverless Function: /api/funds
// Real mutual-fund NAV/last announced unit prices.
// Source: SNDUK's mutual-fund price table. These are NOT EGX stock quotes.
// ABR = Bareeq Fixed Income, BMM = Beltone Meya Meya, BSB = Beltone Sabayek.

const SOURCE_URL = 'https://snduk.com/eg/page/mutual-funds-prices-today?lang=en';

const FUNDS = {
  ABR: 'Bareeq Fixed Income Fund',
  BMM: 'Beltone Meya Meya (100/100) EGX100 Index Equity Fund',
  BSB: 'Beltone Sabayek Gold Fund'
};

function decodeHtml(s) {
  return String(s)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&#160;/gi, ' ');
}

function htmlToText(html) {
  return decodeHtml(String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanNumber(v) {
  if (v == null) return null;
  const s = String(v)
    .replace(/,/g, '')
    .replace(/٬/g, '')
    .replace(/٫/g, '.')
    .replace(/[\u200E\u200F\u202A-\u202E]/g, '')
    .replace(/\s/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  const m = s.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    return `${y}-${String(Number(m[2])).padStart(2,'0')}-${String(Number(m[1])).padStart(2,'0')}`;
  }
  const m2 = s.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/);
  if (m2) {
    const months = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
    const mon = months[m2[1].slice(0,3).toLowerCase()];
    if (mon) return `${m2[3]}-${String(mon).padStart(2,'0')}-${String(Number(m2[2])).padStart(2,'0')}`;
  }
  return s;
}

function extractFund(text, code, name) {
  const pos = text.toLowerCase().indexOf(name.toLowerCase());
  if (pos < 0) return { price:null, updated:null, code };
  const area = text.slice(pos, pos + 650);

  // SNDUK table format: fund name -> type -> date -> EGP price.
  const datePatterns = [
    /([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i,
    /(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})/
  ];
  let updated = null;
  for (const re of datePatterns) {
    const m = area.match(re);
    if (m) { updated = normalizeDate(m[1]); break; }
  }

  let price = null;
  const pricePatterns = [
    /EGP\s*([0-9]+(?:[.,][0-9]+)?)/i,
    /([0-9]+(?:[.,][0-9]+)?)\s*EGP/i
  ];
  for (const re of pricePatterns) {
    const m = area.match(re);
    if (m) { price = cleanNumber(m[1]); if (price !== null) break; }
  }

  return { price, updated, code };
}

export default async function handler(req, res) {
  try {
    const upstream = await fetch(SOURCE_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PortfolioTracker/1.0)' },
      cache: 'no-store'
    });
    if (!upstream.ok) throw new Error(`SNDUK HTTP ${upstream.status}`);

    const html = await upstream.text();
    const text = htmlToText(html);
    const data = {};

    for (const [code, name] of Object.entries(FUNDS)) {
      data[code] = { ...extractFund(text, code, name), source: SOURCE_URL };
    }

    const missing = Object.entries(data)
      .filter(([,v]) => !Number.isFinite(v.price) || !v.updated)
      .map(([k]) => k);

    if (missing.length) {
      return res.status(502).json({
        success: false,
        error: `Could not read fund NAV/date for: ${missing.join(', ')}`,
        data
      });
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json({
      success: true,
      fetchedAt: new Date().toISOString(),
      source: SOURCE_URL,
      data
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Funds proxy error'
    });
  }
}
