import { describe, it, expect } from "vitest";
import {
  demoOpen,
  demoSave,
  demoSearch,
  demoTree,
  language,
} from "../ipc/demo";
import guide from "../guide/generated.json";
describe("sample workspace search", () => {
  it("literal metacharacters stay literal", () => {
    expect(
      demoSearch({
        query: "[",
        regex: false,
        caseSensitive: false,
        wholeWord: false,
        include: "",
        exclude: "",
      }).every((m) => m.text.slice(m.column - 1, m.endColumn - 1) === "["),
    ).toBe(true);
  });
  it("reports UTF-16 ranges that identify actual matches", () => {
    const results = demoSearch({
      query: "workspace",
      regex: false,
      caseSensitive: true,
      wholeWord: true,
      include: "src/",
      exclude: "",
    });
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.text.slice(result.column - 1, result.endColumn - 1)).toBe(
        "workspace",
      );
    }
  });
  it("does not recursively materialize directories", () => {
    expect(demoTree().find((e) => e.name === "src")?.directory).toBe(true);
    expect(demoTree().some((e) => e.relativePath === "src/main.ts")).toBe(
      false,
    );
  });
});
describe("offline documentation", () => {
  it("contains the required complete article set with unique anchors", () => {
    expect(guide).toHaveLength(17);
    expect(new Set(guide.map((a) => a.id)).size).toBe(17);
    for (const article of guide) {
      const anchors = article.blocks
        .filter((b) => b.type === "heading")
        .map((b) => b.anchor);
      expect(new Set(anchors).size).toBe(anchors.length);
    }
  });
});
describe("editor detection", () => {
  it("recognizes JavaScript and TypeScript module extensions", () => {
    for (const extension of ["ts", "tsx", "mts", "cts"])
      expect(language(`file.${extension}`)).toBe("typescript");
    for (const extension of ["js", "jsx", "mjs", "cjs"])
      expect(language(`file.${extension}`)).toBe("javascript");
    expect(language("config.yaml")).toBe("yaml");
  });
  it("falls back to plain text", () =>
    expect(language("anything.custom")).toBe("plaintext"));
  it("opens a real editable sample document", () =>
    expect(demoOpen("src/main.ts").text).toContain("createWorkspace"));
});

describe("console contrast", () => {
  const luminance = (hex: string) =>
    [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a: string, b: string) =>
    (Math.max(luminance(a), luminance(b)) + 0.05) /
    (Math.min(luminance(a), luminance(b)) + 0.05);
  it("meets AA for muted text, signals, and input boundaries", () => {
    for (const fg of ["#87919b", "#faa968", "#5db7a5"])
      expect(ratio(fg, "#17212b")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#607480", "#0e141b")).toBeGreaterThanOrEqual(3);
  });
});

describe("sample bounds", () => {
  it("rejects inherited object keys as document handles", () => {
    expect(() => demoOpen("toString")).toThrow("File not found");
    expect(() => demoSave("__proto__", "text")).toThrow("File not found");
  });
  it("returns every result, including many matches on one long line", () => {
    const original = demoOpen("README.md").text;
    try {
      demoSave("README.md", "capneedle ".repeat(5000));
      expect(
        demoSearch({
          query: "capneedle",
          regex: false,
          caseSensitive: true,
          wholeWord: false,
          include: "README.md",
          exclude: "",
        }),
      ).toHaveLength(5000);
    } finally {
      demoSave("README.md", original);
    }
  });
});

describe("workspace search glob and replacement contracts", () => {
  it("accepts comma-separated globs, braces, exclusions, and literal dollars", async () => {
    const { demoReplace } = await import("../ipc/demo");
    const original = demoOpen("src/main.ts").text;
    const options = {
      query: "createWorkspace",
      regex: false,
      caseSensitive: true,
      wholeWord: true,
      include: "src/**/*.{ts,tsx}, tests/**",
      exclude: "**/workspace.ts, tests/**",
    };
    try {
      const matches = demoSearch(options);
      expect(matches).toHaveLength(2);
      expect(matches.every((match) => match.path === "src/main.ts")).toBe(true);
      expect(demoReplace(options, matches, "$1").replacements).toBe(2);
      expect(demoOpen("src/main.ts").text).toContain("import { $1 }");
      expect(demoReplace(options, matches, "stale").errors).toHaveLength(1);
    } finally {
      demoSave("src/main.ts", original);
    }
  });
  it("reports invalid file filters instead of silently returning zero matches", () => {
    expect(() =>
      demoSearch({
        query: "workspace",
        regex: false,
        caseSensitive: false,
        wholeWord: false,
        include: "[",
        exclude: "",
      }),
    ).toThrow("Invalid file filter");
  });
});
