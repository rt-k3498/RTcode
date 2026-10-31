import { invoke, Channel, isTauri } from "@tauri-apps/api/core";
import type {
  Workspace,
  Entry,
  Document,
  GitState,
  SearchOptions,
  Match,
  Stream,
  SearchSummary,
  ReplaceResult,
  ProjectEntry,
  FileSearch,
} from "./types";
import {
  sampleWorkspace,
  demoOpen,
  demoSave,
  demoTree,
  demoSearch,
  demoSearchFiles,
  demoReplace,
  emptyGit,
} from "./demo";
export const native = isTauri();
export const api = {
  projectRead: (workspaceId: string, paths: string[]) =>
    native
      ? invoke<ProjectEntry[]>("project_read", { workspaceId, paths })
      : Promise.resolve([] as ProjectEntry[]),
  launchWorkspace: () =>
    native
      ? invoke<Workspace | null>("workspace_open_launch_directory")
      : Promise.resolve(null),
  openWorkspace: () =>
    native
      ? invoke<Workspace | null>("workspace_pick_and_open")
      : Promise.resolve(sampleWorkspace),
  closeWorkspace: (workspaceId: string) =>
    native
      ? invoke<void>("workspace_close", { workspaceId })
      : Promise.resolve(),
  trust: (workspaceId: string, trusted: boolean) =>
    invoke<void>("workspace_set_trust", { workspaceId, trusted }),
  tree: (workspaceId: string, pathId: string) =>
    native
      ? invoke<Entry[]>("tree_read_children", { workspaceId, pathId })
      : Promise.resolve(demoTree(pathId)),
  open: (workspaceId: string, pathId: string) =>
    native
      ? invoke<Document>("file_open", { workspaceId, pathId })
      : Promise.resolve(demoOpen(pathId)),
  save: (
    documentId: string,
    revision: string,
    text: string,
    overwrite = false,
  ) =>
    native
      ? invoke<string>("file_save", { documentId, revision, text, overwrite })
      : Promise.resolve(demoSave(documentId, text)),
  create: (
    workspaceId: string,
    parentId: string,
    name: string,
    directory: boolean,
  ) => invoke<Entry>("file_create", { workspaceId, parentId, name, directory }),
  rename: (workspaceId: string, pathId: string, name: string) =>
    invoke<void>("file_rename", { workspaceId, pathId, name }),
  trash: (workspaceId: string, pathId: string) =>
    invoke<void>("file_move_to_trash", { workspaceId, pathId }),
  git: (workspaceId: string) =>
    native
      ? invoke<GitState>("git_snapshot", { workspaceId })
      : Promise.resolve(emptyGit),
  openWorktree: (workspaceId: string, path: string) =>
    invoke<Workspace>("git_open_worktree", { workspaceId, path }),
  gitAction: (workspaceId: string, action: string, path: string) =>
    invoke<void>("git_action", { workspaceId, action, path }),
  diff: (workspaceId: string, path: string, staged: boolean) =>
    invoke<string>("git_diff", { workspaceId, path, staged }),
  search: async (
    workspaceId: string,
    requestId: string,
    options: SearchOptions,
    onMatch: (matches: Match[]) => void,
  ) => {
    if (!native) {
      const matches = demoSearch(options);
      onMatch(matches);
      return { skippedFiles: 0 };
    }
    const channel = new Channel<Match[]>();
    channel.onmessage = onMatch;
    return invoke<SearchSummary>("search_start", {
      workspaceId,
      requestId,
      options,
      channel,
    });
  },
  searchFiles: (workspaceId: string, requestId: string, query: string) =>
    native
      ? invoke<FileSearch>("search_files", { workspaceId, requestId, query })
      : Promise.resolve(demoSearchFiles(query)),
  replaceMatches: (
    workspaceId: string,
    options: SearchOptions,
    matches: Match[],
    replacement: string,
  ) =>
    native
      ? invoke<ReplaceResult>("search_replace", {
          workspaceId,
          options,
          matches,
          replacement,
        })
      : Promise.resolve(demoReplace(options, matches, replacement)),
  cancelSearch: (requestId: string) =>
    native ? invoke("search_cancel", { requestId }) : Promise.resolve(),
  terminal: (
    workspaceId: string,
    alias: string | undefined,
    onData: (s: Stream) => void,
  ) => {
    const channel = new Channel<Stream>();
    channel.onmessage = onData;
    return invoke<string>("terminal_create", { workspaceId, alias, channel });
  },
  write: (terminalId: string, data: string) =>
    invoke("terminal_write", { terminalId, data }),
  resize: (terminalId: string, cols: number, rows: number) =>
    invoke("terminal_resize", { terminalId, cols, rows }),
  close: (terminalId: string) => invoke("terminal_close", { terminalId }),
  sshProfiles: () =>
    native ? invoke<string[]>("ssh_profiles") : Promise.resolve([]),
  settings: () =>
    native
      ? invoke<Record<string, unknown>>("settings_get")
      : Promise.resolve({} as Record<string, unknown>),
  set: (key: string, value: unknown) =>
    native ? invoke("settings_update", { key, value }) : Promise.resolve(),
  format: (documentId: string, text: string, command: string, args: string[]) =>
    invoke<string>("format_run", { documentId, text, command, args }),
};
