import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildPixabaySearchUrls,
  curateIconifyResults,
  handleImageStudioRequest,
  interleaveResults,
  normalizeIconifyResults,
  normalizePixabayResults,
} from "./imageStudio";

describe("Image Studio provider normalization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps Pixabay vectors and illustrations but rejects photos", () => {
    const results = normalizePixabayResults({
      hits: [
        {
          id: 101,
          type: "vector/svg",
          tags: "filing cabinet, office",
          previewURL: "https://example.com/cabinet.png",
          pageURL: "https://pixabay.com/vectors/cabinet-101/",
          user: "Alex",
          imageWidth: 1000,
          imageHeight: 1200,
        },
        {
          id: 102,
          type: "photo",
          previewURL: "https://example.com/photo.jpg",
        },
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      itemKey: "pixabay:101",
      provider: "pixabay",
      kind: "illustration",
      title: "Filing Cabinet",
      collectionName: "Pixabay",
      licenseName: "Pixabay Content License",
      creator: "Alex",
    });
  });

  it("builds transparent, safe vector and illustration searches", () => {
    const urls = buildPixabaySearchUrls("filing cabinet", 2, "secret");
    expect(urls.map((url) => url.searchParams.get("image_type"))).toEqual([
      "vector",
      "illustration",
    ]);
    for (const url of urls) {
      expect(url.searchParams.get("colors")).toBe("transparent");
      expect(url.searchParams.get("safesearch")).toBe("true");
      expect(url.searchParams.get("order")).toBe("popular");
      expect(url.searchParams.get("page")).toBe("2");
    }
  });

  it("prioritizes colorful collections without collapsing valid variants", () => {
    const results = normalizeIconifyResults({
      icons: [
        "mdi:rocket",
        "mdi:rocket-launch",
        "mdi:rocket-outline",
        "fluent-emoji-flat:rocket",
        "fluent-color:rocket-24",
        "tabler:rocket",
      ],
      collections: {
        mdi: { name: "Material Design Icons" },
        "fluent-emoji-flat": { name: "Fluent Emoji Flat", palette: true },
        "fluent-color": { name: "Fluent Color", palette: true },
        tabler: { name: "Tabler" },
      },
    });

    const curated = curateIconifyResults(results, "rocket", 10);
    expect(curated[0].providerId).toBe("fluent-emoji-flat:rocket");
    expect(curated[1].providerId).toBe("fluent-color:rocket-24");
    const mdiResults = curated.filter(({ providerId }) =>
      providerId.startsWith("mdi:"),
    );
    expect(mdiResults).toHaveLength(3);
    expect(new Set(curated.map(({ providerId }) => providerId)).size).toBe(
      curated.length,
    );
  });

  it("mixes three curated icons before each Pixabay graphic", () => {
    const item = (provider: "pixabay" | "iconify", providerId: string) => ({
      itemKey: `${provider}:${providerId}`,
      provider,
      providerId,
      kind:
        provider === "pixabay" ? ("illustration" as const) : ("icon" as const),
      title: providerId,
      previewUrl: providerId,
    });
    expect(
      interleaveResults(
        ["a", "b", "c", "d", "e", "f"].map((id) => item("iconify", id)),
        ["one", "two"].map((id) => item("pixabay", id)),
      ).map(({ provider }) => provider),
    ).toEqual([
      "iconify",
      "iconify",
      "iconify",
      "pixabay",
      "iconify",
      "iconify",
      "iconify",
      "pixabay",
    ]);
  });

  it("returns Iconify results with a clear warning when Pixabay is not configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          Response.json({
            icons: ["fluent-emoji-flat:rocket"],
            collections: {
              "fluent-emoji-flat": { name: "Fluent Emoji Flat" },
            },
          }),
        ),
      ),
    );

    const response = await handleImageStudioRequest(
      new Request("https://draw.test/api/image-studio/search?q=rocket"),
      {},
    );
    const body = (await response.json()) as {
      results: Array<{ provider: string }>;
      warnings: Array<{ provider: string }>;
    };
    expect(response.status).toBe(200);
    expect(body.results[0].provider).toBe("iconify");
    expect(body.warnings).toEqual([
      expect.objectContaining({ provider: "pixabay" }),
    ]);
  });

  it("runs only the requested provider and rejects unknown sources", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        Response.json({
          icons: ["fluent-color:rocket-24"],
          collections: { "fluent-color": { name: "Fluent Color" } },
          total: 1,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleImageStudioRequest(
      new Request(
        "https://draw.test/api/image-studio/search?q=rocket&source=iconify",
      ),
      {},
    );
    const body = (await response.json()) as {
      results: Array<{ provider: string }>;
      cursor: string | null;
      warnings: unknown[];
    };

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body.results.every(({ provider }) => provider === "iconify")).toBe(
      true,
    );
    expect(body.cursor).toBeNull();
    expect(body.warnings).toEqual([]);

    const invalid = await handleImageStudioRequest(
      new Request(
        "https://draw.test/api/image-studio/search?q=rocket&source=web",
      ),
      {},
    );
    expect(invalid.status).toBe(400);
  });

  it("returns an opaque next cursor from provider pagination metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          icons: ["fluent-color:rocket-24"],
          collections: { "fluent-color": { name: "Fluent Color" } },
          total: 100,
          start: 0,
          limit: 64,
        }),
      ),
    );

    const response = await handleImageStudioRequest(
      new Request(
        "https://draw.test/api/image-studio/search?q=rocket&source=iconify",
      ),
      {},
    );
    const body = (await response.json()) as { cursor: string | null };
    expect(body.cursor).not.toBeNull();
    expect(body.cursor).not.toBe("2");
  });

  it("eventually returns every Iconify variant without discarding curated results", async () => {
    const colorIcons = [
      "fluent-emoji-flat:rocket",
      "noto:rocket",
      "openmoji:rocket",
      "twemoji:rocket",
    ];
    const generalIcons = Array.from(
      { length: 25 },
      (_, index) => `tabler:rocket-${index + 1}`,
    );
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const icons = url.searchParams.has("prefixes")
        ? colorIcons
        : generalIcons;
      const start = Number(url.searchParams.get("start") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? icons.length);
      return Response.json({
        icons: icons.slice(start, start + limit),
        collections: {
          "fluent-emoji-flat": { name: "Fluent Emoji Flat" },
          noto: { name: "Noto Emoji" },
          openmoji: { name: "OpenMoji" },
          twemoji: { name: "Twemoji" },
          tabler: { name: "Tabler" },
        },
        total: icons.length,
        start,
        limit,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const results: Array<{ itemKey: string; providerId: string }> = [];
    let cursor: string | null = null;
    do {
      const url = new URL("https://draw.test/api/image-studio/search");
      url.searchParams.set("q", "rocket");
      url.searchParams.set("source", "iconify");
      if (cursor) {
        url.searchParams.set("cursor", cursor);
      }
      const response = await handleImageStudioRequest(new Request(url), {});
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        results: Array<{ itemKey: string; providerId: string }>;
        cursor: string | null;
      };
      results.push(...body.results);
      cursor = body.cursor;
    } while (cursor);

    expect(
      results.slice(0, colorIcons.length).map(({ providerId }) => providerId),
    ).toEqual(colorIcons);
    expect(new Set(results.map(({ itemKey }) => itemKey))).toEqual(
      new Set(
        [...colorIcons, ...generalIcons].map(
          (providerId) => `iconify:${providerId}`,
        ),
      ),
    );
    expect(results).toHaveLength(colorIcons.length + generalIcons.length);
    expect(
      fetchMock.mock.calls
        .map(([input]) => new URL(String(input)).searchParams.get("limit"))
        .map(Number),
    ).not.toContain(64);
  });

  it("does not advance past Iconify's oversized minimum response window", async () => {
    const colorIcons = Array.from(
      { length: 20 },
      (_, index) => `openmoji:color-rocket-${index + 1}`,
    );
    const generalIcons = Array.from(
      { length: 35 },
      (_, index) => `tabler:general-rocket-${index + 1}`,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        const icons = url.searchParams.has("prefixes")
          ? colorIcons
          : generalIcons;
        const start = Number(url.searchParams.get("start") ?? 0);
        const providerLimit = 32;
        return Response.json({
          icons: icons.slice(start, start + providerLimit),
          collections: {
            openmoji: { name: "OpenMoji" },
            tabler: { name: "Tabler" },
          },
          total: icons.length,
          start,
          limit: providerLimit,
        });
      }),
    );

    const itemKeys: string[] = [];
    let cursor: string | null = null;
    do {
      const url = new URL("https://draw.test/api/image-studio/search");
      url.searchParams.set("q", "rocket");
      url.searchParams.set("source", "iconify");
      if (cursor) {
        url.searchParams.set("cursor", cursor);
      }
      const response = await handleImageStudioRequest(new Request(url), {});
      const body = (await response.json()) as {
        results: Array<{ itemKey: string }>;
        cursor: string | null;
      };
      itemKeys.push(...body.results.map(({ itemKey }) => itemKey));
      cursor = body.cursor;
    } while (cursor);

    expect(itemKeys).toHaveLength(colorIcons.length + generalIcons.length);
    expect(new Set(itemKeys)).toEqual(
      new Set([...colorIcons, ...generalIcons].map((id) => `iconify:${id}`)),
    );
  });

  it("exhausts both providers independently without skipping mixed results", async () => {
    const colorIcons = ["fluent-emoji-flat:rocket", "openmoji:rocket"];
    const generalIcons = Array.from(
      { length: 20 },
      (_, index) => `lucide:rocket-${index + 1}`,
    );
    const vectors = Array.from({ length: 5 }, (_, index) => ({
      id: 100 + index,
      type: "vector/svg",
      tags: `vector rocket ${index + 1}`,
      previewURL: `https://example.com/vector-${index + 1}.png`,
    }));
    const illustrations = Array.from({ length: 5 }, (_, index) => ({
      id: 200 + index,
      type: "illustration",
      tags: `illustrated rocket ${index + 1}`,
      previewURL: `https://example.com/illustration-${index + 1}.png`,
    }));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.hostname === "api.iconify.design") {
        const icons = url.searchParams.has("prefixes")
          ? colorIcons
          : generalIcons;
        const start = Number(url.searchParams.get("start") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? icons.length);
        return Response.json({
          icons: icons.slice(start, start + limit),
          collections: {
            "fluent-emoji-flat": { name: "Fluent Emoji Flat" },
            openmoji: { name: "OpenMoji" },
            lucide: { name: "Lucide" },
          },
          total: icons.length,
          start,
          limit,
        });
      }
      const items =
        url.searchParams.get("image_type") === "vector"
          ? vectors
          : illustrations;
      const page = Number(url.searchParams.get("page") ?? 1);
      const perPage = Number(url.searchParams.get("per_page") ?? 20);
      const start = (page - 1) * perPage;
      return Response.json({
        hits: items.slice(start, start + perPage),
        totalHits: items.length,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const results: Array<{ itemKey: string; provider: string }> = [];
    let cursor: string | null = null;
    do {
      const url = new URL("https://draw.test/api/image-studio/search");
      url.searchParams.set("q", "rocket");
      url.searchParams.set("source", "all");
      if (cursor) {
        url.searchParams.set("cursor", cursor);
      }
      const response = await handleImageStudioRequest(new Request(url), {
        PIXABAY_API_KEY: "secret",
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        results: Array<{ itemKey: string; provider: string }>;
        cursor: string | null;
      };
      expect(body.results.length).toBeLessThanOrEqual(18);
      results.push(...body.results);
      cursor = body.cursor;
    } while (cursor);

    const expectedKeys = [
      ...colorIcons.map((id) => `iconify:${id}`),
      ...generalIcons.map((id) => `iconify:${id}`),
      ...vectors.map(({ id }) => `pixabay:${id}`),
      ...illustrations.map(({ id }) => `pixabay:${id}`),
    ];
    expect(results.slice(0, 4).map(({ provider }) => provider)).toEqual([
      "iconify",
      "iconify",
      "iconify",
      "pixabay",
    ]);
    expect(results.map(({ itemKey }) => itemKey)).toHaveLength(
      new Set(expectedKeys).size,
    );
    expect(new Set(results.map(({ itemKey }) => itemKey))).toEqual(
      new Set(expectedKeys),
    );
  });

  it("does not repeat Pixabay assets shared by vector and illustration streams", async () => {
    const vectors = Array.from({ length: 5 }, (_, index) => ({
      id: 100 + index,
      type: "vector/svg",
      tags: `vector rocket ${index + 1}`,
      previewURL: `https://example.com/vector-${index + 1}.png`,
    }));
    const illustrations = [
      {
        ...vectors[0],
        type: "illustration",
        tags: "duplicate illustrated rocket",
      },
      ...Array.from({ length: 4 }, (_, index) => ({
        id: 200 + index,
        type: "illustration",
        tags: `illustrated rocket ${index + 1}`,
        previewURL: `https://example.com/illustration-${index + 1}.png`,
      })),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.hostname === "api.iconify.design") {
          return Response.json({
            icons: Array.from(
              { length: 40 },
              (_, index) => `lucide:rocket-${index + 1}`,
            ).slice(
              Number(url.searchParams.get("start") ?? 0),
              Number(url.searchParams.get("start") ?? 0) +
                Number(url.searchParams.get("limit") ?? 40),
            ),
            collections: { lucide: { name: "Lucide" } },
            total: 40,
            start: Number(url.searchParams.get("start") ?? 0),
            limit: Number(url.searchParams.get("limit") ?? 40),
          });
        }
        const items =
          url.searchParams.get("image_type") === "vector"
            ? vectors
            : illustrations;
        const page = Number(url.searchParams.get("page") ?? 1);
        const perPage = Number(url.searchParams.get("per_page") ?? 4);
        const start = (page - 1) * perPage;
        return Response.json({
          hits: items.slice(start, start + perPage),
          totalHits: items.length,
        });
      }),
    );

    const pixabayKeys: string[] = [];
    let cursor: string | null = null;
    do {
      const url = new URL("https://draw.test/api/image-studio/search");
      url.searchParams.set("q", "rocket");
      url.searchParams.set("source", "all");
      if (cursor) {
        url.searchParams.set("cursor", cursor);
      }
      const body = (await (
        await handleImageStudioRequest(new Request(url), {
          PIXABAY_API_KEY: "secret",
        })
      ).json()) as {
        results: Array<{ itemKey: string; provider: string }>;
        cursor: string | null;
      };
      pixabayKeys.push(
        ...body.results
          .filter(({ provider }) => provider === "pixabay")
          .map(({ itemKey }) => itemKey),
      );
      cursor = body.cursor;
    } while (cursor);

    expect(pixabayKeys).toHaveLength(9);
    expect(new Set(pixabayKeys).size).toBe(9);
  });

  it("retries a failed provider from its unchanged position on the next cursor", async () => {
    const icons = Array.from(
      { length: 20 },
      (_, index) => `lucide:recovery-${index + 1}`,
    );
    const vectors = Array.from({ length: 8 }, (_, index) => ({
      id: 300 + index,
      type: "vector/svg",
      tags: `recovered vector ${index + 1}`,
      previewURL: `https://example.com/recovered-${index + 1}.png`,
    }));
    let pixabayFailures = 1;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.hostname === "api.iconify.design") {
          const available = url.searchParams.has("prefixes") ? [] : icons;
          const start = Number(url.searchParams.get("start") ?? 0);
          const limit = Number(
            url.searchParams.get("limit") ?? available.length,
          );
          return Response.json({
            icons: available.slice(start, start + limit),
            collections: { lucide: { name: "Lucide" } },
            total: available.length,
            start,
            limit,
          });
        }
        if (pixabayFailures > 0) {
          pixabayFailures--;
          throw new Error("Pixabay unavailable");
        }
        const available =
          url.searchParams.get("image_type") === "vector" ? vectors : [];
        const page = Number(url.searchParams.get("page") ?? 1);
        const perPage = Number(url.searchParams.get("per_page") ?? 4);
        const start = (page - 1) * perPage;
        return Response.json({
          hits: available.slice(start, start + perPage),
          totalHits: available.length,
        });
      }),
    );

    const itemKeys: string[] = [];
    const warningCounts: number[] = [];
    let cursor: string | null = null;
    do {
      const url = new URL("https://draw.test/api/image-studio/search");
      url.searchParams.set("q", "recovery");
      url.searchParams.set("source", "all");
      if (cursor) {
        url.searchParams.set("cursor", cursor);
      }
      const response = await handleImageStudioRequest(new Request(url), {
        PIXABAY_API_KEY: "secret",
      });
      const body = (await response.json()) as {
        results: Array<{ itemKey: string }>;
        cursor: string | null;
        warnings: unknown[];
      };
      itemKeys.push(...body.results.map(({ itemKey }) => itemKey));
      warningCounts.push(body.warnings.length);
      cursor = body.cursor;
    } while (cursor);

    expect(warningCounts[0]).toBe(1);
    expect(warningCounts.slice(1)).toEqual(expect.arrayContaining([0]));
    expect(new Set(itemKeys)).toEqual(
      new Set([
        ...icons.map((id) => `iconify:${id}`),
        ...vectors.map(({ id }) => `pixabay:${id}`),
      ]),
    );
    expect(itemKeys).toHaveLength(new Set(itemKeys).size);
  });

  it("rejects malformed or mismatched opaque cursors", async () => {
    const malformed = await handleImageStudioRequest(
      new Request(
        "https://draw.test/api/image-studio/search?q=rocket&source=all&cursor=2",
      ),
      {},
    );
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({
      error: "Invalid search cursor",
    });
  });

  it("serves repeated configured searches from the 24-hour Worker cache", async () => {
    const stored = new Map<string, Response>();
    const cache = {
      match: vi.fn(async (request: Request) =>
        stored.get(request.url)?.clone(),
      ),
      put: vi.fn(async (request: Request, response: Response) => {
        stored.set(request.url, response.clone());
      }),
    };
    vi.stubGlobal("caches", { default: cache });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("iconify.design")) {
        return Response.json({
          icons: ["fluent-color:rocket-24"],
          collections: { "fluent-color": { name: "Fluent Color" } },
        });
      }
      return Response.json({
        hits: [
          {
            id: 101,
            type: "vector/svg",
            tags: "rocket",
            previewURL: "https://example.com/rocket.png",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request(
      "https://draw.test/api/image-studio/search?q=rocket",
    );
    stored.set(
      request.url,
      Response.json({
        results: [{ itemKey: "stale-pre-cursor-version" }],
        cursor: null,
        warnings: [],
      }),
    );

    const first = await handleImageStudioRequest(request, {
      PIXABAY_API_KEY: "secret",
    });
    const second = await handleImageStudioRequest(request, {
      PIXABAY_API_KEY: "secret",
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(first.clone().json()).resolves.not.toMatchObject({
      results: [{ itemKey: "stale-pre-cursor-version" }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(cache.put).toHaveBeenCalled();
    expect(
      new URL(cache.match.mock.calls[0][0].url).searchParams.get("_iscv"),
    ).toBe("2");
  });

  it("rejects arbitrary import providers and malformed Pixabay IDs", async () => {
    const arbitrary = await handleImageStudioRequest(
      new Request(
        "https://draw.test/api/image-studio/import/external/https%3A%2F%2Fevil.test",
      ),
      { PIXABAY_API_KEY: "secret" },
    );
    expect(arbitrary.status).toBe(404);

    const malformed = await handleImageStudioRequest(
      new Request(
        "https://draw.test/api/image-studio/import/pixabay/not-a-number",
      ),
      { PIXABAY_API_KEY: "secret" },
    );
    expect(malformed.status).toBe(404);
  });

  it("rejects non-image and oversized provider imports", async () => {
    const record = {
      hits: [
        {
          id: 101,
          type: "vector/svg",
          largeImageURL: "https://cdn.test/graphic.png",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(record))
        .mockResolvedValueOnce(
          new Response("not an image", {
            headers: { "Content-Type": "text/plain" },
          }),
        ),
    );
    const nonImage = await handleImageStudioRequest(
      new Request("https://draw.test/api/image-studio/import/pixabay/101"),
      { PIXABAY_API_KEY: "secret" },
    );
    expect(nonImage.status).toBe(415);

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(record))
        .mockResolvedValueOnce(
          new Response("image", {
            headers: {
              "Content-Type": "image/png",
              "Content-Length": String(21 * 1024 * 1024),
            },
          }),
        ),
    );
    const oversized = await handleImageStudioRequest(
      new Request("https://draw.test/api/image-studio/import/pixabay/101"),
      { PIXABAY_API_KEY: "secret" },
    );
    expect(oversized.status).toBe(413);
  });
});
