/* NeuroTrend background worker — keep scan alive when tab hidden / after refresh */
const TAG = "neurotrend-bg";
let loopId = 0;
let intervalMs = 15000;
let running = false;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "START") {
    intervalMs = Math.max(15000, Number(data.intervalMs) || 15000);
    running = true;
    void startLoop();
    void showAlive();
  }
  if (data.type === "STOP") {
    running = false;
    loopId += 1;
    void clearNotifs();
  }
  if (data.type === "PING") {
    event.source?.postMessage?.({ type: "PONG", running });
  }
});

self.addEventListener("periodicsync", (event) => {
  if (event.tag === "neurotrend-scan") {
    event.waitUntil(pingClients());
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
      return undefined;
    }),
  );
});

async function startLoop() {
  const my = ++loopId;
  const tick = async () => {
    if (!running || my !== loopId) return;
    await pingClients();
    if (running && my === loopId) {
      setTimeout(() => void tick(), intervalMs);
    }
  };
  setTimeout(() => void tick(), 400);
}

async function pingClients() {
  const list = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  for (const c of list) {
    c.postMessage({ type: "NT_TICK", at: Date.now() });
  }
  if (list.length === 0 && running) {
    await showAlive("Tab tertutup. Buka NeuroTrend supaya scan lanjut.");
  }
}

async function showAlive(body) {
  try {
    await self.registration.showNotification("NeuroTrend AI", {
      body: body || "Bot jalan di latar belakang",
      tag: TAG,
      silent: true,
      icon: "/favicon.svg",
      badge: "/favicon.svg",
      data: { url: "/" },
    });
  } catch {
    /* notification optional */
  }
}

async function clearNotifs() {
  try {
    const all = await self.registration.getNotifications({ tag: TAG });
    all.forEach((n) => n.close());
  } catch {
    /* ignore */
  }
}
