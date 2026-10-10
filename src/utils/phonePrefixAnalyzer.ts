export interface PhonePrefixAnalysis {
  rawInput: string;
  normalizedE164: string;
  localFormat: string;
  isValidLength: boolean;
  countryName: string;
  countryCode: string;
  numberType: 'Seluler (Mobile)' | 'Telepon Tetap / Kode Area (PSTN)' | 'Internasional Non-Indonesia' | 'Tidak Dikenali';
  operatorOrRegion: string;
  productLine: string;
  mapCenter: { lat: number; lng: number; label: string };
  waMeLink: string;
  technicalNotes: string[];
}

interface AreaCodeEntry {
  prefix: string;
  region: string;
  province: string;
  lat: number;
  lng: number;
}

const INDONESIAN_AREA_CODES: AreaCodeEntry[] = [
  { prefix: '021', region: 'DKI Jakarta, Tangerang, Bekasi, Depok', province: 'Jabodetabek', lat: -6.2088, lng: 106.8456 },
  { prefix: '022', region: 'Kota Bandung, Cimahi, Kabupaten Bandung', province: 'Jawa Barat', lat: -6.9175, lng: 107.6191 },
  { prefix: '0231', region: 'Kota & Kabupaten Cirebon', province: 'Jawa Barat', lat: -6.7320, lng: 108.5523 },
  { prefix: '024', region: 'Kota Semarang, Ungaran, Demak', province: 'Jawa Tengah', lat: -6.9904, lng: 110.4229 },
  { prefix: '0251', region: 'Kota & Kabupaten Bogor', province: 'Jawa Barat', lat: -6.5971, lng: 106.8060 },
  { prefix: '0254', region: 'Serang & Cilegon', province: 'Banten', lat: -6.1104, lng: 106.1630 },
  { prefix: '0271', region: 'Surakarta (Solo), Sukoharjo, Karanganyar', province: 'Jawa Tengah', lat: -7.5666, lng: 110.8283 },
  { prefix: '0274', region: 'DI Yogyakarta, Sleman, Bantul', province: 'DI Yogyakarta', lat: -7.7926, lng: 110.3658 },
  { prefix: '0281', region: 'Purwokerto, Banyumas', province: 'Jawa Tengah', lat: -7.4244, lng: 109.2302 },
  { prefix: '031', region: 'Kota Surabaya, Gresik, Sidoarjo', province: 'Jawa Timur', lat: -7.2575, lng: 112.7521 },
  { prefix: '0341', region: 'Kota Malang, Batu', province: 'Jawa Timur', lat: -7.9797, lng: 112.6304 },
  { prefix: '0351', region: 'Madiun, Magetan, Ngawi', province: 'Jawa Timur', lat: -7.6298, lng: 111.5239 },
  { prefix: '0361', region: 'Denpasar, Badung (Kuta/Nusa Dua), Gianyar', province: 'Bali', lat: -8.6705, lng: 115.2126 },
  { prefix: '0370', region: 'Mataram, Lombok', province: 'Nusa Tenggara Barat', lat: -8.5833, lng: 116.1167 },
  { prefix: '0411', region: 'Kota Makassar, Maros, Gowa', province: 'Sulawesi Selatan', lat: -5.1477, lng: 119.4327 },
  { prefix: '0431', region: 'Kota Manado, Tomohon, Minahasa', province: 'Sulawesi Utara', lat: 1.4748, lng: 124.8421 },
  { prefix: '0511', region: 'Banjarmasin, Banjarbaru', province: 'Kalimantan Selatan', lat: -3.3194, lng: 114.5908 },
  { prefix: '0541', region: 'Samarinda, Tenggarong', province: 'Kalimantan Timur', lat: -0.5022, lng: 117.1536 },
  { prefix: '0542', region: 'Kota Balikpapan', province: 'Kalimantan Timur', lat: -1.2379, lng: 116.8529 },
  { prefix: '0561', region: 'Kota Pontianak', province: 'Kalimantan Barat', lat: -0.0263, lng: 109.3425 },
  { prefix: '061', region: 'Kota Medan, Deli Serdang, Binjai', province: 'Sumatera Utara', lat: 3.5952, lng: 98.6722 },
  { prefix: '0651', region: 'Banda Aceh, Aceh Besar', province: 'Aceh', lat: 5.5483, lng: 95.3238 },
  { prefix: '0711', region: 'Kota Palembang', province: 'Sumatera Selatan', lat: -2.9761, lng: 104.7754 },
  { prefix: '0721', region: 'Kota Bandar Lampung', province: 'Lampung', lat: -5.4292, lng: 105.2619 },
  { prefix: '0751', region: 'Kota Padang', province: 'Sumatera Barat', lat: -0.9471, lng: 100.4172 },
  { prefix: '0761', region: 'Kota Pekanbaru', province: 'Riau', lat: 0.5071, lng: 101.4478 },
  { prefix: '0778', region: 'Kota Batam', province: 'Kepulauan Riau', lat: 1.0456, lng: 104.0305 },
  { prefix: '0911', region: 'Kota Ambon', province: 'Maluku', lat: -3.6954, lng: 128.1814 },
  { prefix: '0967', region: 'Kota Jayapura', province: 'Papua', lat: -2.5337, lng: 140.7181 },
];

const MOBILE_PREFIXES: Array<{
  prefixes: string[];
  operator: string;
  product: string;
}> = [
  {
    prefixes: ['0811'],
    operator: 'Telkomsel',
    product: 'KartuHalo (Pascabayar)',
  },
  {
    prefixes: ['0812', '0813', '0821', '0822'],
    operator: 'Telkomsel',
    product: 'Telkomsel PraBayar (Simpati / Kartu Loop)',
  },
  {
    prefixes: ['0823', '0852', '0853'],
    operator: 'Telkomsel',
    product: 'Telkomsel PraBayar (Kartu AS)',
  },
  {
    prefixes: ['0851'],
    operator: 'Telkomsel',
    product: 'by.U (Digital) / Kartu AS',
  },
  {
    prefixes: ['0814', '0815', '0816', '0855', '0856', '0857', '0858'],
    operator: 'Indosat Ooredoo Hutchison',
    product: 'IM3 / Matrix / Mentari',
  },
  {
    prefixes: ['0895', '0896', '0897', '0898', '0899'],
    operator: 'Indosat Ooredoo Hutchison',
    product: 'Tri (3) Indonesia',
  },
  {
    prefixes: ['0817', '0818', '0819', '0859', '0877', '0878'],
    operator: 'XL Axiata',
    product: 'XL Prabayar / XL Prioritas / LIVE.ON',
  },
  {
    prefixes: ['0831', '0832', '0833', '0838'],
    operator: 'XL Axiata',
    product: 'AXIS',
  },
  {
    prefixes: ['0881', '0882', '0883', '0884', '0885', '0886', '0887', '0888', '0889'],
    operator: 'Smartfren',
    product: 'Smartfren 4G/5G',
  },
];

const INTERNATIONAL_CODES: Array<{
  code: string;
  country: string;
  lat: number;
  lng: number;
  capital: string;
}> = [
  { code: '60', country: 'Malaysia', lat: 3.1390, lng: 101.6869, capital: 'Kuala Lumpur, Malaysia' },
  { code: '65', country: 'Singapura', lat: 1.3521, lng: 103.8198, capital: 'Singapura' },
  { code: '66', country: 'Thailand', lat: 13.7563, lng: 100.5018, capital: 'Bangkok, Thailand' },
  { code: '63', country: 'Filipina', lat: 14.5995, lng: 120.9842, capital: 'Manila, Filipina' },
  { code: '61', country: 'Australia', lat: -33.8688, lng: 151.2093, capital: 'Sydney, Australia' },
  { code: '81', country: 'Jepang', lat: 35.6762, lng: 139.6503, capital: 'Tokyo, Jepang' },
  { code: '82', country: 'Korea Selatan', lat: 37.5665, lng: 126.9780, capital: 'Seoul, Korea Selatan' },
  { code: '86', country: 'Tiongkok', lat: 39.9042, lng: 116.4074, capital: 'Beijing, Tiongkok' },
  { code: '852', country: 'Hong Kong', lat: 22.3193, lng: 114.1694, capital: 'Hong Kong' },
  { code: '886', country: 'Taiwan', lat: 25.0330, lng: 121.5654, capital: 'Taipei, Taiwan' },
  { code: '966', country: 'Arab Saudi', lat: 24.7136, lng: 46.6753, capital: 'Riyadh, Arab Saudi' },
  { code: '971', country: 'Uni Emirat Arab', lat: 25.2048, lng: 55.2708, capital: 'Dubai / Abu Dhabi, UEA' },
  { code: '91', country: 'India', lat: 28.6139, lng: 77.2090, capital: 'New Delhi, India' },
  { code: '44', country: 'Inggris (UK)', lat: 51.5072, lng: -0.1276, capital: 'London, Inggris' },
  { code: '49', country: 'Jerman', lat: 52.5200, lng: 13.4050, capital: 'Berlin, Jerman' },
  { code: '31', country: 'Belanda', lat: 52.3676, lng: 4.9041, capital: 'Amsterdam, Belanda' },
  { code: '1', country: 'Amerika Serikat / Kanada', lat: 38.9072, lng: -77.0369, capital: 'Amerika Utara (NANP +1)' },
];

export function analyzePhoneNumber(input: string): PhonePrefixAnalysis {
  const digitsOnly = input.replace(/[^\d+]/g, '');
  const strippedDigits = digitsOnly.replace(/^\+/, '');

  if (!strippedDigits || strippedDigits.length < 5) {
    return {
      rawInput: input,
      normalizedE164: '-',
      localFormat: '-',
      isValidLength: false,
      countryName: 'Belum Lengkap',
      countryCode: '-',
      numberType: 'Tidak Dikenali',
      operatorOrRegion: 'Masukkan minimal 7 digit nomor telepon',
      productLine: '-',
      mapCenter: { lat: -6.2088, lng: 106.8456, label: 'Jakarta, Indonesia' },
      waMeLink: '',
      technicalNotes: [
        'Masukkan nomor WhatsApp dengan format 08xx, +628xx, 021xx, atau kode negara internasional.',
      ],
    };
  }

  let isIndonesia = false;
  let localFormat = strippedDigits;
  let e164 = `+${strippedDigits}`;

  if (strippedDigits.startsWith('62')) {
    isIndonesia = true;
    localFormat = '0' + strippedDigits.slice(2);
    e164 = '+' + strippedDigits;
  } else if (strippedDigits.startsWith('0')) {
    isIndonesia = true;
    localFormat = strippedDigits;
    e164 = '+62' + strippedDigits.slice(1);
  } else if (strippedDigits.startsWith('8') && strippedDigits.length >= 9 && strippedDigits.length <= 13) {
    isIndonesia = true;
    localFormat = '0' + strippedDigits;
    e164 = '+62' + strippedDigits;
  }

  const cleanWaDigits = e164.replace(/^\+/, '');
  const isValidLength = cleanWaDigits.length >= 9 && cleanWaDigits.length <= 15;

  if (isIndonesia) {
    // 1. Check Mobile Number (08xx)
    if (localFormat.startsWith('08')) {
      const prefix4 = localFormat.slice(0, 4);
      const matchedOp = MOBILE_PREFIXES.find((item) => item.prefixes.includes(prefix4));

      return {
        rawInput: input,
        normalizedE164: e164,
        localFormat,
        isValidLength,
        countryName: 'Indonesia',
        countryCode: '+62',
        numberType: 'Seluler (Mobile)',
        operatorOrRegion: matchedOp ? matchedOp.operator : `Operator Seluler Indonesia (Prefix ${prefix4})`,
        productLine: matchedOp ? matchedOp.product : 'Layanan Seluler GSM/LTE Nasional',
        mapCenter: {
          lat: -6.2088,
          lng: 106.8456,
          label: 'Jaringan Seluler Nasional Indonesia (Pusat Registrasi Jakarta)',
        },
        waMeLink: `https://wa.me/${cleanWaDigits}`,
        technicalNotes: [
          `Prefix ${prefix4} menunjukkan alokasi kartu milik operator ${matchedOp ? matchedOp.operator : 'Seluler Indonesia'} (${matchedOp ? matchedOp.product : 'Nasional'}).`,
          'Nomor seluler (08xx) bersifat bergerak (mobile) di seluruh wilayah Indonesia; posisi GPS real-time pemilik nomor TIDAK dapat dilacak hanya dari digit nomor telepon.',
          'Untuk mengetahui titik koordinat presisi pemilik nomor di WhatsApp, pengguna harus mengirimkan Share Location / Live Location atau berinteraksi dengan WhatsApp Business Webhook.',
        ],
      };
    }

    // 2. Check Fixed Line / Area Code (02x - 09x)
    const sortedAreas = [...INDONESIAN_AREA_CODES].sort((a, b) => b.prefix.length - a.prefix.length);
    const matchedArea = sortedAreas.find((a) => localFormat.startsWith(a.prefix));

    if (matchedArea) {
      return {
        rawInput: input,
        normalizedE164: e164,
        localFormat,
        isValidLength,
        countryName: 'Indonesia',
        countryCode: '+62',
        numberType: 'Telepon Tetap / Kode Area (PSTN)',
        operatorOrRegion: `${matchedArea.region} (${matchedArea.province})`,
        productLine: `Kode Area Telepon Tetap (${matchedArea.prefix}) — Sering digunakan akun WhatsApp Bisnis`,
        mapCenter: {
          lat: matchedArea.lat,
          lng: matchedArea.lng,
          label: `${matchedArea.region}, ${matchedArea.province}`,
        },
        waMeLink: `https://wa.me/${cleanWaDigits}`,
        technicalNotes: [
          `Kode area ${matchedArea.prefix} terdaftar secara geografis di wilayah ${matchedArea.region} (${matchedArea.province}).`,
          'Akun WhatsApp Business dapat didaftarkan menggunakan nomor telepon tetap kantor/toko sehingga kode area ini mencerminkan kota operasional bisnis tersebut.',
        ],
      };
    }
  }

  // 3. Check International Country Code
  const sortedIntl = [...INTERNATIONAL_CODES].sort((a, b) => b.code.length - a.code.length);
  const matchedIntl = sortedIntl.find((item) => strippedDigits.startsWith(item.code));

  if (matchedIntl) {
    return {
      rawInput: input,
      normalizedE164: `+${strippedDigits}`,
      localFormat: `+${strippedDigits}`,
      isValidLength,
      countryName: matchedIntl.country,
      countryCode: `+${matchedIntl.code}`,
      numberType: 'Internasional Non-Indonesia',
      operatorOrRegion: `Yurisdiksi Telekomunikasi ${matchedIntl.country}`,
      productLine: `Nomor Internasional (+${matchedIntl.code})`,
      mapCenter: {
        lat: matchedIntl.lat,
        lng: matchedIntl.lng,
        label: matchedIntl.capital,
      },
      waMeLink: `https://wa.me/${strippedDigits}`,
      technicalNotes: [
        `Nomor ini menggunakan kode negara internasional +${matchedIntl.code} (${matchedIntl.country}).`,
        'Waspadai apabila nomor internasional tidak dikenal menghubungi Anda melalui WhatsApp dengan modus tawaran kerja paruh waktu atau tautan mencurigakan.',
      ],
    };
  }

  return {
    rawInput: input,
    normalizedE164: e164,
    localFormat,
    isValidLength,
    countryName: isIndonesia ? 'Indonesia' : 'Internasional / Lainnya',
    countryCode: isIndonesia ? '+62' : `+${strippedDigits.slice(0, 2)}`,
    numberType: 'Tidak Dikenali',
    operatorOrRegion: 'Kode prefix belum terdaftar dalam basis data lokal',
    productLine: 'Nomor Telepon Standar E.164',
    mapCenter: { lat: -6.2088, lng: 106.8456, label: 'Indonesia' },
    waMeLink: `https://wa.me/${cleanWaDigits}`,
    technicalNotes: [
      'Pastikan nomor diawali dengan kode negara (+62) atau prefix 08xx / kode area lokal.',
    ],
  };
}
