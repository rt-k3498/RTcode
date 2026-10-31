use crate::{domain::*, files::scoped, state::State};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// One workspace path the language service asked about. A source or config
/// file carries its text; a directory carries the names of its subdirectories.
/// Paths that do not exist, are not source files, or resolve outside the
/// workspace are left out of the answer.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEntry {
    path: String,
    /// Real location when `path` is reached through a symlink.
    canonical_path: Option<String>,
    path_id: Option<String>,
    content: Option<String>,
    directories: Option<Vec<String>>,
}

fn relevant(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|s| s.to_str()),
        Some("ts" | "tsx" | "mts" | "cts" | "js" | "jsx" | "mjs" | "cjs" | "json")
    )
}
fn slashes(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}
fn read_entry(state: &State, workspace_id: &str, root: &Path, path: &str) -> Option<ProjectEntry> {
    let relative = PathBuf::from(path);
    let real = scoped(root, &relative).ok()?;
    let canonical = real.strip_prefix(root).ok()?;
    let mut entry = ProjectEntry {
        path: path.to_string(),
        canonical_path: (canonical != relative).then(|| slashes(canonical)),
        path_id: None,
        content: None,
        directories: None,
    };
    if real.is_dir() {
        let mut names: Vec<String> = std::fs::read_dir(&real)
            .ok()?
            .filter_map(|item| item.ok())
            .filter(|item| item.path().is_dir())
            .map(|item| item.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        entry.directories = Some(names);
    } else if relevant(&real) {
        let text = std::fs::read_to_string(&real).ok()?;
        entry.content = Some(text.trim_start_matches('\u{feff}').to_string());
        entry.path_id = Some(state.path_id(workspace_id, relative));
    } else {
        return None;
    }
    Some(entry)
}
fn read(state: &State, workspace_id: &str, paths: &[String]) -> Result<Vec<ProjectEntry>> {
    let root = state.workspace(workspace_id)?.root;
    Ok(paths
        .iter()
        .filter_map(|path| read_entry(state, workspace_id, &root, path))
        .collect())
}
/// Reads only the paths requested. The editor asks for files as the language
/// service needs them, so no snapshot of the workspace is ever taken.
#[tauri::command]
pub async fn project_read(
    app: tauri::AppHandle,
    workspace_id: String,
    paths: Vec<String>,
) -> Result<Vec<ProjectEntry>> {
    tauri::async_runtime::spawn_blocking(move || read(&app.state::<State>(), &workspace_id, &paths))
        .await
        .map_err(|_| AppError::new("internal", "Project read stopped."))?
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(root: &Path) -> State {
        let state = State::new(rusqlite::Connection::open_in_memory().unwrap());
        state.workspaces.lock().unwrap().insert(
            "ws".into(),
            Workspace {
                id: "ws".into(),
                root: root.to_path_buf(),
                name: "test".into(),
                display_path: root.to_string_lossy().into(),
                trusted: false,
                root_id: "root".into(),
            },
        );
        state
    }
    fn ask(state: &State, paths: &[&str]) -> Vec<ProjectEntry> {
        let paths: Vec<String> = paths.iter().map(|p| p.to_string()).collect();
        read(state, "ws", &paths).unwrap()
    }
    #[test]
    fn reads_only_the_requested_paths() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        for name in ["src/main.ts", "src/other.ts", "node_modules/pkg/index.d.ts"] {
            let path = root.join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "\u{feff}export {};").unwrap();
        }
        std::fs::write(root.join("src/notes.txt"), "text").unwrap();
        let state = fixture(&root);
        let found = ask(
            &state,
            &["src/main.ts", "src/missing.ts", "src/notes.txt", "src"],
        );
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].path, "src/main.ts");
        assert_eq!(found[0].content.as_deref(), Some("export {};"));
        assert!(found[0].path_id.is_some());
        assert_eq!(found[1].directories, Some(vec![]));
        // Nothing else was registered or read.
        assert_eq!(state.paths.lock().unwrap().len(), 1);
    }
    #[test]
    fn lists_subdirectories_and_includes_ignored_dependency_folders() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::create_dir_all(root.join("node_modules/@types/node")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::write(root.join("node_modules/readme.json"), "{}").unwrap();
        std::fs::write(root.join(".gitignore"), "node_modules\n").unwrap();
        let state = fixture(&root);
        let found = ask(&state, &["node_modules", "node_modules/@types"]);
        assert_eq!(
            found[0].directories,
            Some(vec!["@types".to_string(), "pkg".to_string()])
        );
        assert_eq!(found[1].directories, Some(vec!["node".to_string()]));
    }
    #[test]
    fn rejects_escapes_and_reads_nothing_unreadable() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::write(root.join("binary.ts"), [0xff, 0xfe, 0x00]).unwrap();
        let state = fixture(&root);
        assert!(ask(&state, &["../outside.ts", "/etc/hosts", "binary.ts"]).is_empty());
    }
    #[cfg(unix)]
    #[test]
    fn follows_symlinks_inside_the_workspace_but_not_outside() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::create_dir_all(root.join(".store/pkg")).unwrap();
        std::fs::write(root.join(".store/pkg/index.d.ts"), "export {};").unwrap();
        std::os::unix::fs::symlink(root.join(".store/pkg"), root.join("pkg")).unwrap();
        std::fs::write(outside.path().join("secret.ts"), "secret").unwrap();
        std::os::unix::fs::symlink(outside.path(), root.join("linked")).unwrap();
        let state = fixture(&root);
        let found = ask(&state, &["pkg/index.d.ts", "linked/secret.ts"]);
        assert_eq!(found.len(), 1);
        assert_eq!(
            found[0].canonical_path.as_deref(),
            Some(".store/pkg/index.d.ts")
        );
    }
}
