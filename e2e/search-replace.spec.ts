import { test, expect, type Page } from "@playwright/test";

const runSearch = (page: Page) => page.locator(".search-run").click();

test("search runs only when asked and filters never save or index", async ({
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
    const host = window as any;
    host.unexpectedFilterCalls = [];
    host.searchCalls = 0;
    for (const method of ["save", "set", "projectRead"]) {
      api[method] = async () => {
        host.unexpectedFilterCalls.push(method);
        throw Error(`Filters must not call ${method}`);
      };
    }
    const search = api.search;
    api.search = (...args: unknown[]) => {
      host.searchCalls++;
      return search(...args);
    };
  });
  const calls = () => page.evaluate(() => (window as any).searchCalls);
  await page.getByRole("button", { name: "search", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search workspace", exact: true })
    .fill("createWorkspace");
  const include = page.getByLabel("INCLUDE", { exact: true });
  const exclude = page.getByLabel("EXCLUDE", { exact: true });
  await include.pressSequentially("src/main.ts");
  // Typing alone never searches.
  await page.waitForTimeout(400);
  await expect(page.locator(".search-result")).toHaveCount(0);
  expect(await calls()).toBe(0);
  await runSearch(page);
  await expect(page.locator(".search-result")).toHaveCount(2);
  expect(await calls()).toBe(1);
  // Edits mark the results stale instead of searching again.
  await exclude.pressSequentially("src/main.ts");
  await expect(page.locator(".search-state")).toHaveText("STALE");
  await expect(page.locator(".search-result")).toHaveCount(2);
  expect(await calls()).toBe(1);
  await runSearch(page);
  await expect(page.locator(".search-result")).toHaveCount(0);
  await expect(exclude).toHaveValue("src/main.ts");
  await exclude.fill("");
  await exclude.press("Enter");
  await expect(page.locator(".search-result")).toHaveCount(2);
  expect(await calls()).toBe(3);
  for (const input of [include, exclude]) {
    await expect(input).toHaveCSS("text-transform", "none");
    await expect(input).toHaveAttribute("autocomplete", "off");
  }
  expect(
    await page.evaluate(() => (window as any).unexpectedFilterCalls),
  ).toEqual([]);
});

test("search displays all results beyond the old cap and preserves filter case", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((url) => new URL(url).pathname === "/src/ipc/demo.ts")!;
    const { demoSave } = await import(url);
    demoSave("README.md", "unlimitedneedle\n".repeat(2101));
  });
  await page.getByRole("button", { name: "search", exact: true }).click();
  for (const label of ["INCLUDE", "EXCLUDE"]) {
    const input = page.getByLabel(label, { exact: true });
    await expect(input).toHaveAttribute("autocapitalize", "off");
    await expect(input).toHaveAttribute("autocorrect", "off");
    await expect(input).toHaveAttribute("spellcheck", "false");
  }
  await page.getByLabel("INCLUDE", { exact: true }).fill("*.md");
  await expect(page.getByLabel("INCLUDE", { exact: true })).toHaveValue("*.md");
  await page
    .getByRole("textbox", { name: "Search workspace", exact: true })
    .fill("unlimitedneedle");
  await runSearch(page);
  await expect(page.locator(".search-result")).toHaveCount(2101);
  await page.getByRole("button", { name: "Toggle replace" }).click();
  await expect(
    page.getByRole("button", { name: "Replace all (2101)", exact: true }),
  ).toBeEnabled();
});

test("search glob filters and replace all update open buffers", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.getByRole("button", { name: "search", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search workspace", exact: true })
    .fill("createWorkspace");
  await page
    .getByLabel("INCLUDE", { exact: true })
    .fill("src/**/*.{ts,tsx}, tests/**");
  await page
    .getByLabel("EXCLUDE", { exact: true })
    .fill("**/workspace.ts, tests/**");
  await runSearch(page);
  await expect(page.locator(".search-result")).toHaveCount(2);
  await page.getByRole("button", { name: "Toggle replace" }).click();
  await page
    .getByRole("textbox", { name: "Replace with", exact: true })
    .fill("buildWorkspace");
  await page
    .getByRole("button", { name: "Replace all (2)", exact: true })
    .click();
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(page.locator(".search-result")).toHaveCount(0);
  await expect(page.locator(".view-lines")).toContainText("buildWorkspace");
  await page
    .getByRole("textbox", { name: "Search workspace", exact: true })
    .fill("buildWorkspace");
  await runSearch(page);
  await expect(page.locator(".search-result")).toHaveCount(2);
  await page
    .getByRole("textbox", { name: "Replace with", exact: true })
    .fill("oneWorkspace");
  await page
    .getByRole("button", { name: /Replace match in src\/main.ts/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(page.locator(".search-result")).toHaveCount(1);
  await page.screenshot({ path: "test-results/search-replace.png" });
});

test("replacement preserves unsaved edits and invalid patterns are visible", async ({
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
    model.setValue(model.getValue() + "\n// unsaved work\n");
  });
  await page.getByRole("button", { name: "search", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search workspace", exact: true })
    .fill("createWorkspace");
  await page.getByLabel("INCLUDE", { exact: true }).fill("src/main.ts");
  await runSearch(page);
  await expect(page.locator(".search-result")).toHaveCount(2);
  await page.getByRole("button", { name: "Toggle replace" }).click();
  await page
    .getByRole("button", { name: "Replace all (2)", exact: true })
    .click();
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(
    page.getByText("Save or close modified matching files before replacing."),
  ).toBeVisible();
  await expect(page.locator(".search-result")).toHaveCount(2);
  await page.getByRole("button", { name: ".*", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search workspace", exact: true })
    .fill("[");
  await runSearch(page);
  await expect(page.locator(".inline-error")).toBeVisible();
});

test("file search mode finds files by name and hides filter-only controls", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.getByRole("button", { name: "search", exact: true }).click();
  const include = page.getByLabel("INCLUDE", { exact: true });
  const replaceToggle = page.getByRole("button", { name: "Toggle replace" });
  await expect(include).toBeVisible();
  await expect(replaceToggle).toBeVisible();
  await page.getByRole("button", { name: "Switch to file search" }).click();
  await expect(include).toHaveCount(0);
  await expect(page.getByLabel("EXCLUDE", { exact: true })).toHaveCount(0);
  await expect(replaceToggle).toHaveCount(0);
  const input = page.getByRole("textbox", {
    name: "Search files",
    exact: true,
  });
  await input.fill("work");
  await page.waitForTimeout(400);
  await expect(page.locator(".file-result")).toHaveCount(0);
  await input.press("Enter");
  const results = page.locator(".file-result");
  await expect(results.first()).toContainText("workspace.ts");
  await expect(page.locator(".section-bar").first()).toContainText("FILES");
  await results.first().click();
  await expect(
    page.locator("[role=tab][aria-selected=true]").first(),
  ).toContainText("workspace.ts");
  await page.getByRole("button", { name: "Switch to content filter" }).click();
  await expect(page.locator(".file-result")).toHaveCount(0);
  await expect(include).toBeVisible();
  await expect(replaceToggle).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Search workspace", exact: true }),
  ).toHaveValue("work");
});

test("Escape is consumed so the native window keeps full screen", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".monaco-editor")).toBeVisible();
  const consumed = await page.evaluate(() => {
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    return !document.body.dispatchEvent(event);
  });
  expect(consumed).toBe(true);
});
