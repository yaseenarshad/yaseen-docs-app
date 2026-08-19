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

const rect = (top: number, height: number) =>
  ({
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 200,
    width: 200,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);

/**
 * jsdom has no layout, so the drag maths needs stubbed geometry: rows of
 * `height` stacked from the top of a list tall enough that no pointer position
 * used here lands in the auto-scroll margin.
 */
const stubGeometry = (ids: readonly string[], height = 40) => {
  vi.spyOn(screen.getByRole("list"), "getBoundingClientRect").mockReturnValue(
    rect(0, 400),
  );
  ids.forEach((id, index) => {
    vi.spyOn(
      screen.getByTestId(`presentation-slide-${id}`),
      "getBoundingClientRect",
    ).mockReturnValue(rect(index * height, height));
  });
};

/**
 * jsdom ships no `PointerEvent`, so `fireEvent.pointerMove` drops `clientY`. A
 * `MouseEvent` named after the pointer event carries the coordinate and React
 * still routes it to the `onPointer*` handlers.
 */
const pointer = (
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  target: Element,
  clientY = 0,
) => fireEvent(target, new MouseEvent(type, { bubbles: true, clientY }));

const persistedOrder = (api: ExcalidrawImperativeAPI) =>
  [...(vi.mocked(api.updateScene).mock.calls[0][0].elements ?? [])]
    .sort(
      (a, b) =>
        Number(a.customData?.presentationOrder) -
        Number(b.customData?.presentationOrder),
    )
    .map((element) => element.id);

const slideNames = () =>
  screen
    .getAllByRole("button", { name: /Go to slide/ })
    .map((button) => button.textContent);

describe("PresentationSidebar", () => {
  it("lists top-level frames as a plain numbered list", () => {
    const parent = frame("parent", 2);
    const nested = frame("nested", 3, parent.id);
    const { api } = createApi([parent, nested, frame("first", 1)]);

    const { container } = render(
      <PresentationSidebar excalidrawAPI={api} canEdit />,
    );

    expect(slideNames()).toEqual(["1Frame first", "2Frame parent"]);
    expect(screen.queryByText("Frame nested")).not.toBeInTheDocument();
    expect(container.querySelector("canvas")).toBeNull();
    expect(screen.queryByLabelText(/Preview of/)).not.toBeInTheDocument();
    expect(screen.getByText("2 slides")).toBeVisible();
  });

  it("flies to a row in edit mode without mutating the scene", () => {
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
    expect(
      screen.getByRole("button", { name: "Go to slide 1" }),
    ).toHaveAttribute("aria-current", "true");
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

  it("reorders metadata with the nudge buttons without moving frame geometry", () => {
    const original = [frame("one", 1), frame("two", 2)];
    const { api } = createApi(original);
    render(<PresentationSidebar excalidrawAPI={api} canEdit />);

    expect(
      screen.getByRole("button", { name: "Move slide 1 up" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move slide 2 up" }));

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

  it("renames inline: Enter saves, Escape and an empty name leave the scene alone", () => {
    const { api } = createApi([frame("one", 1), frame("two", 2)]);
    render(<PresentationSidebar excalidrawAPI={api} canEdit />);

    fireEvent.click(screen.getByRole("button", { name: "Rename slide 1" }));
    const input = screen.getByLabelText("Slide 1 name");
    expect(input).toHaveValue("Frame one");
    fireEvent.change(input, { target: { value: "  Opening  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(api.updateScene).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.updateScene).mock.calls[0][0].elements).toContainEqual(
      expect.objectContaining({ id: "one", name: "Opening" }),
    );
    expect(screen.queryByLabelText("Slide 1 name")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Rename slide 1" }));
    fireEvent.change(screen.getByLabelText("Slide 1 name"), {
      target: { value: "Discarded" },
    });
    fireEvent.keyDown(screen.getByLabelText("Slide 1 name"), {
      key: "Escape",
    });
    expect(screen.queryByLabelText("Slide 1 name")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Rename slide 1" }));
    fireEvent.change(screen.getByLabelText("Slide 1 name"), {
      target: { value: "   " },
    });
    fireEvent.blur(screen.getByLabelText("Slide 1 name"));

    expect(api.updateScene).toHaveBeenCalledTimes(1);
  });

  it("saves an inline rename on blur", () => {
    const { api } = createApi([frame("one", 1)]);
    render(<PresentationSidebar excalidrawAPI={api} canEdit />);

    fireEvent.click(screen.getByRole("button", { name: "Rename slide 1" }));
    fireEvent.change(screen.getByLabelText("Slide 1 name"), {
      target: { value: "Closing" },
    });
    fireEvent.blur(screen.getByLabelText("Slide 1 name"));

    expect(vi.mocked(api.updateScene).mock.calls[0][0].elements).toContainEqual(
      expect.objectContaining({ id: "one", name: "Closing" }),
    );
  });

  it("offers ordering and rename only to editors", () => {
    const { api } = createApi([frame("one", 1), frame("two", 2)]);
    const { rerender } = render(
      <PresentationSidebar excalidrawAPI={api} canEdit={false} />,
    );

    expect(
      screen.queryByRole("button", { name: /Move slide/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Rename slide/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Reorder slide/ }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Go to slide/ })).toHaveLength(
      2,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Go to slide 1" }), {
      key: "ArrowDown",
      altKey: true,
    });
    expect(api.updateScene).not.toHaveBeenCalled();

    rerender(<PresentationSidebar excalidrawAPI={api} canEdit />);
    expect(screen.getAllByRole("button", { name: /Move slide/ })).toHaveLength(
      4,
    );
    expect(
      screen.getAllByRole("button", { name: /Reorder slide/ }),
    ).toHaveLength(2);
  });

  it("reorders by dragging the handle past a row midpoint", () => {
    const { api } = createApi([
      frame("one", 1),
      frame("two", 2),
      frame("three", 3),
    ]);
    render(<PresentationSidebar excalidrawAPI={api} canEdit />);
    stubGeometry(["one", "two", "three"]);

    const handle = screen.getByRole("button", { name: "Reorder slide 1" });
    pointer("pointerdown", handle, 20);
    pointer("pointermove", handle, 100);

    expect(screen.getByTestId("presentation-slide-one")).toHaveClass(
      "presentation-sidebar__slide--dragging",
    );
    expect(screen.getByTestId("presentation-slide-three")).toHaveClass(
      "presentation-sidebar__slide--drop-after",
    );

    pointer("pointerup", handle);

    expect(api.updateScene).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.updateScene).mock.calls[0][0].captureUpdate).toBe(
      CaptureUpdateAction.IMMEDIATELY,
    );
    expect(persistedOrder(api)).toEqual(["two", "three", "one"]);
  });

  it("drags upwards and leaves the scene alone when dropped where it started", () => {
    const { api } = createApi([
      frame("one", 1),
      frame("two", 2),
      frame("three", 3),
    ]);
    render(<PresentationSidebar excalidrawAPI={api} canEdit />);
    stubGeometry(["one", "two", "three"]);

    const lastHandle = screen.getByRole("button", { name: "Reorder slide 3" });
    pointer("pointerdown", lastHandle, 100);
    pointer("pointermove", lastHandle, 10);
    expect(screen.getByTestId("presentation-slide-one")).toHaveClass(
      "presentation-sidebar__slide--drop-before",
    );
    pointer("pointerup", lastHandle);
    expect(persistedOrder(api)).toEqual(["three", "one", "two"]);

    vi.mocked(api.updateScene).mockClear();
    const handle = screen.getByRole("button", { name: "Reorder slide 2" });
    pointer("pointerdown", handle, 50);
    pointer("pointermove", handle, 55);
    pointer("pointerup", handle);
    expect(api.updateScene).not.toHaveBeenCalled();
  });

  it("scrolls the list while a drag hovers near its bottom edge", () => {
    const ticks: FrameRequestCallback[] = [];
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((tick) => ticks.push(tick));
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame");
    const { api } = createApi([
      frame("one", 1),
      frame("two", 2),
      frame("three", 3),
    ]);
    render(<PresentationSidebar excalidrawAPI={api} canEdit />);
    const list = screen.getByRole("list");
    stubGeometry(["one", "two", "three"]);
    // A viewport shorter than the rows, so y=95 sits in the bottom margin.
    vi.spyOn(list, "getBoundingClientRect").mockReturnValue(rect(0, 100));

    const handle = screen.getByRole("button", { name: "Reorder slide 1" });
    pointer("pointerdown", handle, 20);
    pointer("pointermove", handle, 95);

    act(() => ticks[ticks.length - 1](0));
    expect(list.scrollTop).toBe(8);
    act(() => ticks[ticks.length - 1](0));
    expect(list.scrollTop).toBe(16);

    pointer("pointerup", handle);
    expect(cancelFrame).toHaveBeenCalledWith(ticks.length);
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
  });

  it("abandons a drag on Escape and on pointercancel", () => {
    const { api } = createApi([frame("one", 1), frame("two", 2)]);
    render(<PresentationSidebar excalidrawAPI={api} canEdit />);
    stubGeometry(["one", "two"]);

    const handle = screen.getByRole("button", { name: "Reorder slide 1" });
    pointer("pointerdown", handle, 20);
    pointer("pointermove", handle, 70);
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.getByTestId("presentation-slide-two")).not.toHaveClass(
      "presentation-sidebar__slide--drop-after",
    );
    pointer("pointerup", handle);
    expect(api.updateScene).not.toHaveBeenCalled();

    pointer("pointerdown", handle, 20);
    pointer("pointermove", handle, 70);
    pointer("pointercancel", handle);
    pointer("pointerup", handle);
    expect(api.updateScene).not.toHaveBeenCalled();
  });

  it("moves the focused row with Alt+ArrowUp / Alt+ArrowDown", () => {
    const { api } = createApi([frame("one", 1), frame("two", 2)]);
    render(<PresentationSidebar excalidrawAPI={api} canEdit />);

    const firstRow = screen.getByRole("button", { name: "Go to slide 1" });
    fireEvent.keyDown(firstRow, { key: "ArrowUp", altKey: true });
    expect(api.updateScene).not.toHaveBeenCalled();

    fireEvent.keyDown(firstRow, { key: "ArrowDown", altKey: true });
    expect(persistedOrder(api)).toEqual(["two", "one"]);

    vi.mocked(api.updateScene).mockClear();
    fireEvent.keyDown(firstRow, { key: "ArrowDown" });
    expect(api.updateScene).not.toHaveBeenCalled();
  });

  it("keeps Alt+Arrow out of the rename field", () => {
    const { api } = createApi([frame("one", 1), frame("two", 2)]);
    render(<PresentationSidebar excalidrawAPI={api} canEdit />);

    fireEvent.click(screen.getByRole("button", { name: "Rename slide 1" }));
    fireEvent.keyDown(screen.getByLabelText("Slide 1 name"), {
      key: "ArrowDown",
      altKey: true,
    });

    expect(api.updateScene).not.toHaveBeenCalled();
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
