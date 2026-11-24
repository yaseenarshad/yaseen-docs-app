import React from "react";
import { vi } from "vitest";

const { resizeCallbacks } = vi.hoisted(() => {
  const callbacks: ResizeObserverCallback[] = [];
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) {
        callbacks.push(cb);
      }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    } as unknown as typeof ResizeObserver;
  }
  return { resizeCallbacks: callbacks };
});

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { UI } from "./helpers/ui";
import {
  act,
  fireEvent,
  GlobalTestState,
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
  unmountComponent,
  waitFor,
} from "./test-utils";

const { h } = window;

type Deferred<T = void> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

const createDeferred = <T = void>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const createFakeAnimation = (opts?: {
  playState?: AnimationPlayState;
  iterations?: number;
  endTime?: number;
}) => {
  const deferred = createDeferred<Animation>();
  const animation: any = {
    playState: opts?.playState ?? "running",
    finished: deferred.promise,
    effect:
      opts?.iterations !== undefined || opts?.endTime !== undefined
        ? {
            getComputedTiming: () => ({
              iterations: opts?.iterations ?? 1,
              endTime: opts?.endTime ?? 120,
            }),
          }
        : undefined,
  };
  return {
    animation: animation as Animation,
    finish: () => {
      animation.playState = "finished";
      deferred.resolve(animation as Animation);
    },
    cancel: () => {
      animation.playState = "idle";
      deferred.reject(new DOMException("aborted", "AbortError"));
    },
  };
};

const flushMicrotasks = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("YAZ-6461: self-healing canvas offsets & ancestor animation settling", () => {
  beforeEach(() => {
    resizeCallbacks.length = 0;
  });

  afterEach(() => {
    unmountComponent();
    restoreOriginalGetBoundingClientRect();
  });

  const triggerResizeObserver = () => {
    act(() => {
      for (const cb of resizeCallbacks) {
        cb([], {} as ResizeObserver);
      }
    });
  };

  describe("Part A: W3C Web Animations settling in updateDOMRect() and refresh()", () => {
    it("re-measures once a running ancestor animation finishes after ResizeObserver measures mid-animation", async () => {
      mockBoundingClientRect({
        left: 260,
        top: 40,
        width: 1000,
        height: 800,
      });

      const { container } = await render(
        <div data-testid="workspace">
          <Excalidraw handleKeyboardGlobally={true} />
        </div>,
      );
      await waitFor(() => expect(h.state.offsetLeft).toBe(260));

      const workspace = container.querySelector(
        '[data-testid="workspace"]',
      ) as HTMLElement;
      const glide = createFakeAnimation();
      workspace.getAnimations = () => [glide.animation];

      // Simulate ResizeObserver firing mid-glide (stale/intermediate translateX)
      mockBoundingClientRect({
        left: 140,
        top: 40,
        width: 1260,
        height: 800,
      });
      triggerResizeObserver();

      expect(h.state.offsetLeft).toBe(140);
      expect(h.state.width).toBe(1260);

      // Animation settles to final geometry (sidebar closed: left = 0)
      mockBoundingClientRect({
        left: 0,
        top: 40,
        width: 1260,
        height: 800,
      });
      glide.finish();
      await flushMicrotasks();

      expect(h.state.offsetLeft).toBe(0);
      expect(h.state.offsetTop).toBe(40);
      expect(h.state.width).toBe(1260);
      expect(h.state.height).toBe(800);
    });

    it("re-measures after api.refresh() is called mid-animation (e.g. tab zoom-in onShown)", async () => {
      mockBoundingClientRect({
        left: 0,
        top: 40,
        width: 1200,
        height: 800,
      });

      const { container } = await render(
        <div data-testid="tabstack-layer">
          <Excalidraw handleKeyboardGlobally={true} />
        </div>,
      );
      await waitFor(() => expect(h.state.width).toBe(1200));

      const layer = container.querySelector(
        '[data-testid="tabstack-layer"]',
      ) as HTMLElement;
      const zoomIn = createFakeAnimation();
      layer.getAnimations = () => [zoomIn.animation];

      // Mid-zoom-in scale(0.96) rect
      mockBoundingClientRect({
        left: 24,
        top: 56,
        width: 1152,
        height: 768,
      });
      act(() => {
        h.app.refresh();
      });
      expect(h.state.offsetLeft).toBe(24);
      expect(h.state.width).toBe(1152);

      // Zoom-in finishes to scale(1)
      mockBoundingClientRect({
        left: 0,
        top: 40,
        width: 1200,
        height: 800,
      });
      zoomIn.finish();
      await flushMicrotasks();

      expect(h.state.offsetLeft).toBe(0);
      expect(h.state.offsetTop).toBe(40);
      expect(h.state.width).toBe(1200);
      expect(h.state.height).toBe(800);
    });

    it("cancels/supersedes an earlier animation settle when a second animation starts, and cancels safely on unmount", async () => {
      mockBoundingClientRect({
        left: 260,
        top: 40,
        width: 1000,
        height: 800,
      });

      const { container } = await render(
        <div data-testid="workspace">
          <Excalidraw handleKeyboardGlobally={true} />
        </div>,
      );
      await waitFor(() => expect(h.state.offsetLeft).toBe(260));

      const workspace = container.querySelector(
        '[data-testid="workspace"]',
      ) as HTMLElement;

      const animA = createFakeAnimation();
      workspace.getAnimations = () => [animA.animation];
      mockBoundingClientRect({ left: 130, top: 40, width: 1130, height: 800 });
      triggerResizeObserver();
      expect(h.state.offsetLeft).toBe(130);

      // Rapid second toggle starts animB before animA settles
      const animB = createFakeAnimation();
      workspace.getAnimations = () => [animB.animation];
      mockBoundingClientRect({ left: 200, top: 40, width: 1060, height: 800 });
      triggerResizeObserver();
      expect(h.state.offsetLeft).toBe(200);

      // animA cancels/rejects while rect is still mid-animB: must NOT clobber or throw
      mockBoundingClientRect({ left: 999, top: 40, width: 1000, height: 800 });
      animA.cancel();
      await flushMicrotasks();
      expect(h.state.offsetLeft).toBe(200);

      // animB finishes at the true settled rect
      mockBoundingClientRect({ left: 260, top: 40, width: 1000, height: 800 });
      animB.finish();
      await flushMicrotasks();
      expect(h.state.offsetLeft).toBe(260);
      expect(h.state.width).toBe(1000);

      // Start animC and unmount before it finishes: must not throw or call setState
      const animC = createFakeAnimation();
      workspace.getAnimations = () => [animC.animation];
      triggerResizeObserver();

      const setStateSpy = vi.spyOn(h.app, "setState");
      unmountComponent();
      setStateSpy.mockClear();

      mockBoundingClientRect({ left: 0, top: 0, width: 1260, height: 800 });
      animC.finish();
      await flushMicrotasks();

      expect(setStateSpy).not.toHaveBeenCalled();
    });

    it("ignores infinite ancestor animations so finite transitions still settle", async () => {
      mockBoundingClientRect({
        left: 260,
        top: 40,
        width: 1000,
        height: 800,
      });

      const { container } = await render(
        <div data-testid="workspace">
          <Excalidraw handleKeyboardGlobally={true} />
        </div>,
      );
      await waitFor(() => expect(h.state.offsetLeft).toBe(260));

      const workspace = container.querySelector(
        '[data-testid="workspace"]',
      ) as HTMLElement;
      const infiniteSpinner = createFakeAnimation({
        iterations: Infinity,
        endTime: Infinity,
      });
      const glide = createFakeAnimation({ iterations: 1, endTime: 120 });
      workspace.getAnimations = () => [
        infiniteSpinner.animation,
        glide.animation,
      ];

      mockBoundingClientRect({ left: 120, top: 40, width: 1260, height: 800 });
      triggerResizeObserver();
      expect(h.state.offsetLeft).toBe(120);

      mockBoundingClientRect({ left: 0, top: 40, width: 1260, height: 800 });
      glide.finish();
      await flushMicrotasks();

      expect(h.state.offsetLeft).toBe(0);
    });

    it("still schedules post-animation settle when ResizeObserver fires at t=0ms while rect equals current state", async () => {
      mockBoundingClientRect({
        left: 260,
        top: 40,
        width: 1000,
        height: 800,
      });

      const { container } = await render(
        <div data-testid="workspace">
          <Excalidraw handleKeyboardGlobally={true} />
        </div>,
      );
      await waitFor(() => expect(h.state.offsetLeft).toBe(260));

      const workspace = container.querySelector(
        '[data-testid="workspace"]',
      ) as HTMLElement;
      const flip = createFakeAnimation();
      workspace.getAnimations = () => [flip.animation];

      // At t=0ms of a FLIP animation, rect still matches previous state (260, 40, 1000, 800)
      triggerResizeObserver();
      expect(h.state.offsetLeft).toBe(260);

      // Once FLIP finishes, rect settles to (0, 40, 1260, 800)
      mockBoundingClientRect({ left: 0, top: 40, width: 1260, height: 800 });
      flip.finish();
      await flushMicrotasks();

      expect(h.state.offsetLeft).toBe(0);
      expect(h.state.width).toBe(1260);
    });
  });

  describe("Part B: self-healing rect sync at discrete interaction boundaries", () => {
    it("heals stale offsets synchronously on the very first pointerdown without prior move/resize, and does zero extra setState when already synced", async () => {
      mockBoundingClientRect({
        left: 260,
        top: 40,
        width: 1000,
        height: 800,
      });

      await render(<Excalidraw handleKeyboardGlobally={true} />);
      await waitFor(() => expect(h.state.offsetLeft).toBe(260));

      // Place a rectangle at scene (100, 100) size 80x80
      const rect = API.createElement({
        type: "rectangle",
        x: 100,
        y: 100,
        width: 80,
        height: 80,
      });
      API.setElements([rect]);
      API.setAppState({ scrollX: 0, scrollY: 0 });

      // Sidebar collapses without notifying Excalidraw (rect shifts left from 260 -> 0)
      mockBoundingClientRect({
        left: 0,
        top: 40,
        width: 1260,
        height: 800,
      });
      expect(h.state.offsetLeft).toBe(260); // stale!

      // First click directly on the rectangle at live viewport coords (140, 180)
      // Live scene coords: (140 - 0, 180 - 40) = (140, 140) -> inside [100..180, 100..180]!
      // Stale scene coords would have been (140 - 260, 180 - 40) = (-120, 140) -> miss!
      fireEvent.pointerDown(GlobalTestState.interactiveCanvas, {
        clientX: 140,
        clientY: 180,
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
      });
      fireEvent.pointerUp(GlobalTestState.interactiveCanvas, {
        clientX: 140,
        clientY: 180,
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
      });

      expect(h.state.offsetLeft).toBe(0);
      expect(h.state.width).toBe(1260);
      expect(h.state.selectedElementIds[rect.id]).toBe(true);

      // Fast path check: when rect already matches state, pointerenter triggers ZERO setState calls
      const excalidrawContainer = document.querySelector(
        ".excalidraw-container",
      ) as HTMLElement;
      const setStateSpy = vi.spyOn(h.app, "setState");
      fireEvent.pointerEnter(excalidrawContainer);
      expect(setStateSpy).not.toHaveBeenCalled();

      // And on pointerDown when synced, setState is never called with offsetLeft/offsetTop/width/height
      setStateSpy.mockClear();
      fireEvent.pointerDown(GlobalTestState.interactiveCanvas, {
        clientX: 140,
        clientY: 180,
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
      });
      const rectSyncCalls = setStateSpy.mock.calls.filter(([arg]) => {
        if (!arg || typeof arg !== "object") {
          return false;
        }
        return (
          "offsetLeft" in arg ||
          "offsetTop" in arg ||
          "width" in arg ||
          "height" in arg
        );
      });
      expect(rectSyncCalls).toHaveLength(0);
    });

    it("heals stale offsets on pointerenter before any click", async () => {
      mockBoundingClientRect({
        left: 260,
        top: 40,
        width: 1000,
        height: 800,
      });

      await render(<Excalidraw handleKeyboardGlobally={true} />);
      await waitFor(() => expect(h.state.offsetLeft).toBe(260));

      mockBoundingClientRect({
        left: 40,
        top: 60,
        width: 1220,
        height: 780,
      });
      expect(h.state.offsetLeft).toBe(260);

      const excalidrawContainer = document.querySelector(
        ".excalidraw-container",
      ) as HTMLElement;
      fireEvent.pointerEnter(excalidrawContainer);

      expect(h.state.offsetLeft).toBe(40);
      expect(h.state.offsetTop).toBe(60);
      expect(h.state.width).toBe(1220);
      expect(h.state.height).toBe(780);
    });

    it("heals stale offsets on wheel zoom (YAZ-6403) and zooms around the live focal point", async () => {
      mockBoundingClientRect({
        left: 260,
        top: 40,
        width: 1000,
        height: 800,
      });

      await render(<Excalidraw handleKeyboardGlobally={true} />);
      await waitFor(() => expect(h.state.offsetLeft).toBe(260));

      API.setAppState({ scrollX: 0, scrollY: 0 });

      // Sidebar collapses (left: 260 -> 0) without ResizeObserver firing
      mockBoundingClientRect({
        left: 0,
        top: 40,
        width: 1260,
        height: 800,
      });

      const clientX = 300;
      const clientY = 240;
      // Live scene point under cursor before zoom: (300 - 0, 240 - 40) = (300, 200)
      fireEvent.wheel(GlobalTestState.interactiveCanvas, {
        ctrlKey: true,
        deltaY: -10,
        clientX,
        clientY,
      });

      expect(h.state.offsetLeft).toBe(0);
      expect(h.state.width).toBe(1260);

      // The scene point under (clientX, clientY) after zoom must remain (300, 200)!
      const sceneXAfter =
        (clientX - h.state.offsetLeft) / h.state.zoom.value - h.state.scrollX;
      const sceneYAfter =
        (clientY - h.state.offsetTop) / h.state.zoom.value - h.state.scrollY;
      expect(sceneXAfter).toBeCloseTo(300, 2);
      expect(sceneYAfter).toBeCloseTo(200, 2);
    });

    it("heals stale offsets on dblclick so created text lands at live scene coords", async () => {
      mockBoundingClientRect({
        left: 260,
        top: 40,
        width: 1000,
        height: 800,
      });

      await render(<Excalidraw handleKeyboardGlobally={true} />);
      await waitFor(() => expect(h.state.offsetLeft).toBe(260));

      API.setAppState({ scrollX: 0, scrollY: 0 });

      // Shift container left from 260 -> 0 without notifying Excalidraw
      mockBoundingClientRect({
        left: 0,
        top: 40,
        width: 1260,
        height: 800,
      });

      fireEvent.doubleClick(GlobalTestState.interactiveCanvas, {
        clientX: 300,
        clientY: 240,
      });

      expect(h.state.offsetLeft).toBe(0);
      const text = h.state.editingTextElement;
      expect(text).not.toBeNull();
      // Live scene coords: (300 - 0, 240 - 40) = (300, 200), centered on text box; stale would be ~40
      expect(text!.x + text!.width / 2).toBeCloseTo(300, 0);
      expect(Math.abs(text!.y - 200)).toBeLessThan(30);
    });

    it("heals stale offsets on contextmenu so element hit-testing uses live scene coords", async () => {
      mockBoundingClientRect({
        left: 260,
        top: 40,
        width: 1000,
        height: 800,
      });

      await render(<Excalidraw handleKeyboardGlobally={true} />);
      await waitFor(() => expect(h.state.offsetLeft).toBe(260));

      const rect = API.createElement({
        type: "rectangle",
        x: 100,
        y: 100,
        width: 80,
        height: 80,
      });
      API.setElements([rect]);
      API.setAppState({ scrollX: 0, scrollY: 0 });

      // Shift container left from 260 -> 0 without notifying Excalidraw
      mockBoundingClientRect({
        left: 0,
        top: 40,
        width: 1260,
        height: 800,
      });

      // Right-click on live viewport coords (140, 180) => scene (140, 140), inside rect
      fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
        button: 2,
        clientX: 140,
        clientY: 180,
      });

      expect(h.state.offsetLeft).toBe(0);
      expect(h.state.selectedElementIds[rect.id]).toBe(true);
      expect(UI.queryContextMenu()).not.toBeNull();
    });

    it("heals stale offsets on drop so dropped content lands at live scene coords", async () => {
      mockBoundingClientRect({
        left: 260,
        top: 40,
        width: 1000,
        height: 800,
      });

      await render(
        <Excalidraw
          handleKeyboardGlobally={true}
          hostLinks={{
            resolve: (inner) => ({ label: inner, missing: false }),
            dropLinks: () => ["[[Note]]"],
          }}
        />,
      );
      await waitFor(() => expect(h.state.offsetLeft).toBe(260));
      API.setAppState({ scrollX: 0, scrollY: 0 });

      // Shift container left from 260 -> 0 without notifying Excalidraw
      mockBoundingClientRect({
        left: 0,
        top: 40,
        width: 1260,
        height: 800,
      });

      const excalidrawContainer = document.querySelector(
        ".excalidraw-container",
      ) as HTMLElement;
      const dt = new DataTransfer();
      dt.items.add(new File(["hello"], "note.md", { type: "text/markdown" }));

      const dropEvent = new MouseEvent("drop", {
        bubbles: true,
        cancelable: true,
        clientX: 300,
        clientY: 240,
      });
      Object.defineProperty(dropEvent, "dataTransfer", { value: dt });

      await act(async () => {
        fireEvent(excalidrawContainer, dropEvent);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(h.state.offsetLeft).toBe(0);
      const texts = h.elements.filter((el) => el.type === "text");
      expect(texts).toHaveLength(1);
      // Live scene coords: (300 - 0, 240 - 40) = (300, 200), centered on text box; stale would be ~40
      expect(texts[0].x + texts[0].width / 2).toBeCloseTo(300, 0);
      expect(texts[0].y + texts[0].height / 2).toBeCloseTo(200, 0);
    });

    it("never clobbers valid offsets or dimensions when container rect is hidden (0x0)", async () => {
      mockBoundingClientRect({
        left: 260,
        top: 40,
        width: 1000,
        height: 800,
      });

      await render(<Excalidraw handleKeyboardGlobally={true} />);
      await waitFor(() => expect(h.state.offsetLeft).toBe(260));

      // Container becomes display:none => 0x0 rect
      mockBoundingClientRect({
        left: 0,
        top: 0,
        width: 0,
        height: 0,
      });

      triggerResizeObserver();
      act(() => {
        h.app.refresh();
      });

      const excalidrawContainer = document.querySelector(
        ".excalidraw-container",
      ) as HTMLElement;
      fireEvent.pointerEnter(excalidrawContainer);
      fireEvent.pointerDown(GlobalTestState.interactiveCanvas, {
        clientX: 300,
        clientY: 200,
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
      });
      fireEvent.wheel(GlobalTestState.interactiveCanvas, {
        ctrlKey: true,
        deltaY: -10,
        clientX: 300,
        clientY: 200,
      });
      fireEvent.doubleClick(GlobalTestState.interactiveCanvas, {
        clientX: 300,
        clientY: 200,
      });
      fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
        button: 2,
        clientX: 300,
        clientY: 200,
      });

      expect(h.state.offsetLeft).toBe(260);
      expect(h.state.offsetTop).toBe(40);
      expect(h.state.width).toBe(1000);
      expect(h.state.height).toBe(800);
    });
  });
});
