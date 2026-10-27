import { realpathSync } from 'node:fs'
import { sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LspHover, LspLanguage, LspLocation, LspOpenRequest, LspOpenResponse, LspPosition, LspRange } from '@shared/lsp'
import { lspLanguageOf } from '@shared/lsp'
import { isInside } from './projectRoot'
import { fileUri, startLanguageServer, type LanguageServer, type ServerCommand, type StartOptions } from './server'

/**
 * THE HELPERS OF THE CODE TABS (YAZ-3454 4B, YAZ-3455 4C; D9, D10). Electron-free: `ipc/lsp.ts`
 * passes in who asks (`owner`, a window) and what each language needs (`LanguageSpec`).
 *
 * ONE HELPER FOR EACH PROJECT. The project of a file is its language's nearest marker folder
 * (`tsconfig.json` / `package.json`; `pyproject.toml` / `setup.py` / `requirements.txt`). A helper
 * starts when the first tab of its project opens, and stops when the last one closes.
 *
 * AT MOST `maxServers` (3) HELPERS AT ONCE, every language together: one helper measured 400 to 422 MB
 * on this repo (YAZ-3453). A project that needs a helper when 3 run stops the one used longest ago.
 * That project keeps its documents, and its next request starts its helper again.
 *
 * ONE RESTART. A helper that ends on its own (no `stop` asked) starts again at once, one time for
 * its project. A second end, or a start that fails twice, leaves the project with no helper: every
 * request answers `null`, and the tab uses Monaco's one-file help, with no message.
 *
 * DOCUMENTS. Each tab has its own handle; tabs on one file share one LSP document, whose text is
 * the last text a tab sent (full text, debounced in the tab). Main keeps that text, so a helper
 * that starts again gets every open document back.
 */

export interface LanguageSpec {
  language: LspLanguage
  /** The project folder of `file`; null = no helper for it (Monaco's one-file help only). */
  projectRoot(file: string, vaultRoot: string): string | null
  /** How to start the helper in `projectRoot`; null when the helper is not installed. */
  command(projectRoot: string): ServerCommand | null
  /** More start options (the server's own requests: `workspace/configuration`). */
  startOptions?(projectRoot: string): Partial<StartOptions>
  /**
   * The helper's own install folder (its `lib.*.d.ts`, pyright's typeshed): a place in it is dropped.
   * Packaged, it is inside the app, and a tab must never write there.
   */
  ownFolder?(): string | null
  /**
   * Resolves when a new helper has its workspace's file list; `references` waits for it (pyright
   * reads the list after `initialized`, and a search before that misses every file not open).
   */
  workspaceReady?(server: LanguageServer): Promise<void>
}

export interface PoolOptions {
  /** Helpers at once, every language together. Default 3. */
  maxServers?: number
  /** How long a definition or reference request may take, the helper's first load included. Default 30 s. */
  requestTimeoutMs?: number
  /** Hover is asked as the mouse moves: a short wait. Default 5 s. */
  hoverTimeoutMs?: number
  start?: (cmd: ServerCommand, options: StartOptions) => Promise<LanguageServer>
  /** The real path of a file (symlinks resolved); default `fs.realpathSync.native`, the path itself when that fails. */
  realpath?: (path: string) => string
  now?: () => number
  log?: (message: string) => void
}

interface Doc {
  uri: string
  languageId: string
  text: string
  version: number
  handles: Set<string>
  /** The helper that has this document open (`didOpen` sent), if any. */
  openOn: LanguageServer | null
}

interface Project {
  key: string
  spec: LanguageSpec
  root: string
  docs: Map<string, Doc>
  server: LanguageServer | null
  /** `LanguageSpec.workspaceReady` of `server`. */
  ready: Promise<void>
  starting: Promise<LanguageServer | null> | null
  /** Raised on each stop the pool asks for: a start that was under way then is thrown away. */
  epoch: number
  lastUsed: number
  /** Ends and failed starts that nobody asked for. 2 = no more starts. */
  failures: number
}

interface Handle {
  owner: number
  project: Project
  doc: Doc
}

const RESTARTS = 1

export class LspPool {
  private readonly specs = new Map<LspLanguage, LanguageSpec>()
  private readonly projects = new Map<string, Project>()
  private readonly handles = new Map<string, Handle>()
  private nextHandle = 0
  private readonly maxServers: number
  private readonly requestTimeoutMs: number
  private readonly hoverTimeoutMs: number
  private readonly start: NonNullable<PoolOptions['start']>
  private readonly now: () => number
  private readonly log: (message: string) => void
  private readonly realpath: (path: string) => string
  /**
   * Real project folder → the folder as the tab named it, for each open project whose two differ.
   * A helper answers real paths (`/private/var/…` for `/var/…`); the tab must get its own spelling
   * back, or a jump inside its own file would open a second tab. The helper gets real paths, so it
   * never holds one file twice.
   */
  private readonly spelled = new Map<string, string>()
  private clock = 0

  constructor(specs: readonly LanguageSpec[], options: PoolOptions = {}) {
    for (const spec of specs) this.specs.set(spec.language, spec)
    this.maxServers = options.maxServers ?? 3
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000
    this.hoverTimeoutMs = options.hoverTimeoutMs ?? 5_000
    this.start = options.start ?? startLanguageServer
    // A counter, not the wall clock alone: two uses in one millisecond still have an order.
    this.now = options.now ?? (() => ++this.clock)
    this.log = options.log ?? ((message) => console.warn(`[lsp] ${message}`))
    this.realpath =
      options.realpath ??
      ((p) => {
        try {
          return realpathSync.native(p)
        } catch {
          return p
        }
      })
  }

  /** A tab opened `req.path`. Null when no helper takes the file (its language, no project, not installed). */
  open(owner: number, req: LspOpenRequest): LspOpenResponse | null {
    const kind = lspLanguageOf(req.path)
    const spec = kind === null ? undefined : this.specs.get(kind.language)
    if (kind === null || spec === undefined) return null
    const root = spec.projectRoot(req.path, req.root)
    if (root === null) return null
    const key = `${spec.language}:${root}`
    let project = this.projects.get(key)
    if (project === undefined) {
      if (spec.command(root) === null) return null
      project = { key, spec, root, docs: new Map(), server: null, ready: Promise.resolve(), starting: null, epoch: 0, lastUsed: this.now(), failures: 0 }
      this.projects.set(key, project)
    }
    const real = this.realpath(req.path)
    const realRoot = this.realpath(root)
    if (realRoot !== root) this.spelled.set(realRoot, root)
    const uri = fileUri(real)
    let doc = project.docs.get(uri)
    if (doc === undefined) {
      doc = { uri, languageId: kind.languageId, text: req.text, version: 1, handles: new Set(), openOn: null }
      project.docs.set(uri, doc)
      if (project.server !== null) this.openDoc(project.server, doc)
    } else if (doc.text !== req.text) {
      this.setText(project, doc, req.text)
    }
    const handle = `h${++this.nextHandle}`
    doc.handles.add(handle)
    this.handles.set(handle, { owner, project, doc })
    project.lastUsed = this.now()
    // The helper starts with the first tab of its project, not with the first jump.
    void this.ensureServer(project)
    return { handle, language: spec.language, projectRoot: root }
  }

  /** The tab's whole text now. An unknown handle is ignored. */
  change(owner: number, handle: string, text: string): void {
    const h = this.handleOf(owner, handle)
    if (h !== null && h.doc.text !== text) this.setText(h.project, h.doc, text)
  }

  /** The tab closed. The last tab of a file closes its document; the last of a project stops its helper. */
  close(owner: number, handle: string): void {
    const h = this.handleOf(owner, handle)
    if (h === null) return
    this.handles.delete(handle)
    const { project, doc } = h
    doc.handles.delete(handle)
    if (doc.handles.size > 0) return
    project.docs.delete(doc.uri)
    if (doc.openOn !== null && doc.openOn === project.server) project.server.notify('textDocument/didClose', { textDocument: { uri: doc.uri } })
    if (project.docs.size > 0) return
    this.projects.delete(project.key)
    const realRoot = this.realpath(project.root)
    if (![...this.projects.values()].some((p) => p.root === project.root)) this.spelled.delete(realRoot)
    this.stopServer(project)
  }

  /** A window went away (closed, crashed, reloaded): every tab it had closes. */
  closeOwner(owner: number): void {
    for (const [handle, h] of [...this.handles]) if (h.owner === owner) this.close(owner, handle)
  }

  definition(owner: number, handle: string, position: LspPosition): Promise<LspLocation[] | null> {
    return this.ask(owner, handle, 'textDocument/definition', { position }, this.requestTimeoutMs, (answer, spec) => outside(toLocations(answer), spec))
  }

  references(owner: number, handle: string, position: LspPosition): Promise<LspLocation[] | null> {
    return this.ask(owner, handle, 'textDocument/references', { position, context: { includeDeclaration: true } }, this.requestTimeoutMs, (answer, spec) => outside(toLocations(answer), spec), true)
  }

  hover(owner: number, handle: string, position: LspPosition): Promise<LspHover | null> {
    return this.ask(owner, handle, 'textDocument/hover', { position }, this.hoverTimeoutMs, toHover)
  }

  /** Every helper the pool runs now (tests, logs). */
  running(): { key: string; root: string; language: LspLanguage; pid: number }[] {
    return [...this.projects.values()].filter((p) => p.server !== null).map((p) => ({ key: p.key, root: p.root, language: p.spec.language, pid: p.server!.pid }))
  }

  /** Stops every helper and forgets every tab (the quit). Never rejects. */
  async stopAll(): Promise<void> {
    const projects = [...this.projects.values()]
    this.projects.clear()
    this.handles.clear()
    this.spelled.clear()
    await Promise.allSettled(projects.map((p) => this.stopServer(p)))
  }

  private handleOf(owner: number, handle: string): Handle | null {
    const h = this.handles.get(handle)
    return h !== undefined && h.owner === owner ? h : null
  }

  /** Places in the tab's own spelling (see `spelled`). */
  private respell<R>(answer: R): R {
    if (this.spelled.size === 0 || !Array.isArray(answer)) return answer
    return (answer as LspLocation[]).map((p) => {
      for (const [real, named] of this.spelled) {
        if (p.path === real || p.path.startsWith(real + sep)) return { ...p, path: named + p.path.slice(real.length) }
      }
      return p
    }) as R
  }

  private setText(project: Project, doc: Doc, text: string): void {
    doc.text = text
    doc.version++
    if (doc.openOn !== null && doc.openOn === project.server) {
      project.server.notify('textDocument/didChange', { textDocument: { uri: doc.uri, version: doc.version }, contentChanges: [{ text }] })
    }
  }

  private openDoc(server: LanguageServer, doc: Doc): void {
    server.notify('textDocument/didOpen', { textDocument: { uri: doc.uri, languageId: doc.languageId, version: doc.version, text: doc.text } })
    doc.openOn = server
  }

  private async ask<R>(owner: number, handle: string, method: string, extra: Record<string, unknown>, timeoutMs: number, map: (answer: unknown, spec: LanguageSpec) => R, wholeWorkspace = false): Promise<R | null> {
    const h = this.handleOf(owner, handle)
    if (h === null) return null
    h.project.lastUsed = this.now()
    const server = await this.ensureServer(h.project)
    // The tab may have closed while the helper started.
    if (server === null || !this.handles.has(handle)) return null
    if (h.doc.openOn !== server) this.openDoc(server, h.doc)
    if (wholeWorkspace) await h.project.ready
    try {
      return this.respell(map(await server.request(method, { textDocument: { uri: h.doc.uri }, ...extra }, timeoutMs), h.project.spec))
    } catch (err) {
      // A timeout or a helper that ended: the tab falls back, with no message.
      this.log(`${h.project.key}: ${method} failed: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }

  private ensureServer(project: Project): Promise<LanguageServer | null> {
    if (project.server !== null) return Promise.resolve(project.server)
    if (project.starting !== null) return project.starting
    if (project.failures > RESTARTS) return Promise.resolve(null)
    const command = project.spec.command(project.root)
    if (command === null) return Promise.resolve(null)
    this.makeRoomFor(project)
    const epoch = project.epoch
    const startedAt = Date.now()
    const starting = (async (): Promise<LanguageServer | null> => {
      try {
        const server = await this.start(command, { rootPath: project.root, ...project.spec.startOptions?.(project.root) })
        // Stopped (closed or pushed out) while it started: this helper is not wanted.
        if (project.epoch !== epoch) {
          void server.stop()
          return null
        }
        project.server = server
        project.ready = project.spec.workspaceReady?.(server) ?? Promise.resolve()
        this.log(`${project.key}: helper ${server.pid} up in ${Date.now() - startedAt} ms`)
        void server.exited.then((exit) => this.onExit(project, server, exit))
        for (const doc of project.docs.values()) this.openDoc(server, doc)
        return server
      } catch (err) {
        project.failures++
        this.log(`${project.key}: helper did not start: ${err instanceof Error ? err.message : String(err)}`)
        return null
      } finally {
        project.starting = null
      }
    })()
    project.starting = starting
    return starting
  }

  /** At most `maxServers` helpers: the one used longest ago stops (it keeps its documents). */
  private makeRoomFor(project: Project): void {
    for (;;) {
      const others = [...this.projects.values()].filter((p) => p !== project && (p.server !== null || p.starting !== null))
      if (others.length < this.maxServers) return
      const oldest = others.reduce((a, b) => (b.lastUsed < a.lastUsed ? b : a))
      this.log(`${oldest.key}: stopped, ${this.maxServers} helpers at most (used longest ago)`)
      void this.stopServer(oldest)
    }
  }

  private stopServer(project: Project): Promise<void> {
    project.epoch++
    project.starting = null
    const server = project.server
    project.server = null
    for (const doc of project.docs.values()) doc.openOn = null
    return server === null ? Promise.resolve() : server.stop()
  }

  private onExit(project: Project, server: LanguageServer, exit: { code: number | null; signal: NodeJS.Signals | null }): void {
    if (server.stopRequested || project.server !== server) return
    project.server = null
    for (const doc of project.docs.values()) doc.openOn = null
    project.failures++
    this.log(`${project.key}: helper ${server.pid} ended (code ${exit.code}, signal ${exit.signal})${project.failures > RESTARTS ? '; no more restarts' : '; restart'}`)
    if (this.projects.get(project.key) === project && project.docs.size > 0) void this.ensureServer(project)
  }
}

/** Drops the places inside the helper's own folder (`LanguageSpec.ownFolder`). */
function outside(places: LspLocation[], spec: LanguageSpec): LspLocation[] {
  const own = spec.ownFolder?.()
  return own ? places.filter((p) => !isInside(p.path, own)) : places
}

interface WireLocation {
  uri: string
  range: LspRange
}
interface WireLocationLink {
  targetUri: string
  targetSelectionRange: LspRange
}

/** `Location | Location[] | LocationLink[] | null` → places on disk; a URI that is no file is dropped. */
export function toLocations(answer: unknown): LspLocation[] {
  if (answer === null || answer === undefined) return []
  const list = (Array.isArray(answer) ? answer : [answer]) as (WireLocation | WireLocationLink)[]
  const out: LspLocation[] = []
  for (const item of list) {
    const uri = 'targetUri' in item ? item.targetUri : item.uri
    const range = 'targetUri' in item ? item.targetSelectionRange : item.range
    if (typeof uri !== 'string' || !uri.startsWith('file:') || range === undefined) continue
    out.push({ path: fileURLToPath(uri), range: { start: { ...range.start }, end: { ...range.end } } })
  }
  return out
}

type MarkedString = string | { language: string; value: string }

/** `Hover | null` → Markdown; null when there is nothing to show. */
export function toHover(answer: unknown): LspHover | null {
  if (answer === null || typeof answer !== 'object') return null
  const { contents, range } = answer as { contents?: unknown; range?: LspRange }
  const one = (c: MarkedString): string => (typeof c === 'string' ? c : `\`\`\`${c.language}\n${c.value}\n\`\`\``)
  let text: string
  if (Array.isArray(contents)) text = (contents as MarkedString[]).map(one).join('\n\n')
  else if (contents !== null && typeof contents === 'object' && 'kind' in contents) text = String((contents as unknown as { value?: unknown }).value ?? '')
  else if (contents !== undefined && contents !== null) text = one(contents as MarkedString)
  else return null
  if (text.trim() === '') return null
  return range === undefined ? { contents: text } : { contents: text, range }
}
