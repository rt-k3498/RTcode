use crate::domain::*;
use portable_pty::{Child, MasterPty};
use std::{
    collections::HashMap,
    io::Write,
    sync::{atomic::AtomicBool, Arc, Mutex},
};
pub struct TerminalSession {
    pub workspace: String,
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
}
/// Opaque path handles with a reverse index so looking up a handle by path
/// does not scan every existing handle.
#[derive(Default)]
pub struct PathTable {
    by_id: HashMap<String, PathHandle>,
    by_path: HashMap<(String, std::path::PathBuf), String>,
}
impl PathTable {
    pub fn get(&self, id: &str) -> Option<&PathHandle> {
        self.by_id.get(id)
    }
    pub fn id_for(&mut self, workspace: &str, relative: std::path::PathBuf) -> String {
        if let Some(id) = self.by_path.get(&(workspace.to_string(), relative.clone())) {
            return id.clone();
        }
        let id = id();
        self.by_path
            .insert((workspace.to_string(), relative.clone()), id.clone());
        self.by_id.insert(
            id.clone(),
            PathHandle {
                workspace: workspace.into(),
                relative,
            },
        );
        id
    }
    pub fn remove_workspace(&mut self, workspace: &str) {
        self.by_id.retain(|_, path| path.workspace != workspace);
        self.by_path.retain(|(ws, _), _| ws != workspace);
    }
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.by_id.len()
    }
    /// Moves every handle under `old` to the same suffix under `new`. A handle
    /// that already sat at the destination keeps its id, but the moved handle
    /// becomes the one found by path.
    pub fn rename_prefix(&mut self, workspace: &str, old: &std::path::Path, new: &std::path::Path) {
        for (id, handle) in self.by_id.iter_mut() {
            if handle.workspace != workspace {
                continue;
            }
            let Ok(suffix) = handle.relative.strip_prefix(old) else {
                continue;
            };
            let moved = new.join(suffix);
            let from = (workspace.to_string(), handle.relative.clone());
            if self.by_path.get(&from) == Some(id) {
                self.by_path.remove(&from);
            }
            self.by_path
                .insert((workspace.to_string(), moved.clone()), id.clone());
            handle.relative = moved;
        }
    }
}
pub struct State {
    pub db: Mutex<rusqlite::Connection>,
    pub launch_directory: Mutex<Option<Result<std::path::PathBuf>>>,
    pub workspaces: Mutex<HashMap<String, Workspace>>,
    pub paths: Mutex<PathTable>,
    pub documents: Mutex<HashMap<String, Document>>,
    pub terminals: Mutex<HashMap<String, TerminalSession>>,
    pub searches: Mutex<HashMap<String, Arc<AtomicBool>>>,
}
impl State {
    pub fn new(db: rusqlite::Connection) -> Self {
        Self {
            db: Mutex::new(db),
            launch_directory: Mutex::default(),
            workspaces: Mutex::default(),
            paths: Mutex::default(),
            documents: Mutex::default(),
            terminals: Mutex::default(),
            searches: Mutex::default(),
        }
    }
    pub fn workspace(&self, id: &str) -> Result<Workspace> {
        self.workspaces
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::new("not_found", "Workspace is closed."))
    }
    pub fn trusted(&self, id: &str) -> Result<Workspace> {
        let ws = self.workspace(id)?;
        if !ws.trusted {
            return Err(AppError::new(
                "workspace_untrusted",
                "Review workspace trust before running tools.",
            ));
        }
        Ok(ws)
    }
    pub fn path_id(&self, workspace: &str, relative: std::path::PathBuf) -> String {
        self.paths.lock().unwrap().id_for(workspace, relative)
    }
    pub fn shutdown(&self) {
        for (_, terminal) in self.terminals.lock().unwrap().drain() {
            let _ = terminal.child.lock().unwrap().kill();
            let _ = terminal.child.lock().unwrap().wait();
        }
        for cancel in self.searches.lock().unwrap().values() {
            cancel.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    #[test]
    fn renaming_moves_handles_and_the_moved_one_wins_the_destination() {
        let mut table = PathTable::default();
        let dir = table.id_for("ws", "a".into());
        let file = table.id_for("ws", "a/x.ts".into());
        let other = table.id_for("other", "a/x.ts".into());
        let stale = table.id_for("ws", "b/x.ts".into());
        table.rename_prefix("ws", &PathBuf::from("a"), &PathBuf::from("b"));
        assert_eq!(table.get(&dir).unwrap().relative, PathBuf::from("b"));
        assert_eq!(table.get(&file).unwrap().relative, PathBuf::from("b/x.ts"));
        assert_eq!(table.get(&other).unwrap().relative, PathBuf::from("a/x.ts"));
        assert_eq!(table.id_for("ws", "b/x.ts".into()), file);
        assert_eq!(table.id_for("ws", "b".into()), dir);
        assert_eq!(table.id_for("other", "a/x.ts".into()), other);
        assert_eq!(table.get(&stale).unwrap().relative, PathBuf::from("b/x.ts"));
        assert_eq!(table.len(), 4);
    }
}
