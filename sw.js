const CACHE_NAME = 'ganttobra-v3';
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './xlsx.mini.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

// Offline fallback HTML (inline, no extra file needed)
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GanttObra — Sin conexión</title>
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:2rem}
.box{max-width:400px}h1{margin:0 0 .5rem;font-size:1.5rem}p{color:#94a3b8;margin:0 0 1.5rem}
.btn{background:#2563eb;color:#fff;padding:.6rem 1.2rem;border-radius:2px;text-decoration:none;display:inline-block;font-weight:600}</style></head>
<body><div class="box"><h1>Sin conexión a internet</h1><p>GanttObra funciona offline, pero la sincronización colaborativa requiere red. Intenta de nuevo en unos segundos.</p><a href="./" class="btn">Reintentar</a></div></body></html>`;

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // 1) Google Apps Script API (colaborativo) → network-first, fallback offline JSON
  if (url.hostname.includes('script.google.com')) {
    e.respondWith(
      fetch(request).then((resp) => {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then((c) => c.put(request, clone));
        return resp;
      }).catch(() => {
        return caches.match(request).then((cached) => {
          if (cached) return cached;
          // If it's a POST (sync) and offline, return a queued message
          if (request.method === 'POST') {
            return new Response(
              JSON.stringify({ status: 'offline', message: 'Cola de sincronización: se enviará al reconectar.' }),
              { headers: { 'Content-Type': 'application/json' } }
            );
          }
          return new Response(
            JSON.stringify({ status: 'offline', data: { projects: [], settings: {} }, lastMod: 0 }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        });
      })
    );
    return;
  }

  // 2) Navigation requests (HTML pages) → stale-while-revalidate, fallback offline page
  if (request.mode === 'navigate') {
    e.respondWith(
      caches.match('./').then((cached) => {
        const fetchPromise = fetch(request).then((resp) => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((c) => c.put('./', clone));
          }
          return resp;
        }).catch(() => {
          return cached || new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html' } });
        });
        return cached ? fetchPromise.then(() => cached) : fetchPromise;
      })
    );
    return;
  }

  // 3) Static assets (JS, CSS, JSON, images) → cache-first, network fallback, then cache update
  e.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request).then((resp) => {
        if (resp.ok && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, clone));
        }
        return resp;
      }).catch(() => {
        return cached;
      });
      return cached || fetchPromise;
    })
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
