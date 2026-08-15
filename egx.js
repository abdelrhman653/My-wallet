// Vercel Serverless Function: /api/egx
// Required environment variable: OANOR_API_KEY
export default async function handler(req, res) {
  try {
    const key = process.env.OANOR_API_KEY;
    if (!key) return res.status(500).json({ success:false, error:"OANOR_API_KEY is not configured" });

    const type = req.query?.type || "quote";
    const codes = req.query?.codes || "";
    const name = req.query?.name || "EGX30";
    let path;

    if (type === "index") {
      path = "/v1/index?name=" + encodeURIComponent(name);
    } else if (type === "quote") {
      if (!codes) return res.status(400).json({ success:false, error:"Missing codes" });
      path = "/v1/quote?codes=" + encodeURIComponent(codes);
    } else {
      return res.status(400).json({ success:false, error:"Unknown type" });
    }

    const upstream = await fetch("https://api.oanor.com/egx-api" + path, {
      headers: { "x-oanor-key": key, "Accept": "application/json" },
      cache: "no-store"
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    return res.send(text);
  } catch (error) {
    return res.status(500).json({ success:false, error:"Proxy error" });
  }
}
