exports.handler = async (event) => {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  const token = process.env.WEBHOOK_TOKEN;

  // Fungsi pembantu untuk mengirim laporan debug ke Discord
  const sendDebugToDiscord = async (reason, details) => {
    try {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: "⚠️ Webhook Rejected / Debug Log",
            color: 16711680, // Warna Merah
            description: `**Alasan:** ${reason}`,
            fields: [
              { name: "Detail", value: `\`\`\`json\n${JSON.stringify(details, null, 2).substring(0, 1000)}\n\`\`\`` },
              { name: "Timestamp", value: new Date().toISOString() }
            ]
          }]
        })
      });
    } catch (e) {
      console.error("Gagal mengirim debug ke Discord", e);
    }
  };

  if (!webhook) {
    return { statusCode: 500, body: 'No webhook configured' };
  }

  // 1. Cek Token Autentikasi
  if (token && event.headers['x-webhook-token'] !== token) {
    await sendDebugToDiscord("Invalid Webhook Token", { 
      receivedToken: event.headers['x-webhook-token'],
      ip: event.requestContext?.identity?.sourceIp 
    });
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized' }),
      headers: { 'Content-Type': 'application/json' }
    };
  }

  const getHeader = (name) => {
    if (!event || !event.headers) return undefined;
    const key = Object.keys(event.headers).find(k => k && k.toLowerCase() === name.toLowerCase());
    return key && event.headers[key] ? event.headers[key] : event.headers[name] || event.headers[name.toLowerCase()];
  };

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    await sendDebugToDiscord("JSON Parse Error", { bodyRaw: event.body });
    body = {};
  }

  // 2. Verifikasi Header (Anti-Bot/Browser logic)
  try {
    const ua = (getHeader('user-agent') || '') + '';
    const contentType = (getHeader('content-type') || '') + '';
    const cacheStatus = (getHeader('x-cache') || getHeader('x-nf-cache-status') || '') + '';
    const primitives = (getHeader('primitives') || '') + '';
    const dateHdr = (getHeader('date') || '') + '';

    const uaLower = ua.toLowerCase();
    const looksLikeCurlOrBrowser = uaLower.includes('curl') || uaLower.includes('mozilla');

    if (looksLikeCurlOrBrowser && contentType.toLowerCase().includes('text/html')) {
      const cacheOk = cacheStatus.toLowerCase() === 'miss';
      const primitivesOk = primitives === '-';
      
      let localYear = null;
      const yearMatch = dateHdr.match(/(\d{4})/);
      if (yearMatch) localYear = parseInt(yearMatch[1], 10);
      
      const yearOk = (typeof localYear === 'number' && localYear > 2026);

      if (!(cacheOk && primitivesOk && yearOk)) {
        const debugInfo = { ua, cacheStatus, primitives, dateHdr, detectedYear: localYear };
        await sendDebugToDiscord("Header Verification Failed", debugInfo);
        
        return {
          statusCode: 403,
          body: JSON.stringify({ error: 'Forbidden: verification failed' }),
          headers: { 'Content-Type': 'application/json' }
        };
      }
    }
  } catch (e) {
    await sendDebugToDiscord("Internal Verification Error", { error: String(e) });
    return { statusCode: 403, body: 'Forbidden: verification error' };
  }

  // --- Bagian Sanitasi & Pengiriman Utama Tetap Sama ---
  const allowedRegex = /[^A-Za-z0-9 %`\-\=\[\];',\.\/!@#$%^&*()_+{}|:><?"]/g;
  const sanitizeStr = (s) => (typeof s === 'string' ? s.replace(allowedRegex, '') : s);

  const contentSan = sanitizeStr(body.content) || '';
  if (Array.isArray(body.embeds)) {
    body.embeds.forEach(e => {
      if (e.title) e.title = sanitizeStr(e.title);
      if (e.description) e.description = sanitizeStr(e.description);
    });
  }

  try {
    const payload = { content: contentSan, embeds: body.embeds };
    const resp = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const text = await resp.text();
    return {
      statusCode: resp.ok ? 200 : resp.status,
      body: text || "Success",
      headers: { 'Content-Type': 'text/plain' }
    };

  } catch (err) {
    await sendDebugToDiscord("Fetch Error (Discord Down?)", { error: String(err) });
    return { statusCode: 500, body: String(err) };
  }
};
