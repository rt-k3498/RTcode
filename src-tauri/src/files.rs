use crate::{domain::*, state::State};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
};
pub const MAX_FILE: u64 = 10 * 1024 * 1024;
pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn scoped(root: &Path, relative: &Path) -> Result<PathBuf> {
    if relative
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(AppError::new(
            "permission_denied",
            "Invalid workspace-relative path.",
        ));
    }
    let joined = root.join(relative);
    let resolved = joined.canonicalize()?;
    if !resolved.starts_with(root) {
        return Err(AppError::new(
            "permission_denied",
            "Path resolves outside the workspace.",
        ));
    }
    Ok(resolved)
}
pub fn resolve(state: &State, workspace: &str, path_id: &str) -> Result<PathBuf> {
    let ws = state.workspace(workspace)?;
    let handle = state
        .paths
        .lock()
        .unwrap()
        .get(path_id)
        .cloned()
        .ok_or_else(|| AppError::new("not_found", "Unknown path handle."))?;
    if handle.workspace != workspace {
        return Err(AppError::new(
            "permission_denied",
            "Path belongs to another workspace.",
        ));
    }
    scoped(&ws.root, &handle.relative)
}
// Mutations act on the directory entry itself, never a symlink's target.
fn mutation_path(state: &State, workspace: &str, path_id: &str) -> Result<PathBuf> {
    let ws = state.workspace(workspace)?;
    let handle = state
        .paths
        .lock()
        .unwrap()
        .get(path_id)
        .cloned()
        .ok_or_else(|| AppError::new("not_found", "Unknown path handle."))?;
    if handle.workspace != workspace
        || handle.relative.as_os_str().is_empty()
        || handle
            .relative
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(AppError::new("permission_denied", "Invalid mutation path."));
    }
    let parent = scoped(&ws.root, handle.relative.parent().unwrap())?;
    let path = parent.join(handle.relative.file_name().unwrap());
    fs::symlink_metadata(&path)?;
    Ok(path)
}
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 255
        && name != "."
        && name != ".."
        && !name
            .chars()
            .any(|c| c == '/' || c == '\\' || c.is_control() || "<>:\"|?*".contains(c))
        && !name.ends_with(['.', ' '])
        && !matches!(
            name.split('.')
                .next()
                .unwrap_or("")
                .to_ascii_uppercase()
                .as_str(),
            "CON"
                | "PRN"
                | "AUX"
                | "NUL"
                | "COM1"
                | "COM2"
                | "COM3"
                | "COM4"
                | "COM5"
                | "COM6"
                | "COM7"
                | "COM8"
                | "COM9"
                | "LPT1"
                | "LPT2"
                | "LPT3"
                | "LPT4"
                | "LPT5"
                | "LPT6"
                | "LPT7"
                | "LPT8"
                | "LPT9"
        )
}
pub fn language(path: &Path) -> String {
    match path.extension().and_then(|x| x.to_str()).unwrap_or("") {
        "ts" | "tsx" | "mts" | "cts" => "typescript",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "rs" => "rust",
        "json" => "json",
        "md" => "markdown",
        "css" => "css",
        "scss" => "scss",
        "less" => "less",
        "html" | "htm" => "html",
        "py" => "python",
        "toml" => "ini",
        "yaml" | "yml" => "yaml",
        "sh" => "shell",
        _ => "plaintext",
    }
    .into()
}
pub fn entry(state: &State, ws: &Workspace, path: &Path) -> Result<Entry> {
    let relative = path
        .strip_prefix(&ws.root)
        .map_err(|_| AppError::new("permission_denied", "Outside workspace"))?;
    let meta = fs::symlink_metadata(path)?;
    Ok(Entry {
        id: state.path_id(&ws.id, relative.into()),
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into(),
        relative_path: relative.to_string_lossy().replace('\\', "/"),
        directory: meta.is_dir(),
        symlink: meta.file_type().is_symlink(),
    })
}
#[tauri::command]
pub fn tree_read_children(
    state: tauri::State<State>,
    workspace_id: String,
    path_id: String,
) -> Result<Vec<Entry>> {
    read_children(&state, &workspace_id, &path_id)
}

pub fn read_children(state: &State, workspace_id: &str, path_id: &str) -> Result<Vec<Entry>> {
    let ws = state.workspace(workspace_id)?;
    let dir = resolve(state, workspace_id, path_id)?;
    let mut entries = Vec::new();
    // The explorer lists every directory entry, including dotfiles and paths
    // ignored by Git such as node_modules. Every entry is returned; the
    // explorer applies no entry-count cap.
    for value in ignore::WalkBuilder::new(&dir)
        .max_depth(Some(1))
        .standard_filters(false)
        .follow_links(false)
        .build()
        .skip(1)
    {
        let value = value.map_err(|e| AppError::new("internal", e.to_string()))?;
        entries.push(entry(state, &ws, value.path())?);
    }
    entries.sort_by(|a, b| {
        b.directory
            .cmp(&a.directory)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}
#[tauri::command]
pub fn file_open(
    state: tauri::State<State>,
    workspace_id: String,
    path_id: String,
) -> Result<Document> {
    open_document(&state, workspace_id, path_id)
}

pub fn open_document(state: &State, workspace_id: String, path_id: String) -> Result<Document> {
    let ws = state.workspace(&workspace_id)?;
    let path = resolve(state, &workspace_id, &path_id)?;
    if !path.is_file() {
        return Err(AppError::new(
            "unsupported",
            "Only regular text files can be opened.",
        ));
    }
    if fs::metadata(&path)?.len() > MAX_FILE {
        return Err(AppError::new(
            "unsupported",
            "File exceeds the 10 MiB editing limit.",
        ));
    }
    let bytes = fs::read(&path)?;
    if bytes.contains(&0) {
        return Err(AppError::new(
            "unsupported",
            "Binary or UTF-16 file. Only UTF-8 editing is available.",
        ));
    }
    let bom = bytes.starts_with(&[0xef, 0xbb, 0xbf]);
    let text = String::from_utf8(bytes[if bom { 3 } else { 0 }..].to_vec())
        .map_err(|_| AppError::new("unsupported", "File is not UTF-8."))?;
    let doc = Document {
        id: path_id,
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into(),
        relative_path: path
            .strip_prefix(&ws.root)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/"),
        revision: hash(&bytes),
        language: language(&path),
        eol: if text.contains("\r\n") { "CRLF" } else { "LF" }.into(),
        bom,
        text,
        workspace: workspace_id,
        path,
    };
    state
        .documents
        .lock()
        .unwrap()
        .insert(doc.id.clone(), doc.clone());
    Ok(doc)
}
#[tauri::command]
pub fn file_save(
    state: tauri::State<State>,
    document_id: String,
    revision: String,
    text: String,
    overwrite: bool,
) -> Result<String> {
    save_document(&state, document_id, revision, text, overwrite)
}

pub fn save_document(
    state: &State,
    document_id: String,
    revision: String,
    text: String,
    overwrite: bool,
) -> Result<String> {
    if text.len() > MAX_FILE as usize {
        return Err(AppError::new("invalid_request", "Document is too large."));
    }
    let mut documents = state.documents.lock().unwrap();
    let doc = documents
        .get_mut(&document_id)
        .ok_or_else(|| AppError::new("not_found", "Document is closed."))?;
    let ws = state.workspace(&doc.workspace)?;
    let path = scoped(
        &ws.root,
        doc.path
            .strip_prefix(&ws.root)
            .map_err(|_| AppError::new("permission_denied", "Invalid document scope"))?,
    )?;
    let disk = fs::read(&path)?;
    if !overwrite && hash(&disk) != revision {
        return Err(AppError::new(
            "conflict",
            "The file changed on disk. Your editor buffer is preserved.",
        ));
    }
    let normalized = text.replace("\r\n", "\n");
    let output = if doc.eol == "CRLF" {
        normalized.replace('\n', "\r\n")
    } else {
        normalized
    };
    let mut bytes = Vec::new();
    if doc.bom {
        bytes.extend([0xef, 0xbb, 0xbf]);
    }
    bytes.extend(output.as_bytes());
    if bytes.len() > MAX_FILE as usize {
        return Err(AppError::new(
            "invalid_request",
            "Encoded document exceeds the 10 MiB limit.",
        ));
    }
    let mut temp = tempfile::NamedTempFile::new_in(path.parent().unwrap())?;
    temp.as_file()
        .set_permissions(fs::metadata(&path)?.permissions())?;
    temp.write_all(&bytes)?;
    temp.as_file().sync_all()?;
    if !overwrite && hash(&fs::read(&path)?) != revision {
        return Err(AppError::new(
            "conflict",
            "Disk content changed during save.",
        ));
    }
    temp.persist(&path).map_err(|e| AppError::from(e.error))?;
    doc.revision = hash(&bytes);
    doc.text = output;
    Ok(doc.revision.clone())
}
#[tauri::command]
pub fn file_create(
    state: tauri::State<State>,
    workspace_id: String,
    parent_id: String,
    name: String,
    directory: bool,
) -> Result<Entry> {
    if !valid_name(&name) {
        return Err(AppError::new(
            "invalid_request",
            "Use a valid single file name.",
        ));
    }
    let ws = state.workspace(&workspace_id)?;
    let parent = resolve(&state, &workspace_id, &parent_id)?;
    let path = parent.join(name);
    if directory {
        fs::create_dir(&path)?;
    } else {
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)?;
    }
    entry(&state, &ws, &path)
}
#[tauri::command]
pub fn file_rename(
    state: tauri::State<State>,
    workspace_id: String,
    path_id: String,
    name: String,
) -> Result<()> {
    if !valid_name(&name) {
        return Err(AppError::new("invalid_request", "Invalid name."));
    }
    let ws = state.workspace(&workspace_id)?;
    let source = mutation_path(&state, &workspace_id, &path_id)?;
    if source == ws.root {
        return Err(AppError::new(
            "permission_denied",
            "Cannot rename workspace root.",
        ));
    }
    let dest = source.parent().unwrap().join(name);
    if fs::symlink_metadata(&dest).is_ok() {
        return Err(AppError::new("conflict", "Destination exists."));
    }
    fs::rename(&source, &dest)?;
    let old = source.strip_prefix(&ws.root).unwrap();
    let new = dest.strip_prefix(&ws.root).unwrap();
    state
        .paths
        .lock()
        .unwrap()
        .rename_prefix(&workspace_id, old, new);
    for doc in state.documents.lock().unwrap().values_mut() {
        if doc.workspace == workspace_id {
            if let Ok(suffix) = doc.path.strip_prefix(&source) {
                doc.path = dest.join(suffix);
                doc.relative_path = doc
                    .path
                    .strip_prefix(&ws.root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                doc.name = doc.path.file_name().unwrap().to_string_lossy().into();
                doc.language = language(&doc.path);
            }
        }
    }
    Ok(())
}
#[tauri::command]
pub fn file_move_to_trash(
    state: tauri::State<State>,
    workspace_id: String,
    path_id: String,
) -> Result<()> {
    let ws = state.workspace(&workspace_id)?;
    let path = mutation_path(&state, &workspace_id, &path_id)?;
    if path == ws.root {
        return Err(AppError::new(
            "permission_denied",
            "Cannot trash workspace root.",
        ));
    }
    trash::delete(path).map_err(|_| {
        AppError::new(
            "tool_failed",
            "OS trash unavailable. Permanent deletion is not offered.",
        )
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn module_extensions_get_language_services() {
        for extension in ["ts", "tsx", "mts", "cts"] {
            assert_eq!(
                language(Path::new(&format!("file.{extension}"))),
                "typescript"
            );
        }
        for extension in ["js", "jsx", "mjs", "cjs"] {
            assert_eq!(
                language(Path::new(&format!("file.{extension}"))),
                "javascript"
            );
        }
    }
    #[test]
    fn names_reject_escapes() {
        for name in ["..", "a/b", "a\\b", "NUL.txt", "x:", "a\n"] {
            assert!(!valid_name(name));
        }
        assert!(valid_name("hello world.ts"));
    }
    #[test]
    fn scopes_reject_parent() {
        let dir = tempfile::tempdir().unwrap();
        assert!(scoped(dir.path(), Path::new("../secret")).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn scopes_reject_symlink_escape() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(b.path(), a.path().join("escape")).unwrap();
        assert!(scoped(a.path(), Path::new("escape")).is_err());
    }
    #[test]
    fn revisions_change() {
        assert_ne!(hash(b"one"), hash(b"two"));
    }
}
#[cfg(test)]
mod save_tests {
    use super::*;
    fn fixture(bytes: &[u8], bom: bool, eol: &str) -> (tempfile::TempDir, State, String) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let path = root.join("example.txt");
        fs::write(&path, bytes).unwrap();
        let state = State::new(rusqlite::Connection::open_in_memory().unwrap());
        state.workspaces.lock().unwrap().insert(
            "ws".into(),
            Workspace {
                id: "ws".into(),
                name: "test".into(),
                display_path: "test".into(),
                root_id: "root".into(),
                trusted: false,
                root,
            },
        );
        state.documents.lock().unwrap().insert(
            "doc".into(),
            Document {
                id: "doc".into(),
                name: "example.txt".into(),
                relative_path: "example.txt".into(),
                text: String::new(),
                revision: hash(bytes),
                language: "plaintext".into(),
                eol: eol.into(),
                bom,
                workspace: "ws".into(),
                path,
            },
        );
        (dir, state, hash(bytes))
    }
    #[cfg(unix)]
    #[test]
    fn mutations_preserve_final_symlinks_and_reject_root() {
        let (dir, state, _) = fixture(b"target", false, "LF");
        let root = dir.path().canonicalize().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), root.join("link")).unwrap();
        let link = state.path_id("ws", "link".into());
        assert_eq!(
            mutation_path(&state, "ws", &link).unwrap(),
            root.join("link")
        );
        assert!(resolve(&state, "ws", &link).is_err());
        let root_id = state.path_id("ws", PathBuf::new());
        assert!(mutation_path(&state, "ws", &root_id).is_err());
        assert!(mutation_path(&state, "other", &link).is_err());
    }
    #[test]
    fn explorer_lists_git_ignored_and_hidden_entries() {
        let (dir, state, _) = fixture(b"x", false, "\n");
        let root = dir.path().canonicalize().unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::write(root.join("node_modules/pkg/index.js"), "x").unwrap();
        fs::write(root.join(".env"), "x").unwrap();
        fs::write(root.join(".gitignore"), "node_modules\n.env\n").unwrap();
        let root_id = state.path_id("ws", PathBuf::new());
        let names: Vec<String> = read_children(&state, "ws", &root_id)
            .unwrap()
            .into_iter()
            .map(|entry| entry.name)
            .collect();
        assert_eq!(names, ["node_modules", ".env", ".gitignore", "example.txt"]);
        let modules =
            read_children(&state, "ws", &state.path_id("ws", "node_modules".into())).unwrap();
        assert_eq!(modules.len(), 1);
        assert_eq!(modules[0].relative_path, "node_modules/pkg");
    }
    #[test]
    fn explorer_has_no_entry_count_cap() {
        let (dir, state, _) = fixture(b"x", false, "\n");
        let root = dir.path().canonicalize().unwrap();
        fs::create_dir_all(root.join("many")).unwrap();
        for index in 0..6000 {
            fs::write(root.join("many").join(format!("{index}.txt")), "").unwrap();
        }
        let entries = read_children(&state, "ws", &state.path_id("ws", "many".into())).unwrap();
        assert_eq!(entries.len(), 6000);
    }
    #[test]
    fn encoded_size_limit_preserves_original_file() {
        let (dir, state, revision) = fixture(b"original", true, "CRLF");
        let error = save_document(
            &state,
            "doc".into(),
            revision,
            "\n".repeat(MAX_FILE as usize / 2),
            false,
        )
        .unwrap_err();
        assert_eq!(error.code, "invalid_request");
        assert_eq!(
            fs::read(dir.path().join("example.txt")).unwrap(),
            b"original"
        );
    }
    #[test]
    fn saves_bom_crlf_without_conversion() {
        let (dir, state, revision) = fixture(b"\xef\xbb\xbffirst\r\n", true, "CRLF");
        save_document(
            &state,
            "doc".into(),
            revision,
            "second\nline\n".into(),
            false,
        )
        .unwrap();
        assert_eq!(
            fs::read(dir.path().join("example.txt")).unwrap(),
            b"\xef\xbb\xbfsecond\r\nline\r\n"
        );
    }
    #[test]
    fn external_change_refuses_overwrite() {
        let (dir, state, revision) = fixture(b"first", false, "LF");
        fs::write(dir.path().join("example.txt"), "external").unwrap();
        let error =
            save_document(&state, "doc".into(), revision, "editor".into(), false).unwrap_err();
        assert_eq!(error.code, "conflict");
        assert_eq!(
            fs::read(dir.path().join("example.txt")).unwrap(),
            b"external"
        );
    }
    #[test]
    fn restricted_workspace_denies_execution() {
        let (_, state, _) = fixture(b"first", false, "LF");
        assert_eq!(state.trusted("ws").unwrap_err().code, "workspace_untrusted");
    }
}
