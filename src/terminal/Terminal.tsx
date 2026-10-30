import {
  createSignal,
  createEffect,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { themeTokens, type Palette } from "../theme/colors";
import { api, native } from "../ipc/client";
import type { Workspace } from "../ipc/types";
import { errorMessage } from "../ipc/types";
import { Icon } from "../components/Icon";
type Session = {
  id: string;
  workspaceId: string;
  backend?: string;
  title: string;
  term: XTerm;
  fit: FitAddon;
  element: HTMLDivElement;
  exited: boolean;
};
export type TerminalHandle = {
  create: (alias?: string) => Promise<void>;
  focus: () => void;
  hasLive: (workspaceId?: string) => boolean;
  closeAll: (workspaceId?: string) => Promise<void>;
  closeActive: () => Promise<void>;
};
export default function Terminal(p: {
  colors: Palette;
  contrast: boolean;
  workspace?: Workspace;
  workspaces: Workspace[];
  workspaceColor: (id: string) => string;
  label: string;
  onFocus: () => void;
  onReady: (h: TerminalHandle) => void;
  onError: (s: string) => void;
  onTrust: (workspace: Workspace, afterTrust?: () => void) => void;
  onHide: () => void;
  onCloseRequest: () => void;
  onState: (s: string) => void;
}) {
  let host!: HTMLDivElement;
  let picker!: HTMLDialogElement;
  let pendingAlias: string | undefined;
  const [choosing, setChoosing] = createSignal(false);
  const [sessions, setSessions] = createSignal<Session[]>([]);
  const [active, setActive] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let observer: ResizeObserver;
  let timer: ReturnType<typeof setTimeout>;
  let generation = 0;
  let disposed = false;
  function terminalTheme() {
    const tokens = themeTokens(p.colors, p.contrast);
    return {
      background: tokens.canvas,
      foreground: tokens.text,
      cursor: tokens.amber,
      selectionBackground: tokens.border,
      black: tokens.raised,
      red: "#f07178",
      green: "#8fbf7f",
      yellow: "#e7c66b",
      blue: "#7aa2c9",
      magenta: "#c7a3d6",
      cyan: tokens.teal,
      white: tokens.text,
      brightBlack: tokens.muted,
      brightRed: "#ff8890",
      brightGreen: "#afd19f",
      brightYellow: "#f4d88d",
      brightBlue: "#9cc4e3",
      brightMagenta: "#dfb9ec",
      brightCyan: tokens.teal,
      brightWhite: tokens.text,
    };
  }
  createEffect(() => {
    const theme = terminalTheme();
    sessions().forEach((session) => {
      session.term.options.theme = theme;
    });
  });
  function fit(s: Session) {
    try {
      s.fit.fit();
      if (s.backend && !s.exited)
        void api
          .resize(s.backend, s.term.cols, s.term.rows)
          .catch((e) => p.onError(errorMessage(e)));
    } catch {}
  }
  function select(s: Session) {
    setActive(s.id);
    sessions().forEach(
      (x) => (x.element.style.display = x === s ? "block" : "none"),
    );
    fit(s);
    s.term.focus();
    p.onState(
      s.exited
        ? "EXITED"
        : s.title.startsWith("ssh:")
          ? "SSH PROCESS"
          : "LOCAL",
    );
  }
  async function create(alias?: string) {
    if (busy() || disposed || choosing()) return;
    if (p.workspaces.length > 1) {
      pendingAlias = alias;
      setChoosing(true);
      picker.showModal();
      return;
    }
    await createInWorkspace(p.workspace, alias);
  }
  async function createInWorkspace(
    workspace: Workspace | undefined,
    alias?: string,
  ) {
    if (busy() || disposed) return;
    const createdGeneration = generation;
    if (!native) {
      p.onError("A real shell requires the desktop app. Run pnpm tauri dev.");
      return;
    }
    if (!workspace) {
      p.onError("Open a local folder first.");
      return;
    }
    if (!workspace.trusted) {
      p.onTrust(
        workspace,
        () => void createInWorkspace({ ...workspace, trusted: true }, alias),
      );
      return;
    }
    if (sessions().length >= 8) {
      p.onError("Close a terminal before opening another (limit: 8).");
      return;
    }
    setBusy(true);
    const term = new XTerm({
      fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.5,
      cursorBlink: false,
      scrollback: 10000,
      theme: terminalTheme(),
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.parser.registerOscHandler(52, () => true);
    const element = document.createElement("div");
    element.className = "terminal-instance";
    host.appendChild(element);
    term.open(element);
    const session: Session = {
      id: crypto.randomUUID(),
      workspaceId: workspace.id,
      title: alias
        ? `ssh:${alias} · ${workspace.name}`
        : `${workspace.name} · shell ${sessions().length + 1}`,
      term,
      fit: fitAddon,
      element,
      exited: false,
    };
    setSessions((v) => [...v, session]);
    select(session);
    try {
      session.backend = await api.terminal(workspace.id, alias, (event) => {
        if (
          disposed ||
          generation !== createdGeneration ||
          !sessions().includes(session)
        )
          return;
        if (event.data) term.write(new Uint8Array(event.data));
        if (event.error) p.onError(event.error);
        if (event.exitCode !== undefined) {
          session.exited = true;
          term.writeln(`\r\n[process exited: ${event.exitCode}]`);
          setSessions((v) => [...v]);
          if (active() === session.id) p.onState("EXITED");
        }
      });
      if (
        disposed ||
        generation !== createdGeneration ||
        !sessions().includes(session)
      ) {
        await api.close(session.backend);
        return;
      }
      term.onData((data) => {
        if (session.backend && !session.exited)
          void api
            .write(session.backend, data)
            .catch((e) => p.onError(errorMessage(e)));
      });
      fit(session);
    } catch (e) {
      session.exited = true;
      if (
        disposed ||
        generation !== createdGeneration ||
        !sessions().includes(session)
      )
        return;
      setSessions((v) => [...v]);
      if (active() === session.id) p.onState("EXITED");
      term.writeln(errorMessage(e));
      p.onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function closeActive() {
    const session = sessions().find((s) => s.id === active());
    if (!session) return;
    if (session.backend) await api.close(session.backend);
    session.term.dispose();
    session.element.remove();
    setSessions((v) => v.filter((s) => s.id !== session.id));
    const next = sessions().at(-1);
    if (next) select(next);
    else {
      setActive("");
      p.onState("OFFLINE");
    }
  }
  async function closeAll(workspaceId?: string) {
    if (!workspaceId) generation++;
    const closing = sessions().filter(
      (s) => !workspaceId || s.workspaceId === workspaceId,
    );
    setSessions((all) => all.filter((s) => !closing.includes(s)));
    if (!sessions().some((s) => s.id === active())) {
      const next = sessions().at(-1);
      if (next) select(next);
      else {
        setActive("");
        p.onState("OFFLINE");
      }
    }
    for (const session of closing) {
      session.term.dispose();
      session.element.remove();
    }
    await Promise.all(
      closing.map(async (s) => {
        if (s.backend) await api.close(s.backend);
      }),
    );
  }
  onMount(() => {
    observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => sessions().forEach(fit), 30);
    });
    observer.observe(host);
    p.onReady({
      create,
      focus: () =>
        sessions()
          .find((x) => x.id === active())
          ?.term.focus(),
      hasLive: (workspaceId) =>
        sessions().some(
          (s) => !s.exited && (!workspaceId || s.workspaceId === workspaceId),
        ),
      closeAll,
      closeActive,
    });
  });
  onCleanup(() => {
    disposed = true;
    generation++;
    clearTimeout(timer);
    observer?.disconnect();
    sessions().forEach((s) => {
      s.term.dispose();
      if (s.backend) void api.close(s.backend).catch(() => {});
    });
  });
  return (
    <section
      class="terminal-pane"
      aria-label={p.label}
      onFocusIn={p.onFocus}
      onPointerDown={p.onFocus}
    >
      <dialog
        ref={picker}
        class="terminal-workspace-picker"
        aria-label="Choose terminal workspace"
        onClose={() => setChoosing(false)}
      >
        <h2>Which workspace?</h2>
        <p>Start the terminal in a workspace folder.</p>
        <div class="workspace-list">
          <For each={p.workspaces}>
            {(ws) => (
              <button
                class="workspace-option"
                style={{ "--workspace-color": p.workspaceColor(ws.id) }}
                onClick={() => {
                  picker.close();
                  void createInWorkspace(ws, pendingAlias);
                }}
              >
                <Icon name="folder" />
                <span class="workspace-option-copy">
                  <span>{ws.name}</span>
                  <small>{ws.displayPath}</small>
                </span>
                <Show when={!ws.trusted}>
                  <span class="workspace-current">Restricted</span>
                </Show>
              </button>
            )}
          </For>
        </div>
        <div class="dialog-actions">
          <button autofocus onClick={() => picker.close()}>
            Cancel
          </button>
        </div>
      </dialog>
      <div class="pane-bar">
        <Icon name="terminal" />
        <span>{p.label.toUpperCase()}</span>
        <span class="grow" />
        <button
          title="New terminal"
          aria-label="New terminal"
          disabled={busy()}
          onClick={() => create()}
        >
          <Icon name="plus" />
        </button>
        <Show when={sessions().length}>
          <button
            title="Close active terminal"
            aria-label="Close active terminal"
            onClick={p.onCloseRequest}
          >
            <Icon name="close" />
          </button>
        </Show>
        <button
          title="Hide terminal"
          aria-label="Hide terminal"
          onClick={p.onHide}
        >
          <Icon name="minus" />
        </button>
      </div>
      <Show when={sessions().length}>
        <div class="terminal-tabs">
          <For each={sessions()}>
            {(s) => (
              <button
                classList={{ active: active() === s.id }}
                onClick={() => select(s)}
              >
                <span classList={{ lamp: true, off: s.exited }} />
                {s.title}
              </button>
            )}
          </For>
        </div>
      </Show>
      <div class="terminal-host" ref={host} />
      <Show when={!sessions().length}>
        <div class="terminal-idle">
          <div class="terminal-prompt">
            <span>R_&gt;</span> terminal ready
          </div>
          <p>
            Your shell. Your environment.
            <br />
            Right where you need it.
          </p>
          <div class="terminal-rule" />
          <div class="readout">
            <span>TRANSPORT</span>
            <span>LOCAL PTY</span>
          </div>
          <div class="readout">
            <span>SESSION</span>
            <span>NOT STARTED</span>
          </div>
          <div class="readout">
            <span>WORKSPACE</span>
            <span>{p.workspace?.trusted ? "TRUSTED" : "RESTRICTED"}</span>
          </div>
          <button class="primary start-terminal" onClick={() => create()}>
            <Icon name="plus" /> Start a terminal
          </button>
          <p class="terminal-footnote">
            {native
              ? "Shells start only when you ask."
              : "Browser preview · native shell unavailable"}
          </p>
        </div>
      </Show>
      <div class="terminal-bottom">
        <span classList={{ lamp: true, off: !sessions().length }} />
        <span>
          {sessions().length
            ? `${sessions().length} SESSION${sessions().length > 1 ? "S" : ""}`
            : "NO ACTIVE SESSION"}
        </span>
        <span class="grow" />
        <span>UTF-8</span>
      </div>
    </section>
  );
}
