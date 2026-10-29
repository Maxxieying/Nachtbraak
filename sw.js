// Service worker: ontvangt pushmeldingen en opent de app bij een tik.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Nachtbraak";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.id || "nachtbraak",
      renotify: true,
      requireInteraction: true,
      vibrate: [500, 200, 500, 200, 500, 200, 500],
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      data: { url: data.url || "./" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "./", self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.focus();
          if ("navigate" in c) c.navigate(target).catch(() => {});
          return;
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
