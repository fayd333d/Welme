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
        return cache.match(url.pathname).then(function(pathResponse) {
          if (pathResponse) return pathResponse;
          return cache.keys().then(function(keys) {
            for (var i = 0; i < keys.length; i++) {
              var keyUrl = new URL(keys[i].url);
              if (keyUrl.pathname === url.pathname) {
                return cache.match(keys[i]);
              }
            }
            return new Response('PDF not found', {
              status: 404,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
          });
        });
      });
    })
  );
});
