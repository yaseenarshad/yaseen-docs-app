import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { newFrameElement } from "@excalidraw/element";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { PresentationSidebar } from "./PresentationSidebar";

const frame = (id: string, order: number, frameId: string | null = null) => ({
  ...newFrameElement({
    name: `Frame ${id}`,
    x: order * 100,
    y: order * 50,
    width: 1280,
    height: 720,
    frameId,
  }),
  id,
  customData: { presentationOrder: order },
});

const createApi = (elements = [frame("one", 2), frame("two", 1)]) => {
  let onChange: Parameters<ExcalidrawImperativeAPI["onChange"]>[0] | null =
    null;
  return {
    api: {
      getSceneElements: () => elements,
      getAppState: () => ({ selectedElementIds: {} }),
      onChange: vi.fn((callback) => {
        onChange = callback;
        return vi.fn();
      }),
      setViewport: vi.fn(),
      updateScene: vi.fn(),
      setActiveTool: vi.fn(),
    } as unknown as ExcalidrawImperativeAPI,
    emit(nextElements: typeof elements) {
      onChange?.(nextElements, { selectedElementIds: {} } as never, {});
    },
  };
};

describe("PresentationSidebar", () => {
  it("lists top-level frames in normalized order with client-side previews", () => {
    const parent = frame("parent", 2);
    const nested = frame("nested", 3, parent.id);
    const { api } = createApi([parent, nested, frame("first", 1)]);

    render(<PresentationSidebar excalidrawAPI={api} canEdit />);

    expect(
      screen
        .getAllByRole("button", { name: /Go to slide/ })
        .map((button) => button.querySelector("strong")?.textContent),
    ).toEqual(["Frame first", "Frame parent"]);
    expect(screen.getAllByLabelText(/Preview of/)).toHaveLength(2);
    expect(screen.queryByText("Frame nested")).not.toBeInTheDocument();
  });

  it("flies to a card in edit mode without mutating the scene", () => {
    const { api } = createApi();
    render(<PresentationSidebar excalidrawAPI={api} canEdit />);

    fireEvent.click(screen.getByRole("button", { name: "Go to slide 1" }));

    expect(api.setViewport).toHaveBeenCalledWith({
      target: "two",
      fit: "contain",
      animation: true,
      offsets: { ui: true },
    });
    expect(api.updateScene).not.toHaveBeenCalled();
  });

  it("starts from the currently highlighted slide", () => {
    const { api } = createApi();
    const onStartPresentation = vi.fn();
    render(
      <PresentationSidebar
        excalidrawAPI={api}
        canEdit
        onStartPresentation={onStartPresentation}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Go to slide 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Start presentation" }));

    expect(onStartPresentation).toHaveBeenCalledWith("two");
  });

  it("reorders metadata without moving frame geometry", () => {
    const original = [frame("one", 1), frame("two", 2)];
    const { api } = createApi(original);
    render(<PresentationSidebar excalidrawAPI={api} canEdit />);

    const source = screen.getByTestId("presentation-slide-one");
    const target = screen.getByTestId("presentation-slide-two");
    const dataTransfer = {
      effectAllowed: "move",
      dropEffect: "move",
      types: ["application/x-yaseendraw-slide-id"],
      setData: vi.fn(),
      getData: vi.fn(() => "one"),
    };
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });

    expect(api.updateScene).toHaveBeenCalledTimes(1);
    const update = vi.mocked(api.updateScene).mock.calls[0][0];
    expect(update.captureUpdate).toBe(CaptureUpdateAction.IMMEDIATELY);
    expect(update.elements).toEqual([
      expect.objectContaining({
        id: "one",
        x: original[0].x,
        y: original[0].y,
        customData: { presentationOrder: 2 },
      }),
      expect.objectContaining({
        id: "two",
        x: original[1].x,
        y: original[1].y,
        customData: { presentationOrder: 1 },
      }),
    ]);
  });

  it("offers keyboard ordering and frame rename only to editors", () => {
    const { api } = createApi([frame("one", 1), frame("two", 2)]);
    vi.spyOn(window, "prompt").mockReturnValue("Opening");
    const { rerender } = render(
      <PresentationSidebar excalidrawAPI={api} canEdit />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Move slide 2 up" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename slide 1" }));
    expect(api.updateScene).toHaveBeenCalledTimes(2);

    rerender(<PresentationSidebar excalidrawAPI={api} canEdit={false} />);
    expect(
      screen.queryByRole("button", { name: /Move slide/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Rename slide/ }),
    ).not.toBeInTheDocument();
  });

  it("reacts to frame deletion and provides a direct empty-state frame tool", () => {
    const first = frame("one", 1);
    const controller = createApi([first]);
    render(<PresentationSidebar excalidrawAPI={controller.api} canEdit />);
    expect(screen.getByText("Frame one")).toBeVisible();

    act(() => controller.emit([]));
    expect(screen.queryByText("Frame one")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create a frame" }));

    expect(controller.api.setActiveTool).toHaveBeenCalledWith({
      type: "frame",
    });
  });
});
