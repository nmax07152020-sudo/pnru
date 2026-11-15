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
      message: "Admin API is not configured. Check GAS_WEB_APP_URL and GAS_API_SECRET in Vercel Production."
    });
  }

  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const action = String(body.action || "");
    if (!["login", "changePassword", "logout", "savePatientAssistance", "getPatientRecords", "updatePatientRecord", "saveHospitalTally", "saveHomevisit", "saveHomeVisit"].includes(action)) {
      return res.status(400).json({ success: false, message: "Unsupported admin action." });
    }

    const payload = { ...body, apiSecret };
    const upstream = await fetch(gasUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload),
      redirect: "follow",
      cache: "no-store"
    });

    const text = await upstream.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      const snippet = text.replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ").trim().slice(0, 240);
      let message;
      if (upstream.status === 401 || /unauthorized|sign in|authentication/i.test(snippet)) {
        message = "Google Apps Script returned HTTP 401. Check the Web App deployment: Execute as Me, Who has access Anyone, then deploy a New version. Also confirm GAS_WEB_APP_URL is the current /exec URL (not /dev).";
      } else if (/accounts\\.google\\.com|ServiceLogin/i.test(text)) {
        message = "Google redirected the admin API to a sign-in page. The Web App must be deployed with Who has access: Anyone and Execute as: Me.";
      } else {
        message = "Apps Script returned non-JSON (HTTP " + upstream.status + "). Response preview: " + (snippet || "empty response") + ". Check doPost(e) in the deployed version.";
      }
      return res.status(502).json({ success: false, message });
    }

    return res.status(upstream.ok ? 200 : 502).json(result);
  } catch (error) {
    return res.status(502).json({
      success: false,
      message: "Could not reach Apps Script. Verify the /exec URL and Vercel environment variables."
    });
  }
};
