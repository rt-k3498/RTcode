declare module "monaco-editor/esm/vs/language/typescript/ts.worker.js" {
  export const ts: { typescript: typeof import("typescript") };
  export const TypeScriptWorker: new (...args: any[]) => any;
  export function initialize(
    factory: (context: unknown, data: unknown) => unknown,
  ): void;
}
