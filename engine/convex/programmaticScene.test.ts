import {
  patchElementsInScene,
  updateTextElementInScene,
} from "./programmaticScene";

describe("updateTextElementInScene", () => {
  it("updates only the targeted text element", () => {
    const sceneJson = JSON.stringify({
      elements: [
        {
          id: "headline",
          type: "text",
          text: "Old headline",
          originalText: "Old headline",
          version: 7,
          versionNonce: 100,
          updated: 1,
        },
        {
          id: "other",
          type: "text",
          text: "Leave me alone",
          originalText: "Leave me alone",
          version: 2,
          versionNonce: 200,
          updated: 2,
        },
      ],
      appState: {},
      files: {},
    });

    const updatedScene = JSON.parse(
      updateTextElementInScene(
        sceneJson,
        "headline",
        "yaseen how are you",
        1234,
      ),
    );

    expect(updatedScene.elements[0]).toMatchObject({
      id: "headline",
      text: "yaseen how are you",
      originalText: "yaseen how are you",
      version: 8,
      updated: 1234,
    });
    expect(updatedScene.elements[0].versionNonce).not.toBe(100);
    expect(updatedScene.elements[1]).toEqual({
      id: "other",
      type: "text",
      text: "Leave me alone",
      originalText: "Leave me alone",
      version: 2,
      versionNonce: 200,
      updated: 2,
    });
  });

  it("rejects a missing or non-text target", () => {
    const sceneJson = JSON.stringify({
      elements: [{ id: "box", type: "rectangle" }],
      appState: {},
      files: {},
    });

    expect(() =>
      updateTextElementInScene(sceneJson, "missing", "New text", 1234),
    ).toThrow("Text element not found");
    expect(() =>
      updateTextElementInScene(sceneJson, "box", "New text", 1234),
    ).toThrow("Text element not found");
  });
});

describe("patchElementsInScene", () => {
  it("patches multiple element properties without changing element identity", () => {
    const sceneJson = JSON.stringify({
      elements: [
        {
          id: "headline",
          type: "text",
          text: "Old headline",
          originalText: "Old headline",
          x: 10,
          y: 20,
          fontSize: 32,
          version: 3,
          versionNonce: 123,
          updated: 1,
        },
      ],
      appState: {},
      files: {},
    });

    const updatedScene = JSON.parse(
      patchElementsInScene(
        sceneJson,
        JSON.stringify([
          {
            elementId: "headline",
            patch: {
              id: "replace-me",
              type: "rectangle",
              text: "New headline",
              x: 100,
              y: 200,
              fontSize: 72,
            },
          },
        ]),
        5678,
      ),
    );

    expect(updatedScene.elements[0]).toMatchObject({
      id: "headline",
      type: "text",
      text: "New headline",
      originalText: "New headline",
      x: 100,
      y: 200,
      fontSize: 72,
      version: 4,
      updated: 5678,
    });
  });

  it("rejects malformed updates and missing targets", () => {
    const sceneJson = JSON.stringify({
      elements: [{ id: "box", type: "rectangle", version: 1 }],
      appState: {},
      files: {},
    });

    expect(() => patchElementsInScene(sceneJson, "{}", 5678)).toThrow(
      "Element updates are invalid",
    );
    expect(() =>
      patchElementsInScene(
        sceneJson,
        JSON.stringify([{ elementId: "missing", patch: { x: 10 } }]),
        5678,
      ),
    ).toThrow("Element not found");
  });
});
