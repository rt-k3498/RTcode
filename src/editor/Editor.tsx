import {
  onMount,
  onCleanup,
  createEffect,
  createSignal,
  createMemo,
} from "solid-js";
import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import { themeTokens, diagnosticColors, type Palette } from "../theme/colors";
import type { Document, ProjectSnapshot } from "../ipc/types";
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
};
export default function Editor(p: {
  document?: Document;
  openIds: string[];
  documents: Document[];
  workspaceId: string;
  project?: ProjectSnapshot;
  readOnly?: boolean;
  onProblems: (problems: Problem[]) => void;
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
      model.onDidChangeContent(() =>
        p.onChange(doc.id, normalized(model!.getValue()) !== saved.get(doc.id)),
      );
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
        const projectFile = p.project?.files.find(
          (file) =>
            monaco.Uri.from({
              scheme: "file",
              path: `/${p.workspaceId}/${file.path}`,
            }).toString() === uri.toString(),
        );
        if (!doc && !projectFile) return false;
        const line =
          selection && "startLineNumber" in selection
            ? selection.startLineNumber
            : selection?.lineNumber || 1;
        const column =
          selection && "startColumn" in selection
            ? selection.startColumn
            : selection?.column || 1;
        p.onOpenDocument(doc?.id || projectFile!.pathId, line, column);
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
    });
  });
  createEffect(() => {
    if (!ready()) return;
    const libs = (p.project?.files || []).map((file) => ({
      filePath: monaco.Uri.from({
        scheme: "file",
        path: `/${p.workspaceId}/${file.path}`,
      }).toString(),
      content: file.content,
    }));
    libs.push({
      filePath: "rtcode://project",
      content: JSON.stringify(
        Object.fromEntries(
          (p.project?.files || [])
            .filter(
              (file) => file.canonicalPath && file.canonicalPath !== file.path,
            )
            .map((file) => [
              monaco.Uri.from({
                scheme: "file",
                path: `/${p.workspaceId}/${file.path}`,
              }).toString(),
              monaco.Uri.from({
                scheme: "file",
                path: `/${p.workspaceId}/${file.canonicalPath}`,
              }).toString(),
            ]),
        ),
      ),
    });
    libs.push({
      filePath: "rtcode://open-files",
      content: JSON.stringify(
        (JSON.parse(openPaths()) as string[]).map((path) =>
          monaco.Uri.from({ scheme: "file", path }).toString(),
        ),
      ),
    });
    for (const defaults of [
      monaco.typescript.typescriptDefaults,
      monaco.typescript.javascriptDefaults,
    ]) {
      defaults.setExtraLibs(libs);
      // Revalidate open models against refreshed configuration and disk content.
      defaults.setCompilerOptions(defaults.getCompilerOptions());
    }
    const workspacePrefix = `/${p.workspaceId}/`;
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
