// Offline for the emulator.
//
// The cartridge and the saves already live on the device, in IndexedDB. What
// was missing was the app that reads them: with no connection the page itself
// never arrived, so a browser full of your saves showed you nothing.
//
// The one rule that shapes this: `bundle.js` and `gba-core.wasm` are two
// halves of one program and must never be cached out of step. A save state
// encodes the core's internal layout, so a new shell against an old core is
// not a cosmetic mismatch -- it is a state that will not load, or worse, one
// that loads wrong. So this precaches the whole shell in a single pass into a
// cache named for the build, and serves only ever from one cache. There is no
// per-file revalidation, because that is exactly how the halves drift apart.
//
// BUILD is substituted at build time with a hash of the files below, so a new
// deploy is a new service worker, a new cache, and one atomic swap. Nothing
// needs to be remembered to bump.
const BUILD = "__BUILD__";
const CACHE = `gba-${BUILD}`;

const SHELL = [
  "./",
  "./bundle.js",
  "./assets/gba-core.wasm",
  "./assets/manifest.webmanifest",
  "./assets/icon-180.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
];

self.addEventListener("install", (event) => {
  // No skipWaiting. A running game holds emulator state in memory, and
  // swapping the core out from under it mid-session is a worse failure than
  // waiting: the update lands on the next visit instead.
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // One pass, so every file in the cache came from the same deploy.
      cache.addAll(SHELL.map((path) => new Request(path, { cache: "reload" })))
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase and friends.

  // A navigation carries whatever query string the visit had -- `?link=local`,
  // a magic-link token -- and none of that changes which document to serve.
  const key = request.mode === "navigate" ? new Request("./") : request;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(key, { ignoreSearch: true });
      if (hit) return hit;
      try {
        return await fetch(request);
      } catch (error) {
        // Offline and not part of the shell. A navigation still gets the app,
        // which can then run entirely from IndexedDB.
        const shell = await cache.match("./");
        if (request.mode === "navigate" && shell) return shell;
        throw error;
      }
    })
  );
});
