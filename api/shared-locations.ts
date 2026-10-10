import type { Request, Response } from 'express';

interface StoredSharedLocation {
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

// In-memory store for serverless warm instances on Vercel
const globalStore = globalThis as unknown as {
  __vercelSharedLocations?: StoredSharedLocation[];
};

if (!globalStore.__vercelSharedLocations) {
  globalStore.__vercelSharedLocations = [];
}

export default function handler(req: Request, res: Response) {
  const store = globalStore.__vercelSharedLocations!;

  if (req.method === 'GET') {
    return res.status(200).json({ items: store });
  }

  if (req.method === 'POST') {
    const { senderLabel, linkToken, latitude, longitude, accuracyMeters, locationLabel, note } =
      req.body || {};
    const lat = Number(latitude);
    const lng = Number(longitude);

    if (
      Number.isNaN(lat) ||
      Number.isNaN(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
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
          ? `Kode #${cleanToken}`
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
          : 'Koordinat GPS dikonfirmasi melalui browser',
    };

    store.unshift(newItem);
    return res.status(201).json({ item: newItem });
  }

  if (req.method === 'DELETE') {
    const idParam = (req.query?.id as string) || '';
    if (idParam) {
      const idx = store.findIndex((item) => item.id === idParam);
      if (idx !== -1) {
        store.splice(idx, 1);
      }
    } else {
      store.length = 0;
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
