import type {
  Document,
  Entry,
  GitState,
  Match,
  FileSearch,
  SearchOptions,
  Workspace,
  ReplaceResult,
} from "./types";
import { fileFilter, rankFiles, searchExpression } from "./search-patterns";
const files: Record<string, string> = {
  "src/main.ts": `import { createWorkspace } from './workspace';\nimport { registerCommands } from './commands';\nimport { createTerminal } from './terminal';\n\n/**\n * A quiet place to build something good.\n * One workspace. Your tools. No distractions.\n */\nexport async function boot() {\n  const workspace = await createWorkspace({\n    name: 'rtcode-sample',\n    theme: 'retro-82',\n    trust: 'restricted',\n  });\n\n  // Keep authority in the native core.\n  registerCommands(workspace);\n\n  if (workspace.trusted) {\n    await createTerminal({\n      cwd: workspace.root,\n      placement: 'right',\n      shell: 'system',\n    });\n  }\n\n  return workspace;\n}\n\nboot().catch(console.error);\n`,
  "src/workspace.ts": `export interface Workspace {\n  name: string;\n  root: string;\n  trusted: boolean;\n}\n\nexport async function createWorkspace(options: {\n  name: string;\n  theme: string;\n  trust: string;\n}): Promise<Workspace> {\n  return { name: options.name, root: '.', trusted: false };\n}\n`,
  "src/commands.ts": `import type { Workspace } from './workspace';\n\nexport function registerCommands(workspace: Workspace) {\n  console.info('Workspace ready:', workspace.name);\n}\n`,
  "src/terminal.ts": `export async function createTerminal(options: {\n  cwd: string;\n  placement: 'right' | 'bottom';\n  shell: string;\n}) {\n  // The native core owns PTY creation and process cleanup.\n  return options;\n}\n`,
  "src/theme/tokens.css": `:root {\n  --canvas: #0b0f14;\n  --surface: #111821;\n  --amber: #faa968;\n  --teal: #5db7a5;\n  --text: #e7dccb;\n}\n`,
  "src-tauri/Cargo.toml": `[package]\nname = "rtcode-sample"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\ntauri = { version = "2", features = [] }\n`,
  "README.md": `# RTcode\n\nA small, deliberate home for your code.\n\nThis is the browser sample workspace. Edits stay in memory.\nUse the native desktop app to open and save real projects.\n\n## The workbench\n\n- Files, search, and repository state on the left\n- A single Monaco editor in the center\n- A movable, Rust-owned terminal\n- An offline Guide behind RTcode\n`,
  "package.json":
    '{\n  "name": "rtcode-sample",\n  "version": "0.1.0",\n  "private": true,\n  "scripts": { "dev": "vite", "build": "vite build" }\n}\n',
  ".gitignore": "node_modules/\ndist/\ntarget/\n",
  "tests/workspace.test.ts": `import { describe, it, expect } from 'vitest';\nimport { createWorkspace } from '../src/workspace';\n\ndescribe('workspace trust', () => {\n  it('starts restricted', async () => {\n    const ws = await createWorkspace({\n      name: 'test', theme: 'retro-82', trust: 'restricted'\n    });\n    expect(ws.trusted).toBe(false);\n  });\n});\n`,
};
export const sampleWorkspace: Workspace = {
  id: "sample",
  name: "rtcode-sample",
  displayPath: "SAMPLE / rtcode-sample",
  rootId: "",
  trusted: false,
};
export function language(path: string) {
  return (
    (
      {
        ts: "typescript",
        tsx: "typescript",
        mts: "typescript",
        cts: "typescript",
        js: "javascript",
        jsx: "javascript",
        mjs: "javascript",
        cjs: "javascript",
        json: "json",
        rs: "rust",
        md: "markdown",
        css: "css",
        scss: "scss",
        less: "less",
        html: "html",
        htm: "html",
        toml: "ini",
        py: "python",
        sh: "shell",
        yml: "yaml",
        yaml: "yaml",
      } as Record<string, string>
    )[path.split(".").pop()!] || "plaintext"
  );
}
export function demoTree(parent = ""): Entry[] {
  const prefix = parent ? parent + "/" : "";
  const names = new Set(
    Object.keys(files)
      .filter((p) => p.startsWith(prefix))
      .map((p) => p.slice(prefix.length).split("/")[0]),
  );
  return [...names]
    .map((name) => {
      const path = prefix + name;
      return {
        id: path,
        name,
        relativePath: path,
        directory: !Object.hasOwn(files, path),
        symlink: false,
      };
    })
    .sort(
      (a, b) =>
        Number(b.directory) - Number(a.directory) ||
        a.name.localeCompare(b.name),
    );
}
export function demoOpen(path: string): Document {
  if (!Object.hasOwn(files, path)) throw Error("File not found");
  return {
    id: path,
    name: path.split("/").pop()!,
    relativePath: path,
    text: files[path],
    revision: files[path],
    language: language(path),
    eol: "LF",
    bom: false,
  };
}
export function demoSave(id: string, text: string) {
  if (!Object.hasOwn(files, id)) throw Error("File not found");
  files[id] = text;
  return text;
}
export function demoSearchFiles(query: string): FileSearch {
  const found = rankFiles(query, Object.keys(files)).map((path) => ({
    pathId: path,
    path,
    name: path.split("/").pop()!,
  }));
  return { files: found, total: found.length, skippedFiles: 0 };
}
export function demoSearch(o: SearchOptions): Match[] {
  const re = searchExpression(o);
  const include = fileFilter(o.include),
    exclude = fileFilter(o.exclude);
  const found: Match[] = [];
  for (const [path, text] of Object.entries(files)) {
    if (!include(path) || (o.exclude && exclude(path))) continue;
    for (const [i, line] of text.split("\n").entries()) {
      for (const m of line.matchAll(re)) {
        found.push({
          pathId: path,
          path,
          line: i + 1,
          column: m.index! + 1,
          endColumn: m.index! + m[0].length + 1,
          textColumn: 1,
          text: line,
          revision: text,
        });
      }
    }
  }
  return found;
}
export function demoReplace(
  options: SearchOptions,
  matches: Match[],
  replacement: string,
): ReplaceResult {
  const result: ReplaceResult = { updated: [], errors: [], replacements: 0 };
  const expression = searchExpression(options);
  for (const path of new Set(matches.map((match) => match.pathId))) {
    const selected = matches.filter((match) => match.pathId === path);
    if (
      !Object.hasOwn(files, path) ||
      selected.some((match) => match.revision !== files[path])
    ) {
      result.errors.push(`${path}: File changed since search. Search again.`);
      continue;
    }
    const wanted = new Set(
      selected.map(
        (match) => `${match.line}:${match.column}:${match.endColumn}`,
      ),
    );
    const text = files[path]
      .split("\n")
      .map((line, lineIndex) => {
        const found = [...line.matchAll(expression)].filter((match) =>
          wanted.has(
            `${lineIndex + 1}:${match.index! + 1}:${match.index! + match[0].length + 1}`,
          ),
        );
        for (const match of found.reverse()) {
          const value = options.regex
            ? replacement.replace(
                /\$\$|\$&|\$\{(\w+)\}|\$(\d+|[A-Za-z_]\w*)/g,
                (token, braced, group) =>
                  token === "$$"
                    ? "$"
                    : token === "$&"
                      ? match[0]
                      : (match[Number(braced ?? group)] ??
                        match.groups?.[braced ?? group] ??
                        ""),
              )
            : replacement;
          line =
            line.slice(0, match.index) +
            value +
            line.slice(match.index! + match[0].length);
          result.replacements++;
        }
        return line;
      })
      .join("\n");
    demoSave(path, text);
    result.updated.push(demoOpen(path));
  }
  return result;
}
export const emptyGit: GitState = {
  branch: "No repository",
  ahead: 0,
  behind: 0,
  local: [],
  remote: [],
  commits: [],
  changes: [],
  worktrees: [],
};
