exports.handler = async (event) => {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  const token = process.env.WEBHOOK_TOKEN;

  // Fungsi pembantu untuk mengirim laporan debug ke Discord
  const sendDebugToDiscord = async (title, reason, details, color = 16711680) => {
    try {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: title,
            color: color,
            description: `**Alasan:** ${reason}`,
            fields: [
              { name: "Detail", value: `\`\`\`json\n${JSON.stringify(details, null, 2).substring(0, 1000)}\n\`\`\`` },
              { name: "Timestamp", value: new Date().toISOString() },
              { name: "Request ID", value: event.requestContext?.requestId || "N/A" }
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

  // Kumpulkan data request untuk logging
  const requestData = {
    method: event.httpMethod,
    path: event.path,
    sourceIp: event.requestContext?.identity?.sourceIp || "N/A",
    userAgent: event.headers?.['user-agent'] || event.headers?.['User-Agent'] || "N/A",
    headers: Object.keys(event.headers || {}).reduce((acc, key) => {
      if (!key.toLowerCase().includes('authorization') && !key.toLowerCase().includes('token')) {
        acc[key] = event.headers[key];
      }
      return acc;
    }, {}),
    queryParams: event.queryStringParameters || {},
    bodyPreview: event.body ? event.body.substring(0, 500) : "Empty",
    timestamp: new Date().toISOString()
  };

  // 1. LOG SEMUA PERMINTAAN MASUK (DEBUG)
  await sendDebugToDiscord(
    "📡 Request Incoming", 
    "Permintaan diterima", 
    requestData, 
    3447003 // Biru Discord
  );

  // 2. Cek Token Autentikasi
  const receivedToken = event.headers?.['x-webhook-token'] || event.headers?.['X-Webhook-Token'];
  
  if (token && receivedToken !== token) {
    const authData = {
      ...requestData,
      authStatus: "FAILED",
      expectedToken: token ? "***[HIDDEN]***" : "Not Required",
      receivedToken: receivedToken ? "***[REDACTED]***" : "Not Provided",
      authCheck: "Token mismatch or missing"
    };
    
    await sendDebugToDiscord(
      "🔐 Authentication Failed", 
      "Invalid Webhook Token", 
      authData
    );
    
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized' }),
      headers: { 'Content-Type': 'application/json' }
    };
  }

  // LOG JIKA TOKEN VALID
  if (token && receivedToken === token) {
    await sendDebugToDiscord(
      "✅ Authentication Success", 
      "Valid Webhook Token", 
      {
        ...requestData,
        authStatus: "SUCCESS",
        tokenCheck: "Valid token provided"
      }, 
      3066993 // Hijau
    );
  }

  const getHeader = (name) => {
    if (!event || !event.headers) return undefined;
    const key = Object.keys(event.headers).find(k => k && k.toLowerCase() === name.toLowerCase());
    return key && event.headers[key] ? event.headers[key] : event.headers[name] || event.headers[name.toLowerCase()];
  };

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
    
    // LOG BODY YANG DITERIMA
    await sendDebugToDiscord(
      "📦 Request Body Parsed", 
      "JSON body berhasil di-parse", 
      {
        bodyType: typeof body,
        keys: Object.keys(body),
        contentPreview: body.content ? body.content.substring(0, 200) : "No content",
        hasEmbeds: Array.isArray(body.embeds),
        embedCount: Array.isArray(body.embeds) ? body.embeds.length : 0
      }, 
      10181046 // Ungu
    );
    
  } catch (e) {
    const parseErrorData = {
      ...requestData,
      parseError: e.message,
      rawBodyPreview: event.body ? event.body.substring(0, 300) : "Empty"
    };
    
    await sendDebugToDiscord(
      "❌ JSON Parse Error", 
      "Gagal parse JSON body", 
      parseErrorData
    );
    body = {};
  }

  // 3. Verifikasi Header (Anti-Bot/Browser logic)
  try {
    const ua = (getHeader('user-agent') || '') + '';
    const contentType = (getHeader('content-type') || '') + '';
    const cacheStatus = (getHeader('x-cache') || getHeader('x-nf-cache-status') || '') + '';
    const primitives = (getHeader('primitives') || '') + '';
    const dateHdr = (getHeader('date') || '') + '';

    const uaLower = ua.toLowerCase();
    const looksLikeCurlOrBrowser = uaLower.includes('curl') || uaLower.includes('mozilla');

    // LOG HEADER ANALYSIS
    await sendDebugToDiscord(
      "🔍 Header Analysis", 
      "Analisis header request", 
      {
        userAgent: ua,
        contentType: contentType,
        looksLikeCurlOrBrowser: looksLikeCurlOrBrowser,
        cacheStatus: cacheStatus,
        primitives: primitives,
        dateHeader: dateHdr,
        checkRequired: looksLikeCurlOrBrowser && contentType.toLowerCase().includes('text/html')
      }, 
      15844367 // Emas
    );

    if (looksLikeCurlOrBrowser && contentType.toLowerCase().includes('text/html')) {
      const cacheOk = cacheStatus.toLowerCase() === 'miss';
      const primitivesOk = primitives === '-' || primitives === 'f';
      
      let localYear = null;
      const yearMatch = dateHdr.match(/(\d{4})/);
      if (yearMatch) localYear = parseInt(yearMatch[1], 10);
      
      const yearOk = (typeof localYear === 'number' && localYear > 2026);

      // LOG VERIFIKASI DETAIL
      const verificationDetails = { 
        cacheOk, 
        primitivesOk, 
        dateHeader: dateHdr,
        detectedYear: localYear,
        yearOk,
        allConditionsMet: cacheOk && primitivesOk && yearOk
      };
      
      await sendDebugToDiscord(
        "🔐 Header Verification", 
        "Pengecekan header keamanan", 
        verificationDetails, 
        15105570 // Oranye
      );

      if (!(cacheOk && primitivesOk && yearOk)) {
        const debugInfo = { 
          ...requestData,
          verification: verificationDetails
        };
        
        await sendDebugToDiscord(
          "🚫 Header Verification Failed", 
          "Request diblokir: header tidak valid", 
          debugInfo
        );
        
        return {
          statusCode: 403,
          body: JSON.stringify({ error: 'Forbidden: verification failed' }),
          headers: { 'Content-Type': 'application/json' }
        };
      }
      
      // LOG JIKA VERIFIKASI BERHASIL
      await sendDebugToDiscord(
        "✅ Header Verification Passed", 
        "Request melewati verifikasi header", 
        verificationDetails, 
        3066993 // Hijau
      );
    }
  } catch (e) {
    const verificationError = {
      ...requestData,
      error: e.message,
      stack: e.stack
    };
    
    await sendDebugToDiscord(
      "⚠️ Internal Verification Error", 
      "Error pada proses verifikasi", 
      verificationError
    );
    return { statusCode: 403, body: 'Forbidden: verification error' };
  }

  // 4. LOG PROSES SANITASI
  await sendDebugToDiscord(
    "🧹 Sanitization Started", 
    "Memulai proses sanitasi data", 
    {
      originalContent: body.content ? body.content.substring(0, 300) : "No content",
      embedsCount: Array.isArray(body.embeds) ? body.embeds.length : 0
    }, 
    1146986 // Biru Muda
  );

  // --- Bagian Sanitasi & Pengiriman Utama ---
  const allowedRegex = /[^A-Za-z0-9 %`\-\=\[\];',\.\/!@#$%^&*()_+{}|:><?"]/g;
  const sanitizeStr = (s) => (typeof s === 'string' ? s.replace(allowedRegex, '') : s);

  const contentSan = sanitizeStr(body.content) || '';
  
  if (Array.isArray(body.embeds)) {
    body.embeds.forEach((e, i) => {
      if (e.title) {
        const originalTitle = e.title;
        e.title = sanitizeStr(e.title);
        if (originalTitle !== e.title) {
          // LOG JIKA ADA PERUBAHAN
          sendDebugToDiscord(
            `🔄 Sanitization Embed #${i}`, 
            "Title telah disanitasi", 
            {
              embedIndex: i,
              originalTitle: originalTitle.substring(0, 200),
              sanitizedTitle: e.title.substring(0, 200)
            }, 
            1752220 // Biru
          );
        }
      }
      if (e.description) {
        const originalDesc = e.description;
        e.description = sanitizeStr(e.description);
        if (originalDesc !== e.description && originalDesc.length > 0) {
          // LOG JIKA ADA PERUBAHAN
          sendDebugToDiscord(
            `🔄 Sanitization Embed #${i}`, 
            "Description telah disanitasi", 
            {
              embedIndex: i,
              originalDescLength: originalDesc.length,
              sanitizedDescLength: e.description.length,
              changesDetected: true
            }, 
            1752220 // Biru
          );
        }
      }
    });
  }

  // LOG SETELAH SANITASI
  await sendDebugToDiscord(
    "✅ Sanitization Complete", 
    "Data telah disanitasi", 
    {
      sanitizedContent: contentSan.substring(0, 300),
      contentLength: contentSan.length,
      finalEmbedsCount: Array.isArray(body.embeds) ? body.embeds.length : 0
    }, 
    3066993 // Hijau
  );

  try {
    const payload = { content: contentSan, embeds: body.embeds };
    
    // LOG SEBELUM KIRIM KE DISCORD
    await sendDebugToDiscord(
      "🚀 Forwarding to Discord", 
      "Mengirim payload ke Discord Webhook", 
      {
        payloadSize: JSON.stringify(payload).length,
        hasContent: !!contentSan,
        embedsCount: Array.isArray(payload.embeds) ? payload.embeds.length : 0,
        finalCheck: "Ready to send"
      }, 
      10181046 // Ungu
    );

    const resp = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const text = await resp.text();
    const responseStatus = resp.status;
    
    // LOG RESPONSE DARI DISCORD
    await sendDebugToDiscord(
      resp.ok ? "✅ Discord Response Success" : "❌ Discord Response Error",
      `Status: ${responseStatus} ${resp.ok ? 'OK' : 'ERROR'}`,
      {
        discordStatus: responseStatus,
        responsePreview: text.substring(0, 300),
        success: resp.ok,
        headers: Object.fromEntries(resp.headers.entries())
      },
      resp.ok ? 3066993 : 15158332 // Hijau jika sukses, Merah jika error
    );

    return {
      statusCode: resp.ok ? 200 : resp.status,
      body: text || "Success",
      headers: { 'Content-Type': 'text/plain' }
    };

  } catch (err) {
    const fetchErrorData = {
      ...requestData,
      error: err.message,
      stack: err.stack,
      webhookTarget: webhook ? "***[REDACTED]***" : "Not configured"
    };
    
    await sendDebugToDiscord(
      "💥 Fetch Error", 
      "Gagal mengirim ke Discord", 
      fetchErrorData
    );
    return { statusCode: 500, body: String(err) };
  }
};

