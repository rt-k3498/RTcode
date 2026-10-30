import { test, expect } from "@playwright/test";

test("native startup displays the launch folder without opening the picker", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const host = window as any;
    host.isTauri = true;
    host.nativeCalls = [];
    host.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      transformCallback: () => 1,
      invoke: async (command: string, args: any) => {
        host.nativeCalls.push({ command, args });
        switch (command) {
          case "workspace_open_launch_directory":
            return {
              id: "launch-workspace",
              rootId: "launch-root",
              name: "project with spaces",
              displayPath: "/projects/project with spaces",
              trusted: false,
            };
          case "tree_read_children":
            return [
              {
                id: "readme",
                name: "README.md",
                relativePath: "README.md",
                directory: false,
                symlink: false,
              },
            ];
          case "settings_get":
            return {};
          case "project_snapshot":
            return { files: [], warnings: [] };
          case "plugin:event|listen":
            return 1;
          case "workspace_pick_and_open":
            return null;
          default:
            throw new Error(`Unexpected native call: ${command}`);
        }
      },
    };
  });
  await page.goto("/");
  await expect(page.locator(".workspace-control")).toContainText(
    "project with spaces",
  );
  await expect(page.getByRole("button", { name: /README.md/ })).toBeVisible();
  await expect(page.locator(".preview-badge")).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).nativeCalls);
  expect(calls).toContainEqual({
    command: "tree_read_children",
    args: { workspaceId: "launch-workspace", pathId: "launch-root" },
  });
  expect(
    calls.some((call: any) => call.command === "workspace_pick_and_open"),
  ).toBe(false);
  await page.locator(".workspace-control").click();
  await page.getByRole("button", { name: "Add workspace…" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).nativeCalls.some(
          (call: any) => call.command === "workspace_pick_and_open",
        ),
      ),
    )
    .toBe(true);
});
