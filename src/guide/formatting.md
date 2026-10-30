{"id": "formatting", "title": "Formatting", "summary": "Configure an installed formatter, then apply one undoable edit.", "order": 8, "introduced": "0.1.0", "updated": "0.1.0"}
---

## Configure a provider

Settings → Languages & Format accepts an executable and a JSON argument array. The formatter receives document text on stdin and returns replacement text on stdout. The {file} placeholder is replaced inside each argument; no shell expansion occurs.

## Run and recover

Press FORMAT or Shift+Alt+F. External formatters require a trusted workspace, have a ten-second runtime cap, and bounded output. If the document or version changes while formatting, the response is discarded. Failures preserve your buffer. Format-on-save and LSP priority are pending.

## Example arguments

For an installed prettier executable, set the argument array to ["--stdin-filepath", "{file}"]. This example is configuration text, not a Run button.

## Built-in formatting

When no external formatter is configured, Format Document tries the bundled formatter for the active language. External formatters take precedence when configured.
