// The Monaco entry exports the same TypeScript engine used by its adapters.
import {
  initialize,
  TypeScriptWorker,
  ts,
} from "monaco-editor/esm/vs/language/typescript/ts.worker.js";
import { projectWorker } from "./project-worker";
const Worker = projectWorker(TypeScriptWorker, ts.typescript);
self.onmessage = () =>
  initialize((context: unknown, data: unknown) => new Worker(context, data));
