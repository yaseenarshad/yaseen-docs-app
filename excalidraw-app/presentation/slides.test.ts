import { describe, expect, it } from "vitest";

import { newFrameElement, newElement } from "@excalidraw/element";

import type { ExcalidrawFrameElement } from "@excalidraw/element/types";

import {
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
});
