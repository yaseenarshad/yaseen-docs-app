// -----------------------------------------------------------------------------
// YAZ-3944 D2: GIFs move on a board
// -----------------------------------------------------------------------------

import { MIME_TYPES } from "@excalidraw/common";

import type { BinaryFileData } from "@excalidraw/excalidraw/types";

import type { ExcalidrawImageElement, FileId } from "./types";

/** All GIFs on a board share at most 25 repaints a second. */
export const GIF_MIN_REPAINT_MS = 40;

/** YAZ-3944 D4: GIFs stop after 5 min with no mouse or key use on the board. */
export const GIF_IDLE_MS = 5 * 60 * 1000;

/** YAZ-4074 6A item 17: a decoder that no paint drew for 30 s closes (each holds its GIF and a full-size canvas). */
export const GIF_DECODER_IDLE_MS = 30 * 1000;

/** YAZ-3944 D4: "Pause GIF", saved in the file. A paused GIF shows its first frame. */
export const isGifPaused = (element: ExcalidrawImageElement) =>
  element.customData?.gifPaused === true;

/** A frame's delay as browsers play it: 10 ms or less shows for 100 ms (Chrome and Firefox do this). */
export const gifFrameDelay = (durationMs: number) =>
  durationMs <= 10 ? 100 : durationMs;

export type GifClock = {
  /** the frame on show */
  index: number;
  frameCount: number;
  /** when the frame on show counts as shown, and how long it stays */
  shownAt: number;
  delayMs: number;
  /** loops played so far; `repetitionCount` as `ImageDecoder` gives it (Infinity: forever) */
  loop: number;
  repetitionCount: number;
};

/** The GIF stays on its last frame: it has played all its loops. */
export const gifClockDone = (clock: GifClock) =>
  clock.index === clock.frameCount - 1 && clock.loop >= clock.repetitionCount;

/**
 * The frame to show at `now`, or null while the frame on show is still due (or the GIF is done).
 * One frame at a time; a GIF that falls more than one frame behind (a busy board, a sleep) starts
 * its clock again at `now`, so it never races to catch up.
 */
export const nextGifFrame = (
  clock: GifClock,
  now: number,
): { index: number; loop: number; shownAt: number } | null => {
  const dueAt = clock.shownAt + clock.delayMs;
  if (now < dueAt || gifClockDone(clock)) {
    return null;
  }
  const wraps = clock.index === clock.frameCount - 1;
  return {
    index: wraps ? 0 : clock.index + 1,
    loop: wraps ? clock.loop + 1 : clock.loop,
    shownAt: now - dueAt > clock.delayMs ? now : dueAt,
  };
};

/** When the next tick runs: at the first due frame, but never sooner than 40 ms after the last repaint. */
export const nextGifTickAt = (dueAts: number[], lastRepaintAt: number) =>
  Math.max(Math.min(...dueAts), lastRepaintAt + GIF_MIN_REPAINT_MS);

type GifTrack = GifClock & {
  decoder: ImageDecoder | null;
  /** the frame on show, at the GIF's own size */
  canvas: HTMLCanvasElement | null;
  /** grows with each frame drawn on `canvas`; 0 while none is */
  token: number;
  /** the GIF repaint count when a board paint last drew this GIF */
  seenIn: number;
  /** when a board paint last drew this GIF playing */
  seenAt: number;
  /** the decoder opens, or a frame decodes */
  busy: boolean;
  /** one frame, or the decoder failed: it never plays */
  still: boolean;
};

/**
 * One for each open board. It makes one `ImageDecoder` for each GIF file on the board, decodes one
 * frame at a time into a canvas, and repaints the board layer (`repaint`, set by the static canvas)
 * once for all GIFs whose frame is due. A GIF that the last repaint did not draw (off screen,
 * deleted) waits until a paint draws it again.
 *
 * YAZ-3944 D4, auto-pause, never saved: nothing plays while the board is hidden (`setHidden`), while
 * a text box is in edit mode (`setTyping`, YAZ-4074 6A item 6), or after 5 min with no use
 * (`activity`); it plays again on return. A GIF paused before it played opens no decoder. A decoder
 * that no paint drew for 30 s closes: a GIF off screen, paused by hand, or on a hidden board
 * (YAZ-4074 6A item 17). The next paint that draws it opens it again.
 */
export class GifPlayer {
  /** The board layer's paint, without React. */
  repaint: (() => void) | null = null;

  private tracks = new Map<FileId, GifTrack>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** closes the decoders no paint drew for 30 s; set while one is open */
  private sweepTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRepaintAt = -Infinity;
  private repaintCount = 0;
  /** grows with each dispose: a tick that awaited across one stops */
  private generation = 0;
  /** the tab is not in front, or the window is hidden or minimized */
  hidden = false;
  /** no mouse or key use on the board for 5 min */
  idle = false;
  /** a text box is in edit mode (YAZ-4074 6A item 6): no tick repaints the board while you type */
  typing = false;
  private lastActivityAt = performance.now();

  constructor(
    private readonly getFile: (id: FileId) => BinaryFileData | undefined,
  ) {}

  /**
   * For each paint of an image: the token of its frame on show (it changes with each new frame), or
   * undefined for a still picture. It also marks the GIF as on screen.
   */
  frameToken(element: ExcalidrawImageElement): number | undefined {
    const track = this.trackFor(element);
    if (!track) {
      return undefined;
    }
    track.seenIn = this.repaintCount;
    track.seenAt = performance.now();
    this.schedule();
    return track.token;
  }

  /** The frame on show of a playing GIF; null for the still image. */
  frameFor(element: ExcalidrawImageElement): HTMLCanvasElement | null {
    const track = element.fileId ? this.tracks.get(element.fileId) : undefined;
    return track && !track.still && track.token > 0 && !isGifPaused(element)
      ? track.canvas
      : null;
  }

  /** The GIF file has more than one frame (known once its decoder opened). */
  isAnimated(fileId: FileId) {
    const track = this.tracks.get(fileId);
    return !!track && !track.still && track.frameCount > 1;
  }

  /** The board went out of view (another tab in front, the window hidden) or came back. */
  setHidden(hidden: boolean) {
    if (this.hidden === hidden) {
      return;
    }
    this.hidden = hidden;
    if (hidden) {
      this.stop();
    } else {
      this.armSweep();
      this.schedule();
    }
  }

  /** A text box went into edit mode, or left it. D4 allows this pause: nothing is saved. */
  setTyping(typing: boolean) {
    if (this.typing === typing) {
      return;
    }
    this.typing = typing;
    if (typing) {
      this.stop();
    } else {
      this.armSweep();
      this.schedule();
    }
  }

  /** A mouse or key use on the board. Cheap: it runs on each pointer move. */
  activity() {
    this.lastActivityAt = performance.now();
    if (this.idle) {
      this.idle = false;
      this.armSweep();
      this.schedule();
    }
  }

  /** Close the decoders of GIF files that no element on the board uses now (a delete). */
  retain(fileIds: ReadonlySet<FileId>) {
    for (const [fileId, track] of this.tracks) {
      if (!fileIds.has(fileId)) {
        track.decoder?.close();
        this.tracks.delete(fileId);
      }
    }
  }

  get size() {
    return this.tracks.size;
  }

  /** Close every decoder and stop; the player can start again (a remount). */
  dispose() {
    this.stop();
    for (const track of this.tracks.values()) {
      track.decoder?.close();
    }
    this.tracks.clear();
    this.lastRepaintAt = -Infinity;
    this.generation++;
    this.idle = false;
    this.lastActivityAt = performance.now();
  }

  /** Stop the ticks, and the decoder sweep: a GIF that only waits (hidden, idle, typing) keeps its decoder. */
  private stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.sweepTimer) {
      clearTimeout(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  private trackFor(element: ExcalidrawImageElement) {
    if (!element.fileId || isGifPaused(element)) {
      return undefined;
    }
    let track = this.tracks.get(element.fileId);
    if (!track) {
      const file = this.getFile(element.fileId);
      if (
        file?.mimeType !== MIME_TYPES.gif ||
        typeof ImageDecoder === "undefined"
      ) {
        return undefined;
      }
      track = {
        index: 0,
        frameCount: 1,
        shownAt: 0,
        delayMs: 100,
        loop: 0,
        repetitionCount: Infinity,
        decoder: null,
        canvas: null,
        token: 0,
        seenIn: this.repaintCount,
        seenAt: performance.now(),
        busy: true,
        still: false,
      };
      this.tracks.set(element.fileId, track);
      this.open(element.fileId, track, file.dataURL);
    }
    return track.still ? undefined : track;
  }

  private async open(fileId: FileId, track: GifTrack, dataURL: string) {
    try {
      const data = await (await fetch(dataURL)).arrayBuffer();
      if (this.tracks.get(fileId) !== track) {
        return;
      }
      track.decoder = new ImageDecoder({ data, type: MIME_TYPES.gif });
      // `selectedTrack` is null until the tracks are ready, and Chromium can
      // resolve `completed` first
      await track.decoder.tracks.ready;
      await track.decoder.completed;
      const { frameCount, repetitionCount } =
        track.decoder.tracks.selectedTrack!;
      track.frameCount = frameCount;
      track.repetitionCount = repetitionCount;
      if (frameCount < 2) {
        track.still = true;
        track.decoder.close();
        track.decoder = null;
        return;
      }
      await this.draw(track, 0);
      track.shownAt = performance.now();
      this.armSweep();
    } catch {
      // closed under us (dispose), or a GIF the decoder cannot read: the still image stays
      track.still = true;
    } finally {
      track.busy = false;
    }
    this.schedule();
  }

  /** Decode frame `index` into the track's canvas, and close the frame. */
  private async draw(track: GifTrack, index: number) {
    const { image } = await track.decoder!.decode({ frameIndex: index });
    try {
      if (!track.canvas) {
        track.canvas = document.createElement("canvas");
        track.canvas.width = image.displayWidth;
        track.canvas.height = image.displayHeight;
      }
      const context = track.canvas.getContext("2d")!;
      context.clearRect(0, 0, track.canvas.width, track.canvas.height);
      context.drawImage(image, 0, 0);
      track.delayMs = gifFrameDelay((image.duration ?? 0) / 1000);
    } finally {
      image.close();
    }
    track.index = index;
    track.token++;
  }

  private armSweep() {
    if (
      !this.sweepTimer &&
      [...this.tracks.values()].some((track) => track.decoder)
    ) {
      this.sweepTimer = setTimeout(this.sweep, GIF_DECODER_IDLE_MS);
    }
  }

  /** YAZ-4074 6A item 17: close each decoder that no paint drew for 30 s. */
  private sweep = () => {
    this.sweepTimer = null;
    if (this.hidden || this.idle || this.typing) {
      return;
    }
    const now = performance.now();
    let open = false;
    for (const [fileId, track] of this.tracks) {
      if (!track.decoder || track.busy) {
        continue;
      }
      if (now - track.seenAt >= GIF_DECODER_IDLE_MS) {
        track.decoder.close();
        this.tracks.delete(fileId);
      } else {
        open = true;
      }
    }
    if (open) {
      this.armSweep();
    }
  };

  private isPlaying(track: GifTrack) {
    return (
      !track.still &&
      !track.busy &&
      track.token > 0 &&
      track.seenIn === this.repaintCount &&
      !gifClockDone(track)
    );
  }

  private schedule() {
    if (this.timer || this.hidden || this.idle || this.typing) {
      return;
    }
    if (performance.now() - this.lastActivityAt >= GIF_IDLE_MS) {
      this.idle = true;
      this.stop();
      return;
    }
    const dueAts: number[] = [];
    for (const track of this.tracks.values()) {
      if (this.isPlaying(track)) {
        dueAts.push(track.shownAt + track.delayMs);
      }
    }
    if (dueAts.length) {
      const at = nextGifTickAt(dueAts, this.lastRepaintAt);
      this.timer = setTimeout(this.tick, Math.max(0, at - performance.now()));
    }
  }

  private tick = async () => {
    this.timer = null;
    const generation = this.generation;
    const now = performance.now();
    const steps: Promise<void>[] = [];
    for (const track of this.tracks.values()) {
      const next = this.isPlaying(track) ? nextGifFrame(track, now) : null;
      if (next) {
        steps.push(this.step(track, next));
      }
    }
    if (steps.length) {
      await Promise.all(steps);
      if (generation !== this.generation) {
        return;
      }
      // one repaint for every GIF that moved
      this.lastRepaintAt = performance.now();
      this.repaintCount++;
      this.repaint?.();
    }
    this.schedule();
  };

  private async step(
    track: GifTrack,
    next: { index: number; loop: number; shownAt: number },
  ) {
    track.busy = true;
    try {
      await this.draw(track, next.index);
      track.loop = next.loop;
      track.shownAt = next.shownAt;
    } catch {
      // closed under us (dispose), or a broken frame
      track.still = true;
    } finally {
      track.busy = false;
    }
  }
}
