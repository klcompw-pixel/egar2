exports.handler = async (event) => {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  const token = process.env.WEBHOOK_TOKEN;

  if (!webhook) {
    return { statusCode: 500, body: 'No webhook configured' };
  }

  // Cek Token Autentikasi (opsional)
  if (token) {
    const receivedToken = event.headers?.['x-webhook-token'] || event.headers?.['X-Webhook-Token'];
    if (receivedToken !== token) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Unauthorized' }),
        headers: { 'Content-Type': 'application/json' }
      };
    }
  }

  try {
    // Parse dan sanitasi minimal
    let body = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      return { statusCode: 400, body: 'Invalid JSON' };
    }

    // Basic sanitization untuk keamanan
    const allowedRegex = /[^A-Za-z0-9 %`\-\=\[\];',\.\/!@#$%^&*()_+{}|:><?"]/g;
    const sanitizeStr = (s) => (typeof s === 'string' ? s.replace(allowedRegex, '') : s);

    const contentSan = sanitizeStr(body.content) || '';
    
    if (Array.isArray(body.embeds)) {
      body.embeds.forEach(e => {
        if (e.title) e.title = sanitizeStr(e.title);
        if (e.description) e.description = sanitizeStr(e.description);
      });
    }

    const payload = { 
      content: contentSan, 
      embeds: body.embeds 
    };

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
    console.error("Error:", err);
    return { statusCode: 500, body: 'Internal server error' };
  }
};
