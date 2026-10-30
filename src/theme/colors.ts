export type Palette = {
  accent: string;
  teal: string;
  background: string;
  surface: string;
  text: string;
};
export const defaultPalette: Palette = {
  accent: "#faa968",
  teal: "#5db7a5",
  background: "#0b0f14",
  surface: "#111821",
  text: "#e7dccb",
};
export const diagnosticColors = {
  error: "#ff6464",
  warning: "#f2cf66",
  hint: "#f2cf66",
};
export function normalizePalette(value: unknown): Palette {
  const input =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    Object.entries(defaultPalette).map(([key, fallback]) => {
      const color = input[key];
      return [
        key,
        typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)
          ? color.toLowerCase()
          : fallback,
      ];
    }),
  ) as Palette;
}
function mix(a: string, b: string, weight: number) {
  return (
    "#" +
    [1, 3, 5]
      .map((i) =>
        Math.round(
          parseInt(a.slice(i, i + 2), 16) * (1 - weight) +
            parseInt(b.slice(i, i + 2), 16) * weight,
        )
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
export function themeTokens(palette: Palette, contrast = false) {
  const standard =
    palette.background === defaultPalette.background &&
    palette.surface === defaultPalette.surface &&
    palette.text === defaultPalette.text;
  const neutral = (fallback: string, weight: number) =>
    standard ? fallback : mix(palette.background, palette.text, weight);
  return {
    "diagnostic-error": diagnosticColors.error,
    "diagnostic-warning": diagnosticColors.warning,
    "diagnostic-hint": diagnosticColors.hint,
    canvas: palette.background,
    surface: palette.surface,
    raised: neutral("#17212b", 0.09),
    input: neutral("#0e141b", 0.025),
    border: neutral(contrast ? "#6d7d89" : "#263440", contrast ? 0.5 : 0.18),
    strong: neutral(contrast ? "#a7afb5" : "#607480", contrast ? 0.75 : 0.48),
    text: palette.text,
    secondary: neutral(
      contrast ? "#d2d8dc" : "#a7afb5",
      contrast ? 0.93 : 0.78,
    ),
    muted: neutral(contrast ? "#bdc4ca" : "#87919b", contrast ? 0.85 : 0.65),
    amber: palette.accent,
    teal: palette.teal,
    focus: palette.accent,
  };
}
