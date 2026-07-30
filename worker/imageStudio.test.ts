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

  it("prioritizes colorful collections and caps each collection at two", () => {
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
    expect(mdiResults.length).toBeGreaterThan(0);
    expect(mdiResults.length).toBeLessThanOrEqual(2);
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
      vi.fn().mockResolvedValue(
        Response.json({
          icons: ["fluent-emoji-flat:rocket"],
          collections: {
            "fluent-emoji-flat": { name: "Fluent Emoji Flat" },
          },
        }),
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

    const first = await handleImageStudioRequest(request, {
      PIXABAY_API_KEY: "secret",
    });
    const second = await handleImageStudioRequest(request, {
      PIXABAY_API_KEY: "secret",
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(cache.put).toHaveBeenCalled();
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
