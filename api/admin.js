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
    let upstream = await fetch(gasUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "manual"
    });

    // Apps Script ContentService commonly responds with a 302 redirect to
    // a one-time script.googleusercontent.com URL containing the JSON body.
    if ([301, 302, 303, 307, 308].includes(upstream.status)) {
      const location = upstream.headers.get("location");
      if (!location) {
        return res.status(502).json({
          success: false,
          message: "Apps Script redirected the admin request without a response URL. Check the Web App deployment."
        });
      }
      upstream = await fetch(new URL(location, gasUrl).toString(), {
        method: "GET",
        redirect: "follow"
      });
    }

    const text = await upstream.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      const looksLikeHtml = /<\\s*!doctype|<\\s*html|accounts\\.google\\.com|ServiceLogin/i.test(text);
      return res.status(502).json({
        success: false,
        message: looksLikeHtml
          ? "Apps Script returned an HTML page instead of JSON. Confirm the Web App is deployed as Execute as: Me and Who has access: Anyone, then deploy a New version."
          : "Apps Script returned a non-JSON response (HTTP " + upstream.status + "). Check the latest Web App deployment and doPost()."
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
