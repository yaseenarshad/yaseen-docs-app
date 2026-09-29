/** The steps quitting drives; `index.ts` passes the live ones, tests fake them. */
export interface QuitDeps {
  /** Every renderer's close/quit handshake, then its destroy (all at once under one 5 s cap, YAZ-2198 — windows.ts). */
  flushWindows(): Promise<void>
  /** The state file's pending debounced write. */
  flushStore(): Promise<void>
  /** The vault-index cache's pending persist. */
  flushIndex(): Promise<void>
  /** The last sync pass; undefined when quitting before `ready` created the manager. */
  flushSync(): Promise<void> | undefined
  exit(): void
}

/**
 * Quit, in the one order that loses nothing (YAZ-2174): every renderer flushes FIRST, so
 * its last save lands; THEN the state file, the index cache and the last sync pass, whose commit
 * therefore holds the edit made a second before quitting (YAZ-1081 D2; its push capped by
 * YAZ-1111). `allSettled` because no step failing may skip another, and `exit` runs whatever
 * happened: the sequence never rejects, since its caller does not wait. index.startup.test.ts
 * pins every step through the real `before-quit`.
 */
export async function runQuitSequence(deps: QuitDeps): Promise<void> {
  try {
    await deps.flushWindows().catch((err: unknown) => console.error(`[quit] a window did not flush: ${String(err)}`))
    const results = await Promise.allSettled([deps.flushStore(), deps.flushIndex(), deps.flushSync()])
    for (const r of results) if (r.status === 'rejected') console.error(`[quit] a flush failed: ${String(r.reason)}`)
  } finally {
    deps.exit()
  }
}
