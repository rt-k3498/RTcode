import { test, expect } from "@playwright/test";

test("refresh files reloads expanded nested directories", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('.tree-row[title="src/main.ts"]')).toBeVisible();
  await page.evaluate(async () => {
    const { api } = await import("/src/ipc/client.ts");
    const original = api.tree;
    api.tree = async (workspace: string, path: string) => {
      const entries = await original(workspace, path);
      return path === "src"
        ? [
            ...entries,
            {
              id: "src/new.ts",
              name: "new.ts",
              relativePath: "src/new.ts",
              directory: false,
              symlink: false,
            },
          ]
        : entries;
    };
  });
  await page.getByRole("button", { name: "Refresh files" }).click();
  await expect(page.locator('.tree-row[title="src/new.ts"]')).toBeVisible();
});

test("settings contain keyboard focus and do not close editor tabs", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.evaluate(async () => {
    const { api } = await import("/src/ipc/client.ts");
    api.set = async () => {
      throw Error("Could not persist preferences.");
    };
  });
  await page.getByRole("button", { name: "Open Settings and Guide" }).click();
  const settings = page.getByRole("dialog", { name: "Settings and Guide" });
  await settings.getByRole("button", { name: "Editor", exact: true }).click();
  await settings.getByRole("switch", { name: "Word wrap" }).click();
  await expect(settings.getByRole("status")).toContainText(
    "Could not persist preferences.",
  );
  await settings.getByRole("button", { name: "Dismiss notification" }).click();
  await page.setViewportSize({ width: 820, height: 560 });
  await page.screenshot({ path: "test-results/settings-keyboard.png" });
  const input = settings.getByRole("spinbutton", { name: "Editor font size" });
  await input.focus();
  await page.keyboard.press("Tab");
  expect(
    await settings.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Control+w");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Open Settings and Guide" }),
  ).toBeFocused();
});

test("an older Git refresh cannot overwrite a newer result", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { api } = await import("/src/ipc/client.ts");
    const original = api.git;
    (window as any).gitReads = [];
    api.git = (workspace: string) =>
      new Promise((resolve) => {
        (window as any).gitReads.push(async (branch: string) =>
          resolve({ ...(await original(workspace)), branch }),
        );
      });
  });
  await page.getByRole("button", { name: "git", exact: true }).click();
  await page.getByRole("button", { name: "files", exact: true }).click();
  await page.getByRole("button", { name: "git", exact: true }).click();
  await page.waitForFunction(() => (window as any).gitReads.length === 2);
  await page.evaluate(() => (window as any).gitReads[1]("newer"));
  await expect(page.locator(".toolbar-branch")).toContainText("newer");
  await page.evaluate(() => (window as any).gitReads[0]("older"));
  await expect(page.locator(".toolbar-branch")).toContainText("newer");
});

test("late folder reads preserve other expansions and user collapses", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((url) => new URL(url).pathname === "/src/ipc/client.ts")!;
    const { api } = await import(url);
    const original = api.tree;
    const host = window as any;
    host.finishTree = {};
    api.tree = (workspace: string, path: string) =>
      new Promise((resolve) => {
        host.finishTree[path] = async () =>
          resolve(await original(workspace, path));
      });
  });
  const src = page.locator('.tree-row[title="src"]');
  const tests = page.locator('.tree-row[title="tests"]');
  await src.click(); // Collapse the initially open sample folder.
  await src.click();
  await tests.click();
  await page.evaluate(() => (window as any).finishTree.tests());
  await expect(
    page.locator('.tree-row[title="tests/workspace.test.ts"]'),
  ).toBeVisible();
  await src.click(); // Collapse while the read is still pending.
  await page.evaluate(() => (window as any).finishTree.src());
  await expect(page.locator('.tree-row[title="src/main.ts"]')).toHaveCount(0);
  await expect(
    page.locator('.tree-row[title="tests/workspace.test.ts"]'),
  ).toBeVisible();
});

test("adding a workspace preserves existing terminal sessions", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const host = window as any;
    host.isTauri = true;
    host.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      transformCallback: () => 1,
      invoke: async (command: string) => {
        switch (command) {
          case "workspace_open_launch_directory":
            return {
              id: "original",
              rootId: "root",
              name: "original",
              displayPath: "/original",
              trusted: true,
            };
          case "tree_read_children":
            return [];
          case "settings_get":
            return {};
          case "settings_update":
            return;
          case "project_read":
            return [];
          case "plugin:event|listen":
            return 1;
          default:
            throw Error(`Unexpected call: ${command}`);
        }
      },
    };
  });
  await page.goto("/");
  await expect(page.locator(".workspace-control")).toContainText("original");
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((url) => new URL(url).pathname === "/src/ipc/client.ts")!;
    const { api } = await import(url);
    api.terminal = async (
      _workspace: string,
      _alias: string,
      callback: unknown,
    ) => {
      (window as any).terminalEvent = callback;
      return "terminal-one";
    };
    api.resize = async () => {};
    api.close = async () => {
      throw Error("PTY process cleanup failed.");
    };
    api.openWorkspace = async () => ({
      id: "next",
      rootId: "next-root",
      name: "next project",
      displayPath: "/next",
      trusted: false,
    });
  });
  await page.getByRole("button", { name: "Start a terminal" }).first().click();
  await expect(page.locator(".terminal-instance")).toHaveCount(1);
  await page.locator(".workspace-control").click();
  await page.getByRole("button", { name: "Add workspace…" }).click();
  await expect(page.locator(".workspace-control")).toContainText(
    "next project",
  );
  await expect(page.locator(".terminal-instance")).toHaveCount(1);
  await expect(page.locator(".terminal-tabs")).toHaveCount(1);
  await page.evaluate(() => (window as any).terminalEvent({ exitCode: 0 }));
  await expect(page.locator(".terminal-tabs")).toHaveCount(1);
  await expect(page.locator(".terminal-tabs")).toContainText("original");
});
