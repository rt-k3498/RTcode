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
pub struct State {
    pub db: Mutex<rusqlite::Connection>,
    pub launch_directory: Mutex<Option<Result<std::path::PathBuf>>>,
    pub workspaces: Mutex<HashMap<String, Workspace>>,
    pub paths: Mutex<HashMap<String, PathHandle>>,
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
        let mut paths = self.paths.lock().unwrap();
        if let Some((id, _)) = paths
            .iter()
            .find(|(_, p)| p.workspace == workspace && p.relative == relative)
        {
            return id.clone();
        }
        let id = id();
        paths.insert(
            id.clone(),
            PathHandle {
                workspace: workspace.into(),
                relative,
            },
        );
        id
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
