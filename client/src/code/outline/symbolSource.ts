/**
 * WHERE THE CODE OUTLINE'S SYMBOLS COME FROM (YAZ-3486). No language helper, for any language
 * (YAZ-3439 "The Python Outline is read from the text, with no helper"):
 *  - A `.py` / `.pyi` file: the text itself (`pythonSymbols.ts`). Monaco has no symbols for Python.
 *  - Every other file: Monaco's own document symbol providers — the TS worker for TS, JS and React,
 *    Monaco's JSON, CSS and HTML workers, and any language whose Monaco mode registers one. The
 *    answer is Monaco's `OutlineModel`, the one its sticky scroll and Go to Symbol read.
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
import type { monaco } from '../monaco'
import { pythonSymbols } from '../pythonSymbols'
import type { CodeSymbol } from './outlineModel'

type Model = ReturnType<typeof monaco.editor.createModel>
type Editor = ReturnType<typeof monaco.editor.create>

/** The part of Monaco's command service the read uses (internal API, see the module doc). */
interface CommandServiceLike {
  executeCommand(id: string, ...args: unknown[]): Promise<unknown>
}

const DOCUMENT_SYMBOLS = '_executeDocumentSymbolProvider'

/** The symbols of the model now; null when no source answers. */
export async function readSymbols(editor: Editor, model: Model): Promise<readonly CodeSymbol[] | null> {
  if (model.getLanguageId() === 'python') return pythonSymbols(model.getValue())
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
