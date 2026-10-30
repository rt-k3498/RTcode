import { typescript, json } from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import TypeScriptWorker from "./typescript.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";

self.MonacoEnvironment = {
  getWorker: (_moduleId, label) => {
    if (label === "typescript" || label === "javascript")
      return new TypeScriptWorker();
    if (label === "json") return new JsonWorker();
    if (["css", "scss", "less"].includes(label)) return new CssWorker();
    if (["html", "handlebars", "razor"].includes(label))
      return new HtmlWorker();
    return new EditorWorker();
  },
};
for (const defaults of [
  typescript.typescriptDefaults,
  typescript.javascriptDefaults,
]) {
  defaults.setCompilerOptions({
    target: typescript.ScriptTarget.ESNext,
    module: typescript.ModuleKind.ESNext,
    moduleResolution: typescript.ModuleResolutionKind.NodeJs,
    jsx: typescript.JsxEmit.Preserve,
    allowNonTsExtensions: true,
    allowJs: true,
    checkJs: true,
    strict: true,
    noEmit: true,
    allowSyntheticDefaultImports: true,
  });
  defaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: false,
  });
  defaults.setEagerModelSync(true);
  defaults.setInlayHintsOptions({
    includeInlayParameterNameHints: "literals",
    includeInlayVariableTypeHints: true,
    includeInlayFunctionLikeReturnTypeHints: true,
    includeInlayPropertyDeclarationTypeHints: true,
    includeInlayEnumMemberValueHints: true,
  });
}
json.jsonDefaults.setDiagnosticsOptions({
  validate: true,
  allowComments: false,
  enableSchemaRequest: false,
  schemas: [],
});
export * from "monaco-editor";
