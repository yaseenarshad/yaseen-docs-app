import { describe, expect, it, vi } from "vitest";

import { getLegacyServiceWorkerResponse } from "./legacyServiceWorker";

describe("legacy-origin service worker retirement", () => {
  it("serves a no-store same-origin worker only on the legacy sw.js URL", async () => {
    const response = getLegacyServiceWorkerResponse(
      new URL("https://draw.yasinarshad.com/sw.js"),
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("Content-Type")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(response?.headers.get("Cache-Control")).toBe(
      "no-store, no-cache, must-revalidate",
    );
    expect(response?.headers.get("Service-Worker-Allowed")).toBe("/");
    expect(await response?.text()).toContain("draw.yaseenarshad.com");

    expect(
      getLegacyServiceWorkerResponse(
        new URL("https://draw.yaseenarshad.com/sw.js"),
      ),
    ).toBeNull();
    expect(
      getLegacyServiceWorkerResponse(
        new URL("https://draw.yasinarshad.com/assets/app.js"),
      ),
    ).toBeNull();
  });

  it("activates immediately, moves every legacy client in one hop, and unregisters", async () => {
    const script = await getLegacyServiceWorkerResponse(
      new URL("https://draw.yasinarshad.com/sw.js"),
    )!.text();
    const listeners = new Map<string, (event: any) => void>();
    const navigate = vi.fn(async () => undefined);
    const claim = vi.fn(async () => undefined);
    const unregister = vi.fn(async () => true);
    const skipWaiting = vi.fn(async () => undefined);
    const serviceWorkerGlobal = {
      addEventListener: (name: string, listener: (event: any) => void) =>
        listeners.set(name, listener),
      skipWaiting,
      clients: {
        claim,
        matchAll: vi.fn(async () => [
          {
            url: "https://draw.yasinarshad.com/d/board-slug?panel=history",
            navigate,
          },
          {
            url: "https://draw.yasinarshad.com/s/share-token?q=1",
            navigate,
          },
        ]),
      },
      registration: { unregister },
    };

    // eslint-disable-next-line no-new-func -- validate the exact emitted worker source
    new Function("self", script)(serviceWorkerGlobal);

    let installWork: Promise<unknown> | undefined;
    listeners.get("install")!({
      waitUntil: (work: Promise<unknown>) => {
        installWork = work;
      },
    });
    await installWork;
    expect(skipWaiting).toHaveBeenCalledOnce();

    let activationWork: Promise<unknown> | undefined;
    listeners.get("activate")!({
      waitUntil: (work: Promise<unknown>) => {
        activationWork = work;
      },
    });
    await activationWork;

    expect(claim).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenNthCalledWith(
      1,
      "https://draw.yaseenarshad.com/b/board-slug?panel=history",
    );
    expect(navigate).toHaveBeenNthCalledWith(
      2,
      "https://draw.yaseenarshad.com/s/share-token?q=1",
    );
    expect(unregister).toHaveBeenCalledOnce();
  });

  it("redirects fetches that arrive while the retirement worker still controls the page", async () => {
    const script = await getLegacyServiceWorkerResponse(
      new URL("https://draw.yasinarshad.com/sw.js"),
    )!.text();
    const listeners = new Map<string, (event: any) => void>();
    const serviceWorkerGlobal = {
      addEventListener: (name: string, listener: (event: any) => void) =>
        listeners.set(name, listener),
      skipWaiting: vi.fn(),
      clients: { claim: vi.fn(), matchAll: vi.fn(async () => []) },
      registration: { unregister: vi.fn() },
    };
    // eslint-disable-next-line no-new-func -- validate the exact emitted worker source
    new Function("self", script)(serviceWorkerGlobal);

    let response: Promise<Response> | undefined;
    listeners.get("fetch")!({
      request: {
        url: "https://draw.yasinarshad.com/unknown/path?probe=1",
      },
      respondWith: (value: Promise<Response>) => {
        response = value;
      },
    });

    const resolved = await response;
    expect(resolved?.status).toBe(308);
    expect(resolved?.headers.get("Location")).toBe(
      "https://draw.yaseenarshad.com/unknown/path?probe=1",
    );
  });
});
