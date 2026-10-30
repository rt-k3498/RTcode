use crate::{domain::*, process, state::State};
use std::{
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};
use tauri::Manager;
fn cmd(root: &Path) -> Command {
    let mut cmd = process::command("git");
    for key in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_COMMON_DIR",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_NAMESPACE",
    ] {
        cmd.env_remove(key);
    }
    cmd.current_dir(root)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .args([
            "--no-pager",
            "--literal-pathspecs",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.hooksPath=/dev/null",
        ]);
    cmd
}
fn run(root: &Path, args: &[&str]) -> Result<Vec<u8>> {
    let mut cmd = cmd(root);
    cmd.args(args);
    process::bounded(cmd, None, 8 * 1024 * 1024, Duration::from_secs(15))
}
pub fn parse_status(bytes: &[u8]) -> GitState {
    let mut result = GitState {
        branch: "unborn".into(),
        ahead: 0,
        behind: 0,
        local: vec![],
        remote: vec![],
        commits: vec![],
        changes: vec![],
        worktrees: vec![],
    };
    let records: Vec<&[u8]> = bytes.split(|b| *b == 0).collect();
    let mut i = 0;
    let mut oid = String::new();
    while i < records.len() {
        let record = String::from_utf8_lossy(records[i]);
        i += 1;
        if let Some(value) = record.strip_prefix("# branch.oid ") {
            oid = value.trim().into();
            continue;
        }
        if let Some(value) = record.strip_prefix("# branch.head ") {
            result.branch = value.trim().into();
            continue;
        }
        if let Some(value) = record.strip_prefix("# branch.ab ") {
            let counts: Vec<_> = value.split_whitespace().collect();
            result.ahead = counts
                .first()
                .and_then(|x| x.trim_start_matches('+').parse().ok())
                .unwrap_or(0);
            result.behind = counts
                .get(1)
                .and_then(|x| x.trim_start_matches('-').parse().ok())
                .unwrap_or(0);
            continue;
        }
        let kind = record.chars().next().unwrap_or(' ');
        let fields: Vec<&str> = match kind {
            '1' => record.splitn(9, ' ').collect(),
            '2' => record.splitn(10, ' ').collect(),
            'u' => record.splitn(11, ' ').collect(),
            '?' => vec!["?", "??", record.get(2..).unwrap_or("")],
            _ => continue,
        };
        if kind == '2' {
            i += 1;
        }
        let Some(path) = fields.last() else {
            continue;
        };
        let xy = fields.get(1).unwrap_or(&"..").as_bytes();
        if kind == 'u' {
            result.changes.push(Change {
                path_id: None,
                path: (*path).into(),
                status: "!".into(),
                staged: false,
                conflict: true,
            });
            continue;
        }
        for (index, staged) in [(0, true), (1, false)] {
            if let Some(status) = xy.get(index) {
                if *status != b'.' && !(kind == '?' && staged) {
                    result.changes.push(Change {
                        path_id: None,
                        path: (*path).into(),
                        status: (*status as char).to_string(),
                        staged,
                        conflict: false,
                    });
                }
            }
        }
    }
    if oid == "(initial)" {
        result.branch = format!("unborn: {}", result.branch);
    } else if result.branch == "(detached)" {
        result.branch = format!("detached: {}", oid.chars().take(8).collect::<String>());
    }
    result
}
#[tauri::command]
pub async fn git_snapshot(
    state: tauri::State<'_, State>,
    workspace_id: String,
) -> Result<GitState> {
    let root = state.workspace(&workspace_id)?.root;
    let mut snapshot = tauri::async_runtime::spawn_blocking(move || -> Result<GitState> {
        if !root.join(".git").exists() {
            return Ok(GitState {
                branch: "No repository".into(),
                ahead: 0,
                behind: 0,
                local: vec![],
                remote: vec![],
                commits: vec![],
                changes: vec![],
                worktrees: vec![],
            });
        }
        let mut snapshot = parse_status(&run(
            &root,
            &[
                "status",
                "--porcelain=v2",
                "--branch",
                "-z",
                "--untracked-files=all",
            ],
        )?);
        snapshot.worktrees = worktrees(&root)?;
        let refs = run(
            &root,
            &[
                "for-each-ref",
                "--format=%(refname)",
                "refs/heads",
                "refs/remotes",
            ],
        )?;
        for line in String::from_utf8_lossy(&refs).lines() {
            if let Some(local) = line.strip_prefix("refs/heads/") {
                snapshot.local.push(local.into());
            }
            if let Some(remote) = line.strip_prefix("refs/remotes/") {
                snapshot.remote.push(remote.into());
            }
        }
        if let Ok(log) = run(
            &root,
            &["log", "--max-count=10", "--format=%H%x00%s", "-z", "HEAD"],
        ) {
            let fields: Vec<_> = log.split(|b| *b == 0).collect();
            for c in fields.chunks(2) {
                if c.len() == 2 && !c[0].is_empty() {
                    snapshot.commits.push(Commit {
                        hash: String::from_utf8_lossy(c[0]).trim().into(),
                        message: String::from_utf8_lossy(c[1]).into(),
                    });
                }
            }
        }
        Ok(snapshot)
    })
    .await
    .map_err(|_| AppError::new("internal", "Git worker stopped"))??;
    state.workspace(&workspace_id)?;
    for change in &mut snapshot.changes {
        change.path_id = Some(state.path_id(&workspace_id, change.path.clone().into()));
    }
    Ok(snapshot)
}

fn parse_worktrees(bytes: &[u8], root: &Path) -> Result<Vec<GitWorktree>> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| AppError::new("unsupported", "Worktree paths must be valid UTF-8."))?;
    let mut trees = Vec::new();
    let mut tree: Option<GitWorktree> = None;
    for field in text.split('\0') {
        if let Some(path) = field.strip_prefix("worktree ") {
            if let Some(previous) = tree.take() {
                trees.push(previous);
            }
            tree = Some(GitWorktree {
                path: path.into(),
                ..Default::default()
            });
        } else if let Some(tree) = tree.as_mut() {
            if let Some(head) = field.strip_prefix("HEAD ") {
                tree.head = head.into();
            } else if let Some(branch) = field.strip_prefix("branch ") {
                tree.branch = branch.strip_prefix("refs/heads/").unwrap_or(branch).into();
            } else if field == "detached" {
                tree.detached = true;
            } else if field == "bare" {
                tree.bare = true;
            } else if field == "locked" || field.starts_with("locked ") {
                tree.locked = true;
            } else if field == "prunable" || field.starts_with("prunable ") {
                tree.prunable = true;
            }
        }
    }
    if let Some(tree) = tree {
        trees.push(tree);
    }
    for tree in &mut trees {
        let canonical = Path::new(&tree.path).canonicalize().ok();
        tree.available =
            !tree.bare && !tree.prunable && canonical.as_ref().is_some_and(|path| path.is_dir());
        tree.current = canonical.as_deref() == Some(root);
    }
    Ok(trees)
}

fn worktrees(root: &Path) -> Result<Vec<GitWorktree>> {
    parse_worktrees(
        &run(root, &["worktree", "list", "--porcelain", "-z"])?,
        root,
    )
}

fn resolve_worktree(root: &Path, path: &str) -> Result<PathBuf> {
    let tree = worktrees(root)?
        .into_iter()
        .find(|tree| tree.path == path)
        .ok_or_else(|| {
            AppError::new(
                "permission_denied",
                "This worktree is no longer registered with the current repository. Refresh Git.",
            )
        })?;
    if !tree.available {
        return Err(AppError::new(
            "not_found",
            "This worktree is unavailable. Refresh Git or reconnect its drive.",
        ));
    }
    let target = Path::new(&tree.path).canonicalize()?;
    // Verify that an existing directory has not replaced a stale registered tree.
    let common = |directory: &Path| -> Result<PathBuf> {
        let output = run(directory, &["rev-parse", "--git-common-dir"])?;
        let value = std::str::from_utf8(&output)
            .map_err(|_| AppError::new("unsupported", "Git directory is not UTF-8."))?
            .trim_end_matches('\n');
        Ok(directory.join(value).canonicalize()?)
    };
    if common(root)? != common(&target)? {
        return Err(AppError::new(
            "permission_denied",
            "The selected worktree no longer belongs to this repository.",
        ));
    }
    Ok(target)
}

#[tauri::command]
pub async fn git_open_worktree(
    app: tauri::AppHandle,
    workspace_id: String,
    path: String,
) -> Result<Workspace> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<State>();
        open_worktree(&state, &workspace_id, &path)
    })
    .await
    .map_err(|_| AppError::new("internal", "Worktree worker stopped."))?
}
fn open_worktree(state: &State, workspace_id: &str, path: &str) -> Result<Workspace> {
    let root = state.workspace(workspace_id)?.root;
    let target = resolve_worktree(&root, path)?;
    state.workspace(workspace_id)?;
    crate::open_workspace(state, target)
}
#[tauri::command]
pub async fn git_action(
    state: tauri::State<'_, State>,
    workspace_id: String,
    action: String,
    path: String,
) -> Result<()> {
    let ws = state.trusted(&workspace_id)?;
    if path.len() > 8192 || path.contains('\0') {
        return Err(AppError::new("invalid_request", "Invalid path or branch"));
    }
    if action != "switch" {
        crate::files::scoped(&ws.root, Path::new(&path)).or_else(|e| {
            if e.code == "not_found"
                && Path::new(&path)
                    .components()
                    .all(|c| matches!(c, std::path::Component::Normal(_)))
            {
                Ok(ws.root.join(&path))
            } else {
                Err(e)
            }
        })?;
    }
    tauri::async_runtime::spawn_blocking(move || {
        if action == "stage" || action == "unstage" {
            let snapshot = parse_status(&run(
                &ws.root,
                &[
                    "status",
                    "--porcelain=v2",
                    "--branch",
                    "-z",
                    "--untracked-files=all",
                ],
            )?);
            if snapshot
                .changes
                .iter()
                .any(|c| c.path == path && c.conflict)
            {
                return Err(AppError::new(
                    "unsupported",
                    "Resolve this conflict in the terminal before staging.",
                ));
            }
            if action == "unstage" && snapshot.branch.starts_with("unborn:") {
                return Err(AppError::new(
                    "unsupported",
                    "Unstaging before the first commit is a terminal workflow in this build.",
                ));
            }
        }
        if action == "switch" {
            run(
                &ws.root,
                &[
                    "show-ref",
                    "--verify",
                    "--quiet",
                    &format!("refs/heads/{path}"),
                ],
            )?;
        }
        let args = match action.as_str() {
            "stage" => vec!["add", "--", &path],
            "unstage" => vec!["restore", "--staged", "--", &path],
            "switch" => vec!["switch", "--no-guess", "--", &path],
            _ => return Err(AppError::new("invalid_request", "Unsupported Git action")),
        };
        run(&ws.root, &args)?;
        Ok(())
    })
    .await
    .map_err(|_| AppError::new("internal", "Git worker stopped"))?
}
fn diff(root: &Path, path: &str, staged: bool) -> Result<String> {
    if !staged {
        let snapshot = parse_status(&run(
            root,
            &["status", "--porcelain=v2", "-z", "--untracked-files=all"],
        )?);
        if snapshot
            .changes
            .iter()
            .any(|change| change.path == path && change.status == "?")
        {
            crate::files::scoped(root, Path::new(path))?;
            let mut command = cmd(root);
            command.args([
                "diff",
                "--no-index",
                "--no-ext-diff",
                "--no-textconv",
                "--",
                if cfg!(windows) { "NUL" } else { "/dev/null" },
                path,
            ]);
            // For --no-index, exit 1 means differences were successfully found.
            return Ok(
                String::from_utf8_lossy(&process::bounded_with_success_codes(
                    command,
                    None,
                    8 * 1024 * 1024,
                    Duration::from_secs(15),
                    &[0, 1],
                )?)
                .into(),
            );
        }
    }
    let mut args = vec!["diff", "--no-ext-diff", "--no-textconv"];
    if staged {
        args.push("--cached");
    }
    args.extend(["--", path]);
    Ok(String::from_utf8_lossy(&run(root, &args)?).into())
}

#[tauri::command]
pub async fn git_diff(
    state: tauri::State<'_, State>,
    workspace_id: String,
    path: String,
    staged: bool,
) -> Result<String> {
    let ws = state.workspace(&workspace_id)?;
    if Path::new(&path)
        .components()
        .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return Err(AppError::new("permission_denied", "Invalid diff path"));
    }
    tauri::async_runtime::spawn_blocking(move || diff(&ws.root, &path, staged))
        .await
        .map_err(|_| AppError::new("internal", "Git worker stopped"))?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_spaces_renames_and_separate_index() {
        let s=parse_status(b"# branch.head main\0# branch.ab +2 -1\x001 MM N... 100644 100644 100644 abc def a b.txt\x002 R. N... 100644 100644 100644 abc def R100 new name\0old name\0? -option.txt\0");
        assert_eq!(s.branch, "main");
        assert_eq!(s.ahead, 2);
        assert_eq!(s.behind, 1);
        assert_eq!(s.changes.len(), 4);
        assert_eq!(s.changes[0].path, "a b.txt");
        assert!(s.changes[0].staged);
        assert!(!s.changes[1].staged);
        assert_eq!(s.changes[2].path, "new name");
        assert_eq!(s.changes[3].path, "-option.txt");
    }
    #[test]
    fn conflicts_are_blocked() {
        let s = parse_status(b"u UU N... 100644 100644 100644 100644 a b c conflict.txt\0");
        assert!(s.changes[0].conflict);
    }
}
#[cfg(test)]
mod contract_tests {
    use super::*;
    fn worktree_fixture() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("main");
        std::fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        run(&root, &["init", "--initial-branch=main"]).unwrap();
        run(
            &root,
            &[
                "-c",
                "user.name=Worktree Test",
                "-c",
                "user.email=test@example.invalid",
                "commit",
                "--allow-empty",
                "-m",
                "fixture",
            ],
        )
        .unwrap();
        let linked = root.parent().unwrap().join("review tree");
        run(
            &root,
            &["worktree", "add", "-b", "review", linked.to_str().unwrap()],
        )
        .unwrap();
        (dir, root, linked)
    }
    #[test]
    fn lists_real_worktrees_and_switches_scope_without_inheriting_trust() {
        let (_dir, root, linked) = worktree_fixture();
        run(
            &root,
            &[
                "worktree",
                "lock",
                "--reason",
                "keep this tree",
                linked.to_str().unwrap(),
            ],
        )
        .unwrap();
        let trees = worktrees(&root).unwrap();
        assert_eq!(trees.len(), 2);
        assert!(trees
            .iter()
            .any(|tree| tree.current && tree.branch == "main"));
        let tree = trees
            .iter()
            .find(|tree| tree.path == linked.to_str().unwrap())
            .unwrap();
        assert!(tree.locked && tree.available && !tree.current);
        assert_eq!(tree.branch, "review");
        let db = rusqlite::Connection::open_in_memory().unwrap();
        db.execute_batch(include_str!("../migrations/001.sql"))
            .unwrap();
        db.execute(
            "INSERT INTO trust(canonical_path,trusted) VALUES(?1,1)",
            [root.to_str().unwrap()],
        )
        .unwrap();
        let state = State::new(db);
        let original = crate::open_workspace(&state, root.clone()).unwrap();
        assert!(original.trusted);
        std::fs::write(root.join("uncommitted.txt"), "keep this change").unwrap();
        let switched = open_worktree(&state, &original.id, &tree.path).unwrap();
        assert_eq!(switched.root, linked);
        assert!(!switched.trusted);
        assert!(state.workspace(&original.id).is_ok());
        assert_eq!(
            std::fs::read_to_string(root.join("uncommitted.txt")).unwrap(),
            "keep this change"
        );
        assert!(worktrees(&switched.root)
            .unwrap()
            .iter()
            .any(|tree| tree.current && tree.branch == "review"));
    }
    #[test]
    fn rejects_unregistered_and_deleted_worktrees_without_closing_workspace() {
        let (_dir, root, linked) = worktree_fixture();
        assert_eq!(
            resolve_worktree(&root, root.parent().unwrap().to_str().unwrap())
                .unwrap_err()
                .code,
            "permission_denied"
        );
        let db = rusqlite::Connection::open_in_memory().unwrap();
        db.execute_batch(include_str!("../migrations/001.sql"))
            .unwrap();
        let state = State::new(db);
        let original = crate::open_workspace(&state, root.clone()).unwrap();
        std::fs::remove_dir_all(&linked).unwrap();
        assert!(open_worktree(&state, &original.id, linked.to_str().unwrap()).is_err());
        assert_eq!(state.workspace(&original.id).unwrap().root, root);
    }
    #[test]
    fn worktree_porcelain_preserves_newlines_and_detached_bare_and_prunable_flags() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("line\nbreak");
        std::fs::create_dir(&path).unwrap();
        let path = path.canonicalize().unwrap();
        let data = format!("worktree {}\0HEAD abc123\0detached\0locked reason\0\0worktree /missing\0prunable missing\0\0worktree /bare\0bare\0\0", path.display());
        let trees = parse_worktrees(data.as_bytes(), &path).unwrap();
        assert_eq!(trees[0].path, path.to_str().unwrap());
        assert!(trees[0].current && trees[0].detached && trees[0].locked && trees[0].available);
        assert!(trees[1].prunable && !trees[1].available);
        assert!(trees[2].bare && !trees[2].available);
    }
    #[test]
    fn distinguishes_unborn_and_detached() {
        assert_eq!(
            parse_status(b"# branch.oid (initial)\0# branch.head main\0").branch,
            "unborn: main"
        );
        assert_eq!(
            parse_status(b"# branch.oid abcdef123456\0# branch.head (detached)\0").branch,
            "detached: abcdef12"
        );
    }
    #[test]
    fn staging_treats_glob_metacharacters_literally() {
        let dir = tempfile::tempdir().unwrap();
        run(dir.path(), &["init", "--initial-branch=main"]).unwrap();
        std::fs::write(dir.path().join("[ab].txt"), "literal").unwrap();
        std::fs::write(dir.path().join("a.txt"), "unrelated").unwrap();
        run(dir.path(), &["add", "--", "[ab].txt"]).unwrap();
        let snapshot = parse_status(&run(dir.path(), &["status", "--porcelain=v2", "-z"]).unwrap());
        let staged: Vec<_> = snapshot.changes.iter().filter(|c| c.staged).collect();
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0].path, "[ab].txt");
    }
    #[test]
    fn diffs_untracked_and_staged_files_in_unborn_repo() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        run(&root, &["init", "--initial-branch=main"]).unwrap();
        std::fs::write(root.join("new file.txt"), "new content\n").unwrap();
        assert!(diff(&root, "new file.txt", false)
            .unwrap()
            .contains("+new content"));
        run(&root, &["add", "--", "new file.txt"]).unwrap();
        assert!(diff(&root, "new file.txt", true)
            .unwrap()
            .contains("+new content"));
        assert!(diff(&root, "new file.txt", false).unwrap().is_empty());
    }

    #[test]
    fn actual_git_handles_option_like_paths() {
        let dir = tempfile::tempdir().unwrap();
        run(dir.path(), &["init", "--initial-branch=main"]).unwrap();
        std::fs::write(dir.path().join("-odd file.ts"), "first\n").unwrap();
        run(dir.path(), &["add", "--", "-odd file.ts"]).unwrap();
        let s = parse_status(
            &run(dir.path(), &["status", "--porcelain=v2", "--branch", "-z"]).unwrap(),
        );
        assert!(s.branch.starts_with("unborn:"));
        assert_eq!(s.changes[0].path, "-odd file.ts");
        assert!(s.changes[0].staged);
    }
}
