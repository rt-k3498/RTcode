import {
  createSignal,
  For,
  Show,
  createMemo,
  onMount,
  onCleanup,
  type JSX,
} from "solid-js";
import { Icon } from "../components/Icon";
import { defaultPalette } from "../theme/colors";
import type { Preferences } from "./preferences";
import guide from "../guide/generated.json";
export default function Settings(p: {
  tab: string;
  setTab: (t: string) => void;
  article: string;
  setArticle: (a: string) => void;
  close: () => void;
  prefs: Preferences;
  update: (k: keyof Preferences, v: unknown) => void;
  showMe: (t: string) => void;
  trusted: boolean;
  trust: () => void;
  notice?: JSX.Element;
}) {
  const tabs = [
    "Guide",
    "General",
    "Editor",
    "Files & Search",
    "Git",
    "Terminal",
    "SSH",
    "Languages & Format",
    "Extensions",
    "Appearance",
    "Security",
    "Shortcuts",
    "About",
  ];
  const [query, setQuery] = createSignal("");
  const [back, setBack] = createSignal<string[]>([]);
  const [forward, setForward] = createSignal<string[]>([]);
  let search!: HTMLInputElement;
  let body!: HTMLDivElement;
  let dialog!: HTMLDialogElement;
  const scrolls = new Map<string, number>();
  const article = createMemo(
    () => guide.find((a) => a.id === p.article) || guide[0],
  );
  const matches = createMemo(() => {
    const q = query().toLowerCase().trim();
    return q
      ? guide.filter((a) =>
          (
            a.title +
            " " +
            a.summary +
            " " +
            a.blocks.map((b) => b.text).join(" ")
          )
            .toLowerCase()
            .includes(q),
        )
      : [];
  });
  function navigate(id: string) {
    scrolls.set(p.article, body?.scrollTop || 0);
    setBack((v) => [...v, p.article]);
    setForward([]);
    p.setArticle(id);
    setQuery("");
    queueMicrotask(() => {
      if (body) body.scrollTop = scrolls.get(id) || 0;
    });
  }
  function history(direction: "back" | "forward") {
    const from = direction === "back" ? back : forward;
    const to = direction === "back" ? setForward : setBack;
    const set = direction === "back" ? setBack : setForward;
    const id = from().at(-1);
    if (id) {
      to((v) => [...v, p.article]);
      set((v) => v.slice(0, -1));
      p.setArticle(id);
    }
  }
  onMount(() => {
    dialog.showModal();
    (
      search ||
      dialog.querySelector<HTMLButtonElement>(".settings-nav .selected")
    )?.focus();
    const handler = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        e.key === "f" &&
        p.tab === "Guide"
      ) {
        e.preventDefault();
        search?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    onCleanup(() => window.removeEventListener("keydown", handler));
  });
  const toggle = (
    title: string,
    detail: string,
    key: "wrap" | "minimap" | "contrast" | "motion",
  ) => (
    <div class="setting-row">
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      <button
        role="switch"
        aria-label={title}
        aria-checked={p.prefs[key]}
        classList={{ switch: true, on: p.prefs[key] }}
        onClick={() => p.update(key, !p.prefs[key])}
      >
        {p.prefs[key] ? "ON" : "OFF"}
      </button>
    </div>
  );
  return (
    <dialog
      ref={dialog}
      class="settings-route"
      aria-label="Settings and Guide"
      onCancel={(event) => {
        event.preventDefault();
        p.close();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = [
          ...dialog.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), a[href], [tabindex='0']",
          ),
        ].filter((element) => element.getClientRects().length);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <div class="settings-nav">
        <div class="section-label">SYSTEM / SETTINGS</div>
        <For each={tabs}>
          {(tab) => (
            <button
              classList={{ selected: p.tab === tab }}
              onClick={() => p.setTab(tab)}
            >
              {tab === "Guide" && <Icon name="book" />}
              {tab}
              <Show when={tab === "Guide"}>
                <span class="tag">OFFLINE</span>
              </Show>
            </button>
          )}
        </For>
        <div class="settings-version">
          RTcode 0.1.0
          <br />
          <span>LOCAL-FIRST / EARLY BUILD</span>
        </div>
      </div>
      <div class="settings-main">
        <div class="settings-heading">
          <span>
            {p.tab === "Guide" ? "OPERATOR GUIDE" : p.tab.toUpperCase()}
          </span>
          <span class="grow" />
          <button onClick={p.close}>
            <Icon name="back" /> Back to editor <kbd>ESC</kbd>
          </button>
        </div>
        <Show
          when={p.tab === "Guide"}
          fallback={
            <div class="settings-content">
              <h1>{p.tab}</h1>
              <Show when={p.tab === "Editor"}>
                {toggle(
                  "Word wrap",
                  "Wrap long lines within the editor.",
                  "wrap",
                )}
                {toggle(
                  "Minimap",
                  "Show an overview of the active document.",
                  "minimap",
                )}
                <div class="setting-row">
                  <div>
                    <strong>Editor font size</strong>
                    <p>Independent of workbench and Guide text.</p>
                  </div>
                  <input
                    aria-label="Editor font size"
                    type="number"
                    min="10"
                    max="28"
                    value={p.prefs.fontSize}
                    onChange={(e) =>
                      p.update(
                        "fontSize",
                        Math.min(28, Math.max(10, +e.currentTarget.value)),
                      )
                    }
                  />
                </div>
              </Show>
              <Show when={p.tab === "Appearance"}>
                {toggle(
                  "High contrast",
                  "Stronger boundaries and text. Same console geometry.",
                  "contrast",
                )}
                {toggle(
                  "Restrained motion",
                  "Brief feedback; no continuous visual effects.",
                  "motion",
                )}
                <div class="palette-preview">
                  <For each={Object.values(p.prefs.colors)}>
                    {(color) => <span style={{ background: color }} />}
                  </For>
                  <span>BASE COLORS</span>
                </div>
                <For
                  each={
                    [
                      [
                        "accent",
                        "Primary accent",
                        "Orange by default: actions, highlights, and the logo chevron.",
                      ],
                      [
                        "teal",
                        "Secondary accent",
                        "Teal by default: signals and the logo underscore.",
                      ],
                      [
                        "background",
                        "Background",
                        "Editor and terminal canvas.",
                      ],
                      ["surface", "Surface", "Panels, toolbars, and settings."],
                      [
                        "text",
                        "Text",
                        "Main text across the workbench, editor, and terminals.",
                      ],
                    ] as const
                  }
                >
                  {([key, label, description]) => (
                    <div class="setting-row">
                      <div>
                        <strong>{label}</strong>
                        <p>{description}</p>
                      </div>
                      <label class="color-control">
                        <code>{p.prefs.colors[key]}</code>
                        <input
                          type="color"
                          aria-label={`${label} color`}
                          value={p.prefs.colors[key]}
                          onInput={(e) =>
                            p.update("colors", {
                              ...p.prefs.colors,
                              [key]: e.currentTarget.value,
                            })
                          }
                        />
                      </label>
                    </div>
                  )}
                </For>
                <button
                  onClick={() => p.update("colors", { ...defaultPalette })}
                >
                  Reset colors to orange &amp; teal
                </button>
              </Show>
              <Show when={p.tab === "Languages & Format"}>
                <p>
                  TypeScript and JavaScript include completion, type checking,
                  hover, signature help, inlay hints, navigation, rename, and
                  quick fixes. JSON and CSS include validation; HTML includes
                  completion and hover. The desktop app reads tsconfig/jsconfig,
                  inherited aliases, unopened workspace sources, and installed
                  dependency types. Projects refresh when you save or return to
                  the app. External Rust/Python language servers are not yet
                  loaded.
                </p>
                <div class="setting-row">
                  <div>
                    <strong>External formatter</strong>
                    <p>
                      Runs directly with the document on stdin, only in trusted
                      workspaces.
                    </p>
                  </div>
                  <input
                    aria-label="Formatter executable"
                    placeholder="prettier"
                    value={p.prefs.formatter}
                    onChange={(e) =>
                      p.update("formatter", e.currentTarget.value)
                    }
                  />
                </div>
                <div class="setting-row">
                  <div>
                    <strong>Argument array</strong>
                    <p>
                      JSON string array. Use {"{file}"} for the document path.
                    </p>
                  </div>
                  <input
                    aria-label="Formatter arguments"
                    value={p.prefs.formatterArgs}
                    onChange={(e) =>
                      p.update("formatterArgs", e.currentTarget.value)
                    }
                  />
                </div>
              </Show>
              <Show when={p.tab === "Security"}>
                <div class="setting-row">
                  <div>
                    <strong>Workspace trust</strong>
                    <p>Trust allows shells, formatters, and Git mutations.</p>
                  </div>
                  <button onClick={p.trust}>
                    {p.trusted ? "Revoke trust" : "Review trust"}
                  </button>
                </div>
                <p>
                  No telemetry. No terminal transcripts. No passwords stored.
                </p>
              </Show>
              <Show when={p.tab === "About"}>
                <div class="about-mark">
                  R<span>_</span>
                  <em>&gt;</em>
                </div>
                <h2>RTcode</h2>
                <p>Version 0.1.0 · development build</p>
                <p>Tauri v2 / SolidJS / Monaco / xterm.js / Rust</p>
                <p>
                  Release signing, updater infrastructure, and cross-platform
                  certification are pending.
                </p>
              </Show>
              <Show
                when={
                  ![
                    "Editor",
                    "Appearance",
                    "Languages & Format",
                    "Security",
                    "About",
                  ].includes(p.tab)
                }
              >
                <p>
                  {p.tab === "Extensions"
                    ? "Executable VS Code extensions are not supported. Declarative VSIX installation remains pending."
                    : "Read the bundled reference for current behavior and available controls."}
                </p>
                <button
                  class="primary"
                  onClick={() => {
                    const tab = p.tab;
                    p.setTab("Guide");
                    navigate(
                      (
                        {
                          General: "welcome",
                          "Files & Search": "search",
                          Git: "git",
                          Terminal: "terminal",
                          SSH: "ssh",
                          Shortcuts: "keyboard",
                          Extensions: "extensions",
                        } as Record<string, string>
                      )[tab] || "welcome",
                    );
                  }}
                >
                  Open {p.tab} reference <Icon name="arrow" />
                </button>
              </Show>
            </div>
          }
        >
          <div class="guide-toolbar">
            <button
              aria-label="Previous Guide location"
              disabled={!back().length}
              onClick={() => history("back")}
            >
              <Icon name="back" />
            </button>
            <button
              aria-label="Next Guide location"
              disabled={!forward().length}
              onClick={() => history("forward")}
            >
              <Icon name="arrow" />
            </button>
            <span class="breadcrumb">Guide / {article().title}</span>
            <label class="guide-search">
              <Icon name="search" />
              <input
                ref={search}
                placeholder="Search the guide…"
                aria-label="Search the guide"
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
              />
              <kbd>⌘ F</kbd>
            </label>
          </div>
          <div class="guide-layout">
            <div
              class="guide-body"
              ref={body}
              style={{ "font-size": p.prefs.guideZoom + "px" }}
            >
              <Show
                when={!query()}
                fallback={
                  <>
                    <div class="section-label">
                      {matches().length} MATCHING ARTICLES
                    </div>
                    <h1>Search the Guide</h1>
                    <For each={matches()}>
                      {(a) => (
                        <button
                          class="guide-result"
                          onClick={() => navigate(a.id)}
                        >
                          <strong>{a.title}</strong>
                          <p>{a.summary}</p>
                          <span>Guide / {a.title} →</span>
                        </button>
                      )}
                    </For>
                    <Show when={!matches().length}>
                      <p>
                        No articles match “{query()}”. Try “trust”, “save”, or
                        “terminal”.
                      </p>
                    </Show>
                  </>
                }
              >
                <div class="guide-meta">
                  <span class="lamp" />
                  BUNDLED DOCUMENTATION <span>v0.1.0</span>
                </div>
                <h1>{article().title}</h1>
                <p class="guide-summary">{article().summary}</p>
                <Show when={article().id === "welcome"}>
                  <div class="workbench-map">
                    <div>
                      R_&gt; <span>WORKSPACE / COMMANDS</span>
                    </div>
                    <div class="map-panes">
                      <span>
                        FILES
                        <br />
                        SEARCH
                        <br />
                        GIT
                      </span>
                      <span>
                        YOUR CODE
                        <br />
                        <small>One editor. A clear head.</small>
                      </span>
                      <span>
                        TERMINAL
                        <br />
                        <small>Local + SSH</small>
                      </span>
                    </div>
                    <div>
                      POSITION / LANGUAGE <span>FORMAT / TRUST</span>
                    </div>
                  </div>
                  <button class="primary" onClick={() => p.showMe("files")}>
                    Explore the workbench <Icon name="arrow" />
                  </button>
                </Show>
                <For each={article().blocks}>
                  {(b) => (
                    <Show
                      when={b.type === "heading"}
                      fallback={
                        <Show
                          when={b.type === "code"}
                          fallback={<p>{b.text}</p>}
                        >
                          <div class="guide-code">
                            <button
                              aria-label="Copy command example"
                              onClick={() =>
                                navigator.clipboard.writeText(b.text)
                              }
                            >
                              <Icon name="copy" /> Copy
                            </button>
                            <pre>{b.text}</pre>
                          </div>
                        </Show>
                      }
                    >
                      <h2 id={b.anchor}>{b.text}</h2>
                    </Show>
                  )}
                </For>
                <div class="guide-next">
                  <span>KEEP EXPLORING</span>
                  <button
                    onClick={() =>
                      navigate(
                        guide[
                          (guide.findIndex((a) => a.id === p.article) + 1) %
                            guide.length
                        ].id,
                      )
                    }
                  >
                    {
                      guide[
                        (guide.findIndex((a) => a.id === p.article) + 1) %
                          guide.length
                      ].title
                    }
                    <Icon name="arrow" />
                  </button>
                </div>
              </Show>
            </div>
            <aside class="guide-contents">
              <div class="section-label">IN THIS GUIDE</div>
              <For each={guide}>
                {(a, i) => (
                  <button
                    classList={{ selected: p.article === a.id }}
                    onClick={() => navigate(a.id)}
                  >
                    <span>{String(i() + 1).padStart(2, "0")}</span>
                    {a.title}
                  </button>
                )}
              </For>
              <div class="guide-offline">
                <Icon name="shield" />
                <span>
                  Always here.
                  <br />
                  No connection required.
                </span>
              </div>
            </aside>
          </div>
        </Show>
      </div>
      {p.notice}
    </dialog>
  );
}
