{"id": "extensions", "title": "Extensions", "summary": "No blanket VS Code compatibility claim.", "order": 9, "introduced": "0.1.0", "updated": "0.1.0"}
---

## Current support

VSIX installation and contribution registration are not implemented in this early build. No extension JavaScript runs. Do not place untrusted extension code in the application source.

## Compatibility contract

The intended first tier contains only allowlisted declarative themes, snippets, and language metadata. Grammars need a separate CSP and size spike. Browser extensions are conditional. Node-only extensions require a larger architecture decision.

## Sources and licenses

The application does not contact the Visual Studio Marketplace. Future user-supplied VSIX packages must be inspected for archive safety, contribution compatibility, source, hash, and license before an explicit install action.
