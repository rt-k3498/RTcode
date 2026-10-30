use crate::{domain::*, files, state::State};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::Path,
    time::{Duration, Instant},
};
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    path: String,
    canonical_path: String,
    path_id: String,
    content: String,
}
#[derive(Serialize)]
pub struct ProjectSnapshot {
    files: Vec<ProjectFile>,
    warnings: Vec<String>,
}
fn relevant(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|s| s.to_str()),
        Some("ts" | "tsx" | "mts" | "cts" | "js" | "jsx" | "mjs" | "cjs" | "json")
    )
}
fn snapshot(state: &State, workspace_id: &str) -> Result<ProjectSnapshot> {
    let ws = state.workspace(workspace_id)?;
    let mut result = ProjectSnapshot {
        files: Vec::new(),
        warnings: Vec::new(),
    };
    let mut bytes = 0;
    let mut unreadable = 0;
    let start = Instant::now();
    // Source/configs first, then installed dependency types. Git ignores must not
    // hide generated configs or node_modules from the language service.
    for phase in 0..3 {
        let dependencies = phase != 0;
        let root = ws.root.clone();
        let walker = ignore::WalkBuilder::new(&ws.root)
            .standard_filters(false)
            .follow_links(true)
            .max_depth(Some(64))
            .filter_entry(move |entry| {
                let name = entry.file_name().to_string_lossy();
                if entry.depth() > 0
                    && matches!(
                        name.as_ref(),
                        ".git" | "target" | "dist" | "build" | ".next" | ".cache"
                    )
                {
                    return false;
                }
                if !dependencies && name == "node_modules" {
                    return false;
                }
                entry
                    .path()
                    .canonicalize()
                    .is_ok_and(|path| path.starts_with(&root))
            })
            .build();
        let mut content_cache = HashMap::new();
        for entry in walker {
            if result.files.len() >= 20000
                || bytes >= 64 * 1024 * 1024
                || start.elapsed() > Duration::from_secs(15)
            {
                result.warnings.push("Project indexing reached its size or time limit; some imports may remain unresolved. Open a smaller workspace for complete results.".into());
                return Ok(result);
            }
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => {
                    unreadable += 1;
                    continue;
                }
            };
            if !entry.file_type().is_some_and(|kind| kind.is_file()) || !relevant(entry.path()) {
                continue;
            }
            let relative = entry.path().strip_prefix(&ws.root).unwrap();
            let in_dependencies = relative
                .components()
                .any(|part| part.as_os_str() == "node_modules");
            if in_dependencies != dependencies {
                continue;
            }
            let path = match files::scoped(&ws.root, relative) {
                Ok(path) => path,
                Err(_) => {
                    unreadable += 1;
                    continue;
                }
            };
            // Load dependency declarations/configs before JavaScript implementations.
            let javascript = matches!(
                path.extension().and_then(|s| s.to_str()),
                Some("js" | "jsx" | "mjs" | "cjs")
            );
            if dependencies && javascript != (phase == 2) {
                continue;
            }
            let canonical_path = path
                .strip_prefix(&ws.root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            let content = if let Some(content) = content_cache.get(&path) {
                String::clone(content)
            } else {
                if !std::fs::metadata(&path).is_ok_and(|m| m.len() <= 2 * 1024 * 1024) {
                    unreadable += 1;
                    continue;
                }
                let content = match std::fs::read_to_string(&path) {
                    Ok(text) => text.trim_start_matches('\u{feff}').to_string(),
                    Err(_) => {
                        unreadable += 1;
                        continue;
                    }
                };
                content_cache.insert(path, content.clone());
                content
            };
            if bytes + content.len() > 64 * 1024 * 1024 {
                result.warnings.push("Project indexing reached 64 MiB; some imports may remain unresolved. Open a smaller workspace for complete results.".into());
                return Ok(result);
            }
            bytes += content.len();
            result.files.push(ProjectFile {
                path: relative.to_string_lossy().replace('\\', "/"),
                canonical_path,
                path_id: state.path_id(workspace_id, relative.to_path_buf()),
                content,
            });
        }
    }
    if unreadable > 0 {
        result.warnings.push(format!("{unreadable} project files could not be indexed (unreadable, oversized, or invalid UTF-8)."));
    }
    Ok(result)
}
#[tauri::command]
pub async fn project_snapshot(
    app: tauri::AppHandle,
    workspace_id: String,
) -> Result<ProjectSnapshot> {
    tauri::async_runtime::spawn_blocking(move || snapshot(&app.state::<State>(), &workspace_id))
        .await
        .map_err(|_| AppError::new("internal", "Project indexing stopped."))?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn includes_ignored_configs_and_dependency_types_without_build_outputs() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        for name in [
            "src/main.ts",
            ".svelte-kit/tsconfig.json",
            "node_modules/pkg/index.d.ts",
            "node_modules/pkg/package.json",
            "dist/bundle.js",
        ] {
            let path = root.join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "{}").unwrap();
        }
        std::fs::write(root.join(".gitignore"), "node_modules\n.svelte-kit\n").unwrap();
        let state = State::new(rusqlite::Connection::open_in_memory().unwrap());
        state.workspaces.lock().unwrap().insert(
            "ws".into(),
            Workspace {
                id: "ws".into(),
                root: root.clone(),
                name: "test".into(),
                display_path: root.to_string_lossy().into(),
                trusted: false,
                root_id: "root".into(),
            },
        );
        let result = snapshot(&state, "ws").unwrap();
        assert_eq!(result.files.len(), 4);
        assert!(result
            .files
            .iter()
            .any(|file| file.path == ".svelte-kit/tsconfig.json"));
        assert!(result
            .files
            .iter()
            .any(|file| file.path == "node_modules/pkg/index.d.ts"));
        assert!(result.warnings.is_empty());
    }
    #[cfg(unix)]
    #[test]
    fn does_not_read_symlinks_outside_the_workspace() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.ts"), "secret").unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("linked")).unwrap();
        let state = State::new(rusqlite::Connection::open_in_memory().unwrap());
        let root = dir.path().canonicalize().unwrap();
        state.workspaces.lock().unwrap().insert(
            "ws".into(),
            Workspace {
                id: "ws".into(),
                root: root.clone(),
                name: "test".into(),
                display_path: root.to_string_lossy().into(),
                trusted: false,
                root_id: "root".into(),
            },
        );
        assert!(snapshot(&state, "ws").unwrap().files.is_empty());
    }
}
