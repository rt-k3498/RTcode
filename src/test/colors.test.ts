import { describe, expect, it } from "vitest";
import { defaultPalette, normalizePalette, themeTokens } from "../theme/colors";

describe("custom base colors", () => {
  it("keeps orange and teal defaults for old or malformed settings", () => {
    expect(normalizePalette(undefined)).toEqual(defaultPalette);
    expect(
      normalizePalette({ accent: "red; background: white", surface: null }),
    ).toEqual(defaultPalette);
    expect(themeTokens(defaultPalette).amber).toBe("#faa968");
    expect(themeTokens(defaultPalette).teal).toBe("#5db7a5");
  });
  it("round-trips valid colors and ignores unknown keys", () => {
    const palette = normalizePalette({
      ...defaultPalette,
      accent: "#AA44FF",
      unexpected: "#000000",
    });
    expect(palette.accent).toBe("#aa44ff");
    expect(normalizePalette(JSON.parse(JSON.stringify(palette)))).toEqual(
      palette,
    );
    expect(palette).not.toHaveProperty("unexpected");
  });
  it("adapts neutrals and high contrast to custom canvas colors", () => {
    const palette = {
      ...defaultPalette,
      background: "#eeeeee",
      text: "#111111",
    };
    expect(themeTokens(palette).canvas).toBe("#eeeeee");
    expect(themeTokens(palette).text).toBe("#111111");
    expect(themeTokens(palette).muted).not.toBe(
      themeTokens(defaultPalette).muted,
    );
    expect(themeTokens(palette, true).strong).not.toBe(
      themeTokens(palette).strong,
    );
  });
});
