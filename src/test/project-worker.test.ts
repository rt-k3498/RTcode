import { describe, it, expect } from "vitest";
// @ts-expect-error Monaco worker implementation has no public declarations.
import { TypeScriptWorker } from "monaco-editor/esm/vs/language/typescript/tsWorker.js";
// @ts-expect-error Use Monaco's exact bundled compiler, not a separate version.
import { typescript as ts } from "monaco-editor/esm/vs/language/typescript/lib/typescriptServices.js";
import { projectWorker } from "../editor/project-worker";
import {
  ProjectFiles,
  resolveProject,
  type Lib,
} from "../editor/project-files";
import type { ProjectEntry } from "../ipc/types";
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
        realPaths: {
          [root + "node_modules/pkg/index.d.ts"]: root + packagePath,
        },
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

// A language service that starts with only the open file and loads everything
// else from a fake disk when it asks for it.
function lazy(disk: Record<string, string>, open: string) {
  const uri = root + open;
  const model = {
    uri: { path: "/workspace/" + open, toString: () => uri },
    version: 1,
    getValue: () => disk[open],
  };
  const Worker = projectWorker(TypeScriptWorker, ts);
  const w = new Worker(
    { getMirrorModels: () => [model] },
    {
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        noEmit: true,
      },
      extraLibs: {},
    },
  );
  const requested: string[] = [];
  const files = new ProjectFiles("workspace", async (paths) => {
    requested.push(...paths);
    return paths.flatMap((path): ProjectEntry[] => {
      if (path in disk) return [{ path, content: disk[path] }];
      const children = Object.keys(disk)
        .filter((name) => name.startsWith(path + "/"))
        .map((name) => name.slice(path.length + 1).split("/")[0]);
      return children.length
        ? [{ path, directories: [...new Set(children)] }]
        : [];
    });
  });
  const push = (libs: Lib[]) =>
    w.updateExtraLibs(
      Object.fromEntries(
        libs.map((lib) => [
          lib.filePath,
          { content: lib.content, version: lib.version },
        ]),
      ),
    );
  const settle = () => resolveProject(files, () => w.scanProject(uri), push);
  const refresh = async () => {
    await files.refresh();
    await push(files.libs());
  };
  return { w, requested, settle, refresh, uri };
}
const codes = (diagnostics: { code: number }[]) =>
  diagnostics.map((d) => d.code);
describe("lazy project loading", () => {
  it("loads configs and imports on demand and never reads unrelated files", async () => {
    const { w, requested, settle, uri } = lazy(
      {
        "tsconfig.base.json":
          '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]},"strict":true}}',
        "tsconfig.json": '{"extends":"./tsconfig.base.json","include":["src"]}',
        "src/main.ts": source,
        "src/lib/value.ts": "export const answer = 42;",
        "src/unrelated.ts": "export const nothing = 1;",
        "big/data.json": "{}",
      },
      "src/main.ts",
    );
    expect(await settle()).toBe(true);
    expect(await w.getSemanticDiagnostics(uri)).toEqual([]);
    expect(requested).toContain("src/lib/value.ts");
    expect(requested).not.toContain("src/unrelated.ts");
    expect(requested).not.toContain("big/data.json");
  });
  it("loads package exports, automatic @types and pnpm links as they are needed", async () => {
    const real = "node_modules/.pnpm/pkg@1/node_modules/pkg/value.d.ts";
    const { w, settle, uri } = lazy(
      {
        "tsconfig.json":
          '{"compilerOptions":{"module":"ESNext","moduleResolution":"Bundler","strict":true},"include":["src"]}',
        "src/main.ts":
          'import { answer } from "pkg/value"; const value: number = answer; const p: Process = {id: 1};',
        "node_modules/pkg/package.json":
          '{"name":"pkg","exports":{"./value":{"types":"./value.d.ts"}}}',
        "node_modules/pkg/value.d.ts": "export declare const answer: number;",
        [real]: "export declare const answer: number;",
        "node_modules/@types/example/index.d.ts":
          "interface Process { id: number }",
      },
      "src/main.ts",
    );
    expect(await settle()).toBe(true);
    expect(await w.getSemanticDiagnostics(uri)).toEqual([]);
  });
  it("follows project references to the config that owns the file", async () => {
    const { w, settle, uri } = lazy(
      {
        "tsconfig.json": '{"files": [], "references": [{"path":"./app"}]}',
        "app/tsconfig.json":
          '{"files": [], "references": [{"path":"./tsconfig.app.json"}]}',
        "app/tsconfig.app.json":
          '{"compilerOptions":{"paths":{"@/*":["./src/*"]},"strict":true},"include":["src"]}',
        "app/src/main.ts": source,
        "app/src/lib/value.ts": "export const answer = 42;",
      },
      "app/src/main.ts",
    );
    expect(await settle()).toBe(true);
    expect(await w.getSemanticDiagnostics(uri)).toEqual([]);
  });
  it("still reports modules that really are missing", async () => {
    const { w, settle, uri } = lazy(
      {
        "tsconfig.json": '{"include":["src"]}',
        "src/main.ts":
          'import { a } from "./nope"; import { b } from "missing-pkg"; a; b;',
      },
      "src/main.ts",
    );
    expect(await settle()).toBe(true);
    expect(codes(await w.getSemanticDiagnostics(uri))).toEqual([2307, 2307]);
  });
  it("finds files that appear after a refresh and ignores unchanged dependencies", async () => {
    const disk: Record<string, string> = {
      "tsconfig.json": '{"include":["src"]}',
      "src/main.ts": 'import { answer } from "./value"; answer;',
      "node_modules/pkg/index.d.ts": "export {};",
    };
    const { w, requested, settle, refresh, uri } = lazy(disk, "src/main.ts");
    await settle();
    expect(codes(await w.getSemanticDiagnostics(uri))).toEqual([2307]);
    disk["src/value.ts"] = "export const answer = 42;";
    requested.length = 0;
    await refresh();
    expect(requested).toEqual(["tsconfig.json"]);
    await settle();
    expect(await w.getSemanticDiagnostics(uri)).toEqual([]);
  });
});
