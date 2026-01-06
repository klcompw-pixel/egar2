exports.handler = async (event) => {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  const token = process.env.WEBHOOK_TOKEN;
  
  if (!webhook) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'No webhook configured' }),
      headers: { 'Content-Type': 'application/json' }
    };
  }
  
  if (token && event.headers['x-webhook-token'] !== token) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized' }),
      headers: { 'Content-Type': 'application/json' }
    };
  }

  const getHeader = (name) => {
    if (!event || !event.headers) return undefined;
    const key = Object.keys(event.headers).find(
      k => k && k.toLowerCase() === name.toLowerCase()
    );
    return key && event.headers[key] 
      ? event.headers[key] 
      : event.headers[name] || event.headers[name.toLowerCase()];
  };

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    body = {};
  }

  try {
    const ua = (getHeader('user-agent') || '') + '';
    const contentType = (getHeader('content-type') || '') + '';
    const cacheStatus = (getHeader('x-cache') || getHeader('x-nf-cache-status') || '') + '';
    const primitives = (getHeader('primitives') || '') + '';
    const dateHdr = (getHeader('date') || '') + '';

    const uaLower = ua.toLowerCase();
    const looksLikeCurlOrBrowser = 
      uaLower.includes('curl') || 
      uaLower.includes('mozilla') || 
      uaLower.includes('chrome') || 
      uaLower.includes('safari') || 
      uaLower.includes('edge');
    
    if (looksLikeCurlOrBrowser && contentType.toLowerCase().includes('text/html')) {
      const cacheOk = cacheStatus.toLowerCase() === 'miss';
      const primitivesOk = primitives === '-';
      let localYear = null;
      const yearMatch = dateHdr.match(/(\d{4})/);
      if (yearMatch && yearMatch[1]) {
        localYear = parseInt(yearMatch[1], 10);
      }
      const yearOk = (typeof localYear === 'number' && localYear > 2026) || false;

      if (!(cacheOk && primitivesOk && yearOk)) {
        console.warn('Incoming webhook verification failed', { ua, contentType, cacheStatus, primitives, dateHdr });
        return {
          statusCode: 403,
          body: JSON.stringify({ error: 'Forbidden: verification failed' }),
          headers: { 'Content-Type': 'application/json' }
        };
      }
    }
  } catch (e) {
    console.warn('Verification error', String(e));
    return {
      statusCode: 403,
      body: JSON.stringify({ error: 'Forbidden: verification error' }),
      headers: { 'Content-Type': 'application/json' }
    };
  }

  const allowedRegex = /[^A-Za-z0-9 %`\-\=\[\];',\.\/!@#$%^&*()_+{}|:><?"]/g;
  const sanitizeStr = (s) => (typeof s === 'string' ? s.replace(allowedRegex, '') : s);

  const contentSan = sanitizeStr(body.content) || '';
  if (Array.isArray(body.embeds)) {
    for (const e of body.embeds) {
      if (e && typeof e === 'object') {
        if (e.title) e.title = sanitizeStr(e.title);
        if (e.description) e.description = sanitizeStr(e.description);
        if (Array.isArray(e.fields)) {
          for (const f of e.fields) {
            if (f && f.value) f.value = sanitizeStr(f.value);
            if (f && f.name) f.name = sanitizeStr(f.name);
          }
        }
      }
    }
  }

  try {
    const payload = { content: contentSan, embeds: body.embeds };
    const resp = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const text = await resp.text();
    const statusCode = resp.ok ? 200 : resp.status;
    
    let responseBody = text;
    
    if (typeof responseBody === 'string') {
      const encoder = new TextEncoder();
      let byteLength = encoder.encode(responseBody).length;
      
      if (byteLength > 400) {
        const truncated = new TextDecoder('utf-8').decode(
          encoder.encode(responseBody).slice(0, 400)
        );
        responseBody = truncated.replace(/\uFFFD/g, '') + '...(truncated)';
      } else if (byteLength < 50) {
        const padding = ' '.repeat(50 - byteLength);
        responseBody += padding;
      }
    } else {
      responseBody = String(responseBody);
      const encoder = new TextEncoder();
      let byteLength = encoder.encode(responseBody).length;
      
      if (byteLength > 400) {
        responseBody = responseBody.substring(0, 100) + '...(truncated)';
      } else if (byteLength < 50) {
        responseBody = responseBody.padEnd(50 - byteLength + responseBody.length, ' ');
      }
    }
    
    return {
      statusCode,
      body: responseBody,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': String(new TextEncoder().encode(responseBody).length)
      }
    };
    
  } catch (err) {
    const errorMessage = String(err);
    let responseBody = errorMessage;
    
    const encoder = new TextEncoder();
    let byteLength = encoder.encode(responseBody).length;
    
    if (byteLength > 400) {
      responseBody = responseBody.substring(0, 100) + '...(truncated)';
    } else if (byteLength < 50) {
      responseBody = responseBody.padEnd(50 - byteLength + responseBody.length, ' ');
    }
    
    return {
      statusCode: 500,
      body: responseBody,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': String(new TextEncoder().encode(responseBody).length)
      }
    };
  }
};
