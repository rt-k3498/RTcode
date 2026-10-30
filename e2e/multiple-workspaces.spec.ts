import { test, expect } from "@playwright/test";

test("multiple roots isolate files, terminals, trust, and replacement", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const host = window as any;
    host.isTauri = true;
    host.calls = [];
    let picks = 0;
    const ws = (id: string) => ({
      id,
      rootId: `${id}-root`,
      name: `${id} project`,
      displayPath: `/projects/${id}`,
      trusted: id !== "beta",
    });
    host.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      transformCallback: () => 1,
      invoke: async (command: string, args: any) => {
        host.calls.push({ command, args });
        switch (command) {
          case "workspace_open_launch_directory":
            return ws("alpha");
          case "workspace_pick_and_open":
            return ++picks === 1 ? ws("beta") : ws("alpha");
          case "tree_read_children":
            return [
              {
                id: `${args.workspaceId}-readme`,
                name: "README.md",
                relativePath: "README.md",
                directory: false,
                symlink: false,
              },
            ];
          case "file_open":
            return {
              id: args.pathId,
              name: "README.md",
              relativePath: "README.md",
              text: `${args.workspaceId} content`,
              revision: "1",
              language: "markdown",
              eol: "LF",
              bom: false,
            };
          case "file_save":
            if (host.failSave) throw Error("Save failed: disk unavailable.");
            return "2";
          case "terminal_create":
            return `${args.workspaceId}-terminal`;
          case "terminal_resize":
          case "terminal_close":
          case "terminal_write":
          case "settings_update":
          case "workspace_set_trust":
          case "workspace_close":
            return;
          case "settings_get":
            return {};
          case "project_snapshot":
            return { files: [], warnings: [] };
          case "plugin:event|listen":
            return 1;
          case "git_snapshot":
            return {
              branch: "main",
              ahead: 0,
              behind: 0,
              local: [],
              remote: [],
              commits: [],
              changes: [],
              worktrees: [
                {
                  path: "/projects/gamma",
                  branch: "gamma",
                  head: "123",
                  current: false,
                  detached: false,
                  bare: false,
                  locked: false,
                  prunable: false,
                  available: true,
                },
              ],
            };
          case "git_open_worktree":
            return ws("gamma");
          default:
            throw Error(`Unexpected call: ${command}`);
        }
      },
    };
  });
  await page.goto("/");
  await page
    .locator('[data-workspace="alpha"]')
    .getByRole("button", { name: /README.md/ })
    .click();
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.getByRole("button", { name: "Start a terminal" }).first().click();
  await expect(page.locator(".terminal-instance")).toHaveCount(1);
  await page.locator(".workspace-control").click();
  await page.getByRole("button", { name: "Add workspace…" }).click();
  await expect(page.locator(".workspace-root")).toHaveCount(2);
  await page
    .locator('[data-workspace="beta"]')
    .getByRole("button", { name: /README.md/ })
    .click();
  await expect(page.getByRole("tab", { name: /README.md/ })).toHaveCount(2);
  await expect(page.locator(".monaco-editor")).toContainText("beta content");
  await page
    .getByRole("tab", { name: /README.md/ })
    .first()
    .click();
  await expect(page.locator(".monaco-editor")).toContainText("alpha content");
  const colors = await page
    .locator(".workspace-root-name")
    .evaluateAll((roots) =>
      roots.map((root) => getComputedStyle(root).borderColor),
    );
  expect(colors[0]).not.toBe(colors[1]);
  const shadows = await page
    .locator(".editor-tab")
    .evaluateAll((tabs) => tabs.map((tab) => getComputedStyle(tab).boxShadow));
  expect(shadows[0]).toContain(colors[0]);
  expect(shadows[1]).toContain(colors[1]);
  await page.screenshot({ path: "test-results/workspace-colors.png" });
  // Selecting an already-open folder must not duplicate it.
  await page.locator(".workspace-control").click();
  await page.getByRole("button", { name: "Add workspace…" }).click();
  await expect(page.locator(".workspace-root")).toHaveCount(2);
  const newTerminal = page
    .getByRole("button", { name: "New terminal", exact: true })
    .first();
  await newTerminal.click();
  const picker = page.getByRole("dialog", {
    name: "Choose terminal workspace",
  });
  await expect(picker).toBeVisible();
  await page.screenshot({ path: "test-results/terminal-workspace-picker.png" });
  await page.keyboard.press("Escape");
  await expect(picker).not.toBeVisible();
  await expect(page.locator(".terminal-instance")).toHaveCount(1);
  await newTerminal.click();
  await picker.getByRole("button", { name: /beta project/ }).click();
  await expect(
    page.getByRole("heading", { name: "Trust this workspace?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Trust this exact folder" }).click();
  await expect(page.locator(".terminal-instance")).toHaveCount(2);
  expect(
    await page.evaluate(() =>
      (window as any).calls
        .filter((c: any) => c.command === "terminal_create")
        .map((c: any) => c.args.workspaceId),
    ),
  ).toEqual(["alpha", "beta"]);
  // A worktree replacement affects only the selected alpha root.
  await page.getByRole("button", { name: "git", exact: true }).click();
  await page.getByRole("button", { name: "Open worktree gamma" }).click();
  await page
    .getByRole("button", { name: "Replace workspace", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Replace workspace", exact: true })
    .click();
  await expect(page.locator(".workspace-control")).toContainText(
    "gamma project",
  );
  await expect(page.locator(".terminal-instance")).toHaveCount(1);
  await expect(page.locator(".terminal-tabs")).toContainText("beta project");
  await expect(page.getByRole("tab", { name: /README.md/ })).toHaveCount(1);
  await expect(page.locator(".monaco-editor")).toContainText("beta content");
  await page.getByRole("button", { name: "files", exact: true }).click();
  await expect(page.locator(".workspace-root")).toHaveCount(2);
  await expect(page.locator('[data-workspace="beta"]')).toBeVisible();
  await expect(page.locator('[data-workspace="gamma"]')).toBeVisible();
  await page.locator(".workspace-control").click();
  await page.screenshot({ path: "test-results/workspace-dropdown.png" });
  const closed = await page.evaluate(() =>
    (window as any).calls
      .filter((c: any) => c.command === "terminal_close")
      .map((c: any) => c.args.terminalId),
  );
  expect(closed).toEqual(["alpha-terminal"]);
  // Removing a clean selected root does not close another root's terminal.
  await page
    .getByRole("button", {
      name: "Remove workspace gamma project",
      exact: true,
    })
    .click();
  await expect(page.locator(".workspace-control")).toContainText(
    "beta project",
  );
  await expect(page.locator(".workspace-root")).toHaveCount(1);
  await expect(page.locator(".terminal-instance")).toHaveCount(1);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.locator(".workspace-control").click();
  await page
    .getByRole("button", { name: "Remove workspace beta project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Remove beta project?" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cancel", exact: true })
    .last()
    .click();
  await expect(page.locator(".workspace-root")).toHaveCount(1);
  await expect(page.locator(".terminal-instance")).toHaveCount(1);
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((url) => new URL(url).pathname === "/src/editor/monaco.ts")!;
    const monaco = await import(url);
    const model = monaco.editor
      .getModels()
      .find((model: any) => model.uri.path === "/beta/README.md");
    model.setValue("Unsaved beta changes");
    (window as any).failSave = true;
  });
  await page.locator(".workspace-control").click();
  await page
    .getByRole("button", { name: "Remove workspace beta project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Save changes before removing workspace?",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save all & remove" }).click();
  await expect(page.getByText("Save failed: disk unavailable.")).toBeVisible();
  await expect(page.locator(".workspace-root")).toHaveCount(1);
  await expect(page.locator(".terminal-instance")).toHaveCount(1);
  await page.evaluate(() => {
    (window as any).failSave = false;
  });
  await page.getByRole("button", { name: "Save all & remove" }).click();
  await expect(page.locator(".workspace-control")).toContainText(
    "NO WORKSPACE",
  );
  await expect(page.locator(".workspace-root")).toHaveCount(0);
  await expect(page.locator(".terminal-instance")).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(0);
  await page.locator(".workspace-control").click();
  await expect(page.getByText("No folders open yet.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add workspace…" }),
  ).toBeVisible();
  const saved = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.command === "file_save").at(-1),
  );
  expect(saved.args.documentId).toBe("beta-readme");
  expect(saved.args.text).toBe("Unsaved beta changes");
});
