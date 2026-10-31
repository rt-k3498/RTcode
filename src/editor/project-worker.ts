import type ts from "typescript";

type TS = typeof ts;
// Monaco's worker host is intentionally extended at its documented worker entry
// point. Keep this factory independent of the browser so resolution is testable.
export function projectWorker(Base: new (...args: any[]) => any, ts: TS) {
  return class ProjectWorker extends Base {
    private configCache = new Map<string, ts.ParsedCommandLine>();
    private configVersion = "";
    private projectFiles: string[] | undefined;
    private defaultOptions: ts.CompilerOptions;
    private activeFile = "";
    private configErrors: ts.Diagnostic[] = [];
    // What the editor knows about the disk, published as the rtcode://project
    // lib. Anything not listed there and not loaded is unknown, so asking for
    // it records a probe and the editor loads it on demand.
    private disk:
      | {
          realPaths: Record<string, string>;
          absent: Set<string>;
          directories: Record<string, string[]>;
        }
      | undefined;
    private probes = new Set<string>();
    // Set when new files were loaded, so the next program build looks up
    // imports and @types again instead of reusing earlier failed lookups.
    private changed = false;

    constructor(...args: any[]) {
      super(...args);
      this.defaultOptions = { ...this._compilerOptions };
      const service = this._languageService;
      this._languageService = new Proxy(service, {
        get: (target, key) => {
          const method = target[key];
          if (typeof method !== "function") return method;
          return (...params: any[]) => {
            if (
              typeof params[0] === "string" &&
              /\.[cm]?[jt]sx?$/.test(params[0])
            )
              this.selectProject(params[0]);
            try {
              return method.apply(target, params);
            } finally {
              this.changed = false;
            }
          };
        },
      });
    }
    private names(): string[] {
      return [
        ...new Set<string>([
          ...Object.keys(this._extraLibs),
          ...this._ctx
            .getMirrorModels()
            .map((model: any) => model.uri.toString()),
        ]),
      ];
    }
    private info() {
      if (!this.disk) {
        let raw: any = {};
        try {
          raw = JSON.parse(
            this._extraLibs["rtcode://project"]?.content || "{}",
          );
        } catch {}
        this.disk = {
          realPaths: raw.realPaths || {},
          absent: new Set(raw.absent),
          directories: raw.directories || {},
        };
      }
      return this.disk;
    }
    // Remembers a workspace path the editor has not loaded yet.
    private probe(name: string) {
      const disk = this.info();
      if (
        name.startsWith("file:///") &&
        !disk.absent.has(name) &&
        !(name in disk.directories)
      )
        this.probes.add(name);
    }
    fileExists(name: string): boolean {
      const found = super.fileExists(name);
      if (!found) this.probe(name);
      return found;
    }
    readFile(name: string): string | undefined {
      const text = super.readFile(name);
      if (text === undefined) this.probe(name);
      return text;
    }
    // TypeScript calls this one without a receiver, hence the arrow function.
    hasInvalidatedResolutions = () => this.changed;
    hasChangedAutomaticTypeDirectiveNames() {
      return this.changed;
    }
    directoryExists(directory: string): boolean {
      const dir = directory.replace(/\/$/, "");
      const disk = this.info();
      if (dir in disk.directories) return true;
      if (this.names().some((name) => name.startsWith(dir + "/"))) return true;
      if (disk.absent.has(dir) || this.names().includes(dir)) return false;
      // Unknown: assume it exists so lookups inside it are probed too.
      this.probe(dir);
      return true;
    }
    getDirectories(directory: string): string[] {
      const dir = directory.replace(/\/$/, "");
      const prefix = dir + "/";
      const listed = this.info().directories[dir];
      if (!listed) this.probe(dir);
      return [
        ...new Set([
          ...(listed || []).map((name) => prefix + name),
          ...this.names()
            .filter((name) => name.startsWith(prefix))
            .map((name) => name.slice(prefix.length).split("/"))
            .filter((parts) => parts.length > 1)
            .map((parts) => prefix + parts[0]),
        ]),
      ];
    }
    readDirectory(
      root: string,
      extensions?: readonly string[],
      excludes?: readonly string[],
      includes?: readonly string[],
      depth?: number,
    ): string[] {
      // TypeScript's own glob matcher implements include/exclude and config file
      // expansion, including inherited config-relative paths.
      return (ts as any).matchFiles(
        root,
        extensions,
        excludes,
        includes,
        true,
        "",
        depth,
        (directory: string) => {
          const prefix = directory.replace(/\/$/, "") + "/";
          const files = new Set<string>();
          const directories = new Set<string>();
          for (const name of this.names()) {
            if (!name.startsWith(prefix)) continue;
            const parts = name.slice(prefix.length).split("/");
            if (parts.length === 1) files.add(parts[0]);
            else directories.add(parts[0]);
          }
          return { files: [...files], directories: [...directories] };
        },
        (path: string) => path,
      );
    }
    getCurrentDirectory() {
      return this.activeFile?.match(/^file:\/\/\/[^/]+/)?.[0] || "";
    }
    useCaseSensitiveFileNames() {
      return true;
    }
    realpath(path: string) {
      return this.info().realPaths[path] || path;
    }
    getScriptKind(fileName: string) {
      if (fileName.endsWith(".json")) return ts.ScriptKind.JSON;
      if (/\.[mc]ts$/.test(fileName)) return ts.ScriptKind.TS;
      if (/\.[mc]js$/.test(fileName)) return ts.ScriptKind.JS;
      return super.getScriptKind(fileName);
    }
    getScriptFileNames(): string[] {
      return (
        this.projectFiles ||
        super
          .getScriptFileNames()
          .filter((name: string) => /\.[cm]?[jt]sx?$/.test(name))
      );
    }
    private parsed(config: string): ts.ParsedCommandLine {
      let parsed = this.configCache.get(config);
      if (!parsed) {
        const read = ts.readConfigFile(config, (name) => this.readFile(name));
        parsed = ts.parseJsonConfigFileContent(
          read.config || {},
          {
            useCaseSensitiveFileNames: true,
            readDirectory: this.readDirectory.bind(this),
            fileExists: this.fileExists.bind(this),
            readFile: this.readFile.bind(this),
            trace: () => {},
          },
          config.slice(0, config.lastIndexOf("/")),
          undefined,
          config,
        );
        if (read.error) parsed.errors.push(read.error);
        // Referenced configs are loaded on demand like everything else.
        for (const reference of parsed.projectReferences || [])
          this.fileExists(ts.resolveProjectReferencePath(reference));
        this.configCache.set(config, parsed);
      }
      return parsed;
    }
    private selectProject(fileName: string) {
      this.activeFile = fileName;
      // Look for a config in every folder above the file; missing ones are
      // loaded on demand.
      const root = fileName.match(/^file:\/\/\/[^/]+/)?.[0] || "";
      for (
        let dir = fileName.slice(0, fileName.lastIndexOf("/"));
        root && dir.length >= root.length;
        dir = dir.slice(0, dir.lastIndexOf("/"))
      ) {
        this.fileExists(dir + "/tsconfig.json");
        this.fileExists(dir + "/jsconfig.json");
      }
      const configs = this.names().filter(
        (name) =>
          /\/(?:tsconfig|jsconfig)(?:\.[^/]*)?\.json$/.test(name) &&
          !name.includes("/node_modules/"),
      );
      const version = configs
        .map((name) => `${name}:${this.getScriptVersion(name)}`)
        .join("|");
      if (version !== this.configVersion) {
        this.configCache.clear();
        this.configVersion = version;
      }
      const candidates = configs
        .filter((name) =>
          fileName.startsWith(name.slice(0, name.lastIndexOf("/") + 1)),
        )
        .sort(
          (a, b) =>
            b.split("/").length - a.split("/").length ||
            Number(!/\/(tsconfig|jsconfig)\.json$/.test(a)) -
              Number(!/\/(tsconfig|jsconfig)\.json$/.test(b)),
        );
      const config = candidates.find((name) =>
        this.parsed(name).fileNames.includes(fileName),
      );
      const parsed = config ? this.parsed(config) : undefined;
      this._compilerOptions = parsed
        ? { ...parsed.options, noEmit: true, allowNonTsExtensions: true }
        : this.defaultOptions;
      this.projectFiles = parsed
        ? [...new Set([...parsed.fileNames, fileName])]
        : this.names().filter(
            (name) =>
              /\.[cm]?[jt]sx?$/.test(name) && !name.includes("/node_modules/"),
          );
      this.configErrors = parsed?.errors || [];
    }
    // Builds the program for a file and returns the workspace paths it looked
    // for but the editor has not loaded yet.
    async scanProject(fileName: string): Promise<string[]> {
      this.selectProject(fileName);
      this._languageService.getProgram();
      const probes = [...this.probes];
      this.probes.clear();
      return probes;
    }
    async getRenameInfo(fileName: string, position: number, options: any) {
      const info = await super.getRenameInfo(fileName, position, options);
      const open = this._extraLibs["rtcode://open-files"];
      if (info.canRename && open) {
        const paths = new Set(JSON.parse(open.content));
        const locations = await super.findRenameLocations(
          fileName,
          position,
          false,
          false,
          true,
        );
        if (
          locations?.some(
            (location: { fileName: string }) => !paths.has(location.fileName),
          )
        ) {
          return {
            canRename: false,
            localizedErrorMessage:
              "Open all affected files before renaming this symbol so every edit can be reviewed and saved.",
          };
        }
      }
      return info;
    }
    async getCompilerOptionsDiagnostics(fileName: string) {
      this.selectProject(fileName);
      return (Base as any).clearFiles([
        ...this.configErrors,
        ...this._languageService.getCompilerOptionsDiagnostics(),
      ]);
    }
    async updateExtraLibs(libs: any) {
      this.disk = undefined;
      this.changed = true;
      this.configCache.clear();
      this.configVersion = "";
      return super.updateExtraLibs(libs);
    }
  };
}
