/**
 * WHERE THE CODE OUTLINE'S SYMBOLS COME FROM (YAZ-3486). No language helper, for any language
 * (YAZ-3439 "The Python Outline is read from the text, with no helper"):
 *  - A `.py` file: the text itself (`pythonSymbols.ts`). Monaco has no symbols for Python.
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
 * A LARGE FILE (`LARGE_CODE_CHARS`) reads symbols only in the TS worker. The Python reader and Monaco's other
 * providers run on the page's thread, and their cost grows with the file (YAZ-3458, measured with
 * `codeTab.spec.ts` step 11's probe, the table of contents on, then Off): a pause in the typing gave a long task
 * of 720–960 ms in a 5.4 MB JSON file, 340–460 ms in 6 MB of HTML, 90 ms in 5.3 MB of Python, and none with the
 * table of contents Off. So above the limit such a file has no symbol: no table of contents.
 *
 * THE INTERNAL DOOR. Monaco has no public "give me the document symbols of this model": the editor's
 * own command service gives them (`documentSymbolsOf`, `monacoInternals.ts`). When it is missing (a later
 * Monaco), the answer is null: no table of contents, nothing throws.
 */
import { monaco } from '../monaco'
import { documentSymbolsOf } from '../monacoInternals'
import { pythonSymbols } from '../pythonSymbols'
import type { CodeSymbol, OutlineTree } from './outlineModel'
import { unpackTree } from './outlinePack'

type Model = ReturnType<typeof monaco.editor.createModel>
type Editor = ReturnType<typeof monaco.editor.create>

/** A LARGE CODE FILE (YAZ-3501) from this many characters (512 KB of ASCII): sticky scroll reads its indentation, and only the TS worker reads its symbols. */
export const LARGE_CODE_CHARS = 512 * 1024

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
  if (language === 'typescript' || language === 'javascript') {
    const tree = await readTsTree(model, showLocals)
    if (tree !== undefined) return tree
  }
  // The page's thread: nothing that grows with a large file (see the module doc).
  if (model.getValueLength() >= LARGE_CODE_CHARS) return []
  if (language === 'python') return pythonSymbols(model.getValue())
  return (await documentSymbolsOf(editor, model.uri)) as CodeSymbol[] | null
}
