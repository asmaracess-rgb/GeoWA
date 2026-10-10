import React, { useState } from 'react';
import { Check, Copy, Play, Send, Terminal } from 'lucide-react';

interface WebhookGuidePanelProps {
  onSendPayloadToExtractor: (jsonString: string) => void;
}

export const WebhookGuidePanel: React.FC<WebhookGuidePanelProps> = ({
  onSendPayloadToExtractor,
}) => {
  const [activeCodeTab, setActiveCodeTab] = useState<'nodejs' | 'python' | 'request'>('nodejs');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [simSenderPhone, setSimSenderPhone] = useState('6281294857712');
  const [simSenderName, setSimSenderName] = useState('Rizky Kurir Lapangan');
  const [simLat, setSimLat] = useState('-6.208763');
  const [simLng, setSimLng] = useState('106.845599');
  const [simPlaceName, setSimPlaceName] = useState('Titik Serah Terima Paket #409');
  const [simAddress, setSimAddress] = useState('Manggarai, Tebet, Jakarta Selatan');

  const generatedWebhookJson = JSON.stringify(
    {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '109283746512',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                contacts: [
                  {
                    profile: { name: simSenderName },
                    wa_id: simSenderPhone.replace(/[^\d]/g, ''),
                  },
                ],
                messages: [
                  {
                    from: simSenderPhone.replace(/[^\d]/g, ''),
                    id: 'wamid.HBgNNjI4MTI5NDg1NzcxMhUCABIYFjNFQjA',
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'location',
                    location: {
                      latitude: Number(simLat) || -6.208763,
                      longitude: Number(simLng) || 106.845599,
                      name: simPlaceName,
                      address: simAddress,
                    },
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    },
    null,
    2
  );

  const nodeJsSnippet = `import express from 'express';

const app = express();
app.use(express.json());

// 1. Verifikasi Webhook Meta WhatsApp Cloud API
app.get('/webhook/whatsapp', (req, res) => {
  const VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// 2. Menerima Pesan Lokasi dari Pengguna WhatsApp
app.post('/webhook/whatsapp', (req, res) => {
  const entry = req.body?.entry?.[0];
  const change = entry?.changes?.[0]?.value;
  const message = change?.messages?.[0];

  if (message?.type === 'location') {
    const senderWaId = message.from; // Contoh: "6281294857712"
    const { latitude, longitude, name, address } = message.location;

    console.log({
      pengirim: senderWaId,
      koordinat: \`\${latitude}, \${longitude}\`,
      namaTempat: name || 'Pin Lokasi Manual',
      alamat: address || '-',
      googleMapsUrl: \`https://www.google.com/maps?q=\${latitude},\${longitude}\`
    });
    // Simpan koordinat ke database pengiriman / presensi Anda di sini
  }

  res.sendStatus(200);
});

app.listen(3000);`;

  const pythonSnippet = `from fastapi import FastAPI, Request, HTTPException, Query
import os

app = FastAPI()
VERIFY_TOKEN = os.getenv("WA_VERIFY_TOKEN", "rahasia_webhook_anda")

@app.get("/webhook/whatsapp")
async def verify_webhook(
    hub_mode: str = Query(None, alias="hub.mode"),
    hub_verify_token: str = Query(None, alias="hub.verify_token"),
    hub_challenge: str = Query(None, alias="hub.challenge"),
):
    if hub_mode == "subscribe" and hub_verify_token == VERIFY_TOKEN:
        return int(hub_challenge)
    raise HTTPException(status_code=403, detail="Token verifikasi tidak cocok")

@app.post("/webhook/whatsapp")
async def receive_whatsapp_location(request: Request):
    body = await request.json()
    entries = body.get("entry", [])
    for entry in entries:
        for change in entry.get("changes", []):
            value = change.get("value", {})
            for msg in value.get("messages", []):
                if msg.get("type") == "location":
                    loc = msg["location"]
                    lat = loc.get("latitude")
                    lng = loc.get("longitude")
                    sender = msg.get("from")
                    print(f"Lokasi diterima dari +{sender}: {lat}, {lng}")
    return {"status": "ok"}`;

  const requestLocationSnippet = `// Mengirimkan tombol interaktif "Kirim Lokasi" resmi ke pengguna WhatsApp
// Endpoint: POST https://graph.facebook.com/v20.0/{PHONE_NUMBER_ID}/messages

const response = await fetch(
  \`https://graph.facebook.com/v20.0/\${ process.env.WA_PHONE_NUMBER_ID }/messages\`,
  {
    method: 'POST',
    headers: {
      'Authorization': \`Bearer \${ process.env.WA_ACCESS_TOKEN }\`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '${simSenderPhone.replace(/[^\d]/g, '')}',
      type: 'interactive',
      interactive: {
        type: 'location_request_message',
        body: {
          text: 'Halo! Mohon bagikan titik lokasi Anda saat ini untuk memproses pengiriman pesanan.'
        },
        action: {
          name: 'send_location'
        }
      }
    })
  }
);`;

  const currentCode =
    activeCodeTab === 'nodejs'
      ? nodeJsSnippet
      : activeCodeTab === 'python'
      ? pythonSnippet
      : requestLocationSnippet;

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      {/* Left column: Simulator Payload Webhook Location */}
      <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-6">
        <div className="pb-4 mb-5 border-b border-slate-200">
          <div className="text-xs text-slate-500 mb-1">
            Simulasi Payload · WhatsApp Cloud API Resmi
          </div>
          <h3 className="text-lg font-semibold text-slate-900">
            Generator Objek Lokasi Webhook
          </h3>
          <p className="text-sm text-slate-600 mt-1">
            Saat pengguna menekan tombol bagikan lokasi di WhatsApp, server Meta mengirimkan objek JSON bertipe <code className="font-mono text-xs text-slate-800">location</code> ke endpoint program Anda.
          </p>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Nomor Pengirim (WA ID)
              </label>
              <input
                type="text"
                value={simSenderPhone}
                onChange={(e) => setSimSenderPhone(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Nama Profil Pengirim
              </label>
              <input
                type="text"
                value={simSenderName}
                onChange={(e) => setSimSenderName(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-slate-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Latitude (Garis Lintang)
              </label>
              <input
                type="text"
                value={simLat}
                onChange={(e) => setSimLat(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Longitude (Garis Bujur)
              </label>
              <input
                type="text"
                value={simLng}
                onChange={(e) => setSimLng(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-slate-900"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Nama Lokasi (`location.name`)
            </label>
            <input
              type="text"
              value={simPlaceName}
              onChange={(e) => setSimPlaceName(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-slate-900"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Alamat Lengkap (`location.address`)
            </label>
            <input
              type="text"
              value={simAddress}
              onChange={(e) => setSimAddress(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-slate-900"
            />
          </div>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => onSendPayloadToExtractor(generatedWebhookJson)}
              className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Uji & Petakan Payload Ini</span>
            </button>

            <button
              type="button"
              onClick={() => handleCopy(generatedWebhookJson, 'json-payload')}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              {copiedId === 'json-payload' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>JSON Tersalin</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Salin Payload JSON</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Right column: Code implementation & JSON preview */}
      <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 mb-5 border-b border-slate-200">
          <div>
            <div className="text-xs text-slate-500 mb-1">
              Implementasi Kode Program · Arsitektur Resmi
            </div>
            <h3 className="text-lg font-semibold text-slate-900">
              Kode Backend Penerima Lokasi WhatsApp
            </h3>
          </div>

          {/* Interactive segmented filter tabs */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
            <button
              type="button"
              onClick={() => setActiveCodeTab('nodejs')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeCodeTab === 'nodejs'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Node.js (Express)
            </button>
            <button
              type="button"
              onClick={() => setActiveCodeTab('python')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeCodeTab === 'python'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Python (FastAPI)
            </button>
            <button
              type="button"
              onClick={() => setActiveCodeTab('request')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeCodeTab === 'request'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Minta Lokasi (API)
            </button>
          </div>
        </div>

        <div className="relative">
          <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900 text-slate-300 rounded-t-md border-b border-slate-800 text-xs font-mono">
            <span className="flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              <span>
                {activeCodeTab === 'nodejs'
                  ? 'webhook-server.js'
                  : activeCodeTab === 'python'
                  ? 'main.py'
                  : 'send-location-request.js'}
              </span>
            </span>
            <button
              type="button"
              onClick={() => handleCopy(currentCode, 'code-snippet')}
              className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              {copiedId === 'code-snippet' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Disalin</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Salin Kode</span>
                </>
              )}
            </button>
          </div>
          <pre className="p-4 bg-slate-950 text-slate-100 text-xs font-mono leading-relaxed overflow-x-auto rounded-b-md max-h-[340px]">
            <code>{currentCode}</code>
          </pre>
        </div>

        <div className="mt-5 pt-4 border-t border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-600">
          <div>
            <div className="font-semibold text-slate-900 mb-1">
              1. Mengapa Pesan Teks Biasa Tidak Menyimpan GPS?
            </div>
            <p className="leading-relaxed">
              Pesan WhatsApp dienkripsi ujung-ke-ujung (Signal Protocol) dan diteruskan melalui server relay Meta. Penerima pesan teks biasa tidak menerima alamat IP maupun koordinat GPS pengirim.
            </p>
          </div>
          <div>
            <div className="font-semibold text-slate-900 mb-1">
              2. Cara Kerja Pelacakan Lokasi yang Sah
            </div>
            <p className="leading-relaxed">
              Program pelacak lokasi kurir, presensi karyawan, atau tanggap darurat bekerja dengan memproses fitur <em>Share Location</em>, mengekstrak file log chat, atau menggunakan <code>location_request_message</code> pada WhatsApp Business API.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
