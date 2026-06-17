self.addEventListener('install', function(event) {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);
  if (!url.pathname.startsWith('/__welme_pdf/')) return;

  event.respondWith(
    caches.open('welme-pdf-cache-v1').then(function(cache) {
      return cache.match(event.request).then(function(response) {
        if (response) return response;
        return new Response('PDF not found', {
          status: 404,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      });
    })
  );
});
