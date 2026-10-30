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
    private realPaths: Record<string, string> | undefined;

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
            return method.apply(target, params);
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
    directoryExists(directory: string): boolean {
      const prefix = directory.replace(/\/$/, "") + "/";
      return this.names().some((name) => name.startsWith(prefix));
    }
    getDirectories(directory: string): string[] {
      const prefix = directory.replace(/\/$/, "") + "/";
      return [
        ...new Set(
          this.names()
            .filter((name) => name.startsWith(prefix))
            .map((name) => name.slice(prefix.length).split("/"))
            .filter((parts) => parts.length > 1)
            .map((parts) => prefix + parts[0]),
        ),
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
      if (!this.realPaths) {
        try {
          this.realPaths = JSON.parse(
            this._extraLibs["rtcode://project"]?.content || "{}",
          );
        } catch {
          this.realPaths = {};
        }
      }
      return this.realPaths?.[path] || path;
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
        this.configCache.set(config, parsed);
      }
      return parsed;
    }
    private selectProject(fileName: string) {
      this.activeFile = fileName;
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
    async getProjectConfiguration(fileName: string) {
      this.selectProject(fileName);
      return {
        options: this._compilerOptions,
        files: this.projectFiles,
        errors: this.configErrors.map((error) =>
          ts.flattenDiagnosticMessageText(error.messageText, "\n"),
        ),
      };
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
      this.realPaths = undefined;
      this.configCache.clear();
      this.configVersion = "";
      return super.updateExtraLibs(libs);
    }
  };
}
