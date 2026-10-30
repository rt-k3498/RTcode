export function Icon(p: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    files: "M5 3h9l5 5v13H5z M14 3v6h5",
    folder: "M3 6h7l2 2h9v12H3z",
    eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0",
    search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13 M16 16l5 5",
    git: "M6 3v12a4 4 0 0 0 4 4h5 M6 7h8a4 4 0 0 0 4-4 M4 3h4v4H4z M16 1h4v4h-4z M15 17h4v4h-4z",
    terminal: "m4 6 6 6-6 6 M13 18h7",
    chevron: "m9 5 7 7-7 7",
    down: "m6 9 6 6 6-6",
    plus: "M12 5v14 M5 12h14",
    close: "m6 6 12 12 M6 18 18 6",
    settings: "M4 7h16 M4 17h16 M8 4v6 M16 14v6",
    command:
      "M9 9V5a2 2 0 1 0-2 2h10a2 2 0 1 0-2-2v14a2 2 0 1 0 2-2H7a2 2 0 1 0 2 2V9",
    refresh: "M20 8a8 8 0 1 0 0 8 M20 3v5h-5",
    book: "M12 5C8 2 4 3 2 4v16c4-2 7-1 10 1 3-2 6-3 10-1V4c-4-2-7-1-10 1v16",
    shield: "m12 2 8 3v6c0 5-4 9-8 11-4-2-8-6-8-11V5z M8 12l3 3 5-6",
    save: "M4 3h14l3 3v15H3V3z M7 3v6h10V3 M7 21v-8h10v8",
    arrow: "M5 12h14 M13 6l6 6-6 6",
    back: "M19 12H5 M11 6l-6 6 6 6",
    layout: "M3 4h18v16H3z M15 4v16",
    check: "m5 12 4 4L19 6",
    copy: "M8 8h13v13H8z M16 8V3H3v13h5",
    minus: "M5 12h14",
    link: "M9 15l6-6 M9 7l2-2a5 5 0 0 1 7 7l-2 2 M15 17l-2 2a5 5 0 0 1-7-7l2-2",
  };
  return (
    <svg
      width={p.size || 15}
      height={p.size || 15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={paths[p.name] || paths.files} />
    </svg>
  );
}
