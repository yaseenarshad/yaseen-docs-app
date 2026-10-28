/**
 * MONACO ↔ THE LANGUAGE HELPERS (YAZ-3454 4B, YAZ-3455 4C; D9, D10). A code tab on a TS, JS, React
 * or Python file opens its text with the helper of its project in main (`api.lsp`), and Monaco's
 * Go to Definition (Cmd+click, F12) and Find All References (Shift+F12, the peek box) ask it.
 *
 * ONE SOURCE FOR EACH FEATURE. For TS and JS, Monaco's own definition and reference providers are
 * off (`monaco.ts`); the providers here are the only ones. They ask the helper; when it gives no
 * answer (`null`: not installed, no project, down), they ask Monaco's TS worker and keep the places
 * in this file — the one-file help, with no message. Hover stays Monaco's for TS and JS; for Python,
 * which Monaco does not know, the helper also gives the hover.
 *
 * THE TEXT. The tab sends its whole text 300 ms after the last edit, and at once before a request:
 * never one IPC for each keystroke. Two tabs can hold one file; main keeps one document for it, and
 * a whole text from either tab is always right.
 *
 * THE SWITCH (YAZ-3500): Settings › Code › "Jump across files" (`languageHelpers.ts`), off by default. Off, a
 * tab never opens its file with a helper (no `lsp.open`), and the providers give Monaco's one-file answer.
 * Turned on, every open code tab opens its file; turned off, every tab closes it, and main stops the helpers.
 *
 * THE PEEK BOX shows a place in another file only when a model for that file exists. Each file the
 * helper names is read once (`api.readFile`) into a read-only `file://` model, at most
 * `MAX_PREVIEWS` of them, the oldest dropped first; all go with the last code tab. A place whose
 * file cannot be read stays out of the list.
 */
import type { LspLocation, LspPosition } from '@shared/lsp'
import { lspLanguageOf } from '@shared/lsp'
import { api } from '../api'
import { languageHelpersOn, onLanguageHelpers } from './languageHelpers'
import { monaco } from './monaco'

type Model = ReturnType<typeof monaco.editor.createModel>
type Position = { lineNumber: number; column: number }
type Location = { uri: Model['uri']; range: ReturnType<typeof range> }

export const SYNC_DEBOUNCE_MS = 300
export const MAX_PREVIEWS = 200
/** A Cmd-hover asks for the definition as the mouse moves: a model read this recently is used as it is. */
const PREVIEW_FRESH_MS = 5_000

interface Client {
  path: string
  /** Sends the text if it changed, then gives the handle (null: no helper for this tab). */
  ready(): Promise<string | null>
}

const clients = new Map<string, Client>()
const previews = new Map<string, { model: Model; readAt: number }>()
let installed = false

const range = (r: LspLocation['range']) => new monaco.Range(r.start.line + 1, r.start.character + 1, r.end.line + 1, r.end.character + 1)
const lspPosition = (p: Position): LspPosition => ({ line: p.lineNumber - 1, character: p.column - 1 })

/** The helper's places as Monaco's: the tab's own file is the tab's own model, so a jump inside it stays in it. */
function toMonaco(places: readonly LspLocation[], model: Model, selfPath: string): Location[] {
  return places.map((p) => ({ uri: p.path === selfPath ? model.uri : monaco.Uri.file(p.path), range: range(p.range) }))
}

/**
 * A read-only model for each file of `paths` but `selfPath`, for the peek box. Returns the paths
 * that have one. The cap drops the oldest models first, never one this call needs.
 */
async function ensurePreviews(paths: readonly string[], selfPath: string, freshMs: number): Promise<Set<string>> {
  const wanted = [...new Set(paths)].filter((p) => p !== selfPath)
  const have = new Set<string>()
  const now = Date.now()
  await Promise.all(
    wanted.map(async (path) => {
      const cached = previews.get(path)
      previews.delete(path)
      if (cached !== undefined && !cached.model.isDisposed() && now - cached.readAt < freshMs) {
        previews.set(path, cached)
        have.add(path)
        return
      }
      try {
        const { content } = await api.readFile(path)
        const uri = monaco.Uri.file(path)
        const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(content, undefined, uri)
        if (model.getValue() !== content) model.setValue(content)
        previews.set(path, { model, readAt: Date.now() })
        have.add(path)
      } catch {
        // Too big, not text, gone: no preview, and no row for it.
        cached?.model.dispose()
      }
    }),
  )
  for (const [path, { model }] of previews) {
    if (previews.size <= MAX_PREVIEWS) break
    if (have.has(path)) continue
    previews.delete(path)
    model.dispose()
  }
  return have
}

/** Monaco's TS worker: the one-file answer, the places in this file only. */
async function oneFile(model: Model, position: Position, kind: 'definition' | 'references'): Promise<Location[]> {
  const language = model.getLanguageId()
  if (language !== 'typescript' && language !== 'javascript') return []
  try {
    const ts = monaco.typescript
    const getWorker = language === 'typescript' ? await ts.getTypeScriptWorker() : await ts.getJavaScriptWorker()
    const worker = await getWorker(model.uri)
    const file = model.uri.toString()
    const offset = model.getOffsetAt(position)
    const entries: readonly { fileName: string; textSpan: { start: number; length: number } }[] =
      (kind === 'definition' ? await worker.getDefinitionAtPosition(file, offset) : await worker.getReferencesAtPosition(file, offset)) ?? []
    if (model.isDisposed()) return []
    return entries
      .filter((e) => e.fileName === file)
      .map((e) => {
        const start = model.getPositionAt(e.textSpan.start)
        const end = model.getPositionAt(e.textSpan.start + e.textSpan.length)
        return { uri: model.uri, range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column) }
      })
  } catch {
    return []
  }
}

async function provide(model: Model, position: Position, kind: 'definition' | 'references'): Promise<Location[]> {
  const client = clients.get(model.uri.toString())
  const handle = client === undefined ? null : await client.ready()
  if (client !== undefined && handle !== null) {
    const req = { handle, position: lspPosition(position) }
    const places = await (kind === 'definition' ? api.lsp.definition(req) : api.lsp.references(req)).catch(() => null)
    if (places !== null && !model.isDisposed()) {
      const readable = await ensurePreviews(
        places.map((p) => p.path),
        client.path,
        kind === 'definition' ? PREVIEW_FRESH_MS : 0,
      )
      // A definition opens its file even with no preview; a reference row needs one.
      const kept = kind === 'definition' ? places : places.filter((p) => p.path === client.path || readable.has(p.path))
      return toMonaco(kept, model, client.path)
    }
  }
  return oneFile(model, position, kind)
}

/** The providers, once for the page. */
function install(): void {
  if (installed) return
  installed = true
  for (const language of ['typescript', 'javascript', 'python']) {
    monaco.languages.registerDefinitionProvider(language, { provideDefinition: (model, position) => provide(model, position, 'definition') })
    monaco.languages.registerReferenceProvider(language, { provideReferences: (model, position) => provide(model, position, 'references') })
  }
  monaco.languages.registerHoverProvider('python', {
    provideHover: async (model, position) => {
      const handle = await clients.get(model.uri.toString())?.ready()
      if (handle === undefined || handle === null) return null
      const hover = await api.lsp.hover({ handle, position: lspPosition(position) }).catch(() => null)
      return hover === null ? null : { contents: [{ value: hover.contents }], ...(hover.range ? { range: range(hover.range) } : {}) }
    },
  })
}

/**
 * Connects one code tab's model to the helper of its file while the switch is on (YAZ-3500). `dispose`
 * closes it there (the helper stops with the last tab of its project). A file no helper takes gets the
 * providers and nothing else.
 */
export function attachLanguageClient(model: Model, opts: { root: string; path: string }): { dispose(): void } {
  install()
  if (lspLanguageOf(opts.path) === null) return { dispose: () => undefined }
  let session: { dispose(): void } | null = null
  const follow = (on: boolean): void => {
    if (on && session === null && !model.isDisposed()) session = openSession(model, opts)
    else if (!on && session !== null) {
      session.dispose()
      session = null
    }
  }
  follow(languageHelpersOn())
  const off = onLanguageHelpers(follow)
  return {
    dispose() {
      off()
      session?.dispose()
      session = null
    },
  }
}

/** The tab's file open with its helper: from `lsp.open` to `lsp.close`. */
function openSession(model: Model, opts: { root: string; path: string }): { dispose(): void } {
  const key = model.uri.toString()
  const handle: Promise<string | null> = api.lsp
    .open({ root: opts.root, path: opts.path, text: model.getValue() })
    .then((res) => res?.handle ?? null)
    .catch(() => null)
  let timer: ReturnType<typeof setTimeout> | undefined
  let dirty = false
  let closed = false
  const send = async (): Promise<void> => {
    clearTimeout(timer)
    timer = undefined
    if (!dirty || closed || model.isDisposed()) return
    dirty = false
    const text = model.getValue()
    const h = await handle
    if (h !== null && !closed) await api.lsp.change(h, text).catch(() => undefined)
  }
  const changes = model.onDidChangeContent(() => {
    dirty = true
    clearTimeout(timer)
    timer = setTimeout(() => void send(), SYNC_DEBOUNCE_MS)
  })
  clients.set(key, {
    path: opts.path,
    ready: async () => {
      await send()
      return handle
    },
  })
  return {
    dispose() {
      closed = true
      clearTimeout(timer)
      changes.dispose()
      clients.delete(key)
      void handle.then((h) => (h === null ? undefined : api.lsp.close(h).catch(() => undefined)))
      if (clients.size > 0) return
      for (const { model: preview } of previews.values()) preview.dispose()
      previews.clear()
    },
  }
}
