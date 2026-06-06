const CACHE = 'alaqai-v1';
const STATIC = ['./', './index.html', './menu.json', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Изображения — cache-first
  if (url.pathname.match(/\.(webp|png|jpg|jpeg)$/)) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        }).catch(() => new Response('', { status: 404 }));
      })
    );
    return;
  }

  // menu.json — network-first с fallback
  if (url.pathname.endsWith('menu.json')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Остальное — stale-while-revalidate
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fresh = fetch(e.request).then(res => {
        caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      });
      return cached || fresh;
    })
  );
});

// Аналитика через Background Sync (если поддерживается)
self.addEventListener('sync', e => {
  if (e.tag === 'track-views') {
    e.waitUntil(flushAnalytics());
  }
});

async function flushAnalytics() {
  try {
    const db = await openDB();
    const events = await getAllEvents(db);
    if (!events.length) return;
    await fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(events)
    });
    await clearEvents(db);
  } catch (e) {
    // Попробуем в следующий раз
  }
}

function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('alaqai-analytics', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('events', { autoIncrement: true });
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function getAllEvents(db) {
  return new Promise((res, rej) => {
    const tx = db.transaction('events', 'readonly');
    const req = tx.objectStore('events').getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function clearEvents(db) {
  return new Promise((res, rej) => {
    const tx = db.transaction('events', 'readwrite');
    const req = tx.objectStore('events').clear();
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}
