/* ==========================================================================
   Service Worker — Nova PWA (offline-first for the static showcase)
   ==========================================================================
   Strategie: Cache-first for core assets, network-first for JSON data with a
   stale-while-revalidate fallback so the gallery always opens offline.
   ========================================================================== */
const CACHE_NAME = 'nova-cache-v33';
/* مُحسَّن: أُزيلت Playfair Display (غير مستخدمة) والأوزان 800/900 — يوفّر
   ~5 ملفات خط لكل زائر. يجب أن يطابق هذا الرابط ما في index.html و admin.html. */
const FONTS_URL = 'https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700&family=Oswald:wght@300;400;500;600;700&family=Space+Grotesk:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap';

/* أصول النواة — تُخزَّن مسبقاً عند التثبيت ليعمل الموقع بلا إنترنت.
   ⚠️ ملاحظتان مهمّتان للإنتاج:
   1) لا تُضِف `cdn.tailwindcss.com` — المشروع لا يستخدم Tailwind إطلاقاً
      (styles.css مكتوب يدوياً)، وإضافته تُنزّل ~400KB بلا فائدة لكل زائر.
   2) admin.html **مستثنى عمداً** من التخزين المسبق: هو صفحة محمية بكلمة مرور
      في الإنتاج، ولا داعي لأن ينزّلها كل زائر عادي. يبقى يعمل بلا إنترنت
      للأدمن بعد أول زيارة عبر التخزين التلقائي وقت الطلب (أدناه). */
const CORE_ASSETS = [
  '.',
  'index.html',
  'styles.css',
  'db.js',
  'app.js',
  'manifest.json',
  /* الصفحات القانونية + 404: تُخزَّن مسبقاً لأنها قد تُطلب بلا إنترنت،
     ولا تعتمد على بيانات JSON إطلاقاً (نص ثابت). */
  'privacy.html',
  'terms.html',
  '404.html',
  'assets/logo.svg',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-maskable-512.png',
  'data/products.json',
  'data/settings.json',
  'data/wallets.json',
  'data/suggestions.json',
  'https://cdn.jsdelivr.net/npm/qrious@4.0.2/dist/qrious.min.js',
  FONTS_URL
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // فشل أصل واحد (CDN مثلاً) لا يُسقط التثبيت كله
      await Promise.allSettled(CORE_ASSETS.map((asset) => cache.add(asset)));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => key !== CACHE_NAME && caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isData = url.pathname.startsWith('/data/') || url.pathname.endsWith('.json');
  const isCore = event.request.mode === 'navigate'
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('.js')
    || url.pathname.endsWith('.css');

  // البيانات والصفحات والسكربتات: الشبكة أولاً + تحديث الكاش — الكاش احتياطاً عند الانقطاع فقط.
  // هذا يضمن رؤية أحدث نسخة دائماً عند الاتصال (بلا حاجة لتحديثين متتاليين).
  if (isData || isCore) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // الباقي (خطوط وصور CDN): كاش أولاً مع تحديث خلفي
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // Fire a background refresh so the cache stays fresh
        event.waitUntil(
          fetch(event.request)
            .then((response) => {
              if (response && response.ok) {
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
              }
              return response;
            })
            .catch(() => cached)
        );
        return cached;
      }
      return fetch(event.request);
    })
  );
});
