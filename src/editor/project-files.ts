import type { ProjectEntry } from "../ipc/types";

export type Lib = { filePath: string; content: string; version: number };
// The methods the project worker adds to Monaco's TypeScript worker.
export type ProjectScanner = {
  scanProject(fileName: string): Promise<string[]>;
  updateExtraLibs(libs: unknown): Promise<void>;
};
const dependency = (uri: string) => uri.includes("/node_modules/");

// The workspace files the language service has asked for so far. Nothing is
// read up front: the service reports the paths it looked for, `load` fetches
// them, and anything that does not exist is remembered so it is not asked
// again.
export class ProjectFiles {
  private files = new Map<string, ProjectEntry>();
  private directories = new Map<string, string[]>();
  private realPaths = new Map<string, string>();
  private absent = new Set<string>();
  // Unchanged files keep their version so the language service does not parse
  // them again every time more files arrive.
  private versions = new Map<string, number>();
  private counter = 0;
  readonly root: string;
  constructor(
    workspaceId: string,
    private read: (paths: string[]) => Promise<ProjectEntry[]>,
  ) {
    this.root = `file:///${workspaceId}/`;
  }
  uri(path: string) {
    return this.root + path;
  }
  // Path handle of a loaded file, used to open it from the editor.
  pathId(uri: string) {
    return this.files.get(uri)?.pathId ?? undefined;
  }
  private known(uri: string) {
    return (
      this.files.has(uri) || this.directories.has(uri) || this.absent.has(uri)
    );
  }
  private store(entries: ProjectEntry[]) {
    for (const entry of entries) {
      const uri = this.uri(entry.path);
      if (entry.content != null) {
        this.files.set(uri, entry);
        this.versions.set(uri, ++this.counter);
      } else this.directories.set(uri, entry.directories ?? []);
      if (entry.canonicalPath)
        this.realPaths.set(uri, this.uri(entry.canonicalPath));
    }
  }
  // Fetches the probed paths that are not known yet. Returns false when there
  // was nothing new to learn.
  async load(probes: string[]) {
    const wanted = [...new Set(probes)].filter((uri) => !this.known(uri));
    const inside = wanted.filter((uri) => uri.startsWith(this.root));
    const entries = inside.length
      ? await this.read(inside.map((uri) => uri.slice(this.root.length)))
      : [];
    this.store(entries);
    for (const uri of wanted) if (!this.known(uri)) this.absent.add(uri);
    return wanted.length > 0;
  }
  // Re-reads loaded workspace files that may have changed on disk and forgets
  // what was missing, so new files are found. Dependencies keep their loaded
  // files unless `full` is set.
  async refresh(full = false) {
    const stale = [...this.files.keys()].filter(
      (uri) => full || !dependency(uri),
    );
    if (full) this.files.clear();
    this.directories.clear();
    this.absent.clear();
    for (const uri of stale) this.files.delete(uri);
    const paths = stale
      .filter((uri) => uri.startsWith(this.root))
      .map((uri) => uri.slice(this.root.length));
    this.store(paths.length ? await this.read(paths) : []);
  }
  libs(): Lib[] {
    return [
      ...[...this.files].map(([filePath, entry]) => ({
        filePath,
        content: entry.content!,
        version: this.versions.get(filePath)!,
      })),
      {
        filePath: "rtcode://project",
        content: JSON.stringify({
          realPaths: Object.fromEntries(this.realPaths),
          absent: [...this.absent],
          directories: Object.fromEntries(this.directories),
        }),
        version: ++this.counter,
      },
    ];
  }
}

// Asks the language service which paths it needs, loads them, and repeats
// until it has everything. Each round can reveal more imports, so the number
// of rounds is capped.
export async function resolveProject(
  files: ProjectFiles,
  scan: () => Promise<string[]>,
  push: (libs: Lib[]) => Promise<void>,
  rounds = 40,
) {
  for (let round = 0; round < rounds; round++) {
    if (!(await files.load(await scan()))) return true;
    await push(files.libs());
  }
  return false;
}
