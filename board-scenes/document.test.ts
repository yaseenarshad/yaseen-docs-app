import { describe, expect, it } from "vitest";

import { decodeBoardSceneDocument } from "./document";

describe("strict Board scene document boundary", () => {
  it("returns original JSON formatting for readers without reserialization", () => {
    const json = '{ "elements": [], "appState": {} }';
    expect(decodeBoardSceneDocument(new TextEncoder().encode(json))).toBe(json);
  });
  it("throws a sanitized error for invalid documents", () => {
    expect(() =>
      decodeBoardSceneDocument(
        new TextEncoder().encode("private invalid content"),
      ),
    ).toThrow(/^Board scene document is invalid$/);
  });
  it("accepts the persisted Board document shape", () => {
    expect(
      decodeBoardSceneDocument(
        new TextEncoder().encode('{"elements":[],"appState":{},"files":{}}'),
      ),
    ).toBe('{"elements":[],"appState":{},"files":{}}');
  });
  it.each([
    "null",
    "[]",
    "{}",
    '{"elements":[]}',
    '{"elements":{},"appState":{}}',
    '{"elements":[],"appState":[]}',
    "not-json",
  ])("rejects invalid document %s", (json) => {
    expect(() =>
      decodeBoardSceneDocument(new TextEncoder().encode(json)),
    ).toThrow("document is invalid");
  });
  it("rejects invalid UTF-8 even within an otherwise valid JSON string", () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('{"elements":[],"appState":{},"text":"'),
      0xff,
      ...new TextEncoder().encode('"}'),
    ]);
    expect(() => decodeBoardSceneDocument(bytes)).toThrow(
      "document is invalid",
    );
  });
});
