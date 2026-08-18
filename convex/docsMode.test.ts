import { afterEach, describe, expect, it } from "vitest";

import {
  getDocsMode,
  requireDocsReadable,
  requireDocsWritable,
} from "./docsMode";

const previous = process.env.YASEENDRAW_DOCS_MODE;
const previousNodeEnv = process.env.NODE_ENV;
afterEach(() => {
  if (previous === undefined) {
    delete process.env.YASEENDRAW_DOCS_MODE;
  } else {
    process.env.YASEENDRAW_DOCS_MODE = previous;
  }
  if (previousNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = previousNodeEnv;
  }
});

describe("authoritative Convex Docs mode", () => {
  it("allows reads in read-only while rejecting writes", () => {
    process.env.YASEENDRAW_DOCS_MODE = "read-only";
    expect(getDocsMode()).toBe("read-only");
    expect(requireDocsReadable).not.toThrow();
    expect(requireDocsWritable).toThrow("read-only");
  });

  it("fails closed for missing/invalid production configuration", () => {
    process.env.NODE_ENV = "production";
    process.env.YASEENDRAW_DOCS_MODE = "invalid";
    expect(getDocsMode()).toBe("off");
    expect(requireDocsReadable).toThrow("disabled");
  });
});
