import {
  defaultPalette,
  normalizePalette,
  type Palette,
} from "../theme/colors";

export type Preferences = {
  fontSize: number;
  wrap: boolean;
  minimap: boolean;
  contrast: boolean;
  motion: boolean;
  formatter: string;
  formatterArgs: string;
  guideZoom: number;
  colors: Palette;
};
export const defaults: Preferences = {
  fontSize: 13,
  wrap: false,
  minimap: false,
  contrast: false,
  motion: true,
  formatter: "",
  formatterArgs: "[]",
  guideZoom: 14,
  colors: defaultPalette,
};
export type TerminalPosition = "right" | "bottom";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function bounded(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}
export function normalizePreferences(value: unknown): Preferences {
  const input = record(value);
  const result = { ...defaults };
  for (const key of ["wrap", "minimap", "contrast", "motion"] as const)
    if (typeof input[key] === "boolean") result[key] = input[key];
  for (const key of ["formatter", "formatterArgs"] as const)
    if (typeof input[key] === "string") result[key] = input[key];
  result.fontSize = bounded(input.fontSize, defaults.fontSize, 10, 28);
  result.guideZoom = bounded(input.guideZoom, defaults.guideZoom, 10, 28);
  result.colors = normalizePalette(input.colors);
  return result;
}
export function normalizeLayout(value: unknown) {
  const input = record(value);
  const saved = input.placement;
  const placement: TerminalPosition[] = Array.isArray(saved)
    ? [
        ...new Set(
          saved.filter(
            (p): p is TerminalPosition => p === "right" || p === "bottom",
          ),
        ),
      ]
    : saved === "hidden"
      ? []
      : [saved === "bottom" ? "bottom" : "right"];
  return {
    placement,
    sidebarWidth: bounded(input.sidebarWidth, 248, 196, 420),
    terminalWidth: bounded(input.terminalWidth, 36, 24, 55),
  };
}
