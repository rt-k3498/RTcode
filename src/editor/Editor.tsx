import {
  onMount,
  onCleanup,
  createEffect,
  createSignal,
  createMemo,
  untrack,
} from "solid-js";
import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import { themeTokens, diagnosticColors, type Palette } from "../theme/colors";
import type { Document } from "../ipc/types";
import { api, native } from "../ipc/client";
import {
  ProjectFiles,
  resolveProject,
  type ProjectScanner,
} from "./project-files";
export type Problem = {
  documentId: string;
  path: string;
  line: number;
  column: number;
  endColumn: number;
  message: string;
  severity: "error" | "warning" | "info" | "hint";
  source?: string;
};
export type EditorHandle = {
  saveText: () => string;
  documentText: (id: string) => string | undefined;
  markSaved: (id: string, text: string) => boolean;
  reloadSaved: (document: Document) => void;
  focus: () => void;
  select: (line: number, column: number, end?: number) => void;
  format: () => Promise<boolean>;
  insert: (text: string) => void;
  getVersion: () => number;
  replace: (text: string) => void;
  setOption: (key: string, value: unknown) => void;
  // Re-reads project files that changed on disk. `full` also forgets
  // installed dependencies.
  reloadProject: (full?: boolean) => void;
};
export default function Editor(p: {
  document?: Document;
  openIds: string[];
  documents: Document[];
  workspaceId: string;
  readOnly?: boolean;
  onProblems: (problems: Problem[]) => void;
  onProjectStatus: (status: string) => void;
  onProjectError: (message: string) => void;
  onOpenDocument: (
    id: string,
    line: number,
    column: number,
    end?: number,
  ) => void;
  onChange: (id: string, dirty: boolean) => void;
  onPosition: (line: number, column: number) => void;
  onReady: (h: EditorHandle) => void;
  colors: Palette;
  contrast: boolean;
  fontSize: number;
  wrap: boolean;
  minimap: boolean;
}) {
  let host!: HTMLDivElement;
  let editor: Monaco.editor.IStandaloneCodeEditor | undefined;
  let monaco: typeof import("./monaco");
  const models = new Map<string, Monaco.editor.ITextModel>();
  const saved = new Map<string, string>();
  const views = new Map<string, Monaco.editor.ICodeEditorViewState | null>();
  let current: string | undefined;
  let disposed = false;
  const disposables: Monaco.IDisposable[] = [];
  const [ready, setReady] = createSignal(false);
  const openPaths = createMemo(() =>
    JSON.stringify(
      p.documents
        .filter((doc) => !doc.readOnly)
        .map(
          (doc) => `/${doc.workspaceId || p.workspaceId}/${doc.relativePath}`,
        ),
    ),
  );
  const normalized = (text: string) => text.replace(/\r\n/g, "\n");
  function ensureModel(doc: Document) {
    let model = models.get(doc.id);
    if (!model) {
      const uri = monaco.Uri.from({
        scheme: doc.readOnly ? "rtcode-diff" : "file",
        path: `/${doc.workspaceId || p.workspaceId}/${doc.readOnly ? encodeURIComponent(doc.id) : doc.relativePath}`,
      });
      model =
        monaco.editor.getModel(uri) ||
        monaco.editor.createModel(doc.text, doc.language, uri);
      monaco.editor.setModelLanguage(model, doc.language);
      if (model.getValue() !== doc.text) model.setValue(doc.text);
      models.set(doc.id, model);
      saved.set(doc.id, normalized(doc.text));
      model.onDidChangeContent(() => {
        p.onChange(doc.id, normalized(model!.getValue()) !== saved.get(doc.id));
        if (doc.id === current) scheduleProjectLoad();
      });
    } else if (doc.readOnly && model.getValue() !== doc.text) {
      model.setValue(doc.text);
      saved.set(doc.id, normalized(doc.text));
    }
    return model;
  }
  function activate(doc?: Document) {
    if (!editor) return;
    if (!doc) {
      editor.setModel(null);
      current = undefined;
      return;
    }
    if (current && current !== doc.id)
      views.set(current, editor.saveViewState());
    const model = ensureModel(doc);
    if (current === doc.id) return;
    current = doc.id;
    editor.setModel(model);
    editor.updateOptions({ readOnly: !!doc.readOnly || p.readOnly });
    editor.restoreViewState(views.get(doc.id) || null);
  }
  function reportProblems() {
    const problems: Problem[] = [];
    for (const doc of p.documents) {
      const model = models.get(doc.id);
      if (!model || doc.readOnly) continue;
      for (const marker of monaco.editor.getModelMarkers({
        resource: model.uri,
      })) {
        problems.push({
          documentId: doc.id,
          path: doc.relativePath,
          line: marker.startLineNumber,
          column: marker.startColumn,
          endColumn: marker.endColumn,
          message: marker.message,
          source: marker.source,
          severity:
            marker.severity === monaco.MarkerSeverity.Error
              ? "error"
              : marker.severity === monaco.MarkerSeverity.Warning
                ? "warning"
                : marker.severity === monaco.MarkerSeverity.Info
                  ? "info"
                  : "hint",
        });
        if (problems.length >= 1000) break;
      }
      if (problems.length >= 1000) break;
    }
    p.onProblems(problems);
  }
  // Project files are loaded lazily: the TypeScript worker reports the paths
  // it looks for, and only those are read from disk.
  let project: ProjectFiles | undefined;
  let loading = false;
  let queued: "open" | "refresh" | "full" | undefined;
  let typingTimer: ReturnType<typeof setTimeout> | undefined;
  const scripts = ["typescript", "javascript"];
  const defaultsFor = () => [
    monaco.typescript.typescriptDefaults,
    monaco.typescript.javascriptDefaults,
  ];
  let openVersion = 0;
  const allLibs = (files = project) => [
    ...(files?.libs() || []),
    {
      filePath: "rtcode://open-files",
      content: JSON.stringify(
        (JSON.parse(openPaths()) as string[]).map((path) =>
          monaco.Uri.from({ scheme: "file", path }).toString(),
        ),
      ),
      version: ++openVersion,
    },
  ];
  // Publishes the loaded files to Monaco, which also revalidates open models.
  function applyLibs() {
    const libs = allLibs().map(({ filePath, content }) => ({
      filePath,
      content,
    }));
    for (const defaults of defaultsFor()) defaults.setExtraLibs(libs);
  }
  // Monaco registers its TypeScript service shortly after the first model of
  // that language appears, so asking too early throws and is retried.
  async function languageWorker(language: string, uri: Monaco.Uri) {
    const get =
      language === "javascript"
        ? monaco.typescript.getJavaScriptWorker
        : monaco.typescript.getTypeScriptWorker;
    for (let attempt = 0; ; attempt++) {
      try {
        return await (
          await get()
        )(uri);
      } catch (error) {
        if (attempt >= 50 || disposed) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }
  async function loadProject(mode: "open" | "refresh" | "full" = "open") {
    const doc = p.document;
    if (!native || !ready() || !project) return;
    const script = !!doc && !doc.readOnly && scripts.includes(doc.language);
    if (!script && mode === "open") return;
    if (loading) {
      queued = queued === "full" || mode === "full" ? "full" : queued || mode;
      return;
    }
    loading = true;
    const files = project;
    try {
      if (!script) {
        // No language service is running; just keep the files current.
        await files.refresh(mode === "full");
        applyLibs();
        return;
      }
      p.onProjectStatus("INDEXING");
      const model = ensureModel(doc!);
      const worker = (await languageWorker(
        doc!.language,
        model.uri,
      )) as unknown as ProjectScanner;
      // While loading, files go straight to the worker with stable versions.
      const push = () =>
        worker.updateExtraLibs(
          Object.fromEntries(
            allLibs(files).map((lib) => [
              lib.filePath,
              { content: lib.content, version: lib.version },
            ]),
          ),
        );
      if (mode !== "open") {
        await files.refresh(mode === "full");
        await push();
      }
      const complete = await resolveProject(
        files,
        () => worker.scanProject(model.uri.toString()),
        push,
      );
      if (project === files) {
        applyLibs();
        p.onProjectStatus(complete ? "PROJECT" : "PARTIAL");
      }
    } catch (error) {
      if (project === files) {
        p.onProjectStatus("INDEX ERROR");
        p.onProjectError(
          typeof error === "object" && error && "message" in error
            ? String(error.message)
            : String(error),
        );
      }
    } finally {
      loading = false;
      const next = queued;
      queued = undefined;
      if (next) void loadProject(next);
    }
  }
  function scheduleProjectLoad() {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => void loadProject(), 700);
  }
  function updateTheme() {
    const tokens = themeTokens(p.colors, p.contrast);
    monaco.editor.defineTheme("r-console", {
      base: "vs-dark",
      inherit: true,
      rules: [
        {
          token: "comment",
          foreground: tokens.muted.slice(1),
          fontStyle: "italic",
        },
        { token: "keyword", foreground: p.colors.accent.slice(1) },
        { token: "string", foreground: "8FBF9F" },
        { token: "number", foreground: "C7A3D6" },
        { token: "type", foreground: p.colors.teal.slice(1) },
        { token: "delimiter", foreground: tokens.secondary.slice(1) },
      ],
      colors: {
        "editorError.foreground": diagnosticColors.error,
        "editorWarning.foreground": diagnosticColors.warning,
        "editorHint.foreground": diagnosticColors.hint,
        "editorOverviewRuler.errorForeground": diagnosticColors.error,
        "editorOverviewRuler.warningForeground": diagnosticColors.warning,
        "editorOverviewRuler.infoForeground": diagnosticColors.hint,
        "minimap.errorHighlight": diagnosticColors.error,
        "minimap.warningHighlight": diagnosticColors.warning,
        "editorMarkerNavigationError.background": diagnosticColors.error,
        "editorMarkerNavigationWarning.background": diagnosticColors.warning,
        "editorInlayHint.foreground": diagnosticColors.hint,
        "editorInlayHint.typeForeground": diagnosticColors.hint,
        "editorInlayHint.parameterForeground": diagnosticColors.hint,
        "editor.background": tokens.canvas,
        "editor.foreground": tokens.text,
        "editorLineNumber.foreground": tokens.muted,
        "editorLineNumber.activeForeground": tokens.amber,
        "editor.lineHighlightBackground": tokens.surface,
        "editor.selectionBackground": tokens.border,
        "editorCursor.foreground": tokens.amber,
        "editorIndentGuide.background1": tokens.border,
        "editorWidget.background": tokens.raised,
        "editorWidget.border": tokens.strong,
        "editorSuggestWidget.background": tokens.surface,
        "editorSuggestWidget.border": tokens.strong,
        "editorHoverWidget.background": tokens.surface,
        "editorHoverWidget.border": tokens.strong,
        focusBorder: tokens.amber,
        "scrollbarSlider.background": tokens.strong + "55",
      },
    });
  }
  onMount(async () => {
    const m = await import("./monaco");
    if (disposed) return;
    monaco = m;
    updateTheme();
    editor = m.editor.create(host, {
      theme: "r-console",
      editContext: false,
      fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
      fontSize: p.fontSize,
      lineHeight: 22,
      automaticLayout: true,
      minimap: { enabled: p.minimap },
      padding: { top: 20, bottom: 20 },
      scrollBeyondLastLine: false,
      wordWrap: p.wrap ? "on" : "off",
      renderLineHighlight: "line",
      cursorBlinking: "solid",
      smoothScrolling: false,
      tabSize: 2,
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      stickyScroll: { enabled: false },
      quickSuggestions: { other: true, comments: false, strings: false },
      suggestOnTriggerCharacters: true,
      parameterHints: { enabled: true },
      hover: { enabled: true },
      inlayHints: { enabled: "on" },
      renderValidationDecorations: "on",
      lightbulb: { enabled: "on" as Monaco.editor.ShowLightbulbIconMode },
    });
    editor.onDidChangeCursorPosition((e) =>
      p.onPosition(e.position.lineNumber, e.position.column),
    );
    const markers = monaco.editor.onDidChangeMarkers(reportProblems);
    const opener = monaco.editor.registerEditorOpener({
      openCodeEditor: (_source, uri, selection) => {
        const doc = p.documents.find(
          (doc) => models.get(doc.id)?.uri.toString() === uri.toString(),
        );
        const pathId = project?.pathId(uri.toString(true));
        if (!doc && !pathId) return false;
        const line =
          selection && "startLineNumber" in selection
            ? selection.startLineNumber
            : selection?.lineNumber || 1;
        const column =
          selection && "startColumn" in selection
            ? selection.startColumn
            : selection?.column || 1;
        p.onOpenDocument(doc?.id || pathId!, line, column);
        return true;
      },
    });
    disposables.push(markers, opener);
    setReady(true);
    activate(p.document);
    p.onReady({
      documentText: (id) => models.get(id)?.getValue(),
      saveText: () => {
        editor?.pushUndoStop();
        return editor?.getValue() || "";
      },
      markSaved: (id, text) => {
        saved.set(id, normalized(text));
        const model = models.get(id);
        return !!model && normalized(model.getValue()) !== normalized(text);
      },
      reloadSaved: (doc) => {
        saved.set(doc.id, normalized(doc.text));
        const model = models.get(doc.id);
        if (model) {
          model.pushStackElement();
          model.pushEditOperations(
            [],
            [{ range: model.getFullModelRange(), text: doc.text }],
            () => null,
          );
          model.pushStackElement();
        }
      },
      focus: () => editor?.focus(),
      select: (line, column, end) => {
        editor?.setSelection({
          startLineNumber: line,
          startColumn: column,
          endLineNumber: line,
          endColumn: end || column,
        });
        editor?.revealLineInCenter(line);
        editor?.focus();
      },
      format: async () => {
        const action = editor?.getAction("editor.action.formatDocument");
        if (!action?.isSupported()) return false;
        await action.run();
        return true;
      },
      insert: (t) => {
        const selection = editor?.getSelection();
        if (selection)
          editor?.executeEdits("insert", [{ range: selection, text: t }]);
      },
      getVersion: () => editor?.getModel()?.getVersionId() || 0,
      replace: (t) => {
        const model = editor?.getModel();
        if (model) {
          editor?.pushUndoStop();
          editor?.executeEdits("format", [
            { range: model.getFullModelRange(), text: t },
          ]);
          editor?.pushUndoStop();
        }
      },
      setOption: (key, value) => editor?.updateOptions({ [key]: value }),
      reloadProject: (full) => void loadProject(full ? "full" : "refresh"),
    });
  });
  // A new workspace starts with an empty project and drops stray models of the
  // previous one.
  createEffect(() => {
    if (!ready()) return;
    const id = p.workspaceId;
    project = new ProjectFiles(id, (paths) => api.projectRead(id, paths));
    applyLibs();
    const workspacePrefix = `/${id}/`;
    onCleanup(() => {
      for (const model of monaco.editor.getModels()) {
        if (
          model.uri.path.startsWith(workspacePrefix) &&
          ![...models.values()].includes(model)
        )
          model.dispose();
      }
    });
  });
  createEffect(() => {
    openPaths();
    if (ready()) applyLibs();
  });
  createEffect(() => {
    if (!ready()) return;
    p.workspaceId;
    if (p.document?.id) untrack(() => void loadProject());
  });
  createEffect(() => {
    if (!ready()) return;
    for (const doc of p.documents) ensureModel(doc);
    activate(p.document);
    for (const [id, model] of models) {
      if (!p.openIds.includes(id)) {
        if (editor?.getModel() === model) editor.setModel(null);
        model.dispose();
        models.delete(id);
        saved.delete(id);
        views.delete(id);
      }
    }
    reportProblems();
  });
  createEffect(() => {
    if (!ready()) return;
    updateTheme();
    editor?.updateOptions({
      fontSize: p.fontSize,
      wordWrap: p.wrap ? "on" : "off",
      minimap: { enabled: p.minimap },
      readOnly: !!p.document?.readOnly || p.readOnly,
    });
  });
  onCleanup(() => {
    disposed = true;
    clearTimeout(typingTimer);
    disposables.forEach((subscription) => subscription.dispose());
    editor?.dispose();
    models.forEach((m) => m.dispose());
    for (const defaults of [
      monaco?.typescript.typescriptDefaults,
      monaco?.typescript.javascriptDefaults,
    ])
      defaults?.setExtraLibs([]);
  });
  return <div class="editor-mount" ref={host} aria-label="Code editor" />;
}
