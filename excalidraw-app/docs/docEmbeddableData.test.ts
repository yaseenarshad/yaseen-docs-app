import { describe, expect, it } from "vitest";

import {
  createDocEmbeddableElement,
  getDocEmbeddableLink,
  getDocPlacementReference,
  isDocEmbeddableLink,
} from "./docEmbeddableData";

describe("Doc embeddable data", () => {
  it("accepts only a namespaced Doc reference with a stable id", () => {
    expect(
      getDocPlacementReference({
        type: "embeddable",
        link: "https://docs.yaseendraw.local/doc_123",
        customData: {
          yaseenDoc: { docId: "doc_123", titleSnapshot: "Strategy" },
        },
      }),
    ).toEqual({ docId: "doc_123", titleSnapshot: "Strategy" });

    expect(getDocPlacementReference({ customData: {} })).toBe(null);
    expect(
      getDocPlacementReference({
        type: "embeddable",
        link: "https://docs.yaseendraw.local/doc_123",
        customData: { yaseenDoc: { docId: "", titleSnapshot: "Strategy" } },
      }),
    ).toBe(null);
    expect(
      getDocPlacementReference({
        type: "rectangle",
        link: "https://docs.yaseendraw.local/doc_123",
        customData: {
          yaseenDoc: { docId: "doc_123", titleSnapshot: "Strategy" },
        },
      }),
    ).toBe(null);
    expect(
      getDocPlacementReference({
        type: "embeddable",
        link: "https://docs.yaseendraw.local/different",
        customData: {
          yaseenDoc: { docId: "doc_123", titleSnapshot: "Strategy" },
        },
      }),
    ).toBe(null);
  });

  it("recognizes only the reserved YaseenDraw Doc URL", () => {
    expect(isDocEmbeddableLink("https://docs.yaseendraw.local/doc_123")).toBe(
      true,
    );
    expect(isDocEmbeddableLink("https://example.com/doc_123")).toBe(false);
    expect(isDocEmbeddableLink(null)).toBe(false);
  });

  it("creates one native embeddable with namespaced reusable Doc data", () => {
    const element = createDocEmbeddableElement({
      docId: "doc_123",
      title: "Strategy",
      x: 10,
      y: 20,
    });

    expect(element).toMatchObject({
      type: "embeddable",
      x: 10,
      y: 20,
      width: 480,
      height: 560,
      link: getDocEmbeddableLink("doc_123"),
      customData: {
        yaseenDoc: { docId: "doc_123", titleSnapshot: "Strategy" },
      },
    });
    expect(getDocPlacementReference(element)).toEqual({
      docId: "doc_123",
      titleSnapshot: "Strategy",
    });
  });
});
