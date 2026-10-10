export interface LinkSecurityReport {
  inputUrl: string;
  hostname: string;
  protocol: string;
  riskLevel: 'Aman (Resmi)' | 'Perlu Waspada (Shortener/Redirect)' | 'Risiko Tinggi (Pelacak IP / Phishing)';
  category: string;
  summary: string;
  findings: string[];
  queryParameters: Array<{ key: string; value: string; note: string }>;
}

const OFFICIAL_MAP_DOMAINS = [
  'maps.google.com',
  'www.google.com',
  'google.com',
  'maps.app.goo.gl',
  'goo.gl',
  'waze.com',
  'www.waze.com',
  'openstreetmap.org',
  'www.openstreetmap.org',
];

const KNOWN_IP_LOGGERS = [
  'grabify.link',
  'iplogger.org',
  'iplogger.com',
  'iplogger.ru',
  '2no.co',
  'yip.su',
  'blasze.com',
  'blasze.tk',
  'ps3cfw.com',
  'bmwforum.co',
  'leancoding.co',
  'spottyfly.com',
  'stopify.co',
  'freegiftcards.co',
  'joinmy.site',
  'curiouscat.club',
  'catsnthings.fun',
];

const URL_SHORTENERS = [
  'bit.ly',
  's.id',
  'tinyurl.com',
  'cutt.ly',
  'shorturl.at',
  'rebrand.ly',
  'is.gd',
  'v.gd',
  't.co',
  'ow.ly',
  'tiny.cc',
  'rb.gy',
];

export function analyzeWhatsAppLinkSecurity(rawText: string): LinkSecurityReport {
  const trimmed = rawText.trim();
  // Extract first URL if user pasted a full WhatsApp message
  const urlMatch = trimmed.match(/https?:\/\/[^\s"'<>]+/i);
  const candidate = urlMatch ? urlMatch[0] : trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    const host = parsed.hostname.toLowerCase();
    const pathAndQuery = (parsed.pathname + parsed.search).toLowerCase();
    const findings: string[] = [];
    const queryParameters: Array<{ key: string; value: string; note: string }> = [];

    parsed.searchParams.forEach((value, key) => {
      let note = 'Parameter standar URL';
      const lowerKey = key.toLowerCase();
      if (lowerKey === 'q' || lowerKey === 'll' || lowerKey === 'query' || lowerKey === 'center') {
        note = 'Parameter titik koordinat atau kueri peta';
      } else if (['lat', 'lon', 'lng', 'latitude', 'longitude', 'coords'].includes(lowerKey)) {
        note = 'Parameter koordinat geografis eksplisit';
      } else if (['redirect', 'url', 'next', 'target', 'dest', 'goto'].includes(lowerKey)) {
        note = 'Parameter pengalihan (Open Redirect) — dapat mengarahkan ke situs pihak ketiga';
      } else if (['token', 'id', 'uid', 'session', 'ref', 'trk'].includes(lowerKey)) {
        note = 'Parameter identifikasi unik penerima tautan';
      }
      queryParameters.push({ key, value, note });
    });

    // 1. Check for dangerous APK / Executable disguises common on WhatsApp in Indonesia
    if (/\.(apk|dex|scr|exe|bat|msi)(\?|$)/i.test(pathAndQuery)) {
      findings.push('Tautan mengarah langsung ke file instalasi aplikasi (.APK / Executable).');
      findings.push('Modus penipuan WhatsApp (seperti "Undangan Pernikahan.apk" atau "Lihat Foto Paket Kurir.apk") menggunakan file .apk untuk mencuri SMS OTP dan akses lokasi perangkat.');
      return {
        inputUrl: candidate,
        hostname: host,
        protocol: parsed.protocol.replace(':', '').toUpperCase(),
        riskLevel: 'Risiko Tinggi (Pelacak IP / Phishing)',
        category: 'File Berbahaya (.APK / Malware)',
        summary: 'Tautan ini mengunduh file aplikasi eksternal yang berisiko menyadap perangkat dan lokasi Anda.',
        findings,
        queryParameters,
      };
    }

    // 2. Check known IP Loggers / Tracking links
    const matchedLogger = KNOWN_IP_LOGGERS.find((d) => host === d || host.endsWith(`.${d}`));
    if (matchedLogger) {
      findings.push(`Domain "${host}" terdaftar dalam daftar layanan IP Grabber / Pelacak Lokasi Terselubung (${matchedLogger}).`);
      findings.push('Saat dibuka di browser, situs ini mencatat alamat IP publik, jenis perangkat, ISP, dan terkadang meminta izin pop-up GPS browser tanpa sepengetahuan korban.');
      return {
        inputUrl: candidate,
        hostname: host,
        protocol: parsed.protocol.replace(':', '').toUpperCase(),
        riskLevel: 'Risiko Tinggi (Pelacak IP / Phishing)',
        category: 'Layanan IP Logger / Pelacak Terselubung',
        summary: 'Jangan buka tautan ini! Tautan ini dirancang untuk merekam alamat IP dan lokasi jaringan penerima pesan.',
        findings,
        queryParameters,
      };
    }

    // 3. Check raw IP hostname
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
      findings.push(`Tautan menggunakan alamat IP mentah (${host}) alih-alih nama domain resmi.`);
      findings.push('Server tanpa nama domain sering digunakan untuk server pelacak sementara atau halaman phishing.');
      return {
        inputUrl: candidate,
        hostname: host,
        protocol: parsed.protocol.replace(':', '').toUpperCase(),
        riskLevel: 'Risiko Tinggi (Pelacak IP / Phishing)',
        category: 'Server Alamat IP Langsung',
        summary: 'Tautan mengarah ke alamat IP langsung yang tidak terverifikasi.',
        findings,
        queryParameters,
      };
    }

    // 4. Check Official Maps domains
    const isOfficialMap = OFFICIAL_MAP_DOMAINS.some(
      (d) => host === d || (d === 'google.com' && host.endsWith('.google.com') && parsed.pathname.startsWith('/maps'))
    );
    if (isOfficialMap) {
      findings.push(`Domain "${host}" merupakan layanan pemetaan resmi (Google Maps / Waze / OpenStreetMap).`);
      if (parsed.protocol === 'https:') {
        findings.push('Koneksi terenkripsi HTTPS aktif.');
      }
      if (host === 'maps.app.goo.gl' || (host === 'goo.gl' && parsed.pathname.startsWith('/maps'))) {
        findings.push('Ini adalah tautan pendek resmi Google Maps. Membuka tautan ini aman dan tidak mengirimkan lokasi Anda kepada pengirim pesan.');
      } else {
        findings.push('Membuka tautan lokasi Google Maps milik orang lain hanya menampilkan peta di perangkat Anda, bukan membagikan lokasi Anda ke pengirim.');
      }
      return {
        inputUrl: candidate,
        hostname: host,
        protocol: parsed.protocol.replace(':', '').toUpperCase(),
        riskLevel: 'Aman (Resmi)',
        category: 'Tautan Peta & Navigasi Resmi',
        summary: 'Tautan mengarah ke layanan peta resmi dan aman untuk dibuka.',
        findings,
        queryParameters,
      };
    }

    // 5. Check URL Shorteners
    const matchedShortener = URL_SHORTENERS.find((d) => host === d || host.endsWith(`.${d}`));
    if (matchedShortener) {
      findings.push(`Domain "${host}" adalah layanan pemendek tautan (URL Shortener).`);
      findings.push('Pemendek tautan menyembunyikan alamat tujuan asli. Penyerang terkadang membungkus tautan IP Logger atau halaman tiruan di balik shortener.');
      findings.push('Pastikan Anda mengenal pengirim pesan sebelum mengklik, atau periksa tujuan pengalihan tanpa mengizinkan akses pop-up Lokasi (Geolocation) di browser.');
      return {
        inputUrl: candidate,
        hostname: host,
        protocol: parsed.protocol.replace(':', '').toUpperCase(),
        riskLevel: 'Perlu Waspada (Shortener/Redirect)',
        category: 'Pemendek Tautan (URL Shortener)',
        summary: 'Tujuan akhir tautan disembunyikan oleh layanan pemendek URL. Jangan izinkan akses GPS browser jika diminta.',
        findings,
        queryParameters,
      };
    }

    // 6. Check HTTP non-secure or suspicious keywords
    if (parsed.protocol !== 'https:') {
      findings.push('Tautan menggunakan protokol HTTP tanpa enkripsi TLS/SSL.');
    }
    if (queryParameters.some((q) => q.note.includes('Open Redirect'))) {
      findings.push('Terdapat parameter pengalihan URL (redirect) yang dapat membelokkan halaman ke situs lain.');
    }

    findings.push(`Domain "${host}" adalah situs web eksternal di luar WhatsApp dan Google Maps.`);
    findings.push('Catatan Privasi: Situs web apa pun yang Anda buka di browser dapat melihat alamat IP publik jaringan Anda, namun TIDAK dapat mengetahui koordinat GPS presisi Anda kecuali Anda menekan tombol "Allow / Izinkan Lokasi" di browser.');

    return {
      inputUrl: candidate,
      hostname: host,
      protocol: parsed.protocol.replace(':', '').toUpperCase(),
      riskLevel: parsed.protocol !== 'https:' ? 'Perlu Waspada (Shortener/Redirect)' : 'Perlu Waspada (Shortener/Redirect)',
      category: 'Tautan Web Eksternal',
      summary: 'Situs web pihak ketiga. Jangan pernah menekan "Izinkan Lokasi" (Allow Location) pada situs yang tidak Anda percayai.',
      findings,
      queryParameters,
    };
  } catch {
    return {
      inputUrl: rawText,
      hostname: 'Format URL Tidak Valid',
      protocol: '-',
      riskLevel: 'Perlu Waspada (Shortener/Redirect)',
      category: 'Format Tidak Dikenali',
      summary: 'Masukkan URL lengkap (contoh: https://maps.google.com/?q=-6.2088,106.8456 atau tautan dari chat WhatsApp).',
      findings: ['Teks yang dimasukkan belum berupa format URL yang valid.'],
      queryParameters: [],
    };
  }
}
