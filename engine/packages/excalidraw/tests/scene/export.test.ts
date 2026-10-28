import { exportToCanvas, exportToSvg } from "@excalidraw/utils";

import {
  applyDarkModeFilter,
  BOUND_TEXT_PADDING,
  FONT_FAMILY,
  FRAME_STYLE,
  ROUNDNESS,
} from "@excalidraw/common";

import { pointFrom } from "@excalidraw/math";
import {
  getStyledVisualLineStart,
  getTextBackgroundGeometry,
  getTextElementStyledLayout,
} from "@excalidraw/element";

import type {
  ExcalidrawTextElement,
  FileId,
  FractionalIndex,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import type { LocalPoint } from "@excalidraw/math";

import { prepareElementsForExport } from "../../data";
import * as exportUtils from "../../scene/export";
import {
  diamondFixture,
  ellipseFixture,
  rectangleWithLinkFixture,
  textFixture,
} from "../fixtures/elementFixture";
import { API } from "../helpers/api";

import { getDefaultAppState } from "../../appState";

import type { BinaryFiles, DataURL } from "../../types";

describe("exportToSvg", () => {
  const ELEMENT_HEIGHT = 100;
  const ELEMENT_WIDTH = 100;
  const ELEMENTS = [
    {
      ...diamondFixture,
      height: ELEMENT_HEIGHT,
      width: ELEMENT_WIDTH,
      index: "a0",
    },
    {
      ...ellipseFixture,
      height: ELEMENT_HEIGHT,
      width: ELEMENT_WIDTH,
      index: "a1",
    },
    {
      ...textFixture,
      height: ELEMENT_HEIGHT,
      width: ELEMENT_WIDTH,
      index: "a2",
    },
    {
      ...textFixture,
      fontFamily: FONT_FAMILY.Nunito, // test embedding external font
      height: ELEMENT_HEIGHT,
      width: ELEMENT_WIDTH,
      index: "a3",
    },
  ] as NonDeletedExcalidrawElement[];

  const DEFAULT_OPTIONS = {
    exportBackground: false,
    viewBackgroundColor: "#ffffff",
    files: {},
  };

  it("with default arguments", async () => {
    const svgElement = await exportUtils.exportToSvg(
      ELEMENTS,
      DEFAULT_OPTIONS,
      null,
    );

    expect(svgElement).toMatchSnapshot();
  });

  it("with a CJK font", async () => {
    const svgElement = await exportUtils.exportToSvg(
      [
        ...ELEMENTS,
        {
          ...textFixture,
          height: ELEMENT_HEIGHT,
          width: ELEMENT_WIDTH,
          text: "中国你好！这是一个测试。中国你好！日本こんにちは！これはテストです。한국 안녕하세요! 이것은 테스트입니다.",
          originalText:
            "中国你好！这是一个测试。中国你好！日本こんにちは！これはテストです。한국 안녕하세요! 이것은 테스트입니다.",
          index: "a4" as FractionalIndex,
        } as NonDeleted<ExcalidrawTextElement>,
      ],
      DEFAULT_OPTIONS,
      null,
    );

    expect(svgElement).toMatchSnapshot();
    // extend the timeout, as it needs to first load the fonts from disk and then perform whole woff2 decode, subset and encode (without workers)
  }, 30_000);

  it("with background color", async () => {
    const BACKGROUND_COLOR = "#abcdef";

    const svgElement = await exportUtils.exportToSvg(
      ELEMENTS,
      {
        ...DEFAULT_OPTIONS,
        exportBackground: true,
        viewBackgroundColor: BACKGROUND_COLOR,
      },
      null,
    );

    expect(svgElement.querySelector("rect")).toHaveAttribute(
      "fill",
      BACKGROUND_COLOR,
    );
  });

  it("renders a native rounded free-text background before its glyphs", async () => {
    const text = {
      ...textFixture,
      id: "native-text-background",
      width: 100,
      height: 40,
      backgroundColor: "#ff0000",
      backgroundPaddingScale: 2,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 64 },
      index: "a0" as FractionalIndex,
    } as NonDeleted<ExcalidrawTextElement>;

    const svg = await exportUtils.exportToSvg([text], DEFAULT_OPTIONS, null);
    const group = svg.querySelector(`[data-id="${text.id}"]`);
    const background = group?.querySelector("rect");
    const geometry = getTextBackgroundGeometry(text)!;

    expect(background).not.toBeNull();
    expect(background).toHaveAttribute("fill", "#ff0000");
    expect(background).toHaveAttribute("x", `${geometry.x}`);
    expect(background).toHaveAttribute("y", `${geometry.y}`);
    expect(background).toHaveAttribute("width", `${geometry.width}`);
    expect(background).toHaveAttribute("height", `${geometry.height}`);
    expect(background).toHaveAttribute("rx", `${geometry.radius}`);
    expect(group?.firstElementChild).toBe(background);
  });

  it("with dark mode", async () => {
    const svgElement = await exportUtils.exportToSvg(
      ELEMENTS,
      {
        ...DEFAULT_OPTIONS,
        exportWithDarkMode: true,
      },
      null,
    );

    const textElements = svgElement.querySelectorAll("text");
    expect(textElements.length).toBeGreaterThan(0);

    textElements.forEach((textEl) => {
      // fill color should be inverted in dark mode
      expect(textEl.getAttribute("fill")).toBe(
        applyDarkModeFilter(textFixture.strokeColor),
      );
    });
  });

  it("exports combined logical-line text styles", async () => {
    const lineStyledText = {
      ...API.createElement({
        type: "text",
        text: "Title\nSubtitle",
        width: 100,
        height: 50,
      }),
      lineBolds: [true],
      lineUnderlines: [true, true],
      lineStrikethroughs: [true],
    } as NonDeleted<ExcalidrawTextElement>;

    const svg = await exportUtils.exportToSvg(
      [lineStyledText],
      DEFAULT_OPTIONS,
      null,
    );
    const textNodes = Array.from(svg.querySelectorAll("text"));

    expect(textNodes).toHaveLength(2);
    expect(textNodes[0].getAttribute("font-weight")).toBe("bold");
    expect(textNodes[0].getAttribute("text-decoration")).toBe(
      "underline line-through",
    );
    expect(textNodes[1].hasAttribute("font-weight")).toBe(false);
    expect(textNodes[1].getAttribute("text-decoration")).toBe("underline");
  });

  it("exports wrapped list continuations at their shared layout positions", async () => {
    const listText = {
      ...API.createElement({
        type: "text",
        text: "• Search inventory facts from the connected store",
        width: 120,
        height: 100,
        textAlign: "left",
      }),
      originalText: "• Search inventory facts from the connected store",
      autoResize: false,
      lineUnderlines: [true],
    } as NonDeleted<ExcalidrawTextElement>;
    const layout = getTextElementStyledLayout(listText, listText.width);

    expect(layout.lines.length).toBeGreaterThan(1);
    expect(layout.lines[1].horizontalOffset).toBeGreaterThan(0);

    const svg = await exportUtils.exportToSvg(
      [listText],
      DEFAULT_OPTIONS,
      null,
    );
    const textNodes = Array.from(svg.querySelectorAll("text"));

    expect(textNodes.map((node) => node.textContent)).toEqual(
      layout.lines.map((line) => line.text),
    );
    expect(textNodes.map((node) => Number(node.getAttribute("x")))).toEqual(
      layout.lines.map((line) =>
        getStyledVisualLineStart(line, listText.width, listText.textAlign),
      ),
    );
    expect(
      textNodes.every((node) => node.getAttribute("text-anchor") === "start"),
    ).toBe(true);
  });

  it("exports an image border", async () => {
    const fileId = "border-image" as FileId;
    const image = {
      ...API.createElement({
        type: "image",
        fileId,
        status: "saved",
        width: 120,
        height: 80,
      }),
      strokeColor: "#1971c2",
      strokeWidth: 4,
    } as NonDeletedExcalidrawElement;
    const files: BinaryFiles = {
      [fileId]: {
        id: fileId,
        dataURL:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAA1JREFUGFdj+P///38ACfsD/QhKzxAAAAAASUVORK5CYII=" as DataURL,
        mimeType: "image/png",
        created: 1,
        lastRetrieved: 1,
      },
    };

    const svgElement = await exportUtils.exportToSvg(
      [image],
      DEFAULT_OPTIONS,
      files,
    );

    const border = svgElement.querySelector('rect[stroke="#1971c2"]');
    expect(border).not.toBeNull();
    expect(border).toHaveAttribute("stroke-width", "4");
    expect(border).toHaveAttribute("fill", "none");
  });

  it("exports an exact decimal line stroke width", async () => {
    const line = API.createElement({
      type: "line",
      strokeWidth: 7.5,
      width: 120,
      height: 40,
    });

    const svgElement = await exportUtils.exportToSvg(
      [line],
      DEFAULT_OPTIONS,
      null,
    );

    expect(svgElement.querySelector('path[stroke-width="7.5"]')).not.toBeNull();
  });

  it("with exportPadding", async () => {
    const svgElement = await exportUtils.exportToSvg(
      ELEMENTS,
      {
        ...DEFAULT_OPTIONS,
        exportPadding: 0,
      },
      null,
    );

    expect(svgElement).toHaveAttribute("height", ELEMENT_HEIGHT.toString());
    expect(svgElement).toHaveAttribute("width", ELEMENT_WIDTH.toString());
    expect(svgElement).toHaveAttribute(
      "viewBox",
      `0 0 ${ELEMENT_WIDTH} ${ELEMENT_HEIGHT}`,
    );
  });

  it("with scale", async () => {
    const SCALE = 2;

    const svgElement = await exportUtils.exportToSvg(
      ELEMENTS,
      {
        ...DEFAULT_OPTIONS,
        exportPadding: 0,
        exportScale: SCALE,
      },
      null,
    );

    expect(svgElement).toHaveAttribute(
      "height",
      (ELEMENT_HEIGHT * SCALE).toString(),
    );
    expect(svgElement).toHaveAttribute(
      "width",
      (ELEMENT_WIDTH * SCALE).toString(),
    );
  });

  it("embeds real Regular and Bold descriptors for a professional font", async () => {
    const boldText = {
      ...API.createElement({
        type: "text",
        text: "I/l/1 O/0 — Professional 700",
        fontFamily: FONT_FAMILY.Inter,
      }),
      fontWeight: "bold" as const,
    };

    const svgElement = await exportUtils.exportToSvg(
      [boldText],
      DEFAULT_OPTIONS,
      null,
    );
    const embeddedCss =
      svgElement.querySelector("style.style-fonts")?.textContent ?? "";

    expect(embeddedCss).toContain('font-family: "Inter"');
    expect(embeddedCss).toContain("font-weight: 400");
    expect(embeddedCss).toContain("font-weight: 700");
    expect(svgElement.querySelector("text")).toHaveAttribute(
      "font-weight",
      "bold",
    );
  });

  it("with exportEmbedScene", async () => {
    const svgElement = await exportUtils.exportToSvg(
      ELEMENTS,
      {
        ...DEFAULT_OPTIONS,
        exportEmbedScene: true,
      },
      null,
    );
    expect(svgElement.innerHTML).toMatchSnapshot();
  });

  it("with elements that have a link", async () => {
    const svgElement = await exportUtils.exportToSvg(
      [rectangleWithLinkFixture] as NonDeletedExcalidrawElement[],
      DEFAULT_OPTIONS,
      null,
    );
    expect(svgElement.innerHTML).toMatchSnapshot();
  });

  // #11439: a perfectly horizontal/vertical arrow has a zero-size bounding box.
  // The bound-text "gap" mask must use userSpaceOnUse units, otherwise its
  // objectBoundingBox region collapses to zero area and the whole arrow line
  // disappears from the SVG export (only the label remains).
  it("keeps a horizontal arrow with a bound label visible (#11439)", async () => {
    const arrow = API.createElement({
      type: "arrow",
      id: "arrow-11439",
      width: 200,
      height: 0,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 0)],
      boundElements: [{ type: "text", id: "label-11439" }],
    });
    const label = API.createElement({
      type: "text",
      id: "label-11439",
      text: "label",
      width: 50,
      height: 20,
      containerId: "arrow-11439",
    });

    const svgElement = await exportUtils.exportToSvg(
      [arrow, label] as NonDeletedExcalidrawElement[],
      DEFAULT_OPTIONS,
      null,
    );

    const mask = svgElement.querySelector("mask");
    expect(mask).not.toBeNull();
    expect(mask?.getAttribute("maskUnits")).toBe("userSpaceOnUse");
    // a degenerate (objectBoundingBox) region would be zero-area here
    expect(Number(mask?.getAttribute("width"))).toBeGreaterThan(0);
    expect(Number(mask?.getAttribute("height"))).toBeGreaterThan(0);

    // the masked arrow group still renders its line (not clipped away)
    expect(svgElement.querySelector("g[mask] path")).not.toBeNull();
  });
});

describe("exportToCanvas", () => {
  it("paints a native free-text background into the cached canvas before export", async () => {
    const createdCanvases: HTMLCanvasElement[] = [];
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation(((
        tagName: string,
        options?: ElementCreationOptions,
      ) => {
        const element = originalCreateElement(tagName, options);
        if (tagName === "canvas") {
          createdCanvases.push(element as HTMLCanvasElement);
        }
        return element;
      }) as typeof document.createElement);

    try {
      const text = {
        ...API.createElement({
          type: "text",
          text: "Canvas background",
          width: 100,
          height: 40,
          backgroundColor: "#ff0000",
          roundness: null,
        }),
        backgroundPaddingScale: 2,
      } as NonDeleted<ExcalidrawTextElement>;
      const appState = {
        ...getDefaultAppState(),
        height: 0,
        offsetLeft: 0,
        offsetTop: 0,
        width: 0,
      };
      const geometry = getTextBackgroundGeometry(text)!;

      await exportUtils.exportToCanvas(
        [text],
        appState,
        {},
        {
          exportBackground: false,
          exportPadding: 0,
          viewBackgroundColor: "#ffffff",
          exportingFrame: null,
        },
        undefined,
        async () => {},
      );

      expect(
        createdCanvases.some((canvas) =>
          (canvas.getContext("2d") as any)
            .__getEvents()
            .some(
              (event: any) =>
                event.type === "fillRect" &&
                event.props.x === geometry.x &&
                event.props.y === geometry.y &&
                event.props.width === geometry.width &&
                event.props.height === geometry.height,
            ),
        ),
      ).toBe(true);
    } finally {
      createElementSpy.mockRestore();
    }
  });

  it("renders a selection at tight transparent bounds and preserves export scale", async () => {
    const rectangle = API.createElement({
      type: "rectangle",
      width: 120,
      height: 80,
      strokeColor: "transparent",
      strokeWidth: 0,
      backgroundColor: "#e03131",
      fillStyle: "solid",
      roughness: 0,
    });
    const appState = {
      ...getDefaultAppState(),
      exportScale: 2,
      height: 0,
      offsetLeft: 0,
      offsetTop: 0,
      width: 0,
    };

    const canvas = await exportUtils.exportToCanvas(
      [rectangle],
      appState,
      {},
      {
        exportBackground: false,
        exportPadding: 0,
        viewBackgroundColor: "#ffffff",
        exportingFrame: null,
      },
      undefined,
      async () => {},
    );

    expect(canvas.width).toBe(240);
    expect(canvas.height).toBe(160);

    const backgroundPaint = (canvas.getContext("2d") as any)
      .__getEvents()
      .find(
        (event: any) =>
          event.type === "fillRect" &&
          event.props.x === 0 &&
          event.props.y === 0 &&
          event.props.width === canvas.width &&
          event.props.height === canvas.height,
      );
    expect(backgroundPaint).toBeUndefined();
  });

  it("retains the shared padding and background behavior outside selection copy", async () => {
    const rectangle = API.createElement({
      type: "rectangle",
      width: 120,
      height: 80,
      strokeColor: "transparent",
      strokeWidth: 0,
      backgroundColor: "#e03131",
      fillStyle: "solid",
      roughness: 0,
    });
    const appState = {
      ...getDefaultAppState(),
      height: 0,
      offsetLeft: 0,
      offsetTop: 0,
      width: 0,
    };

    const canvas = await exportUtils.exportToCanvas(
      [rectangle],
      appState,
      {},
      {
        exportBackground: true,
        viewBackgroundColor: "#ffffff",
        exportingFrame: null,
      },
      undefined,
      async () => {},
    );

    expect(canvas.width).toBe(140);
    expect(canvas.height).toBe(100);
    expect(
      (canvas.getContext("2d") as any)
        .__getEvents()
        .some((event: any) => event.type === "fillRect"),
    ).toBe(true);
  });

  it("draws independent underline and strike rules for styled lines", async () => {
    const lineStyledText = {
      ...API.createElement({
        type: "text",
        text: "Title\nSubtitle",
        width: 100,
        height: 50,
      }),
      lineBolds: [true],
      lineUnderlines: [true, true],
      lineStrikethroughs: [true],
    } as NonDeleted<ExcalidrawTextElement>;

    const canvas = await exportToCanvas({
      elements: [lineStyledText],
      files: null,
      appState: { exportBackground: false },
    });
    const events = (canvas.getContext("2d") as any).__getEvents();
    const underlineRules = events.filter(
      (event: any) =>
        event.type === "fillRect" &&
        event.props.width > 0 &&
        event.props.height > 0,
    );

    expect(underlineRules).toHaveLength(3);
  });

  it("draws canvas list continuations at their shared layout positions", async () => {
    const listText = {
      ...API.createElement({
        type: "text",
        text: "• Search inventory facts from the connected store",
        width: 120,
        height: 100,
        textAlign: "left",
      }),
      originalText: "• Search inventory facts from the connected store",
      autoResize: false,
      lineUnderlines: [true],
    } as NonDeleted<ExcalidrawTextElement>;
    const layout = getTextElementStyledLayout(listText, listText.width);

    const canvas = await exportToCanvas({
      elements: [listText],
      files: null,
      appState: { exportBackground: false },
    });
    const textEvents = (canvas.getContext("2d") as any)
      .__getEvents()
      .filter((event: any) => event.type === "fillText");

    expect(textEvents.map((event: any) => event.props.text)).toEqual(
      layout.lines.map((line) => line.text),
    );
    expect(textEvents.map((event: any) => event.props.x)).toEqual(
      layout.lines.map((line) =>
        getStyledVisualLineStart(line, listText.width, listText.textAlign),
      ),
    );
    const underlineEvents = (canvas.getContext("2d") as any)
      .__getEvents()
      .filter((event: any) => event.type === "fillRect");
    expect(underlineEvents.map((event: any) => event.props.x)).toEqual(
      layout.lines.map((line) =>
        getStyledVisualLineStart(line, listText.width, listText.textAlign),
      ),
    );
  });

  it("does not paint over elements beneath a labeled arrow's label (#11591)", async () => {
    const rectangle = API.createElement({
      type: "rectangle",
      id: "rect-11591",
      x: 0,
      y: -50,
      width: 200,
      height: 100,
      backgroundColor: "#ffc9c9",
      fillStyle: "solid",
    });
    const arrow = API.createElement({
      type: "arrow",
      id: "arrow-11591",
      x: -50,
      y: 0,
      width: 300,
      height: 0,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(300, 0)],
      boundElements: [{ type: "text", id: "label-11591" }],
    });
    const label = API.createElement({
      type: "text",
      id: "label-11591",
      text: "label",
      x: 75,
      y: -10,
      width: 50,
      height: 20,
      containerId: "arrow-11591",
    });

    const canvas = await exportToCanvas({
      elements: [rectangle, arrow, label],
      files: null,
      appState: { exportBackground: true, viewBackgroundColor: "#ffffff" },
    });

    const context = canvas.getContext("2d") as any;
    const events = context.__getEvents();

    // the label "hole" must be cut out of the arrow's own strokes via an
    // even-odd clip — erasing (clearRect) or painting the background color
    // (fillRect) over the hole rect would destroy elements rendered beneath
    // the arrow
    expect(
      events.some(
        (event: any) =>
          event.type === "clip" && event.props.fillRule === "evenodd",
      ),
    ).toBe(true);

    const holeWidth = label.width + BOUND_TEXT_PADDING * 2;
    const holeHeight = label.height + BOUND_TEXT_PADDING * 2;
    expect(
      events.filter(
        (event: any) =>
          (event.type === "fillRect" || event.type === "clearRect") &&
          event.props.width === holeWidth &&
          event.props.height === holeHeight,
      ),
    ).toEqual([]);
  });
});

describe("exporting frames", () => {
  const getFrameNameHeight = (exportType: "canvas" | "svg") => {
    const height =
      FRAME_STYLE.nameFontSize * FRAME_STYLE.nameLineHeight +
      FRAME_STYLE.nameOffsetY;
    // canvas truncates dimensions to integers
    if (exportType === "canvas") {
      return Math.trunc(height);
    }
    return height;
  };

  // a few tests with exportToCanvas (where we can't inspect elements)
  // ---------------------------------------------------------------------------

  describe("exportToCanvas", () => {
    it("exporting canvas with a single frame shouldn't crop if not exporting frame directly", async () => {
      const elements = [
        API.createElement({
          type: "frame",
          width: 100,
          height: 100,
          x: 0,
          y: 0,
        }),
        API.createElement({
          type: "rectangle",
          width: 100,
          height: 100,
          x: 100,
          y: 0,
        }),
      ];

      const canvas = await exportToCanvas({
        elements,
        files: null,
        exportPadding: 0,
      });

      expect(canvas.width).toEqual(200);
      expect(canvas.height).toEqual(100 + getFrameNameHeight("canvas"));
    });

    it("exporting canvas with a single frame should crop when exporting frame directly", async () => {
      const frame = API.createElement({
        type: "frame",
        width: 100,
        height: 100,
        x: 0,
        y: 0,
      });
      const elements = [
        frame,
        API.createElement({
          type: "rectangle",
          width: 100,
          height: 100,
          x: 100,
          y: 0,
        }),
      ];

      const canvas = await exportToCanvas({
        elements,
        files: null,
        exportPadding: 0,
        exportingFrame: frame,
      });

      expect(canvas.width).toEqual(frame.width);
      expect(canvas.height).toEqual(frame.height);
    });
  });

  // exportToSvg (so we can test for element existence)
  // ---------------------------------------------------------------------------
  describe("exportToSvg", () => {
    it("exporting frame should include overlapping elements, but crop to frame", async () => {
      const frame = API.createElement({
        type: "frame",
        width: 100,
        height: 100,
        x: 0,
        y: 0,
      });
      const frameChild = API.createElement({
        type: "rectangle",
        width: 100,
        height: 100,
        x: 0,
        y: 50,
        frameId: frame.id,
      });
      const rectOverlapping = API.createElement({
        type: "rectangle",
        width: 100,
        height: 100,
        x: 50,
        y: 0,
      });

      const svg = await exportToSvg({
        elements: [rectOverlapping, frame, frameChild],
        files: null,
        exportPadding: 0,
        exportingFrame: frame,
      });

      // frame itself isn't exported
      expect(svg.querySelector(`[data-id="${frame.id}"]`)).toBeNull();
      // frame child is exported
      expect(svg.querySelector(`[data-id="${frameChild.id}"]`)).not.toBeNull();
      // overlapping element is exported
      expect(
        svg.querySelector(`[data-id="${rectOverlapping.id}"]`),
      ).not.toBeNull();

      expect(svg.getAttribute("width")).toBe(frame.width.toString());
      expect(svg.getAttribute("height")).toBe(frame.height.toString());
    });

    it("should filter non-overlapping elements when exporting a frame", async () => {
      const frame = API.createElement({
        type: "frame",
        width: 100,
        height: 100,
        x: 0,
        y: 0,
      });
      const frameChild = API.createElement({
        type: "rectangle",
        width: 100,
        height: 100,
        x: 0,
        y: 50,
        frameId: frame.id,
      });
      const elementOutside = API.createElement({
        type: "rectangle",
        width: 100,
        height: 100,
        x: 200,
        y: 0,
      });

      const svg = await exportToSvg({
        elements: [frameChild, frame, elementOutside],
        files: null,
        exportPadding: 0,
        exportingFrame: frame,
      });

      // frame itself isn't exported
      expect(svg.querySelector(`[data-id="${frame.id}"]`)).toBeNull();
      // frame child is exported
      expect(svg.querySelector(`[data-id="${frameChild.id}"]`)).not.toBeNull();
      // non-overlapping element is not exported
      expect(svg.querySelector(`[data-id="${elementOutside.id}"]`)).toBeNull();

      expect(svg.getAttribute("width")).toBe(frame.width.toString());
      expect(svg.getAttribute("height")).toBe(frame.height.toString());
    });

    it("should export multiple frames when selected, excluding overlapping elements", async () => {
      const frame1 = API.createElement({
        type: "frame",
        width: 100,
        height: 100,
        x: 0,
        y: 0,
      });
      const frame2 = API.createElement({
        type: "frame",
        width: 100,
        height: 100,
        x: 200,
        y: 0,
      });

      const frame1Child = API.createElement({
        type: "rectangle",
        width: 100,
        height: 100,
        x: 0,
        y: 50,
        frameId: frame1.id,
      });
      const frame2Child = API.createElement({
        type: "rectangle",
        width: 100,
        height: 100,
        x: 200,
        y: 0,
        frameId: frame2.id,
      });
      const frame2Overlapping = API.createElement({
        type: "rectangle",
        width: 100,
        height: 100,
        x: 350,
        y: 0,
      });

      // low-level exportToSvg api expects elements to be pre-filtered, so let's
      // use the filter we use in the editor
      const { exportedElements, exportingFrame } = prepareElementsForExport(
        [frame1Child, frame1, frame2Child, frame2, frame2Overlapping],
        {
          selectedElementIds: { [frame1.id]: true, [frame2.id]: true },
        },
        true,
      );

      const svg = await exportToSvg({
        elements: exportedElements,
        files: null,
        exportPadding: 0,
        exportingFrame,
      });

      // frames themselves should be exported when multiple frames selected
      expect(svg.querySelector(`[data-id="${frame1.id}"]`)).not.toBeNull();
      expect(svg.querySelector(`[data-id="${frame2.id}"]`)).not.toBeNull();
      // children should be epxorted
      expect(svg.querySelector(`[data-id="${frame1Child.id}"]`)).not.toBeNull();
      expect(svg.querySelector(`[data-id="${frame2Child.id}"]`)).not.toBeNull();
      // overlapping elements or non-overlapping elements should not be exported
      expect(
        svg.querySelector(`[data-id="${frame2Overlapping.id}"]`),
      ).toBeNull();

      expect(svg.getAttribute("width")).toBe(
        (frame2.x + frame2.width).toString(),
      );
      expect(svg.getAttribute("height")).toBe(
        (frame2.y + frame2.height + getFrameNameHeight("svg")).toString(),
      );
    });

    it("should render frame alone when not selected", async () => {
      const frame = API.createElement({
        type: "frame",
        width: 100,
        height: 100,
        x: 0,
        y: 0,
      });

      // low-level exportToSvg api expects elements to be pre-filtered, so let's
      // use the filter we use in the editor
      const { exportedElements, exportingFrame } = prepareElementsForExport(
        [frame],
        {
          selectedElementIds: {},
        },
        false,
      );

      const svg = await exportToSvg({
        elements: exportedElements,
        files: null,
        exportPadding: 0,
        exportingFrame,
      });

      // frame itself isn't exported
      expect(svg.querySelector(`[data-id="${frame.id}"]`)).not.toBeNull();

      expect(svg.getAttribute("width")).toBe(frame.width.toString());
      expect(svg.getAttribute("height")).toBe(
        (frame.height + getFrameNameHeight("svg")).toString(),
      );
    });

    it("should not export frame-overlapping elements belonging to different frame", async () => {
      const frame1 = API.createElement({
        type: "frame",
        width: 100,
        height: 100,
        x: 0,
        y: 0,
      });
      const frame2 = API.createElement({
        type: "frame",
        width: 100,
        height: 100,
        x: 200,
        y: 0,
      });

      const frame1Child = API.createElement({
        type: "rectangle",
        width: 150,
        height: 100,
        x: 0,
        y: 50,
        frameId: frame1.id,
      });
      const frame2Child = API.createElement({
        type: "rectangle",
        width: 150,
        height: 100,
        x: 50,
        y: 0,
        frameId: frame2.id,
      });

      // low-level exportToSvg api expects elements to be pre-filtered, so let's
      // use the filter we use in the editor
      const { exportedElements, exportingFrame } = prepareElementsForExport(
        [frame1Child, frame1, frame2Child, frame2],
        {
          selectedElementIds: { [frame1.id]: true },
        },
        true,
      );

      const svg = await exportToSvg({
        elements: exportedElements,
        files: null,
        exportPadding: 0,
        exportingFrame,
      });

      // frame shouldn't be exported
      expect(svg.querySelector(`[data-id="${frame1.id}"]`)).toBeNull();
      // frame1 child should be epxorted
      expect(svg.querySelector(`[data-id="${frame1Child.id}"]`)).not.toBeNull();
      // frame2 child should not be exported even if it physically overlaps with
      // frame1
      expect(svg.querySelector(`[data-id="${frame2Child.id}"]`)).toBeNull();

      expect(svg.getAttribute("width")).toBe(frame1.width.toString());
      expect(svg.getAttribute("height")).toBe(frame1.height.toString());
    });
  });
});
