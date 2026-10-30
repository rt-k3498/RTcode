{"id": "git", "title": "Minimal Git", "summary": "Inspect the repository. Stage deliberately. Keep advanced workflows in the terminal.", "order": 4, "introduced": "0.1.0", "updated": "0.1.0"}
---

## Repository state

The Git tab shows the current branch, worktrees, local and remote refs separately, the ten most recent commits, and staged and unstaged changes. Worktrees are expanded by default; other sections start collapsed. Select a section header to expand or collapse it. Refresh re-reads the repository. The sample preview does not fabricate repository data.

## Switch worktrees

Worktrees show their branch (or detached commit), full path, and current, locked, or unavailable state. Select an available worktree to make it the workspace. A locked worktree can still be opened; missing, prunable, and bare entries cannot. RTcode verifies that the destination still belongs to the repository before switching.

Unsaved editor changes prompt Save all & switch, Don’t save & switch, or Cancel. Cancel is focused by default. Save all includes inactive tabs; failed or conflicting saves keep the current workspace open. Discarding applies only after the destination opens successfully. Saved but uncommitted changes stay in their original worktree. Active terminal sessions close during a confirmed switch. The destination uses its own saved trust decision. Worktree creation, removal, and pruning remain terminal workflows.

## Changes and diffs

Select a changed or staged filename to open the editable working file. Select the eye button beside it to open the corresponding read-only patch. Deleted files can still be inspected with the eye button. Plus stages a file; minus unstages it. Both require trust. Conflicted paths have mutations disabled. No automatic stash, fetch, or discard runs.

## Branch switching

Select a local branch and review the action. Git refuses switches that would overwrite changes. Remote tracking-branch creation remains a terminal workflow in this build. There is no commit, push, pull, merge, rebase, or stash UI.

## Unusual repositories

Detached and unborn states have explicit labels. Repositories and linked worktrees rooted at the selected folder are discovered. Parent repositories, advanced submodule UI, and cross-platform worktree certification remain pending.
