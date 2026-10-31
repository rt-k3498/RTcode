# RTcode design system

## Visual thesis
A developer working at a desk in low evening light needs a precise, quiet command instrument. Near-black navy surfaces, warm readable text, amber command edges, and teal live indicators create the specified retro-futurist console.

## Surface plan
The top strip identifies the selected workspace and commands. Its workspace dropdown lists open folders with a fixed Add workspace footer. Each workspace has a distinct color shared by its explorer root-name border and editor-tab highlight. Files keeps all roots in one explorer; Search and Git follow the selected workspace. New terminals ask for a workspace when multiple roots are open. Worktrees offer Add or Replace, with replacement scoped to the selected root. Files/Search/Git occupy the left pane. Monaco owns the main canvas. Independent terminal panes can occupy the right and bottom simultaneously. A compact status strip exposes file, tool, and trust state. Settings overlays the preserved workbench and opens an offline Guide.

## Interaction thesis
Focus energizes a crisp amber edge. Pane transitions last 120ms without animating terminal cells. Notices enter once; reduced motion disables transitions. No looping ornamental effects.

## Tokens and geometry
Canvas #0b0f14; surface #111821; raised #17212b; input #0e141b. Text #e7dccb; secondary #a7afb5; muted #87919b. Amber #faa968; teal #5db7a5; error #f07178. Interactive boundaries use #607480 (3.8:1 against input surfaces). One-pixel borders, 2px corners, 4px spacing unit, local monospace fonts. No external assets.

## Layout
34px top strip and pane headers (sidebar tabs, editor tabs, terminal and Problems bars), 30px editor breadcrumb, 28px status strip and pane footers. Spacing follows the 4px unit; workbench text never drops below 10px. Sidebar 248px default, editor at least 360px, right terminal 36%. Below 1000px terminal moves below and sidebar becomes a rail/overlay.

The app name is RTcode; the original R_> logo remains. Appearance exposes customizable base colors with the original orange/teal palette as the default.
