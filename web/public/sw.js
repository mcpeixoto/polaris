/**
 * Shows a push and opens the issue it names.
 *
 * No `fetch` handler, on purpose. A service worker that listens for fetch becomes the
 * network for every request the page makes, and this one has nothing to say about
 * caching. It exists so a phone can buzz.
 *
 * The payload is whatever the worker's push sender wrote: title, body, url, tag.
 */

self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Polaris' };
  }
  var title = data.title || 'Polaris';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag,
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var path = (event.notification.data && event.notification.data.url) || '/';
  var target = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var client = list[i];
        if (client.url.indexOf(self.location.origin) !== 0) continue;
        if (typeof client.navigate === 'function') {
          return client.navigate(target).then(function (next) {
            return (next || client).focus();
          });
        }
        return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    }),
  );
});
