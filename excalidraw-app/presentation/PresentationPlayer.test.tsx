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
      }),
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
    fireEvent.click(screen.getByRole("dialog"), { clientX: 1 });
    expectSlide(1, 3);
    fireEvent.keyDown(document, { key: "PageDown" });
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expectSlide(1, 3);

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

    fireEvent.click(control("Next slide (→)"));
    expectSlide(2, 3);

    fireEvent.click(control("Exit presentation (Esc)"));
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

    fireEvent.click(control("Show tools (⇧T)"));

    expect(document.body).toHaveClass("yaseendraw-presentation-tools");
    expect(api.setViewport).toHaveBeenLastCalledWith({
      target: "one",
      fit: "contain",
      offsets: { ui: true },
    });

    fireEvent.click(control("Hide tools (⇧T)"));

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
    fireEvent.keyDown(document, { key: "T", shiftKey: true });

    fireEvent.keyDown(document, { key: "ArrowRight" });

    expectSlide(2, 3);
    expect(api.setViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        target: "two",
        lock: { scroll: true, zoom: true, overscroll: false },
      }),
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

  it("renders five icon controls in tab order with no text labels", () => {
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
      "Overview (⇧O)",
      "Show tools (⇧T)",
      "Exit presentation (Esc)",
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

  it("zooms out to every frame in overview without changing the slide", () => {
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

    fireEvent.click(control("Overview (⇧O)"));

    expect(api.setViewport).toHaveBeenLastCalledWith({
      target: [
        expect.objectContaining({ id: "one" }),
        expect.objectContaining({ id: "two" }),
        expect.objectContaining({ id: "three" }),
      ],
      fit: "contain",
      animation: { duration: PRESENTATION_TRANSITION_DURATION },
      lock: { scroll: true, zoom: true, overscroll: false },
      offsets: { ui: true },
    });
    expect(lifecycle.at(-1)).toMatchObject({
      frameId: "two",
      order: 2,
      phase: "transitioning",
      reason: "overview",
    });
    expect(screen.getByText("Overview — 3 frames")).toBeVisible();

    fireEvent.click(control("Exit overview (⇧O)"));

    expectSlide(2, 3);
    expect(api.setViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        target: "two",
        lock: { scroll: true, zoom: true, overscroll: false },
      }),
    );
    expect(lifecycle.at(-1)).toMatchObject({
      frameId: "two",
      phase: "transitioning",
      reason: "overview-return",
    });
    window.removeEventListener(PRESENTATION_FRAME_LIFECYCLE_EVENT, listener);
  });

  it("keeps an in-flight transition from activating while zoomed out", () => {
    const { api } = createApi();
    const lifecycle: PresentationFrameLifecycleDetail[] = [];
    const listener = (event: Event) =>
      lifecycle.push(
        (event as CustomEvent<PresentationFrameLifecycleDetail>).detail,
      );
    window.addEventListener(PRESENTATION_FRAME_LIFECYCLE_EVENT, listener);
    render(<PresentationPlayer excalidrawAPI={api} onExit={vi.fn()} />);

    fireEvent.keyDown(document, { key: "O", shiftKey: true });
    act(() => vi.advanceTimersByTime(PRESENTATION_TRANSITION_DURATION + 20));

    expect(lifecycle.some((event) => event.phase === "active")).toBe(false);
    window.removeEventListener(PRESENTATION_FRAME_LIFECYCLE_EVENT, listener);
  });

  it("leaves overview when an arrow moves to another slide", () => {
    const { api } = createApi();
    render(
      <PresentationPlayer
        excalidrawAPI={api}
        initialFrameId="one"
        onExit={vi.fn()}
      />,
    );

    fireEvent.keyDown(document, { key: "O", shiftKey: true });
    fireEvent.keyDown(document, { key: "ArrowRight" });

    expectSlide(2, 3);
    expect(control("Overview (⇧O)")).toBeVisible();
    expect(api.setViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({ target: "two" }),
    );
  });

  it("returns to the slide on the first Escape from overview, exits on the next", () => {
    const { api } = createApi();
    const onExit = vi.fn();
    render(
      <PresentationPlayer
        excalidrawAPI={api}
        initialFrameId="two"
        onExit={onExit}
      />,
    );

    fireEvent.keyDown(document, { key: "O", shiftKey: true });
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onExit).not.toHaveBeenCalled();
    expectSlide(2, 3);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onExit).toHaveBeenCalledTimes(1);
    expect(api.setViewport).toHaveBeenLastCalledWith(null);
  });

  it("presents the frame clicked in overview and ignores a miss", () => {
    const { api } = createApi();
    render(
      <PresentationPlayer
        excalidrawAPI={api}
        initialFrameId="one"
        onExit={vi.fn()}
      />,
    );
    fireEvent.keyDown(document, { key: "O", shiftKey: true });

    // `frame("three", 3)` sits at x 6000..7280, y 3000..3720.
    fireEvent.click(screen.getByRole("dialog"), {
      clientX: 6100,
      clientY: 3100,
    });

    expectSlide(3, 3);
    expect(api.setViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        target: "three",
        lock: { scroll: true, zoom: true, overscroll: false },
      }),
    );

    fireEvent.keyDown(document, { key: "O", shiftKey: true });
    fireEvent.click(screen.getByRole("dialog"), { clientX: 1, clientY: 1 });

    expect(screen.getByText("Overview — 3 frames")).toBeVisible();
    expect(api.setViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({ target: expect.any(Array) }),
    );
  });

  it("publishes the normal slide change when a frame is clicked in overview", () => {
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

    fireEvent.keyDown(document, { key: "O", shiftKey: true });
    fireEvent.click(screen.getByRole("dialog"), {
      clientX: 4100,
      clientY: 2100,
    });
    act(() => vi.advanceTimersByTime(PRESENTATION_TRANSITION_DURATION + 20));

    expect(
      lifecycle.filter((event) => event.reason === "overview-click"),
    ).toMatchObject([
      { frameId: "one", order: 1, phase: "inactive" },
      { frameId: "two", order: 2, phase: "transitioning" },
      { frameId: "two", order: 2, phase: "active" },
    ]);
    window.removeEventListener(PRESENTATION_FRAME_LIFECYCLE_EVENT, listener);
  });

  it("keeps the deck framed when the tools are toggled in overview", () => {
    const { api } = createApi();
    render(
      <PresentationPlayer
        excalidrawAPI={api}
        initialFrameId="one"
        onExit={vi.fn()}
      />,
    );
    fireEvent.keyDown(document, { key: "O", shiftKey: true });

    fireEvent.keyDown(document, { key: "T", shiftKey: true });

    expect(api.setViewport).toHaveBeenLastCalledWith({
      target: [
        expect.objectContaining({ id: "one" }),
        expect.objectContaining({ id: "two" }),
        expect.objectContaining({ id: "three" }),
      ],
      fit: "contain",
      offsets: { ui: true },
    });
    expect(screen.getByText("Overview — 3 frames")).toBeVisible();
  });

  it("ignores overview clicks while tools are shown", () => {
    const { api } = createApi();
    render(
      <PresentationPlayer
        excalidrawAPI={api}
        initialFrameId="one"
        onExit={vi.fn()}
      />,
    );
    fireEvent.keyDown(document, { key: "O", shiftKey: true });
    fireEvent.keyDown(document, { key: "T", shiftKey: true });

    fireEvent.click(screen.getByRole("dialog"), {
      clientX: 6100,
      clientY: 3100,
    });

    expect(screen.getByText("Overview — 3 frames")).toBeVisible();
  });

  it("disables overview for a single-slide deck", () => {
    const { api } = createApi(["only"]);
    render(<PresentationPlayer excalidrawAPI={api} onExit={vi.fn()} />);

    expect(control("Overview (⇧O)")).toBeDisabled();
    expect(control("Previous slide (←)")).toBeDisabled();
    expect(control("Next slide (→)")).toBeDisabled();
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

  it("toggles overview on Shift+O and leaves plain o to the ellipse tool", () => {
    const { api } = createApi();
    render(<PresentationPlayer excalidrawAPI={api} onExit={vi.fn()} />);

    fireEvent.keyDown(document, { key: "o" });

    expect(control("Overview (⇧O)")).toBeVisible();

    fireEvent.keyDown(document, { key: "O", shiftKey: true });
    expect(control("Exit overview (⇧O)")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.keyDown(document, { key: "O", shiftKey: true });
    expectSlide(1, 3);
    expect(control("Overview (⇧O)")).toHaveAttribute("aria-pressed", "false");
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
