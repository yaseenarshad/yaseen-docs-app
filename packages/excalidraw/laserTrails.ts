import {
  DEFAULT_LASER_COLOR,
  Emitter,
  LASER_HOLD_MS,
  LASER_SIZES,
  easeOut,
} from "@excalidraw/common";

import type { LaserTrailMode } from "@excalidraw/common";
import type {
  LaserPointer,
  LaserPointerOptions,
  Point,
  SizeMappingDetails,
} from "@excalidraw/laser-pointer";

import { AnimatedTrail } from "./animatedTrail";
import { getClientColor } from "./clients";

import type { Trail } from "./animatedTrail";
import type App from "./components/App";
import type { SocketId } from "./types";

export const LASER_STREAMLINE = 0.4;
// twice upstream's 1s / 50 points, so the comet lingers a little longer
const DECAY_TIME = 2000;
const DECAY_LENGTH = 100;

/** fade: each point fades DECAY_TIME after it was drawn, and only the last
 * DECAY_LENGTH points are shown */
const fadeSize = (c: SizeMappingDetails) => {
  const t = Math.max(0, 1 - (performance.now() - c.pressure) / DECAY_TIME);
  const l =
    (DECAY_LENGTH - Math.min(DECAY_LENGTH, c.totalLength - c.currentIndex)) /
    DECAY_LENGTH;

  return Math.min(easeOut(l), easeOut(t));
};

export type LaserTrailsSnapshot = {
  canKeep: boolean;
  canClear: boolean;
  canUndo: boolean;
  canRedo: boolean;
};

export class LaserTrails implements Trail {
  public localTrail: AnimatedTrail;
  private collabTrails = new Map<SocketId, AnimatedTrail>();
  private container?: SVGSVGElement;

  /** each local stroke keeps the mode it was started with */
  private strokeModes = new WeakMap<LaserPointer, LaserTrailMode>();
  /** last local laser activity, from which Hold strokes start to fade */
  private lastActivity = 0;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;

  /** laser-only undo/redo: snapshots of the sticky strokes */
  private history: LaserPointer[][] = [[]];
  private historyIndex = 0;

  private snapshot: LaserTrailsSnapshot = {
    canKeep: false,
    canClear: false,
    canUndo: false,
    canRedo: false,
  };
  public onChange = new Emitter<[LaserTrailsSnapshot]>();

  constructor(private app: App) {
    this.localTrail = new AnimatedTrail(app, {
      ...this.getTrailOptions(),
      fill: () => DEFAULT_LASER_COLOR,
      isStatic: (trail) => this.isStatic(trail),
      onTrailsChange: () => this.emitChange(),
    });
  }

  private getTrailOptions() {
    return {
      simplify: 0,
      streamline: LASER_STREAMLINE,
      sizeMapping: fadeSize,
    } as Partial<LaserPointerOptions>;
  }

  private holdSize() {
    const elapsed = performance.now() - this.lastActivity - LASER_HOLD_MS;
    return easeOut(Math.min(1, Math.max(0, 1 - elapsed / DECAY_TIME)));
  }

  private getSizeMapping(
    mode: LaserTrailMode,
  ): LaserPointerOptions["sizeMapping"] {
    switch (mode) {
      case "hold":
        return () => this.holdSize();
      case "sticky":
        return () => 1;
      default:
        return fadeSize;
    }
  }

  private isStatic(trail: LaserPointer) {
    const mode = this.strokeModes.get(trail);
    return (
      mode === "sticky" ||
      (mode === "hold" && performance.now() < this.lastActivity + LASER_HOLD_MS)
    );
  }

  private hasHoldStrokes() {
    const current = this.localTrail.getCurrentTrail();
    return (
      (!!current && this.strokeModes.get(current) === "hold") ||
      this.localTrail
        .getPastTrails()
        .some((trail) => this.strokeModes.get(trail) === "hold")
    );
  }

  private touch() {
    this.lastActivity = performance.now();
    this.scheduleHoldDecay();
  }

  /** wakes the (otherwise idle) render loop when the Hold strokes start to
   * fade */
  private scheduleHoldDecay() {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    if (!this.hasHoldStrokes()) {
      return;
    }
    const decayAt = this.lastActivity + LASER_HOLD_MS;
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      if (performance.now() < decayAt) {
        this.scheduleHoldDecay();
      } else {
        this.localTrail.redraw();
      }
    }, Math.max(0, decayAt - performance.now()));
  }

  private getStickyTrails() {
    return this.localTrail
      .getPastTrails()
      .filter((trail) => this.strokeModes.get(trail) === "sticky");
  }

  private emitChange() {
    const trails = this.localTrail.getPastTrails();
    const snapshot: LaserTrailsSnapshot = {
      canKeep: trails.some((trail) => this.strokeModes.get(trail) !== "sticky"),
      canClear: trails.length > 0,
      canUndo: this.historyIndex > 0,
      canRedo: this.historyIndex < this.history.length - 1,
    };
    if (
      (Object.keys(snapshot) as (keyof LaserTrailsSnapshot)[]).some(
        (key) => snapshot[key] !== this.snapshot[key],
      )
    ) {
      this.snapshot = snapshot;
      this.onChange.trigger(snapshot);
    }
  }

  getSnapshot() {
    return this.snapshot;
  }

  private commit() {
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(this.getStickyTrails());
    this.historyIndex = this.history.length - 1;
    this.emitChange();
  }

  private restoreHistoryEntry() {
    const transient = this.localTrail
      .getPastTrails()
      .filter((trail) => this.strokeModes.get(trail) !== "sticky");
    this.localTrail.setPastTrails([
      ...this.history[this.historyIndex],
      ...transient,
    ]);
    this.emitChange();
  }

  /** steps the sticky strokes back; `false` if there's nothing to undo */
  undo() {
    if (this.historyIndex === 0) {
      return false;
    }
    this.historyIndex--;
    this.restoreHistoryEntry();
    return true;
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) {
      return false;
    }
    this.historyIndex++;
    this.restoreHistoryEntry();
    return true;
  }

  private resetHistory() {
    this.history = [[]];
    this.historyIndex = 0;
    this.emitChange();
  }

  /** the part of a stroke that's still visible */
  private getVisiblePoints(trail: LaserPointer) {
    const mode = this.strokeModes.get(trail);
    const points = trail.originalPoints;

    if (mode === "sticky") {
      return points;
    }

    if (mode === "hold") {
      return this.holdSize() > 0 ? points : [];
    }

    const start = points.findIndex(
      (point, index) =>
        fadeSize({
          pressure: point[2],
          runningLength: 0,
          currentIndex: index,
          totalLength: points.length,
        }) > 0,
    );
    return start === -1 ? [] : points.slice(start);
  }

  /** turns every visible local stroke into a sticky one at full strength */
  keep() {
    let changed = false;
    const trails: LaserPointer[] = [];

    for (const trail of this.localTrail.getPastTrails()) {
      if (this.strokeModes.get(trail) === "sticky") {
        trails.push(trail);
        continue;
      }

      const points = this.getVisiblePoints(trail);
      if (points.length === 0) {
        continue;
      }

      const kept = this.localTrail.createFinishedTrail(points, {
        size: trail.options.size,
        fill: this.localTrail.getTrailFill(trail),
        sizeMapping: this.getSizeMapping("sticky"),
      });
      this.strokeModes.set(kept, "sticky");
      trails.push(kept);
      changed = true;
    }

    if (!changed) {
      return false;
    }

    this.localTrail.setPastTrails(trails);
    this.scheduleHoldDecay();
    this.commit();
    return true;
  }

  /**
   * Hands over the visible part of every local stroke (centre-line points in
   * scene coords) and removes the marks. The laser history is dropped so
   * laser undo can't bring back marks that now live in the drawing.
   */
  takeVisibleStrokes() {
    const strokes: { points: Point[]; color: string; size: number }[] = [];

    for (const trail of this.localTrail.getPastTrails()) {
      const points = this.getVisiblePoints(trail);
      if (points.length > 0) {
        strokes.push({
          points,
          color: this.localTrail.getTrailFill(trail) ?? DEFAULT_LASER_COLOR,
          size: trail.options.size,
        });
      }
    }

    if (strokes.length > 0) {
      this.reset();
    }
    return strokes;
  }

  /** removes all local marks; undoable if it removed sticky ones */
  clear() {
    const hadStickyTrails = this.getStickyTrails().length > 0;
    this.localTrail.clearTrails();
    this.scheduleHoldDecay();
    if (hadStickyTrails) {
      this.commit();
    }
  }

  /** removes all local marks and drops their history (e.g. new scene) */
  reset() {
    this.localTrail.clearTrails();
    this.scheduleHoldDecay();
    this.resetHistory();
  }

  /** redraws the static marks, e.g. after the viewport changed */
  redraw() {
    this.localTrail.redraw();
  }

  startPath(x: number, y: number): void {
    const { laserTrailMode, laserColor, laserSize } = this.app.state;

    this.localTrail.startStyledPath(x, y, {
      size: LASER_SIZES[laserSize] ?? LASER_SIZES.S,
      fill: laserColor,
      sizeMapping: this.getSizeMapping(laserTrailMode),
    });

    const trail = this.localTrail.getCurrentTrail();
    if (trail) {
      this.strokeModes.set(trail, laserTrailMode);
    }
    this.touch();
  }

  addPointToPath(x: number, y: number): void {
    if (this.localTrail.hasCurrentTrail) {
      this.localTrail.addPointToPath(x, y);
      this.touch();
    }
  }

  endPath(): void {
    const trail = this.localTrail.getCurrentTrail();
    this.localTrail.endPath();

    if (trail) {
      this.touch();
      if (this.strokeModes.get(trail) === "sticky") {
        this.commit();
      }
    }
  }

  start(container: SVGSVGElement) {
    this.container = container;
    this.localTrail.start(container);
  }

  stop() {
    this.localTrail.stop();
    this.stopCollabTrails();
    this.container = undefined;
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    this.resetHistory();
  }

  private stopCollabTrails(collaborators?: App["state"]["collaborators"]) {
    for (const [key, trail] of this.collabTrails) {
      const collaborator = collaborators?.get(key);

      if (!collaborator) {
        trail.stop();
        this.collabTrails.delete(key);
      }
    }
  }

  updateCollabTrails(collaborators: App["state"]["collaborators"]) {
    this.stopCollabTrails(collaborators);

    if (!this.container || collaborators.size === 0) {
      return;
    }

    for (const [key, collaborator] of collaborators.entries()) {
      // Current user has their own trail drawn via localTrail
      if (collaborator.isCurrentUser) {
        continue;
      }

      // IDEA: Use the collaborator pointer coordinates to trace out the
      // laser pointer trail when 1) the selected collab tool is the laser
      // pointer and 2) the collab pointer button is in the "down" state.
      let trail = this.collabTrails.get(key);
      if (!trail) {
        trail = new AnimatedTrail(this.app, {
          ...this.getTrailOptions(),
          fill: () =>
            collaborator.pointer?.laserColor ||
            getClientColor(key, collaborator),
        });
        trail.start(this.container);

        this.collabTrails.set(key, trail);
      }

      if (collaborator.pointer && collaborator.pointer.tool === "laser") {
        const buttonDown = collaborator.button === "down";
        const buttonUp = collaborator.button === "up";
        const hasTrail = trail.hasCurrentTrail;

        // Initialize a new trail
        if (buttonDown && !hasTrail) {
          trail.startPath(collaborator.pointer.x, collaborator.pointer.y);
        }

        // Add only original points
        const lastPointOriginal = !trail.hasLastPoint(
          collaborator.pointer.x,
          collaborator.pointer.y,
        );
        if (buttonDown && lastPointOriginal) {
          trail.addPointToPath(collaborator.pointer.x, collaborator.pointer.y);
        }

        // End the trail on button up
        if (buttonUp && hasTrail) {
          trail.addPointToPath(collaborator.pointer.x, collaborator.pointer.y);
          trail.endPath();
        }
      }
    }
  }
}
