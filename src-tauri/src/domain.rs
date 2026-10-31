use serde::{Deserialize, Serialize};
use std::path::PathBuf;
pub fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    pub correlation_id: String,
}
impl AppError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retryable: false,
            correlation_id: id(),
        }
    }
}
impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        let code = match e.kind() {
            std::io::ErrorKind::NotFound => "not_found",
            std::io::ErrorKind::PermissionDenied => "permission_denied",
            _ => "internal",
        };
        Self::new(code, e.to_string())
    }
}
impl From<rusqlite::Error> for AppError {
    fn from(_: rusqlite::Error) -> Self {
        Self::new("internal", "Metadata database operation failed.")
    }
}
pub type Result<T> = std::result::Result<T, AppError>;
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub display_path: String,
    pub trusted: bool,
    pub root_id: String,
    #[serde(skip)]
    pub root: PathBuf,
}
#[derive(Clone)]
pub struct PathHandle {
    pub workspace: String,
    pub relative: PathBuf,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub name: String,
    pub relative_path: String,
    pub directory: bool,
    pub symlink: bool,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: String,
    pub name: String,
    pub relative_path: String,
    pub text: String,
    pub revision: String,
    pub language: String,
    pub eol: String,
    pub bom: bool,
    #[serde(skip)]
    pub workspace: String,
    #[serde(skip)]
    pub path: PathBuf,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stream {
    pub sequence: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Vec<u8>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<u32>,
}
#[derive(Serialize)]
pub struct Change {
    #[serde(rename = "pathId", skip_serializing_if = "Option::is_none")]
    pub path_id: Option<String>,
    pub path: String,
    pub status: String,
    pub staged: bool,
    pub conflict: bool,
}
#[derive(Serialize)]
pub struct Commit {
    pub hash: String,
    pub message: String,
}
#[derive(Serialize)]
pub struct GitState {
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub local: Vec<String>,
    pub remote: Vec<String>,
    pub commits: Vec<Commit>,
    pub changes: Vec<Change>,
    pub worktrees: Vec<GitWorktree>,
}
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktree {
    pub path: String,
    pub branch: String,
    pub head: String,
    pub current: bool,
    pub detached: bool,
    pub bare: bool,
    pub locked: bool,
    pub prunable: bool,
    pub available: bool,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    pub query: String,
    pub regex: bool,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub include: String,
    pub exclude: String,
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileMatch {
    pub path_id: String,
    pub path: String,
    pub name: String,
}
/// Best file-name matches plus how many files matched in all.
#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileSearch {
    pub files: Vec<FileMatch>,
    pub total: usize,
    pub skipped_files: usize,
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub path_id: String,
    pub path: String,
    pub line: u64,
    pub column: usize,
    pub end_column: usize,
    pub text_column: usize,
    pub text: String,
    pub revision: String,
}
