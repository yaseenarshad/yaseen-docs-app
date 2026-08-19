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

const createApi = (ids = ["one", "two", "three"]) => {
  let elements = ids.map((id, index) => frame(id, index + 1));
  let onChange: Parameters<ExcalidrawImperativeAPI["onChange"]>[0] | null =
    null;
  return {
    api: {
      getSceneElements: () => elements,
      // Identity mapping between client and scene coordinates, so the overview
      // hit-test in the tests below can use frame coordinates directly.
      getAppState: () => ({
        zoom: { value: 1 },
        offsetLeft: 0,
        offsetTop: 0,
        scrollX: 0,
        scrollY: 0,
        activeTool: { type: "selection" },
      }),
      setActiveTool: vi.fn(),
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

/** The bar is icons only (GRO-1938), so position is read from the live region. */
const expectSlide = (index: number, total: number) =>
  expect(
    screen.getByText(new RegExp(`slide ${index} of ${total}`, "i")),
  ).toBeVisible();

const control = (name: string) => screen.getByRole("button", { name });

/**
 * What every presentation `setViewport` call is expected to pass (GRO-1948) —
 * spelled out from the current window rather than read back from the helper.
 */
const cameraOffsets = () => ({
  ui: true,
  right: Math.round(window.innerWidth * 0.32),
});

const DEFAULT_WINDOW_WIDTH = window.innerWidth;

const setWindowWidth = (width: number) =>
  Object.defineProperty(window, "innerWidth", {
    value: width,
    configurable: true,
    writable: true,
  });

describe("PresentationPlayer", () => {
  beforeEach(() => {
    window.localStorage.removeItem(FRAMES_VISIBLE_STORAGE_KEY);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    // Half the suite reads `innerWidth` (click-half navigation, the camera
    // reserve), so a resize test must not leak its window into the next one.
    setWindowWidth(DEFAULT_WINDOW_WIDTH);
  });

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
      offsets: cameraOffsets(),
    });
    // Free-form (D9): the hand tool pans the canvas while presenting.
    expect(api.setActiveTool).toHaveBeenLastCalledWith({ type: "hand" });
    expectSlide(2, 3);
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
    expectSlide(3, 3);
    fireEvent.keyDown(document, { key: "Home" });
    expectSlide(1, 3);
    fireEvent.click(control("Next slide (→)"));
    expectSlide(2, 3);
    fireEvent.click(control("Previous slide (←)"));
    expectSlide(1, 3);
    fireEvent.keyDown(document, { key: "PageDown" });
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expectSlide(1, 3);

    // Esc zooms out to the whole deck and never ends the presentation (D7).
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onExit).not.toHaveBeenCalled();
    expect(api.setViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({ target: expect.any(Array) }),
    );
    expectSlide(1, 3);

    fireEvent.click(control("Exit presentation"));
    expect(api.setViewport).toHaveBeenLastCalledWith(null);
    expect(api.setActiveTool).toHaveBeenLastCalledWith({ type: "selection" });
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

    fireEvent.click(control("Next slide (→)"));
    expectSlide(2, 3);

    fireEvent.click(control("Exit presentation"));
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

    expectSlide(3, 3);
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

    expectSlide(2, 2);
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

    fireEvent.click(control("Exit presentation"));

    expect(api.updateFrameRendering).toHaveBeenLastCalledWith({
      outline: true,
      name: true,
    });
  });

  it("leaves frames hidden on exit when the edit preference is hidden", () => {
    window.localStorage.setItem(FRAMES_VISIBLE_STORAGE_KEY, "false");
    const { api } = createApi();
    render(<PresentationPlayer excalidrawAPI={api} onExit={vi.fn()} />);

    fireEvent.click(control("Exit presentation"));

    expect(api.updateFrameRendering).toHaveBeenLastCalledWith({
      outline: false,
      name: false,
    });
  });

  it("swaps hand/selection tool with the chrome and re-fits, never locking", () => {
    const { api } = createApi();
    render(
      <PresentationPlayer
        excalidrawAPI={api}
        initialFrameId="one"
        onExit={vi.fn()}
      />,
    );

    fireEvent.click(control("Show tools (⇧T)"));

    expect(document.body).toHaveClass("yaseendraw-presentation-tools");
    expect(api.setActiveTool).toHaveBeenLastCalledWith({ type: "selection" });
    expect(api.setViewport).toHaveBeenLastCalledWith({
      target: "one",
      fit: "contain",
      animation: true,
      offsets: cameraOffsets(),
    });

    fireEvent.click(control("Hide tools (⇧T)"));

    expect(document.body).not.toHaveClass("yaseendraw-presentation-tools");
    expect(api.setActiveTool).toHaveBeenLastCalledWith({ type: "hand" });
    expect(api.setViewport).toHaveBeenLastCalledWith({
      target: "one",
      fit: "contain",
      animation: true,
      offsets: cameraOffsets(),
    });
  });

  it("navigates with the tools shown and leaves them shown", () => {
    const { api } = createApi();
    render(
      <PresentationPlayer
        excalidrawAPI={api}
        initialFrameId="one"
        onExit={vi.fn()}
      />,
    );
    fireEvent.keyDown(document, { key: "T", shiftKey: true });

    fireEvent.keyDown(document, { key: "ArrowRight" });

    expectSlide(2, 3);
    expect(api.setViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({ target: "two" }),
    );
    expect(api.setViewport).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ lock: expect.anything() }),
    );
    expect(document.body).toHaveClass("yaseendraw-presentation-tools");
    expect(control("Hide tools (⇧T)")).toBeVisible();
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
    expectSlide(2, 3);

    fireEvent.keyDown(document, { key: "T", shiftKey: true });
    fireEvent.keyDown(document, { key: " " });
    expectSlide(2, 3);

    fireEvent.keyDown(document, { key: "ArrowRight" });
    expectSlide(3, 3);
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
    fireEvent.keyDown(document, { key: "T", shiftKey: true });

    fireEvent.click(screen.getByRole("dialog"), { clientX: 1 });

    expectSlide(2, 3);
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
    fireEvent.keyDown(editor, { key: "T", shiftKey: true });
    fireEvent.keyDown(editor, { key: "Escape" });

    expectSlide(2, 3);
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

    fireEvent.keyDown(document, { key: "T", shiftKey: true });
    expect(document.body).toHaveClass("yaseendraw-presentation-tools");

    unmount();
    await act(async () => undefined);

    expect(document.body).not.toHaveClass("yaseendraw-presentation-active");
    expect(document.body).not.toHaveClass("yaseendraw-presentation-tools");
  });

  it("renders four icon controls in tab order with no text labels", () => {
    const { api } = createApi();
    const { container } = render(
      <PresentationPlayer excalidrawAPI={api} onExit={vi.fn()} />,
    );

    const bar = container.ownerDocument.querySelector(
      ".presentation-player__controls",
    )!;
    const buttons = Array.from(bar.querySelectorAll("button"));

    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Previous slide (←)",
      "Next slide (→)",
      "Show tools (⇧T)",
      "Exit presentation",
    ]);
    // Tooltip and accessible name are the same string on every control.
    expect(buttons.map((button) => button.title)).toEqual(
      buttons.map((button) => button.getAttribute("aria-label")),
    );
    expect(bar.textContent).toBe("");
  });

  it("disables the arrows at the ends of the deck", () => {
    const { api } = createApi();
    render(
      <PresentationPlayer
        excalidrawAPI={api}
        initialFrameId="one"
        onExit={vi.fn()}
      />,
    );

    expect(control("Previous slide (←)")).toBeDisabled();
    expect(control("Next slide (→)")).toBeEnabled();

    fireEvent.keyDown(document, { key: "End" });

    expect(control("Previous slide (←)")).toBeEnabled();
    expect(control("Next slide (→)")).toBeDisabled();
  });

  it("zooms out to every frame on Escape without changing the slide", () => {
    const { api } = createApi();
    const lifecycle: PresentationFrameLifecycleDetail[] = [];
    const listener = (event: Event) =>
      lifecycle.push(
        (event as CustomEvent<PresentationFrameLifecycleDetail>).detail,
      );
    window.addEventListener(PRESENTATION_FRAME_LIFECYCLE_EVENT, listener);
    render(
      <PresentationPlayer
        excalidrawAPI={api}
        initialFrameId="two"
        onExit={vi.fn()}
      />,
    );
    act(() => vi.advanceTimersByTime(PRESENTATION_TRANSITION_DURATION + 20));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(api.setViewport).toHaveBeenLastCalledWith({
      target: [
        expect.objectContaining({ id: "one" }),
        expect.objectContaining({ id: "two" }),
        expect.objectContaining({ id: "three" }),
      ],
      fit: "contain",
      animation: { duration: PRESENTATION_TRANSITION_DURATION },
      offsets: cameraOffsets(),
    });
    expect(lifecycle.at(-1)).toMatchObject({
      frameId: "two",
      order: 2,
      phase: "transitioning",
      reason: "deck",
    });
    expectSlide(2, 3);

    // ← → from the deck go to the neighbouring slide.
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expectSlide(3, 3);
    expect(api.setViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({ target: "three" }),
    );
    window.removeEventListener(PRESENTATION_FRAME_LIFECYCLE_EVENT, listener);
  });

  it("keeps an in-flight transition from activating once zoomed out", () => {
    const { api } = createApi();
    const lifecycle: PresentationFrameLifecycleDetail[] = [];
    const listener = (event: Event) =>
      lifecycle.push(
        (event as CustomEvent<PresentationFrameLifecycleDetail>).detail,
      );
    window.addEventListener(PRESENTATION_FRAME_LIFECYCLE_EVENT, listener);
    render(<PresentationPlayer excalidrawAPI={api} onExit={vi.fn()} />);

    fireEvent.keyDown(document, { key: "Escape" });
    act(() => vi.advanceTimersByTime(PRESENTATION_TRANSITION_DURATION + 20));

    expect(lifecycle.some((event) => event.phase === "active")).toBe(false);
    window.removeEventListener(PRESENTATION_FRAME_LIFECYCLE_EVENT, listener);
  });

  it("presents the frame double-clicked on the canvas and ignores a miss or single click", () => {
    const { api } = createApi();
    render(
      <PresentationPlayer
        excalidrawAPI={api}
        initialFrameId="one"
        onExit={vi.fn()}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });

    // `frame("three", 3)` sits at x 6000..7280, y 3000..3720.
    // A single click pans (free-form); it must not present.
    fireEvent.click(document.body, { clientX: 6100, clientY: 3100 });
    expectSlide(1, 3);

    fireEvent.doubleClick(document.body, { clientX: 6100, clientY: 3100 });

    expectSlide(3, 3);
    expect(api.setViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({ target: "three" }),
    );

    // A miss does nothing.
    fireEvent.doubleClick(document.body, { clientX: 1, clientY: 1 });
    expectSlide(3, 3);
    expect(api.setViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({ target: "three" }),
    );
  });

  it("publishes the normal slide change when a frame is double-clicked", () => {
    const { api } = createApi();
    const lifecycle: PresentationFrameLifecycleDetail[] = [];
    const listener = (event: Event) =>
      lifecycle.push(
        (event as CustomEvent<PresentationFrameLifecycleDetail>).detail,
      );
    window.addEventListener(PRESENTATION_FRAME_LIFECYCLE_EVENT, listener);
    render(
      <PresentationPlayer
        excalidrawAPI={api}
        initialFrameId="one"
        onExit={vi.fn()}
      />,
    );
    act(() => vi.advanceTimersByTime(PRESENTATION_TRANSITION_DURATION + 20));

    fireEvent.doubleClick(document.body, { clientX: 4100, clientY: 2100 });
    act(() => vi.advanceTimersByTime(PRESENTATION_TRANSITION_DURATION + 20));

    expect(
      lifecycle.filter((event) => event.reason === "double-click"),
    ).toMatchObject([
      { frameId: "one", order: 1, phase: "inactive" },
      { frameId: "two", order: 2, phase: "transitioning" },
      { frameId: "two", order: 2, phase: "active" },
    ]);
    window.removeEventListener(PRESENTATION_FRAME_LIFECYCLE_EVENT, listener);
  });

  it("ignores a double-click while typing in a text editor", () => {
    const { api } = createApi();
    render(
      <PresentationPlayer
        excalidrawAPI={api}
        initialFrameId="one"
        onExit={vi.fn()}
      />,
    );
    const editor = document.createElement("textarea");
    document.body.appendChild(editor);

    fireEvent.doubleClick(editor, { clientX: 6100, clientY: 3100 });

    expectSlide(1, 3);
    editor.remove();
  });

  it("toggles tools on Shift+T and leaves plain T to the text tool", () => {
    const { api } = createApi();
    render(<PresentationPlayer excalidrawAPI={api} onExit={vi.fn()} />);

    fireEvent.keyDown(document, { key: "t" });

    expect(document.body).not.toHaveClass("yaseendraw-presentation-tools");
    expect(control("Show tools (⇧T)")).toBeVisible();

    fireEvent.keyDown(document, { key: "T", shiftKey: true });
    expect(document.body).toHaveClass("yaseendraw-presentation-tools");

    fireEvent.keyDown(document, { key: "T", shiftKey: true });
    expect(document.body).not.toHaveClass("yaseendraw-presentation-tools");
  });

  it("re-fits the slide with fresh offsets on resize, and stops once exited", () => {
    const { api } = createApi();
    render(
      <PresentationPlayer
        excalidrawAPI={api}
        initialFrameId="two"
        onExit={vi.fn()}
      />,
    );
    act(() => vi.advanceTimersByTime(PRESENTATION_TRANSITION_DURATION + 20));

    setWindowWidth(1600);
    const callsBefore = vi.mocked(api.setViewport).mock.calls.length;
    fireEvent(window, new Event("resize"));
    fireEvent(window, new Event("resize"));
    // Debounced: a burst of resize events costs a single viewport write.
    expect(vi.mocked(api.setViewport).mock.calls).toHaveLength(callsBefore);

    act(() => vi.advanceTimersByTime(200));

    expect(api.setViewport).toHaveBeenLastCalledWith({
      target: "two",
      fit: "contain",
      animation: false,
      offsets: { ui: true, right: 512 },
    });

    fireEvent.click(control("Exit presentation"));
    expect(api.setViewport).toHaveBeenLastCalledWith(null);

    fireEvent(window, new Event("resize"));
    act(() => vi.advanceTimersByTime(200));
    expect(api.setViewport).toHaveBeenLastCalledWith(null);
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
