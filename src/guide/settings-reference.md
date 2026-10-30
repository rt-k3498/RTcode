{"id": "settings-reference", "title": "Settings reference", "summary": "Typed preferences stored as metadata in native SQLite.", "order": 11, "introduced": "0.1.0", "updated": "0.1.0"}
---

## Editor settings

fontSize: number, default 13, range 10–28. wrap: boolean, default false. minimap: boolean, default false. All apply immediately at user scope.

## Appearance settings

contrast: boolean, default false. motion: boolean, default true. colors: base-color object with primary accent #faa968 (orange), secondary accent #5db7a5 (teal), background #0b0f14, surface #111821, and text #e7dccb. Colors persist with native user preferences; browser preview colors last for the current page session. All apply immediately. Operating-system reduced motion overrides motion effects.

## Tools and layout

formatter: executable string, default empty. formatterArgs: JSON string array, default []. Execution requires trust. layout stores terminal placement and pane extents. These settings do not store source buffers or terminal content.

## Storage

Native preferences and exact-root trust live in the app-data SQLite database. Browser preview preferences last only for the page session. Workspace-specific overrides, export, sync, reset, and migration recovery UI are pending.
