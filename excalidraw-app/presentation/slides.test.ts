import { describe, expect, it } from "vitest";

import { newFrameElement, newElement } from "@excalidraw/element";

import type { ExcalidrawFrameElement } from "@excalidraw/element/types";

import {
  findSlideIndexAtPoint,
  getOrderedPresentationFrames,
  reorderPresentationFrames,
} from "./slides";

const frame = ({
  id,
  order,
  frameId = null,
}: {
  id: string;
  order?: number;
  frameId?: string | null;
}): ExcalidrawFrameElement => ({
  ...newFrameElement({
    name: id,
    x: Number(id.at(-1)?.charCodeAt(0) ?? 0),
    y: 20,
    width: 1280,
    height: 720,
    frameId,
  }),
  id,
  customData: order === undefined ? undefined : { presentationOrder: order },
});

describe("presentation slides", () => {
  it("normalizes missing and duplicate order into open slots by scene order", () => {
    const elements = [
      frame({ id: "frame-a", order: 2 }),
      frame({ id: "frame-b" }),
      frame({ id: "frame-c", order: 2 }),
      frame({ id: "frame-d", order: 4 }),
    ];

    expect(
      getOrderedPresentationFrames(elements).map(({ frame, order }) => [
        frame.id,
        order,
      ]),
    ).toEqual([
      ["frame-a", 1],
      ["frame-b", 2],
      ["frame-c", 3],
      ["frame-d", 4],
    ]);
  });

  it("uses generated Yaseen presentation metadata when root order is absent", () => {
    const second: ExcalidrawFrameElement = {
      ...frame({ id: "frame-second" }),
      customData: {
        yaseenPresentation: { kind: "slide-frame", presentationOrder: 2 },
      },
    };
    const first = frame({ id: "frame-first", order: 1 });

    expect(
      getOrderedPresentationFrames([second, first]).map(
        ({ frame: item }) => item.id,
      ),
    ).toEqual(["frame-first", "frame-second"]);
  });

  it("treats only top-level frames as independent slides", () => {
    const parent = frame({ id: "frame-parent", order: 1 });
    const nested = frame({
      id: "frame-nested",
      order: 2,
      frameId: parent.id,
    });
    const child = newElement({
      type: "rectangle",
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      frameId: parent.id,
    });

    expect(
      getOrderedPresentationFrames([parent, nested, child]).map(
        ({ frame: item }) => item.id,
      ),
    ).toEqual(["frame-parent"]);
  });

  it("persists a new order without moving frames or changing non-frame elements", () => {
    const first = frame({ id: "frame-first", order: 1 });
    const second = frame({ id: "frame-second", order: 2 });
    const child = newElement({
      type: "rectangle",
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      frameId: first.id,
    });
    const result = reorderPresentationFrames(
      [first, child, second],
      [second.id, first.id],
    );

    expect(result[1]).toBe(child);
    expect(result[0]).toMatchObject({
      id: first.id,
      x: first.x,
      y: first.y,
      customData: { presentationOrder: 2 },
    });
    expect(result[2]).toMatchObject({
      id: second.id,
      x: second.x,
      y: second.y,
      customData: { presentationOrder: 1 },
    });
    expect(result[0]).not.toBe(first);
    expect(result[2]).not.toBe(second);
  });

  describe("findSlideIndexAtPoint", () => {
    // 1280x720 frames at x = 0 / 2000 / 4000, all at y = 20.
    const slides = getOrderedPresentationFrames([
      { ...frame({ id: "frame-a", order: 1 }), x: 0 },
      { ...frame({ id: "frame-b", order: 2 }), x: 2000 },
      { ...frame({ id: "frame-c", order: 3 }), x: 4000 },
    ]);

    it("returns the slide whose frame contains the point", () => {
      expect(findSlideIndexAtPoint({ x: 640, y: 380 }, slides)).toBe(0);
      expect(findSlideIndexAtPoint({ x: 2640, y: 380 }, slides)).toBe(1);
      expect(findSlideIndexAtPoint({ x: 4640, y: 380 }, slides)).toBe(2);
    });

    it("counts the edges as inside", () => {
      expect(findSlideIndexAtPoint({ x: 2000, y: 20 }, slides)).toBe(1);
      expect(findSlideIndexAtPoint({ x: 3280, y: 740 }, slides)).toBe(1);
    });

    it("prefers the smallest frame when slides overlap (a deck-overview frame drawn around the slides)", () => {
      // "Deck overview" (order 1) is a 10000x4000 frame that visually wraps
      // slides b and c. A click on slide c must land on c, not the wrapper.
      const nested = getOrderedPresentationFrames([
        {
          ...frame({ id: "frame-a", order: 1 }),
          x: -500,
          y: -500,
          width: 10000,
          height: 4000,
        },
        { ...frame({ id: "frame-b", order: 2 }), x: 2000 },
        { ...frame({ id: "frame-c", order: 3 }), x: 4000 },
      ]);
      expect(findSlideIndexAtPoint({ x: 4640, y: 380 }, nested)).toBe(2);
      expect(findSlideIndexAtPoint({ x: 2640, y: 380 }, nested)).toBe(1);
      // Outside every slide but inside the wrapper → the wrapper.
      expect(findSlideIndexAtPoint({ x: 100, y: 100 }, nested)).toBe(0);
    });

    it("returns null for a point between or outside the frames", () => {
      expect(findSlideIndexAtPoint({ x: 1500, y: 380 }, slides)).toBeNull();
      expect(findSlideIndexAtPoint({ x: 640, y: 5000 }, slides)).toBeNull();
      expect(findSlideIndexAtPoint({ x: 0, y: 0 }, [])).toBeNull();
    });

    it("gives the earlier slide the point when frames overlap", () => {
      const overlapping = getOrderedPresentationFrames([
        { ...frame({ id: "frame-a", order: 1 }), x: 0 },
        { ...frame({ id: "frame-b", order: 2 }), x: 100 },
      ]);

      expect(findSlideIndexAtPoint({ x: 200, y: 380 }, overlapping)).toBe(0);
    });
  });
});
