import { describe, expect, it } from "vitest";
import { fileRank, rankFiles } from "../ipc/search-patterns";
import { demoSearchFiles } from "../ipc/demo";

describe("file name search", () => {
  it("ranks exact names, prefixes, substrings, then path matches", () => {
    expect(fileRank("workspace", "workspace")).toBe(0);
    expect(fileRank("Workspace", "src/workspace.ts")).toBe(1);
    expect(fileRank("space", "src/workspace.ts")).toBe(2);
    expect(fileRank("src", "src/main.ts")).toBe(3);
    expect(fileRank("src main", "src/main.ts")).toBe(3);
    expect(fileRank("missing", "src/main.ts")).toBeUndefined();
    expect(fileRank("   ", "src/main.ts")).toBeUndefined();
  });
  it("orders by rank, then shorter path, then name", () => {
    expect(
      rankFiles("workspace", [
        "src/lib/workspace-utils.ts",
        "docs/Workspace.md",
        "src/workspace.ts",
        "workspace",
        "src/other.ts",
      ]),
    ).toEqual([
      "workspace",
      "src/workspace.ts",
      "docs/Workspace.md",
      "src/lib/workspace-utils.ts",
    ]);
  });
  it("searches the sample workspace by name", () => {
    const results = demoSearchFiles("work");
    expect(results.total).toBe(results.files.length);
    expect(results.files[0]).toEqual({
      pathId: "src/workspace.ts",
      path: "src/workspace.ts",
      name: "workspace.ts",
    });
    expect(demoSearchFiles("nothing-here").files).toEqual([]);
  });
});
