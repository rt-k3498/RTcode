{"id": "ssh", "title": "SSH connections", "summary": "Use the system OpenSSH client and its familiar authentication prompts.", "order": 6, "introduced": "0.1.0", "updated": "0.1.0"}
---

## Connect

Open SSH in the bottom strip, enter a config alias or user@host, and select Connect. A trusted workspace is required. The backend launches ssh directly in a PTY, with an argument vector.

## Authentication

Keys, agents, passwords, ProxyJump, and host-key prompts are handled by OpenSSH. Unknown host keys require your normal decision; changed keys are not accepted automatically. No secrets or transcripts are stored.

## Connection state

The UI reports that an SSH process is running. It does not infer authenticated connection success from terminal text. Exit ends the session. Favorites, Include-file discovery, disconnect escalation, and editing SSH config through an external document handle remain pending.

## Remote scope

An SSH terminal is not a remote workspace. Files, search, Git, and formatting still operate locally. Remote workspace development is a separate future architecture.
