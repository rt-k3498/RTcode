import { test, expect } from "@playwright/test";
test("workbench, guide, commands, search, editing, and responsive layouts", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await expect(page.getByRole("tab", { name: "TS main.ts" })).toBeVisible();
  await page.screenshot({ path: "test-results/workbench.png" });
  await page.getByRole("button", { name: "Open Settings and Guide" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome to RTcode" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Search the guide" })
    .fill("host-key");
  await expect(page.locator(".guide-result")).not.toHaveCount(0);
  await page
    .locator(".guide-result")
    .filter({ hasText: "SSH connections" })
    .click();
  await expect(
    page.getByRole("heading", { name: "SSH connections", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Open Settings and Guide" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome to RTcode" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/guide.png" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "search", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search workspace" })
    .fill("createWorkspace");
  await page.locator(".search-run").click();
  await expect(page.locator(".search-result").first()).toBeVisible();
  await page.locator(".search-result").first().click();
  await page
    .getByRole("button", { name: "Bottom terminal", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Right terminal", exact: true })
    .click();
  await expect(page.locator(".workbench")).toHaveClass(
    /terminal-bottom-layout/,
  );
  await page.screenshot({ path: "test-results/terminal-bottom.png" });
  await page.getByRole("button", { name: "Hide all terminals" }).click();
  await expect(page.locator(".terminal-slot:visible")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Right terminal", exact: true })
    .click();
  await page.getByTitle("Command palette").click();
  await page.getByRole("textbox", { name: "Search commands" }).fill("sidebar");
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await expect(page.locator(".workbench")).toHaveClass(/sidebar-collapsed/);
  await page.setViewportSize({ width: 820, height: 560 });
  await page.screenshot({ path: "test-results/narrow.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    820,
  );
  expect(errors).toEqual([]);
});
test("dirty buffers survive Guide route and cancel-close", async ({ page }) => {
  await page.goto("/");
  const input = page.locator(".monaco-editor textarea").first();
  await expect(input).toBeVisible();
  await input.focus();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+End" : "Control+End",
  );
  await page.keyboard.type("// unsaved-buffer-check");
  await expect(page.locator(".save-state")).toContainText("MODIFIED");
  await page.getByRole("button", { name: "Open Settings and Guide" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".save-state")).toContainText("MODIFIED");
  await page
    .getByRole("button", { name: "Close main.ts", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cancel", exact: true })
    .last()
    .click();
  await expect(page.locator(".save-state")).toContainText("MODIFIED");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(page.locator(".save-state")).toContainText("CLEAN");
});

test("edits made during save remain dirty and undo returns to the saved version", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.locator(".monaco-editor textarea").first();
  await expect(input).toBeVisible();
  await page.evaluate(async () => {
    // Delay the actual bridge response to exercise the native IPC race.
    const { api } = await import(
      performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((url) => new URL(url).pathname === "/src/ipc/client.ts") ||
        "/src/ipc/client.ts"
    );
    const original = api.save;
    api.save = async (...args: unknown[]) => {
      const result = await original(...args);
      await new Promise<void>((resolve) => {
        (window as any).releaseSave = resolve;
      });
      return result;
    };
  });
  await input.focus();
  await page.keyboard.type("// saved version\n");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await page.waitForFunction(
    () => typeof (window as any).releaseSave === "function",
  );
  await input.focus();
  await page.keyboard.insertText("// newer unsaved version");
  await page.evaluate(() => (window as any).releaseSave());
  await expect(page.locator(".save-state")).toContainText("MODIFIED");
  // Undo granularity is owned by Monaco; walk back to the save boundary.
  for (let i = 0; i < 10; i++) {
    const restored = await page.evaluate(async () => {
      const m = await import(
        performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .find((url) => new URL(url).pathname === "/src/editor/monaco.ts") ||
          "/src/editor/monaco.ts"
      );
      const d = await import(
        performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .find((url) => new URL(url).pathname === "/src/ipc/demo.ts") ||
          "/src/ipc/demo.ts"
      );
      const model = m.editor.getModels()[0];
      await model.undo();
      return model.getValue() === d.demoOpen("src/main.ts").text;
    });
    if (restored) break;
  }
  await expect(page.locator(".save-state")).toContainText("CLEAN");
});

test("editor preferences apply after asynchronous editor initialization", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.getByRole("button", { name: "Open Settings and Guide" }).click();
  await page.getByRole("button", { name: "Editor", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Editor font size" }).fill("22");
  await page.getByRole("spinbutton", { name: "Editor font size" }).press("Tab");
  await page.keyboard.press("Escape");
  await expect(page.locator(".monaco-editor .view-lines").first()).toHaveCSS(
    "font-size",
    "22px",
  );
});

test("right and bottom terminals can coexist and hide without reconstruction", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle("RTcode");
  const right = page.getByRole("button", {
    name: "Right terminal",
    exact: true,
  });
  const bottom = page.getByRole("button", {
    name: "Bottom terminal",
    exact: true,
  });
  await expect(right).toHaveAttribute("aria-pressed", "true");
  await expect(bottom).toHaveAttribute("aria-pressed", "false");
  await bottom.click();
  await expect(page.locator(".terminal-slot:visible")).toHaveCount(2);
  await page
    .locator(".terminal-pane")
    .evaluateAll((panes) =>
      panes.forEach((pane) => pane.setAttribute("data-preserved", "yes")),
    );
  const editor = await page.locator(".editor-pane").boundingBox();
  const rightBox = await page.locator(".terminal-right-slot").boundingBox();
  const bottomBox = await page.locator(".terminal-bottom-slot").boundingBox();
  expect(rightBox!.x).toBeGreaterThanOrEqual(editor!.x + editor!.width);
  expect(bottomBox!.y).toBeGreaterThanOrEqual(editor!.y + editor!.height);
  await page.screenshot({ path: "test-results/dual-terminals.png" });
  await page
    .locator(".terminal-bottom-slot")
    .getByRole("button", { name: "Hide terminal", exact: true })
    .click();
  await expect(page.locator(".terminal-slot:visible")).toHaveCount(0);
  await expect(right).toHaveAttribute("aria-pressed", "false");
  await expect(bottom).toHaveAttribute("aria-pressed", "false");
  await right.click();
  await bottom.click();
  await expect(
    page.locator('.terminal-pane[data-preserved="yes"]'),
  ).toHaveCount(2);
  await page.setViewportSize({ width: 820, height: 560 });
  await expect(page.locator(".terminal-slot:visible")).toHaveCount(2);
  const narrowRight = await page.locator(".terminal-right-slot").boundingBox();
  const narrowBottom = await page
    .locator(".terminal-bottom-slot")
    .boundingBox();
  expect(narrowRight!.x).toBeGreaterThanOrEqual(
    narrowBottom!.x + narrowBottom!.width,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    820,
  );
  await page.screenshot({ path: "test-results/dual-terminals-narrow.png" });
  await page.getByRole("button", { name: "Hide all terminals" }).click();
  await expect(page.locator(".terminal-slot:visible")).toHaveCount(0);
});

test("Git sections start collapsed; filenames open files and eyes open corresponding diffs", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.evaluate(async () => {
    const { api } = await import(
      performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((url) => new URL(url).pathname === "/src/ipc/client.ts") ||
        "/src/ipc/client.ts"
    );
    api.git = async () => ({
      branch: "main",
      ahead: 0,
      behind: 0,
      local: ["main"],
      remote: ["origin/main"],
      commits: [{ hash: "1234567890", message: "Test commit" }],
      changes: [
        {
          pathId: "src/workspace.ts",
          path: "src/workspace.ts",
          staged: false,
          status: "M",
          conflict: false,
        },
        {
          pathId: "README.md",
          path: "README.md",
          staged: true,
          status: "M",
          conflict: false,
        },
      ],
    });
    api.diff = async (_workspace: string, path: string, staged: boolean) =>
      `+${staged ? "staged" : "unstaged"} ${path}`;
  });
  await page.getByRole("button", { name: "git", exact: true }).click();
  const sections = page.locator(".git-section");
  await expect(sections).toHaveCount(5);
  await expect(page.locator(".git-section[open]")).toHaveCount(0);
  const changes = sections.filter({
    has: page.locator("summary", { hasText: /^CHANGES/ }),
  });
  await changes.locator("summary").click();
  await changes
    .getByRole("button", { name: "src/workspace.ts", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "TS workspace.ts", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".editor-breadcrumb")).toContainText("UTF-8");
  await changes
    .getByRole("button", { name: "View unstaged changes for src/workspace.ts" })
    .click();
  await expect(page.locator(".editor-breadcrumb")).toContainText("Git diff");
  await expect(page.locator(".view-lines")).toContainText(
    "+unstaged src/workspace.ts",
  );
  const staged = sections.filter({
    has: page.locator("summary", { hasText: "STAGED CHANGES" }),
  });
  await staged.locator("summary").focus();
  await page.keyboard.press("Enter");
  await staged.getByRole("button", { name: "README.md", exact: true }).click();
  await expect(page.locator(".editor-breadcrumb")).toContainText("UTF-8");
  await staged
    .getByRole("button", { name: "View staged changes for README.md" })
    .click();
  await expect(page.locator(".view-lines")).toContainText("+staged README.md");
  await staged.locator("summary").focus();
  await page.keyboard.press("Space");
  await expect(staged).not.toHaveAttribute("open");
  await page.screenshot({ path: "test-results/git-sections.png" });
});

test("R_> logo and custom colors update live and reset to orange and teal", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle("RTcode");
  await expect(page.locator(".logo")).toHaveText("R_>");
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((url) => new URL(url).pathname === "/src/ipc/client.ts")!;
    const { api } = await import(url);
    api.set = async (key: string, value: unknown) => {
      if (key === "preferences") (window as any).savedPreferences = value;
    };
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  for (const [label, value] of [
    ["Primary accent color", "#c177ff"],
    ["Secondary accent color", "#44bbdd"],
    ["Background color", "#141020"],
  ]) {
    await page.getByLabel(label, { exact: true }).evaluate((input, value) => {
      (input as HTMLInputElement).value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  }
  await expect(page.locator(".logo span").nth(2)).toHaveCSS(
    "color",
    "rgb(193, 119, 255)",
  );
  await expect(page.locator(".logo span").nth(1)).toHaveCSS(
    "color",
    "rgb(68, 187, 221)",
  );
  expect(
    await page.evaluate(() => (window as any).savedPreferences.colors.accent),
  ).toBe("#c177ff");
  await page.screenshot({ path: "test-results/custom-colors.png" });
  await page.keyboard.press("Escape");
  await expect(page.locator(".monaco-editor-background").first()).toHaveCSS(
    "background-color",
    "rgb(20, 16, 32)",
  );
  await expect(page.locator(".terminal-slot:visible")).toHaveCSS(
    "background-color",
    "rgb(20, 16, 32)",
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Reset colors to orange & teal" })
    .click();
  await expect(
    page.getByLabel("Primary accent color", { exact: true }),
  ).toHaveValue("#faa968");
  await expect(
    page.getByLabel("Secondary accent color", { exact: true }),
  ).toHaveValue("#5db7a5");
  await page.keyboard.press("Escape");
  await expect(page.locator(".monaco-editor-background").first()).toHaveCSS(
    "background-color",
    "rgb(11, 15, 20)",
  );
});

test("TypeScript provides real diagnostics, completion, hover, and clears fixed errors", async ({
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
    model.setValue('const answer: number = "wrong";\nanswer.toFixed();\n');
  });
  await page
    .getByRole("button", { name: "Toggle Problems", exact: true })
    .click();
  await expect(
    page
      .locator(".problem-row")
      .filter({ hasText: "not assignable to type 'number'" }),
  ).toBeVisible({ timeout: 20000 });
  const features = await page.evaluate(async () => {
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
    const completions = await worker.getCompletionsAtPosition(
      model.uri.toString(),
      model.getValue().indexOf("answer.toFixed") + "answer.".length,
    );
    const hover = await worker.getQuickInfoAtPosition(
      model.uri.toString(),
      model.getValue().indexOf("answer") + 1,
    );
    return {
      completions: completions.entries.map((entry: any) => entry.name),
      hover: hover.displayParts.map((part: any) => part.text).join(""),
    };
  });
  expect(features.completions).toContain("toFixed");
  expect(features.hover).toContain("number");
  await page.locator(".problem-row").first().click();
  await expect(page.locator(".statusbar")).toContainText("POS::");
  await page.screenshot({ path: "test-results/typescript-diagnostics.png" });
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((url) => new URL(url).pathname === "/src/editor/monaco.ts")!;
    const monaco = await import(url);
    monaco.editor
      .getModels()
      .find((model: any) => model.uri.path.endsWith("/src/main.ts"))
      .setValue("const answer: number = 42;\nanswer.toFixed();\n");
  });
  await expect(page.locator(".problem-row")).toHaveCount(0, { timeout: 20000 });
});

test("JSON language service reports malformed JSON", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page
    .getByRole("button", { name: "{} package.json", exact: true })
    .click();
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((url) => new URL(url).pathname === "/src/editor/monaco.ts")!;
    const monaco = await import(url);
    monaco.editor
      .getModels()
      .find((model: any) => model.uri.path.endsWith("/package.json"))
      .setValue('{ "name": }');
  });
  await page
    .getByRole("button", { name: "Toggle Problems", exact: true })
    .click();
  await expect(
    page.locator(".problem-row").filter({ hasText: "Value expected" }),
  ).toBeVisible({ timeout: 20000 });
});

test("definition navigation connects open TypeScript files", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page
    .getByRole("button", { name: "TS workspace.ts", exact: true })
    .click();
  await page.getByRole("tab", { name: "TS main.ts", exact: true }).click();
  const definitions = await page.evaluate(async () => {
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
    return worker.getDefinitionAtPosition(
      model.uri.toString(),
      model.getValue().indexOf("createWorkspace") + 1,
    );
  });
  expect(
    definitions.some((definition: any) =>
      definition.fileName.endsWith("/src/workspace.ts"),
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Close workspace.ts", exact: true })
    .click();
  // Closing a source model must not destroy the remaining open editor.
  await expect(
    page.getByRole("tab", { name: "TS main.ts", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});
