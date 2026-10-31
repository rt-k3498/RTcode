export type Workspace = {
  id: string;
  name: string;
  displayPath: string;
  trusted: boolean;
  rootId: string;
};
export type Entry = {
  id: string;
  name: string;
  relativePath: string;
  directory: boolean;
  symlink: boolean;
};
export type Document = {
  workspaceId?: string;
  id: string;
  name: string;
  relativePath: string;
  text: string;
  revision: string;
  language: string;
  eol: string;
  bom: boolean;
  readOnly?: string;
};
export type Change = {
  pathId?: string;
  path: string;
  status: string;
  staged: boolean;
  conflict: boolean;
};
export type GitState = {
  branch: string;
  ahead: number;
  behind: number;
  local: string[];
  remote: string[];
  commits: { hash: string; message: string }[];
  changes: Change[];
  worktrees: GitWorktree[];
};
export type GitWorktree = {
  path: string;
  branch: string;
  head: string;
  current: boolean;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
  available: boolean;
};
export type Match = {
  pathId: string;
  path: string;
  line: number;
  column: number;
  endColumn: number;
  textColumn: number;
  text: string;
  revision: string;
};
export type FileMatch = { pathId: string; path: string; name: string };
export type SearchSummary = { skippedFiles: number };
export type FileSearch = {
  files: FileMatch[];
  total: number;
  skippedFiles: number;
};
export type ReplaceResult = {
  updated: Document[];
  errors: string[];
  replacements: number;
};
// A workspace path the language service asked for: a file with its text, or
// a directory with the names of its subdirectories.
export type ProjectEntry = {
  path: string;
  canonicalPath?: string | null;
  pathId?: string | null;
  content?: string | null;
  directories?: string[] | null;
};
export type SearchOptions = {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  include: string;
  exclude: string;
};
export type Stream = {
  sequence: number;
  data?: number[];
  exitCode?: number;
  error?: string;
};
export type AppError = {
  code: string;
  message: string;
  retryable: boolean;
  correlationId: string;
};
export const errorMessage = (e: unknown) =>
  typeof e === "object" && e && "message" in e ? String(e.message) : String(e);
