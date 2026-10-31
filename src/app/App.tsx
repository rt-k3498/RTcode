import {
  createSignal,
  createMemo,
  createEffect,
  on,
  onMount,
  onCleanup,
  For,
  Show,
  lazy,
  Suspense,
} from "solid-js";
import { api, native } from "../ipc/client";
import { demoOpen, demoTree, sampleWorkspace, emptyGit } from "../ipc/demo";
import type {
  Document,
  Entry,
  Workspace,
  GitState,
  GitWorktree,
  Match,
  Change,
  SearchOptions,
  FileMatch,
} from "../ipc/types";
import { errorMessage } from "../ipc/types";
import { Icon } from "../components/Icon";
import type { EditorHandle, Problem } from "../editor/Editor";
import Terminal, { type TerminalHandle } from "../terminal/Terminal";
import { themeTokens } from "../theme/colors";
import Settings from "./Settings";
import {
  defaults,
  normalizePreferences,
  normalizeLayout,
  type Preferences,
  type TerminalPosition,
} from "./preferences";
const Editor = lazy(() => import("../editor/Editor"));
type OpenDoc = Document & { dirty: boolean };
type Dialog = {
  title: string;
  body: string;
  action: string;
  run: (value: string) => void | Promise<void>;
  input?: string;
  danger?: boolean;
  alternate?: { action: string; run: () => Promise<void>; danger?: boolean };
};
export default function App() {
  const [workspaces, setWorkspaces] = createSignal<Workspace[]>(
    native ? [] : [sampleWorkspace],
  );
  const [workspaceId, setWorkspaceId] = createSignal(
    native ? "" : sampleWorkspace.id,
  );
  const workspace = () => workspaces().find((ws) => ws.id === workspaceId());
  const workspaceColors = new Map<string, string>();
  let nextWorkspaceColor = 0;
  function workspaceColor(id?: string) {
    if (!id) return "var(--amber)";
    if (!workspaceColors.has(id)) {
      const colors = [
        "#faa968",
        "#5db7a5",
        "#9ebcf5",
        "#d8a0df",
        "#e7ce78",
        "#f49baf",
      ];
      const index = nextWorkspaceColor++;
      workspaceColors.set(
        id,
        colors[index] || `hsl(${(index * 137.508) % 360} 65% 72%)`,
      );
    }
    return workspaceColors.get(id)!;
  }
  let workspaceMenu!: HTMLDivElement;
  let workspaceButton!: HTMLButtonElement;
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = createSignal(false);
  function selectWorkspace(ws: Workspace) {
    if (workspaceId() === ws.id) return;
    gitRequest++;
    setGitBusy(false);
    setWorkspaceId(ws.id);
    setGit(emptyGit);
  }
  function showWorkspaceMenu() {
    const bounds = workspaceButton.getBoundingClientRect();
    workspaceMenu.style.left = `${bounds.left}px`;
    workspaceMenu.style.top = `${bounds.bottom + 5}px`;
    workspaceMenu.togglePopover();
  }
  // The editor loads project files lazily and reports its status here.
  const [projectStatus, setProjectStatus] = createSignal("");
  const reloadProject = (full = false) => editor?.reloadProject(full);
  const [roots, setRoots] = createSignal<Record<string, Entry[]>>(
    native ? {} : { [sampleWorkspace.id]: demoTree() },
  );
  const [collapsedRoots, setCollapsedRoots] = createSignal<Set<string>>(
    new Set(),
  );
  const [children, setChildren] = createSignal<Record<string, Entry[]>>(
    native ? {} : { src: demoTree("src") },
  );
  const [expanded, setExpanded] = createSignal<Set<string>>(
    new Set(native ? [] : ["src"]),
  );
  const [sidebar, setSidebar] = createSignal("files");
  const [sidebarVisible, setSidebarVisible] = createSignal(true);
  const [width, setWidth] = createSignal(248);
  const [terminalWidth, setTerminalWidth] = createSignal(36);
  const [placement, setPlacement] = createSignal<TerminalPosition[]>(["right"]);
  const [focusedTerminal, setFocusedTerminal] =
    createSignal<TerminalPosition>("right");
  const terminalPanes: Partial<Record<TerminalPosition, TerminalHandle>> = {};
  const selectedTerminal = () =>
    placement().includes(focusedTerminal())
      ? focusedTerminal()
      : placement()[0] || "right";
  function changePlacement(next: TerminalPosition[]) {
    setPlacement(next);
    void guard(() =>
      api.set("layout", {
        sidebarWidth: width(),
        terminalWidth: terminalWidth(),
        placement: next,
      }),
    );
  }
  function showTerminal(position: TerminalPosition) {
    if (!placement().includes(position))
      changePlacement([...placement(), position]);
    setFocusedTerminal(position);
  }
  function toggleTerminal(position: TerminalPosition) {
    changePlacement(
      placement().includes(position)
        ? placement().filter((p) => p !== position)
        : [...placement(), position],
    );
  }
  const [docs, setDocs] = createSignal<OpenDoc[]>(
    native
      ? []
      : [
          {
            ...demoOpen("src/main.ts"),
            workspaceId: sampleWorkspace.id,
            dirty: false,
          },
          {
            ...demoOpen("README.md"),
            workspaceId: sampleWorkspace.id,
            dirty: false,
          },
        ],
  );
  const [activeId, setActiveId] = createSignal(native ? "" : "src/main.ts");
  const active = () => docs().find((d) => d.id === activeId());
  const editorWorkspace = createMemo(
    () =>
      workspaces().find((ws) => ws.id === active()?.workspaceId) || workspace(),
  );
  const [position, setPosition] = createSignal([1, 1]);
  const [problems, setProblems] = createSignal<Problem[]>([]);
  const [problemsVisible, setProblemsVisible] = createSignal(false);
  const languageService = () => {
    if (!active() || active()?.readOnly) return "—";
    return [
      "typescript",
      "javascript",
      "json",
      "css",
      "scss",
      "less",
      "html",
    ].includes(active()!.language)
      ? ["typescript", "javascript"].includes(active()!.language) && native
        ? projectStatus() || "INDEXING"
        : "BUILT-IN"
      : "SYNTAX ONLY";
  };
  const [git, setGit] = createSignal<GitState>(emptyGit);
  const [gitBusy, setGitBusy] = createSignal(false);
  let gitRequest = 0;
  const [notice, setNotice] = createSignal("");
  const [settings, setSettings] = createSignal(false);
  const [settingsTab, setSettingsTab] = createSignal("Guide");
  const [article, setArticle] = createSignal("welcome");
  const [prefs, setPrefs] = createSignal<Preferences>(defaults);
  const [dialog, setDialog] = createSignal<Dialog>();
  const [dialogValue, setDialogValue] = createSignal("");
  const [dialogBusy, setDialogBusy] = createSignal(false);
  const [dialogError, setDialogError] = createSignal("");
  const [palette, setPalette] = createSignal(false);
  const [commandQuery, setCommandQuery] = createSignal("");
  const [ssh, setSsh] = createSignal(false);
  const [sshAlias, setSshAlias] = createSignal("");
  const [hosts, setHosts] = createSignal<string[]>([]);
  const [terminalStates, setTerminalStates] = createSignal({
    right: "OFFLINE",
    bottom: "OFFLINE",
  });
  const terminalState = () => terminalStates()[selectedTerminal()];
  const [query, setQuery] = createSignal("");
  const [regex, setRegex] = createSignal(false);
  const [caseSensitive, setCase] = createSignal(false);
  const [wholeWord, setWhole] = createSignal(false);
  const [include, setInclude] = createSignal("");
  const [exclude, setExclude] = createSignal("");
  const [results, setResults] = createSignal<Match[]>([]);
  // "filter" searches file contents with include/exclude and replace;
  // "files" finds files by name.
  const [searchMode, setSearchMode] = createSignal<"filter" | "files">(
    "filter",
  );
  const [fileResults, setFileResults] = createSignal<FileMatch[]>([]);
  const [fileTotal, setFileTotal] = createSignal(0);
  const [searchState, setSearchState] = createSignal("IDLE");
  const [searchError, setSearchError] = createSignal("");
  const [replacement, setReplacement] = createSignal("");
  const [showReplace, setShowReplace] = createSignal(false);
  const [replaceBusy, setReplaceBusy] = createSignal(false);
  const [switching, setSwitching] = createSignal(false);
  const [replaceErrors, setReplaceErrors] = createSignal<string[]>([]);
  const [searchSkipped, setSearchSkipped] = createSignal(0);
  const searchOptions = (): SearchOptions => ({
    query: query(),
    regex: regex(),
    caseSensitive: caseSensitive(),
    wholeWord: wholeWord(),
    include: include(),
    exclude: exclude(),
  });
  function replaceResults(matches: Match[]) {
    if (replaceBusy() || searchState() !== "DONE" || !matches.length) return;
    const ws = workspace();
    if (!ws) return;
    const options = searchOptions();
    const value = replacement();
    const paths = new Set(matches.map((match) => match.pathId));
    const apply = async () => {
      if (workspace()?.id !== ws.id) return;
      if (saving.size || docs().some((doc) => paths.has(doc.id) && doc.dirty)) {
        report("Save or close modified matching files before replacing.");
        return;
      }
      setReplaceBusy(true);
      setReplaceErrors([]);
      try {
        const result = await api.replaceMatches(ws.id, options, matches, value);
        for (const doc of result.updated) editor?.reloadSaved(doc);
        setDocs((docs) =>
          docs.map((doc) => {
            const updated = result.updated.find((item) => item.id === doc.id);
            return updated
              ? { ...updated, workspaceId: doc.workspaceId, dirty: false }
              : doc;
          }),
        );
        setReplaceErrors(result.errors);
        report(
          `Replaced ${result.replacements} match${result.replacements === 1 ? "" : "es"} in ${result.updated.length} file${result.updated.length === 1 ? "" : "s"}.`,
        );
        editor?.reloadProject();
        void runSearch();
      } catch (error) {
        setReplaceErrors([errorMessage(error)]);
      } finally {
        setReplaceBusy(false);
      }
    };
    ask({
      title: `Replace ${matches.length} match${matches.length === 1 ? "" : "es"}?`,
      body: `Write changes to ${paths.size} file${paths.size === 1 ? "" : "s"}${native ? " on disk" : " in the sample workspace"}. ${value ? `Replacement: ${value}` : "Matches will be deleted."} Changed files are skipped.`,
      action: "Replace",
      run: apply,
    });
  }
  const [formatState, setFormatState] = createSignal("FORMAT");
  let editor: EditorHandle | undefined;
  const terminal: TerminalHandle = {
    create: async (alias) => {
      const position = selectedTerminal();
      showTerminal(position);
      await terminalPanes[position]?.create(alias);
    },
    focus: () => {
      const position = selectedTerminal();
      showTerminal(position);
      terminalPanes[position]?.focus();
    },
    hasLive: (workspaceId) =>
      Object.values(terminalPanes).some((pane) => pane.hasLive(workspaceId)),
    closeAll: async (workspaceId) => {
      await Promise.all(
        Object.values(terminalPanes).map((pane) => pane.closeAll(workspaceId)),
      );
    },
    closeActive: async () => {
      await terminalPanes[selectedTerminal()]?.closeActive();
    },
  };
  let priorFocus: HTMLElement | null = null;
  let searchId = "";
  const saving = new Set<string>();
  let picking = false;
  let noticeTimer: ReturnType<typeof setTimeout>;
  let dialogElement!: HTMLDialogElement;
  let paletteElement!: HTMLDialogElement;
  const report = (s: string) => {
    setNotice(s);
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => setNotice(""), 6500);
  };
  const guard = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      report(errorMessage(e));
    }
  };
  function ask(d: Dialog) {
    setDialogError("");
    setDialogValue(d.input || "");
    setDialog(d);
    queueMicrotask(() => dialogElement?.showModal());
  }
  const treeRequests = new Map<string, number>();
  async function readTree(ws: Workspace, pathId: string) {
    const request = (treeRequests.get(pathId) || 0) + 1;
    treeRequests.set(pathId, request);
    const values = await api.tree(ws.id, pathId);
    if (
      treeRequests.get(pathId) !== request ||
      !workspaces().some((root) => root.id === ws.id)
    )
      return;
    if (pathId === ws.rootId)
      setRoots((previous) => ({ ...previous, [ws.id]: values }));
    else setChildren((previous) => ({ ...previous, [pathId]: values }));
    return values;
  }
  async function refreshTree(ws?: Workspace) {
    async function refreshBranch(
      root: Workspace,
      pathId: string,
    ): Promise<void> {
      const values = await readTree(root, pathId);
      await Promise.all(
        (values || [])
          .filter((entry) => entry.directory && expanded().has(entry.id))
          .map((entry) => refreshBranch(root, entry.id)),
      );
    }
    await Promise.all(
      (ws ? [ws] : workspaces()).map((root) =>
        refreshBranch(root, root.rootId),
      ),
    );
  }
  async function addWorkspace(open: () => Promise<Workspace | null>) {
    if (picking) return;
    picking = true;
    setSwitching(true);
    await guard(async () => {
      const opened = await open();
      if (!opened) return;
      const ws =
        workspaces().find(
          (ws) => ws.id === opened.id || ws.displayPath === opened.displayPath,
        ) || opened;
      setWorkspaces((all) =>
        all.some((root) => root.id === ws.id) ? all : [...all, ws],
      );
      selectWorkspace(ws);
      setCollapsedRoots(
        (old) => new Set([...old].filter((id) => id !== ws.id)),
      );
      await refreshTree(ws);
    });
    picking = false;
    setSwitching(false);
  }
  async function openWorkspace() {
    workspaceMenu?.hidePopover();
    await addWorkspace(api.openWorkspace);
  }
  async function saveWorkspaceChanges(id: string) {
    for (const doc of docs().filter(
      (doc) => doc.workspaceId === id && doc.dirty && !doc.readOnly,
    )) {
      const text = editor?.documentText(doc.id);
      if (text === undefined)
        throw Error(
          `Could not read ${doc.name}. Your workspace has not changed.`,
        );
      saving.add(doc.id);
      try {
        const revision = await api.save(doc.id, doc.revision, text);
        const dirty = editor!.markSaved(doc.id, text);
        setDocs((all) =>
          all.map((item) =>
            item.id === doc.id ? { ...item, text, revision, dirty } : item,
          ),
        );
        if (dirty)
          throw Error(
            `${doc.name} changed during save. Review it before closing the workspace.`,
          );
      } finally {
        saving.delete(doc.id);
      }
    }
  }
  function removeWorkspace(ws: Workspace) {
    workspaceMenu.hidePopover();
    const remove = async (saveChanges: boolean) => {
      if (picking || switching() || replaceBusy() || saving.size)
        throw Error("Wait for the current operation to finish.");
      if (!workspaces().some((root) => root.id === ws.id)) return;
      picking = true;
      setSwitching(true);
      try {
        if (saveChanges) await saveWorkspaceChanges(ws.id);
        await api.closeWorkspace(ws.id);
        await terminal
          .closeAll(ws.id)
          .catch((error) => report(errorMessage(error)));
        setDocs((all) => all.filter((doc) => doc.workspaceId !== ws.id));
        if (!docs().some((doc) => doc.id === activeId()))
          setActiveId(docs().at(-1)?.id || "");
        const wasSelected = workspaceId() === ws.id;
        setWorkspaces((all) => all.filter((root) => root.id !== ws.id));
        if (wasSelected) {
          setWorkspaceId(workspaces()[0]?.id || "");
          setGit(emptyGit);
        }
        const paths = new Set([ws.rootId]);
        const collect = (entries: Entry[]) =>
          entries.forEach((entry) => {
            paths.add(entry.id);
            if (entry.directory) collect(children()[entry.id] || []);
          });
        collect(roots()[ws.id] || []);
        setRoots((all) => {
          const next = { ...all };
          delete next[ws.id];
          return next;
        });
        setChildren((all) =>
          Object.fromEntries(
            Object.entries(all).filter(([id]) => !paths.has(id)),
          ),
        );
        setExpanded((all) => new Set([...all].filter((id) => !paths.has(id))));
        setCollapsedRoots(
          (all) => new Set([...all].filter((id) => id !== ws.id)),
        );
        paths.forEach((id) => treeRequests.delete(id));
      } finally {
        picking = false;
        setSwitching(false);
      }
    };
    const dirty = docs().filter(
      (doc) => doc.workspaceId === ws.id && doc.dirty,
    );
    if (dirty.length) {
      ask({
        title: "Save changes before removing workspace?",
        body: `${ws.name} has ${dirty.length} modified file${dirty.length === 1 ? "" : "s"}. Its files and terminals will close. The folder stays on disk.`,
        action: "Save all & remove",
        run: () => remove(true),
        alternate: {
          action: "Don’t save & remove",
          danger: true,
          run: () => remove(false),
        },
      });
    } else if (terminal.hasLive(ws.id)) {
      ask({
        title: `Remove ${ws.name}?`,
        body: "Its files and running terminals will close. The folder stays on disk.",
        action: "Remove workspace",
        run: () => remove(false),
      });
    } else void guard(() => remove(false));
  }
  function openWorktree(tree: GitWorktree) {
    const source = workspace();
    if (!source || tree.current || !tree.available) return;
    const replace = async (saveChanges: boolean) => {
      if (picking || replaceBusy() || saving.size)
        throw Error("Wait for the current operation to finish.");
      picking = true;
      setSwitching(true);
      try {
        if (saveChanges) await saveWorkspaceChanges(source.id);
        const opened = await api.openWorktree(source.id, tree.path);
        if (opened.id === source.id) return;
        // Open successfully before releasing any of the source workspace.
        await api.closeWorkspace(source.id);
        await terminal
          .closeAll(source.id)
          .catch((error) => report(errorMessage(error)));
        setDocs((all) => all.filter((doc) => doc.workspaceId !== source.id));
        if (!docs().some((doc) => doc.id === activeId()))
          setActiveId(docs().at(-1)?.id || "");
        setWorkspaces((all) =>
          all.some((ws) => ws.id === opened.id)
            ? all.filter((ws) => ws.id !== source.id)
            : all.map((ws) => (ws.id === source.id ? opened : ws)),
        );
        selectWorkspace(opened);
        await refreshTree(opened);
      } finally {
        picking = false;
        setSwitching(false);
      }
    };
    const confirmReplace = async () => {
      const dirty = docs().filter(
        (doc) => doc.workspaceId === source.id && doc.dirty,
      );
      if (dirty.length) {
        ask({
          title: "Save changes before replacing workspace?",
          body: `${dirty.length} modified file(s) in ${source.name}. Its terminals will close. Other workspaces stay open.`,
          action: "Save all & replace",
          run: () => replace(true),
          alternate: {
            action: "Don’t save & replace",
            danger: true,
            run: () => replace(false),
          },
        });
      } else {
        ask({
          title: `Replace ${source.name}?`,
          body: `Its open files and terminals will close. Other workspaces stay open.`,
          action: "Replace workspace",
          run: () => replace(false),
        });
      }
    };
    ask({
      title: "Open worktree",
      body: `${tree.path}\n\nAdd it alongside your open folders, or replace ${source.name}.`,
      action: "Add workspace",
      run: () => addWorkspace(() => api.openWorktree(source.id, tree.path)),
      alternate: { action: "Replace workspace", run: confirmReplace },
    });
  }
  async function runDialogAction(
    run: (() => void | Promise<void>) | undefined,
  ) {
    const current = dialog();
    if (dialogBusy()) return;
    setDialogError("");
    setDialogBusy(true);
    try {
      await run?.();
      if (dialog() === current) setDialog(undefined);
    } catch (error) {
      setDialogError(errorMessage(error));
    } finally {
      setDialogBusy(false);
    }
  }
  async function openFile(
    id: string,
    line?: number,
    column?: number,
    end?: number,
    source = workspace(),
  ) {
    await guard(async () => {
      let doc = docs().find((d) => d.id === id);
      if (!doc) {
        if (docs().length >= 20) {
          report("Close a tab before opening another (limit: 20).");
          return;
        }
        const ws = source;
        if (!ws) return;
        const opened = await api.open(ws.id, id);
        if (!workspaces().some((root) => root.id === ws.id)) return;
        doc = docs().find(
          (d) =>
            d.id === id ||
            (!d.readOnly &&
              d.workspaceId === ws.id &&
              d.relativePath === opened.relativePath),
        );
        if (!doc) {
          if (docs().length >= 20) return;
          doc = { ...opened, workspaceId: ws.id, dirty: false };
          setDocs((v) => [...v, doc!]);
        }
      }
      setActiveId(doc.id);
      if (line)
        setTimeout(() => {
          if (activeId() === id) editor?.select(line, column || 1, end);
        }, 80);
    });
  }
  async function save(overwrite = false, documentId = activeId()) {
    const doc = docs().find((d) => d.id === documentId);
    if (
      !doc ||
      doc.readOnly ||
      !editor ||
      activeId() !== doc.id ||
      saving.has(doc.id) ||
      switching() ||
      replaceBusy()
    )
      return;
    saving.add(doc.id);
    try {
      const text = editor?.saveText() ?? doc.text;
      const revision = await api.save(doc.id, doc.revision, text, overwrite);
      const dirty = editor.markSaved(doc.id, text);
      setDocs((v) =>
        v.map((d) => (d.id === doc.id ? { ...d, text, revision, dirty } : d)),
      );
      reloadProject();
      report(
        native
          ? "Saved " + doc.name
          : "Saved to the sample workspace (memory only).",
      );
    } catch (e) {
      if (typeof e === "object" && e && "code" in e && e.code === "conflict") {
        ask({
          title: "File changed on disk",
          body: "Your edits are preserved. Overwriting replaces the external version. Cancel to keep editing or copy your buffer first.",
          action: "Overwrite disk version",
          danger: true,
          run: () => save(true, doc.id),
        });
      } else report(errorMessage(e));
    } finally {
      saving.delete(doc.id);
    }
  }
  function closeDoc(id: string) {
    if (switching() || replaceBusy()) {
      report("Wait for the current operation to finish before closing a file.");
      return;
    }
    if (saving.has(id)) {
      report("Wait for this file to finish saving before closing it.");
      return;
    }
    const doc = docs().find((d) => d.id === id);
    const close = () => {
      setDocs((v) => v.filter((d) => d.id !== id));
      if (activeId() === id) setActiveId(docs().at(-1)?.id || "");
    };
    if (doc?.dirty)
      ask({
        title: "Discard unsaved changes?",
        body: `${doc.name} has unsaved edits. Cancel and save to keep them.`,
        action: "Discard & close",
        danger: true,
        run: close,
      });
    else close();
  }
  function openSettings(tab = "Guide", id = "welcome") {
    priorFocus = document.activeElement as HTMLElement;
    setSettingsTab(tab);
    setArticle(id);
    setSettings(true);
    setPalette(false);
    setSsh(false);
  }
  function closeSettings() {
    setSettings(false);
    queueMicrotask(() => priorFocus?.focus());
  }
  async function updatePref(key: keyof Preferences, value: unknown) {
    setPrefs((v) => ({ ...v, [key]: value }));
    await guard(() => api.set("preferences", prefs()));
  }
  function trust(target = workspace(), afterTrust?: () => void) {
    if (!native) {
      report(
        "The sample workspace cannot execute tools. Open the native desktop app.",
      );
      return;
    }
    const ws = target;
    if (!ws) {
      report("Open a folder first.");
      return;
    }
    ask({
      title: ws.trusted ? "Revoke workspace trust?" : "Trust this workspace?",
      body: `${ws.displayPath}\n\n${ws.trusted ? "Active shells will be closed." : "Shell initialization, Git filters, and formatters can execute code with your user permissions."}`,
      action: ws.trusted ? "Revoke trust" : "Trust this exact folder",
      run: async () => {
        if (ws.trusted) await terminal?.closeAll(ws.id);
        await api.trust(ws.id, !ws.trusted);
        setWorkspaces((all) =>
          all.map((root) =>
            root.id === ws.id ? { ...root, trusted: !ws.trusted } : root,
          ),
        );
        if (!ws.trusted) afterTrust?.();
      },
    });
  }
  async function refreshGit() {
    const ws = workspace();
    if (!ws) return;
    const request = ++gitRequest;
    setGitBusy(true);
    try {
      const snapshot = await api.git(ws.id);
      if (request === gitRequest && workspace()?.id === ws.id) setGit(snapshot);
    } catch (e) {
      if (request === gitRequest) report(errorMessage(e));
    } finally {
      if (request === gitRequest) setGitBusy(false);
    }
  }
  async function gitAction(action: string, path: string) {
    if (!workspace()?.trusted) {
      trust();
      return;
    }
    await guard(async () => {
      await api.gitAction(workspace()!.id, action, path);
      await refreshGit();
    });
  }
  async function openGitFile(change: Change) {
    const existing = docs().find(
      (doc) =>
        !doc.readOnly &&
        doc.workspaceId === workspace()?.id &&
        doc.relativePath === change.path,
    );
    const id =
      existing?.id ?? change.pathId ?? (!native ? change.path : undefined);
    if (!id) {
      report("Refresh Git to open this file.");
      return;
    }
    await openFile(id);
  }
  async function showDiff(path: string, staged: boolean) {
    await guard(async () => {
      const ws = workspace();
      if (!ws) return;
      const text = await api.diff(ws.id, path, staged);
      if (workspace()?.id !== ws.id) return;
      const id = `diff:${ws.id}:${staged}:${path}`;
      setDocs((v) => [
        ...v.filter((d) => d.id !== id),
        {
          id,
          workspaceId: ws.id,
          name: "Δ " + path.split("/").pop(),
          relativePath: path,
          text,
          revision: "",
          language: "diff",
          eol: "LF",
          bom: false,
          readOnly: "Git diff",
          dirty: false,
        } as OpenDoc,
      ]);
      setActiveId(id);
    });
  }
  async function format() {
    if (
      !active() ||
      active()?.readOnly ||
      !editor ||
      formatState() === "RUNNING" ||
      switching() ||
      replaceBusy()
    )
      return;
    if (!prefs().formatter) {
      setFormatState("RUNNING");
      try {
        if (await editor.format()) {
          report("Document formatted.");
          return;
        }
      } catch (error) {
        report(errorMessage(error));
        return;
      } finally {
        setFormatState("FORMAT");
      }
      setFormatState("UNAVAILABLE");
      report(
        "No built-in formatter for this language. Set an external formatter in Languages & Format.",
      );
      setTimeout(() => setFormatState("FORMAT"), 2500);
      return;
    }
    if (!native) {
      report("External formatters require the desktop app.");
      return;
    }
    if (!editorWorkspace()?.trusted) {
      trust(editorWorkspace());
      return;
    }
    const doc = active()!;
    const version = editor?.getVersion();
    setFormatState("RUNNING");
    try {
      const args = JSON.parse(prefs().formatterArgs);
      if (!Array.isArray(args) || args.some((x) => typeof x !== "string"))
        throw Error("Formatter arguments must be a JSON string array.");
      const text = await api.format(
        doc.id,
        editor!.saveText(),
        prefs().formatter,
        args,
      );
      if (activeId() !== doc.id || version !== editor?.getVersion()) {
        report("Stale formatter result discarded; your newer edits are safe.");
        return;
      }
      editor?.replace(text);
      report("Formatting applied as one undoable edit.");
    } catch (e) {
      report(errorMessage(e));
    } finally {
      setFormatState("FORMAT");
    }
  }
  function fileOperation(kind: "file" | "folder") {
    if (!native) {
      report("File creation is available in the desktop app.");
      return;
    }
    const ws = workspace();
    if (!ws) return;
    ask({
      title: "New " + kind,
      body: `Create in ${ws.displayPath}. Use a single file or folder name.`,
      action: "Create",
      input: "",
      run: async (name) => {
        await api.create(ws.id, ws.rootId, name, kind === "folder");
        await refreshTree();
      },
    });
  }
  async function expand(entry: Entry, ws: Workspace) {
    if (!ws) return;
    const opening = !expanded().has(entry.id);
    setExpanded((value) => {
      const next = new Set(value);
      if (opening) next.add(entry.id);
      else next.delete(entry.id);
      return next;
    });
    if (!opening) return;
    await readTree(ws, entry.id);
  }
  const tree = (list: Entry[], ws: Workspace, level = 1): any => (
    <For each={list}>
      {(entry) => (
        <>
          <button
            class="tree-row"
            style={{ "padding-left": `${12 + level * 16}px` }}
            classList={{
              selected: active()?.id === entry.id,
            }}
            onClick={() =>
              entry.directory
                ? guard(() => expand(entry, ws))
                : openFile(entry.id, undefined, undefined, undefined, ws)
            }
            onKeyDown={(e) => {
              if (
                entry.directory &&
                ((e.key === "ArrowRight" && !expanded().has(entry.id)) ||
                  (e.key === "ArrowLeft" && expanded().has(entry.id)))
              ) {
                e.preventDefault();
                void guard(() => expand(entry, ws));
              }
            }}
            title={entry.relativePath}
            aria-expanded={
              entry.directory ? expanded().has(entry.id) : undefined
            }
          >
            <span
              classList={{
                "tree-chevron": true,
                expanded: expanded().has(entry.id),
                invisible: !entry.directory,
              }}
            >
              <Icon name="chevron" size={12} />
            </span>
            <Show
              when={entry.directory}
              fallback={
                <span class={"file-kind " + entry.name.split(".").pop()}>
                  {(
                    {
                      ts: "TS",
                      rs: "rs",
                      md: "M↓",
                      json: "{}",
                      css: "#",
                      toml: "≡",
                    } as Record<string, string>
                  )[entry.name.split(".").pop()!] || "·"}
                </span>
              }
            >
              <Icon name="folder" />
            </Show>
            <span class="truncate">{entry.name}</span>
            <Show when={entry.symlink}>
              <Icon name="link" size={12} />
            </Show>
            <Show when={docs().some((d) => d.id === entry.id && d.dirty)}>
              <span class="dirty-dot">●</span>
            </Show>
          </button>
          <Show when={entry.directory && expanded().has(entry.id)}>
            {tree(children()[entry.id] || [], ws, level + 1)}
          </Show>
        </>
      )}
    </For>
  );
  createEffect(() => {
    if (sidebar() === "git" && workspace()) void refreshGit();
  });
  // Searching only happens when the user asks for it.
  async function runSearch() {
    const ws = workspace();
    const opts = searchOptions();
    const mode = searchMode();
    if (searchId) void api.cancelSearch(searchId);
    const id = (searchId = crypto.randomUUID());
    setResults([]);
    setFileResults([]);
    setFileTotal(0);
    setSearchError("");
    setSearchSkipped(0);
    if (!ws || !(mode === "files" ? opts.query.trim() : opts.query)) {
      setSearchState("IDLE");
      return;
    }
    setSearchState("SEARCHING");
    try {
      if (mode === "files") {
        const found = await api.searchFiles(ws.id, id, opts.query);
        if (searchId !== id) return;
        setFileResults(found.files);
        setFileTotal(found.total);
        setSearchSkipped(found.skippedFiles);
      } else {
        const summary = await api.search(ws.id, id, opts, (items) => {
          if (searchId === id) setResults((v) => [...v, ...items]);
        });
        if (searchId !== id) return;
        setSearchSkipped(summary.skippedFiles);
      }
      setSearchState("DONE");
    } catch (e) {
      if (searchId === id) {
        setSearchError(errorMessage(e));
        setSearchState("ERROR");
      }
    }
  }
  // Results belong to one workspace and one mode.
  createEffect(
    on(
      [() => workspace()?.id, searchMode],
      () => {
        if (searchId) void api.cancelSearch(searchId);
        searchId = "";
        setResults([]);
        setFileResults([]);
        setFileTotal(0);
        setSearchError("");
        setSearchSkipped(0);
        setSearchState("IDLE");
      },
      { defer: true },
    ),
  );
  // Changing the query or options leaves the old results on screen, but they
  // can no longer be replaced until the search is run again.
  createEffect(
    on(
      searchOptions,
      () => {
        if (searchState() === "DONE") setSearchState("STALE");
      },
      { defer: true },
    ),
  );
  const commands = () => [
    {
      label: "Reload project configuration",
      key: "",
      run: () => reloadProject(true),
    },
    { label: "Open workspace", key: "⌘ O", run: openWorkspace },
    { label: "Save active file", key: "⌘ S", run: save },
    { label: "Open Settings & Guide", key: "F1", run: () => openSettings() },
    {
      label: "Focus Files",
      key: "⌘ ⇧ E",
      run: () => {
        setSidebar("files");
        setSidebarVisible(true);
      },
    },
    {
      label: "Search workspace",
      key: "⌘ ⇧ F",
      run: () => {
        setSidebar("search");
        setSidebarVisible(true);
      },
    },
    {
      label: "Search files by name",
      key: "",
      run: () => {
        setSearchMode("files");
        setSidebar("search");
        setSidebarVisible(true);
      },
    },
    {
      label: "Open Git",
      key: "⌘ ⇧ G",
      run: () => {
        setSidebar("git");
        setSidebarVisible(true);
      },
    },
    { label: "New terminal", key: "⌘ ⇧ `", run: () => terminal?.create() },
    { label: "Format document", key: "⇧ ⌥ F", run: format },
    {
      label: "Toggle Problems",
      key: "⌘ ⇧ M",
      run: () => setProblemsVisible((visible) => !visible),
    },
    {
      label: "Toggle sidebar",
      key: "⌘ B",
      run: () => setSidebarVisible((v) => !v),
    },
    {
      label: "Show bottom terminal",
      key: "",
      run: () => showTerminal("bottom"),
    },
    {
      label: "Show right terminal",
      key: "",
      run: () => showTerminal("right"),
    },
    { label: "Hide terminal", key: "⌘ J", run: () => changePlacement([]) },
  ];
  function openPalette() {
    setCommandQuery("");
    setPalette(true);
    queueMicrotask(() => paletteElement?.showModal());
  }
  function resize(e: PointerEvent, target: "sidebar" | "terminal") {
    const start = e.clientX;
    const initial = target === "sidebar" ? width() : terminalWidth();
    const move = (event: PointerEvent) =>
      target === "sidebar"
        ? setWidth(
            Math.min(420, Math.max(196, initial + event.clientX - start)),
          )
        : setTerminalWidth(
            Math.min(
              55,
              Math.max(
                24,
                initial + ((start - event.clientX) / window.innerWidth) * 100,
              ),
            ),
          );
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      void api.set("layout", {
        sidebarWidth: width(),
        terminalWidth: terminalWidth(),
        placement: placement(),
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }
  onMount(() => {
    const focus = () => reloadProject();
    window.addEventListener("focus", focus);
    onCleanup(() => window.removeEventListener("focus", focus));
    if (native) {
      picking = true;
      void guard(async () => {
        const ws = await api.launchWorkspace();
        if (ws) {
          setWorkspaces([ws]);
          selectWorkspace(ws);
          await refreshTree(ws);
        }
      }).finally(() => {
        picking = false;
      });
    }
    void api
      .settings()
      .then((s) => {
        setPrefs(normalizePreferences(s.preferences));
        const layout = normalizeLayout(s.layout);
        setPlacement(layout.placement);
        setWidth(layout.sidebarWidth);
        setTerminalWidth(layout.terminalWidth);
      })
      .catch((e) => report(errorMessage(e)));
    const key = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      // Dialogs own their keyboard interaction, including Escape.
      // Workbench shortcuts must not mutate hidden tabs behind a modal.
      if (document.querySelector("dialog[open]")) return;
      const inTerminal = (e.target as HTMLElement)?.closest(".terminal-pane");
      if (e.key === "F1") {
        e.preventDefault();
        openSettings();
        return;
      }
      if (e.key === "Escape") {
        // An unhandled Escape reaches the native window and leaves macOS
        // full screen. Popovers still light-dismiss through their own path.
        if (!document.querySelector(":popover-open")) e.preventDefault();
        setSsh(false);
        if (settings()) closeSettings();
        return;
      }
      if (inTerminal && !(mod && e.shiftKey && e.key.toLowerCase() === "p"))
        return;
      if (mod && e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        setProblemsVisible((visible) => !visible);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        openPalette();
      } else if (mod && e.key === "s") {
        e.preventDefault();
        void save();
      } else if (mod && e.key === "o") {
        e.preventDefault();
        void openWorkspace();
      } else if (mod && e.key === "w") {
        e.preventDefault();
        closeDoc(activeId());
      } else if (mod && e.key === "b") {
        e.preventDefault();
        setSidebarVisible((v) => !v);
      } else if (mod && e.key === "j") {
        e.preventDefault();
        changePlacement(placement().length ? [] : [focusedTerminal()]);
      } else if (mod && e.key === "`") {
        e.preventDefault();
        showTerminal("right");
        e.shiftKey ? void terminal?.create() : terminal?.focus();
      } else if (
        mod &&
        e.shiftKey &&
        ["e", "f", "g"].includes(e.key.toLowerCase())
      ) {
        e.preventDefault();
        setSidebar(
          ({ e: "files", f: "search", g: "git" } as Record<string, string>)[
            e.key.toLowerCase()
          ],
        );
        setSidebarVisible(true);
      } else if (e.shiftKey && e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        void format();
      }
    };
    window.addEventListener("keydown", key);
    const unload = (e: BeforeUnloadEvent) => {
      if (docs().some((d) => d.dirty)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    let unlistenClose: (() => void) | undefined;
    let unmounted = false;
    onCleanup(() => {
      unmounted = true;
      unlistenClose?.();
      clearTimeout(noticeTimer);
      if (searchId) void api.cancelSearch(searchId).catch(() => {});
    });
    if (native)
      void import("@tauri-apps/api/window")
        .then(async ({ getCurrentWindow }) => {
          const unlisten = await getCurrentWindow().onCloseRequested(
            async (e) => {
              if (switching() || replaceBusy() || saving.size) {
                e.preventDefault();
                report(
                  "Wait for the current operation to finish before closing RTcode.",
                );
                return;
              }
              if (docs().some((d) => d.dirty) || terminal?.hasLive()) {
                e.preventDefault();
                ask({
                  title: "Close RTcode?",
                  body: "Unsaved edits will be discarded and running terminals will be terminated. Cancel to save first.",
                  action: "Discard & exit",
                  danger: true,
                  run: async () => {
                    await terminal?.closeAll();
                    await getCurrentWindow().destroy();
                  },
                });
              }
            },
          );
          if (unmounted) unlisten();
          else unlistenClose = unlisten;
        })
        .catch((e) => report(errorMessage(e)));
    onCleanup(() => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("beforeunload", unload);
    });
  });
  createEffect(() => {
    for (const [key, value] of Object.entries(
      themeTokens(prefs().colors, prefs().contrast),
    )) {
      document.documentElement.style.setProperty(`--${key}`, value);
    }
    document.documentElement.classList.toggle(
      "high-contrast",
      prefs().contrast,
    );
    document.documentElement.classList.toggle("no-motion", !prefs().motion);
  });
  const Notice = () => (
    <Show when={notice()}>
      <div class="notice" role="status">
        <span class="notice-code">SYS::</span>
        <span>{notice()}</span>
        <button aria-label="Dismiss notification" onClick={() => setNotice("")}>
          <Icon name="close" />
        </button>
      </div>
    </Show>
  );
  return (
    <div class="app">
      <header class="topbar">
        <button
          class="logo"
          aria-label="Open Settings and Guide"
          title="Settings & Guide"
          onClick={() => openSettings()}
        >
          <span>R</span>
          <span>_</span>
          <span>&gt;</span>
        </button>
        <span class="top-separator" />
        <button
          class="workspace-control"
          ref={workspaceButton}
          onClick={showWorkspaceMenu}
          aria-label="Workspaces"
          aria-expanded={workspaceMenuOpen()}
          aria-controls="workspace-menu"
          title="Manage workspaces"
        >
          <span class="micro">WS::</span>
          <Icon name="folder" />
          <span>{workspace()?.name || "NO WORKSPACE"}</span>
          <Icon name="down" size={12} />
        </button>
        <div
          id="workspace-menu"
          class="workspace-menu"
          popover="auto"
          ref={workspaceMenu}
          onToggle={(e) => setWorkspaceMenuOpen(e.newState === "open")}
        >
          <div class="workspace-menu-heading">Open workspaces</div>
          <div class="workspace-list">
            <For each={workspaces()}>
              {(ws) => (
                <div
                  class="workspace-menu-row"
                  style={{ "--workspace-color": workspaceColor(ws.id) }}
                >
                  <button
                    class="workspace-option"
                    aria-current={
                      workspace()?.id === ws.id ? "true" : undefined
                    }
                    onClick={() => {
                      selectWorkspace(ws);
                      workspaceMenu.hidePopover();
                    }}
                  >
                    <Icon name="folder" />
                    <span class="workspace-option-copy">
                      <span>{ws.name}</span>
                      <small>{ws.displayPath}</small>
                    </span>
                    <Show when={workspace()?.id === ws.id}>
                      <span class="workspace-current">Active</span>
                    </Show>
                  </button>
                  <button
                    class="workspace-remove"
                    aria-label={`Remove workspace ${ws.name}`}
                    title={`Remove ${ws.displayPath} from workspaces`}
                    disabled={switching() || replaceBusy()}
                    onClick={() => removeWorkspace(ws)}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              )}
            </For>
            <Show when={!workspaces().length}>
              <p class="workspace-menu-empty">No folders open yet.</p>
            </Show>
          </div>
          <button
            class="workspace-add"
            onClick={openWorkspace}
            disabled={switching()}
          >
            <Icon name="plus" />
            Add workspace…
          </button>
        </div>
        <Show when={!native}>
          <span class="preview-badge">SAMPLE</span>
        </Show>
        <span class="toolbar-branch">
          <Icon name="git" />
          {git().branch === "No repository" ? "LOCAL" : git().branch}
        </span>
        <div class="grow" />
        <div
          class="placement-control"
          role="group"
          aria-label="Terminal placement"
        >
          <Icon name="layout" />
          <span>TERM//</span>
          <For each={["right", "bottom"] as const}>
            {(position) => (
              <button
                aria-label={`${position === "right" ? "Right" : "Bottom"} terminal`}
                aria-pressed={placement().includes(position)}
                onClick={() => toggleTerminal(position)}
              >
                {position.toUpperCase()}
              </button>
            )}
          </For>
          <button
            aria-label="Hide all terminals"
            onClick={() => changePlacement([])}
          >
            HIDE
          </button>
        </div>
        <button
          class="top-command"
          onClick={openPalette}
          title="Command palette"
        >
          <Icon name="command" />
          <span>CMD</span>
        </button>
        <button
          aria-label="Settings"
          title="Settings"
          onClick={() => openSettings(settingsTab(), article())}
        >
          <Icon name="settings" />
        </button>
      </header>
      <main
        classList={{
          workbench: true,
          "terminal-bottom-layout": placement().includes("bottom"),
          "terminal-right-layout": placement().includes("right"),
          "terminal-hidden": !placement().length,
          "sidebar-collapsed": !sidebarVisible(),
        }}
        style={{
          "--sidebar-width": width() + "px",
          "--terminal-width": terminalWidth() + "%",
        }}
        aria-hidden={settings()}
        inert={settings()}
      >
        <aside class="sidebar">
          <nav class="sidebar-tabs" aria-label="Workbench tools">
            <For each={["files", "search", "git"]}>
              {(tab) => (
                <button
                  classList={{ active: sidebar() === tab }}
                  onClick={() => {
                    setSidebar(tab);
                    setSidebarVisible(true);
                  }}
                  aria-label={tab}
                  title={tab}
                >
                  <Icon name={tab} />
                  <span>{tab.toUpperCase()}</span>
                </button>
              )}
            </For>
          </nav>
          <div class="sidebar-content">
            <Show when={sidebar() === "files"}>
              <div class="section-bar">
                <span>{workspace()?.name.toUpperCase() || "WORKSPACE"}</span>
                <span class="grow" />
                <button
                  aria-label="New file"
                  title="New file"
                  onClick={() => fileOperation("file")}
                >
                  <Icon name="plus" size={14} />
                </button>
                <button
                  aria-label="Refresh files"
                  title="Refresh files"
                  onClick={() => guard(() => refreshTree())}
                >
                  <Icon name="refresh" size={14} />
                </button>
              </div>
              <Show
                when={workspace()}
                fallback={
                  <div class="pane-empty">
                    <Icon name="folder" size={26} />
                    <p>Start with a folder.</p>
                    <button class="primary" onClick={openWorkspace}>
                      Open workspace
                    </button>
                  </div>
                }
              >
                <For each={workspaces()}>
                  {(ws) => (
                    <div
                      class="workspace-root"
                      data-workspace={ws.id}
                      style={{ "--workspace-color": workspaceColor(ws.id) }}
                    >
                      <button
                        class="tree-row workspace-root-row"
                        title={ws.displayPath}
                        aria-label={`Workspace folder ${ws.name}`}
                        aria-expanded={!collapsedRoots().has(ws.id)}
                        onClick={() => {
                          selectWorkspace(ws);
                          setCollapsedRoots((old) => {
                            const next = new Set(old);
                            next.has(ws.id)
                              ? next.delete(ws.id)
                              : next.add(ws.id);
                            return next;
                          });
                        }}
                      >
                        <span
                          classList={{
                            "tree-chevron": true,
                            expanded: !collapsedRoots().has(ws.id),
                          }}
                        >
                          <Icon name="chevron" size={12} />
                        </span>
                        <Icon name="folder" />
                        <span class="workspace-root-name truncate">
                          {ws.name}
                        </span>
                      </button>
                      <Show when={!collapsedRoots().has(ws.id)}>
                        {tree(roots()[ws.id] || [], ws)}
                      </Show>
                    </div>
                  )}
                </For>
              </Show>
              <div class="sidebar-bottom">
                <div class="section-label">WORKSPACE STATUS</div>
                <div>
                  <span class="lamp off" />
                  {workspace()?.trusted
                    ? "Trusted workspace"
                    : "Restricted mode"}
                </div>
                <button
                  onClick={() => openSettings("Guide", "workspaces-and-trust")}
                >
                  <Icon name="shield" size={14} />
                  {workspace()?.trusted
                    ? "Review permissions"
                    : "Files are safe to explore"}
                  <Icon name="arrow" size={12} />
                </button>
              </div>
            </Show>
            <Show when={sidebar() === "search"}>
              <div
                class="search-controls"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.target instanceof HTMLInputElement)
                    void runSearch();
                }}
              >
                <label class="search-box">
                  <button
                    class="search-mode"
                    type="button"
                    aria-label={
                      searchMode() === "files"
                        ? "Switch to content filter"
                        : "Switch to file search"
                    }
                    title={
                      searchMode() === "files"
                        ? "File search. Click to filter file contents."
                        : "Content filter. Click to search file names."
                    }
                    disabled={replaceBusy()}
                    onClick={() =>
                      setSearchMode((mode) =>
                        mode === "files" ? "filter" : "files",
                      )
                    }
                  >
                    <Icon
                      name={searchMode() === "files" ? "files" : "search"}
                    />
                  </button>
                  <input
                    aria-label={
                      searchMode() === "files"
                        ? "Search files"
                        : "Search workspace"
                    }
                    autocapitalize="off"
                    autocorrect="off"
                    spellcheck={false}
                    placeholder={
                      searchMode() === "files"
                        ? "Search files by name…"
                        : "Search workspace…"
                    }
                    value={query()}
                    disabled={replaceBusy()}
                    onInput={(e) => setQuery(e.currentTarget.value)}
                  />
                </label>
                <button
                  class="search-run"
                  type="button"
                  disabled={replaceBusy()}
                  onClick={() => void runSearch()}
                >
                  Search
                </button>
                <Show when={searchMode() === "filter"}>
                  <Show when={showReplace()}>
                    <label class="search-box replace-box">
                      <input
                        aria-label="Replace with"
                        autocapitalize="off"
                        autocorrect="off"
                        spellcheck={false}
                        placeholder="Replace with…"
                        value={replacement()}
                        disabled={replaceBusy()}
                        onInput={(e) => setReplacement(e.currentTarget.value)}
                      />
                    </label>
                    <Show when={regex()}>
                      <small class="search-help">
                        Capture groups: $1, $2, $&#123;name&#125;. $$ inserts $.
                      </small>
                    </Show>
                  </Show>
                  <div class="search-options">
                    <For
                      each={
                        [
                          ["Aa", caseSensitive, setCase],
                          ["ab", wholeWord, setWhole],
                          [".*", regex, setRegex],
                        ] as const
                      }
                    >
                      {([label, value, set]) => (
                        <button
                          classList={{ active: value() }}
                          aria-pressed={value()}
                          disabled={replaceBusy()}
                          title={
                            label === "Aa"
                              ? "Match case"
                              : label === "ab"
                                ? "Whole word"
                                : "Regular expression"
                          }
                          onClick={() => set((v) => !v)}
                        >
                          {label}
                        </button>
                      )}
                    </For>
                    <button
                      aria-label="Toggle replace"
                      aria-pressed={showReplace()}
                      onClick={() => setShowReplace((value) => !value)}
                    >
                      Replace
                    </button>
                  </div>
                  <label class="filter-field">
                    INCLUDE
                    <input
                      placeholder="src/**"
                      autocomplete="off"
                      autocapitalize="off"
                      autocorrect="off"
                      spellcheck={false}
                      title="Comma-separated globs, for example src/**, **/*.{ts,tsx}"
                      disabled={replaceBusy()}
                      value={include()}
                      onInput={(e) => setInclude(e.currentTarget.value)}
                    />
                  </label>
                  <label class="filter-field">
                    EXCLUDE
                    <input
                      placeholder="**/test/**"
                      autocomplete="off"
                      autocapitalize="off"
                      autocorrect="off"
                      spellcheck={false}
                      title="Comma-separated globs, for example **/test/**, **/*.spec.ts"
                      disabled={replaceBusy()}
                      value={exclude()}
                      onInput={(e) => setExclude(e.currentTarget.value)}
                    />
                  </label>
                  <Show when={showReplace()}>
                    <button
                      class="replace-all"
                      disabled={
                        replaceBusy() ||
                        searchState() !== "DONE" ||
                        !results().length
                      }
                      onClick={() => replaceResults(results())}
                    >
                      {replaceBusy()
                        ? "Replacing…"
                        : `Replace all (${results().length})`}
                    </button>
                  </Show>
                </Show>
              </div>
              <div class="section-bar">
                {searchMode() === "files"
                  ? fileTotal() > fileResults().length
                    ? `${fileResults().length} OF ${fileTotal()} FILES`
                    : `${fileResults().length} FILES`
                  : `${results().length} RESULTS`}
                <span class="grow" />
                <Show when={searchState() !== "IDLE"}>
                  <span class="search-state" aria-live="polite">
                    {searchState()}
                  </span>
                </Show>
              </div>
              <Show when={searchError()}>
                <p class="inline-error">{searchError()}</p>
              </Show>
              <Show when={fileTotal() > fileResults().length}>
                <p class="search-help">
                  Showing the best {fileResults().length} matches. Add more of
                  the name or path to narrow them.
                </p>
              </Show>
              <Show when={searchSkipped()}>
                <p class="search-help">
                  Skipped {searchSkipped()} binary, non-UTF-8, or unreadable
                  files.
                </p>
              </Show>
              <For each={replaceErrors()}>
                {(error) => (
                  <p class="inline-error" role="alert">
                    {error}
                  </p>
                )}
              </For>
              <Show when={searchMode() === "files"}>
                <For each={fileResults()}>
                  {(m) => (
                    <button
                      class="search-result file-result"
                      title={m.path}
                      onClick={() => openFile(m.pathId)}
                    >
                      <span>{m.name}</span>
                      <span>{m.path}</span>
                    </button>
                  )}
                </For>
              </Show>
              <For each={searchMode() === "filter" ? results() : []}>
                {(m) => (
                  <div class="search-result-row">
                    <button
                      class="search-result"
                      onClick={() =>
                        openFile(m.pathId, m.line, m.column, m.endColumn)
                      }
                    >
                      <span>{m.path}</span>
                      <div>
                        <em>{m.line}</em>
                        <span>
                          {m.text.slice(0, m.column - m.textColumn)}
                          <mark>
                            {m.text.slice(
                              m.column - m.textColumn,
                              m.endColumn - m.textColumn,
                            )}
                          </mark>
                          {m.text.slice(m.endColumn - m.textColumn)}
                        </span>
                      </div>
                    </button>
                    <Show when={showReplace()}>
                      <button
                        class="replace-one"
                        aria-label={`Replace match in ${m.path} at line ${m.line}, column ${m.column}`}
                        title="Replace this match"
                        disabled={replaceBusy() || searchState() !== "DONE"}
                        onClick={() => replaceResults([m])}
                      >
                        <Icon name="arrow" size={12} />
                      </button>
                    </Show>
                  </div>
                )}
              </For>
              <Show
                when={
                  searchState() === "DONE" &&
                  !(searchMode() === "files" ? fileResults() : results()).length
                }
              >
                <p class="search-help">No matches.</p>
              </Show>
              <Show when={searchState() === "IDLE"}>
                <div class="pane-empty">
                  <Show
                    when={searchMode() === "files"}
                    fallback={
                      <p>
                        Find a thread.
                        <br />
                        Follow it through your code.
                      </p>
                    }
                  >
                    <p>
                      Name a file.
                      <br />
                      Open it from anywhere.
                    </p>
                  </Show>
                  <small>
                    Press Enter or Search to run. Ignores respected. No
                    permanent index.
                  </small>
                </div>
              </Show>
            </Show>
            <Show when={sidebar() === "git"}>
              <div class="section-bar">
                REPOSITORY
                <span class="grow" />
                <button
                  aria-label="Refresh Git"
                  disabled={gitBusy()}
                  onClick={refreshGit}
                >
                  <Icon name="refresh" size={14} />
                </button>
              </div>
              <div
                classList={{
                  "git-current": true,
                  "no-repo": git().branch === "No repository",
                }}
              >
                <span class="micro">CURRENT BRANCH</span>
                <strong>
                  <Icon name="git" />
                  {git().branch}
                </strong>
                <Show when={git().local.length}>
                  <span>
                    ↑{git().ahead} ↓{git().behind}
                  </span>
                </Show>
              </div>
              <Show when={git().branch === "No repository"}>
                <div class="pane-empty">
                  <p>
                    {native
                      ? "No Git repository at this workspace root."
                      : "The sample workspace has no Git repository."}
                  </p>
                  <button onClick={() => openSettings("Guide", "git")}>
                    Read the Git guide <Icon name="arrow" />
                  </button>
                </div>
              </Show>
              <Show when={git().worktrees?.length}>
                <details class="git-section worktree-section" open>
                  <summary class="section-bar">
                    <Icon name="chevron" size={12} />
                    WORKTREES <span class="grow" />
                    {git().worktrees.length}
                  </summary>
                  <For each={git().worktrees}>
                    {(tree) => (
                      <button
                        class="worktree-row"
                        classList={{ current: tree.current }}
                        aria-label={`${tree.current ? "Current" : "Open"} worktree ${tree.branch || tree.path.split(/[\\/]/).pop()}`}
                        aria-current={tree.current ? "location" : undefined}
                        disabled={
                          tree.current || !tree.available || switching()
                        }
                        title={tree.path}
                        onClick={() => void openWorktree(tree)}
                      >
                        <span class="worktree-heading">
                          <Icon name="folder" size={14} />
                          <strong>
                            {tree.branch ||
                              (tree.bare
                                ? "Bare repository"
                                : `Detached ${tree.head.slice(0, 8)}`)}
                          </strong>
                          <span class="grow" />
                          {tree.current
                            ? "Current"
                            : !tree.available
                              ? "Unavailable"
                              : tree.locked
                                ? "Locked"
                                : ""}
                        </span>
                        <span class="worktree-path">{tree.path}</span>
                      </button>
                    )}
                  </For>
                </details>
              </Show>
              <For each={["local", "remote"] as const}>
                {(kind) => (
                  <Show when={git()[kind].length}>
                    <details class="git-section">
                      <summary class="section-bar">
                        <Icon name="chevron" size={12} />
                        {kind === "local"
                          ? "LOCAL BRANCHES"
                          : "REMOTE BRANCHES"}
                        <span class="grow" />
                        {git()[kind].length}
                      </summary>
                      <For each={git()[kind]}>
                        {(branch) => (
                          <button
                            class="branch-row"
                            onClick={() =>
                              kind === "remote"
                                ? report(
                                    "Create tracking branches in the terminal in this early build.",
                                  )
                                : ask({
                                    title: "Switch branch?",
                                    body: `Switch to ${branch}. Git will refuse conflicting changes; no automatic stash.`,
                                    action: "Switch branch",
                                    run: () => gitAction("switch", branch),
                                  })
                            }
                          >
                            <span>{branch === git().branch ? "●" : "⑂"}</span>
                            {branch}
                          </button>
                        )}
                      </For>
                    </details>
                  </Show>
                )}
              </For>
              <Show when={git().commits.length}>
                <details class="git-section">
                  <summary class="section-bar">
                    <Icon name="chevron" size={12} />
                    RECENT COMMITS <span class="grow" />
                    {git().commits.length}
                  </summary>
                  <For each={git().commits}>
                    {(c) => (
                      <button
                        class="commit-row"
                        title="Copy commit hash"
                        onClick={() => {
                          void navigator.clipboard.writeText(c.hash);
                          report("Commit hash copied.");
                        }}
                      >
                        <span>{c.hash.slice(0, 7)}</span>
                        <span>{c.message}</span>
                      </button>
                    )}
                  </For>
                </details>
              </Show>
              <For each={[false, true]}>
                {(staged) => (
                  <details class="git-section">
                    <summary class="section-bar">
                      <Icon name="chevron" size={12} />
                      {staged ? "STAGED CHANGES" : "CHANGES"}
                      <span class="grow" />
                      {git().changes.filter((c) => c.staged === staged).length}
                    </summary>
                    <For
                      each={git().changes.filter((c) => c.staged === staged)}
                    >
                      {(c) => (
                        <div class="change-row">
                          <span classList={{ conflict: c.conflict }}>
                            {c.status}
                          </span>
                          <button
                            title={`Open ${c.path}`}
                            onClick={() => openGitFile(c)}
                          >
                            {c.path}
                          </button>
                          <button
                            aria-label={`View ${staged ? "staged" : "unstaged"} changes for ${c.path}`}
                            title="View changes"
                            onClick={() => showDiff(c.path, staged)}
                          >
                            <Icon name="eye" size={14} />
                          </button>
                          <button
                            disabled={c.conflict}
                            aria-label={
                              (staged ? "Unstage " : "Stage ") + c.path
                            }
                            onClick={() =>
                              gitAction(staged ? "unstage" : "stage", c.path)
                            }
                          >
                            <Icon name={staged ? "minus" : "plus"} size={14} />
                          </button>
                        </div>
                      )}
                    </For>
                  </details>
                )}
              </For>
            </Show>
          </div>
        </aside>
        <div
          class="splitter sidebar-splitter"
          role="separator"
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          aria-valuenow={width()}
          aria-valuemin={196}
          aria-valuemax={420}
          tabIndex={0}
          onPointerDown={(e) => resize(e, "sidebar")}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              setWidth((v) =>
                Math.max(
                  196,
                  Math.min(420, v + (e.key === "ArrowRight" ? 10 : -10)),
                ),
              );
            }
          }}
        />
        <section class="editor-pane">
          <div class="editor-tabs" role="tablist" aria-label="Open files">
            <For each={docs()}>
              {(doc) => (
                <div
                  style={{
                    "--workspace-color": workspaceColor(doc.workspaceId),
                  }}
                  title={`${workspaces().find((ws) => ws.id === doc.workspaceId)?.name || ""} · ${doc.relativePath}`}
                  classList={{
                    "editor-tab": true,
                    active: activeId() === doc.id,
                  }}
                >
                  <button
                    role="tab"
                    aria-selected={activeId() === doc.id}
                    onClick={() => setActiveId(doc.id)}
                  >
                    <span class={"file-kind " + doc.name.split(".").pop()}>
                      {doc.language === "typescript"
                        ? "TS"
                        : doc.language === "markdown"
                          ? "M↓"
                          : doc.language === "diff"
                            ? "Δ"
                            : "{}"}
                    </span>
                    {doc.name}
                    <Show when={doc.dirty}>
                      <span class="dirty-dot">●</span>
                    </Show>
                  </button>
                  <button
                    class="tab-close"
                    aria-label={"Close " + doc.name}
                    onClick={() => closeDoc(doc.id)}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              )}
            </For>
            <span class="grow" />
            <button
              class="editor-action"
              title="Save file"
              aria-label="Save file"
              onClick={() => save()}
              disabled={
                !active() ||
                !!active()?.readOnly ||
                switching() ||
                replaceBusy()
              }
            >
              <Icon name="save" size={14} />
            </button>
          </div>
          <Show
            when={active()}
            fallback={
              <div class="welcome-empty">
                <div class="console-mark">
                  R<span>_</span>
                  <em>&gt;</em>
                </div>
                <h1>
                  {workspace() ? (
                    "Workspace ready."
                  ) : (
                    <>
                      A clear space.
                      <br />A new possibility.
                    </>
                  )}
                </h1>
                <p>
                  {workspace()
                    ? "Open a file from Files to start editing."
                    : "Open a project. Make it yours."}
                </p>
                <button
                  class="primary"
                  onClick={() =>
                    workspace()
                      ? (setSidebar("files"), setSidebarVisible(true))
                      : void openWorkspace()
                  }
                >
                  <Icon name="folder" />
                  {workspace() ? (
                    "Browse files"
                  ) : (
                    <>
                      Open a workspace <kbd>⌘ O</kbd>
                    </>
                  )}
                </button>
                <button class="quiet" onClick={() => openSettings()}>
                  Read the operator guide <Icon name="arrow" />
                </button>
                <span class="empty-caption">
                  LOCAL FIRST · PURPOSEFULLY SMALL
                </span>
              </div>
            }
          >
            <div class="editor-breadcrumb">
              <Icon name="files" size={12} />
              <span>{editorWorkspace()?.name}</span>
              <Icon name="chevron" size={12} />
              <span>{active()?.relativePath}</span>
              <span class="grow" />
              <span>{active()?.readOnly || "UTF-8"}</span>
            </div>
          </Show>
          <div
            class="editor-container"
            style={{ display: active() ? "block" : "none" }}
          >
            <Suspense
              fallback={<div class="loading-trace">LOADING EDITOR…</div>}
            >
              <Editor
                document={active()}
                openIds={docs().map((d) => d.id)}
                documents={docs()}
                workspaceId={editorWorkspace()?.id || "workspace"}
                onProjectStatus={setProjectStatus}
                onProjectError={report}
                readOnly={replaceBusy() || switching()}
                onProblems={setProblems}
                onOpenDocument={(id, line, column, end) =>
                  void openFile(id, line, column, end, editorWorkspace())
                }
                colors={prefs().colors}
                contrast={prefs().contrast}
                fontSize={prefs().fontSize}
                wrap={prefs().wrap}
                minimap={prefs().minimap}
                onReady={(h) => (editor = h)}
                onPosition={(l, c) => setPosition([l, c])}
                onChange={(id, dirty) =>
                  setDocs((v) =>
                    v.map((d) => (d.id === id ? { ...d, dirty } : d)),
                  )
                }
              />
            </Suspense>
          </div>
          <Show when={problemsVisible()}>
            <section class="problems-panel" aria-label="Problems">
              <div class="pane-bar">
                <span>PROBLEMS</span>
                <span>{problems().length}</span>
                <span class="grow" />
                <span>OPEN FILES</span>
                <button
                  aria-label="Close Problems"
                  onClick={() => setProblemsVisible(false)}
                >
                  <Icon name="close" />
                </button>
              </div>
              <div class="problems-list">
                <For each={problems()}>
                  {(problem) => (
                    <button
                      class="problem-row"
                      data-severity={problem.severity}
                      onClick={() =>
                        void openFile(
                          problem.documentId,
                          problem.line,
                          problem.column,
                          problem.endColumn,
                        )
                      }
                    >
                      <span class={`problem-severity ${problem.severity}`}>
                        {problem.severity.toUpperCase()}
                      </span>
                      <span class="problem-message">{problem.message}</span>
                      <span class="problem-location">
                        {problem.path}:{problem.line}:{problem.column}
                      </span>
                    </button>
                  )}
                </For>
                <Show when={!problems().length}>
                  <p class="problems-empty">
                    No diagnostics in open files with supported language
                    services.
                  </p>
                </Show>
              </div>
            </section>
          </Show>
        </section>
        <div
          class="splitter terminal-splitter"
          role="separator"
          aria-label="Resize terminal"
          aria-orientation="vertical"
          aria-valuenow={terminalWidth()}
          tabIndex={0}
          onPointerDown={(e) => resize(e, "terminal")}
          onKeyDown={(e) => {
            if (["ArrowLeft", "ArrowRight"].includes(e.key))
              setTerminalWidth((v) =>
                Math.max(
                  24,
                  Math.min(55, v + (e.key === "ArrowLeft" ? 2 : -2)),
                ),
              );
          }}
        />
        <For each={["right", "bottom"] as const}>
          {(position) => (
            <div
              class={`terminal-slot terminal-${position}-slot`}
              style={{
                display: placement().includes(position) ? undefined : "none",
              }}
            >
              <Terminal
                colors={prefs().colors}
                contrast={prefs().contrast}
                workspace={workspace()}
                workspaces={workspaces()}
                workspaceColor={workspaceColor}
                label={`${position === "right" ? "Right" : "Bottom"} terminal`}
                onFocus={() => setFocusedTerminal(position)}
                onReady={(h) => (terminalPanes[position] = h)}
                onError={report}
                onTrust={trust}
                onHide={() => changePlacement([])}
                onCloseRequest={() =>
                  ask({
                    title: "Close terminal?",
                    body: "The active terminal process will end. Unsaved work in terminal applications may be lost.",
                    action: "Close terminal",
                    run: async () => terminalPanes[position]?.closeActive(),
                  })
                }
                onState={(state) => {
                  setTerminalStates((states) => ({
                    ...states,
                    [position]: state,
                  }));
                }}
              />
            </div>
          )}
        </For>
      </main>
      <footer class="statusbar">
        <button class="trust-status" onClick={() => trust()}>
          <Icon name="shield" size={14} />
          {workspace()?.trusted ? "TRUSTED" : "RESTRICTED"}
        </button>
        <span class="status-readout">
          POS::
          <b>
            {position()[0]}:{position()[1]}
          </b>
        </span>
        <span class="status-secondary">
          ENC::<b>{active()?.bom ? "UTF-8 BOM" : "UTF-8"}</b>
        </span>
        <span class="status-secondary">
          EOL::<b>{active()?.eol || "LF"}</b>
        </span>
        <span class="status-readout">
          MODE::<b>{active()?.language.toUpperCase() || "—"}</b>
        </span>
        <button
          class="lsp-status"
          title={"Project language services — open settings"}
          onClick={() => openSettings("Languages & Format")}
        >
          INTELLISENSE::<span>{languageService()}</span>
        </button>
        <button
          class="problems-toggle"
          aria-label="Toggle Problems"
          aria-expanded={problemsVisible()}
          onClick={() => setProblemsVisible((visible) => !visible)}
        >
          <span class="diagnostic-error">
            {problems().filter((p) => p.severity === "error").length} ERR
          </span>{" "}
          ·{" "}
          <span class="diagnostic-warning">
            {problems().filter((p) => p.severity === "warning").length} WARN
          </span>
          <Show when={problems().some((p) => p.severity === "hint")}>
            {" "}
            ·{" "}
            <span class="diagnostic-hint">
              {problems().filter((p) => p.severity === "hint").length} HINT
            </span>
          </Show>
        </button>
        <span class="grow" />
        <button
          class="format-button"
          disabled={
            !active() ||
            !!active()?.readOnly ||
            formatState() === "RUNNING" ||
            switching() ||
            replaceBusy()
          }
          onClick={format}
        >
          [ {formatState()} ]
        </button>
        <button
          class="ssh-control"
          onClick={() => {
            setSsh((v) => !v);
            void api
              .sshProfiles()
              .then(setHosts)
              .catch((e) => report(errorMessage(e)));
          }}
        >
          <Icon name="terminal" size={14} />
          SSH::{terminalState() === "SSH PROCESS" ? "PROCESS" : "OFFLINE"}
          <Icon name="down" size={12} />
        </button>
        <span class="save-state">
          <span classList={{ lamp: true, off: !!active()?.dirty }} />
          {active()?.dirty ? "MODIFIED" : "CLEAN"}
        </span>
      </footer>
      <Show when={ssh()}>
        <div class="ssh-popover">
          <div class="section-bar">
            SSH CONNECTION
            <button aria-label="Close SSH" onClick={() => setSsh(false)}>
              <Icon name="close" />
            </button>
          </div>
          <p>Connect through your system OpenSSH client.</p>
          <label>
            HOST ALIAS
            <input
              autofocus
              placeholder="user@host or config alias"
              value={sshAlias()}
              onInput={(e) => setSshAlias(e.currentTarget.value)}
            />
          </label>
          <For each={hosts()}>
            {(host) => (
              <button class="ssh-host" onClick={() => setSshAlias(host)}>
                <Icon name="terminal" />
                {host}
              </button>
            )}
          </For>
          <div class="popover-actions">
            <button onClick={() => openSettings("Guide", "ssh")}>
              Connection guide
            </button>
            <button
              class="primary"
              disabled={!sshAlias().trim()}
              onClick={() => {
                setSsh(false);
                showTerminal("right");
                void terminal?.create(sshAlias().trim());
              }}
            >
              Connect <Icon name="arrow" />
            </button>
          </div>
          <small>
            Host-key and authentication prompts stay in the terminal.
          </small>
        </div>
      </Show>
      <Show when={settings()}>
        <Settings
          tab={settingsTab()}
          setTab={setSettingsTab}
          article={article()}
          setArticle={setArticle}
          close={closeSettings}
          prefs={prefs()}
          update={updatePref}
          showMe={(t) => {
            closeSettings();
            setSidebar(t);
            setSidebarVisible(true);
          }}
          trusted={!!workspace()?.trusted}
          trust={() => trust()}
          notice={<Notice />}
        />
      </Show>
      <Show when={!settings()}>
        <Notice />
      </Show>
      <Show when={dialog()}>
        <dialog
          class="system-dialog"
          ref={dialogElement}
          aria-labelledby="confirmation-title"
          onCancel={(event) => {
            if (dialogBusy()) event.preventDefault();
            else setDialog(undefined);
          }}
        >
          <div class="section-bar">
            SYSTEM / CONFIRMATION
            <button
              aria-label="Cancel"
              disabled={dialogBusy()}
              onClick={() => setDialog(undefined)}
            >
              <Icon name="close" />
            </button>
          </div>
          <h2 id="confirmation-title">{dialog()?.title}</h2>
          <p>{dialog()?.body}</p>
          <Show when={dialogError()}>
            <p class="dialog-error" role="alert">
              {dialogError()}
            </p>
          </Show>
          <Show when={dialog()?.input !== undefined}>
            <input
              aria-label="Name"
              autofocus
              value={dialogValue()}
              onInput={(e) => setDialogValue(e.currentTarget.value)}
            />
          </Show>
          <div class="dialog-actions">
            <button
              disabled={dialogBusy()}
              autofocus={dialog()?.input === undefined}
              onClick={() => setDialog(undefined)}
            >
              Cancel
            </button>
            <Show when={dialog()?.alternate}>
              <button
                classList={{ danger: dialog()?.alternate?.danger }}
                disabled={dialogBusy()}
                onClick={() => void runDialogAction(dialog()?.alternate?.run)}
              >
                {dialog()?.alternate?.action}
              </button>
            </Show>
            <button
              classList={{ primary: true, danger: dialog()?.danger }}
              disabled={dialogBusy()}
              onClick={() =>
                void runDialogAction(() => dialog()?.run(dialogValue()))
              }
            >
              {dialogBusy() ? "WORKING…" : dialog()?.action}
            </button>
          </div>
        </dialog>
      </Show>
      <Show when={palette()}>
        <dialog
          ref={paletteElement}
          class="command-palette"
          aria-label="Command palette"
          onCancel={() => setPalette(false)}
          onKeyDown={(e) => {
            const rows = [
              ...paletteElement.querySelectorAll<HTMLButtonElement>(
                ".command-row",
              ),
            ];
            if (!rows.length) return;
            const index = rows.indexOf(document.activeElement as never);
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              const next =
                index < 0
                  ? step > 0
                    ? 0
                    : rows.length - 1
                  : (index + step + rows.length) % rows.length;
              rows[next].focus();
            } else if (
              e.key === "Enter" &&
              (e.target as HTMLElement).tagName === "INPUT"
            ) {
              e.preventDefault();
              rows[0].click();
            }
          }}
        >
          <div class="command-input">
            <span>&gt;</span>
            <input
              autofocus
              aria-label="Search commands"
              placeholder="What would you like to do?"
              value={commandQuery()}
              onInput={(e) => setCommandQuery(e.currentTarget.value)}
            />
            <button
              aria-label="Close command palette"
              onClick={() => setPalette(false)}
            >
              <kbd>ESC</kbd>
            </button>
          </div>
          <div class="section-label">COMMANDS</div>
          <For
            each={commands().filter((c) =>
              c.label.toLowerCase().includes(commandQuery().toLowerCase()),
            )}
          >
            {(c) => (
              <button
                class="command-row"
                onClick={() => {
                  setPalette(false);
                  void c.run();
                }}
              >
                <Icon name="chevron" size={12} />
                <span>{c.label}</span>
                <Show when={c.key}>
                  <kbd>{c.key}</kbd>
                </Show>
              </button>
            )}
          </For>
          <div class="palette-footer">
            ↑↓ to navigate <span>ENTER to execute</span>
          </div>
        </dialog>
      </Show>
    </div>
  );
}
