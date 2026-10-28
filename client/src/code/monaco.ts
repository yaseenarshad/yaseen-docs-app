/**
 * THE ONE DOOR TO MONACO (YAZ-3447, D1). Only the lazy `CodeEditor` chunk imports this module, so a
 * window with no code tab loads none of Monaco.
 *
 * WORKERS. Each worker is a Vite `?worker` bundle served beside the renderer (`app://yaseen/assets/…`);
 * nothing comes from a network. The imports name the same files Monaco's own `new Worker(new URL(…))`
 * calls name, so Vite bundles each worker once. `getWorker` is needed for the editor worker: Monaco
 * starts that one from a blob of `editorWebWorkerMain.js`, a file Vite copies raw, unbundled.
 *
 * SMART HELP in one file (TS, JS, TSX, JSON, CSS, HTML) is Monaco's own. Its TypeScript worker puts
 * EVERY open TS and JS model in one program: each code tab has its own model (`code-tab://t<n>/…`), and
 * Quick Look has its own (`code-look://q<n>/…`). So two rules make each model read as one file alone:
 *  - `moduleDetection: force`: each file is its own module, also a script with no `import` or `export`.
 *    Without it, two models of one script (Duplicate tab, two tabs, Quick Look) declared the same names
 *    twice, and the copy showed a false TS2451 "Cannot redeclare" (YAZ-3462).
 *  - The worker does not read the disk, so "cannot find module" and its kin would mark every import
 *    red: those codes are not shown.
 * Every other language gets colours only: Monaco's own, and for the 8 D4 types Monaco lacks, the small
 * tokenizers of `monacoLanguages.ts` (YAZ-3479), registered here before any model is made.
 */
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import CssWorker from 'monaco-editor/languages/features/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/languages/features/html/html.worker?worker'
import JsonWorker from 'monaco-editor/languages/features/json/json.worker?worker'
import TsWorker from 'monaco-editor/languages/features/typescript/ts.worker?worker'
import { registerExtraLanguages } from './monacoLanguages'
import { buildMonacoTheme, monacoThemeName, readAppTokens, type AppTheme } from './monacoTheme'

function workerFor(label: string): Worker {
  switch (label) {
    case 'json':
      return new JsonWorker()
    case 'css':
    case 'scss':
    case 'less':
      return new CssWorker()
    case 'html':
    case 'handlebars':
    case 'razor':
      return new HtmlWorker()
    case 'typescript':
    case 'javascript':
      return new TsWorker()
    default:
      return new EditorWorker()
  }
}

self.MonacoEnvironment = { getWorker: (_workerId, label) => workerFor(label) }

registerExtraLanguages(monaco.languages)

/**
 * TS 2307 / 2792 (cannot find module), 7016 (no types for a module), 7026 and 2875 (JSX with no React
 * types): true only because the worker sees no file on disk. The other diagnostics stay.
 */
const ONE_FILE_NOISE = [2307, 2792, 7016, 7026, 2875]
const ts = monaco.typescript
/** `ts.ModuleDetectionKind.Force`. Monaco passes the options to its TypeScript as they are, and exports no name for it. */
const MODULE_DETECTION_FORCE = 3
for (const defaults of [ts.typescriptDefaults, ts.javascriptDefaults]) {
  defaults.setCompilerOptions({ ...defaults.getCompilerOptions(), jsx: ts.JsxEmit.ReactJSX, allowJs: true, allowNonTsExtensions: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, moduleDetection: MODULE_DETECTION_FORCE })
  defaults.setDiagnosticsOptions({ ...defaults.getDiagnosticsOptions(), diagnosticCodesToIgnore: ONE_FILE_NOISE, onlyVisible: true })
  // Jumps and references: `languageClient.ts` is the one source (the project's helper, else this worker). YAZ-3454.
  defaults.setModeConfiguration({ ...defaults.modeConfiguration, definitions: false, references: false })
}

/**
 * Monaco's theme is one for the whole page. Each call rebuilds it from the app.css tokens as they
 * are applied now, so an Appearance change is one call, with no reload of any editor.
 */
export function applyAppTheme(theme: AppTheme): void {
  const name = monacoThemeName(theme)
  monaco.editor.defineTheme(name, buildMonacoTheme(theme, readAppTokens()))
  monaco.editor.setTheme(name)
}

export { monaco }
