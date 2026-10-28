// @vitest-environment node
import { createHash } from "node:crypto";

import { deflate, gzip } from "pako";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createBoardSceneDirectUpload,
  deleteBoardSceneR2Object,
  verifyAndPromoteBoardScene,
} from "./boardSceneR2";

import type { StagedBoardSceneGrant } from "./boardSceneR2";

const config = {
  endpoint: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
  bucket: "test-scenes",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
};
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const scene = new TextEncoder().encode('{"elements":[],"appState":{}}');
const fixture = (raw = scene, bytes = deflate(raw)) => {
  const grant: StagedBoardSceneGrant = {
    objectKey: "board-scenes/diagram-1/version-1",
    stagingObjectKey: "board-scene-uploads/diagram-1/grant-1",
    diagramId: "diagram-1",
    version: 1,
    encoding: "deflate-v1",
    contentType: "application/octet-stream",
    rawSize: raw.byteLength,
    rawSha256: hash(raw),
    compressedSize: bytes.byteLength,
    compressedSha256: hash(bytes),
    expiresAt: Date.now() + 90_000,
  };
  return { grant, bytes };
};
const metadata = (grant: StagedBoardSceneGrant) => ({
  "content-type": grant.contentType,
  "content-length": String(grant.compressedSize),
  etag: '"trusted-etag"',
  "x-amz-meta-diagramid": grant.diagramId,
  "x-amz-meta-version": String(grant.version),
  "x-amz-meta-rawsize": String(grant.rawSize),
  "x-amz-meta-rawsha256": grant.rawSha256,
  "x-amz-meta-compressedsha256": grant.compressedSha256,
  "x-amz-meta-encoding": grant.encoding,
});
const sourceResponse = (bytes: Uint8Array, headers = {}) =>
  new Response(bytes.slice().buffer as ArrayBuffer, {
    headers: { etag: '"source-etag"', ...headers },
  });
const copyResponse = (
  body = '<CopyObjectResult><ETag>"trusted-etag"</ETag></CopyObjectResult>',
) => new Response(body);
const mockPromotion = (grant: StagedBoardSceneGrant, bytes: Uint8Array) => {
  const mock = vi
    .fn()
    .mockResolvedValueOnce(sourceResponse(bytes))
    .mockResolvedValueOnce(copyResponse())
    .mockResolvedValueOnce(new Response(null, { headers: metadata(grant) }));
  vi.stubGlobal("fetch", mock);
  return mock;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("private direct Board scene upload", () => {
  it("signs only the exact staging PUT, checksum, create-only condition and metadata", async () => {
    const { grant } = fixture();
    const upload = await createBoardSceneDirectUpload(config, grant);
    const url = new URL(upload.url);
    expect(url.origin).toBe(config.endpoint);
    expect(url.pathname).toBe(`/${config.bucket}/${grant.stagingObjectKey}`);
    expect(Number(url.searchParams.get("X-Amz-Expires"))).toBeLessThanOrEqual(
      60,
    );
    expect(upload.expiresAt).toBeLessThanOrEqual(grant.expiresAt);
    expect(upload.headers["if-none-match"]).toBe("*");
    expect(upload.headers["x-amz-checksum-sha256"]).toBe(
      Buffer.from(grant.compressedSha256, "hex").toString("base64"),
    );
    for (const name of Object.keys(upload.headers)) {
      expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toContain(
        name,
      );
    }
    expect(upload.headers["x-amz-meta-diagramid"]).toBe(grant.diagramId);
    expect(upload.headers["x-amz-meta-rawsha256"]).toBe(grant.rawSha256);
  });

  it("keeps the URL lifetime within a nearly expired grant", async () => {
    const { grant } = fixture();
    grant.expiresAt = Date.now() + 2_500;
    const upload = await createBoardSceneDirectUpload(config, grant);
    expect(
      Number(new URL(upload.url).searchParams.get("X-Amz-Expires")),
    ).toBeLessThanOrEqual(2);
    expect(upload.expiresAt).toBeLessThanOrEqual(grant.expiresAt);
  });

  it.each([
    {
      endpoint:
        "http://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
    },
    { endpoint: "https://evil.example" },
    { endpoint: `${config.endpoint}/extra` },
    { endpoint: `${config.endpoint}?extra=1` },
    {
      endpoint:
        "https://user:secret@0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
    },
    { bucket: "../wrong" },
    { accessKeyId: "" },
    { secretAccessKey: "" },
  ])("rejects unsafe configuration before fetching: %j", async (change) => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    await expect(
      createBoardSceneDirectUpload({ ...config, ...change }, fixture().grant),
    ).rejects.toThrow("Board scene storage configuration is invalid");
    expect(mock).not.toHaveBeenCalled();
  });

  it.each([
    { stagingObjectKey: "board-scenes/wrong" },
    { stagingObjectKey: "board-scene-uploads/../wrong" },
    { stagingObjectKey: "board-scene-uploads//wrong" },
    { stagingObjectKey: "board-scene-uploads/a?other=1" },
    { objectKey: "public-assets/wrong" },
    { expiresAt: 0 },
    { rawSize: 10_000_001 },
    { compressedSize: 10_100_001 },
    { semanticSha256: "invalid" },
  ])("rejects invalid grants: %j", async (change) => {
    await expect(
      createBoardSceneDirectUpload(config, { ...fixture().grant, ...change }),
    ).rejects.toThrow("Board scene upload grant is invalid");
  });
});

describe("verified storage-side promotion", () => {
  it("does not accept gzip bytes under the deflate-v1 encoding", async () => {
    const { grant, bytes } = fixture(scene, gzip(scene));
    const mock = mockPromotion(grant, bytes);
    await expect(verifyAndPromoteBoardScene(config, grant)).rejects.toThrow(
      "Board scene verification failed",
    );
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("rejects a response length header inconsistent with actual bytes", async () => {
    const { grant, bytes } = fixture();
    const mock = mockPromotion(grant, bytes);
    mock
      .mockReset()
      .mockResolvedValueOnce(sourceResponse(bytes, { "content-length": "1" }));
    await expect(verifyAndPromoteBoardScene(config, grant)).rejects.toThrow(
      "Board scene verification failed",
    );
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("validates actual bytes before a source-ETag-conditional copy and destination HEAD", async () => {
    const { grant, bytes } = fixture();
    const mock = mockPromotion(grant, bytes);
    await expect(verifyAndPromoteBoardScene(config, grant)).resolves.toEqual({
      etag: "trusted-etag",
    });
    const requests = mock.mock.calls.map(([request]) => request as Request);
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "PUT",
      "HEAD",
    ]);
    expect(new URL(requests[0].url).pathname).toBe(
      `/${config.bucket}/${grant.stagingObjectKey}`,
    );
    expect(requests[1].headers.get("x-amz-copy-source-if-match")).toBe(
      '"source-etag"',
    );
    expect(requests[1].headers.get("x-amz-copy-source")).toBe(
      `/${config.bucket}/${grant.stagingObjectKey}`,
    );
    expect(requests[1].headers.get("x-amz-metadata-directive")).toBe("REPLACE");
    expect(requests[1].headers.get("x-amz-meta-rawsha256")).toBe(
      grant.rawSha256,
    );
    expect(requests[1].headers.get("authorization")).toContain(
      "AWS4-HMAC-SHA256",
    );
    // R2 CopyObject does not preserve the provider's system checksum header.
    expect(requests[2].method).toBe("HEAD");
  });

  it.each([
    "compressedSize",
    "compressedSha256",
    "rawSize",
    "rawSha256",
  ] as const)(
    "rejects actual byte mismatch in %s before copy",
    async (field) => {
      const { grant, bytes } = fixture();
      if (field.endsWith("Size")) {
        (grant as unknown as Record<string, unknown>)[field] =
          (grant[field] as number) + 1;
      } else {
        (grant as unknown as Record<string, unknown>)[field] = "0".repeat(64);
      }
      const mock = mockPromotion(grant, bytes);
      await expect(verifyAndPromoteBoardScene(config, grant)).rejects.toThrow(
        "Board scene verification failed",
      );
      expect(mock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    new Uint8Array([1, 2, 3]),
    deflate(new TextEncoder().encode("not-json")),
    deflate(new TextEncoder().encode('{"elements":[],"appState":[]}')),
    deflate(new TextEncoder().encode('{"elements":{},"appState":{}}')),
    deflate(
      new Uint8Array([
        ...new TextEncoder().encode('{"elements":[],"appState":{},"x":"'),
        0xff,
        ...new TextEncoder().encode('"}'),
      ]),
    ),
  ])(
    "rejects malformed deflate, JSON, document shape and UTF-8 before copy",
    async (bytes) => {
      const { grant } = fixture(scene, bytes);
      // Match raw integrity when decompression succeeds, leaving format validation decisive.
      const { inflate } = await import("pako");
      try {
        const raw = inflate(bytes);
        grant.rawSize = raw.byteLength;
        grant.rawSha256 = hash(raw);
      } catch {
        /* Deliberately malformed compression. */
      }
      const mock = mockPromotion(grant, bytes);
      await expect(verifyAndPromoteBoardScene(config, grant)).rejects.toThrow(
        "Board scene verification failed",
      );
      expect(mock).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects a decompression bomb above the declared raw bound", async () => {
    const bytes = deflate(new Uint8Array(100_000).fill(120));
    const { grant } = fixture(scene, bytes);
    const mock = mockPromotion(grant, bytes);
    await expect(verifyAndPromoteBoardScene(config, grant)).rejects.toThrow(
      "Board scene verification failed",
    );
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("checks any granted semantic digest against the actual document", async () => {
    const { grant, bytes } = fixture();
    const mock = mockPromotion(grant, bytes);
    await expect(
      verifyAndPromoteBoardScene(config, {
        ...grant,
        semanticSha256: "0".repeat(64),
      }),
    ).rejects.toThrow("Board scene verification failed");
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("cancels an underdeclared oversized streaming response", async () => {
    const { grant, bytes } = fixture();
    const cancel = vi.fn();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes.byteLength + 1));
      },
      cancel,
    });
    const mock = vi.fn().mockResolvedValueOnce(
      new Response(body, {
        headers: {
          etag: '"source"',
          "content-length": String(bytes.byteLength),
        },
      }),
    );
    vi.stubGlobal("fetch", mock);
    await expect(verifyAndPromoteBoardScene(config, grant)).rejects.toThrow(
      "Board scene verification failed",
    );
    expect(cancel).toHaveBeenCalled();
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { "content-length": "99999999" },
    { "content-length": "invalid" },
    { "content-encoding": "gzip" },
    { etag: "" },
  ])(
    "rejects invalid source headers and cancels the response",
    async (headers) => {
      const { grant } = fixture();
      const cancel = vi.fn();
      const sourceHeaders = new Headers({ etag: '"source"' });
      Object.entries(headers).forEach(([key, value]) => {
        if (value !== undefined) {
          sourceHeaders.set(key, value);
        }
      });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(new ReadableStream({ cancel }), {
            headers: sourceHeaders,
          }),
        ),
      );
      await expect(verifyAndPromoteBoardScene(config, grant)).rejects.toThrow(
        "Board scene verification failed",
      );
      expect(cancel).toHaveBeenCalled();
    },
  );

  it("bounds stalled response streaming and cancels on timeout", async () => {
    vi.useFakeTimers();
    const { grant } = fixture();
    const cancel = vi.fn();
    let didFetch: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      didFetch = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        didFetch();
        return new Response(new ReadableStream({ cancel }), {
          headers: { etag: '"source"' },
        });
      }),
    );
    const pending = verifyAndPromoteBoardScene(config, grant).catch(
      (error: unknown) => error,
    );
    await started;
    await vi.advanceTimersByTimeAsync(30_001);
    expect(await pending).toEqual(new Error("Board scene verification failed"));
    expect(cancel).toHaveBeenCalled();
  });

  it.each([
    new Response("", { status: 412 }),
    new Response("", { status: 500 }),
    copyResponse("<Error><Code>InternalError</Code></Error>"),
    copyResponse(
      '<CopyObjectResult><Error>bad</Error><ETag>"trusted-etag"</ETag></CopyObjectResult>',
    ),
    copyResponse("<CopyObjectResult></CopyObjectResult>"),
    copyResponse("x".repeat(65_537)),
  ])("rejects failed or malformed copy even with HTTP 200", async (copy) => {
    const { grant, bytes } = fixture();
    const mock = vi
      .fn()
      .mockResolvedValueOnce(sourceResponse(bytes))
      .mockResolvedValueOnce(copy);
    vi.stubGlobal("fetch", mock);
    await expect(verifyAndPromoteBoardScene(config, grant)).rejects.toThrow(
      "Board scene verification failed",
    );
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it.each([
    "content-length",
    "content-type",
    "etag",
    "x-amz-meta-diagramid",
    "x-amz-meta-version",
    "x-amz-meta-rawsize",
    "x-amz-meta-rawsha256",
    "x-amz-meta-compressedsha256",
    "x-amz-meta-encoding",
  ])("rejects destination metadata mismatch: %s", async (name) => {
    const { grant, bytes } = fixture();
    const headers = new Headers(metadata(grant));
    headers.set(name, "wrong");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(sourceResponse(bytes))
        .mockResolvedValueOnce(copyResponse())
        .mockResolvedValueOnce(new Response(null, { headers })),
    );
    await expect(verifyAndPromoteBoardScene(config, grant)).rejects.toThrow(
      "Board scene verification failed",
    );
  });

  it("does not trust a preexisting destination when source is absent", async () => {
    const { grant } = fixture();
    const mock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", mock);
    await expect(verifyAndPromoteBoardScene(config, grant)).rejects.toThrow(
      "Board scene verification failed",
    );
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("sanitizes provider exceptions without leaking URLs or credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error(`secret ${config.secretAccessKey}`)),
    );
    await expect(
      verifyAndPromoteBoardScene(config, fixture().grant),
    ).rejects.toThrow(/^Board scene verification failed$/);
  });
});

describe("trusted exact-key cleanup", () => {
  it.each([
    "board-scenes/diagram-1/version-1",
    "board-scene-uploads/diagram-1/grant-1",
  ])("deletes only the exact authorized key %s", async (key) => {
    const mock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", mock);
    await deleteBoardSceneR2Object(config, key);
    const request = mock.mock.calls[0][0] as Request;
    expect(request.method).toBe("DELETE");
    expect(new URL(request.url).pathname).toBe(`/${config.bucket}/${key}`);
  });
  it("rejects a cleanup key outside both private namespaces", async () => {
    await expect(
      deleteBoardSceneR2Object(config, "assets/user.png"),
    ).rejects.toThrow("Board scene object key is invalid");
  });
  it("sanitizes failed deletion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error(config.secretAccessKey)),
    );
    await expect(
      deleteBoardSceneR2Object(config, fixture().grant.objectKey),
    ).rejects.toThrow(/^Board scene cleanup failed$/);
  });
});
