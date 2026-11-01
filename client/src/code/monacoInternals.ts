/**
 * EVERY USE OF MONACO'S INTERNAL API (YAZ-3458). Monaco has no public door for these, so each one can break
 * on a Monaco upgrade; rule 42 lists them as the check for one. Each part answers null when it is missing:
 * the feature does nothing, and nothing throws. No runtime import: the folds and the jumps are tested with
 * a fake editor.
 *
 *  1. The folding controller's model (`foldingModelOf`): the fold restore (`codeFolds.ts`), the table
 *     of contents' jump (`outline/codeJump.ts`) and the fold-all chip's label (`readFold`, `CodeEditor.tsx`). Monaco has no public "fold the region on line n".
 *  2. The editor's command service (`documentSymbolsOf`): the table of contents' symbols for JSON, CSS,
 *     HTML (`outline/symbolSource.ts`). Monaco has no public "the document symbols of this model".
 *  3. In the TS worker, `_getModel` and `getLanguageService` (`tsWorker.ts`): that file is the worker's own
 *     bundle, so they stay there.
 *  4. In the build, `dropMonacoTsWorkerUrl` (`desktop/electron.vite.config.ts`): it fails the build when
 *     Monaco moves the code it removes.
 *  5. The editor's context key service (`onSymbolProviderChange`): the table of contents reads again when a
 *     document symbol provider for the tab's language registers (YAZ-3527). Monaco has no public event for it.
 */

/** The id of Monaco's folding contribution: its controller, and its part of `saveViewState()`. */
export const FOLDING = 'editor.contrib.folding'

/** The part of the folding model's regions the app uses. */
export interface FoldRegionsLike {
  length: number
  getStartLineNumber(index: number): number
  getEndLineNumber(index: number): number
  isCollapsed(index: number): boolean
  toRegion(index: number): unknown
}

/** The part of Monaco's folding model the app uses. */
export interface FoldingModelLike {
  regions: FoldRegionsLike
  toggleCollapseState(regions: unknown[]): void
}

/** The folding model of `editor`, once Monaco has its regions; null when there is none (a file too big to fold). */
export function foldingModelOf(editor: { getContribution(id: string): unknown }): Promise<FoldingModelLike | null> | null {
  const controller = editor.getContribution(FOLDING) as { getFoldingModel?: () => Promise<FoldingModelLike | null> | null } | null
  return controller?.getFoldingModel?.() ?? null
}

const DOCUMENT_SYMBOLS = '_executeDocumentSymbolProvider'

/**
 * Every document symbol provider's answer for `uri`, merged as VS Code's Outline merges them, through the
 * editor's own command service (a private field, `_commandService`). A deep import of Monaco's services was
 * the other way, and it would make Vite's dev server bundle Monaco twice. Null when the service is missing or
 * the provider fails.
 */
export async function documentSymbolsOf(editor: object, uri: unknown): Promise<unknown[] | null> {
  const commands = (editor as { _commandService?: { executeCommand?(id: string, ...args: unknown[]): Promise<unknown> } })._commandService
  if (typeof commands?.executeCommand !== 'function') return null
  try {
    const symbols = await commands.executeCommand(DOCUMENT_SYMBOLS, uri)
    return Array.isArray(symbols) ? symbols : null
  } catch {
    // A provider that failed, a model gone under the request: no answer this time.
    return null
  }
}

/** Monaco's context key "a document symbol provider answers for this editor's model" (`EditorContextKeys.hasDocumentSymbolProvider`). */
const HAS_SYMBOL_PROVIDER: ReadonlySet<string> = new Set(['editorHasDocumentSymbolProvider'])

/** The part of Monaco's context key service the app uses. */
interface ContextKeysLike {
  onDidChangeContext?(listener: (event: { affectsSome(keys: ReadonlySet<string>): boolean }) => void): { dispose(): void }
}

/**
 * Calls `listener` when a document symbol provider for `editor`'s model registers, or goes (YAZ-3527).
 *
 * Monaco sets a language's smart help up lazily: the first model of TS, JS, JSON, CSS or HTML starts a dynamic
 * import, and only when it has loaded does the language register its providers (and the TS worker accessor,
 * `getTypeScriptWorker`). A read of the symbols before that answers nothing, and Monaco has no public event
 * for "the language is ready". The editor's own context key `editorHasDocumentSymbolProvider` changes at that
 * moment (Monaco's `EditorModeContext` follows the provider registry), so its change is the signal. The editor's
 * context key service is a private field, `_contextKeyService`. Null when it is missing: no signal, nothing throws.
 */
export function onSymbolProviderChange(editor: object, listener: () => void): { dispose(): void } | null {
  const keys = (editor as { _contextKeyService?: ContextKeysLike })._contextKeyService
  if (typeof keys?.onDidChangeContext !== 'function') return null
  return keys.onDidChangeContext((event) => {
    // A Monaco that renamed `affectsSome` must not throw on every context change: then this door is shut, as if missing.
    if (typeof event?.affectsSome === 'function' && event.affectsSome(HAS_SYMBOL_PROVIDER)) listener()
  })
}

/** One of Monaco's keybindings, as `keybindingsOf` gives it. */
export interface MonacoKeybinding {
  /** The command; null for a binding with none. */
  command: string | null
  /** Monaco's spelling of the key, as a user's keybindings.json writes it ('cmd+k cmd+x'); null for none. */
  key: string | null
  /** The `when` clause, serialized; null for always. */
  when: string | null
  /** Monaco's own (or an extension's), not a rule the app added. */
  isDefault: boolean
}

interface KeybindingItemLike {
  command?: string | null
  when?: { serialize?(): string } | null
  isDefault?: boolean
  resolvedKeybinding?: { getUserSettingsLabel?(): string | null } | null
}

/**
 * Every keybinding Monaco has now, after the rules (YAZ-3564): the editor's keybinding service, a private field
 * (`_standaloneKeybindingService`), one for the window. Null when the service or its list is missing.
 */
export function keybindingsOf(editor: object): MonacoKeybinding[] | null {
  const service = (editor as { _standaloneKeybindingService?: { getKeybindings?(): readonly KeybindingItemLike[] } })._standaloneKeybindingService
  if (typeof service?.getKeybindings !== 'function') return null
  try {
    return service.getKeybindings().map((item) => ({
      command: item.command ?? null,
      key: item.resolvedKeybinding?.getUserSettingsLabel?.() ?? null,
      when: item.when?.serialize?.() ?? null,
      isDefault: item.isDefault === true,
    }))
  } catch {
    // A Monaco that changed the items' shape: no list, as if the door were missing.
    return null
  }
}
