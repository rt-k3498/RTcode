import { test, expect } from "@playwright/test";

test("native project aliases resolve unopened files and Go to Definition opens them", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const host = window as any;
    host.isTauri = true;
    const files: Record<string, string> = {
      "tsconfig.base.json":
        '{"compilerOptions":{"strict":true,"module":"ESNext","moduleResolution":"Bundler"}}',
      "apps/web/tsconfig.json":
        '{"extends":"../../tsconfig.base.json","compilerOptions":{"paths":{"@/*":["./src/*"]}},"include":["src"]}',
      "apps/web/src/main.ts":
        'import { answer } from "@/lib/value";\nconst result: number = answer;\n',
      "apps/web/src/lib/value.ts": "export const answer = 42;\n",
      "apps/web/src/unrelated.ts": "export const nothing = 1;\n",
    };
    host.__reads = [] as string[];
    host.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      transformCallback: () => 1,
      invoke: async (command: string, args: any) => {
        switch (command) {
          case "workspace_open_launch_directory":
            return {
              id: "project",
              rootId: "root",
              name: "monorepo",
              displayPath: "/monorepo",
              trusted: false,
            };
          case "settings_get":
            return {};
          case "workspace_pick_and_open":
            return {
              id: "other",
              rootId: "other-root",
              name: "other project",
              displayPath: "/other",
              trusted: false,
            };
          case "project_read":
            host.__reads.push(...args.paths);
            return args.paths.flatMap((path: string) => {
              if (path in files)
                return [{ path, pathId: path, content: files[path] }];
              const dirs = Object.keys(files)
                .filter((name) => name.startsWith(path + "/"))
                .map((name) => name.slice(path.length + 1).split("/")[0]);
              return dirs.length
                ? [{ path, directories: [...new Set(dirs)] }]
                : [];
            });
          case "tree_read_children":
            if (args.workspaceId === "other") return [];
            return [
              {
                id: "apps/web/src/main.ts",
                name: "main.ts",
                relativePath: "apps/web/src/main.ts",
                directory: false,
                symlink: false,
              },
            ];
          case "file_open":
            if (args.workspaceId !== "project")
              throw Error("Path belongs to another workspace.");
            return {
              id: args.pathId,
              name: args.pathId.split("/").pop(),
              relativePath: args.pathId,
              text: files[args.pathId],
              revision: "v1",
              language: "typescript",
              eol: "LF",
              bom: false,
            };
          case "plugin:event|listen":
            return 1;
          default:
            throw Error(`Unexpected call: ${command}`);
        }
      },
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "TS main.ts", exact: true }).click();
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await expect(page.locator(".statusbar")).toContainText("PROJECT");
  // Only the files the language service asked for were read.
  expect(await page.evaluate(() => (window as any).__reads)).not.toContain(
    "apps/web/src/unrelated.ts",
  );
  // Monaco loads its TypeScript service after the editor becomes visible.
  await expect(async () => {
    const diagnostics = await page.evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((url) => new URL(url).pathname === "/src/editor/monaco.ts")!;
      const monaco = await import(url);
      const model = monaco.editor
        .getModels()
        .find((model: any) => model.uri.path.endsWith("/src/main.ts"));
      const worker = await (
        await monaco.typescript.getTypeScriptWorker()
      )(model.uri);
      return worker.getSemanticDiagnostics(model.uri.toString());
    });
    expect(diagnostics).toEqual([]);
  }).toPass({ timeout: 10000 });
  // The selected sidebar root can differ from the active editor's root.
  await page.getByRole("button", { name: "Workspaces", exact: true }).click();
  await page.getByRole("button", { name: "Add workspace…" }).click();
  await expect(page.locator(".workspace-control")).toContainText(
    "other project",
  );
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((url) => new URL(url).pathname === "/src/editor/monaco.ts")!;
    const monaco = await import(url);
    const editor = monaco.editor.getEditors()[0];
    editor.setPosition({ lineNumber: 1, column: 11 });
    editor.trigger("test", "editor.action.revealDefinition", {});
  });
  await expect(
    page.getByRole("tab", { name: "TS value.ts", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".view-lines")).toContainText(
    "export const answer = 42",
  );
});
