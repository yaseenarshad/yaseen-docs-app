const LEGACY_HOSTNAME = "draw.yasinarshad.com";

const retirementScript = `
const canonicalize = (href) => {
  const target = new URL(href);
  target.hostname = "draw.yaseenarshad.com";
  const legacyBoardMatch = target.pathname.match(/^\\/d\\/([^/]+)\\/?$/);
  if (legacyBoardMatch) {
    target.pathname = \`/b/\${legacyBoardMatch[1]}\`;
  }
  return target.toString();
};

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const windows = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    await Promise.all(
      windows.map((client) =>
        client.navigate(canonicalize(client.url)).catch(() => undefined),
      ),
    );
    await self.registration.unregister();
  })());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    Promise.resolve(Response.redirect(canonicalize(event.request.url), 308)),
  );
});
`;

export const getLegacyServiceWorkerResponse = (url: URL) => {
  if (url.hostname !== LEGACY_HOSTNAME || url.pathname !== "/sw.js") {
    return null;
  }

  return new Response(retirementScript, {
    status: 200,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Content-Type": "text/javascript; charset=utf-8",
      "Service-Worker-Allowed": "/",
    },
  });
};
