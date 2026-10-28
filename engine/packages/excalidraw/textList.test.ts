import {
  cycleTextList,
  continueTextListItem,
  formatPastedTextForList,
  getBulletMarkerForDepth,
  hasTextList,
  getTextListMode,
  indentTextList,
  parseTextListLine,
  renumberTextLists,
  normalizeTextLists,
  setTextListMode,
} from "./textList";

describe("text list engine", () => {
  it("parses supported prefixes and rejects prose lookalikes", () => {
    expect(parseTextListLine("    ○ Nested")).toMatchObject({
      indentation: "    ",
      depth: 1,
      marker: "○",
      markerKind: "bullet",
      content: "Nested",
    });
    expect(parseTextListLine("12. Numbered")).toMatchObject({
      depth: 0,
      marker: "12.",
      markerKind: "number",
      content: "Numbered",
    });
    expect(parseTextListLine("12.Numbered").markerKind).toBe("none");
    expect(parseTextListLine("Version 12. Numbered").markerKind).toBe("none");
    expect(parseTextListLine("").markerKind).toBe("none");
  });

  it("repeats the approved bullet marker sequence by depth", () => {
    expect(
      Array.from({ length: 7 }, (_, depth) => getBulletMarkerForDepth(depth)),
    ).toEqual(["•", "○", "▪", "•", "○", "▪", "•"]);
  });

  it("detects supported list lines without treating prose as a list", () => {
    expect(hasTextList("Intro\n• Item")).toBe(true);
    expect(hasTextList("Intro\n    10. Nested number")).toBe(true);
    expect(hasTextList("Version 10. Notes\nPlain text")).toBe(false);
  });

  it("cycles plain, bulleted, and numbered logical lines", () => {
    const bulleted = cycleTextList("One\n    Two", 0, 11);
    expect(bulleted.text).toBe("• One\n    ○ Two");
    expect(getTextListMode(bulleted.text, 0, bulleted.text.length)).toBe(
      "bullet",
    );

    const numbered = cycleTextList(bulleted.text, 0, bulleted.text.length);
    expect(numbered.text).toBe("1. One\n    ○ Two");
    expect(getTextListMode(numbered.text, 0, numbered.text.length)).toBe(
      "numbered",
    );

    const plain = cycleTextList(numbered.text, 0, numbered.text.length);
    expect(plain.text).toBe("One\n    Two");
  });

  it("normalizes mixed targets to bullets and honors exact-newline boundaries", () => {
    expect(cycleTextList("1. One\nTwo", 0, 10).text).toBe("• One\n• Two");
    expect(cycleTextList("One\nTwo", 0, 4).text).toBe("• One\nTwo");
  });

  it("sets every selected target to one explicit mode", () => {
    const numbered = setTextListMode("• One\nTwo", 0, 9, "numbered");
    expect(numbered).toMatchObject({
      text: "1. One\n2. Two",
      mode: "numbered",
      selectionStart: 0,
      selectionEnd: 13,
    });

    expect(
      setTextListMode(numbered.text, 0, numbered.text.length, "plain").text,
    ).toBe("One\nTwo");
  });

  it("renumbers roots while preserving nested children and block restarts", () => {
    expect(
      renumberTextLists("8. First\n    • Child\n42. Second\n\n9. Separate"),
    ).toBe("1. First\n    ○ Child\n2. Second\n\n1. Separate");
  });

  it("renumbers after edits while preserving the caret", () => {
    expect(normalizeTextLists("1. First\n8. Second", 18, 18)).toMatchObject({
      text: "1. First\n2. Second",
      selectionStart: 18,
      selectionEnd: 18,
      mode: "numbered",
    });
  });

  it("restores caret and selection offsets after marker-length changes", () => {
    expect(cycleTextList("One", 1, 1)).toMatchObject({
      text: "• One",
      selectionStart: 3,
      selectionEnd: 3,
    });

    expect(cycleTextList("One\nTwo", 0, 7)).toMatchObject({
      text: "• One\n• Two",
      selectionStart: 0,
      selectionEnd: 11,
    });
  });

  it("indents and outdents list lines while recomputing markers", () => {
    expect(indentTextList("• Root", 0, 6, 1).text).toBe("    ○ Root");
    expect(
      indentTextList("1. Root\n    ○ Child\n2. Next", 8, 19, -1).text,
    ).toBe("1. Root\n2. Child\n3. Next");
    expect(indentTextList("• Root", 0, 6, -1).text).toBe("• Root");
  });

  it("continues, outdents, and exits list items on Enter", () => {
    expect(continueTextListItem("1. First\n2. Second", 8, 8)).toMatchObject({
      text: "1. First\n2. \n3. Second",
      selectionStart: 12,
      selectionEnd: 12,
    });
    expect(continueTextListItem("1. Root\n    ○ ", 14, 14)).toMatchObject({
      text: "1. Root\n2. ",
      selectionStart: 11,
      selectionEnd: 11,
    });
    expect(continueTextListItem("• ", 2, 2)).toMatchObject({
      text: "",
      selectionStart: 0,
      selectionEnd: 0,
    });
  });

  it("normalizes pasted list and plain lines into the receiving list", () => {
    expect(formatPastedTextForList("Alpha\n    • Child", "numbered", 0)).toBe(
      "1. Alpha\n    ○ Child",
    );
    expect(formatPastedTextForList("• One\n    ○ Two", "bullet", 2)).toBe(
      "        ▪ One\n            • Two",
    );
  });
});
