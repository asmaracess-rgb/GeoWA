/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Link2,
  LocateFixed,
  MapPin,
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
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  locationLabel: string;
  note: string;
}

export default function App() {
  // Check if URL has ?bagikan=1 (Recipient Confirmation Page Mode)
  const [isRecipientView, setIsRecipientView] = useState<boolean>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('bagikan') === '1';
  });

  const [recipientName, setRecipientName] = useState<string>('');
  const [gpsLoading, setGpsLoading] = useState<boolean>(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [recipientCapturedResult, setRecipientCapturedResult] =
    useState<CoordinateSearchResult | null>(null);

  // Main Tracker States
  const [senderLabelForLink, setSenderLabelForLink] = useState<string>('');
  const [messageInput, setMessageInput] = useState<string>('');
  const [localSearchResults, setLocalSearchResults] = useState<CoordinateSearchResult[]>([]);
  const [serverResults, setServerResults] = useState<CoordinateSearchResult[]>([]);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Build shareable URL for WhatsApp
  const shareableLink = useMemo(() => {
    const baseUrl = window.location.origin + window.location.pathname;
    const params = new URLSearchParams();
    params.set('bagikan', '1');
    if (senderLabelForLink.trim()) {
      params.set('kontak', senderLabelForLink.trim());
    }
    return `${baseUrl}?${params.toString()}`;
  }, [senderLabelForLink]);

  useEffect(() => {
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
                ? `${item.note} (Akurasi GPS ±${item.accuracyMeters} meter)`
                : item.note,
            sender: item.senderLabel,
            messageTime: item.createdAt,
            cleanMessageText: item.note,
            latitude: item.latitude,
            longitude: item.longitude,
            dmsString: formatDecimalToDms(item.latitude, item.longitude),
            locationLabel: item.locationLabel,
            detectionMethod:
              item.accuracyMeters !== null
                ? `Tautan GPS Browser (±${item.accuracyMeters}m)`
                : 'Tautan GPS Browser',
          })
        );
        setServerResults(mapped);
      }
    } catch {
      // Ignore network poll errors
    }
  }, []);

  // Poll backend every 4 seconds for new incoming GPS confirmations from WhatsApp link
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

  // Capture real device GPS via browser navigator.geolocation and save to server
  const handleCaptureBrowserGps = (fromRecipientView: boolean) => {
    if (!navigator.geolocation) {
      setGpsError('Browser ini tidak mendukung fitur Geolocation GPS.');
      return;
    }

    setGpsLoading(true);
    setGpsError(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = Number(position.coords.latitude.toFixed(6));
        const lng = Number(position.coords.longitude.toFixed(6));
        const acc = Math.round(position.coords.accuracy || 0);

        const resolvedAddr = await reverseGeocodeCoordinates(lat, lng);
        const senderName =
          (fromRecipientView ? recipientName : senderLabelForLink).trim() ||
          'Konfirmasi Tautan GPS WhatsApp';

        try {
          const response = await fetch('/api/shared-locations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              senderLabel: senderName,
              latitude: lat,
              longitude: lng,
              accuracyMeters: acc,
              locationLabel: resolvedAddr,
              note: `Titik GPS ditangkap dari browser (${lat}, ${lng})`,
            }),
          });

          if (response.ok) {
            const saved = await response.json();
            const createdItem: CoordinateSearchResult = {
              id: saved.item.id,
              createdAt: saved.item.createdAt,
              rawMessage: `Titik GPS dikonfirmasi melalui tautan browser (Akurasi ±${acc} meter)`,
              sender: senderName,
              messageTime: saved.item.createdAt,
              cleanMessageText: `Lokasi GPS: https://www.google.com/maps?q=${lat},${lng}`,
              latitude: lat,
              longitude: lng,
              dmsString: formatDecimalToDms(lat, lng),
              locationLabel: resolvedAddr,
              detectionMethod: `Tautan GPS Browser (±${acc}m)`,
            };

            setRecipientCapturedResult(createdItem);
            await fetchServerLocations();
            setSelectedResultId(createdItem.id);
            setStatusNotice(`Koordinat GPS berhasil ditangkap: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
            setTimeout(() => setStatusNotice(null), 4000);
          }
        } catch {
          // Fallback to local state if server unreachable
          const fallbackItem: CoordinateSearchResult = {
            id: `gps-local-${Date.now()}`,
            createdAt: new Date().toLocaleTimeString('id-ID'),
            rawMessage: `Titik GPS dikonfirmasi melalui browser (Akurasi ±${acc} meter)`,
            sender: senderName,
            messageTime: new Date().toLocaleTimeString('id-ID'),
            cleanMessageText: `Lokasi GPS: https://www.google.com/maps?q=${lat},${lng}`,
            latitude: lat,
            longitude: lng,
            dmsString: formatDecimalToDms(lat, lng),
            locationLabel: resolvedAddr,
            detectionMethod: `Tautan GPS Browser (±${acc}m)`,
          };
          setRecipientCapturedResult(fallbackItem);
          setLocalSearchResults((prev) => [fallbackItem, ...prev]);
          setSelectedResultId(fallbackItem.id);
        } finally {
          setGpsLoading(false);
        }
      },
      (err) => {
        setGpsLoading(false);
        if (err.code === err.PERMISSION_DENIED) {
          setGpsError(
            'Izin lokasi ditolak di browser. Mohon klik "Allow / Izinkan" pada pop-up lokasi browser agar titik koordinat GPS dapat diperoleh.'
          );
        } else if (err.code === err.TIMEOUT) {
          setGpsError('Waktu pembacaan sensor GPS habis. Silakan coba klik kembali.');
        } else {
          setGpsError('Gagal membaca sensor GPS perangkat. Pastikan layanan Lokasi (GPS) aktif.');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      }
    );
  };

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
        await fetch(`/api/shared-locations/${encodeURIComponent(id)}`, {
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

  // =========================================================================
  // RECIPIENT VIEW (?bagikan=1) — Halaman saat lawan bicara membuka tautan WA
  // =========================================================================
  if (isRecipientView) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-between p-6">
        <div className="max-w-lg w-full mx-auto my-auto bg-white border border-slate-200 rounded-lg p-6 space-y-5">
          <div className="pb-4 border-b border-slate-200">
            <div className="text-xs text-slate-500 mb-1">
              Konfirmasi Lokasi GPS Browser · WhatsApp
            </div>
            <h1 className="text-xl font-bold text-slate-900 font-display">
              Bagikan Titik Koordinat Lokasi Anda
            </h1>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              Tekan tombol di bawah dan pilih <strong>Izinkan (Allow)</strong> pada permintaan lokasi browser untuk mengirimkan titik koordinat GPS perangkat Anda secara akurat.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Nama / Keterangan Pengirim (Opsional)
            </label>
            <input
              type="text"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="Contoh: Budi / +62 812..."
              className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-slate-900"
            />
          </div>

          {gpsError && (
            <div className="p-3.5 rounded-md bg-red-50 border border-red-200 text-xs text-red-700 leading-relaxed">
              {gpsError}
            </div>
          )}

          <button
            type="button"
            onClick={() => handleCaptureBrowserGps(true)}
            disabled={gpsLoading}
            className="w-full flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
          >
            <LocateFixed className="w-4 h-4" />
            <span>
              {gpsLoading
                ? 'Membaca Koordinat Sensor GPS...'
                : 'Izinkan & Kirim Lokasi GPS Saya'}
            </span>
          </button>

          {recipientCapturedResult && (
            <div className="p-4 rounded-lg bg-slate-900 text-white space-y-3">
              <div className="text-xs text-emerald-400 font-medium">
                Lokasi GPS Berhasil Dikonfirmasi & Dikirim ke Daftar Pencarian!
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

              <div className="pt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    handleCopyText(
                      `Lokasi saya saat ini: https://maps.google.com/?q=${recipientCapturedResult.latitude},${recipientCapturedResult.longitude} (${recipientCapturedResult.latitude.toFixed(6)}, ${recipientCapturedResult.longitude.toFixed(6)})`,
                      'recipient-copy'
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-900 bg-white hover:bg-slate-100 rounded-md transition-colors"
                >
                  {copiedId === 'recipient-copy' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Teks Tersalin</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Salin Teks Koordinat untuk Chat WA</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
            <span>Koordinat hanya dikirim saat Anda menekan tombol di atas.</span>
            <button
              type="button"
              onClick={() => {
                window.history.replaceState({}, '', window.location.pathname);
                setIsRecipientView(false);
              }}
              className="text-slate-900 font-medium hover:underline whitespace-nowrap shrink-0"
            >
              Buka Dasbor Pelacak →
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
              Tautan Tangkap GPS
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
              onClick={handleSearchFromCopiedText}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors whitespace-nowrap shrink-0"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Cari dari Teks yang Dicopy</span>
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

        {/* Top 2 Methods Grid: Method A (GPS Link) & Method B (Copied Text) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* FITUR KE-4: Buat Tautan Konfirmasi Lokasi GPS Browser */}
          <section
            id="tautan-gps"
            className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-6 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between gap-2 pb-4 mb-4 border-b border-slate-200">
                <div>
                  <div className="text-xs text-slate-500 mb-0.5">
                    Metode 1 · Tangkap GPS Presisi via Browser
                  </div>
                  <h2 className="text-base font-bold text-slate-900 font-display">
                    Tautan Konfirmasi Lokasi untuk Dikirim ke WhatsApp
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setIsRecipientView(true)}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  Pratinjau Halaman Penerima
                </button>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed mb-4">
                Kirimkan tautan di bawah ini ke chat WhatsApp orang yang ingin Anda ketahui lokasinya. Saat ia membuka tautan dan mengizinkan lokasi browser, titik koordinat <strong>Latitude &amp; Longitude GPS</strong> ponselnya otomatis masuk ke daftar hasil pencarian Anda di bawah.
              </p>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Label Nama Kontak / Target (Opsional)
                  </label>
                  <input
                    type="text"
                    value={senderLabelForLink}
                    onChange={(e) => setSenderLabelForLink(e.target.value)}
                    placeholder="Contoh: Andi / Nomor WA Pengirim..."
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tautan Konfirmasi Lokasi Anda
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={shareableLink}
                      className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-md text-slate-700 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleCopyText(shareableLink, 'copy-link')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap shrink-0"
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

              {gpsError && (
                <div className="mt-3 p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
                  {gpsError}
                </div>
              )}
            </div>

            <div className="pt-4 mt-5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() =>
                  handleCopyText(
                    `Halo, mohon klik tautan berikut untuk mengonfirmasi titik lokasi Anda saat ini: ${shareableLink}`,
                    'copy-wa-msg'
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>
                  {copiedId === 'copy-wa-msg'
                    ? 'Pesan + Link Tersalin'
                    : 'Salin Kalimat + Link untuk WA'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleCaptureBrowserGps(false)}
                disabled={gpsLoading}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <LocateFixed className="w-3.5 h-3.5" />
                <span>
                  {gpsLoading
                    ? 'Membaca GPS...'
                    : 'Uji Tangkap GPS Perangkat Ini'}
                </span>
              </button>
            </div>
          </section>

          {/* METODE 2: Cari Titik Koordinat dari Teks Pesan WhatsApp yang Dicopy */}
          <section
            id="pencarian-teks"
            className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-6 flex flex-col justify-between"
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
                  rows={4}
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
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
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
              <div className="text-xs text-slate-400">
                Titik Koordinat Diperoleh · {activeResult.detectionMethod}
              </div>
              <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-emerald-400 tracking-tight">
                {activeResult.latitude.toFixed(6)}, {activeResult.longitude.toFixed(6)}
              </div>
              <div className="text-xs text-slate-300">
                Latitude: <strong className="font-mono tabular-nums">{activeResult.latitude.toFixed(6)}</strong> · Longitude: <strong className="font-mono tabular-nums">{activeResult.longitude.toFixed(6)}</strong> · DMS: <span className="font-mono tabular-nums">{activeResult.dmsString}</span>
              </div>
              <div className="text-xs text-slate-300 pt-0.5">
                Lokasi: {activeResult.locationLabel}
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
                  Menampung koordinat dari Tautan GPS Browser maupun dari Teks Pesan WA yang dicopy.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={fetchServerLocations}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
                  title="Periksa koordinat baru yang masuk dari tautan"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Segarkan</span>
                </button>

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
                  Belum Ada Hasil Pencarian Koordinat
                </div>
                <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                  Gunakan <strong>Tautan Konfirmasi Lokasi GPS</strong> atau tekan tombol <strong>Cari Titik Koordinat dari Teks yang Dicopy</strong> di atas.
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
                Menampilkan posisi titik koordinat dari tautan GPS maupun hasil pencarian pesan WhatsApp.
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
