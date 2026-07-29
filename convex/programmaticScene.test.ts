import { updateTextElementInScene } from "./programmaticScene";

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
