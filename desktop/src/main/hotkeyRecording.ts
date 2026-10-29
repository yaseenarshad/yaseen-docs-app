/**
 * Which windows have a key recorder listening (YAZ-3397 D6). While any has, `main/index.ts` builds the menu
 * with no key (`MenuInputs.suspendKeys`): on macOS a menu key fires before the page hears it, so without
 * this, recording ⌘W would close the tab and ⌘, open Settings again. The renderer says when it starts and
 * stops (`hotkeys:recording`); a window that closes, crashes or reloads stops by itself, so no menu is left
 * without its keys. Electron-free: the sender is anything with an id and `on` / `once` (a `WebContents`; `did-navigate` is the main frame's only, so a diagram's frame loading does not count).
 */
export interface RecordingSender {
  id: number
  on(event: 'did-navigate' | 'render-process-gone', listener: () => void): unknown
  once(event: 'destroyed', listener: () => void): unknown
}

export interface HotkeyRecording {
  set(sender: RecordingSender, on: boolean): void
  active(): boolean
  /** This window's flag (YAZ-3564: a drawing over a note is in front of it). */
  has(id: number): boolean
  /** Called when `active()` changes; returns the unsubscribe. */
  onChange(listener: () => void): () => void
}

/** `tell`: 'any' tells when `active()` changes; 'each' tells when any one window's flag does. */
export function createHotkeyRecording(tell: 'any' | 'each' = 'any'): HotkeyRecording {
  const recording = new Set<number>()
  /** The windows whose end is already watched: once per window, however many times it records. */
  const watched = new Set<number>()
  const listeners = new Set<() => void>()
  const update = (id: number, on: boolean): void => {
    const was = recording.size > 0
    const had = recording.has(id)
    if (on) recording.add(id)
    else recording.delete(id)
    if (tell === 'each' ? had !== on : was !== recording.size > 0) for (const listener of listeners) listener()
  }
  return {
    set(sender, on) {
      if (on && !watched.has(sender.id)) {
        // Each end of the window's page ends its recording: a reload, a crash, the close.
        const { id } = sender
        watched.add(id)
        const stop = () => update(id, false)
        sender.on('did-navigate', stop)
        sender.on('render-process-gone', stop)
        sender.once('destroyed', () => {
          watched.delete(id)
          stop()
        })
      }
      update(sender.id, on)
    },
    active: () => recording.size > 0,
    has: (id) => recording.has(id),
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** The one instance: `ipc/state.ts` writes it, `main/index.ts` reads it when it builds the menu. */
export const hotkeyRecording = createHotkeyRecording()

/**
 * Which windows have a drawing open OVER a note (YAZ-3564 K9): the active file is the note, but the drawing is in
 * front, so the App keys that step aside in drawings (⌘D) must step aside there too. The modal says when it opens and
 * closes (`hotkeys.drawingInFront`); a reload, crash or close ends it, as for a recorder.
 */
export const drawingInFront = createHotkeyRecording('each')
