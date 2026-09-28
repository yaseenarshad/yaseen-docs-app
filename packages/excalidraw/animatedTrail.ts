import { LaserPointer } from "@excalidraw/laser-pointer";
import {
  SVG_NS,
  getSvgPathFromStroke,
  sceneCoordsToViewportCoords,
} from "@excalidraw/common";

import type { LaserPointerOptions, Point } from "@excalidraw/laser-pointer";

import { AnimationController } from "./renderer/animation";

import type App from "./components/App";
import type { AppState } from "./types";

export interface Trail {
  start(container: SVGSVGElement): void;
  stop(): void;

  startPath(x: number, y: number): void;
  addPointToPath(x: number, y: number): void;
  endPath(): void;
}

export interface AnimatedTrailOptions {
  fill: (trail: AnimatedTrail) => string;
  stroke?: (trail: AnimatedTrail) => string;
  animateTrail?: boolean;
  /**
   * A static trail looks the same on every frame: it doesn't keep the
   * animation loop running (it's redrawn on `redraw()` instead) and it isn't
   * dropped when its outline is momentarily empty.
   */
  isStatic?: (trail: LaserPointer) => boolean;
  /** called when the set of finished trails changes */
  onTrailsChange?: () => void;
}

/** per-stroke overrides of the trail-wide options */
export type TrailStrokeOptions = Partial<LaserPointerOptions> & {
  fill?: string;
};

export class AnimatedTrail implements Trail {
  private currentTrail?: LaserPointer;
  private pastTrails: LaserPointer[] = [];
  private trailFills = new WeakMap<LaserPointer, string>();
  private staticOutlines = new WeakMap<
    LaserPointer,
    { size: number; outline: Point[] }
  >();

  private container?: SVGSVGElement;
  private trailElement: SVGPathElement;
  // one <path> per run of consecutive trails sharing a fill, so per-stroke
  // fills keep their z-order (the first one is always `trailElement`)
  private pathElements: SVGPathElement[];
  private trailAnimation?: SVGAnimateElement;
  private key: string;

  private static counter = 0;

  constructor(
    protected app: App,
    private options: Partial<LaserPointerOptions> &
      Partial<AnimatedTrailOptions>,
  ) {
    this.key = `animated-trail-${AnimatedTrail.counter++}`;
    this.trailElement = document.createElementNS(SVG_NS, "path");
    this.pathElements = [this.trailElement];
    if (this.options.animateTrail) {
      this.trailAnimation = document.createElementNS(SVG_NS, "animate");
      // TODO: make this configurable
      this.trailAnimation.setAttribute("attributeName", "stroke-dashoffset");
      this.trailElement.setAttribute("stroke-dasharray", "7 7");
      this.trailElement.setAttribute("stroke-dashoffset", "10");
      this.trailAnimation.setAttribute("from", "0");
      this.trailAnimation.setAttribute("to", `-14`);
      this.trailAnimation.setAttribute("dur", "0.3s");
      this.trailElement.appendChild(this.trailAnimation);
    }
  }

  get hasCurrentTrail() {
    return !!this.currentTrail;
  }

  hasLastPoint(x: number, y: number) {
    if (this.currentTrail) {
      const len = this.currentTrail.originalPoints.length;
      return (
        this.currentTrail.originalPoints[len - 1][0] === x &&
        this.currentTrail.originalPoints[len - 1][1] === y
      );
    }

    return false;
  }

  private cleanup() {
    const hadTrails = this.pastTrails.length > 0;
    this.pastTrails = [];
    this.currentTrail = undefined;

    for (const element of this.pathElements) {
      if (element.parentNode === this.container) {
        this.container?.removeChild(element);
      }
    }
    this.pathElements = [this.trailElement];

    if (hadTrails) {
      this.options.onTrailsChange?.();
    }
  }

  start(container?: SVGSVGElement) {
    if (container) {
      this.container = container;
    }

    if (this.trailElement.parentNode !== this.container && this.container) {
      this.container.appendChild(this.trailElement);
    }

    if (!AnimationController.running(this.key)) {
      AnimationController.start(this.key, () => {
        const { visible, animating } = this.onFrame();
        if (animating) {
          return { keep: true };
        }

        // static trails stay on screen without keeping the loop running
        if (!visible) {
          this.cleanup();
        }

        return null;
      });
    }
  }

  stop() {
    AnimationController.cancel(this.key);
    this.cleanup();
  }

  /** redraws the trails once (e.g. static ones after a viewport change) */
  redraw() {
    if (this.container && (this.currentTrail || this.pastTrails.length)) {
      this.start();
    }
  }

  private createTrail(strokeOptions?: TrailStrokeOptions) {
    const { fill, ...options } = strokeOptions ?? {};
    const trail = new LaserPointer({ ...this.options, ...options });
    if (fill) {
      this.trailFills.set(trail, fill);
    }
    return trail;
  }

  startPath(x: number, y: number) {
    this.startStyledPath(x, y);
  }

  /** starts a path whose options (e.g. fill, size) override the trail's */
  startStyledPath(x: number, y: number, strokeOptions?: TrailStrokeOptions) {
    this.currentTrail = this.createTrail(strokeOptions);

    this.currentTrail.addPoint([x, y, performance.now()]);

    this.update();
  }

  addPointToPath(x: number, y: number) {
    if (this.currentTrail) {
      this.currentTrail.addPoint([x, y, performance.now()]);
      this.update();
    }
  }

  endPath() {
    if (this.currentTrail) {
      this.currentTrail.close();
      this.currentTrail.options.keepHead = false;
      this.pastTrails.push(this.currentTrail);
      this.currentTrail = undefined;
      this.update();
      this.options.onTrailsChange?.();
    }
  }

  /** builds a finished trail from points, without adding it to this trail */
  createFinishedTrail(points: Point[], strokeOptions?: TrailStrokeOptions) {
    const trail = this.createTrail(strokeOptions);
    for (const point of points) {
      trail.addPoint(point);
    }
    trail.close();
    trail.options.keepHead = false;
    return trail;
  }

  getTrailFill(trail: LaserPointer) {
    return this.trailFills.get(trail);
  }

  getCurrentTrail() {
    return this.currentTrail;
  }

  getPastTrails(): readonly LaserPointer[] {
    return this.pastTrails;
  }

  setPastTrails(trails: LaserPointer[]) {
    this.pastTrails = trails;
    this.update();
    this.options.onTrailsChange?.();
  }

  clearTrails() {
    const hadTrails = this.pastTrails.length > 0;
    this.pastTrails = [];
    this.currentTrail = undefined;
    this.update();
    if (hadTrails) {
      this.options.onTrailsChange?.();
    }
  }

  private update() {
    this.start();
    if (this.trailAnimation) {
      this.trailAnimation.setAttribute("begin", "indefinite");
      this.trailAnimation.setAttribute("repeatCount", "indefinite");
    }
  }

  private onFrame() {
    const state = this.app.state;
    const defaultFill = (this.options.fill ?? (() => "black"))(this);
    const paths: { fill: string; path: string }[] = [];
    const pastTrails: LaserPointer[] = [];
    let animating = !!this.currentTrail;

    for (const trail of this.pastTrails) {
      const isStatic = !!this.options.isStatic?.(trail);
      const outline = this.getStrokeOutline(trail, state, isStatic);

      if (outline.length === 0 && !isStatic) {
        continue;
      }

      pastTrails.push(trail);
      animating = animating || !isStatic;
      paths.push({
        fill: this.trailFills.get(trail) ?? defaultFill,
        path: this.drawTrail(outline, state),
      });
    }

    if (this.currentTrail) {
      paths.push({
        fill: this.trailFills.get(this.currentTrail) ?? defaultFill,
        path: this.drawTrail(
          this.getStrokeOutline(this.currentTrail, state, false),
          state,
        ),
      });
    }

    const trailsChanged = pastTrails.length !== this.pastTrails.length;
    this.pastTrails = pastTrails;

    this.render(paths);

    if (trailsChanged) {
      this.options.onTrailsChange?.();
    }

    return { visible: paths.length > 0, animating };
  }

  private render(paths: { fill: string; path: string }[]) {
    const runs: { fill: string; d: string }[] = [];
    for (const { fill, path } of paths) {
      const lastRun = runs[runs.length - 1];
      if (lastRun && lastRun.fill === fill) {
        lastRun.d += ` ${path}`;
      } else {
        runs.push({ fill, d: path });
      }
    }

    if (runs.length === 0) {
      // Clean up the SVG path if there are no trails to render
      this.trailElement.setAttribute("d", "");
    }

    runs.forEach((run, index) => {
      let element = this.pathElements[index];
      if (!element) {
        element = document.createElementNS(SVG_NS, "path");
        this.pathElements.push(element);
      }

      const previous = this.pathElements[index - 1];
      if (
        previous &&
        this.container &&
        (element.parentNode !== this.container ||
          element.previousSibling !== previous)
      ) {
        this.container.insertBefore(element, previous.nextSibling);
      }

      element.setAttribute("d", run.d.trim());
      element.setAttribute("fill", run.fill);
      if (this.trailAnimation) {
        element.setAttribute(
          "stroke",
          (this.options.stroke ?? (() => "black"))(this),
        );
      }
    });

    for (const element of this.pathElements.splice(Math.max(1, runs.length))) {
      element.remove();
    }
  }

  private getStrokeOutline(
    trail: LaserPointer,
    state: AppState,
    isStatic: boolean,
  ) {
    const size = trail.options.size / state.zoom.value;

    if (!isStatic) {
      return trail.getStrokeOutline(size);
    }

    const cached = this.staticOutlines.get(trail);
    if (cached?.size === size) {
      return cached.outline;
    }
    const outline = trail.getStrokeOutline(size);
    this.staticOutlines.set(trail, { size, outline });
    return outline;
  }

  private drawTrail(outline: Point[], state: AppState): string {
    const _stroke = outline.map(([x, y]) => {
      const result = sceneCoordsToViewportCoords(
        { sceneX: x, sceneY: y },
        state,
      );

      return [result.x, result.y];
    });

    const stroke = this.trailAnimation
      ? _stroke.slice(0, _stroke.length / 2)
      : _stroke;

    return getSvgPathFromStroke(stroke, true);
  }
}
