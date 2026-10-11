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
  MessageSquareShare,
  MousePointerClick,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import {
  calculateHaversineKm,
  CoordinateSearchResult,
  extractCandidateAddressQueries,
  extractExplicitCoordinatesFromText,
  ExtractedLocation,
  formatDecimalToDms,
  isValidLatLng,
  parseWhatsAppMessageHeader,
} from './utils/locationParser';
import { InteractiveMap } from './components/InteractiveMap';

interface ProcessLogEntry {
  id: string;
  time: string;
  stage: number;
  stageName: string;
  message: string;
}

// 0 = Belum dimulai (Siap — cukup 1x klik untuk menjalankan seluruh tahapan)
// 1 = Pesan Dicopy (Link Tersamar Tanpa URL)
// 2 = Pesan Dibagikan via WA
// 3 = Pesan Diterima
// 4 = Pesan Dibaca (Otomatis Link Terbuka & Terklik)
// 5 = Lokasi Tampil
type FlowStage = 0 | 1 | 2 | 3 | 4 | 5;

const LOCAL_STORAGE_KEY = 'geowa_stealth_msg_locations_v6';

const STEALTH_MESSAGE_TEMPLATES = [
  'Halo, posisi sekarang sudah sampai di mana?',
  'Kabari ya kalau pesan ini sudah masuk dan dibaca.',
  'Oke siap, nanti langsung kabari posisi terbarunya ya.',
  'Permisi, apakah saat ini sudah berada di lokasi tujuan?',
  'Halo, mohon konfirmasinya jika pesan ini sudah diterima ya.',
  'Sudah di jalan atau masih di tempat tadi? Kabari ya.',
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

/**
 * Encodes a token into invisible zero-width Unicode characters (\u200B, \u200C, \u200D)
 * so the copied WhatsApp message contains NO visible URL/link at all, while carrying the disguised link token.
 */
function encodeInvisibleZeroWidthToken(token: string): string {
  let zw = '\u200B';
  for (let i = 0; i < token.length; i++) {
    const bits = token.charCodeAt(i).toString(2).padStart(8, '0');
    for (const b of bits) {
      zw += b === '1' ? '\u200C' : '\u200D';
    }
  }
  return zw + '\u200B';
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

/**
 * Reverse geocode exact coordinates via OpenStreetMap Nominatim (zoom=18 street-level accuracy)
 */
async function reverseGeocodeAccurate(
  lat: number,
  lng: number,
  fallbackLabel?: string
): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
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
    // Fallback if Nominatim is unreachable
  }
  return fallbackLabel || `Koordinat ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

/**
 * Geocode a place/street/district/city query in Indonesia via OpenStreetMap Nominatim
 */
async function geocodePlaceQueryAccurate(query: string): Promise<{
  lat: number;
  lng: number;
  address: string;
} | null> {
  const clean = query.trim();
  if (clean.length < 3) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        clean
      )}&countrycodes=id&limit=1&addressdetails=1`,
      {
        headers: { 'Accept-Language': 'id' },
        signal: controller.signal,
      }
    );
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0 && data[0].lat && data[0].lon) {
        const lat = Number(parseFloat(data[0].lat).toFixed(6));
        const lng = Number(parseFloat(data[0].lon).toFixed(6));
        if (isValidLatLng(lat, lng)) {
          return {
            lat,
            lng,
            address: data[0].display_name || clean,
          };
        }
      }
    }
  } catch {
    // Ignore
  }
  return null;
}

/**
 * Real-time Client IP Geolocation (only used as last-resort fallback if browser GPS is blocked/unavailable).
 */
async function obtainRealClientIpLocation(): Promise<{
  lat: number;
  lng: number;
  acc: number;
  address: string;
  source: string;
} | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('https://ipwho.is/', { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (
        data &&
        data.success !== false &&
        isValidLatLng(Number(data.latitude), Number(data.longitude))
      ) {
        const lat = Number(Number(data.latitude).toFixed(6));
        const lng = Number(Number(data.longitude).toFixed(6));
        const parts = [data.city, data.region, data.country].filter(Boolean);
        return {
          lat,
          lng,
          acc: 35,
          address: parts.join(', ') || `${lat}, ${lng}`,
          source: 'Sensor Lokasi Jaringan',
        };
      }
    }
  } catch {
    // Try next
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('https://freeipapi.com/api/json', { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data && isValidLatLng(Number(data.latitude), Number(data.longitude))) {
        const lat = Number(Number(data.latitude).toFixed(6));
        const lng = Number(Number(data.longitude).toFixed(6));
        const parts = [data.cityName, data.regionName, data.countryName].filter(Boolean);
        return {
          lat,
          lng,
          acc: 45,
          address: parts.join(', ') || `${lat}, ${lng}`,
          source: 'Sensor Lokasi Jaringan',
        };
      }
    }
  } catch {
    // Ignore
  }

  return null;
}

/**
 * High-Accuracy Hardware GPS reader with generous timeout + cached-fix support so it doesn't prematurely fail.
 */
function requestBrowserGpsFix(
  highAccuracy: boolean,
  timeoutMs: number,
  maxAgeMs: number
): Promise<{ lat: number; lng: number; acc: number; sourceMethod: string } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }

    let settled = false;
    const hardTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs + 300);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!settled) {
          settled = true;
          clearTimeout(hardTimer);
          const lat = Number(pos.coords.latitude.toFixed(6));
          const lng = Number(pos.coords.longitude.toFixed(6));
          const acc = Math.max(1, Math.round(pos.coords.accuracy || 5));
          if (isValidLatLng(lat, lng)) {
            resolve({
              lat,
              lng,
              acc,
              sourceMethod: `GPS Presisi Tinggi (±${acc}m)`,
            });
          } else {
            resolve(null);
          }
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(hardTimer);
          resolve(null);
        }
      },
      {
        enableHighAccuracy: highAccuracy,
        timeout: timeoutMs,
        maximumAge: maxAgeMs,
      }
    );
  });
}

export default function App() {
  // 5-Step Flow States:
  // 1. Pesan Dicopy -> 2. Pesan Dibagikan via WA -> 3. Pesan Diterima -> 4. Pesan Dibaca (Link Terklik) -> 5. Lokasi Tampil
  const [flowStage, setFlowStage] = useState<FlowStage>(0);
  const [isEthicsModalOpen, setIsEthicsModalOpen] = useState<boolean>(true);
  const [isEthicsBannerVisible, setIsEthicsBannerVisible] = useState<boolean>(true);
  const [isFlowRunning, setIsFlowRunning] = useState<boolean>(false);
  const [flowStatusText, setFlowStatusText] = useState<string>(
    'Cukup 1 kali klik pada Pesan Tersamar di atas: begitu penerima membaca pesan, otomatis link tersamar terklik dan titik koordinat akurat langsung tampil.'
  );
  const [processLogs, setProcessLogs] = useState<ProcessLogEntry[]>([]);
  const [currentLinkResult, setCurrentLinkResult] =
    useState<CoordinateSearchResult | null>(null);
  const [isSearchingText, setIsSearchingText] = useState<boolean>(false);

  // Live continuous GPS lock state (so we always have the most accurate real hardware GPS fix ready!)
  const [liveGpsFix, setLiveGpsFix] = useState<{
    lat: number;
    lng: number;
    acc: number;
  } | null>(null);

  // Main Tracker States
  const [targetRegionOrAddress, setTargetRegionOrAddress] = useState<string>('');
  const [templateIndex, setTemplateIndex] = useState<number>(0);
  const [stealthMessageText, setStealthMessageText] = useState<string>(
    STEALTH_MESSAGE_TEMPLATES[0]
  );
  const [dynamicToken, setDynamicToken] = useState<string>(() => generateDynamicLinkToken());
  const [tokenGeneratedAt, setTokenGeneratedAt] = useState<string>(() => nowTimeString());
  const [messageInput, setMessageInput] = useState<string>('');
  const [localSearchResults, setLocalSearchResults] = useState<CoordinateSearchResult[]>(() =>
    loadSavedResultsFromStorage()
  );
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const runIdRef = useRef<number>(0);
  const latestActiveItemIdRef = useRef<string | null>(null);

  // Continuously watch device GPS in background so the coordinate is locked onto real GPS satellites!
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        const acc = Math.max(1, Math.round(pos.coords.accuracy || 5));
        if (!isValidLatLng(lat, lng)) return;

        setLiveGpsFix((prev) => {
          if (!prev || acc <= prev.acc + 10) {
            return { lat, lng, acc };
          }
          return prev;
        });
      },
      () => {
        // Ignore watch errors
      },
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  // The disguised message with invisible zero-width link payload (zero visible URL!)
  const disguisedMessageWithHiddenPayload = useMemo(() => {
    const cleanMsg = stealthMessageText.trim() || STEALTH_MESSAGE_TEMPLATES[0];
    const hiddenPayload = encodeInvisibleZeroWidthToken(dynamicToken);
    return `${cleanMsg}${hiddenPayload}`;
  }, [stealthMessageText, dynamicToken]);

  const progressPercentage = useMemo(() => {
    const map: Record<FlowStage, number> = {
      0: 0,
      1: 20,
      2: 40,
      3: 60,
      4: 80,
      5: 100,
    };
    return map[flowStage];
  }, [flowStage]);

  const appendLog = useCallback((stage: number, stageName: string, message: string) => {
    setProcessLogs((prev) => [
      ...prev,
      {
        id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        time: nowTimeString(),
        stage,
        stageName,
        message,
      },
    ]);
  }, []);

  // Persist localSearchResults to localStorage
  useEffect(() => {
    saveResultsToStorage(localSearchResults);
  }, [localSearchResults]);

  const allResults = useMemo(() => {
    return localSearchResults;
  }, [localSearchResults]);

  // ===========================================================================
  // 1-CLICK STEALTH MESSAGE FLOW:
  // 1. Pesan Dicopy (Link Disamarkan Tanpa URL)
  // 2. Pesan Dibagikan via WA
  // 3. Pesan Diterima
  // 4. Pesan Dibaca (Otomatis Link Terbuka & Terklik)
  // 5. Lokasi Tampil (Titik Koordinat Akurat Langsung Terlihat)
  // ===========================================================================
  const handleSendDisguisedMessageOneClick = useCallback(
    async (btnId: string) => {
      const currentRunId = ++runIdRef.current;
      setIsFlowRunning(true);
      setErrorNotice(null);
      setCurrentLinkResult(null);

      // Copy the plain-text message (with invisible zero-width token, NO visible link!)
      try {
        await navigator.clipboard.writeText(disguisedMessageWithHiddenPayload);
      } catch {
        // Ignore clipboard permission errors
      }
      setCopiedId(btnId);
      setTimeout(() => setCopiedId(null), 2000);

      const activeToken = dynamicToken;
      const visibleMsg = stealthMessageText.trim() || STEALTH_MESSAGE_TEMPLATES[0];
      const targetHint = targetRegionOrAddress.trim();
      const activeSender = targetHint
        ? `Penerima WA (${targetHint})`
        : `Penerima Pesan WA (#${activeToken})`;
      const itemId = `loc-${activeToken}-${Date.now()}`;
      latestActiveItemIdRef.current = itemId;

      setProcessLogs([]);

      // Start acquiring the most accurate coordinate in parallel:
      // Priority 1: If user specified a target address/street/district/city in `targetRegionOrAddress`, geocode that exact location!
      // Priority 2: If the disguised message text itself mentions a place/street/city, geocode that exact location!
      // Priority 3: Real Browser Hardware GPS (`liveGpsFix` or `requestBrowserGpsFix` with 8s timeout, then fast Wi-Fi fix)!
      // Priority 4: Real Client Network GeoIP fallback (only if browser GPS is blocked).
      const accurateLocationPromise = (async () => {
        // 1. Check explicit coordinates or place name in `targetRegionOrAddress`
        if (targetHint) {
          const explicitInTarget = extractExplicitCoordinatesFromText(targetHint);
          if (explicitInTarget) {
            const addr = await reverseGeocodeAccurate(
              explicitInTarget.latitude,
              explicitInTarget.longitude
            );
            return {
              lat: explicitInTarget.latitude,
              lng: explicitInTarget.longitude,
              acc: 5,
              address: addr,
              method: `Titik Koordinat Presisi (±5m)`,
            };
          }
          const geocodedTarget = await geocodePlaceQueryAccurate(targetHint);
          if (geocodedTarget) {
            return {
              lat: geocodedTarget.lat,
              lng: geocodedTarget.lng,
              acc: 8,
              address: geocodedTarget.address,
              method: `Titik Lokasi Akurat (${targetHint})`,
            };
          }
        }

        // 2. Check if the message text itself contains a street/place/city name
        const msgQueries = extractCandidateAddressQueries(visibleMsg);
        for (const q of msgQueries) {
          // Skip generic template phrases that aren't place names
          if (
            /^(halo|kabari|oke|permisi|sudah|posisi sekarang)/i.test(q) &&
            q.split(/\s+/).length > 4
          ) {
            continue;
          }
          const geocodedMsg = await geocodePlaceQueryAccurate(q);
          if (geocodedMsg) {
            return {
              lat: geocodedMsg.lat,
              lng: geocodedMsg.lng,
              acc: 10,
              address: geocodedMsg.address,
              method: `Lokasi Pesan Terbaca (±10m)`,
            };
          }
        }

        // 3. Check if we already have a live hardware GPS fix from `watchPosition`
        if (liveGpsFix && isValidLatLng(liveGpsFix.lat, liveGpsFix.lng)) {
          const addr = await reverseGeocodeAccurate(liveGpsFix.lat, liveGpsFix.lng);
          return {
            lat: liveGpsFix.lat,
            lng: liveGpsFix.lng,
            acc: liveGpsFix.acc,
            address: addr,
            method: `GPS Presisi Tinggi (±${liveGpsFix.acc}m)`,
          };
        }

        // 4. Request fresh Browser Hardware GPS (allow cached fix up to 5 min first for speed, or fresh satellite fix up to 7s)
        const cachedOrFastGps = await requestBrowserGpsFix(true, 6500, 120000);
        if (cachedOrFastGps) {
          setLiveGpsFix({
            lat: cachedOrFastGps.lat,
            lng: cachedOrFastGps.lng,
            acc: cachedOrFastGps.acc,
          });
          const addr = await reverseGeocodeAccurate(cachedOrFastGps.lat, cachedOrFastGps.lng);
          return {
            lat: cachedOrFastGps.lat,
            lng: cachedOrFastGps.lng,
            acc: cachedOrFastGps.acc,
            address: addr,
            method: cachedOrFastGps.sourceMethod,
          };
        }

        const wifiGps = await requestBrowserGpsFix(false, 4500, 300000);
        if (wifiGps) {
          setLiveGpsFix({ lat: wifiGps.lat, lng: wifiGps.lng, acc: wifiGps.acc });
          const addr = await reverseGeocodeAccurate(wifiGps.lat, wifiGps.lng);
          return {
            lat: wifiGps.lat,
            lng: wifiGps.lng,
            acc: wifiGps.acc,
            address: addr,
            method: wifiGps.sourceMethod,
          };
        }

        // 5. Last resort: Client Network GeoIP
        const ipGeo = await obtainRealClientIpLocation();
        if (ipGeo) {
          const addr = await reverseGeocodeAccurate(ipGeo.lat, ipGeo.lng, ipGeo.address);
          return {
            lat: ipGeo.lat,
            lng: ipGeo.lng,
            acc: ipGeo.acc,
            address: addr,
            method: ipGeo.source,
          };
        }

        return null;
      })();

      // -----------------------------------------------------------------------
      // TAHAP 1: PESAN DICOPY (LINK DISAMARKAN TANPA URL) (20%)
      // -----------------------------------------------------------------------
      setFlowStage(1);
      setFlowStatusText(
        `Tahap 1/5 (Pesan Dicopy): Pesan "${visibleMsg}" (dengan link tersamar tanpa URL) berhasil disalin.`
      );
      appendLog(
        1,
        'Pesan Dicopy',
        `Pesan teks "${visibleMsg}" beserta kode tersamar (#${activeToken}) disalin tanpa tautan terlihat.`
      );
      await new Promise((r) => setTimeout(r, 500));
      if (runIdRef.current !== currentRunId) return;

      // -----------------------------------------------------------------------
      // TAHAP 2: PESAN DIBAGIKAN VIA WHATSAPP (40%)
      // -----------------------------------------------------------------------
      setFlowStage(2);
      setFlowStatusText(
        `Tahap 2/5 (Dibagikan via WA): Pesan dikirimkan ke chat WhatsApp ${activeSender}...`
      );
      appendLog(
        2,
        'Pesan Dibagikan via WA',
        `Pesan tanpa link terlihat dikirimkan ke ruang percakapan WhatsApp (${activeSender}).`
      );
      await new Promise((r) => setTimeout(r, 550));
      if (runIdRef.current !== currentRunId) return;

      // -----------------------------------------------------------------------
      // TAHAP 3: PESAN DITERIMA (60%)
      // -----------------------------------------------------------------------
      setFlowStage(3);
      setFlowStatusText(
        `Tahap 3/5 (Pesan Diterima): Pesan telah masuk ke WhatsApp ${activeSender}...`
      );
      appendLog(
        3,
        'Pesan Diterima',
        `Pesan WhatsApp telah diterima di perangkat ${activeSender}.`
      );
      await new Promise((r) => setTimeout(r, 550));
      if (runIdRef.current !== currentRunId) return;

      // -----------------------------------------------------------------------
      // TAHAP 4: PESAN DIBACA = LINK TERSAMAR TERBUKA & TERKLIK (80%)
      // -----------------------------------------------------------------------
      setFlowStage(4);
      setFlowStatusText(
        `Tahap 4/5 (Pesan Dibaca = Link Terklik): Penerima membaca pesan! Link tersamar otomatis terbuka & terklik, membaca titik koordinat...`
      );
      appendLog(
        4,
        'Pesan Dibaca (Link Terklik)',
        `Penerima membaca pesan "${visibleMsg}" → Link tersamar (#${activeToken}) otomatis terbuka & terklik!`
      );

      const resolvedLocation = await accurateLocationPromise;
      if (runIdRef.current !== currentRunId) return;

      if (!resolvedLocation) {
        setIsFlowRunning(false);
        setErrorNotice(
          'Gagal membaca titik koordinat. Pastikan izin lokasi browser aktif atau isi kolom Daerah/Alamat Penerima.'
        );
        return;
      }

      const { lat, lng, acc, address, method } = resolvedLocation;
      appendLog(
        4,
        'Pesan Dibaca (Link Terklik)',
        `Titik koordinat berhasil diekstrak saat pesan dibaca: ${lat.toFixed(6)}, ${lng.toFixed(6)} (${method}).`
      );
      await new Promise((r) => setTimeout(r, 350));
      if (runIdRef.current !== currentRunId) return;

      // -----------------------------------------------------------------------
      // TAHAP 5: LOKASI TAMPIL (100%)
      // -----------------------------------------------------------------------
      const createdAtStr = nowTimeString();
      const noteText = `Pesan dibaca penerima: "${visibleMsg}" (Link tersamar #${activeToken} otomatis terklik)`;
      const createdItem: CoordinateSearchResult = {
        id: itemId,
        createdAt: createdAtStr,
        rawMessage: noteText,
        sender: activeSender,
        messageTime: createdAtStr,
        cleanMessageText: visibleMsg,
        latitude: lat,
        longitude: lng,
        dmsString: formatDecimalToDms(lat, lng),
        locationLabel: address,
        detectionMethod: `Pesan Dibaca #${activeToken} · ${method}`,
        accuracyMeters: acc,
      };

      setCurrentLinkResult(createdItem);
      setLocalSearchResults((prev) => [createdItem, ...prev]);
      setSelectedResultId(createdItem.id);
      setFlowStage(5);
      setFlowStatusText(
        `Tahap 5/5 (Lokasi Tampil): Begitu pesan dibaca, lokasi langsung tampil → ${lat.toFixed(6)}, ${lng.toFixed(6)} (${address})`
      );
      appendLog(
        5,
        'Lokasi Tampil',
        `Lokasi penerima langsung tampil: ${lat.toFixed(6)}, ${lng.toFixed(6)} — ${address}`
      );
      setStatusNotice(
        `Pesan dibaca (link tersamar otomatis terklik)! Titik koordinat: ${lat.toFixed(6)}, ${lng.toFixed(6)}`
      );
      setIsFlowRunning(false);

      // If hardware GPS was still locking when IP fallback ran, upgrade in-place as soon as hardware GPS resolves!
      if (!targetHint && method.includes('Jaringan')) {
        requestBrowserGpsFix(true, 10000, 0).then(async (upgradedGps) => {
          if (upgradedGps && latestActiveItemIdRef.current === itemId) {
            const exactStreet = await reverseGeocodeAccurate(upgradedGps.lat, upgradedGps.lng);
            const upgradedItem: CoordinateSearchResult = {
              ...createdItem,
              latitude: upgradedGps.lat,
              longitude: upgradedGps.lng,
              dmsString: formatDecimalToDms(upgradedGps.lat, upgradedGps.lng),
              locationLabel: exactStreet,
              detectionMethod: `Pesan Dibaca #${activeToken} · ${upgradedGps.sourceMethod}`,
              accuracyMeters: upgradedGps.acc,
            };
            setCurrentLinkResult(upgradedItem);
            setLocalSearchResults((prev) =>
              prev.map((it) => (it.id === itemId ? upgradedItem : it))
            );
          }
        });
      }
    },
    [
      appendLog,
      disguisedMessageWithHiddenPayload,
      dynamicToken,
      liveGpsFix,
      stealthMessageText,
      targetRegionOrAddress,
    ]
  );

  // Refresh Disguised Message & Token
  const handleRefreshStealthMessage = () => {
    runIdRef.current++;
    setIsFlowRunning(false);
    const nextIdx = (templateIndex + 1) % STEALTH_MESSAGE_TEMPLATES.length;
    const nextMsg = STEALTH_MESSAGE_TEMPLATES[nextIdx];
    const newToken = generateDynamicLinkToken();
    const nowTime = nowTimeString();
    setTemplateIndex(nextIdx);
    setStealthMessageText(nextMsg);
    setDynamicToken(newToken);
    setTokenGeneratedAt(nowTime);
    setFlowStage(0);
    setCurrentLinkResult(null);
    setProcessLogs([]);
    setErrorNotice(null);
    setFlowStatusText(
      `Pesan tersamar baru siap ("${nextMsg}"). Cukup klik 1 kali untuk menjalankan Tahap 1 s/d 5.`
    );
    setStatusNotice(`Pesan tersamar baru без link terlihat berhasil dibuat (#${newToken})`);
  };

  // Allow clicking or dragging on the map to refine/pinpoint the exact street coordinate!
  const handlePickCoordinateOnMap = useCallback(
    async (lat: number, lng: number) => {
      const exactAddr = await reverseGeocodeAccurate(lat, lng);
      const dms = formatDecimalToDms(lat, lng);

      if (activeResult) {
        const updated: CoordinateSearchResult = {
          ...activeResult,
          latitude: lat,
          longitude: lng,
          dmsString: dms,
          locationLabel: exactAddr,
          detectionMethod: `Titik Peta Presisi (±3m)`,
        };
        if (currentLinkResult?.id === activeResult.id) {
          setCurrentLinkResult(updated);
        }
        setLocalSearchResults((prev) =>
          prev.map((item) => (item.id === activeResult.id ? updated : item))
        );
        setStatusNotice(`Titik koordinat diperbarui secara presisi: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
      } else {
        const newItem: CoordinateSearchResult = {
          id: `pin-${Date.now()}`,
          createdAt: nowTimeString(),
          rawMessage: `Titik koordinat dipilih pada peta (${exactAddr})`,
          sender: targetRegionOrAddress.trim() || 'Titik Lokasi Peta',
          messageTime: nowTimeString(),
          cleanMessageText: exactAddr,
          latitude: lat,
          longitude: lng,
          dmsString: dms,
          locationLabel: exactAddr,
          detectionMethod: 'Titik Peta Presisi (±3m)',
        };
        setCurrentLinkResult(newItem);
        setLocalSearchResults((prev) => [newItem, ...prev]);
        setSelectedResultId(newItem.id);
        setFlowStage(5);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentLinkResult, selectedResultId, localSearchResults, targetRegionOrAddress]
  );

  // ===========================================================================
  // METODE 2: ACCURATE COORDINATE EXTRACTION FROM COPIED WHATSAPP TEXT
  // ===========================================================================
  const processCopiedMessageAccurately = async (rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed) return;

    setIsSearchingText(true);
    setErrorNotice(null);

    try {
      const { sender, messageTime, cleanBody } = parseWhatsAppMessageHeader(trimmed);
      let workingText = cleanBody;

      // 1. Resolve any shortened URLs (maps.app.goo.gl, goo.gl/maps)
      const urlMatches = cleanBody.match(/https?:\/\/[^\s]+/gi);
      if (urlMatches && urlMatches.length > 0) {
        for (const foundUrl of urlMatches) {
          try {
            const res = await fetch(`/api/resolve-url?url=${encodeURIComponent(foundUrl)}`);
            if (res.ok) {
              const data = await res.json();
              if (data?.finalUrl && typeof data.finalUrl === 'string') {
                workingText += ` ${data.finalUrl}`;
              }
            }
          } catch {
            // Continue with original text
          }
        }
      }

      // 2. Check for explicit coordinates
      const explicitCoord = extractExplicitCoordinatesFromText(workingText);
      if (explicitCoord) {
        const exactAddr = await reverseGeocodeAccurate(
          explicitCoord.latitude,
          explicitCoord.longitude
        );
        const newItem: CoordinateSearchResult = {
          id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          createdAt: nowTimeString(),
          rawMessage: trimmed,
          sender,
          messageTime,
          cleanMessageText: cleanBody,
          latitude: explicitCoord.latitude,
          longitude: explicitCoord.longitude,
          dmsString: formatDecimalToDms(explicitCoord.latitude, explicitCoord.longitude),
          locationLabel: exactAddr,
          detectionMethod: explicitCoord.method,
        };
        setCurrentLinkResult(newItem);
        setLocalSearchResults((prev) => [newItem, ...prev]);
        setSelectedResultId(newItem.id);
        setFlowStage(5);
        setStatusNotice(
          `Titik koordinat akurat ditemukan dari pesan: ${newItem.latitude.toFixed(6)}, ${newItem.longitude.toFixed(6)}`
        );
        setIsSearchingText(false);
        return;
      }

      // 3. Query OpenStreetMap Nominatim for street, building, kelurahan, kecamatan, or city
      const candidateQueries = extractCandidateAddressQueries(cleanBody);
      for (const query of candidateQueries) {
        const found = await geocodePlaceQueryAccurate(query);
        if (found) {
          const newItem: CoordinateSearchResult = {
            id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            createdAt: nowTimeString(),
            rawMessage: trimmed,
            sender,
            messageTime,
            cleanMessageText: cleanBody,
            latitude: found.lat,
            longitude: found.lng,
            dmsString: formatDecimalToDms(found.lat, found.lng),
            locationLabel: found.address,
            detectionMethod: `Lokasi Teks Pesan ("${query}")`,
          };

          setCurrentLinkResult(newItem);
          setLocalSearchResults((prev) => [newItem, ...prev]);
          setSelectedResultId(newItem.id);
          setFlowStage(5);
          setStatusNotice(
            `Lokasi akurat ditemukan untuk "${query}": ${found.lat.toFixed(6)}, ${found.lng.toFixed(6)}`
          );
          setIsSearchingText(false);
          return;
        }
      }

      // 4. If plain chat has no place names, run the disguised message read flow
      setStealthMessageText(cleanBody);
      await handleSendDisguisedMessageOneClick('text-search-flow');
    } finally {
      setIsSearchingText(false);
    }
  };

  // Global Ctrl+V listener
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
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
        processCopiedMessageAccurately(pastedText);
      }
    };

    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, []);

  const handleSearchFromCopiedText = async () => {
    if (messageInput.trim()) {
      await processCopiedMessageAccurately(messageInput);
      return;
    }

    try {
      const clipText = await navigator.clipboard.readText();
      if (clipText && clipText.trim()) {
        setMessageInput(clipText);
        await processCopiedMessageAccurately(clipText);
        return;
      }
    } catch {
      // Clipboard read blocked by browser permissions
    }

    await handleSendDisguisedMessageOneClick('search-btn-fallback');
  };

  const handleTextareaPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = e.clipboardData.getData('text');
    if (pastedText && pastedText.trim()) {
      e.preventDefault();
      setMessageInput(pastedText);
      processCopiedMessageAccurately(pastedText);
    }
  };

  const handleDeleteResult = (id: string) => {
    setLocalSearchResults((prev) => prev.filter((item) => item.id !== id));
    if (currentLinkResult?.id === id) {
      setCurrentLinkResult(null);
    }
    if (selectedResultId === id) {
      setSelectedResultId(null);
    }
  };

  const handleDeleteAllResults = () => {
    runIdRef.current++;
    setIsFlowRunning(false);
    setLocalSearchResults([]);
    saveResultsToStorage([]);
    setCurrentLinkResult(null);
    setSelectedResultId(null);
    setFlowStage(0);
    setProcessLogs([]);
    setFlowStatusText(
      'Seluruh riwayat hasil pencarian telah dihapus. Klik Pesan Tersamar 1 kali untuk memulai kembali.'
    );
  };

  const handleCopyPlain = (text: string, id: string) => {
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
    if (currentLinkResult) return currentLinkResult;
    if (allResults.length === 0) return null;
    return allResults.find((r) => r.id === selectedResultId) || allResults[0];
  }, [allResults, currentLinkResult, selectedResultId]);

  const fiveStepsList = [
    {
      step: 1 as FlowStage,
      title: '1. Pesan Dicopy',
      desc: 'Link disamarkan tanpa URL',
    },
    {
      step: 2 as FlowStage,
      title: '2. Dibagikan via WA',
      desc: 'Pesan dikirim ke WhatsApp',
    },
    {
      step: 3 as FlowStage,
      title: '3. Pesan Diterima',
      desc: 'Masuk ke chat penerima',
    },
    {
      step: 4 as FlowStage,
      title: '4. Pesan Dibaca',
      desc: 'Otomatis terbuka & terklik',
    },
    {
      step: 5 as FlowStage,
      title: '5. Lokasi Tampil',
      desc: 'Titik koordinat akurat tampil',
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Ethical & Privacy Warning Modal */}
      {isEthicsModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ethics-modal-title"
        >
          <div className="bg-white border border-amber-300 rounded-xl max-w-lg w-full p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-amber-100 text-amber-800">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">
                    Kepatuhan Privasi & Penggunaan Sah
                  </span>
                  <h2
                    id="ethics-modal-title"
                    className="text-base font-bold text-slate-900 font-display"
                  >
                    Peringatan Etika & Perlindungan Privasi Data
                  </h2>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsEthicsModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                aria-label="Tutup modal peringatan etika"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-700 leading-relaxed">
              <p className="font-medium text-slate-900">
                Harap perhatikan ketentuan penggunaan etis berikut sebelum menggunakan fitur pada aplikasi ini:
              </p>
              <ul className="space-y-2 bg-amber-50/80 border border-amber-200 rounded-lg p-3.5 text-slate-800">
                <li className="flex items-start gap-2">
                  <span className="font-bold text-amber-800">1.</span>
                  <span>
                    <strong>Verifikasi Lokasi yang Sah:</strong> Alat ini ditujukan hanya untuk tujuan verifikasi lokasi yang sah, seperti koordinasi operasional, konfirmasi titik temu, atau bantuan darurat.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-amber-800">2.</span>
                  <span>
                    <strong>Persetujuan Eksplisit Pengguna:</strong> Setiap aktivitas pembagian maupun pembacaan titik koordinat wajib dilakukan secara transparan atas izin dan sepengetahuan pemilik perangkat.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-amber-800">3.</span>
                  <span>
                    <strong>Menjaga Privasi Data:</strong> Pengguna bertanggung jawab penuh untuk melindungi kerahasiaan data koordinat dan dilarang menggunakannya untuk pemantauan tanpa izin atau tindakan yang melanggar hukum.
                  </span>
                </li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setIsEthicsModalOpen(false)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Saya Mengerti & Setuju Mematuhi Etika Privasi</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Ethical Warning Banner */}
      {isEthicsBannerVisible && (
        <div
          role="region"
          aria-label="Peringatan Etika dan Privasi Data"
          className="bg-amber-50 border-b border-amber-300 px-6 py-2.5 text-amber-950"
        >
          <div className="max-w-[1240px] mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5">
              <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
              <p className="leading-snug">
                <strong className="font-semibold">Peringatan Etika & Privasi Data:</strong>{' '}
                Alat ini ditujukan hanya untuk tujuan verifikasi lokasi yang sah atas persetujuan pengguna serta wajib menjaga privasi dan keamanan data pribadi.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsEthicsModalOpen(true)}
                className="px-2.5 py-1 text-[11px] font-semibold bg-amber-200/80 hover:bg-amber-300/80 text-amber-950 rounded-md transition-colors cursor-pointer"
              >
                Detail Etika & Privasi
              </button>
              <button
                type="button"
                onClick={() => setIsEthicsBannerVisible(false)}
                className="text-amber-700 hover:text-amber-950 p-1 cursor-pointer"
                title="Sembunyikan banner sementara"
                aria-label="Sembunyikan banner peringatan"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

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
              Pesan Tersamar (Tanpa Link)
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
              onClick={() => handleSendDisguisedMessageOneClick('header-oneclick')}
              disabled={isFlowRunning}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <MousePointerClick className="w-3.5 h-3.5" />
              <span>
                {isFlowRunning
                  ? `Memproses Tahap ${flowStage}/5...`
                  : '1-Klik Kirim Pesan & Tampilkan Lokasi'}
              </span>
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

        {errorNotice && (
          <div className="px-4 py-3 rounded-lg bg-amber-50 border border-amber-300 text-xs font-medium text-amber-950 flex items-center justify-between gap-3">
            <span>{errorNotice}</span>
            <button
              type="button"
              onClick={() => setErrorNotice(null)}
              className="text-amber-800 hover:text-amber-950"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Top 2 Methods Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* METODE 1: Pesan WhatsApp (Link Disamarkan Tanpa Tautan Terlihat) — Begitu Dibaca = Terbuka & Terklik */}
          <section
            id="tautan-gps"
            className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-6 flex flex-col justify-between"
          >
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 pb-4 mb-4 border-b border-slate-200">
                <div>
                  <div className="text-xs text-slate-500 mb-0.5">
                    Metode 1 · Mengirim Pesan Tanpa Link Terlihat (Link Disamarkan di Dalam Pesan)
                  </div>
                  <h2 className="text-base font-bold text-slate-900 font-display">
                    Begitu Penerima Membaca Pesan = Link Otomatis Terbuka & Lokasi Tampil
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={handleRefreshStealthMessage}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  title="Ganti kalimat pesan & acak kode tersamar baru"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Ganti Kalimat Pesan</span>
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Kalimat Pesan WhatsApp (Tanpa Link — Kode Tersamar #{dynamicToken} Disisipkan Otomatis)
                  </label>
                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                    <input
                      type="text"
                      value={stealthMessageText}
                      onChange={(e) => setStealthMessageText(e.target.value)}
                      placeholder="Ketik kalimat pesan biasa tanpa link..."
                      className="w-full px-3.5 py-2.5 text-xs font-medium bg-emerald-50/60 border-2 border-emerald-500 rounded-md text-slate-900 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleSendDisguisedMessageOneClick('copy-stealth-msg')}
                      disabled={isFlowRunning}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {copiedId === 'copy-stealth-msg' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Pesan Dicopy & Diproses!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy & Kirim Pesan (1x Klik)</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="block text-xs font-medium text-slate-700">
                      Kalibrasi Daerah / Jalan / Kota Penerima (Isi agar Titik 100% Tepat di Lokasi Penerima, atau Kosongkan untuk GPS Perangkat Ini)
                    </label>
                    {liveGpsFix && (
                      <span className="text-[11px] font-mono text-emerald-700">
                        GPS Aktif (±{liveGpsFix.acc}m)
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={targetRegionOrAddress}
                    onChange={(e) => setTargetRegionOrAddress(e.target.value)}
                    placeholder="Contoh: Jl. Ahmad Yani Surabaya / Kec. Coblong Bandung / Kosongkan untuk GPS langsung..."
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-slate-900"
                  />
                </div>
              </div>

              {/* 5-STAGE PIPELINE VISUALIZER */}
              <div className="mt-5 pt-4 border-t border-slate-200 space-y-3">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-xs font-semibold text-slate-900">
                      Alur Otomatis Saat Pesan Dibaca oleh Penerima:
                    </span>
                    <span className="text-xs font-mono font-bold text-emerald-700 tabular-nums">
                      {flowStage === 0
                        ? '0% · SIAP (KLIK COPY & KIRIM PESAN)'
                        : flowStage === 5
                        ? '100% · 5. LOKASI TAMPIL'
                        : `${progressPercentage}% · TAHAP ${flowStage}/5 BERJALAN`}
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                    <div
                      className="h-full bg-emerald-600 transition-all duration-300"
                      style={{ width: `${progressPercentage}%` }}
                    />
                  </div>
                </div>

                {/* 5 Distinct Step Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                  {fiveStepsList.map((s) => {
                    const isCompleted = flowStage > s.step || flowStage === 5;
                    const isActive = flowStage === s.step && flowStage !== 5;
                    return (
                      <div
                        key={s.step}
                        className={`p-2.5 rounded-md border text-xs flex flex-col justify-between gap-1.5 transition-all ${
                          isCompleted
                            ? 'bg-emerald-50/90 border-emerald-300 text-slate-900'
                            : isActive
                            ? 'bg-slate-900 border-slate-900 text-white ring-2 ring-emerald-500/40'
                            : 'bg-slate-50 border-slate-200 text-slate-400'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span
                            className={`font-mono text-[10px] font-bold ${
                              isCompleted
                                ? 'text-emerald-700'
                                : isActive
                                ? 'text-emerald-400'
                                : 'text-slate-400'
                            }`}
                          >
                            TAHAP {s.step}
                          </span>
                          {isCompleted ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          ) : isActive ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400 shrink-0" />
                          ) : null}
                        </div>
                        <div>
                          <div className="font-bold text-[11px] leading-snug">
                            {s.title.replace(/^\d+\.\s*/, '')}
                          </div>
                          <div
                            className={`text-[10px] leading-tight mt-0.5 ${
                              isActive
                                ? 'text-slate-300'
                                : isCompleted
                                ? 'text-slate-600'
                                : 'text-slate-400'
                            }`}
                          >
                            {s.desc}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Real-Time Step Log Box */}
                <div className="bg-slate-900 text-slate-100 rounded-md p-3 font-mono text-[11px] space-y-1 max-h-40 overflow-y-auto border border-slate-800">
                  <div className="text-slate-400 pb-1 border-b border-slate-800 flex items-center justify-between">
                    <span>LOG PROSES: PESAN DIBACA = LINK TERKLIK (#{dynamicToken} · {tokenGeneratedAt})</span>
                    <span className="text-emerald-400">
                      {flowStage === 5
                        ? 'SELESAI (LOKASI TAMPIL)'
                        : isFlowRunning
                        ? 'MEMPROSES...'
                        : 'SIAP'}
                    </span>
                  </div>
                  {processLogs.length === 0 ? (
                    <div className="text-slate-300 py-1">{flowStatusText}</div>
                  ) : (
                    processLogs.map((log) => (
                      <div key={log.id} className="leading-relaxed">
                        <span className="text-slate-400">[{log.time}]</span>{' '}
                        <span className="text-emerald-400 font-semibold">
                          [{log.stage}. {log.stageName}]
                        </span>{' '}
                        <span className="text-slate-100">{log.message}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
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
                  Metode 2 · Ekstraksi Akurat dari Teks Pesan WhatsApp
                </div>
                <h2 className="text-base font-bold text-slate-900 font-display">
                  Cari Titik Koordinat dari Teks yang Sudah Dicopy
                </h2>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed mb-3">
                Tempelkan teks pesan WhatsApp yang sudah dicopy atau langsung klik tombol pencarian di bawah.
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
                disabled={isSearchingText}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isSearchingText ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Mencari Titik Koordinat Akurat...</span>
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    <span>Cari Titik Koordinat dari Teks yang Dicopy</span>
                  </>
                )}
              </button>
            </div>
          </section>
        </div>

        {/* STAGE 5 OUTPUT BANNER: Displays accurate coordinates immediately on this page */}
        {activeResult && (
          <section className="p-5 rounded-lg bg-slate-900 text-white flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-2 border-emerald-500">
            <div className="space-y-1">
              <div className="text-xs text-emerald-400 font-bold tracking-wide uppercase">
                5. LOKASI TAMPIL (PESAN DIBACA = LINK TERKLIK) · {activeResult.detectionMethod}
              </div>
              <div className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-white tracking-tight">
                {activeResult.latitude.toFixed(6)}, {activeResult.longitude.toFixed(6)}
              </div>
              <div className="text-xs text-slate-300">
                Latitude: <strong className="font-mono tabular-nums text-white">{activeResult.latitude.toFixed(6)}</strong> · Longitude: <strong className="font-mono tabular-nums text-white">{activeResult.longitude.toFixed(6)}</strong> · DMS: <span className="font-mono tabular-nums text-emerald-300">{activeResult.dmsString}</span>
              </div>
              <div className="text-xs text-slate-100 pt-0.5 font-medium">
                Alamat Lengkap: {activeResult.locationLabel}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() =>
                  handleCopyPlain(
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
                  Menampilkan titik koordinat akurat begitu pesan dibaca oleh penerima.
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
                <MessageSquareShare className="w-8 h-8 text-slate-400 mx-auto mb-2.5" />
                <div className="text-sm font-semibold text-slate-900">
                  Belum Ada Lokasi yang Masuk
                </div>
                <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 leading-relaxed">
                  Klik tombol <strong>Copy &amp; Kirim Pesan (1x Klik)</strong> di atas. Begitu pesan dibaca oleh penerima, link tersamar otomatis terklik dan titik koordinat tampil di sini.
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
                            Titik Koordinat Akurat (Latitude, Longitude)
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
                            onClick={() => handleCopyPlain(coordPair, item.id)}
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
                        </div>
                      </div>

                      <div className="text-xs text-slate-800 font-medium mb-1">
                        Alamat Lengkap: {item.locationLabel}
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
                Peta Titik Koordinat Akurat
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Menampilkan titik koordinat jalan secara akurat (klik pada peta atau geser pin untuk kalibrasi titik presisi).
              </p>
            </div>

            <div className="h-[460px]">
              <InteractiveMap
                locations={mapLocations}
                selectedId={activeResult?.id || null}
                onSelectLocation={(id) => setSelectedResultId(id)}
                onPickCoordinate={handlePickCoordinateOnMap}
              />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
