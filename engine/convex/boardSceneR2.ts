"use node";

import { createHash } from "node:crypto";

import { AwsClient } from "aws4fetch";

import { inflateBoardScene } from "../board-scenes/compression";
import { decodeBoardSceneDocument } from "../board-scenes/document";
import {
  isBoardSceneObjectKey,
  BOARD_SCENE_STAGING_KEY_PREFIX,
  parseBoardSceneUploadGrant,
} from "../board-scenes/types";

import { getSceneSemanticRevision } from "./sceneConflict";

import type { BoardSceneUploadGrant } from "../board-scenes/types";

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_COPY_RESPONSE_BYTES = 65_536;
const VERIFICATION_ERROR = "Board scene verification failed";
const OBJECT_CACHE_CONTROL = "private, max-age=31536000, immutable";

export type BoardSceneR2Config = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};
export type StagedBoardSceneGrant = BoardSceneUploadGrant & {
  stagingObjectKey: string;
  expiresAt: number;
  semanticSha256?: string;
};
const isExactKey = (key: string) =>
  key.length <= 1024 &&
  /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(key) &&
  key
    .split("/")
    .every((part) => part !== "" && part !== "." && part !== "..") &&
  !key.includes("..");

const isStagingKey = (key: string) =>
  key.startsWith(BOARD_SCENE_STAGING_KEY_PREFIX) && isExactKey(key);

const clientFor = (config: BoardSceneR2Config) => {
  if (
    !/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com\/?$/.test(
      config.endpoint,
    ) ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucket) ||
    !config.accessKeyId.trim() ||
    !config.secretAccessKey.trim()
  ) {
    throw new Error("Board scene storage configuration is invalid");
  }
  return new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: "auto",
    service: "s3",
    // The caller owns retries and the finalization fence. Do not retry copies
    // independently or accept an existing final object without rereading source.
    retries: 0,
  });
};

const validateGrant = (grant: StagedBoardSceneGrant) => {
  if (
    !parseBoardSceneUploadGrant(grant) ||
    !isExactKey(grant.objectKey) ||
    !isStagingKey(grant.stagingObjectKey) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(grant.diagramId) ||
    !Number.isSafeInteger(grant.expiresAt) ||
    grant.expiresAt <= 0 ||
    (grant.semanticSha256 !== undefined &&
      !/^[a-f0-9]{64}$/.test(grant.semanticSha256))
  ) {
    throw new Error("Board scene upload grant is invalid");
  }
};

const urlFor = (config: BoardSceneR2Config, key: string) =>
  `${config.endpoint.replace(/\/$/, "")}/${config.bucket}/${key}`;

const metadataHeaders = (
  grant: StagedBoardSceneGrant,
): Record<string, string> => ({
  "x-amz-meta-diagramid": grant.diagramId,
  "x-amz-meta-version": String(grant.version),
  "x-amz-meta-rawsize": String(grant.rawSize),
  "x-amz-meta-rawsha256": grant.rawSha256,
  "x-amz-meta-compressedsha256": grant.compressedSha256,
  "x-amz-meta-encoding": grant.encoding,
  ...(grant.semanticSha256
    ? { "x-amz-meta-semanticsha256": grant.semanticSha256 }
    : {}),
});

/** The only browser-visible authority is an exact, create-only staging PUT. */
export const createBoardSceneDirectUpload = async (
  config: BoardSceneR2Config,
  grant: StagedBoardSceneGrant,
): Promise<{
  url: string;
  headers: Record<string, string>;
  expiresAt: number;
}> => {
  const client = clientFor(config);
  validateGrant(grant);
  const now = Date.now();
  const ttl = Math.min(60, Math.floor((grant.expiresAt - now) / 1000));
  if (ttl < 1) {
    throw new Error("Board scene upload grant is invalid");
  }
  try {
    const request = await client.sign(
      `${urlFor(config, grant.stagingObjectKey)}?X-Amz-Expires=${ttl}`,
      {
        method: "PUT",
        headers: {
          "content-type": grant.contentType,
          "if-none-match": "*",
          "x-amz-checksum-sha256": Buffer.from(
            grant.compressedSha256,
            "hex",
          ).toString("base64"),
          ...metadataHeaders(grant),
        },
        aws: {
          signQuery: true,
          allHeaders: true,
          datetime: new Date(now).toISOString().replace(/[:-]|\.\d{3}/g, ""),
        },
      },
    );
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return {
      url: request.url,
      headers,
      // AWS signs to whole seconds; report the actual effective expiration.
      expiresAt: Math.floor(now / 1000) * 1000 + ttl * 1000,
    };
  } catch {
    throw new Error("Board scene upload could not be authorized");
  }
};

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const etagFrom = (value: string | null): string => {
  if (!value || !/^"[A-Za-z0-9_-]{1,128}"$/.test(value)) {
    throw new Error(VERIFICATION_ERROR);
  }
  return value.slice(1, -1);
};

/** Cancelling is best effort and never holds completion hostage to a provider. */
const cancelBody = (body: ReadableStream<Uint8Array> | null) => {
  if (body && !body.locked) {
    void body.cancel().catch(() => undefined);
  }
};

/** A single deadline covers response headers AND every streamed body chunk. */
const requestR2 = async <T>(
  client: AwsClient,
  url: string,
  init: RequestInit,
  consume: (
    response: Response,
    wait: <U>(promise: Promise<U>) => Promise<U>,
  ) => Promise<T>,
): Promise<T> => {
  const controller = new AbortController();
  let rejectTimeout: (error: Error) => void = () => undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
  });
  const timer = setTimeout(() => {
    controller.abort();
    rejectTimeout(new Error(VERIFICATION_ERROR));
  }, REQUEST_TIMEOUT_MS);
  const wait = <U>(promise: Promise<U>): Promise<U> =>
    Promise.race([promise, timeout]);
  let response: Response | undefined;
  try {
    const request = await wait(
      client.sign(url, {
        ...init,
        redirect: "error",
        signal: controller.signal,
        aws: { allHeaders: true },
      }),
    );
    response = await wait(fetch(request));
    if (!response.ok) {
      throw new Error(VERIFICATION_ERROR);
    }
    return await wait(consume(response, wait));
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (response) {
      cancelBody(response.body);
    }
  }
};

const readBounded = async (
  response: Response,
  maxBytes: number,
  wait: <U>(promise: Promise<U>) => Promise<U>,
): Promise<Uint8Array> => {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    throw new Error(VERIFICATION_ERROR);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error(VERIFICATION_ERROR);
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await wait(reader.read());
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > maxBytes) {
        throw new Error(VERIFICATION_ERROR);
      }
      chunks.push(value);
    }
  } catch {
    void reader.cancel().catch(() => undefined);
    throw new Error(VERIFICATION_ERROR);
  } finally {
    reader.releaseLock();
  }
  if (length !== null && Number(length) !== size) {
    throw new Error(VERIFICATION_ERROR);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

/**
 * Only the backend calls this helper, after atomically claiming finalization.
 * Expiry controls URL issuance, not an already accepted verification job.
 * Never return or log a document; the small result alone may enter Convex.
 */
export const verifyAndPromoteBoardScene = async (
  config: BoardSceneR2Config,
  grant: StagedBoardSceneGrant,
): Promise<{ etag: string }> => {
  const client = clientFor(config);
  validateGrant(grant);
  try {
    const sourceEtag = await requestR2(
      client,
      urlFor(config, grant.stagingObjectKey),
      { method: "GET" },
      async (response, wait) => {
        const etag = etagFrom(response.headers.get("etag"));
        const contentEncoding = response.headers.get("content-encoding");
        if (contentEncoding && contentEncoding !== "identity") {
          throw new Error(VERIFICATION_ERROR);
        }
        const compressed = await readBounded(
          response,
          grant.compressedSize,
          wait,
        );
        if (
          compressed.byteLength !== grant.compressedSize ||
          sha256(compressed) !== grant.compressedSha256
        ) {
          throw new Error(VERIFICATION_ERROR);
        }
        const raw = inflateBoardScene(compressed, grant.rawSize);
        if (
          raw.byteLength !== grant.rawSize ||
          sha256(raw) !== grant.rawSha256
        ) {
          throw new Error(VERIFICATION_ERROR);
        }
        const json = decodeBoardSceneDocument(raw);
        if (
          grant.semanticSha256 &&
          sha256(new TextEncoder().encode(getSceneSemanticRevision(json))) !==
            grant.semanticSha256
        ) {
          throw new Error(VERIFICATION_ERROR);
        }
        return etag;
      },
    );

    // Immutable final keys are unique per fenced grant. The source condition
    // binds the native copy to the exact object version whose bytes we read.
    const destinationEtag = await requestR2(
      client,
      urlFor(config, grant.objectKey),
      {
        method: "PUT",
        headers: {
          "x-amz-copy-source": `/${config.bucket}/${grant.stagingObjectKey}`,
          "x-amz-copy-source-if-match": `"${sourceEtag}"`,
          "x-amz-metadata-directive": "REPLACE",
          "content-type": grant.contentType,
          "cache-control": OBJECT_CACHE_CONTROL,
          ...metadataHeaders(grant),
        },
      },
      async (response, wait) => {
        const xml = new TextDecoder("utf-8", { fatal: true }).decode(
          await readBounded(response, MAX_COPY_RESPONSE_BYTES, wait),
        );
        // S3 can report a copy error inside an HTTP 200 response. No untrusted
        // XML parser/entities are needed for the small, fixed provider result.
        if (
          /<(?:[\w-]+:)?Error\b/i.test(xml) ||
          /<!DOCTYPE|<!ENTITY/i.test(xml) ||
          !/<CopyObjectResult(?:\s[^>]*)?>[\s\S]*<\/CopyObjectResult>/.test(xml)
        ) {
          throw new Error(VERIFICATION_ERROR);
        }
        const matches = [...xml.matchAll(/<ETag>([^<]+)<\/ETag>/g)];
        if (matches.length !== 1) {
          throw new Error(VERIFICATION_ERROR);
        }
        return etagFrom(matches[0][1].replace(/&quot;/g, '"'));
      },
    );

    await requestR2(
      client,
      urlFor(config, grant.objectKey),
      { method: "HEAD" },
      async (response) => {
        const headers = response.headers;
        if (
          headers.get("content-length") !== String(grant.compressedSize) ||
          headers.get("content-type") !== grant.contentType ||
          etagFrom(headers.get("etag")) !== destinationEtag ||
          Object.entries(metadataHeaders(grant)).some(
            ([key, value]) => headers.get(key) !== value,
          )
        ) {
          throw new Error(VERIFICATION_ERROR);
        }
        // R2 native copies omit x-amz-checksum-sha256. Actual source bytes,
        // authenticated conditional copy, and destination metadata are the proof.
      },
    );
    return { etag: destinationEtag };
  } catch {
    throw new Error(VERIFICATION_ERROR);
  }
};

/** Cleanup callers supply only exact keys from trusted grant/manifest records. */
export const deleteBoardSceneR2Object = async (
  config: BoardSceneR2Config,
  objectKey: string,
): Promise<void> => {
  const client = clientFor(config);
  if (
    !isExactKey(objectKey) ||
    (!isBoardSceneObjectKey(objectKey) && !isStagingKey(objectKey))
  ) {
    throw new Error("Board scene object key is invalid");
  }
  try {
    await requestR2(
      client,
      urlFor(config, objectKey),
      { method: "DELETE" },
      async () => undefined,
    );
  } catch {
    throw new Error("Board scene cleanup failed");
  }
};
