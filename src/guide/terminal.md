{"id": "terminal", "title": "Terminal", "summary": "A real PTY in the desktop app. Start it when you need it.", "order": 5, "introduced": "0.1.0", "updated": "0.1.0"}
---

## Start a shell

Trust the workspace, then press Start a terminal or the plus button. With multiple workspaces open, a picker asks which folder to use. Cancel starts nothing. The shell runs in the chosen workspace root, and its tab includes that workspace’s name. Restricted folders require trust before starting. Up to eight tabs are available. The browser preview cannot start a shell.

New Unix shells are interactive, non-login sessions. Your interactive startup files still load (for example, .zshrc or .bashrc), while login-only profiles are not rerun for each tab. Shells inherit the app's environment. Tools configured only in login profiles must be available in that environment or configured in your interactive startup file. Slow interactive plugins can still delay the first prompt.

## Move the terminal

Use the independent RIGHT and BOTTOM toggles in TERM// to show either terminal pane or both. Each pane has its own sessions. HIDE, or the hide button in either pane, hides both without ending sessions. Re-enabling a pane restores its existing xterm instances and backend PTYs. Resizing sends the final dimensions after a short debounce. Hidden terminals continue running.

## Input and security

Terminal focus sends keystrokes to the shell. Cmd/Ctrl+Shift+P opens the command palette as an escape chord. OSC 52 clipboard writes are suppressed. No transcripts or input are stored. Shell environment inheritance occurs only after trust.

## Closing

The terminal header close control ends the active session after confirmation. Closing the app or replacing a workspace also asks before ending its live sessions. Adding or selecting a workspace keeps existing sessions running. The backend kills its owned PTY children. Graceful descendant cleanup across all operating systems requires further validation.
