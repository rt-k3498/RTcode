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
