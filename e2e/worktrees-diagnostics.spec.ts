import { test, expect, type Page } from "@playwright/test";

async function worktrees(page: Page, dirty = true) {
  await page.goto("/");
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.evaluate(async (dirty) => {
    const resource = (path: string) =>
      performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((url) => new URL(url).pathname === path)!;
    const { api } = await import(resource("/src/ipc/client.ts"));
    const monaco = await import(resource("/src/editor/monaco.ts"));
    const host = window as any;
    host.switchCalls = [];
    host.savedFiles = [];
    const save = api.save;
    api.save = async (id: string, revision: string, text: string) => {
      if (host.failSave) throw Error("Save failed: file changed on disk.");
      host.savedFiles.push({ id, text });
      return save(id, revision, text);
    };
    api.git = async (workspaceId: string) => ({
      branch: workspaceId === "review" ? "review" : "main",
      ahead: 0,
      behind: 0,
      local: ["main", "review"],
      remote: [],
      commits: [],
      changes: [],
      worktrees: [
        {
          path: "/projects/main",
          branch: "main",
          head: "123456789",
          current: workspaceId !== "review",
          detached: false,
          bare: false,
          locked: false,
          prunable: false,
          available: true,
        },
        {
          path: "/projects/review tree",
          branch: "review",
          head: "123456789",
          current: workspaceId === "review",
          detached: false,
          bare: false,
          locked: false,
          prunable: false,
          available: true,
        },
        {
          path: "/missing/tree",
          branch: "missing",
          head: "123456789",
          current: false,
          detached: false,
          bare: false,
          locked: false,
          prunable: true,
          available: false,
        },
      ],
    });
    api.openWorktree = async (workspaceId: string, path: string) => {
      host.switchCalls.push({ workspaceId, path });
      if (host.failSwitch) throw Error("This worktree is no longer available.");
      return {
        id: "review",
        rootId: "review-root",
        name: "review tree",
        displayPath: path,
        trusted: false,
      };
    };
    if (dirty)
      for (const model of monaco.editor.getModels()) {
        if (
          model.uri.path.endsWith("/src/main.ts") ||
          model.uri.path.endsWith("/README.md")
        )
          model.setValue(model.getValue() + "\n// unsaved edit\n");
      }
  }, dirty);
  await page.getByRole("button", { name: "git", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open worktree review", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Current worktree main", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Open worktree missing", exact: true }),
  ).toBeDisabled();
}

test("adding a worktree preserves dirty files and colors their tabs by workspace", async ({
  page,
}) => {
  await worktrees(page);
  await page
    .getByRole("button", { name: "Open worktree review", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }).last(),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => (window as any).switchCalls)).toEqual([]);
  await page
    .getByRole("button", { name: "Open worktree review", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Add workspace", exact: true })
    .click();
  await expect(page.locator(".workspace-control")).toContainText("review tree");
  await expect(page.getByRole("tab", { name: /TS main.ts/ })).toBeVisible();
  await expect(
    page
      .locator(".editor-tab")
      .filter({ hasText: "main.ts" })
      .locator(".dirty-dot"),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).savedFiles)).toEqual([]);
  await page.getByRole("button", { name: "files", exact: true }).click();
  await expect(page.locator(".workspace-root")).toHaveCount(2);
  const colors = await page
    .locator(".workspace-root-name")
    .evaluateAll((roots) =>
      roots.map((root) => getComputedStyle(root).borderColor),
    );
  expect(colors[0]).not.toBe(colors[1]);
  await expect(page.locator(".editor-tab").first()).toHaveCSS(
    "box-shadow",
    new RegExp(colors[0].replace(/[()]/g, "\\$&")),
  );
  await page.screenshot({ path: "test-results/multiple-workspaces.png" });
});

test("replacing a worktree saves inactive dirty tabs and replaces only that root", async ({
  page,
}) => {
  await worktrees(page);
  await page
    .getByRole("button", { name: "Open worktree review", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Replace workspace", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save all & replace", exact: true })
    .click();
  await expect(page.locator(".workspace-control")).toContainText("review tree");
  const saved = await page.evaluate(() => (window as any).savedFiles);
  expect(saved.map((file: any) => file.id).sort()).toEqual([
    "README.md",
    "src/main.ts",
  ]);
  expect(
    saved.every((file: any) => file.text.includes("// unsaved edit")),
  ).toBe(true);
  await expect(page.getByRole("tab", { name: /TS main.ts/ })).toHaveCount(0);
});

test("save or destination errors preserve the original workspace and buffers", async ({
  page,
}) => {
  await worktrees(page);
  await page.evaluate(() => {
    (window as any).failSave = true;
  });
  await page
    .getByRole("button", { name: "Open worktree review", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Replace workspace", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save all & replace", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
    "Save failed: file changed on disk.",
  );
  expect(await page.evaluate(() => (window as any).switchCalls.length)).toBe(0);
  await page.evaluate(() => {
    (window as any).failSwitch = true;
  });
  await page
    .getByRole("button", { name: "Don’t save & replace", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
    "This worktree is no longer available.",
  );
  await expect(page.getByRole("tab", { name: /TS main.ts/ })).toBeVisible();
  await expect(page.locator(".workspace-control")).toContainText(
    "rtcode-sample",
  );
});

test("errors are red and hints and warnings are yellow in the editor and Problems", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((url) => new URL(url).pathname === "/src/editor/monaco.ts")!;
    const monaco = await import(url);
    const model = monaco.editor
      .getModels()
      .find((model: any) => model.uri.path.endsWith("/src/main.ts"));
    monaco.editor.setModelMarkers(model, "color-test", [
      {
        severity: monaco.MarkerSeverity.Error,
        message: "Example error",
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 7,
      },
      {
        severity: monaco.MarkerSeverity.Hint,
        message: "Example hint",
        startLineNumber: 2,
        startColumn: 1,
        endLineNumber: 2,
        endColumn: 7,
      },
      {
        severity: monaco.MarkerSeverity.Warning,
        message: "Example warning",
        startLineNumber: 3,
        startColumn: 1,
        endLineNumber: 3,
        endColumn: 7,
      },
    ]);
  });
  await page
    .getByRole("button", { name: "Toggle Problems", exact: true })
    .click();
  for (const [message, color] of [
    ["Example error", "rgb(255, 100, 100)"],
    ["Example hint", "rgb(242, 207, 102)"],
    ["Example warning", "rgb(242, 207, 102)"],
  ]) {
    const row = page.locator(".problem-row").filter({ hasText: message });
    await expect(row.locator(".problem-message")).toHaveCSS("color", color);
    await expect(row.locator(".problem-severity")).toHaveCSS("color", color);
  }
  await expect(
    page.locator(".monaco-editor .squiggly-error").first(),
  ).toHaveCSS("background-image", /ff6464/i);
  await expect(
    page.locator(".monaco-editor .squiggly-warning").first(),
  ).toHaveCSS("background-image", /f2cf66/i);
  await page.screenshot({ path: "test-results/diagnostic-colors.png" });
});
