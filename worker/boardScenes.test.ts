import { deflate, inflate } from "pako";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BOARD_SCENE_CONTENT_TYPE,
  BOARD_SCENE_ENCODING,
  BOARD_SCENE_ENCODING_HEADER,
} from "../board-scenes/types";

import worker from "./index";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const CONVEX_SITE_URL = "https://convex.example.test";
const OBJECT_KEY = "board-scenes/kd7abc/0f9d4c2a41f04e0f9b6a1c2d3e4f5a6b.scene";
const READ_TOKEN = "a".repeat(64);
const DIAGRAM_ID = "kd7abc";

const sha256 = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
      ),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const sceneJson = JSON.stringify({
  elements: [{ id: "rect-1", type: "rectangle", version: 3 }],
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
});
const rawBytes = new TextEncoder().encode(sceneJson);
const compressedBytes = deflate(rawBytes);

const makeUploadGrant = async (
  overrides: Record<string, unknown> = {},
  bytes: { raw: Uint8Array; compressed: Uint8Array } = {
    raw: rawBytes,
    compressed: compressedBytes,
  },
) => ({
  objectKey: OBJECT_KEY,
  diagramId: DIAGRAM_ID,
  version: 12,
  encoding: BOARD_SCENE_ENCODING,
  contentType: BOARD_SCENE_CONTENT_TYPE,
  compressedSize: bytes.compressed.byteLength,
  compressedSha256: await sha256(bytes.compressed),
  rawSize: bytes.raw.byteLength,
  rawSha256: await sha256(bytes.raw),
  ...overrides,
});

const makeReadGrant = async (overrides: Record<string, unknown> = {}) => ({
  ...(await makeUploadGrant()),
  etag: "scene-etag",
  expiresAt: Date.now() + 300_000,
  ...overrides,
});

type StoredObject = {
  bytes: Uint8Array;
  etag: string;
  customMetadata?: Record<string, string>;
  httpMetadata?: Record<string, string>;
};

const toBytes = (body: unknown) => {
  if (body instanceof Uint8Array) {
    return body;
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body);
  }
  return new TextEncoder().encode(String(body));
};

const createBucket = (
  options: { storedSize?: number; putError?: Error } = {},
) => {
  const objects = new Map<string, StoredObject>();
  return {
    objects,
    put: vi.fn(
      async (
        key: string,
        body: unknown,
        putOptions?: {
          customMetadata?: Record<string, string>;
          httpMetadata?: Record<string, string>;
        },
      ) => {
        if (options.putError) {
          objects.set(key, {
            bytes: new Uint8Array(0),
            etag: "partial",
          });
          throw options.putError;
        }
        const bytes = toBytes(body);
        const etag = `etag-${key.length}-${bytes.byteLength}`;
        objects.set(key, {
          bytes,
          etag,
          customMetadata: putOptions?.customMetadata,
          httpMetadata: putOptions?.httpMetadata,
        });
        return {
          key,
          etag,
          httpEtag: `"${etag}"`,
          size: options.storedSize ?? bytes.byteLength,
        };
      },
    ),
    get: vi.fn(async (key: string) => {
      const stored = objects.get(key);
      if (!stored) {
        return null;
      }
      return {
        key,
        body: stored.bytes,
        size: stored.bytes.byteLength,
        etag: stored.etag,
        httpEtag: `"${stored.etag}"`,
        customMetadata: stored.customMetadata,
      };
    }),
    delete: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        objects.delete(key);
      }
    }),
    list: vi.fn(async (listOptions?: { prefix?: string }) => ({
      objects: Array.from(objects.keys())
        .filter((key) => key.startsWith(listOptions?.prefix ?? ""))
        .map((key) => ({ key })),
      truncated: false as const,
    })),
  };
};

type Bucket = ReturnType<typeof createBucket>;

const createEnv = (bucket: Bucket) =>
  ({
    CONVEX_SITE_URL,
    DIAGRAM_ASSETS: bucket,
    ASSETS: { fetch: vi.fn() },
  } as never);

const stubConvex = (routes: Record<string, unknown>) => {
  const requests: Array<{ path: string; token: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      const path = new URL(url).pathname;
      requests.push({
        path,
        token: JSON.parse(init?.body ?? "{}").token,
      });
      const grant = routes[path];
      if (grant === undefined) {
        return new Response(null, { status: 404 });
      }
      if (grant instanceof Response) {
        return grant;
      }
      return Response.json(grant);
    }),
  );
  return requests;
};

const uploadRequest = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request("https://draw.example.test/api/board-scenes", {
    method: "POST",
    headers: {
      Authorization: "Bearer scene-upload-token",
      "Content-Type": BOARD_SCENE_CONTENT_TYPE,
      [BOARD_SCENE_ENCODING_HEADER]: BOARD_SCENE_ENCODING,
      ...headers,
    },
    body,
  });

const run = async (request: Request, bucket: Bucket) =>
  await worker.fetch!(request, createEnv(bucket), {} as ExecutionContext);

describe("retired Board scene uploads", () => {
  it("refuses legacy uploads before reading bytes, resolving grants or writing R2", async () => {
    const bucket = createBucket();
    const fetch = stubConvex({});
    const response = await run(uploadRequest(compressedBytes), bucket);
    expect(response.status).toBe(426);
    expect(await response.json()).toMatchObject({ status: "upgrade-required" });
    expect(bucket.put).not.toHaveBeenCalled();
    expect(fetch).toHaveLength(0);
  });
});

describe("private Board scene reads", () => {
  const storeScene = async (bucket: Bucket) => {
    const grant = await makeUploadGrant();
    await bucket.put(OBJECT_KEY, compressedBytes, {
      httpMetadata: { contentType: BOARD_SCENE_CONTENT_TYPE },
      customMetadata: {
        encoding: grant.encoding,
        compressedSha256: grant.compressedSha256,
        rawSha256: grant.rawSha256,
        rawSize: String(grant.rawSize),
        diagramId: grant.diagramId,
        version: String(grant.version),
      },
    });
    return bucket.objects.get(OBJECT_KEY)!.etag;
  };

  it.each(["GET", "HEAD"])(
    "serves the exact registered object over %s with private headers",
    async (method) => {
      const bucket = createBucket();
      const etag = await storeScene(bucket);
      stubConvex({
        "/board-scene-read-grant": await makeReadGrant({ etag }),
      });

      const response = await run(
        new Request(
          `https://draw.example.test/api/board-scenes/${READ_TOKEN}`,
          { method },
        ),
        bucket,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe(
        BOARD_SCENE_CONTENT_TYPE,
      );
      expect(response.headers.get("Content-Length")).toBe(
        String(compressedBytes.byteLength),
      );
      expect(response.headers.get(BOARD_SCENE_ENCODING_HEADER)).toBe(
        BOARD_SCENE_ENCODING,
      );
      expect(response.headers.get("Cache-Control")).toBe(
        "private, max-age=300, immutable",
      );
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(JSON.stringify([...response.headers])).not.toContain(OBJECT_KEY);

      const served = new Uint8Array(await response.arrayBuffer());
      if (method === "HEAD") {
        expect(served.byteLength).toBe(0);
        return;
      }
      expect(Array.from(served)).toEqual(Array.from(compressedBytes));
      expect(new TextDecoder().decode(inflate(served))).toBe(sceneJson);
    },
  );

  it.each([
    ["a revoked share token", new Response(null, { status: 403 })],
    ["an expired grant", { expiresAt: Date.now() - 1 }],
    ["a grant outside the scene namespace", { objectKey: "kd7abc/other.png" }],
  ])("refuses %s without touching R2", async (_label, grant) => {
    const bucket = createBucket();
    await storeScene(bucket);
    bucket.get.mockClear();
    stubConvex({
      "/board-scene-read-grant":
        grant instanceof Response
          ? grant
          : await makeReadGrant(grant as Record<string, unknown>),
    });

    const response = await run(
      new Request(`https://draw.example.test/api/board-scenes/${READ_TOKEN}`),
      bucket,
    );

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain(OBJECT_KEY);
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it("refuses a malformed read token without contacting Convex", async () => {
    const requests = stubConvex({
      "/board-scene-read-grant": await makeReadGrant(),
    });
    const bucket = createBucket();

    const response = await run(
      new Request("https://draw.example.test/api/board-scenes/not-a-token"),
      bucket,
    );

    expect(response.status).toBe(404);
    expect(requests).toHaveLength(0);
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it.each([
    ["the object is missing", { objectKey: `${OBJECT_KEY}-gone` }],
    ["the stored ETag differs", { etag: "stale-etag" }],
    ["the registered size differs", { compressedSize: 3 }],
    ["the stored raw size differs", { rawSize: rawBytes.byteLength - 1 }],
    ["the stored checksum differs", { compressedSha256: "0".repeat(64) }],
    ["the stored Board differs", { diagramId: "another-board" }],
    ["the stored version differs", { version: 13 }],
  ])("fails closed when %s", async (_label, grant) => {
    const bucket = createBucket();
    const etag = await storeScene(bucket);
    stubConvex({
      "/board-scene-read-grant": await makeReadGrant({
        etag,
        ...(grant as Record<string, unknown>),
      }),
    });

    const response = await run(
      new Request(`https://draw.example.test/api/board-scenes/${READ_TOKEN}`),
      bucket,
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).not.toContain(OBJECT_KEY);
  });
});

describe("Board scene namespace isolation", () => {
  it.each([
    "board-scene-uploads/board/staged.bin",
    "board-scene-uploads%2Fboard%2Fstaged.bin",
    "board/board-scene-uploads/staged.bin",
  ])(
    "never exposes staging through the public asset route: %s",
    async (key) => {
      const bucket = createBucket();
      const response = await run(
        new Request(`https://draw.example.test/api/assets/${key}`),
        bucket,
      );
      expect(response.status).toBe(400);
      expect(bucket.get).not.toHaveBeenCalled();
    },
  );
  const storeSceneObject = async (bucket: Bucket) => {
    bucket.objects.set(OBJECT_KEY, {
      bytes: compressedBytes,
      etag: "scene-etag",
    });
  };

  it.each([
    ["board-scenes%2Fkd7abc%2F0f9d4c2a41f04e0f9b6a1c2d3e4f5a6b.scene"],
    ["kd7abc%2Fboard-scenes%2F0f9d4c2a41f04e0f9b6a1c2d3e4f5a6b.scene"],
  ])("blocks the public asset route from serving %s", async (encodedKey) => {
    const bucket = createBucket();
    await storeSceneObject(bucket);

    const response = await run(
      new Request(`https://draw.example.test/api/assets/${encodedKey}`),
      bucket,
    );

    expect(response.status).toBe(400);
    expect(bucket.get).not.toHaveBeenCalled();
  });
});

describe("bounded Board scene deletion", () => {
  const deleteRequest = () =>
    new Request("https://draw.example.test/api/board-scenes", {
      method: "DELETE",
      headers: { Authorization: "Bearer scene-delete-token" },
    });

  it("deletes the exact keys named by the capability and repeats safely", async () => {
    const keys = [OBJECT_KEY, `${OBJECT_KEY}-2`];
    stubConvex({ "/board-scene-delete-grant": { objectKeys: keys } });
    const bucket = createBucket();
    bucket.objects.set(OBJECT_KEY, {
      bytes: compressedBytes,
      etag: "scene-etag",
    });

    const first = await run(deleteRequest(), bucket);
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ deleted: 2 });
    expect(bucket.objects.size).toBe(0);

    const second = await run(deleteRequest(), bucket);
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toEqual({ deleted: 2 });
    expect(bucket.delete).toHaveBeenCalledTimes(2);
  });

  it("deletes every object under an authorized Board scene prefix", async () => {
    stubConvex({
      "/board-scene-delete-grant": {
        objectKeys: [],
        objectKeyPrefix: `board-scenes/${DIAGRAM_ID}/`,
      },
    });
    const bucket = createBucket();
    bucket.objects.set(OBJECT_KEY, {
      bytes: compressedBytes,
      etag: "scene-etag",
    });
    bucket.objects.set(`board-scenes/${DIAGRAM_ID}/second.scene`, {
      bytes: compressedBytes,
      etag: "scene-etag-2",
    });
    bucket.objects.set("board-scenes/other/keep.scene", {
      bytes: compressedBytes,
      etag: "other-etag",
    });

    const response = await run(deleteRequest(), bucket);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: 2 });
    expect(Array.from(bucket.objects.keys())).toEqual([
      "board-scenes/other/keep.scene",
    ]);
  });

  it.each([
    ["a key outside the scene namespace", { objectKeys: ["kd7abc/image.png"] }],
    [
      "a prefix outside the scene namespace",
      { objectKeys: [], objectKeyPrefix: "kd7abc/" },
    ],
    ["a traversal key", { objectKeys: ["board-scenes/../kd7abc/image.png"] }],
    ["an expired capability", new Response(null, { status: 403 })],
  ])("refuses %s without deleting anything", async (_label, grant) => {
    stubConvex({ "/board-scene-delete-grant": grant });
    const bucket = createBucket();
    bucket.objects.set(OBJECT_KEY, {
      bytes: compressedBytes,
      etag: "scene-etag",
    });

    const response = await run(deleteRequest(), bucket);

    expect(response.status).toBe(403);
    expect(bucket.delete).not.toHaveBeenCalled();
    expect(bucket.objects.has(OBJECT_KEY)).toBe(true);
  });

  it("refuses an unauthenticated delete", async () => {
    const requests = stubConvex({
      "/board-scene-delete-grant": { objectKeys: [OBJECT_KEY] },
    });
    const bucket = createBucket();

    const response = await run(
      new Request("https://draw.example.test/api/board-scenes", {
        method: "DELETE",
      }),
      bucket,
    );

    expect(response.status).toBe(403);
    expect(requests).toHaveLength(0);
    expect(bucket.delete).not.toHaveBeenCalled();
  });
});
