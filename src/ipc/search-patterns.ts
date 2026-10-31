import type { SearchOptions } from "./types";
export function searchExpression(options: SearchOptions) {
  const pattern = options.regex
    ? options.query
    : options.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    options.wholeWord ? `\\b(?:${pattern})\\b` : pattern,
    options.caseSensitive ? "gu" : "giu",
  );
}
// Mirrors the native file_rank: every whitespace-separated term must appear in
// the path (case-insensitive). 0 exact name, 1 name prefix, 2 name substring,
// 3 elsewhere in the path; undefined when the path does not match.
export function fileRank(query: string, path: string): number | undefined {
  const needle = query.trim().toLowerCase();
  if (!needle) return undefined;
  const haystack = path.toLowerCase();
  if (!needle.split(/\s+/).every((term) => haystack.includes(term)))
    return undefined;
  const name = haystack.slice(haystack.lastIndexOf("/") + 1);
  if (name === needle) return 0;
  if (name.startsWith(needle)) return 1;
  if (name.includes(needle)) return 2;
  return 3;
}
export function rankFiles(query: string, paths: string[]) {
  return paths
    .map((path) => ({ path, rank: fileRank(query, path) }))
    .filter(
      (item): item is { path: string; rank: number } => item.rank !== undefined,
    )
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.path.length - b.path.length ||
        (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    )
    .map((item) => item.path);
}
export function fileFilter(input: string) {
  const patterns: string[] = [];
  let depth = 0,
    start = 0;
  for (let i = 0; i < input.length; i++) {
    if ("{[".includes(input[i])) depth++;
    else if ("}]".includes(input[i])) depth--;
    else if (input[i] === "," && depth === 0) {
      patterns.push(input.slice(start, i).trim());
      start = i + 1;
    }
    if (depth < 0) throw Error("Invalid file filter: unmatched bracket.");
  }
  if (depth) throw Error("Invalid file filter: unmatched bracket.");
  patterns.push(input.slice(start).trim());
  const expressions = patterns.filter(Boolean).map((pattern) => {
    const rooted = pattern.startsWith("./");
    pattern = pattern.replace(/^\.\//, "").replace(/\/$/, "");
    let expression = rooted ? "^" : "^(?:.*/)?";
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === "*" && pattern[i + 1] === "*") {
        i++;
        if (pattern[i + 1] === "/") {
          expression += "(?:.*/)?";
          i++;
        } else expression += ".*";
      } else if (c === "*") expression += "[^/]*";
      else if (c === "?") expression += "[^/]";
      else if (c === "{") expression += "(?:";
      else if (c === "}") expression += ")";
      else if (c === ",") expression += "|";
      else if (c === "[") {
        const end = pattern.indexOf("]", i + 1);
        if (end < 0) throw Error("Invalid file filter.");
        expression += pattern.slice(i, end + 1).replace(/^\[!/, "[^");
        i = end;
      } else expression += c.replace(/[\\^$+.()|]/g, "\\$&");
    }
    return new RegExp(expression + "(?:/.*)?$");
  });
  return (path: string) =>
    expressions.length === 0 ||
    expressions.some((expression) => expression.test(path));
}
