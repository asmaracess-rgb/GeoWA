export interface CoordinateSearchResult {
  id: string;
  createdAt: string;
  rawMessage: string;
  sender: string;
  messageTime: string;
  cleanMessageText: string;
  latitude: number;
  longitude: number;
  dmsString: string;
  locationLabel: string;
  detectionMethod: string;
  accuracyMeters?: number | null;
  isRefining?: boolean;
}

export interface ExtractedLocation {
  id: string;
  index: number;
  sender: string;
  timestamp: string;
  latitude: number;
  longitude: number;
  sourceType: string;
  rawSnippet: string;
  note: string;
  estimatedRegion: string;
  resolvedAddress?: string;
  distanceFromPrevKm: number | null;
  bearingFromPrev: string | null;
}

export function formatDecimalToDms(lat: number, lng: number): string {
  const toDms = (val: number, posDir: string, negDir: string) => {
    const dir = val >= 0 ? posDir : negDir;
    const abs = Math.abs(val);
    const deg = Math.floor(abs);
    const minFloat = (abs - deg) * 60;
    const min = Math.floor(minFloat);
    const sec = ((minFloat - min) * 60).toFixed(2);
    return `${deg}°${String(min).padStart(2, '0')}'${String(sec).padStart(5, '0')}"${dir}`;
  };
  return `${toDms(lat, 'N', 'S')} ${toDms(lng, 'E', 'W')}`;
}

export function calculateHaversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function isValidLatLng(lat: number, lng: number): boolean {
  return (
    !Number.isNaN(lat) &&
    !Number.isNaN(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

function parseDmsToDecimal(deg: string, min: string, sec: string, dir: string): number {
  const d = parseFloat(deg);
  const m = parseFloat(min);
  const s = parseFloat(sec);
  let decimal = d + m / 60 + s / 3600;
  const upperDir = dir.toUpperCase();
  if (upperDir === 'S' || upperDir === 'W') {
    decimal = -decimal;
  }
  return decimal;
}

function decodeURIComponentSafe(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

/**
 * Extracts explicit coordinates (Google Maps URLs, WhatsApp location links, DMS, or Decimal lat,lng)
 * from any string or resolved URL.
 */
export function extractExplicitCoordinatesFromText(rawText: string): {
  latitude: number;
  longitude: number;
  method: string;
} | null {
  const decoded = decodeURIComponentSafe(rawText);

  // 1. Check URL with ?q=lat,lng or ll=lat,lng or query=lat,lng or center=lat,lng or daddr=lat,lng
  const urlCoordRegex =
    /[?&](?:q|ll|query|center|daddr|saddr|loc)=(?:loc:)?(-?\d{1,2}\.\d{3,12})\s*[,+]\s*(-?\d{1,3}\.\d{3,12})/i;
  const urlMatch = decoded.match(urlCoordRegex);
  if (urlMatch) {
    const lat = Number(parseFloat(urlMatch[1]).toFixed(6));
    const lng = Number(parseFloat(urlMatch[2]).toFixed(6));
    if (isValidLatLng(lat, lng)) {
      return {
        latitude: lat,
        longitude: lng,
        method: 'Tautan Share Location WhatsApp / Google Maps',
      };
    }
  }

  // 2. Check Google Maps !3d<lat>!4d<lng> (exact pin coordinate in Google Maps URLs)
  const bangCoordRegex = /!3d(-?\d{1,2}\.\d{3,12})!4d(-?\d{1,3}\.\d{3,12})/i;
  const bangMatch = decoded.match(bangCoordRegex);
  if (bangMatch) {
    const lat = Number(parseFloat(bangMatch[1]).toFixed(6));
    const lng = Number(parseFloat(bangMatch[2]).toFixed(6));
    if (isValidLatLng(lat, lng)) {
      return {
        latitude: lat,
        longitude: lng,
        method: 'Pin Titik Akurat Google Maps (!3d/!4d)',
      };
    }
  }

  // 3. Check Google Maps /@lat,lng or /place/lat,lng or /search/lat,lng
  const atCoordRegex =
    /(?:@|\/place\/|\/search\/|\/dir\/\/)(-?\d{1,2}\.\d{3,12})\s*,\s*(-?\d{1,3}\.\d{3,12})/i;
  const atMatch = decoded.match(atCoordRegex);
  if (atMatch) {
    const lat = Number(parseFloat(atMatch[1]).toFixed(6));
    const lng = Number(parseFloat(atMatch[2]).toFixed(6));
    if (isValidLatLng(lat, lng)) {
      return {
        latitude: lat,
        longitude: lng,
        method: 'Koordinat URL Peta (@lat,lng)',
      };
    }
  }

  // 4. Check DMS coordinates (e.g. 6°12'31.5"S 106°50'44.2"E)
  const dmsRegex =
    /(\d{1,2})°\s*(\d{1,2})['’]\s*(\d{1,2}(?:\.\d+)?)(?:["”]|'')\s*([NSns])\s*[,/\s]?\s*(\d{1,3})°\s*(\d{1,2})['’]\s*(\d{1,2}(?:\.\d+)?)(?:["”]|'')\s*([EWew])/;
  const dmsMatch = decoded.match(dmsRegex);
  if (dmsMatch) {
    const lat = Number(
      parseDmsToDecimal(dmsMatch[1], dmsMatch[2], dmsMatch[3], dmsMatch[4]).toFixed(6)
    );
    const lng = Number(
      parseDmsToDecimal(dmsMatch[5], dmsMatch[6], dmsMatch[7], dmsMatch[8]).toFixed(6)
    );
    if (isValidLatLng(lat, lng)) {
      return {
        latitude: lat,
        longitude: lng,
        method: 'Koordinat DMS di Dalam Pesan',
      };
    }
  }

  // 5. Check raw decimal coordinates (e.g. -6.208763, 106.845599)
  const decimalCoordRegex =
    /(?<![0-9.])(-?\d{1,2}\.\d{3,12})\s*,\s*(-?\d{1,3}\.\d{3,12})(?![0-9.])/;
  const decMatch = decoded.match(decimalCoordRegex);
  if (decMatch) {
    const lat = Number(parseFloat(decMatch[1]).toFixed(6));
    const lng = Number(parseFloat(decMatch[2]).toFixed(6));
    if (isValidLatLng(lat, lng)) {
      return {
        latitude: lat,
        longitude: lng,
        method: 'Koordinat Desimal di Dalam Pesan',
      };
    }
  }

  return null;
}

/**
 * Strips WhatsApp timestamp and sender headers from a copied message
 */
export function parseWhatsAppMessageHeader(rawInput: string): {
  sender: string;
  messageTime: string;
  cleanBody: string;
} {
  const trimmed = rawInput.trim();
  const nowStr = new Date().toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const waHeaderBracketRegex = /^\[([^\]]+)\]\s+([^:]+):\s*([\s\S]*)$/;
  const waHeaderDashRegex =
    /^(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4},?\s+\d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:\s*[APap][Mm])?)\s+-\s+([^:]+):\s*([\s\S]*)$/;

  const bracketMatch = trimmed.match(waHeaderBracketRegex);
  if (bracketMatch) {
    return {
      messageTime: bracketMatch[1].trim(),
      sender: bracketMatch[2].trim(),
      cleanBody: bracketMatch[3].trim(),
    };
  }

  const dashMatch = trimmed.match(waHeaderDashRegex);
  if (dashMatch) {
    return {
      messageTime: dashMatch[1].trim(),
      sender: dashMatch[2].trim(),
      cleanBody: dashMatch[3].trim(),
    };
  }

  return {
    sender: 'Pesan WhatsApp',
    messageTime: nowStr,
    cleanBody: trimmed,
  };
}

/**
 * Extracts a list of candidate search queries from a WhatsApp message to query OpenStreetMap Nominatim.
 */
export function extractCandidateAddressQueries(cleanMessageText: string): string[] {
  const withoutUrls = cleanMessageText
    .replace(/https?:\/\/[^\s]+/gi, ' ')
    .replace(/[\r\n]+/g, ' ')
    .trim();

  if (!withoutUrls) return [];

  const candidates: string[] = [];

  // Pattern 1: Explicit street / building / regional prefixes
  const prefixRegex =
    /((?:jl\.?|jalan|gg\.?|gang|komp\.?|komplek|perumahan|perum|gedung|stasiun|bandara|terminal|pasar|mall|plaza|rs|rumah sakit|kampus|universitas|hotel|apartemen|kantor|masjid|gereja|sekolah|sman|smpn|sdn|kelurahan|kel\.|kecamatan|kec\.|desa|ds\.|kota|kabupaten|kab\.|alun-alun|simpang|bundaran|tol)\s+[a-zA-Z0-9\s.,/-]{3,65})/gi;

  let m: RegExpExecArray | null;
  while ((m = prefixRegex.exec(withoutUrls)) !== null) {
    const cleaned = m[1]
      .replace(
        /\b(aku|saya|gue|gw|kami|kita|lagi|sedang|udah|sudah|baru|mau|akan|sampai|nyampe|tiba|tolong|jemput|antar|kirim|ya|kak|pak|bu|bang|mas|mbak|gan|sis|sekarang|disini|di sini|terima kasih|makasih)\b/gi,
        ' '
      )
      .replace(/\s+/g, ' ')
      .replace(/[.,;!?]+$/g, '')
      .trim();
    if (cleaned.length >= 3) {
      candidates.push(cleaned);
    }
  }

  // Pattern 2: Preposition phrases ("di ...", "ke ...", "dari ...", "daerah ...", "dekat ...", "posisi ...", "lokasi ...")
  const prepRegex =
    /(?:di|ke|dari|lokasi|posisi|daerah|area|dekat|sekitar|cabang|arah)\s+([a-zA-Z0-9\s.,/-]{3,55})/gi;
  while ((m = prepRegex.exec(withoutUrls)) !== null) {
    const cleaned = m[1]
      .replace(
        /\b(aku|saya|gue|gw|kami|kita|lagi|sedang|udah|sudah|baru|mau|akan|sampai|nyampe|tiba|tolong|jemput|antar|kirim|ya|kak|pak|bu|bang|mas|mbak|gan|sis|sekarang|disini|di sini|terima kasih|makasih)\b/gi,
        ' '
      )
      .replace(/\s+/g, ' ')
      .replace(/[.,;!?]+$/g, '')
      .trim();
    if (cleaned.length >= 3) {
      candidates.push(cleaned);
    }
  }

  // Pattern 3: Cleaned full message stripped of conversational Indonesian words
  const strippedConversational = withoutUrls
    .replace(
      /\b(halo|hai|assalamualaikum|permisi|pak|bu|kak|bang|mas|mbak|gan|sis|aku|saya|gue|gw|kami|kita|kamu|anda|lagi|sedang|udah|sudah|baru|mau|akan|sampai|nyampe|tiba|ada|di|ke|dari|tolong|jemput|antar|kirim|paket|pesanan|orderan|lokasi|posisi|shareloc|share|loc|ya|nih|dong|deh|sih|sekarang|disini|di sini|terima kasih|makasih|oke|ok|siap)\b/gi,
      ' '
    )
    .replace(/[.,;!?()"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (strippedConversational.length >= 3 && strippedConversational.length <= 80) {
    candidates.push(strippedConversational);
  }

  // Also add the raw cleaned message if reasonably short
  if (withoutUrls.length >= 3 && withoutUrls.length <= 70) {
    candidates.push(withoutUrls);
  }

  return Array.from(new Set(candidates));
}
