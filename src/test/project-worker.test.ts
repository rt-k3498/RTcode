import { describe, it, expect } from "vitest";
// @ts-expect-error Monaco worker implementation has no public declarations.
import { TypeScriptWorker } from "monaco-editor/esm/vs/language/typescript/tsWorker.js";
// @ts-expect-error Use Monaco's exact bundled compiler, not a separate version.
import { typescript as ts } from "monaco-editor/esm/vs/language/typescript/lib/typescriptServices.js";
import { projectWorker } from "../editor/project-worker";
const root = "file:///workspace/";
function worker(files: Record<string, string>) {
  const Worker = projectWorker(TypeScriptWorker, ts);
  return new Worker(
    { getMirrorModels: () => [] },
    {
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        noEmit: true,
      },
      extraLibs: Object.fromEntries(
        Object.entries(files).map(([path, content]) => [
          root + path,
          { content, version: 1 },
        ]),
      ),
    },
  );
}
const source =
  'import { answer } from "@/lib/value";\nconst value: number = answer;';
describe("workspace TypeScript projects", () => {
  it("uses JSONC, inherited config-relative aliases, and unopened source files", async () => {
    const w = worker({
      "tsconfig.base.json":
        '{ // shared\n"compilerOptions": {"baseUrl": ".", "paths": {"@/*": ["src/*"]}, "strict": true}}',
      "tsconfig.json":
        '{"extends": "./tsconfig.base.json", "include": ["src"]}',
      "src/main.ts": source,
      "src/lib/value.ts": "export const answer = 42;",
    });
    expect(await w.getSemanticDiagnostics(root + "src/main.ts")).toEqual([]);
    const definition = await w.getDefinitionAtPosition(
      root + "src/main.ts",
      source.indexOf("answer") + 1,
    );
    expect(definition[0].fileName).toBe(root + "src/lib/value.ts");
  });
  it("keeps nested project aliases separate and honors referenced app configs", async () => {
    const w = worker({
      "tsconfig.json":
        '{"files": [], "references": [{"path":"./apps/a"},{"path":"./apps/b"}]}',
      "apps/a/tsconfig.json":
        '{"files": [], "references": [{"path":"./tsconfig.app.json"}]}',
      "apps/a/tsconfig.app.json":
        '{"compilerOptions":{"paths":{"@/*":["./src/*"]},"strict":true},"include":["src"]}',
      "apps/b/tsconfig.json":
        '{"compilerOptions":{"paths":{"@/*":["./src/*"]}},"include":["src"]}',
      "apps/a/src/main.ts": source,
      "apps/a/src/lib/value.ts": "export const answer = 42;",
      "apps/b/src/main.ts": source,
      "apps/b/src/lib/value.ts": 'export const answer = "wrong type";',
    });
    expect(await w.getSemanticDiagnostics(root + "apps/a/src/main.ts")).toEqual(
      [],
    );
    expect(
      (await w.getSemanticDiagnostics(root + "apps/b/src/main.ts")).map(
        (d: any) => d.code,
      ),
    ).toContain(2322);
    expect(await w.getSemanticDiagnostics(root + "apps/a/src/main.ts")).toEqual(
      [],
    );
  });
  it("resolves installed package exports and automatic @types", async () => {
    const w = worker({
      "tsconfig.json":
        '{"compilerOptions":{"module":"ESNext","moduleResolution":"Bundler","strict":true},"include":["src"]}',
      "src/main.ts":
        'import { answer } from "pkg/value"; const value: number = answer; const p: Process = {id: 1};',
      "node_modules/pkg/package.json":
        '{"name":"pkg","exports":{"./value":{"types":"./value.d.ts"}}}',
      "node_modules/pkg/value.d.ts": "export declare const answer: number;",
      "node_modules/@types/example/index.d.ts":
        "interface Process { id: number }",
    });
    expect(await w.getSemanticDiagnostics(root + "src/main.ts")).toEqual([]);
  });
  it("uses jsconfig checkJs and reports genuinely missing modules", async () => {
    const w = worker({
      "jsconfig.json":
        '{"compilerOptions":{"checkJs":true,"paths":{"@/*":["./src/*"]}},"include":["src"]}',
      "src/main.js":
        'import { answer } from "@/lib/value"; import "missing-side-effect"; answer();',
      "src/lib/value.js": "export const answer = 42;",
    });
    const diagnostics = await w.getSemanticDiagnostics(root + "src/main.js");
    expect(diagnostics.map((d: any) => d.code)).toContain(2349);
    expect(diagnostics.some((d: any) => d.code === 2307)).toBe(false);
  });
  it("refreshes configuration after disk snapshots change", async () => {
    const files = {
      "tsconfig.json":
        '{"compilerOptions":{"paths":{"@/*":["./wrong/*"]}},"include":["src"]}',
      "src/main.ts": source,
      "src/lib/value.ts": "export const answer = 42;",
    };
    const w = worker(files);
    expect(
      (await w.getSemanticDiagnostics(root + "src/main.ts")).some(
        (d: any) => d.code === 2307,
      ),
    ).toBe(true);
    await w.updateExtraLibs(
      Object.fromEntries(
        Object.entries({
          ...files,
          "tsconfig.json":
            '{"compilerOptions":{"paths":{"@/*":["./src/*"]}},"include":["src"]}',
        }).map(([path, content]) => [root + path, { content, version: 2 }]),
      ),
    );
    expect(await w.getSemanticDiagnostics(root + "src/main.ts")).toEqual([]);
  });
});

it("resolves transitive types through pnpm-style package symlinks", async () => {
  const packagePath = "node_modules/.pnpm/pkg@1/node_modules/pkg/index.d.ts";
  const w = worker({
    "tsconfig.json":
      '{"compilerOptions":{"module":"ESNext","moduleResolution":"Bundler","strict":true},"include":["src"]}',
    "src/main.ts":
      'import type { Answer } from "pkg"; const value: Answer = {value: 42};',
    "node_modules/pkg/package.json": '{"name":"pkg","types":"index.d.ts"}',
    "node_modules/pkg/index.d.ts": 'export type { Answer } from "dep";',
    [packagePath]: 'export type { Answer } from "dep";',
    "node_modules/.pnpm/pkg@1/node_modules/dep/index.d.ts":
      "export interface Answer { value: number }",
  });
  await w.updateExtraLibs({
    ...w.getExtraLibs(),
    "rtcode://project": {
      content: JSON.stringify({
        [root + "node_modules/pkg/index.d.ts"]: root + packagePath,
      }),
      version: 1,
    },
  });
  expect(await w.getSemanticDiagnostics(root + "src/main.ts")).toEqual([]);
});

it("does not silently rename files that are not open for saving", async () => {
  const w = worker({
    "tsconfig.json": '{"include":["src"]}',
    "src/main.ts": 'import { answer } from "./value"; answer;',
    "src/value.ts": "export const answer = 42;",
  });
  await w.updateExtraLibs({
    ...w.getExtraLibs(),
    "rtcode://open-files": {
      content: JSON.stringify([root + "src/value.ts"]),
      version: 1,
    },
  });
  const info = await w.getRenameInfo(root + "src/value.ts", 14, {});
  expect(info.canRename).toBe(false);
  expect(info.localizedErrorMessage).toContain("Open all affected files");
});
