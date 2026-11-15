// Vercel Serverless Function: secure proxy for the Apps Script admin API.
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, message: "Method not allowed." });
  }

  const gasUrl = process.env.GAS_WEB_APP_URL;
  const apiSecret = process.env.GAS_API_SECRET;
  if (!gasUrl || !apiSecret) {
    return res.status(503).json({
      success: false,
      message: "Admin API is not configured. Set GAS_WEB_APP_URL and GAS_API_SECRET in Vercel."
    });
  }

  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const action = String(body.action || "");
    const allowed = ["login", "changePassword", "logout"];
    if (!allowed.includes(action)) {
      return res.status(400).json({ success: false, message: "Unsupported admin action." });
    }

    const payload = { ...body, apiSecret };
    const upstream = await fetch(gasUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "follow"
    });

    const text = await upstream.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      return res.status(502).json({
        success: false,
        message: "Apps Script returned a non-JSON response. Check the Web App deployment."
      });
    }
    return res.status(upstream.ok ? 200 : 502).json(result);
  } catch (error) {
    return res.status(502).json({
      success: false,
      message: "Could not reach the Apps Script admin service."
    });
  }
}
