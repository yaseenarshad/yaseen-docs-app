import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newFrameElement } from "@excalidraw/element";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { FRAMES_VISIBLE_STORAGE_KEY } from "../frames/framesVisibility";

import {
  PRESENTATION_FRAME_LIFECYCLE_EVENT,
  type PresentationFrameLifecycleDetail,
} from "./events";
import {
  PRESENTATION_TRANSITION_DURATION,
  PresentationPlayer,
} from "./PresentationPlayer";

const frame = (id: string, order: number) => ({
  ...newFrameElement({
    name: `Frame ${id}`,
    x: order * 2000,
    y: order * 1000,
    width: 1280,
    height: 720,
  }),
  id,
  customData: { presentationOrder: order },
});

const createApi = () => {
  let elements = [frame("one", 1), frame("two", 2), frame("three", 3)];
  let onChange: Parameters<ExcalidrawImperativeAPI["onChange"]>[0] | null =
    null;
  return {
    api: {
      getSceneElements: () => elements,
      onChange: vi.fn((callback) => {
        onChange = callback;
        return vi.fn();
      }),
      setViewport: vi.fn(),
      updateScene: vi.fn(),
      updateFrameRendering: vi.fn(),
    } as unknown as ExcalidrawImperativeAPI,
    deleteFrame(id: string) {
      elements = elements.filter((element) => element.id !== id);
      onChange?.(elements, {} as never, {});
    },
  };
};

describe("PresentationPlayer", () => {
  beforeEach(() => {
    window.localStorage.removeItem(FRAMES_VISIBLE_STORAGE_KEY);
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("starts from the highlighted slide and publishes transition then active", () => {
    const { api } = createApi();
    const lifecycle: PresentationFrameLifecycleDetail[] = [];
    const listener = (event: Event) =>
      lifecycle.push(
        (event as CustomEvent<PresentationFrameLifecycleDetail>).detail,
      );
    window.addEventListener(PRESENTATION_FRAME_LIFECYCLE_EVENT, listener);

    const { unmount } = render(
      <PresentationPlayer
        excalidrawAPI={api}
        initialFrameId="two"
        onExit={vi.fn()}
      />,
    );

    expect(api.setViewport).toHaveBeenCalledWith({
      target: "two",
      fit: "contain",
      animation: { duration: PRESENTATION_TRANSITION_DURATION },
      lock: { scroll: true, zoom: true, overscroll: false },
      offsets: { ui: true },
    });
    expect(screen.getByText("2 / 3")).toBeVisible();
    expect(lifecycle.at(-1)).toMatchObject({
      frameId: "two",
      order: 2,
      phase: "transitioning",
    });

    act(() => vi.advanceTimersByTime(PRESENTATION_TRANSITION_DURATION + 20));
    expect(lifecycle.at(-1)).toMatchObject({
      frameId: "two",
      order: 2,
      phase: "active",
    });
    expect(api.updateScene).not.toHaveBeenCalled();

    unmount();
    window.removeEventListener(PRESENTATION_FRAME_LIFECYCLE_EVENT, listener);
  });

  it("handles approved keyboard, click, and boundary controls", () => {
    const { api } = createApi();
    const onExit = vi.fn();
    render(
      <PresentationPlayer
        excalidrawAPI={api}
        initialFrameId="one"
        onExit={onExit}
      />,
    );

    fireEvent.keyDown(document, { key: "End" });
    expect(screen.getByText("3 / 3")).toBeVisible();
    fireEvent.keyDown(document, { key: "Home" });
    expect(screen.getByText("1 / 3")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(screen.getByText("2 / 3")).toBeVisible();
    fireEvent.click(screen.getByRole("dialog"), { clientX: 1 });
    expect(screen.getByText("1 / 3")).toBeVisible();
    fireEvent.keyDown(document, { key: "PageDown" });
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(screen.getByText("1 / 3")).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(api.setViewport).toHaveBeenLastCalledWith(null);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("remains interactive without ending during the Strict Mode effect replay", async () => {
    const { api } = createApi();
    const onExit = vi.fn();
    const lifecycle: PresentationFrameLifecycleDetail[] = [];
    const listener = (event: Event) =>
      lifecycle.push(
        (event as CustomEvent<PresentationFrameLifecycleDetail>).detail,
      );
    window.addEventListener(PRESENTATION_FRAME_LIFECYCLE_EVENT, listener);
    render(
      <StrictMode>
        <PresentationPlayer
          excalidrawAPI={api}
          initialFrameId="one"
          onExit={onExit}
        />
      </StrictMode>,
    );
    await act(async () => undefined);

    expect(lifecycle.some((event) => event.phase === "ended")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(screen.getByText("2 / 3")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(api.setViewport).toHaveBeenLastCalledWith(null);
    window.removeEventListener(PRESENTATION_FRAME_LIFECYCLE_EVENT, listener);
  });

  it("coalesces rapid navigation so only the final frame becomes active", () => {
    const { api } = createApi();
    const lifecycle: PresentationFrameLifecycleDetail[] = [];
    const listener = (event: Event) =>
      lifecycle.push(
        (event as CustomEvent<PresentationFrameLifecycleDetail>).detail,
      );
    window.addEventListener(PRESENTATION_FRAME_LIFECYCLE_EVENT, listener);
    const { unmount } = render(
      <PresentationPlayer excalidrawAPI={api} onExit={vi.fn()} />,
    );

    fireEvent.keyDown(document, { key: "ArrowRight" });
    fireEvent.keyDown(document, { key: " " });
    act(() => vi.advanceTimersByTime(PRESENTATION_TRANSITION_DURATION + 20));

    expect(screen.getByText("3 / 3")).toBeVisible();
    expect(
      lifecycle
        .filter((event) => event.phase === "active")
        .map((event) => event.frameId),
    ).toEqual(["three"]);

    unmount();
    window.removeEventListener(PRESENTATION_FRAME_LIFECYCLE_EVENT, listener);
  });

  it("recovers to the nearest remaining frame when the active frame is deleted", () => {
    const controller = createApi();
    render(
      <PresentationPlayer
        excalidrawAPI={controller.api}
        initialFrameId="two"
        onExit={vi.fn()}
      />,
    );
    act(() => vi.advanceTimersByTime(PRESENTATION_TRANSITION_DURATION + 20));

    act(() => controller.deleteFrame("two"));

    expect(screen.getByText("2 / 2")).toBeVisible();
    expect(controller.api.setViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({ target: "three" }),
    );
  });

  it("hides frame outlines and names before the first slide, then restores the edit preference", () => {
    const { api } = createApi();
    render(
      <PresentationPlayer
        excalidrawAPI={api}
        initialFrameId="one"
        onExit={vi.fn()}
      />,
    );

    expect(api.updateFrameRendering).toHaveBeenCalledWith({
      outline: false,
      name: false,
    });
    expect(
      vi.mocked(api.updateFrameRendering).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(api.setViewport).mock.invocationCallOrder[0]);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(api.updateFrameRendering).toHaveBeenLastCalledWith({
      outline: true,
      name: true,
    });
  });

  it("leaves frames hidden on exit when the edit preference is hidden", () => {
    window.localStorage.setItem(FRAMES_VISIBLE_STORAGE_KEY, "false");
    const { api } = createApi();
    render(<PresentationPlayer excalidrawAPI={api} onExit={vi.fn()} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(api.updateFrameRendering).toHaveBeenLastCalledWith({
      outline: false,
      name: false,
    });
  });

  it("unlocks the viewport while tools are shown and re-locks when they are hidden", () => {
    const { api } = createApi();
    render(
      <PresentationPlayer
        excalidrawAPI={api}
        initialFrameId="one"
        onExit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show tools" }));

    expect(document.body).toHaveClass("yaseendraw-presentation-tools");
    expect(api.setViewport).toHaveBeenLastCalledWith({
      target: "one",
      fit: "contain",
      offsets: { ui: true },
    });

    fireEvent.click(screen.getByRole("button", { name: "Hide tools" }));

    expect(document.body).not.toHaveClass("yaseendraw-presentation-tools");
    expect(api.setViewport).toHaveBeenLastCalledWith({
      target: "one",
      fit: "contain",
      offsets: { ui: true },
      lock: { scroll: true, zoom: true, overscroll: false },
    });
  });

  it("re-locks on navigation but leaves the tools shown", () => {
    const { api } = createApi();
    render(
      <PresentationPlayer
        excalidrawAPI={api}
        initialFrameId="one"
        onExit={vi.fn()}
      />,
    );
    fireEvent.keyDown(document, { key: "t" });

    fireEvent.keyDown(document, { key: "ArrowRight" });

    expect(screen.getByText("2 / 3")).toBeVisible();
    expect(api.setViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        target: "two",
        lock: { scroll: true, zoom: true, overscroll: false },
      }),
    );
    expect(document.body).toHaveClass("yaseendraw-presentation-tools");
    expect(screen.getByRole("button", { name: "Hide tools" })).toBeVisible();
  });

  it("leaves Space to the canvas while tools are shown", () => {
    const { api } = createApi();
    render(
      <PresentationPlayer
        excalidrawAPI={api}
        initialFrameId="one"
        onExit={vi.fn()}
      />,
    );

    fireEvent.keyDown(document, { key: " " });
    expect(screen.getByText("2 / 3")).toBeVisible();

    fireEvent.keyDown(document, { key: "t" });
    fireEvent.keyDown(document, { key: " " });
    expect(screen.getByText("2 / 3")).toBeVisible();

    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByText("3 / 3")).toBeVisible();
  });

  it("ignores click-half navigation while tools are shown", () => {
    const { api } = createApi();
    render(
      <PresentationPlayer
        excalidrawAPI={api}
        initialFrameId="two"
        onExit={vi.fn()}
      />,
    );
    fireEvent.keyDown(document, { key: "t" });

    fireEvent.click(screen.getByRole("dialog"), { clientX: 1 });

    expect(screen.getByText("2 / 3")).toBeVisible();
  });

  it("stands down while focus is in a text editor", () => {
    const { api } = createApi();
    const onExit = vi.fn();
    render(
      <PresentationPlayer
        excalidrawAPI={api}
        initialFrameId="two"
        onExit={onExit}
      />,
    );
    const editor = document.createElement("textarea");
    document.body.appendChild(editor);
    editor.focus();

    fireEvent.keyDown(editor, { key: "ArrowRight" });
    fireEvent.keyDown(editor, { key: "t" });
    fireEvent.keyDown(editor, { key: "Escape" });

    expect(screen.getByText("2 / 3")).toBeVisible();
    expect(document.body).not.toHaveClass("yaseendraw-presentation-tools");
    expect(onExit).not.toHaveBeenCalled();

    editor.remove();
  });

  it("owns both chrome body classes and clears them on unmount", async () => {
    const { api } = createApi();
    const { unmount } = render(
      <StrictMode>
        <PresentationPlayer excalidrawAPI={api} onExit={vi.fn()} />
      </StrictMode>,
    );
    await act(async () => undefined);

    expect(document.body).toHaveClass("yaseendraw-presentation-active");
    expect(document.body).not.toHaveClass("yaseendraw-presentation-tools");

    fireEvent.keyDown(document, { key: "t" });
    expect(document.body).toHaveClass("yaseendraw-presentation-tools");

    unmount();
    await act(async () => undefined);

    expect(document.body).not.toHaveClass("yaseendraw-presentation-active");
    expect(document.body).not.toHaveClass("yaseendraw-presentation-tools");
  });

  it("restores frames when unmounted without an explicit exit", async () => {
    const { api } = createApi();
    const { unmount } = render(
      <PresentationPlayer excalidrawAPI={api} onExit={vi.fn()} />,
    );

    unmount();
    await act(async () => undefined);

    expect(api.updateFrameRendering).toHaveBeenLastCalledWith({
      outline: true,
      name: true,
    });
  });
});
