/** Monaco's TypeScript worker module (monaco-editor 0.57 ships no types for it): what `tsWorker.ts` uses. */
declare module 'monaco-editor/languages/features/typescript/ts.worker' {
  export class TypeScriptWorker {
    constructor(ctx: unknown, createData: unknown)
  }
  export function initialize(callback: (ctx: unknown, createData: unknown) => unknown): void
}
