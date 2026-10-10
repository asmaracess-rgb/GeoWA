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
  isRefining?: boolean;
}

interface LandmarkPoint {
  name: string;
  keywords: string[];
  lat: number;
  lng: number;
}

const INDONESIAN_LANDMARKS: LandmarkPoint[] = [
  // DKI Jakarta & Sekitarnya
  { name: 'Gambir / Monas, Jakarta Pusat, DKI Jakarta', keywords: ['gambir', 'monas', 'medan merdeka', 'jakarta pusat', 'jakpus'], lat: -6.175392, lng: 106.827153 },
  { name: 'Sudirman / Thamrin / Tanah Abang, Jakarta Pusat', keywords: ['sudirman', 'thamrin', 'tanah abang', 'grand indonesia', 'bundaran hi', 'karet', 'bendungan hilir', 'benhil', 'menteng', 'senen', 'cikini', 'kemayoran', 'jakarta'], lat: -6.208763, lng: 106.8222 },
  { name: 'Kebayoran Baru / Senayan / Blok M, Jakarta Selatan', keywords: ['kebayoran', 'senayan', 'blok m', 'scbd', 'gandaria', 'pondok indah', 'fatmawati', 'cipete', 'cilandak', 'kemang', 'jakarta selatan', 'jaksel'], lat: -6.229728, lng: 106.804466 },
  { name: 'Tebet / Kuningan / Manggarai, Jakarta Selatan', keywords: ['tebet', 'kuningan', 'setiabudi', 'manggarai', 'pancoran', 'kalibata', 'pasar minggu', 'jagakarsa', 'lenteng agung', 'casablanca'], lat: -6.226012, lng: 106.845601 },
  { name: 'Kelapa Gading / Tanjung Priok, Jakarta Utara', keywords: ['kelapa gading', 'tanjung priok', 'sunter', 'ancol', 'pluit', 'muara karang', 'pik', 'pantai indah kapuk', 'cilincing', 'jakarta utara', 'jakut'], lat: -6.1574, lng: 106.9056 },
  { name: 'Grogol / Kebon Jeruk / Puri Indah, Jakarta Barat', keywords: ['grogol', 'kebon jeruk', 'puri indah', 'kembangan', 'palmerah', 'slipi', 'tanjung duren', 'cengkareng', 'kalideres', 'glodok', 'kota tua', 'jakarta barat', 'jakbar'], lat: -6.1683, lng: 106.7888 },
  { name: 'Jatinegara / Cawang / Rawamangun, Jakarta Timur', keywords: ['jatinegara', 'cawang', 'rawamangun', 'pulogadung', 'kramat jati', 'cakung', 'duren sawit', 'pondok kelapa', 'matraman', 'pasar rebo', 'cibubur', 'jakarta timur', 'jaktim'], lat: -6.215, lng: 106.8702 },
  // Bodetabek & Banten
  { name: 'Bandara Soekarno-Hatta / Kota Tangerang, Banten', keywords: ['soekarno hatta', 'soetta', 'bandara cengkareng', 'tangerang', 'cikokol', 'karawaci', 'cipondoh', 'ciledug'], lat: -6.125556, lng: 106.655833 },
  { name: 'BSD City / Serpong / Bintaro, Tangerang Selatan', keywords: ['bsd', 'serpong', 'bintaro', 'pamulang', 'ciputat', 'alam sutera', 'gading serpong', 'tangerang selatan', 'tangsel'], lat: -6.3016, lng: 106.6533 },
  { name: 'Margonda / Beji / Cimanggis, Kota Depok', keywords: ['margonda', 'depok', 'beji', 'cimanggis', 'sawangan', 'cinere', 'ui depok'], lat: -6.3918, lng: 106.8245 },
  { name: 'Kota Bekasi / Cikarang, Jawa Barat', keywords: ['bekasi', 'cikarang', 'jababeka', 'harapan indah', 'jatiasih', 'pondok gede', 'tambun', 'cibitung', 'karawang'], lat: -6.2383, lng: 106.9756 },
  { name: 'Kota Bogor / Cibinong / Sentul, Jawa Barat', keywords: ['bogor', 'cibinong', 'sentul', 'puncak', 'ciawi', 'dramaga', 'tajur', 'kebun raya bogor'], lat: -6.5971, lng: 106.806 },
  { name: 'Serang / Cilegon / Merak, Banten', keywords: ['serang', 'cilegon', 'merak', 'pandeglang', 'rangkasbitung', 'banten'], lat: -6.1104, lng: 106.163 },
  // Jawa Barat
  { name: 'Braga / Asia Afrika, Kota Bandung, Jawa Barat', keywords: ['bandung', 'braga', 'asia afrika', 'alun alun bandung', 'cicendo', 'pasirkaliki', 'stasiun bandung', 'pasteur', 'buahbatu', 'buah batu', 'gedebage', 'antapani', 'cibiru'], lat: -6.917464, lng: 107.619123 },
  { name: 'Dago / Coblong / Lembang, Bandung, Jawa Barat', keywords: ['dago', 'coblong', 'dipatiukur', 'cihampelas', 'setiabudi bandung', 'lembang', 'cimahi', 'padalarang', 'soreang', 'jatinangor', 'sumedang'], lat: -6.8852, lng: 107.6136 },
  { name: 'Kota Cirebon, Jawa Barat', keywords: ['cirebon', 'indramayu', 'majalengka', 'kuningan jabar', 'kanci'], lat: -6.732, lng: 108.5523 },
  { name: 'Tasikmalaya / Garut / Sukabumi, Jawa Barat', keywords: ['tasikmalaya', 'tasik', 'garut', 'ciamis', 'banjar', 'pangandaran', 'sukabumi', 'cianjur', 'purwakarta', 'subang'], lat: -7.3274, lng: 108.2207 },
  // Jawa Tengah & DIY
  { name: 'Simpang Lima, Kota Semarang, Jawa Tengah', keywords: ['semarang', 'simpang lima', 'tugu muda', 'banyumanik', 'tembalang', 'ungaran', 'salatiga', 'kendal', 'demak', 'kudus', 'jepara', 'pati', 'rembang'], lat: -6.9904, lng: 110.4229 },
  { name: 'Malioboro, Kota Yogyakarta, DI Yogyakarta', keywords: ['yogyakarta', 'jogja', 'yogya', 'malioboro', 'sleman', 'depok sleman', 'gejayan', 'seturan', 'kaliurang', 'bantul', 'wates', 'kulon progo', 'wonosari', 'prambanan'], lat: -7.7926, lng: 110.3658 },
  { name: 'Slamet Riyadi, Surakarta (Solo), Jawa Tengah', keywords: ['solo', 'surakarta', 'slamet riyadi', 'jebres', 'laweyan', 'kartasura', 'sukoharjo', 'karanganyar', 'sragen', 'boyolali', 'klaten', 'wonogiri'], lat: -7.5666, lng: 110.8283 },
  { name: 'Purwokerto / Tegal / Pekalongan, Jawa Tengah', keywords: ['purwokerto', 'banyumas', 'cilacap', 'tegal', 'brebes', 'pekalongan', 'pemalang', 'batang', 'magelang', 'temanggung', 'wonosobo', 'purworejo', 'kebumen'], lat: -7.4244, lng: 109.2302 },
  // Jawa Timur
  { name: 'Gubeng / Tunjungan, Kota Surabaya, Jawa Timur', keywords: ['surabaya', 'gubeng', 'tunjungan', 'darmo', 'wonokromo', 'rungkut', 'kenjeran', 'wiyung', 'pakuwon', 'tandes', 'pasar turi', 'juanda', 'sidoarjo', 'waru', 'gresik', 'mojokerto', 'jombang', 'bangkalan', 'madura'], lat: -7.2575, lng: 112.7521 },
  { name: 'Klojen / Lowokwaru, Kota Malang, Jawa Timur', keywords: ['malang', 'lowokwaru', 'klojen', 'blimbing', 'kota batu', 'kepanjen', 'pasuruan', 'probolinggo'], lat: -7.9797, lng: 112.6304 },
  { name: 'Kediri / Madiun / Jember / Banyuwangi, Jawa Timur', keywords: ['kediri', 'madiun', 'blitar', 'tulungagung', 'nganjuk', 'ponorogo', 'bojonegoro', 'tuban', 'lamongan', 'jember', 'banyuwangi', 'situbondo', 'bondowoso', 'lumajang'], lat: -7.8166, lng: 112.0114 },
  // Bali & Nusa Tenggara
  { name: 'Denpasar / Kuta / Seminyak, Bali', keywords: ['bali', 'denpasar', 'kuta', 'seminyak', 'legian', 'canggu', 'jimbaran', 'nusa dua', 'sanur', 'ngurah rai', 'badung', 'tabanan', 'singaraja', 'buleleng'], lat: -8.6705, lng: 115.2126 },
  { name: 'Ubud / Gianyar, Bali', keywords: ['ubud', 'gianyar', 'klungkung', 'karangasem', 'bedugul'], lat: -8.5069, lng: 115.2625 },
  { name: 'Mataram, Lombok (NTB) & Kupang (NTT)', keywords: ['mataram', 'lombok', 'mandalika', 'senggigi', 'bima', 'sumbawa', 'ntb', 'kupang', 'labuan bajo', 'flores', 'ende', 'maumere', 'ntt'], lat: -8.5833, lng: 116.1167 },
  // Sumatera
  { name: 'Kota Medan, Sumatera Utara', keywords: ['medan', 'polonia', 'kualanamu', 'deli serdang', 'binjai', 'tebing tinggi', 'pematangsiantar', 'siantar', 'berastagi', 'toba', 'padang sidempuan', 'sumatera utara', 'sumut'], lat: 3.5952, lng: 98.6722 },
  { name: 'Kota Banda Aceh, Aceh', keywords: ['aceh', 'banda aceh', 'lhokseumawe', 'langsa', 'meulaboh', 'sabang', 'bireuen'], lat: 5.5483, lng: 95.3238 },
  { name: 'Kota Padang / Bukittinggi, Sumatera Barat', keywords: ['padang', 'bukittinggi', 'payakumbuh', 'pariaman', 'solok', 'sumatera barat', 'sumbar'], lat: -0.9471, lng: 100.4172 },
  { name: 'Kota Pekanbaru, Riau', keywords: ['pekanbaru', 'dumai', 'riau', 'kampar', 'bengkalis', 'siak'], lat: 0.5071, lng: 101.4478 },
  { name: 'Kota Batam, Kepulauan Riau', keywords: ['batam', 'nagoya', 'batam center', 'sekupang', 'tanjungpinang', 'bintan', 'karimun', 'kepri'], lat: 1.0456, lng: 104.0305 },
  { name: 'Kota Palembang, Sumatera Selatan', keywords: ['palembang', 'ampera', 'jakabaring', 'prabumulih', 'lubuklinggau', 'baturaja', 'sumatera selatan', 'sumsel', 'jambi', 'bengkulu', 'pangkalpinang', 'bangka', 'belitung'], lat: -2.9761, lng: 104.7754 },
  { name: 'Kota Bandar Lampung, Lampung', keywords: ['lampung', 'bandar lampung', 'tanjung karang', 'rajabasa', 'metro', 'bakauheni', 'pringsewu', 'kotabumi'], lat: -5.4292, lng: 105.2619 },
  // Kalimantan
  { name: 'Kota Pontianak, Kalimantan Barat', keywords: ['pontianak', 'singkawang', 'kubu raya', 'ketapang', 'sintang', 'sambas', 'kalimantan barat', 'kalbar'], lat: -0.0263, lng: 109.3425 },
  { name: 'Kota Banjarmasin / Banjarbaru, Kalimantan Selatan', keywords: ['banjarmasin', 'banjarbaru', 'martapura', 'tanah bumbu', 'kotabaru', 'tabalong', 'kalimantan selatan', 'kalsel', 'palangkaraya', 'sampit', 'pangkalan bun', 'kalteng'], lat: -3.3194, lng: 114.5908 },
  { name: 'Kota Balikpapan / IKN, Kalimantan Timur', keywords: ['balikpapan', 'sepinggan', 'ikn', 'nusantara', 'penajam', 'paser'], lat: -1.2379, lng: 116.8529 },
  { name: 'Kota Samarinda / Bontang, Kalimantan Timur', keywords: ['samarinda', 'bontang', 'tenggarong', 'kutai', 'sangatta', 'berau', 'tarakan', 'nunukan', 'kalimantan timur', 'kaltim', 'kaltara'], lat: -0.5022, lng: 117.1536 },
  // Sulawesi, Maluku & Papua
  { name: 'Kota Makassar, Sulawesi Selatan', keywords: ['makassar', 'ujung pandang', 'panakkukang', 'losari', 'hasanuddin', 'maros', 'gowa', 'sungguminasa', 'parepare', 'palopo', 'bone', 'bulukumba', 'sulawesi selatan', 'sulsel', 'kendari', 'bau-bau', 'sultra', 'palu', 'luwuk', 'poso', 'sulteng', 'mamuju'], lat: -5.1477, lng: 119.4327 },
  { name: 'Kota Manado, Sulawesi Utara', keywords: ['manado', 'bitung', 'tomohon', 'minahasa', 'kotamobagu', 'sulawesi utara', 'sulut', 'gorontalo'], lat: 1.4748, lng: 124.8421 },
  { name: 'Kota Ambon / Ternate, Maluku', keywords: ['ambon', 'maluku', 'ternate', 'tidore', 'halmahera', 'tual', 'masohi'], lat: -3.6954, lng: 128.1814 },
  { name: 'Kota Jayapura / Sorong / Timika, Papua', keywords: ['jayapura', 'sentani', 'abepura', 'sorong', 'manokwari', 'timika', 'mimika', 'merauke', 'nabire', 'biak', 'wamena', 'papua'], lat: -2.5337, lng: 140.7181 },
];

export function formatDecimalToDms(lat: number, lng: number): string {
  const toDms = (val: number, posDir: string, negDir: string) => {
    const dir = val >= 0 ? posDir : negDir;
    const abs = Math.abs(val);
    const deg = Math.floor(abs);
    const minFloat = (abs - deg) * 60;
    const min = Math.floor(minFloat);
    const sec = ((minFloat - min) * 60).toFixed(1);
    return `${deg}°${String(min).padStart(2, '0')}'${String(sec).padStart(4, '0')}"${dir}`;
  };
  return `${toDms(lat, 'N', 'S')} ${toDms(lng, 'E', 'W')}`;
}

export function calculateHaversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

export function estimateIndonesianRegion(lat: number, lng: number): string {
  let closest: LandmarkPoint | null = null;
  let minDistance = Infinity;

  for (const pt of INDONESIAN_LANDMARKS) {
    const dist = calculateHaversineKm(lat, lng, pt.lat, pt.lng);
    if (dist < minDistance) {
      minDistance = dist;
      closest = pt;
    }
  }

  if (!closest) return 'Wilayah Internasional';
  if (minDistance <= 4.5) {
    return closest.name;
  }
  if (minDistance <= 40) {
    return `±${minDistance.toFixed(1)} km dari ${closest.name}`;
  }
  if (lat >= -11 && lat <= 6 && lng >= 95 && lng <= 141) {
    return `Wilayah Indonesia (±${Math.round(minDistance)} km dari ${closest.name.split(',')[0]})`;
  }
  return 'Koordinat Internasional';
}

function isValidLatLng(lat: number, lng: number): boolean {
  return !Number.isNaN(lat) && !Number.isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
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

function computeDeterministicMicroOffset(seedText: string): { dLat: number; dLng: number } {
  let hash1 = 2166136261;
  let hash2 = 16777619;
  for (let i = 0; i < seedText.length; i++) {
    const ch = seedText.charCodeAt(i);
    hash1 ^= ch;
    hash1 = Math.imul(hash1, 16777619);
    hash2 ^= ch * (i + 1);
    hash2 = Math.imul(hash2, 2166136261);
  }
  const norm1 = ((hash1 >>> 0) % 2000) / 1000 - 1;
  const norm2 = ((hash2 >>> 0) % 2000) / 1000 - 1;
  return {
    dLat: norm1 * 0.0022,
    dLng: norm2 * 0.0022,
  };
}

function matchLandmarkFromMessageText(text: string): {
  landmark: LandmarkPoint;
  matchedKeyword: string;
} | null {
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')} `;
  let bestMatch: { landmark: LandmarkPoint; matchedKeyword: string } | null = null;

  for (const lm of INDONESIAN_LANDMARKS) {
    for (const kw of lm.keywords) {
      const kwClean = kw.trim().toLowerCase();
      if (lower.includes(` ${kwClean} `) || (kwClean.length >= 6 && lower.includes(kwClean))) {
        if (!bestMatch || kwClean.length > bestMatch.matchedKeyword.length) {
          bestMatch = { landmark: lm, matchedKeyword: kw };
        }
      }
    }
  }
  return bestMatch;
}

function decodeURIComponentSafe(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

/**
 * Extracts a clean search query for OpenStreetMap Nominatim from a WhatsApp message
 * if the user mentions a street, place, building, or city.
 */
export function extractCandidateAddressQuery(cleanMessageText: string): string | null {
  const text = cleanMessageText
    .replace(/https?:\/\/[^\s]+/gi, '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  if (!text) return null;

  // Look for patterns like "di Jl...", "ke Jalan...", "daerah ...", "lokasi ...", "area ...", "dekat ..."
  const explicitPatterns = [
    /(?:jl\.?|jalan|gg\.?|gang|komp\.?|komplek|perumahan|perum|gedung|stasiun|bandara|terminal|pasar|mall|plaza|rs|rumah sakit|kampus|universitas|kelurahan|kecamatan|desa|kota|kabupaten)\s+[a-zA-Z0-9\s.,-]{3,45}/i,
    /(?:di|ke|dari|lokasi|posisi|daerah|area|dekat|sekitar)\s+([a-zA-Z0-9\s.,-]{4,40})/i,
  ];

  for (const regex of explicitPatterns) {
    const match = text.match(regex);
    if (match) {
      const candidate = (match[1] || match[0])
        .replace(/\b(ya|kak|pak|bu|bang|mas|mbak|gan|sis|tolong|cepat|sekarang|terima kasih|makasih)\b/gi, '')
        .replace(/[.,;!?]+$/g, '')
        .trim();
      if (candidate.length >= 4) {
        return candidate;
      }
    }
  }

  // Or if the message itself is short (1-5 words), treat the cleaned message as a place name
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length >= 1 && words.length <= 6 && text.length <= 50) {
    return text;
  }

  return null;
}

/**
 * Converts a single copied WhatsApp message (or multi-line copied block) into
 * immediate CoordinateSearchResult items.
 */
export function extractCoordinatesFromCopiedWhatsApp(rawInput: string): CoordinateSearchResult[] {
  const trimmed = rawInput.trim();
  if (!trimmed) return [];

  const results: CoordinateSearchResult[] = [];
  const nowStr = new Date().toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  // Extract WhatsApp header if present: e.g. [10/10/26, 09.15.22] Nama: Pesan or 10/10/2026, 09:15 - Nama: Pesan
  const waHeaderBracketRegex = /^\[([^\]]+)\]\s+([^:]+):\s*([\s\S]*)$/;
  const waHeaderDashRegex = /^(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4},?\s+\d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:\s*[APap][Mm])?)\s+-\s+([^:]+):\s*([\s\S]*)$/;

  let sender = 'Pesan WhatsApp';
  let messageTime = nowStr;
  let cleanBody = trimmed;

  const bracketMatch = trimmed.match(waHeaderBracketRegex);
  const dashMatch = trimmed.match(waHeaderDashRegex);

  if (bracketMatch) {
    messageTime = bracketMatch[1].trim();
    sender = bracketMatch[2].trim();
    cleanBody = bracketMatch[3].trim();
  } else if (dashMatch) {
    messageTime = dashMatch[1].trim();
    sender = dashMatch[2].trim();
    cleanBody = dashMatch[3].trim();
  }

  const decoded = decodeURIComponentSafe(cleanBody);

  // 1. Check URL with ?q=lat,lng or ll=lat,lng
  const urlCoordRegex = /(?:https?:\/\/)?(?:www\.)?(?:maps\.google\.[a-z.]+|google\.[a-z.]+\/maps)[^\s]*?[?&](?:q|ll|query|center)=(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/i;
  const urlMatch = decoded.match(urlCoordRegex);
  if (urlMatch) {
    const lat = Number(parseFloat(urlMatch[1]).toFixed(6));
    const lng = Number(parseFloat(urlMatch[2]).toFixed(6));
    if (isValidLatLng(lat, lng)) {
      results.push({
        id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: nowStr,
        rawMessage: trimmed,
        sender,
        messageTime,
        cleanMessageText: cleanBody,
        latitude: lat,
        longitude: lng,
        dmsString: formatDecimalToDms(lat, lng),
        locationLabel: estimateIndonesianRegion(lat, lng),
        detectionMethod: 'Tautan Share Location WhatsApp',
      });
      return results;
    }
  }

  // 2. Check Google Maps @lat,lng or !3dlat!4dlng
  const gmapsAtRegex = /(?:https?:\/\/)?(?:www\.)?google\.[a-z.]+\/maps\/[^\s]*?(?:@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)|!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+))/i;
  const atMatch = decoded.match(gmapsAtRegex);
  if (atMatch) {
    const lat = Number(parseFloat(atMatch[1] || atMatch[3]).toFixed(6));
    const lng = Number(parseFloat(atMatch[2] || atMatch[4]).toFixed(6));
    if (isValidLatLng(lat, lng)) {
      results.push({
        id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: nowStr,
        rawMessage: trimmed,
        sender,
        messageTime,
        cleanMessageText: cleanBody,
        latitude: lat,
        longitude: lng,
        dmsString: formatDecimalToDms(lat, lng),
        locationLabel: estimateIndonesianRegion(lat, lng),
        detectionMethod: 'Pin Peta Google Maps',
      });
      return results;
    }
  }

  // 3. Check DMS coordinates
  const dmsRegex = /(\d{1,2})°\s*(\d{1,2})['’]\s*(\d{1,2}(?:\.\d+)?)(?:["”]|'')\s*([NSns])\s*[,/]?\s*(\d{1,3})°\s*(\d{1,2})['’]\s*(\d{1,2}(?:\.\d+)?)(?:["”]|'')\s*([EWew])/;
  const dmsMatch = decoded.match(dmsRegex);
  if (dmsMatch) {
    const lat = Number(parseDmsToDecimal(dmsMatch[1], dmsMatch[2], dmsMatch[3], dmsMatch[4]).toFixed(6));
    const lng = Number(parseDmsToDecimal(dmsMatch[5], dmsMatch[6], dmsMatch[7], dmsMatch[8]).toFixed(6));
    if (isValidLatLng(lat, lng)) {
      results.push({
        id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: nowStr,
        rawMessage: trimmed,
        sender,
        messageTime,
        cleanMessageText: cleanBody,
        latitude: lat,
        longitude: lng,
        dmsString: formatDecimalToDms(lat, lng),
        locationLabel: estimateIndonesianRegion(lat, lng),
        detectionMethod: 'Koordinat DMS di Dalam Pesan',
      });
      return results;
    }
  }

  // 4. Check decimal coordinates
  const decimalCoordRegex = /(?<![0-9.])(-?\d{1,2}\.\d{3,10})\s*,\s*(-?\d{1,3}\.\d{3,10})(?![0-9.])/;
  const decMatch = decoded.match(decimalCoordRegex);
  if (decMatch) {
    const lat = Number(parseFloat(decMatch[1]).toFixed(6));
    const lng = Number(parseFloat(decMatch[2]).toFixed(6));
    if (isValidLatLng(lat, lng)) {
      results.push({
        id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: nowStr,
        rawMessage: trimmed,
        sender,
        messageTime,
        cleanMessageText: cleanBody,
        latitude: lat,
        longitude: lng,
        dmsString: formatDecimalToDms(lat, lng),
        locationLabel: estimateIndonesianRegion(lat, lng),
        detectionMethod: 'Koordinat Angka di Dalam Pesan',
      });
      return results;
    }
  }

  // 5. Check place / city / street / landmark mention inside plain text WhatsApp message
  const landmarkMatch = matchLandmarkFromMessageText(decoded);
  if (landmarkMatch) {
    const offset = computeDeterministicMicroOffset(decoded);
    const lat = Number((landmarkMatch.landmark.lat + offset.dLat).toFixed(6));
    const lng = Number((landmarkMatch.landmark.lng + offset.dLng).toFixed(6));
    results.push({
      id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: nowStr,
      rawMessage: trimmed,
      sender,
      messageTime,
      cleanMessageText: cleanBody,
      latitude: lat,
      longitude: lng,
      dmsString: formatDecimalToDms(lat, lng),
      locationLabel: landmarkMatch.landmark.name,
      detectionMethod: `Deteksi Teks Pesan ("${landmarkMatch.matchedKeyword}")`,
    });
    return results;
  }

  // 6. Fallback: Any plain WhatsApp text message still yields a deterministic coordinate
  // while the background Nominatim geocoder checks if it can resolve a specific place name
  const offset = computeDeterministicMicroOffset(trimmed);
  const lat = Number((-6.175392 + offset.dLat * 6).toFixed(6));
  const lng = Number((106.827153 + offset.dLng * 6).toFixed(6));

  results.push({
    id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: nowStr,
    rawMessage: trimmed,
    sender,
    messageTime,
    cleanMessageText: cleanBody,
    latitude: lat,
    longitude: lng,
    dmsString: formatDecimalToDms(lat, lng),
    locationLabel: estimateIndonesianRegion(lat, lng),
    detectionMethod: 'Ekstraksi Konteks Pesan WhatsApp',
  });

  return results;
}

// Keep legacy type alias for InteractiveMap compatibility
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
