import { test, expect } from "@playwright/test";

test("include and exclude filter while typing without saves or indexing", async ({
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
    for (const method of ["save", "set", "project"]) {
      api[method] = async () => {
        host.unexpectedFilterCalls.push(method);
        throw Error(`Filters must not call ${method}`);
      };
    }
  });
  await page.getByRole("button", { name: "search", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search workspace", exact: true })
    .fill("createWorkspace");
  const include = page.getByLabel("INCLUDE", { exact: true });
  const exclude = page.getByLabel("EXCLUDE", { exact: true });
  await include.pressSequentially("src/main.ts");
  await expect(page.locator(".search-result")).toHaveCount(2);
  await exclude.pressSequentially("src/main.ts");
  await expect(page.locator(".search-result")).toHaveCount(0);
  await expect(exclude).toHaveValue("src/main.ts");
  await exclude.fill("");
  await expect(page.locator(".search-result")).toHaveCount(2);
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
  await expect(page.locator(".inline-error")).toBeVisible();
});
