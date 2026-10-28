/**
 * WHERE THE CODE OUTLINE'S SYMBOLS COME FROM (YAZ-3486). No language helper, for any language
 * (YAZ-3439 "The Python Outline is read from the text, with no helper"):
 *  - A `.py` / `.pyi` file: the text itself (`pythonSymbols.ts`). Monaco has no symbols for Python.
 *  - A TS, JS or React file: the TS worker makes the whole tree and hands over one packed buffer
 *    (`getOutlineTree`, `code/tsWorker.ts`; YAZ-3501). The symbols are the ones Monaco's TS provider
 *    gives, by the same rules; only the work moves off the page's thread. Monaco's own path cost the
 *    page about 1 s after each pause in the typing of a 5 MB file. When the worker can not answer (no
 *    such method, an error), the read goes Monaco's way, below.
 *  - Every other file: Monaco's own document symbol providers — Monaco's JSON, CSS and HTML workers,
 *    and any language whose Monaco mode registers one. The answer is Monaco's `OutlineModel`, the one
 *    its sticky scroll and Go to Symbol read.
 * A file with neither (`.lua`, `.md` as code) answers no symbol: no Outline, and no error (S11).
 *
 * THE ONE INTERNAL DOOR. Monaco has no public "give me the document symbols of this model". Its
 * command `_executeDocumentSymbolProvider` gives them (every provider of the model's language, merged
 * as VS Code's Outline merges them), and the editor's own command service runs it. That service is a
 * private field of the editor (`_commandService`); its use is here alone, behind
 * `CommandServiceLike`. When it is missing (a later Monaco), the answer is null: no Outline, nothing
 * throws. A deep import of Monaco's services was the other way, and it would make Vite's dev server
 * bundle Monaco twice.
 */
import { monaco } from '../monaco'
import { pythonSymbols } from '../pythonSymbols'
import type { CodeSymbol, OutlineTree } from './outlineModel'
import { unpackTree } from './outlinePack'

type Model = ReturnType<typeof monaco.editor.createModel>
type Editor = ReturnType<typeof monaco.editor.create>

/** The part of Monaco's command service the read uses (internal API, see the module doc). */
interface CommandServiceLike {
  executeCommand(id: string, ...args: unknown[]): Promise<unknown>
}

const DOCUMENT_SYMBOLS = '_executeDocumentSymbolProvider'

/** What the TS worker's proxy answers for the Outline (`code/tsWorker.ts`). */
interface OutlineWorker {
  getOutlineTree(fileName: string, showLocals: boolean): Promise<ArrayBuffer | null>
}

/** The TS worker's tree of a TS or JS model; undefined when the worker can not answer it. */
async function readTsTree(model: Model, showLocals: boolean): Promise<OutlineTree | undefined> {
  try {
    const ts = monaco.typescript
    const getWorker = model.getLanguageId() === 'typescript' ? await ts.getTypeScriptWorker() : await ts.getJavaScriptWorker()
    const worker = (await getWorker(model.uri)) as unknown as OutlineWorker
    const packed = await worker.getOutlineTree(model.uri.toString(), showLocals)
    return packed instanceof ArrayBuffer ? (unpackTree(packed) ?? undefined) : undefined
  } catch {
    return undefined
  }
}

/**
 * The symbols of the model now: a tree from the TS worker, or a provider's symbols; null when no
 * source answers. An empty tree or list is a file with no symbol. `showLocals` keeps the names inside
 * functions in the TS worker's tree (YAZ-3507); a list of symbols keeps them all, and the feed's
 * `buildTree` applies the same rule.
 */
export async function readSymbols(editor: Editor, model: Model, showLocals = false): Promise<OutlineTree | readonly CodeSymbol[] | null> {
  const language = model.getLanguageId()
  if (language === 'python') return pythonSymbols(model.getValue())
  if (language === 'typescript' || language === 'javascript') {
    const tree = await readTsTree(model, showLocals)
    if (tree !== undefined) return tree
  }
  const commands = (editor as unknown as { _commandService?: CommandServiceLike })._commandService
  if (typeof commands?.executeCommand !== 'function') return null
  try {
    const symbols = await commands.executeCommand(DOCUMENT_SYMBOLS, model.uri)
    return Array.isArray(symbols) ? (symbols as CodeSymbol[]) : null
  } catch {
    // A provider that failed, a model gone under the request: no answer this time.
    return null
  }
}
