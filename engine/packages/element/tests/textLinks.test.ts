import {
  getStyledVisualLines,
  getTextElementStyledLines,
} from "../src/textLineUnderlines";
import { getTextLinkAt } from "../src/textLinkHit";
import {
  getLinkPillColors,
  getLinkPillMetrics,
  getLinkPillWidth,
  getTextLinks,
  registerHostLinkResolver,
} from "../src/textLinks";
import { setCustomTextMetricsProvider } from "../src/textMeasurements";

import type { ExcalidrawTextElement, FontString } from "../src/types";

/** YAZ-4039 D7: `[[inner]]` in a text box is a link run, drawn as a pill. */

const font = "10px Links" as FontString;
const args = {
  getFont: () => font,
  textRuns: undefined,
  wholeElementBold: false,
  wholeElementItalic: false,
  wholeElementUnderlined: false,
  wholeElementStrikethrough: false,
};

const pages: Record<string, string> = {
  "YAS-1": "Growth plan",
  Notes: "Notes",
};

let unregister: () => void = () => {};

beforeEach(() => {
  setCustomTextMetricsProvider({ getLineWidth: (text) => text.length * 10 });
  unregister = registerHostLinkResolver((inner) =>
    pages[inner] ? { label: pages[inner] } : { label: inner, missing: true },
  );
});

afterEach(() => {
  unregister();
});

describe("link runs", () => {
  it("finds the links of a line and leaves embeds", () => {
    expect(getTextLinks("see [[YAS-1]] and ![[pic.png]]")).toEqual([
      { start: 4, end: 13, inner: "YAS-1", label: "Growth plan" },
    ]);
  });

  it("stays plain text with no host", () => {
    unregister();
    expect(getTextLinks("see [[YAS-1]]")).toEqual([]);
    const [line] = getStyledVisualLines({
      ...args,
      originalText: "see [[YAS-1]]",
      maxWidth: Infinity,
    });
    expect(line.segments).toBeUndefined();
  });

  it("gives a line with no link today's layout", () => {
    const [plain, linked] = getStyledVisualLines({
      ...args,
      originalText: "plain words\nsee [[YAS-1]]",
      maxWidth: Infinity,
    });
    expect(plain.segments).toBeUndefined();
    expect(plain.width).toBe(110);
    expect(linked.segments).toHaveLength(2);
  });

  it("draws the pill at the width of the page's name and icon", () => {
    const [line] = getStyledVisualLines({
      ...args,
      originalText: "see [[YAS-1]] now",
      maxWidth: Infinity,
    });
    const pill = getLinkPillWidth("Growth plan", font);
    const { padding, iconSize, gap } = getLinkPillMetrics(font);
    expect(pill).toBe(padding * 2 + iconSize + gap + 110);
    expect(line.segments).toEqual([
      expect.objectContaining({ text: "see ", x: 0, width: 40 }),
      expect.objectContaining({
        text: "[[YAS-1]]",
        start: 4,
        end: 13,
        x: 40,
        width: pill,
        link: { inner: "YAS-1", label: "Growth plan" },
      }),
      expect.objectContaining({ text: " now", x: 40 + pill, width: 40 }),
    ]);
    expect(line.width).toBe(80 + pill);
  });

  it("wraps the pill whole, by its drawn width", () => {
    // the raw text fits in 140px; the pill (about 130px) after "see " does not
    const lines = getStyledVisualLines({
      ...args,
      originalText: "see [[YAS-1]]",
      maxWidth: 140,
    });
    expect(lines.map((line) => line.text)).toEqual(["see", "[[YAS-1]]"]);
    expect(lines[1].segments?.[0].link?.label).toBe("Growth plan");
  });

  it("never breaks a pill that is wider than the box", () => {
    const lines = getStyledVisualLines({
      ...args,
      originalText: "[[YAS-1]]",
      maxWidth: 50,
    });
    expect(lines.map((line) => line.text)).toEqual(["[[YAS-1]]"]);
  });

  it("keeps a bold run on the pill", () => {
    const [line] = getStyledVisualLines({
      ...args,
      getFont: ({ bold }) => (bold ? "bold 10px Links" : font) as FontString,
      originalText: "[[Notes]] x",
      maxWidth: Infinity,
      textRuns: [{ start: 2, end: 5, bold: true }],
    });
    expect(line.segments?.[0]).toMatchObject({
      text: "[[Notes]]",
      bold: false,
      link: { label: "Notes" },
    });
  });

  it("marks a missing page: a dim pill with no background", () => {
    const [line] = getStyledVisualLines({
      ...args,
      originalText: "[[Gone]]",
      maxWidth: Infinity,
    });
    expect(line.segments?.[0].link).toEqual({
      inner: "Gone",
      label: "Gone",
      missing: true,
    });
    expect(getLinkPillColors(false, true).background).toBeNull();
    expect(getLinkPillColors(false, false).background).not.toBeNull();
  });
});

describe("the hit test", () => {
  const element = {
    id: "text-1",
    type: "text",
    x: 100,
    y: 50,
    width: 140,
    height: 50,
    angle: 0,
    fontSize: 10,
    fontFamily: 5,
    lineHeight: 1.25,
    textAlign: "left",
    verticalAlign: "top",
    originalText: "see [[YAS-1]]",
    text: "see\n[[YAS-1]]",
    autoResize: false,
  } as unknown as ExcalidrawTextElement;
  const lineHeight = 12.5;

  it("finds the pill in a wrapped line", () => {
    const hit = getTextLinkAt(element, 140, {
      x: 110,
      y: 50 + lineHeight * 1.5,
    });
    expect(hit).toMatchObject({
      lineIndex: 1,
      segment: { start: 4, end: 13, link: { inner: "YAS-1" } },
      rect: { x: 100, y: 50 + lineHeight, height: lineHeight },
    });
  });

  it("finds nothing on the plain words or past the pill", () => {
    expect(getTextLinkAt(element, 140, { x: 110, y: 55 })).toBeNull();
    expect(
      getTextLinkAt(element, 140, { x: 239, y: 50 + lineHeight * 1.5 }),
    ).toBeNull();
  });

  it("uses the layout memo: pointer moves measure no text", () => {
    const box = { ...element, id: "text-memo" } as ExcalidrawTextElement;
    let measures = 0;
    setCustomTextMetricsProvider({
      getLineWidth: (text) => {
        measures++;
        return text.length * 10;
      },
    });
    const first = getTextElementStyledLines(box, 140, box.originalText);
    const laidOut = measures;
    expect(laidOut).toBeGreaterThan(0);
    for (let move = 0; move < 50; move++) {
      getTextLinkAt(box, 140, { x: 100 + move, y: 50 + lineHeight * 1.5 });
    }
    expect(measures).toBe(laidOut);
    expect(getTextElementStyledLines(box, 140, box.originalText)).toBe(first);
  });
});
