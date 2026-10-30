mod domain;
mod files;
mod git;
mod process;
mod project;
mod search;
mod state;
mod terminal;
use domain::*;
use state::State;
use std::{collections::HashMap, time::Duration};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
#[tauri::command]
async fn workspace_pick_and_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, State>,
) -> Result<Option<Workspace>> {
    let picked =
        tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
            .await
            .map_err(|_| AppError::new("internal", "Folder picker failed."))?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let root = picked
        .into_path()
        .map_err(|_| AppError::new("invalid_request", "Choose a local folder."))?;
    open_workspace(&state, root).map(Some)
}

#[tauri::command]
fn workspace_open_launch_directory(state: tauri::State<State>) -> Result<Option<Workspace>> {
    open_launch_directory(&state)
}

fn open_launch_directory(state: &State) -> Result<Option<Workspace>> {
    let directory = state.launch_directory.lock().unwrap().take();
    directory
        .map(|root| open_workspace(state, root?))
        .transpose()
}

fn open_workspace(state: &State, root: std::path::PathBuf) -> Result<Workspace> {
    let root = root.canonicalize()?;
    if !root.is_dir() {
        return Err(AppError::new(
            "invalid_request",
            "Workspace must be a directory.",
        ));
    }
    // Keep existing roots and their documents, searches, and PTYs alive.
    let mut workspaces = state.workspaces.lock().unwrap();
    if let Some(existing) = workspaces.values().find(|ws| ws.root == root) {
        return Ok(existing.clone());
    }
    let display = root.to_string_lossy().to_string();
    let trusted = state
        .db
        .lock()
        .unwrap()
        .query_row(
            "SELECT trusted FROM trust WHERE canonical_path=?1",
            [&display],
            |row| row.get::<_, bool>(0),
        )
        .unwrap_or(false);
    let workspace_id = id();
    let root_id = state.path_id(&workspace_id, std::path::PathBuf::new());
    let ws = Workspace {
        id: workspace_id,
        name: root
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into(),
        display_path: display,
        trusted,
        root_id,
        root,
    };
    workspaces.insert(ws.id.clone(), ws.clone());
    Ok(ws)
}
#[tauri::command]
fn workspace_close(state: tauri::State<State>, workspace_id: String) -> Result<()> {
    close_workspace(&state, &workspace_id);
    Ok(())
}

fn close_workspace(state: &State, workspace_id: &str) {
    // Revoke admission before draining this root's processes.
    state.workspaces.lock().unwrap().remove(workspace_id);
    let closing = {
        let mut terminals = state.terminals.lock().unwrap();
        let ids: Vec<String> = terminals
            .iter()
            .filter(|(_, session)| session.workspace == workspace_id)
            .map(|(id, _)| id.clone())
            .collect();
        ids.into_iter()
            .filter_map(|id| terminals.remove(&id))
            .collect::<Vec<_>>()
    };
    for session in closing {
        let _ = session.child.lock().unwrap().kill();
        let _ = session.child.lock().unwrap().wait();
    }
    state
        .documents
        .lock()
        .unwrap()
        .retain(|_, doc| doc.workspace != workspace_id);
    state
        .paths
        .lock()
        .unwrap()
        .retain(|_, path| path.workspace != workspace_id);
}
#[tauri::command]
fn workspace_set_trust(
    state: tauri::State<State>,
    workspace_id: String,
    trusted: bool,
) -> Result<()> {
    let ws = state.workspace(&workspace_id)?;
    state.db.lock().unwrap().execute("INSERT INTO trust(canonical_path,trusted) VALUES(?1,?2) ON CONFLICT(canonical_path) DO UPDATE SET trusted=excluded.trusted",rusqlite::params![ws.display_path,trusted])?;
    state
        .workspaces
        .lock()
        .unwrap()
        .get_mut(&workspace_id)
        .ok_or_else(|| AppError::new("not_found", "Workspace is closed."))?
        .trusted = trusted;
    if !trusted {
        let ids: Vec<String> = state
            .terminals
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, s)| s.workspace == workspace_id)
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            terminal::terminal_close(state.clone(), id)?;
        }
    }
    Ok(())
}
#[tauri::command]
fn settings_get(state: tauri::State<State>) -> Result<HashMap<String, serde_json::Value>> {
    let db = state.db.lock().unwrap();
    let mut statement = db.prepare("SELECT key,value_json FROM settings")?;
    let records = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut values = HashMap::new();
    for record in records {
        let (key, value) = record?;
        if let Ok(value) = serde_json::from_str(&value) {
            values.insert(key, value);
        }
    }
    Ok(values)
}
#[tauri::command]
fn settings_update(
    state: tauri::State<State>,
    key: String,
    value: serde_json::Value,
) -> Result<()> {
    if !["preferences", "layout"].contains(&key.as_str())
        || value.to_string().len() > 16384
        || !value.is_object()
    {
        return Err(AppError::new(
            "invalid_request",
            "Unknown or oversized setting.",
        ));
    }
    state.db.lock().unwrap().execute("INSERT INTO settings(key,value_json) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",rusqlite::params![key,value.to_string()])?;
    Ok(())
}
#[tauri::command]
async fn format_run(
    state: tauri::State<'_, State>,
    document_id: String,
    text: String,
    command: String,
    args: Vec<String>,
) -> Result<String> {
    let doc = state
        .documents
        .lock()
        .unwrap()
        .get(&document_id)
        .cloned()
        .ok_or_else(|| AppError::new("not_found", "Document closed."))?;
    let ws = state.trusted(&doc.workspace)?;
    if text.len() > files::MAX_FILE as usize
        || command.is_empty()
        || command.len() > 4096
        || args.len() > 64
        || args.iter().any(|x| x.len() > 8192)
    {
        return Err(AppError::new(
            "invalid_request",
            "Invalid formatter request.",
        ));
    }
    let path = files::scoped(&ws.root, doc.path.strip_prefix(&ws.root).unwrap())?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = process::command(&command);
        cmd.current_dir(&ws.root).args(
            args.iter()
                .map(|arg| arg.replace("{file}", &path.to_string_lossy())),
        );
        let output = process::bounded(
            cmd,
            Some(text.into_bytes()),
            files::MAX_FILE as usize,
            Duration::from_secs(10),
        )?;
        String::from_utf8(output)
            .map_err(|_| AppError::new("tool_failed", "Formatter output is not UTF-8."))
    })
    .await
    .map_err(|_| AppError::new("internal", "Formatter worker stopped"))?
}
pub fn run() {
    // Capture before Tauri initializes; development tooling can change its cwd.
    let launch_directory = std::env::current_dir().map_err(AppError::from);
    #[cfg(target_os = "macos")]
    let launch_directory = macos_launch_directory(
        launch_directory,
        std::env::var_os("PWD").map(std::path::PathBuf::from),
        std::env::var_os("HOME").map(std::path::PathBuf::from),
        std::env::current_exe().is_ok_and(|path| {
            path.parent()
                .and_then(|path| path.parent())
                .is_some_and(|path| path.ends_with("Contents"))
        }),
    );
    #[cfg(debug_assertions)]
    let launch_directory = std::env::var_os("RTCODE_DEV_LAUNCH_DIR")
        .map(|path| Ok(std::path::PathBuf::from(path)))
        .unwrap_or(launch_directory);
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
            }
            let db = rusqlite::Connection::open(dir.join("metadata.sqlite"))?;
            db.execute_batch(include_str!("../migrations/001.sql"))?;
            let state = State::new(db);
            *state.launch_directory.lock().unwrap() = Some(launch_directory);
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            workspace_pick_and_open,
            workspace_open_launch_directory,
            workspace_set_trust,
            workspace_close,
            settings_get,
            settings_update,
            format_run,
            files::tree_read_children,
            files::file_open,
            files::file_save,
            files::file_create,
            files::file_rename,
            files::file_move_to_trash,
            git::git_snapshot,
            git::git_open_worktree,
            git::git_action,
            git::git_diff,
            search::search_start,
            search::search_cancel,
            search::search_replace,
            project::project_snapshot,
            terminal::terminal_create,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_close,
            terminal::ssh_profiles
        ])
        .build(tauri::generate_context!())
        .expect("failed to initialize RTcode");
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            app.state::<State>().shutdown();
        }
    });
}

#[cfg(any(target_os = "macos", test))]
fn macos_launch_directory(
    cwd: Result<std::path::PathBuf>,
    pwd: Option<std::path::PathBuf>,
    home: Option<std::path::PathBuf>,
    bundled: bool,
) -> Result<std::path::PathBuf> {
    // LaunchServices can reset a bundle's cwd to / or HOME, but `open -a`
    // passes the invoking shell's PWD. Keep real working directories for
    // direct executable launches, and ignore missing/stale shell paths.
    if bundled
        && cwd
            .as_ref()
            .is_ok_and(|path| path == std::path::Path::new("/") || Some(path) == home.as_ref())
    {
        if let Some(path) = pwd.filter(|path| path.is_absolute() && path.is_dir()) {
            return Ok(path);
        }
    }
    cwd
}

#[cfg(test)]
mod workspace_tests {
    use super::*;

    #[test]
    fn macos_open_uses_shell_directory_when_launch_services_resets_cwd() {
        let project = tempfile::tempdir().unwrap();
        let home = tempfile::tempdir().unwrap();
        for cwd in [std::path::PathBuf::from("/"), home.path().to_path_buf()] {
            let selected = macos_launch_directory(
                Ok(cwd),
                Some(project.path().into()),
                Some(home.path().into()),
                true,
            )
            .unwrap();
            let state = state_with_launch_directory(selected);
            assert_eq!(
                open_launch_directory(&state).unwrap().unwrap().root,
                project.path().canonicalize().unwrap()
            );
        }
    }

    #[test]
    fn macos_launch_preserves_direct_cwd_and_ignores_invalid_pwd() {
        let project = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        for bundled in [true, false] {
            assert_eq!(
                macos_launch_directory(
                    Ok(project.path().into()),
                    Some(other.path().into()),
                    None,
                    bundled
                )
                .unwrap(),
                project.path()
            );
        }
        for pwd in [
            None,
            Some("relative".into()),
            Some(project.path().join("missing")),
        ] {
            assert_eq!(
                macos_launch_directory(Ok("/".into()), pwd, None, true).unwrap(),
                std::path::Path::new("/")
            );
        }
    }

    fn state_with_launch_directory(root: std::path::PathBuf) -> State {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        db.execute_batch(include_str!("../migrations/001.sql"))
            .unwrap();
        let state = State::new(db);
        *state.launch_directory.lock().unwrap() = Some(Ok(root));
        state
    }

    #[test]
    fn launch_opens_canonical_directory_with_scoped_root_and_restricted_trust() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("project with spaces");
        std::fs::create_dir(&root).unwrap();
        let state = state_with_launch_directory(root.join("."));
        let ws = open_launch_directory(&state).unwrap().unwrap();
        assert_eq!(ws.root, root.canonicalize().unwrap());
        assert_eq!(ws.name, "project with spaces");
        assert!(!ws.trusted);
        assert_eq!(
            files::resolve(&state, &ws.id, &ws.root_id).unwrap(),
            ws.root
        );
        assert_eq!(
            state.trusted(&ws.id).unwrap_err().code,
            "workspace_untrusted"
        );
        // Repeating the startup request must not replace an active workspace.
        assert!(open_launch_directory(&state).unwrap().is_none());
        assert_eq!(state.workspace(&ws.id).unwrap().root, ws.root);
    }

    #[test]
    fn launch_respects_only_exact_root_trust() {
        let dir = tempfile::tempdir().unwrap();
        let child = dir.path().join("child");
        std::fs::create_dir(&child).unwrap();
        let root = dir.path().canonicalize().unwrap();
        let state = state_with_launch_directory(root.clone());
        state
            .db
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO trust(canonical_path,trusted) VALUES(?1,1)",
                [root.to_string_lossy().as_ref()],
            )
            .unwrap();
        assert!(open_launch_directory(&state).unwrap().unwrap().trusted);
        assert!(!open_workspace(&state, child).unwrap().trusted);
    }

    #[test]
    fn opening_multiple_roots_preserves_documents_and_deduplicates_canonical_paths() {
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        std::fs::write(first.path().join("same.txt"), "first").unwrap();
        std::fs::write(second.path().join("same.txt"), "second").unwrap();
        let state = state_with_launch_directory(first.path().into());
        let a = open_launch_directory(&state).unwrap().unwrap();
        let a_path = state.path_id(&a.id, "same.txt".into());
        let doc = files::open_document(&state, a.id.clone(), a_path.clone()).unwrap();
        let b = open_workspace(&state, second.path().into()).unwrap();
        assert_eq!(state.workspaces.lock().unwrap().len(), 2);
        assert!(state.documents.lock().unwrap().contains_key(&doc.id));
        assert_eq!(
            files::resolve(&state, &a.id, &a_path).unwrap(),
            a.root.join("same.txt")
        );
        assert!(files::resolve(&state, &b.id, &a_path).is_err());
        assert_eq!(
            open_workspace(&state, first.path().join(".")).unwrap().id,
            a.id
        );
        assert_eq!(state.workspaces.lock().unwrap().len(), 2);
        let b_path = state.path_id(&b.id, "same.txt".into());
        let other_doc = files::open_document(&state, b.id.clone(), b_path.clone()).unwrap();
        close_workspace(&state, &a.id);
        assert!(state.workspace(&a.id).is_err());
        assert!(!state.documents.lock().unwrap().contains_key(&doc.id));
        assert!(state.documents.lock().unwrap().contains_key(&other_doc.id));
        assert!(files::resolve(&state, &b.id, &b_path).is_ok());
    }

    #[test]
    fn invalid_launch_directory_allows_manual_recovery() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("file.txt");
        std::fs::write(&file, "text").unwrap();
        let state = state_with_launch_directory(file);
        assert_eq!(
            open_launch_directory(&state).unwrap_err().code,
            "invalid_request"
        );
        assert!(state.workspaces.lock().unwrap().is_empty());
        assert!(open_launch_directory(&state).unwrap().is_none());
        assert!(open_workspace(&state, dir.path().to_path_buf()).is_ok());
    }
}
