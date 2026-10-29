/**
 * Editor continuity across an in-app rename (Links E1, GRO-2194) — and across an in-app
 * DELETE (GRO-2272). Editors are keyed by path, so remapping or removing a tab REMOUNTS or
 * unmounts its editor, and the unmount flush would write the buffer back to the OLD path,
 * resurrecting the file the rename or delete just removed.
 *
 * Two flows share the handle map below, and the difference between them IS the point:
 * a RENAME captures the dirty buffer, retires the old handle and stashes the buffer under
 * the new path (it has somewhere to travel to); a DELETE retires ONLY (it does not), because
 * a stashed buffer would be a live resurrection vector for whatever mounts there next.
 *
 * The design, pinned:
 *  - every `useAutosave` registers a handle here, in a SET per path: a duplicated tab (YAZ-2940
 *    D3) puts two or more editors on one path in one window, and every step below acts on
 *    EVERY handle of a path — a rename or delete that missed one copy would let that copy
 *    write the old path again;
 *  - the ORIGINATING window awaits `flushRenamedPath(oldPath)` BEFORE invoking `fs:rename`,
 *    so its own buffer is on disk and travels with the file;
 *  - EVERY window's `file:renamed` handler calls `carryEditorAcrossRename(old, new)` BEFORE
 *    remapping its tabs: a DIRTY buffer is captured and stashed under the NEW path, and the
 *    old handle is RETIRED — its unmount flush becomes a no-op, so nothing can write to the
 *    old path (no resurrection);
 *  - the editor mounting at the new path takes the stashed buffer (`takeRenameBuffer`) and
 *    applies it as an UNSAVED change over the freshly read file — the buffer survives into
 *    the new path and autosave writes it there (no silent loss). The stash stays ONE buffer
 *    per new path: copies of one file stay in sync (`twinEditors.ts`, YAZ-2940 D4), so when
 *    several are dirty the last one captured wins, and the first copy to mount takes it.
 *
 * Residual race, accepted: a save already IN FLIGHT over IPC when the rename lands cannot
 * be recalled; `writeFile` recreates the old path in that sub-millisecond window. The
 * systematic paths (debounced saves, unmount flush, close flush) are covered above FOR THE
 * WINDOW THAT RENAMES — the handle map below is module-scoped, i.e. PER RENDERER, so another
 * window's pending debounced save for the same path is not retired by this flow and its window
 * is the same sub-millisecond race widened to a debounce interval (GRO-2197 audit: the earlier
 * wording claimed blanket coverage). Deferred, not fixed: retiring across windows needs a
 * main-side broadcast the rename path does not have today.
 *
 * E1b (GRO-2241) extends the same discipline to FOLDER renames: `flushRenamedDir` runs the
 * pre-rename flush for every mounted editor under the dir, and `carryEditorsAcrossDirRename`
 * runs the capture/retire/stash step once per affected open path.
 */

/** What a mounted editor's autosave exposes to the rename flow (registered by `useAutosave`). */
export interface RenameContinuityHandle {
  /** Push the live content through autosave and resolve once it is on disk (or blocked). */
  flush(): Promise<void>
  /** The live buffer when it differs from the last saved/loaded content; null when clean. */
  capture(): RenameBuffer | null
  /** Stop this editor writing ever again (pending drops, unmount flush becomes a no-op). */
  retire(): void
  /** A board's unsaved edits (YAZ-1801 D5, YAZ-3039), which `capture` never reports; absent = ask `capture`. */
  dirty?(): boolean
}

export interface RenameBuffer {
  /** Raw frontmatter block as `useAutosave` holds it. */
  frontmatter: string
  /** Editor body. */
  body: string
}

/** Every mounted editor's handle, by path: a set, since copies of a tab share a path (YAZ-2940 D3). */
const handles = new Map<string, Set<RenameContinuityHandle>>()
const buffers = new Map<string, RenameBuffer>()

const handlesAt = (path: string): readonly RenameContinuityHandle[] => [...(handles.get(path) ?? [])]

/** Adds this editor's handle to its path's set; the unregister removes only this handle. */
export function registerRenameContinuity(path: string, handle: RenameContinuityHandle): () => void {
  let set = handles.get(path)
  if (set === undefined) handles.set(path, (set = new Set()))
  set.add(handle)
  return () => {
    const current = handles.get(path)
    if (current === undefined) return
    current.delete(handle)
    if (current.size === 0) handles.delete(path)
  }
}

/**
 * Every open path in THIS window whose editor has unsaved edits (YAZ-1801 D5, YAZ-3039) — the
 * `skip` list "Move pictures out" hands main, so it never rewrites a drawing under a dirty buffer
 * (that is the conflict bar's case). Per renderer, like the map: another WINDOW's dirty tab is not
 * in it — the shrink's own mtime re-check narrows that race to the instant of the write.
 */
export function dirtyPaths(): string[] {
  return [...handles].filter(([, set]) => [...set].some((h) => (h.dirty?.() ?? h.capture() !== null))).map(([path]) => path)
}

/** The flushes under way, by path (YAZ-3685 F5): a read of that path waits for them (`savedFirst`). */
const flushing = new Map<string, Promise<void>>()

/** Flush every editor open at `path` — the pre-rename step (a), the pre-rewrite step, and a switch between two copies. */
export function flushRenamedPath(path: string): Promise<void> {
  const done = Promise.all(handlesAt(path).map((handle) => handle.flush())).then(() => undefined)
  // Recorded until it settles, so a copy that opens now reads the text it is saving, not the older file (F5).
  const all = Promise.all([flushing.get(path), done]).then(noop, noop)
  flushing.set(path, all)
  void all.then(() => {
    if (flushing.get(path) === all) flushing.delete(path)
  })
  return done
}

const noop = (): void => undefined

/**
 * The flush of `path` under way, or null when there is none (YAZ-3685 F5): `useFile` reads after it, so a bullet's new
 * tab or a "Duplicate tab" opened within the autosave delay finds the source's unsaved typing on disk. Disk stays the truth.
 */
export function savedFirst(path: string): Promise<void> | null {
  return flushing.get(path) ?? null
}

/**
 * The pre-rename step (a) for a FOLDER (E1b, GRO-2241): every mounted editor UNDER `dir`
 * flushes, so each buffer is on disk and travels with its file. No editors there → no-op.
 */
export function flushRenamedDir(dir: string): Promise<void> {
  const prefix = `${dir}/`
  return Promise.all([...handles].filter(([path]) => path.startsWith(prefix)).flatMap(([, set]) => [...set].map((handle) => handle.flush()))).then(() => undefined)
}

/**
 * The `file:renamed` kind-`dir` step (E1b), run BEFORE the prefix workspace remap: every editor
 * under the old dir is carried to ITS new path — same capture/retire/stash discipline as
 * `carryEditorAcrossRename`, once per affected open path.
 */
export function carryEditorsAcrossDirRename(oldDir: string, newDir: string): void {
  const prefix = `${oldDir}/`
  for (const path of [...handles.keys()]) {
    if (path.startsWith(prefix)) carryEditorAcrossRename(path, newDir + path.slice(oldDir.length))
  }
}

/**
 * The `file:renamed` step, run BEFORE the workspace remap unmounts the old editors: capture each
 * dirty buffer into the new path's stash and retire every old handle. No editor at `oldPath` → no-op.
 */
function carryEditorBuffer(oldPath: string, newPath: string): void {
  for (const handle of handlesAt(oldPath)) {
    const buffer = handle.capture()
    handle.retire()
    if (buffer !== null) buffers.set(newPath, buffer) // copies are in sync: the last dirty one wins
  }
}

export function carryEditorAcrossRename(oldPath: string, newPath: string): void {
  carryEditorBuffer(oldPath, newPath)
}

/** Same-path handoff before React moves one editable owner between main and right panes (every main copy closes, YAZ-2940 D8). */
export function carryEditorAcrossPane(path: string): void {
  carryEditorBuffer(path, path)
}

/** Consume the stashed buffer for a freshly mounting editor at `path`; null when none. */
export function takeRenameBuffer(path: string): RenameBuffer | null {
  const buffer = buffers.get(path) ?? null
  buffers.delete(path)
  return buffer
}

/**
 * The `file:deleted` step (GRO-2272), run BEFORE the workspace remap unmounts the editors: retire
 * every editor at `path` (each copy, YAZ-2940 D3) so none can write again, and drop any buffer
 * stashed for it.
 *
 * Deliberately NOT `carryEditorAcrossRename`, which sits a few lines above and looks like the
 * thing to copy. That one CAPTURES, retires and STASHES, because a rename has a destination
 * for the dirty buffer to travel to. A delete has none: stashing would leave a live
 * resurrection vector for whatever mounts at this path next, and capturing at all is pointless
 * work. Retire only.
 *
 * Why this matters: closing a tab unmounts its editor, and `useAutosave`'s unmount cleanup
 * flushes the live buffer to disk — recreating the file the delete just trashed. `retire()`
 * makes that flush a no-op and clears the pending debounce. See the residual-race note in this
 * module's header: an in-flight save, and another WINDOW's pending debounce, are still out of
 * reach — the same limits rename has always had.
 */
export function retireDeletedPath(path: string): void {
  for (const handle of handlesAt(path)) handle.retire()
  buffers.delete(path)
}

/** The `file:deleted` kind-`dir` twin: every editor (and stashed buffer) under `dir` retires. */
export function retireDeletedDir(dir: string): void {
  const prefix = `${dir}/`
  for (const path of [...handles.keys()]) if (path.startsWith(prefix)) for (const handle of handlesAt(path)) handle.retire()
  for (const path of [...buffers.keys()]) if (path.startsWith(prefix)) buffers.delete(path)
}

/** Test hook. */
export function _resetRenameContinuity(): void {
  handles.clear()
  buffers.clear()
  flushing.clear()
}
