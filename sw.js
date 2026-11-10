// 오프라인용 서비스 워커
// - 온라인: 항상 서버에 최신인지 확인하고 받음 (GitHub Pages의 10분 브라우저 캐시를 쓰지 않음)
// - 오프라인: 저장해 둔 파일 사용
// 앱 파일을 바꿔서 올릴 때는 CACHE 버전 숫자를 올려 주세요.
const CACHE = 'haru-v11';
const ASSETS = [
  './', './index.html', './css/styles.css', './manifest.webmanifest',
  './js/app.js', './js/store.js', './js/dates.js', './js/parser.js', './js/colors.js', './js/recurrence.js', './js/ai.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // cache: 'reload' → 브라우저에 남은 이전 파일이 아니라 서버에서 새로 받아서 저장
      .then((c) => c.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 인터넷이 약할 때: 이 시간 안에 서버 응답이 없으면 저장해 둔 파일로 먼저 열기
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  const network = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(async (res) => {
    if (res.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(req, res.clone());
    }
    return res;
  });
  // 저장본으로 먼저 열었더라도 서버 응답은 끝까지 받아서 다음 실행 때 쓰도록 저장
  e.waitUntil(network.catch(() => {}));

  const fromCache = () => caches.match(req, { ignoreSearch: true })
    .then((r) => r || (req.mode === 'navigate' ? caches.match('./index.html') : undefined));

  e.respondWith(new Promise((resolve) => {
    let settled = false;
    const finish = (res) => {
      if (settled || !res) return false;
      settled = true;
      resolve(res);
      return true;
    };
    const timer = setTimeout(() => { fromCache().then(finish); }, NETWORK_TIMEOUT_MS);
    network
      .then((res) => { clearTimeout(timer); finish(res); })
      .catch(async () => {
        clearTimeout(timer);
        if (!finish(await fromCache())) finish(Response.error());
      });
  }));
});
