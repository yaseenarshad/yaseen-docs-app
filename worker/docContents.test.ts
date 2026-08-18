import { deflate, inflate } from "pako";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DOC_CONTENT_CONTENT_TYPE,
  DOC_CONTENT_DELETE_GRANT_PATH,
  DOC_CONTENT_ENCODING,
  DOC_CONTENT_ENCODING_HEADER,
  DOC_CONTENT_READ_GRANT_PATH,
  DOC_CONTENT_UPLOAD_GRANT_PATH,
} from "../doc-content/types";

import worker from "./index";

afterEach(() => vi.unstubAllGlobals());

const CONVEX_SITE_URL = "https://convex.example.test";
const DOC_ID = "doc-abc";
const OBJECT_KEY = `doc-content/${DOC_ID}/content.bin`;
const READ_TOKEN = "a".repeat(64);
const markdown = "# Plan\n\n* Parent\n  * Child\n";
const rawBytes = new TextEncoder().encode(markdown);
const compressedBytes = deflate(rawBytes);

const sha256 = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        bytes.slice().buffer as ArrayBuffer,
      ),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const uploadGrant = async (overrides: Record<string, unknown> = {}) => ({
  objectKey: OBJECT_KEY,
  docId: DOC_ID,
  version: 2,
  encoding: DOC_CONTENT_ENCODING,
  contentType: DOC_CONTENT_CONTENT_TYPE,
  compressedSize: compressedBytes.byteLength,
  compressedSha256: await sha256(compressedBytes),
  rawSize: rawBytes.byteLength,
  rawSha256: await sha256(rawBytes),
  ...overrides,
});

type Stored = {
  bytes: Uint8Array;
  etag: string;
  customMetadata?: Record<string, string>;
};

const createBucket = () => {
  const objects = new Map<string, Stored>();
  return {
    objects,
    put: vi.fn(
      async (
        key: string,
        body: ArrayBuffer | Uint8Array,
        options?: { customMetadata?: Record<string, string> },
      ) => {
        const bytes =
          body instanceof Uint8Array
            ? body
            : new Uint8Array(body as ArrayBuffer);
        const etag = `etag-${bytes.byteLength}`;
        objects.set(key, {
          bytes,
          etag,
          customMetadata: options?.customMetadata,
        });
        return { key, etag, httpEtag: `"${etag}"`, size: bytes.byteLength };
      },
    ),
    get: vi.fn(async (key: string) => {
      const object = objects.get(key);
      return object
        ? {
            key,
            body: object.bytes,
            size: object.bytes.byteLength,
            etag: object.etag,
            httpEtag: `"${object.etag}"`,
            customMetadata: object.customMetadata,
          }
        : null;
    }),
    delete: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        objects.delete(key);
      }
    }),
    list: vi.fn(async () => ({ objects: [], truncated: false as const })),
  };
};

const stubConvex = (routes: Record<string, unknown>) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const response = routes[new URL(url).pathname];
      return response instanceof Response
        ? response
        : response === undefined
        ? new Response(null, { status: 404 })
        : Response.json(response);
    }),
  );
};

const run = async (request: Request, bucket: ReturnType<typeof createBucket>) =>
  await worker.fetch!(
    request,
    {
      CONVEX_SITE_URL,
      DOCS_MODE: "on",
      DIAGRAM_ASSETS: bucket,
      ASSETS: { fetch: vi.fn() },
    } as never,
    {} as ExecutionContext,
  );

describe("private Doc content Worker routes", () => {
  it("uploads verified UTF-8 Markdown and serves the exact immutable bytes", async () => {
    const grant = await uploadGrant();
    stubConvex({ [DOC_CONTENT_UPLOAD_GRANT_PATH]: grant });
    const bucket = createBucket();
    const upload = await run(
      new Request("https://draw.example.test/api/doc-content", {
        method: "POST",
        headers: {
          Authorization: "Bearer upload-token",
          "Content-Type": DOC_CONTENT_CONTENT_TYPE,
          [DOC_CONTENT_ENCODING_HEADER]: DOC_CONTENT_ENCODING,
        },
        body: compressedBytes,
      }),
      bucket,
    );
    expect(upload.status).toBe(200);
    const uploadResult = await upload.json();
    expect(uploadResult).toEqual({ etag: expect.any(String), version: 2 });
    expect(JSON.stringify(uploadResult)).not.toContain(OBJECT_KEY);
    expect(bucket.objects.get(OBJECT_KEY)?.customMetadata).toMatchObject({
      docId: DOC_ID,
      version: "2",
      rawSha256: grant.rawSha256,
    });

    vi.unstubAllGlobals();
    stubConvex({
      [DOC_CONTENT_READ_GRANT_PATH]: {
        ...grant,
        etag: bucket.objects.get(OBJECT_KEY)!.etag,
        expiresAt: Date.now() + 300_000,
      },
    });
    const read = await run(
      new Request(`https://draw.example.test/api/doc-content/${READ_TOKEN}`),
      bucket,
    );
    expect(read.status).toBe(200);
    expect(read.headers.get("Cache-Control")).toBe(
      "private, max-age=300, immutable",
    );
    expect(new TextDecoder().decode(inflate(await read.arrayBuffer()))).toBe(
      markdown,
    );
  });

  it("rejects decompressed bytes that are not valid UTF-8 Markdown", async () => {
    const invalidRaw = new Uint8Array([0xc3, 0x28]);
    const invalidCompressed = deflate(invalidRaw);
    stubConvex({
      [DOC_CONTENT_UPLOAD_GRANT_PATH]: {
        ...(await uploadGrant()),
        rawSize: invalidRaw.byteLength,
        rawSha256: await sha256(invalidRaw),
        compressedSize: invalidCompressed.byteLength,
        compressedSha256: await sha256(invalidCompressed),
      },
    });
    const bucket = createBucket();
    const response = await run(
      new Request("https://draw.example.test/api/doc-content", {
        method: "POST",
        headers: {
          Authorization: "Bearer upload-token",
          "Content-Type": DOC_CONTENT_CONTENT_TYPE,
          [DOC_CONTENT_ENCODING_HEADER]: DOC_CONTENT_ENCODING,
        },
        body: invalidCompressed,
      }),
      bucket,
    );

    expect(response.status).toBe(400);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("deletes only capability-approved Doc objects and is retry-safe", async () => {
    const bucket = createBucket();
    bucket.objects.set(OBJECT_KEY, {
      bytes: compressedBytes,
      etag: "etag",
    });
    stubConvex({
      [DOC_CONTENT_DELETE_GRANT_PATH]: { objectKeys: [OBJECT_KEY] },
    });

    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await run(
        new Request("https://draw.example.test/api/doc-content", {
          method: "DELETE",
          headers: { Authorization: "Bearer delete-token" },
        }),
        bucket,
      );
      expect(response.status).toBe(200);
    }
    expect(bucket.objects.has(OBJECT_KEY)).toBe(false);
  });
});
