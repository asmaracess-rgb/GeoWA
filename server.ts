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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Get all shared GPS locations
  app.get('/api/shared-locations', (_req, res) => {
    res.json({ items: sharedLocationsStore });
  });

  // Save a new consented GPS location
  app.post('/api/shared-locations', (req, res) => {
    const { senderLabel, linkToken, latitude, longitude, accuracyMeters, locationLabel, note } =
      req.body || {};
    const lat = Number(latitude);
    const lng = Number(longitude);

    if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'Koordinat tidak valid' });
    }

    const cleanToken =
      typeof linkToken === 'string' && linkToken.trim() ? linkToken.trim() : undefined;

    const newItem: StoredSharedLocation = {
      id: `gps-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      senderLabel:
        typeof senderLabel === 'string' && senderLabel.trim()
          ? senderLabel.trim()
          : cleanToken
          ? `Tautan #${cleanToken}`
          : 'Konfirmasi GPS Browser',
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
          : 'Koordinat GPS dikonfirmasi melalui tautan browser',
    };

    sharedLocationsStore.unshift(newItem);
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
