import { describe, expect, it } from "vitest";

import { parseDocsMode } from "./types";

describe("Docs mode", () => {
  it("accepts only authoritative modes and otherwise fails closed", () => {
    expect(parseDocsMode("on")).toBe("on");
    expect(parseDocsMode("read-only")).toBe("read-only");
    expect(parseDocsMode("off")).toBe("off");
    expect(parseDocsMode(undefined)).toBe("off");
    expect(parseDocsMode("enabled")).toBe("off");
  });
});
