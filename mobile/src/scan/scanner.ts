/**
 * "Scan a code" (round 11, item 23): the camera and the QR reader behind one small interface, so the screen can be
 * tested with a fake (`app/testing.ts`) and the real one (`camera.ts`) loads the reader only when it opens.
 */

/** Why the camera cannot read a code. */
export type ScanProblem =
  /** The person said no to the camera, or the phone's settings block it. */
  | 'denied'
  /** No camera, or this browser has no camera access (`getUserMedia`; a Home Screen app has it since iOS 13.4). */
  | 'no-camera'
  /** The reader's file did not load (no connection on the first scan). */
  | 'reader-failed'

export interface ScanSession {
  /** Stops the camera. Safe to call twice. */
  stop(): void
}

export interface Scanner {
  /**
   * Opens the camera into `video` and calls `onText` with the text of each code it reads (it keeps reading until
   * `stop`). Rejects with a `ScanError` when the camera or the reader cannot start.
   */
  start(video: HTMLVideoElement, onText: (text: string) => void): Promise<ScanSession>
}

export class ScanError extends Error {
  constructor(readonly problem: ScanProblem) {
    super(problem)
    this.name = 'ScanError'
  }
}

/** Plain words, each with the way forward: the typed sign-in always stays. */
export function scanProblemMessage(problem: ScanProblem): string {
  switch (problem) {
    case 'denied':
      return 'Notecards may not use the camera. Allow the camera for this app in the iPhone Settings, or type the repo and the token.'
    case 'no-camera':
      return 'This phone gives Notecards no camera. Type the repo and the token.'
    case 'reader-failed':
      return 'The code reader did not load. Connect to the internet and try again, or type the repo and the token.'
  }
}
