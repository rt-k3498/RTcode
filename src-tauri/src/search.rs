use crate::{domain::*, files, state::State};
use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use regex::{Regex, RegexBuilder};
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashSet},
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tauri::Manager;

const BATCH_SIZE: usize = 128;

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSummary {
    skipped_files: usize,
}

// Commas inside brace groups belong to the glob, not the pattern list.
fn patterns(input: &str) -> Vec<String> {
    let mut depth = 0usize;
    let mut start = 0;
    let mut result = Vec::new();
    for (i, c) in input.char_indices() {
        match c {
            '{' | '[' => depth += 1,
            '}' | ']' => depth = depth.saturating_sub(1),
            ',' if depth == 0 => {
                result.push(input[start..i].trim().to_string());
                start = i + 1;
            }
            _ => {}
        }
    }
    result.push(input[start..].trim().to_string());
    result.into_iter().filter(|s| !s.is_empty()).collect()
}
fn globs(input: &str) -> Result<GlobSet> {
    let mut builder = GlobSetBuilder::new();
    for pattern in patterns(input) {
        let rooted = pattern.starts_with("./");
        let pattern = pattern.trim_start_matches("./").trim_end_matches('/');
        let pattern = if rooted || pattern.starts_with("**/") {
            pattern.to_string()
        } else {
            format!("**/{pattern}")
        };
        for glob in [pattern.clone(), format!("{pattern}/**")] {
            builder.add(
                GlobBuilder::new(&glob)
                    .literal_separator(true)
                    .build()
                    .map_err(|e| {
                        AppError::new("invalid_request", format!("Invalid file filter: {e}"))
                    })?,
            );
        }
    }
    builder
        .build()
        .map_err(|e| AppError::new("invalid_request", e.to_string()))
}
struct Query {
    regex: Regex,
    include: GlobSet,
    exclude: GlobSet,
}
impl Query {
    fn new(options: &SearchOptions) -> Result<Self> {
        if options.query.is_empty() {
            return Err(AppError::new("invalid_request", "Enter a search query."));
        }
        let pattern = if options.regex {
            options.query.clone()
        } else {
            regex::escape(&options.query)
        };
        let pattern = if options.whole_word {
            format!(r"\b(?:{pattern})\b")
        } else {
            pattern
        };
        let regex = RegexBuilder::new(&pattern)
            .case_insensitive(!options.case_sensitive)
            .size_limit(usize::MAX)
            .build()
            .map_err(|e| {
                AppError::new(
                    "invalid_request",
                    format!("Invalid regular expression: {e}"),
                )
            })?;
        Ok(Self {
            regex,
            include: globs(&options.include)?,
            exclude: globs(&options.exclude)?,
        })
    }
    fn accepts(&self, path: &Path) -> bool {
        (self.include.is_empty() || self.include.is_match(path)) && !self.exclude.is_match(path)
    }
}
fn read_text(path: &Path) -> Result<(String, String)> {
    let bytes = std::fs::read(path)?;
    if bytes.contains(&0) {
        return Err(AppError::new("unsupported", "Binary file."));
    }
    let revision = files::hash(&bytes);
    let content = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&bytes);
    let text = String::from_utf8(content.to_vec())
        .map_err(|_| AppError::new("unsupported", "File is not UTF-8."))?;
    Ok((text, revision))
}
// Only the displayed preview is shortened; matching and editor ranges use the
// complete line. This avoids copying a huge line into every result.
fn preview(line: &str, start: usize) -> (String, usize) {
    let mut from = start.saturating_sub(160);
    while !line.is_char_boundary(from) {
        from += 1;
    }
    let mut to = (start.saturating_add(640)).min(line.len());
    while !line.is_char_boundary(to) {
        to -= 1;
    }
    (
        line[from..to].to_string(),
        line[from..start].encode_utf16().count(),
    )
}
fn search_workspace(
    state: &State,
    workspace_id: &str,
    options: &SearchOptions,
    cancel: &AtomicBool,
    mut send: impl FnMut(Vec<SearchMatch>) -> bool,
) -> Result<SearchSummary> {
    let query = Query::new(options)?;
    let ws = state.workspace(workspace_id)?;
    let mut summary = SearchSummary::default();
    let walker = ignore::WalkBuilder::new(&ws.root)
        .require_git(false)
        .follow_links(false)
        .build();
    for entry in walker {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                summary.skipped_files += 1;
                continue;
            }
        };
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let relative = entry.path().strip_prefix(&ws.root).unwrap();
        if !query.accepts(relative) {
            continue;
        }
        let path = match files::scoped(&ws.root, relative) {
            Ok(path) => path,
            Err(_) => {
                summary.skipped_files += 1;
                continue;
            }
        };
        let (text, revision) = match read_text(&path) {
            Ok(value) => value,
            Err(_) => {
                summary.skipped_files += 1;
                continue;
            }
        };
        let mut batch = Vec::new();
        let path_id = state.path_id(workspace_id, relative.to_path_buf());
        let display_path = relative.to_string_lossy().replace('\\', "/");
        for (line_number, line) in text.lines().enumerate() {
            if cancel.load(Ordering::SeqCst) {
                return Ok(summary);
            }
            let mut previous_start = 0;
            let mut column = 1;
            for found in query.regex.find_iter(line) {
                if cancel.load(Ordering::SeqCst) {
                    return Ok(summary);
                }
                column += line[previous_start..found.start()].encode_utf16().count();
                previous_start = found.start();
                let end_column = column + found.as_str().encode_utf16().count();
                let (text, preview_offset) = preview(line, found.start());
                batch.push(SearchMatch {
                    path_id: path_id.clone(),
                    path: display_path.clone(),
                    line: (line_number + 1) as u64,
                    column,
                    end_column,
                    text_column: column - preview_offset,
                    text,
                    revision: revision.clone(),
                });
                if batch.len() == BATCH_SIZE && !send(std::mem::take(&mut batch)) {
                    return Ok(summary);
                }
            }
        }
        if !batch.is_empty() && !send(batch) {
            break;
        }
    }
    Ok(summary)
}
#[tauri::command]
pub fn search_cancel(state: tauri::State<State>, request_id: String) {
    if let Some(cancel) = state.searches.lock().unwrap().get(&request_id) {
        cancel.store(true, Ordering::SeqCst);
    }
}
struct Registration<'a> {
    state: &'a State,
    id: String,
}
impl Drop for Registration<'_> {
    fn drop(&mut self) {
        self.state.searches.lock().unwrap().remove(&self.id);
    }
}
#[tauri::command]
pub async fn search_start(
    app: tauri::AppHandle,
    workspace_id: String,
    request_id: String,
    options: SearchOptions,
    channel: tauri::ipc::Channel<Vec<SearchMatch>>,
) -> Result<SearchSummary> {
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let state = app.state::<State>();
        let mut searches = state.searches.lock().unwrap();
        if searches.contains_key(&request_id) {
            return Err(AppError::new(
                "invalid_request",
                "Search ID is already active.",
            ));
        }
        searches.insert(request_id.clone(), cancel.clone());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<State>();
        let _registration = Registration {
            state: &state,
            id: request_id,
        };
        search_workspace(&state, &workspace_id, &options, &cancel, |batch| {
            channel.send(batch).is_ok()
        })
    })
    .await
    .map_err(|_| AppError::new("internal", "Search worker stopped."))?
}

#[derive(Default, Serialize)]
pub struct ReplaceResult {
    updated: Vec<Document>,
    errors: Vec<String>,
    replacements: usize,
}

fn replacement_text(
    text: &str,
    query: &Query,
    selected: &[SearchMatch],
    replacement: &str,
    regex: bool,
) -> Result<String> {
    let mut wanted = HashSet::new();
    for item in selected {
        wanted.insert((item.line, item.column, item.end_column));
    }
    let mut output = String::new();
    let mut copied = 0;
    let mut offset = 0;
    for (line_number, full_line) in text.split_inclusive('\n').enumerate() {
        let line = full_line.strip_suffix('\n').unwrap_or(full_line);
        let line = line.strip_suffix('\r').unwrap_or(line);
        let mut previous_start = 0;
        let mut column = 1;
        for captures in query.regex.captures_iter(line) {
            let found = captures.get(0).unwrap();
            column += line[previous_start..found.start()].encode_utf16().count();
            previous_start = found.start();
            let key = (
                (line_number + 1) as u64,
                column,
                column + found.as_str().encode_utf16().count(),
            );
            if wanted.remove(&key) {
                let mut value = String::new();
                if regex {
                    captures.expand(replacement, &mut value);
                } else {
                    value.push_str(replacement);
                }
                let prefix = &text[copied..offset + found.start()];
                if output.len() + prefix.len() + value.len() > files::MAX_FILE as usize {
                    return Err(AppError::new(
                        "invalid_request",
                        "Replacement exceeds the 10 MiB file limit.",
                    ));
                }
                output.push_str(prefix);
                output.push_str(&value);
                copied = offset + found.end();
            }
        }
        offset += full_line.len();
    }
    if !wanted.is_empty() {
        return Err(AppError::new(
            "conflict",
            "Search results changed. Search again before replacing.",
        ));
    }
    if output.len() + text.len() - copied > files::MAX_FILE as usize {
        return Err(AppError::new(
            "invalid_request",
            "Replacement exceeds the 10 MiB file limit.",
        ));
    }
    output.push_str(&text[copied..]);
    Ok(output)
}
fn replace_matches(
    state: &State,
    workspace_id: &str,
    options: &SearchOptions,
    matches: Vec<SearchMatch>,
    replacement: &str,
) -> Result<ReplaceResult> {
    if matches.is_empty() || replacement.len() > 65536 {
        return Err(AppError::new(
            "invalid_request",
            "Replacement exceeds the operation limits.",
        ));
    }
    let query = Query::new(options)?;
    let mut groups: BTreeMap<String, Vec<SearchMatch>> = BTreeMap::new();
    for item in matches {
        groups.entry(item.path_id.clone()).or_default().push(item);
    }
    let mut result = ReplaceResult::default();
    let mut updated_bytes = 0usize;
    for (id, selected) in groups {
        let update = (|| -> Result<Document> {
            let path = files::resolve(state, workspace_id, &id)?;
            let ws = state.workspace(workspace_id)?;
            if !query.accepts(path.strip_prefix(&ws.root).unwrap()) {
                return Err(AppError::new(
                    "conflict",
                    "File no longer matches the filters.",
                ));
            }
            let (text, revision) = read_text(&path)?;
            if selected.iter().any(|item| item.revision != revision) {
                return Err(AppError::new(
                    "conflict",
                    "File changed since search. Search again.",
                ));
            }
            let output = replacement_text(&text, &query, &selected, replacement, options.regex)?;
            if updated_bytes + output.len() > 64 * 1024 * 1024 {
                return Err(AppError::new(
                    "invalid_request",
                    "Replacement exceeds 64 MiB. Narrow the file filters.",
                ));
            }
            let doc = files::open_document(state, workspace_id.into(), id.clone())?;
            files::save_document(state, doc.id, revision, output, false)?;
            files::open_document(state, workspace_id.into(), id.clone())
        })();
        match update {
            Ok(doc) => {
                updated_bytes += doc.text.len();
                result.replacements += selected.len();
                result.updated.push(doc);
            }
            Err(error) => result
                .errors
                .push(format!("{}: {}", selected[0].path, error.message)),
        }
    }
    Ok(result)
}
#[tauri::command]
pub async fn search_replace(
    app: tauri::AppHandle,
    workspace_id: String,
    options: SearchOptions,
    matches: Vec<SearchMatch>,
    replacement: String,
) -> Result<ReplaceResult> {
    tauri::async_runtime::spawn_blocking(move || {
        replace_matches(
            &app.state::<State>(),
            &workspace_id,
            &options,
            matches,
            &replacement,
        )
    })
    .await
    .map_err(|_| AppError::new("internal", "Replace worker stopped."))?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn options(query: &str) -> SearchOptions {
        SearchOptions {
            query: query.into(),
            regex: false,
            case_sensitive: false,
            whole_word: false,
            include: String::new(),
            exclude: String::new(),
        }
    }
    fn fixture() -> (tempfile::TempDir, State) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let state = State::new(rusqlite::Connection::open_in_memory().unwrap());
        state.workspaces.lock().unwrap().insert(
            "ws".into(),
            Workspace {
                id: "ws".into(),
                name: "project".into(),
                display_path: root.to_string_lossy().into(),
                trusted: false,
                root_id: "root".into(),
                root,
            },
        );
        (dir, state)
    }
    fn search(state: &State, options: &SearchOptions) -> Vec<SearchMatch> {
        let mut found = Vec::new();
        search_workspace(state, "ws", options, &AtomicBool::new(false), |batch| {
            found.extend(batch);
            true
        })
        .unwrap();
        found
    }
    #[test]
    fn search_and_replace_work_without_external_tools_and_preserve_bom_crlf() {
        let (dir, state) = fixture();
        std::fs::write(
            dir.path().join("file.ts"),
            "\u{feff}😀 Agent agent\r\nAgent\r\n",
        )
        .unwrap();
        let opts = options("agent");
        let found = search(&state, &opts);
        assert_eq!(found.len(), 3);
        assert_eq!(found[0].column, 4);
        let result = replace_matches(&state, "ws", &opts, found, "$literal").unwrap();
        assert!(result.errors.is_empty());
        assert_eq!(result.replacements, 3);
        assert_eq!(
            std::fs::read_to_string(dir.path().join("file.ts")).unwrap(),
            "\u{feff}😀 $literal $literal\r\n$literal\r\n"
        );
    }
    #[test]
    fn filters_support_lists_braces_and_ignored_files() {
        let (dir, state) = fixture();
        std::fs::create_dir_all(dir.path().join("src/test")).unwrap();
        for name in [
            "src/a.ts",
            "src/a.js",
            "src/a.rs",
            "src/test/a.ts",
            "ignored.ts",
            ".hidden.ts",
        ] {
            std::fs::write(dir.path().join(name), "Agent").unwrap();
        }
        std::fs::write(dir.path().join(".gitignore"), "ignored.ts\n").unwrap();
        let mut opts = options("Agent");
        opts.include = "src/**/*.{ts,js}, *.rs".into();
        opts.exclude = "**/test/**".into();
        assert_eq!(search(&state, &opts).len(), 3);
        opts.include.clear();
        opts.exclude.clear();
        assert_eq!(search(&state, &opts).len(), 4);
    }
    #[test]
    fn stale_replacements_refuse_to_overwrite_and_regex_groups_expand() {
        let (dir, state) = fixture();
        let path = dir.path().join("file.txt");
        std::fs::write(&path, "Agent42 Agent7").unwrap();
        let mut opts = options(r"Agent(\d+)");
        opts.regex = true;
        let found = search(&state, &opts);
        let result =
            replace_matches(&state, "ws", &opts, vec![found[0].clone()], "Worker$1").unwrap();
        assert_eq!(result.replacements, 1);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "Worker42 Agent7");
        let result = replace_matches(&state, "ws", &opts, found, "wrong").unwrap();
        assert_eq!(result.errors.len(), 1);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "Worker42 Agent7");
    }
    #[test]
    fn results_stream_past_the_old_cap_and_can_all_be_replaced() {
        let (dir, state) = fixture();
        std::fs::write(dir.path().join("large.txt"), "a\n".repeat(5000)).unwrap();
        let mut found = Vec::new();
        let mut batches = 0;
        let summary = search_workspace(
            &state,
            "ws",
            &options("a"),
            &AtomicBool::new(false),
            |batch| {
                assert!(batch.len() <= BATCH_SIZE);
                batches += 1;
                found.extend(batch);
                true
            },
        )
        .unwrap();
        assert_eq!(found.len(), 5000);
        assert!(batches > 1);
        assert_eq!(summary.skipped_files, 0);
        let result = replace_matches(&state, "ws", &options("a"), found, "b").unwrap();
        assert!(result.errors.is_empty());
        assert_eq!(result.replacements, 5000);
        assert_eq!(
            std::fs::read_to_string(dir.path().join("large.txt")).unwrap(),
            "b\n".repeat(5000)
        );
    }
    #[test]
    fn invalid_patterns_are_errors() {
        let (_dir, state) = fixture();
        let mut opts = options("[");
        opts.regex = true;
        assert!(Query::new(&opts).is_err());
        assert!(search(&state, &options("[")).is_empty());
        let mut opts = options("a");
        opts.include = "[".into();
        assert!(Query::new(&opts).is_err());
    }
    #[test]
    fn large_files_and_long_lines_are_searched_with_correct_unicode_ranges() {
        let (dir, state) = fixture();
        let prefix = "😀".repeat(3 * 1024 * 1024);
        std::fs::write(dir.path().join("large.txt"), format!("{prefix}needle")).unwrap();
        let found = search(&state, &options("needle"));
        assert_eq!(found.len(), 1);
        let item = &found[0];
        assert_eq!(item.column, 6 * 1024 * 1024 + 1);
        assert_eq!(item.end_column, item.column + 6);
        assert!(item.text.len() < 1000);
        let preview: Vec<_> = item.text.encode_utf16().collect();
        assert_eq!(
            String::from_utf16(
                &preview[item.column - item.text_column..item.end_column - item.text_column]
            )
            .unwrap(),
            "needle"
        );
    }
    #[test]
    fn replacement_limit_checks_final_output_not_intermediate_edits() {
        let (dir, state) = fixture();
        let text = format!("{}END", "x".repeat(files::MAX_FILE as usize - 3));
        std::fs::write(dir.path().join("file.txt"), &text).unwrap();
        let mut opts = options("x+|END");
        opts.regex = true;
        let selected = search(&state, &opts);
        assert_eq!(selected.len(), 2);
        let output = replacement_text(
            &text,
            &Query::new(&opts).unwrap(),
            &selected,
            "replacement",
            true,
        )
        .unwrap();
        assert_eq!(output, "replacementreplacement");
    }

    #[test]
    fn dense_long_lines_keep_all_matches_and_exact_utf16_ranges() {
        let (dir, state) = fixture();
        std::fs::write(dir.path().join("dense.txt"), "😀needle ".repeat(5000)).unwrap();
        let found = search(&state, &options("needle"));
        assert_eq!(found.len(), 5000);
        for (index, item) in found.iter().enumerate() {
            assert_eq!(item.column, index * 9 + 3);
            assert_eq!(item.end_column, item.column + 6);
            let preview: Vec<_> = item.text.encode_utf16().collect();
            assert_eq!(
                String::from_utf16(
                    &preview[item.column - item.text_column..item.end_column - item.text_column]
                )
                .unwrap(),
                "needle"
            );
        }
        let selected = found.into_iter().step_by(2).collect();
        let result = replace_matches(&state, "ws", &options("needle"), selected, "thread").unwrap();
        assert!(result.errors.is_empty());
        assert_eq!(result.replacements, 2500);
        assert_eq!(
            std::fs::read_to_string(dir.path().join("dense.txt")).unwrap(),
            "😀thread 😀needle ".repeat(2500)
        );
    }
    #[test]
    fn queries_and_filter_lists_can_exceed_the_old_size_limit() {
        let (dir, state) = fixture();
        let needle = "a".repeat(5000);
        std::fs::write(dir.path().join("file.txt"), &needle).unwrap();
        let mut opts = options(&needle);
        opts.include = format!("{}file.txt", "other.txt,".repeat(500));
        opts.exclude = "missing.txt,".repeat(500);
        assert_eq!(search(&state, &opts).len(), 1);
    }
    #[test]
    fn cancellation_and_closed_stream_stop_dense_searches_between_batches() {
        let (dir, state) = fixture();
        std::fs::write(dir.path().join("file.txt"), "a".repeat(5000)).unwrap();
        let cancel = AtomicBool::new(false);
        let mut count = 0;
        search_workspace(&state, "ws", &options("a"), &cancel, |batch| {
            count += batch.len();
            cancel.store(true, Ordering::SeqCst);
            true
        })
        .unwrap();
        assert_eq!(count, BATCH_SIZE);
        let mut count = 0;
        search_workspace(
            &state,
            "ws",
            &options("a"),
            &AtomicBool::new(false),
            |batch| {
                count += batch.len();
                false
            },
        )
        .unwrap();
        assert_eq!(count, BATCH_SIZE);
    }
}
