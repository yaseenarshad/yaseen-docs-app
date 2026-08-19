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
    expect(screen.getAllByRole("button", { name: /Go to slide/ })).toHaveLength(
      2,
    );

    rerender(<PresentationSidebar excalidrawAPI={api} canEdit />);
    expect(screen.getAllByRole("button", { name: /Move slide/ })).toHaveLength(
      4,
    );
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
