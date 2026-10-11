export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const targetUrl = req.query?.url || req.body?.url;
  if (!targetUrl || typeof targetUrl !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  const endpoints = [
    `https://da.gd/s?url=${encodeURIComponent(targetUrl)}`,
    `https://tinyurl.com/api-create.php?url=${encodeURIComponent(targetUrl)}`,
  ];

  for (const ep of endpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const response = await fetch(ep, { signal: controller.signal });
      clearTimeout(timer);
      if (response.ok) {
        const text = (await response.text()).trim();
        if (text.startsWith('http://') || text.startsWith('https://')) {
          return res.status(200).json({ shortUrl: text });
        }
      }
    } catch {
      // Try next shortener provider
    }
  }

  return res.status(200).json({ shortUrl: targetUrl });
}
