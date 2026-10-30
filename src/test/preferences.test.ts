import { describe, expect, it } from "vitest";
import {
  defaults,
  normalizeLayout,
  normalizePreferences,
} from "../app/preferences";

describe("persisted settings", () => {
  it("rejects malformed types and non-finite sizes", () => {
    for (const value of [null, [], "old settings", 4])
      expect(normalizePreferences(value)).toEqual(defaults);
    expect(
      normalizePreferences({
        fontSize: NaN,
        wrap: "false",
        formatter: {},
        colors: null,
      }),
    ).toEqual(defaults);
    expect(
      normalizeLayout({ sidebarWidth: "420", terminalWidth: Infinity }),
    ).toEqual(normalizeLayout(undefined));
  });
  it("bounds geometry while preserving valid custom preferences", () => {
    const result = normalizePreferences({
      fontSize: 100,
      guideZoom: -20,
      wrap: true,
      formatter: "prettier",
      colors: { accent: "#ABCDEF" },
    });
    expect(result).toMatchObject({
      fontSize: 28,
      guideZoom: 10,
      wrap: true,
      formatter: "prettier",
      colors: { accent: "#abcdef" },
    });
    expect(
      normalizeLayout({
        sidebarWidth: 9999,
        terminalWidth: -1,
        placement: ["bottom", "unknown", "bottom", "right"],
      }),
    ).toEqual({
      sidebarWidth: 420,
      terminalWidth: 24,
      placement: ["bottom", "right"],
    });
  });
  it("migrates old terminal positions and preserves hidden panes", () => {
    expect(normalizeLayout({ placement: "hidden" }).placement).toEqual([]);
    expect(normalizeLayout({ placement: [] }).placement).toEqual([]);
    expect(normalizeLayout({ placement: "bottom" }).placement).toEqual([
      "bottom",
    ]);
  });
});
